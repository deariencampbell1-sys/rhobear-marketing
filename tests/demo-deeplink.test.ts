import { describe, expect, it } from 'vitest';
// W0-05b — deep links (behaviour 18) and captions (behaviour 20). Tests
// first: this file is committed while `src/clients/demo/deeplink.ts` and
// `src/clients/demo/captions.ts` do not exist, so the run is red before any
// implementation exists. The captions tests live here because the round's
// file list names exactly two test files.
import { parseDemoDeepLink, type ParsedDemoDeepLink } from '../src/clients/demo/deeplink';
import { isWebVttUrl, parseWebVTT } from '../src/clients/demo/captions';
import { present } from '../src/clients/demo/resolve';
import type { DemoPackage } from '../src/clients/demo/schema';

const PACKAGE_REVISION = 'rev-2026-10-25-1';
const SOURCE_REVISION = 'a'.repeat(40);
const mediaBase = `https://media.example.com/demos/teams-01/${PACKAGE_REVISION}`;

describe('demo deep links', () => {
  it('behaviour 18 (D01): /engines/<scenarioId>#t=42 parses to the scenario and the position, and an unknown or non-allowlisted scenario is not-found — never a redirect, never a list of unapproved scenarios', () => {
    expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash: '#t=42' }, 60)).toEqual({
      kind: 'player',
      scenarioId: 'teams-01',
      positionSeconds: 42,
    });
    // No fragment at all is a valid deep link with no position.
    expect(parseDemoDeepLink({ pathname: '/engines/teams-01' }, 60)).toEqual({
      kind: 'player',
      scenarioId: 'teams-01',
      positionSeconds: null,
    });

    // A shaped but unknown scenario id is not-found, and the answer never
    // echoes the id, never redirects, and never lists anything playable.
    const unknown: ParsedDemoDeepLink = parseDemoDeepLink({ pathname: '/engines/zzz-99' }, 60);
    expect(unknown).toEqual({ kind: 'not-found', reason: 'unknown-scenario' });
    expect(Object.keys(unknown).sort()).toEqual(['kind', 'reason']);
    const unknownJson = JSON.stringify(unknown);
    expect(unknownJson).not.toContain('zzz-99');
    expect(unknownJson).not.toMatch(/redirect|location/i);

    // Non-allowlisted: a board scenario the caller's allowlist does not name.
    expect(
      parseDemoDeepLink({ pathname: '/engines/designs-01' }, 60, ['teams-01']),
    ).toEqual({ kind: 'not-found', reason: 'unknown-scenario' });

    // A path that is not /engines/<scenarioId> is not-found too.
    expect(parseDemoDeepLink({ pathname: '/engines' }, 60)).toEqual({
      kind: 'not-found',
      reason: 'bad-path',
    });
    expect(parseDemoDeepLink({ pathname: '/engines/teams-01/extra' }, 60)).toEqual({
      kind: 'not-found',
      reason: 'bad-path',
    });
    expect(parseDemoDeepLink({ pathname: '/engines/../secret' }, 60)).toEqual({
      kind: 'not-found',
      reason: 'bad-path',
    });
    expect(parseDemoDeepLink({ pathname: '/pricing' }, 60)).toEqual({
      kind: 'not-found',
      reason: 'bad-path',
    });
  });

  it('behaviour 18 edge (D01): #t=42 on a package whose duration is 12 s is ignored — not clamped to the end, not an error page', () => {
    expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash: '#t=42' }, 12)).toEqual({
      kind: 'player',
      scenarioId: 'teams-01',
      positionSeconds: null,
    });
    // Every unusable t is ignored the same way: no position, no refusal.
    for (const hash of ['#t=abc', '#t=', '#t=-5', '#t=Infinity', '#t=NaN', '#t=1=2']) {
      expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash }, 12)).toEqual({
        kind: 'player',
        scenarioId: 'teams-01',
        positionSeconds: null,
      });
    }
  });

  it('behaviour 18 edge (D01): the fragment carries nothing else — no token, email, account or receipt id reaches the parsed link', () => {
    // A fragment smuggling anything besides t is not our format.
    const smuggled: ParsedDemoDeepLink = parseDemoDeepLink(
      { pathname: '/engines/teams-01', hash: '#t=42&token=sekrit' },
      60,
    );
    expect(smuggled).toEqual({ kind: 'not-found', reason: 'bad-fragment' });
    expect(JSON.stringify(smuggled)).not.toContain('sekrit');

    const credentials: ParsedDemoDeepLink = parseDemoDeepLink(
      {
        pathname: '/engines/teams-01',
        hash: '#email=person%40example.com&account=acc-7&receipt=r-9',
      },
      60,
    );
    expect(credentials).toEqual({ kind: 'not-found', reason: 'bad-fragment' });
    expect(JSON.stringify(credentials)).not.toMatch(/person|acc-7|r-9/);

    // And a well-formed link's parsed shape carries the scenario and the
    // position — nothing else, ever.
    const parsed = parseDemoDeepLink({ pathname: '/engines/teams-01', hash: '#t=42' }, 60);
    expect(Object.keys(parsed).sort()).toEqual(['kind', 'positionSeconds', 'scenarioId']);
  });

  it('behaviour 18 edge (D01): a query string is never used for media position — the #t= fragment is the only source', () => {
    expect(
      parseDemoDeepLink({ pathname: '/engines/teams-01', search: '?t=42' }, 60),
    ).toEqual({ kind: 'player', scenarioId: 'teams-01', positionSeconds: null });
    // A #t= fragment combined with a query string: position from the fragment only.
    expect(
      parseDemoDeepLink(
        { pathname: '/engines/teams-01', search: '?t=99&token=sekrit', hash: '#t=7' },
        60,
      ),
    ).toEqual({ kind: 'player', scenarioId: 'teams-01', positionSeconds: 7 });
    expect(JSON.stringify(parseDemoDeepLink({ pathname: '/engines/teams-01', search: '?t=42' }, 60))).not.toContain('sekrit');
  });
});

