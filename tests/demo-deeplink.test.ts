import { describe, expect, it } from 'vitest';
// W0-05b — deep links (behaviour 18) and captions (behaviour 20). Regression
// provenance: this file began as round r1's red suite, committed before
// `src/clients/demo/deeplink.ts` and `src/clients/demo/captions.ts` existed;
// it guards those behaviours now. The captions tests live here because the
// round's file list names exactly two test files.
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
    // Every number the grammar allows but the media duration does not is
    // ignored the same way: no position, no refusal. (A value outside the
    // grammar is bad-fragment — F10's rule, pinned in its own test below.
    // r6 F7 moved the signed literal `#t=-5` out of the grammar entirely —
    // it is bad-fragment now, pinned in the r6 F7 grammar table.)
    for (const hash of ['#t=12', '#t=60']) {
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

// W0-05b-r3 — Apollo's second review of PR #64 (2026-10-26 07:13Z): F9–F11.
describe('demo deep links and captions — W0-05b-r3 (Apollo\'s second review)', () => {
  it('r3 F9 (behaviour 20): isWebVttUrl accepts http(s) and relative URLs only — a javascript: or data: URL is not WebVTT whatever its path ends in', () => {
    // The scheme is part of the rule: a path that ends in .vtt is nothing when
    // the URL runs code or carries a data: body.
    expect(isWebVttUrl('javascript:alert(1)//x.vtt')).toBe(false);
    expect(isWebVttUrl('data:text/vtt;base64,xxx.vtt')).toBe(false);
    // http(s) and the front door's own relative captions are accepted.
    expect(isWebVttUrl('https://x/c.vtt')).toBe(true);
    expect(isWebVttUrl('http://x/c.vtt')).toBe(true);
    expect(isWebVttUrl('/captions.vtt')).toBe(true);
  });

  it('r3 F10 (behaviour 18): the t= value must match the grammar — a number with at most 3 decimals and nothing else; anything else is bad-fragment', () => {
    // A second #, a unit suffix, an empty value, a placeholder, a bare word:
    // anything the grammar does not admit is not our format and is refused —
    // never silently opened at no position.
    for (const hash of [
      '#t=42#foo',
      '#t=42s',
      '#t=',
      '#t=<duration>',
      '#t=abc',
      '#t=Infinity',
      '#t=NaN',
      '#t=1=2',
      '#t= 42',
      '#t=42.5678',
    ]) {
      expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash }, 60)).toEqual({
        kind: 'not-found',
        reason: 'bad-fragment',
      });
    }
    // The grammar (unsigned since r6 F7): digits, at most three decimals.
    // #t=42, #t=42.5 and #t=0 stay valid.
    for (const [hash, position] of [
      ['#t=42', 42],
      ['#t=42.5', 42.5],
      ['#t=0', 0],
    ] as const) {
      expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash }, 60)).toEqual({
        kind: 'player',
        scenarioId: 'teams-01',
        positionSeconds: position,
      });
    }
  });

  it('r3 F11 (behaviour 18): a deep link starts a clip — #t=<duration> is not a start position and the link opens with no position', () => {
    // Two controls, two rules (commented at both sites): the fragment's bound
    // is 0 <= t < duration — a start at the very end is meaningless — while
    // applySeek's bound is 0 <= t <= duration. Out of the fragment's range the
    // value is ignored: never a clamped start, never an error page (the
    // locked `#t=42` on 12 s rule, held identically at t == duration).
    expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash: '#t=42' }, 42)).toEqual({
      kind: 'player',
      scenarioId: 'teams-01',
      positionSeconds: null,
    });
    expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash: '#t=43' }, 42)).toEqual({
      kind: 'player',
      scenarioId: 'teams-01',
      positionSeconds: null,
    });
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
    // NAMED verdict, never an exception — and (r8 F8) the exact verdict and
    // reason are pinned per input, per the parser's actual classification.
    // The reason each input keeps is stated beside it; an unpinned verdict
    // pins nothing.
    for (const [hostile, reason] of [
      // An empty body: there is no signature line at all.
      ['', 'not-webvtt'],
      // The first non-blank line is not a signature.
      ['not webvtt at all', 'not-webvtt'],
      // A tolerated BOM and the signature — and nothing else: no cue block.
      ['\uFEFFWEBVTT', 'no-cues'],
      // The signature alone: the header runs to the end, no cue blocks.
      ['WEBVTT', 'no-cues'],
      // One cue block whose only line matches no timing grammar: bad-timing,
      // and no cue survives.
      ['WEBVTT\r\n\r\n\u0000\u0001 --> \u0002', 'no-cues'],
      // Ten thousand characters that are no signature.
      ['x'.repeat(10_000), 'not-webvtt'],
      // A bare arrow line is no timing line: bad-timing, no cue survives.
      ['WEBVTT\n\n--> \n', 'no-cues'],
    ] as const) {
      expect(() => parseWebVTT(hostile, `${mediaBase}/transcript.html`)).not.toThrow();
      const result = parseWebVTT(hostile, `${mediaBase}/transcript.html`);
      // The exact verdict and the exact reason — per input, nothing looser.
      expect(result).toMatchObject({ state: 'captions-failed', reason });
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

// W0-05b-r4 — the last mile: F7 and F8 (from the 07:32:35Z review) on the
// cue parse. These were the red tests for round r4's fix; they guard the
// regressions now.
describe('demo captions — W0-05b-r4 (Apollo\'s last mile)', () => {
  const transcriptUrl = `${mediaBase}/transcript.html`;

  it('r4 F7 (behaviour 20): a cue whose identifier line contains --> still parses — the timing line is the one matching the timestamp grammar, and a genuinely bad timing block is still skipped', () => {
    const raw = [
      'WEBVTT',
      '',
      'intro --> the run',
      '00:00:08.000 --> 00:00:09.000',
      'With an identifier.',
      '',
      'broken --> block',
      'no timestamp here',
      '',
    ].join('\n');
    const parsed = parseWebVTT(raw, transcriptUrl);
    expect(parsed.state).toBe('captions');
    expect(parsed.cues).toEqual([
      { startSeconds: 8, endSeconds: 9, text: 'With an identifier.' },
    ]);
    // The block with no timestamp-grammar line is still named and skipped.
    expect(parsed.skipped).toEqual([{ cueIndex: 1, reason: 'bad-timing' }]);
  });

  it('r4 F8 (behaviour 20): NOTE, STYLE and REGION blocks are not cues — a file with all three plus two good cues parses to exactly two cues and zero skips', () => {
    const raw = [
      'WEBVTT',
      '',
      'NOTE a reviewer comment --> with an arrow in it',
      'more comment text',
      '',
      'STYLE',
      '::cue { color: yellow }',
      '',
      'REGION',
      'id:fred',
      '',
      '00:00:00.000 --> 00:00:02.500',
      'Hello.',
      '',
      '00:00:03.000 --> 00:00:05.000',
      'Second cue',
      '',
    ].join('\n');
    const parsed = parseWebVTT(raw, transcriptUrl);
    expect(parsed.state).toBe('captions');
    expect(parsed.cues).toEqual([
      { startSeconds: 0, endSeconds: 2.5, text: 'Hello.' },
      { startSeconds: 3, endSeconds: 5, text: 'Second cue' },
    ]);
    // Non-cue blocks appear neither in cues nor in skipped.
    expect(parsed.skipped).toEqual([]);
  });

  it('r4 F8 (behaviour 20): a block that merely starts with NOTE-looking text is judged by its own shape — NOTEPAD with timing is a cue, NOTEPAD without timing is a bad-timing skip', () => {
    const raw = [
      'WEBVTT',
      '',
      'NOTEPAD --> notes, not a note block',
      '00:00:01.000 --> 00:00:02.000',
      'Visible text',
      '',
      'NOTE a real comment',
      '',
      'NOTEPAD',
      'no timing at all',
      '',
    ].join('\n');
    const parsed = parseWebVTT(raw, transcriptUrl);
    expect(parsed.state).toBe('captions');
    // NOTEPAD is not NOTE: the block is a cue block and parses as its own
    // shape says — the arrow in its identifier is not its timing line (F7).
    expect(parsed.cues).toEqual([
      { startSeconds: 1, endSeconds: 2, text: 'Visible text' },
    ]);
    // The real NOTE consumes no cue index: skips are numbered among the
    // file's cue blocks only.
    expect(parsed.skipped).toEqual([{ cueIndex: 1, reason: 'bad-timing' }]);
  });

  it('r4 F8 (behaviour 20): a bare NOTE block is a note even when it carries timing, and a NOTE in the header region is part of the header', () => {
    // Header region: WEBVTT followed by a NOTE before the first blank line is
    // header metadata — not a block at all.
    const headerNote = parseWebVTT(
      ['WEBVTT', 'NOTE header metadata --> not a block', '', '00:00:00.000 --> 00:00:01.000', 'Hi', ''].join(
        '\n',
      ),
      transcriptUrl,
    );
    expect(headerNote.state).toBe('captions');
    expect(headerNote.cues).toEqual([{ startSeconds: 0, endSeconds: 1, text: 'Hi' }]);
    expect(headerNote.skipped).toEqual([]);

    // The bare keyword followed by end-of-line starts a note per the WebVTT
    // grammar — the whole block is a comment, timing line included.
    const bareNote = parseWebVTT(
      [
        'WEBVTT',
        '',
        'NOTE',
        '00:00:00.000 --> 00:00:01.000',
        'Hidden text',
        '',
        '00:00:02.000 --> 00:00:03.000',
        'Kept',
        '',
      ].join('\n'),
      transcriptUrl,
    );
    expect(bareNote.state).toBe('captions');
    expect(bareNote.cues).toEqual([{ startSeconds: 2, endSeconds: 3, text: 'Kept' }]);
    expect(bareNote.skipped).toEqual([]);
  });
});

// W0-05b-r5 — Apollo's review of the r4 head: F2 on the cue parse — the
// 'unreadable' verdict is the "nothing is ever thrown into the UI" contract
// and must hold for every shape, not only for typed strings. These are the
// red tests for round r5's fix; they guard the regression.
describe('demo captions — W0-05b-r5 (Apollo\'s review of the r4 head)', () => {
  const transcriptUrl = `${mediaBase}/transcript.html`;

  it("r5 F2 (behaviour 20): an unreadable body is a named verdict, never a throw — null, undefined, a number and an object all return captions-failed with reason 'unreadable'", () => {
    const unreadable: readonly string[] = [
      null as unknown as string,
      undefined as unknown as string,
      42 as unknown as string,
      { toString: () => 'WEBVTT' } as unknown as string,
    ];
    for (const raw of unreadable) {
      expect(() => parseWebVTT(raw, transcriptUrl)).not.toThrow();
      const parsed = parseWebVTT(raw, transcriptUrl);
      expect(parsed).toMatchObject({ state: 'captions-failed', reason: 'unreadable' });
      expect(parsed.cues).toEqual([]);
      expect(parsed.skipped).toEqual([]);
      // A captions failure never takes the transcript down with it.
      expect(parsed.transcriptAvailable).toBe(true);
    }
  });
});

// W0-05b-r6 — Apollo's review of the r5 head (2026-10-26 11:10:58Z): F6 (a
// protocol-relative `//host/x.vtt` is not a relative path) and F7 (the
// fragment grammar is unsigned — the r3 grammar's sign extension is gone).
// These were the red tests for round r6's fix; they guard the regressions.
describe("demo deep links and captions — W0-05b-r6 (Apollo's review of the r5 head)", () => {
  it('r6 F6 (behaviour 20): isWebVttUrl rejects a scheme-relative // reference — a leading // is neither http(s) nor a relative path', () => {
    // A leading `//` is a scheme-relative absolute reference: the scheme rule
    // applies to it, and it names another host's captions.
    expect(isWebVttUrl('//evil.example/x.vtt')).toBe(false);
    expect(isWebVttUrl('//evil.example/x.vtt?token=abc')).toBe(false);
    expect(isWebVttUrl('//captions.vtt')).toBe(false);
    // The rest of the rule stands: http(s) and the front door's own relative
    // captions are accepted exactly as before.
    expect(isWebVttUrl('/captions.vtt')).toBe(true);
    expect(isWebVttUrl('captions.vtt')).toBe(true);
    expect(isWebVttUrl('https://x/c.vtt')).toBe(true);
    expect(isWebVttUrl('http://x/c.vtt')).toBe(true);
  });

  it('r6 F7 (behaviour 18): the t= grammar is unsigned — the pinned grammar table', () => {
    // A signed literal is outside the grammar entirely: `#t=+42`, `#t=-5`
    // and `#t=+0` are bad-fragment. This deliberately reverses the r3 pin
    // that had `#t=-5` ignored — a signed literal is not our format now.
    for (const hash of ['#t=+42', '#t=-5', '#t=+0', '#t=-0']) {
      expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash }, 60)).toEqual({
        kind: 'not-found',
        reason: 'bad-fragment',
      });
    }
    // Unsigned literals stay valid: the number, at most three decimals.
    for (const [hash, position] of [
      ['#t=42', 42],
      ['#t=0', 0],
      ['#t=42.5', 42.5],
      ['#t=42.500', 42.5],
    ] as const) {
      expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash }, 60)).toEqual({
        kind: 'player',
        scenarioId: 'teams-01',
        positionSeconds: position,
      });
    }
    // The three-decimal rule is untouched: a fourth decimal is bad-fragment.
    expect(
      parseDemoDeepLink({ pathname: '/engines/teams-01', hash: '#t=42.5000' }, 60),
    ).toEqual({ kind: 'not-found', reason: 'bad-fragment' });
    // An out-of-range unsigned value stays ignored — the locked rule is
    // untouched: the link opens the player at no position, never clamped to
    // the end, never an error page.
    for (const hash of ['#t=60', '#t=99']) {
      expect(parseDemoDeepLink({ pathname: '/engines/teams-01', hash }, 60)).toEqual({
        kind: 'player',
        scenarioId: 'teams-01',
        positionSeconds: null,
      });
    }
  });
});