describe('demo captions', () => {
  it('behaviour 20 (D06): a WebVTT file is required for a playable package, and a malformed cue is skipped with a named reason and never thrown into the UI', () => {
    // Presence: the resolver refuses a package without captions — the premise
    // this module relies on, proved here through W0-05a's own gates.
    const noCaptions: DemoPackage = {
      schema: 'rhobear.demo-package.v1',
      engineOrProduct: 'teams',
      scenarioId: 'teams-01',
      packageRevision: PACKAGE_REVISION,
      publicationState: 'approved',
      sourceApp: 'capturd',
      sourceRevision: SOURCE_REVISION,
      renditions: [
        {
          url: `${mediaBase}/clip-720.mp4`,
          mime: 'video/mp4',
          width: 1280,
          height: 720,
          durationSeconds: 42,
          chapters: [],
        },
      ],
      posterUrl: `${mediaBase}/poster.png`,
      captionsUrl: null,
      transcriptUrl: `${mediaBase}/transcript.html`,
      interactive: null,
      evidence: { inputs: [], runIds: [], logs: [], artifactHashes: [] },
      approval: { approvedBy: 'owner', approvedAt: '2026-10-25T00:00:00Z', watchedComplete: true },
      contentHash: 'e'.repeat(64),
      immutableUrls: true,
    };
    expect(present(noCaptions, 'network', 0)).toEqual({
      state: 'invalid',
      reason: 'captions-required',
    });
    // The presence rule at the URL level: a captions URL must name WebVTT.
    expect(isWebVttUrl(`${mediaBase}/captions.vtt`)).toBe(true);
    expect(isWebVttUrl(`${mediaBase}/captions.html`)).toBe(false);
    expect(isWebVttUrl(null)).toBe(false);

    // Parse rules: a malformed cue is skipped with a named reason and the
    // cues around it survive.
    const raw = [
      'WEBVTT',
      '',
      '00:00:00.000 --> 00:00:02.500',
      'Hello.',
      '',
      'not-a-timing-line',
      'skipped text',
      '',
      '00:00:03.000 --> 00:00:05.000 align:start',
      'Second cue',
      'on two lines',
      '',
      '00:00:05.000 --> 00:00:04.000',
      'Backwards.',
      '',
      '00:00:06.000 --> 00:00:07.000',
      '',
      'intro-cue',
      '00:00:08.000 --> 00:00:09.000',
      'With an identifier.',
      '',
    ].join('\n');
    const parsed = parseWebVTT(raw, `${mediaBase}/transcript.html`);
    expect(parsed.state).toBe('captions');
    expect(parsed.cues).toEqual([
      { startSeconds: 0, endSeconds: 2.5, text: 'Hello.' },
      { startSeconds: 3, endSeconds: 5, text: 'Second cue\non two lines' },
      { startSeconds: 8, endSeconds: 9, text: 'With an identifier.' },
    ]);
    expect(parsed.skipped).toEqual([
      { cueIndex: 1, reason: 'bad-timing' },
      { cueIndex: 3, reason: 'end-before-start' },
      { cueIndex: 4, reason: 'empty-text' },
    ]);

    // Nothing is ever thrown into the UI: hostile and empty bodies parse to a
    // named verdict or empty cues, never an exception.
    for (const hostile of [
      '',
      'not webvtt at all',
      '\uFEFFWEBVTT',
      'WEBVTT',
      'WEBVTT\r\n\r\n\u0000\u0001 --> \u0002',
      'x'.repeat(10_000),
      'WEBVTT\n\n--> \n',
    ]) {
      const result = parseWebVTT(hostile, `${mediaBase}/transcript.html`);
      expect(['captions', 'captions-failed']).toContain(result.state);
    }
  });

  it('behaviour 20 edge (D06): when captions fail entirely the transcript stays available', () => {
    const transcriptUrl = `${mediaBase}/transcript.html`;

    // Every cue malformed: captions fail, each skip is named, and the
    // transcript is untouched and still available.
    const allBad = parseWebVTT(
      'WEBVTT\n\n??? not a cue\n\n00:00:99.000 --> 00:01:00.000\nx\n',
      transcriptUrl,
    );
    expect(allBad.state).toBe('captions-failed');
    expect(allBad).toMatchObject({ reason: 'no-cues' });
    expect(allBad.skipped).toEqual([
      { cueIndex: 0, reason: 'bad-timing' },
      { cueIndex: 1, reason: 'bad-timing' },
    ]);
    expect(allBad.transcriptAvailable).toBe(true);

    // Not WebVTT at all: the same honest failure, transcript still there.
    const notWebVtt = parseWebVTT('NOTE a comment\n\n00:00:00.000 --> 00:00:01.000\nHi', transcriptUrl);
    expect(notWebVtt.state).toBe('captions-failed');
    expect(notWebVtt).toMatchObject({ reason: 'not-webvtt' });
    expect(notWebVtt.transcriptAvailable).toBe(true);

    // A package without a transcript says so; captions failing never invents
    // or removes one.
    expect(parseWebVTT('WEBVTT\n', null).transcriptAvailable).toBe(false);
  });

  it('F8 (behaviour 20): isWebVttUrl accepts a relative .vtt URL — presence is a path rule, not an absolute-URL rule', () => {
    expect(isWebVttUrl('/captions.vtt')).toBe(true);
    expect(isWebVttUrl('captions.vtt')).toBe(true);
    expect(isWebVttUrl('/captions.vtt?token=abc')).toBe(true);
    // The rule still refuses a URL that does not name WebVTT.
    expect(isWebVttUrl('/captions.html')).toBe(false);
  });

  it('F10 (behaviour 20): the WebVTT signature is exact — WEBVTTX fails not-webvtt while WEBVTT and a noted header pass', () => {
    const transcriptUrl = `${mediaBase}/transcript.html`;
    const cue = '00:00:00.000 --> 00:00:01.000\nHi';

    // The signature is the word WEBVTT and nothing longer.
    const forged = parseWebVTT(`WEBVTTX\n\n${cue}`, transcriptUrl);
    expect(forged.state).toBe('captions-failed');
    expect(forged).toMatchObject({ reason: 'not-webvtt' });

    const plain = parseWebVTT(`WEBVTT\n\n${cue}`, transcriptUrl);
    expect(plain.state).toBe('captions');
    expect(plain.cues).toHaveLength(1);

    const noted = parseWebVTT(`WEBVTT - some note\n\n${cue}`, transcriptUrl);
    expect(noted.state).toBe('captions');
    expect(noted.cues).toHaveLength(1);
  });
});