// W0-05b-r7 — Apollo's review of the r6 head (2026-10-26 12:24:28Z): F2 and
// F3(b). F2 is a security-guard bypass — the `//` guard in isWebVttUrl could
// be skipped with backslashes, which browsers read as `/`. F3 pins the
// zero-length-cue boundary of the parse rule. These were the red tests for
// round r7's fix (F2 red-first; F3 tests-only); they guard the regressions
// now.
describe("demo captions — W0-05b-r7 (Apollo's review of the r6 head)", () => {
  it('r7 F2 (behaviour 20): isWebVttUrl reads backslashes the way browsers do — the backslash spellings of a scheme-relative URL are refused, a Windows relative path still reads', () => {
    // A browser normalises `\` to `/` before it resolves, so
    // `\evil.example/x.vtt` and `/\evil.example/x.vtt` resolve to
    // `//evil.example/x.vtt` — a protocol-relative absolute reference naming
    // another host, exactly what F9/F6's guard exists to refuse. The guard
    // now normalises first, so the existing rules see the browser's own
    // reading of the string.
    expect(isWebVttUrl('\\\\evil.example/x.vtt')).toBe(false);
    expect(isWebVttUrl('/\\evil.example/x.vtt')).toBe(false);
    expect(isWebVttUrl('//evil.example/x.vtt')).toBe(false);
    // Decision pinned (r7 F2 asks for one): cross-origin http(s) is
    // accepted — the rule is that the URL names WebVTT wherever it points,
    // and `https://x/c.vtt` stays pinned true. After normalisation
    // `https:\\evil.example\x.vtt` is an ordinary absolute https URL
    // (`https://evil.example/x.vtt`) — not a protocol-relative disguise —
    // and is accepted like any other http(s) .vtt URL.
    expect(isWebVttUrl('https:\\\\evil.example\\x.vtt')).toBe(true);
    // The pinned positives stand unchanged.
    expect(isWebVttUrl('captions.vtt')).toBe(true);
    expect(isWebVttUrl('/captions.vtt')).toBe(true);
    expect(isWebVttUrl('https://x/c.vtt')).toBe(true);
    expect(isWebVttUrl('https://x/c.vtt?x=1#f')).toBe(true);
    // A genuine Windows-style relative path is still the front door's own
    // captions (`.\captions.vtt` → `./captions.vtt` after normalisation):
    // the guard refuses scheme-relative absolutes, not odd relative
    // spellings.
    expect(isWebVttUrl('.\\captions.vtt')).toBe(true);
  });

  it('r7 F3 (behaviour 20): a zero-length cue is a cue — end === start parses; end < start is still end-before-start', () => {
    // Both sides of the rule's boundary, pinned so it cannot drift either
    // way: the parse rejects only `end < start`.
    const raw = [
      'WEBVTT',
      '',
      '00:00:03.000 --> 00:00:03.000',
      'A zero-length cue.',
      '',
      '00:00:05.000 --> 00:00:04.000',
      'Backwards.',
      '',
    ].join('\n');
    const parsed = parseWebVTT(raw, `${mediaBase}/transcript.html`);
    expect(parsed.state).toBe('captions');
    expect(parsed.cues).toEqual([{ startSeconds: 3, endSeconds: 3, text: 'A zero-length cue.' }]);
    expect(parsed.skipped).toEqual([{ cueIndex: 1, reason: 'end-before-start' }]);
  });
});

// W0-05b-r8 — Apollo's review of the r7 head (2026-10-26 13:17:35Z). F2 is a
// security gap: one leading whitespace/C0 character skipped the `//`
// refusal — `' //evil.example/x.vtt'` and `'\t//evil.example/x.vtt'` slipped
// past `startsWith('//')`, `new URL()` threw on the scheme-relative input,
// and the catch returned the relative-path answer. The fix is structural —
// strip, then normalise, then discriminate — so no decoration of the
// blacklist target can win. F5 is the honesty fix on the parse: a shape
// guard decides untrusted shapes BEFORE the parse and the pure parse runs
// without a blanket catch. F2 and F5 were red-first; F8's exact verdicts
// were strengthened in place above (tests-only).
describe("demo deep links and captions — W0-05b-r8 (Apollo's review of the r7 head)", () => {
  const transcriptUrl = `${mediaBase}/transcript.html`;

  it('r8 F2 (behaviour 20): isWebVttUrl refuses the whole variant table of a scheme-relative //evil.example/x.vtt — no decoration survives the strip and the backslash normalisation', () => {
    // The whole variant table, pinned. Every spelling below a browser
    // resolves to `https://evil.example/x.vtt` (or to a foreign scheme) is
    // refused. Where the review quotes a backslash spelling, BOTH literal
    // readings are pinned — the spelling as JS source and the spelling as
    // raw characters (the review escapes control characters but writes
    // visible backslashes as they stand).
    for (const disguised of [
      ' //evil.example/x.vtt', // a leading space (the review's spelling)
      '\t//evil.example/x.vtt', // a leading tab (the review's spelling)
      '\u0000//evil.example/x.vtt', // a leading C0 control (the review's spelling)
      '//evil.example/x.vtt', // plain scheme-relative (the review's spelling)
      '\\\\evil.example/x.vtt', // "'\\\\evil.example/x.vtt'" as JS source — two literal backslashes
      '\\\\\\\\evil.example/x.vtt', // "'\\\\evil.example/x.vtt'" as raw characters — four literal backslashes
      '/\\evil.example/x.vtt', // "'/\\evil.example/x.vtt'" as JS source — slash + one literal backslash
      '/\\\\evil.example/x.vtt', // "'/\\evil.example/x.vtt'" as raw characters — slash + two literal backslashes
      'javascript:alert(1)//x.vtt', // the review's spelling
      'data:text/vtt;base64,xxx.vtt', // the review's spelling
      'JavaScript:alert(1)//x.vtt', // the review's spelling — the scheme rule is case-insensitive
      // A value that needs BOTH operations (the review's
      // "'\t\\\\evil.example/x.vtt'"): the strip leads — without it the tab
      // is not a `//` lead — and the normalisation then makes the `//`.
      '\t\\\\\\\\evil.example/x.vtt', // as raw characters — tab + four literal backslashes
      '\t\\\\evil.example/x.vtt', // as JS source — tab + two literal backslashes
    ]) {
      expect(isWebVttUrl(disguised)).toBe(false);
    }
  });

  it("r8 F2 boundary calls (behaviour 20): 'C:/captions.vtt' is refused — an opaque scheme-like prefix is not a relative path — and '/captions.vtt ' is accepted — it stripped to a clean relative path", () => {
    expect(isWebVttUrl('C:/captions.vtt')).toBe(false);
    expect(isWebVttUrl('/captions.vtt ')).toBe(true);
    // The accepted side of the rule, pinned with them: the front door's own
    // relative captions and http(s) wherever it points.
    for (const own of [
      'captions.vtt',
      './captions.vtt',
      '/captions.vtt',
      'https://x/c.vtt',
      'HTTPS://x/c.vtt',
      'http://x/c.vtt',
    ]) {
      expect(isWebVttUrl(own)).toBe(true);
    }
    // Stated boundary (the review's "'\\evil.example/x.vtt'" read as ONE
    // literal backslash): a single leading `\` is one `/` to a browser —
    // `new URL('\\evil.example/x.vtt', base)` resolves same-origin, to
    // `https://media.example.com/evil.example/x.vtt` — so the value is
    // `/evil.example/x.vtt`, the front door's OWN root-relative path, exactly
    // the class pinned-accepted `'/captions.vtt'` belongs to. It is not a
    // variant of the scheme-relative attack (two or more leading backslashes,
    // or a `/` among them, are), and refusing it would need a blacklist on
    // path content — the structural order cannot carry one.
    expect(isWebVttUrl('\\evil.example/x.vtt')).toBe(true);
  });

  it("r8 F5 (behaviour 20): the shape guard decides untrusted shapes before the parse — a string-imitating impostor never reaches the parser and still returns 'unreadable'", () => {
    // The r5 non-string cases keep their verdict — they now hit the guard at
    // the top of the function, not a blanket catch around the parse.
    for (const raw of [null, undefined, 42, { toString: () => 'WEBVTT' }]) {
      expect(parseWebVTT(raw as unknown as string, transcriptUrl)).toEqual({
        state: 'captions-failed',
        reason: 'unreadable',
        cues: [],
        skipped: [],
        transcriptAvailable: true,
      });
    }

    // An impostor that imitates a string well enough to be parsed — replace
    // returning itself, split returning fabricated cue lines — is decided by
    // the shape guard BEFORE the parse: its methods are never called and no
    // fabricated cue is ever produced.
    const touched: string[] = [];
    const impostor = {
      replace: (): unknown => {
        touched.push('replace');
        return impostor;
      },
      split: (): string[] => {
        touched.push('split');
        return ['WEBVTT', '', '00:00:00.000 --> 00:00:01.000', 'Fabricated'];
      },
    };
    expect(parseWebVTT(impostor as unknown as string, transcriptUrl)).toEqual({
      state: 'captions-failed',
      reason: 'unreadable',
      cues: [],
      skipped: [],
      transcriptAvailable: true,
    });
    expect(touched).toEqual([]);

    // A string of only C0 controls IS a string: it reaches the parse and gets
    // a named verdict, never a throw.
    expect(() => parseWebVTT('\u0000\u0001', transcriptUrl)).not.toThrow();
    expect(parseWebVTT('\u0000\u0001', transcriptUrl)).toMatchObject({
      state: 'captions-failed',
      reason: 'not-webvtt',
    });
  });
});

// W0-05b-r9 — Apollo's review of the r8 head (2026-10-26 15:11:39Z). F1 is
// the third disguise of the same guard and this round closes the class: the
// normalisation is no longer a blacklist of decorations, it is the URL
// parser's own steps in the parser's own order. WHATWG "basic URL parser"
// removes ALL ASCII tab or newline from anywhere in the input BEFORE it
// parses anything, then removes leading/trailing C0 control or space, and
// reads `\` as `/` in special schemes — so `'java\tscript:...'`,
// `'/\t/evil.example/x.vtt'` and their newline spellings are the SAME URL to
// every browser as the plain refused ones. Any spelling that survives this
// normalisation is the same URL to every browser, so no decoration of a
// refused shape can ever win the race to the discrimination again.
describe("demo deep links and captions — W0-05b-r9 (Apollo's review of the r8 head)", () => {
  it('r9 F1 (behaviour 20): isWebVttUrl removes tab and newline the way the URL parser does — every spelling of a foreign scheme or a scheme-relative host split by a tab or newline is refused', () => {
    for (const disguised of [
      // The r8 variant table, unchanged — every row still refused.
      ' //evil.example/x.vtt', // a leading space
      '\t//evil.example/x.vtt', // a leading tab
      '\u0000//evil.example/x.vtt', // a leading C0 control
      '//evil.example/x.vtt', // plain scheme-relative
      '\\\\evil.example/x.vtt', // as JS source — two literal backslashes
      '\\\\\\\\evil.example/x.vtt', // as raw characters — four literal backslashes
      '/\\evil.example/x.vtt', // as JS source — slash + one literal backslash
      '/\\\\evil.example/x.vtt', // as raw characters — slash + two literal backslashes
      'javascript:alert(1)//x.vtt',
      'data:text/vtt;base64,xxx.vtt',
      'JavaScript:alert(1)//x.vtt', // the scheme rule is case-insensitive
      '\t\\\\\\\\evil.example/x.vtt', // as raw characters — tab + four literal backslashes
      '\t\\\\evil.example/x.vtt', // as JS source — tab + two literal backslashes

      // r9 F1, the review's spellings: one tab or newline INSIDE the string.
      // The r8 strip never touched the middle, `SCHEME_PREFIX` stopped at the
      // tab and the value fell to the relative branch — ACCEPTED with `.vtt`,
      // while every browser removes the tab/newline first and reads
      // `javascript:` / `data:` / `//evil.example`.
      'java\tscript:alert(1)//x.vtt', // the review's spelling
      'java\nscript:alert(1)//x.vtt', // the review's spelling
      'java\rscript:alert(1)//x.vtt', // the parser removes \r with the rest
      'javascript\t:alert(1)//x.vtt', // the tab between the scheme and the colon
      'da\tta:text/vtt;base64,xxx.vtt', // the review's spelling
      '/\t/evil.example/x.vtt', // the review's spelling — the tab splitting the `//` lead
      '/\r\n/evil.example/x.vtt', // the same with the other two removed characters

      // The edge that needs ALL THREE parser steps — tab/newline removal,
      // the C0/space edge strip, and the backslash-as-slash — in both
      // literal readings of the review's "'\t\\\\\t//evil.example/x.vtt'":
      '\t\\\\\t//evil.example/x.vtt', // as JS source — tab + two literal backslashes + tab
      '\t\\\\\\\\\t//evil.example/x.vtt', // as raw characters — tab + four literal backslashes + tab
      // ... and one spelling where each step must fire on its own part: a
      // leading C0/space (step 2), interior tabs (step 1) and backslashes
      // (step 3) sitting between the `/` and the host. Without any one of
      // the three the value slips to the relative branch and is accepted.
      ' \t/\t\\\\/evil.example/x.vtt',
    ]) {
      expect(isWebVttUrl(disguised)).toBe(false);
    }
  });

  it("r9 F1 boundary calls (behaviour 20): 'C:/captions.vtt' is still refused and '/captions.vtt ' still accepted — and the one-literal-backslash reading of the review's '\\t\\\\evil.example/x.vtt' is r8's pinned boundary spelling, the same URL to every browser", () => {
    expect(isWebVttUrl('C:/captions.vtt')).toBe(false);
    expect(isWebVttUrl('/captions.vtt ')).toBe(true);
    // The accepted side of the rule, pinned with them: the front door's own
    // relative captions and http(s) wherever it points.
    for (const own of [
      'captions.vtt',
      './captions.vtt',
      '/captions.vtt',
      'https://x/c.vtt',
      'HTTPS://x/c.vtt',
      'http://x/c.vtt',
    ]) {
      expect(isWebVttUrl(own)).toBe(true);
    }
    // Stated boundary (r8's row, with the review's leading tab). The review's
    // "'\t\\evil.example/x.vtt'" read as ONE literal backslash (as JS source)
    // is the SAME URL to every browser as r8's pinned-accepted
    // "'\\evil.example/x.vtt'": the parser removes the tab first, and what
    // survives is one leading `/` — `/evil.example/x.vtt`, the front door's
    // own root-relative path, same-origin. This round's own claim is the
    // rule — any spelling that survives the normalisation is the same URL to
    // every browser — so it keeps the same, accepted verdict; refusing it
    // would need a blacklist on path content, which the structural order
    // cannot carry. The raw reading of the review's spelling (tab + two
    // literal backslashes) IS refused above: it normalises to
    // `//evil.example/x.vtt`.
    expect(isWebVttUrl('\\evil.example/x.vtt')).toBe(true);
    expect(isWebVttUrl('\t\\evil.example/x.vtt')).toBe(true);
  });
});
