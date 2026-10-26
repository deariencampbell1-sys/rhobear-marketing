import { describe, expect, it } from 'vitest';
// The source scan imports the modules as text via vite's ?raw loader — the
// repo has no @types/node, so no node: imports anywhere in these files.
import schemaSource from '../src/clients/demo/schema.ts?raw';
import resolveSource from '../src/clients/demo/resolve.ts?raw';
import indexSource from '../src/clients/demo/index.ts?raw';
// W0-05a — publication state → presentation. Every fixture is a contract-
// complete package body whose contentHash really is the sha256 of the body
// with the contentHash key removed (a digest cannot cover itself), so the
// resolver's hash gate only fires when a test tampers on purpose. Fixed clock
// via `now`; the network is a stub FetchLike — no real request is ever made.
import { type ScenarioRegistry } from '../src/clients/demo/schema';
import {
  buildEnginesIndex,
  createDemoResolver,
  createMemoryDemoCache,
  type DemoCache,
  type DemoPresentation,
  type FetchLike,
} from '../src/clients/demo/resolve';

/** The same digest the resolver computes, via the platform's Web Crypto. */
const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
};

const SOURCE_REVISION = 'a'.repeat(40);
const PACKAGE_REVISION = 'rev-2026-10-25-1';
const SCENARIO_ID = 'teams-01'; // a board scenario id
const UNLISTED_ID = 'unlisted-99'; // deliberately not in the registry below
const MIRROR = 'https://site.example';
const mediaBase = (scenarioId: string) =>
  `https://media.example.com/demos/${scenarioId}/${PACKAGE_REVISION}`;

/**
 * A serialized contract-complete package. `contentHash` is computed over the
 * body with the contentHash key removed, exactly as the resolver verifies it.
 */
async function rawPackage(
  patch: Record<string, unknown> = {},
  scenarioId: string = SCENARIO_ID,
): Promise<string> {
  const base = mediaBase(scenarioId);
  const body: Record<string, unknown> = {
    schema: 'rhobear.demo-package.v1',
    engineOrProduct: 'teams',
    scenarioId,
    packageRevision: PACKAGE_REVISION,
    publicationState: 'approved',
    sourceApp: 'capturd',
    sourceRevision: SOURCE_REVISION,
    renditions: [
      {
        url: `${base}/clip-720.mp4`,
        mime: 'video/mp4',
        width: 1280,
        height: 720,
        durationSeconds: 42,
        chapters: [{ label: 'Intro', startSeconds: 0 }],
      },
    ],
    posterUrl: `${base}/poster.png`,
    captionsUrl: `${base}/captions.vtt`,
    transcriptUrl: `${base}/transcript.html`,
    evidence: { runIds: ['run-1'], logs: [], artifactHashes: ['c'.repeat(64)] },
    approval: { approvedBy: 'Owner', approvedAt: '2026-10-25T12:00:00Z', watchedComplete: true },
    immutableUrls: true,
    ...patch,
  };
  const contentHash = await sha256Hex(JSON.stringify(body));
  return JSON.stringify({ ...body, contentHash });
}

/** A stub mirror keyed by pathname; records every requested URL. */
function mirror(bodies: Record<string, string>) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const body = bodies[new URL(url).pathname];
    if (body === undefined) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetchImpl, urls };
}

const offlineFetch: FetchLike = async () => {
  throw new TypeError('network unreachable');
};

type Playable = Extract<DemoPresentation, { state: 'playable' }>;

function expectPlayable(presentation: DemoPresentation): Playable {
  if (presentation.state !== 'playable') throw new Error(`expected playable, got ${presentation.state}`);
  return presentation;
}

describe('demo resolve', () => {
  it('plays an approved package from the mirror, with captions and transcript surfaced', async () => {
    const { fetchImpl } = mirror({ [`/demos/${SCENARIO_ID}.json`]: await rawPackage() });
    const resolver = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl });
    const playable = expectPlayable(await resolver.resolve(SCENARIO_ID));
    expect(playable.source).toBe('network');
    expect(playable.scenarioId).toBe(SCENARIO_ID);
    expect(playable.packageRevision).toBe(PACKAGE_REVISION);
    expect(playable.sourceRevision).toBe(SOURCE_REVISION);
    expect(playable.media.renditions[0]?.url).toBe(`${mediaBase(SCENARIO_ID)}/clip-720.mp4`);
    expect(playable.media.posterUrl).toBe(`${mediaBase(SCENARIO_ID)}/poster.png`);
    expect(playable.captionsUrl).toBe(`${mediaBase(SCENARIO_ID)}/captions.vtt`);
    expect(playable.transcriptUrl).toBe(`${mediaBase(SCENARIO_ID)}/transcript.html`);
  });

  it('a schema-invalid package is refused with a named reason and no playable media', async () => {
    const wrongMime = await rawPackage({
      renditions: [
        {
          url: `${mediaBase(SCENARIO_ID)}/clip-720.mp4`,
          mime: 'video/webm',
          width: 1280,
          height: 720,
          durationSeconds: 42,
          chapters: [],
        },
      ],
    });
    const cache = createMemoryDemoCache();
    const { fetchImpl } = mirror({ [`/demos/${SCENARIO_ID}.json`]: wrongMime });
    const resolver = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl, cache });
    // Exact-shape equality: an invalid presentation carries a reason and
    // nothing else — no URL, no rendition, nothing a screen could play.
    expect(await resolver.resolve(SCENARIO_ID)).toEqual({ state: 'invalid', reason: 'bad-rendition' });
    expect(cache.get(SCENARIO_ID)).toBeUndefined();
  });

  it('a package whose contentHash does not match the fetched body is refused, and never cached', async () => {
    const body = await rawPackage();
    const tampered = JSON.stringify({ ...JSON.parse(body), renditions: [] });
    const cache = createMemoryDemoCache();
    const { fetchImpl } = mirror({ [`/demos/${SCENARIO_ID}.json`]: tampered });
    const resolver = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl, cache });
    expect(await resolver.resolve(SCENARIO_ID)).toEqual({ state: 'invalid', reason: 'hash-mismatch' });
    expect(cache.get(SCENARIO_ID)).toBeUndefined();
  });

  it('publication state maps to presentation: pending shows footage-pending, superseded never plays the old URL, revoked stops playback but keeps the transcript', async () => {
    const bodies = {
      [`/demos/pending.json`]: await rawPackage({ publicationState: 'pending' }, 'pending'),
      [`/demos/superseded.json`]: await rawPackage({ publicationState: 'superseded' }, 'superseded'),
      [`/demos/revoked.json`]: await rawPackage({ publicationState: 'revoked' }, 'revoked'),
    };
    const { fetchImpl } = mirror(bodies);
    const resolver = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl });
    // pending → the locked footage-pending copy, and nothing renderable.
    expect(await resolver.resolve('pending')).toEqual({
      state: 'footage-pending',
      reason: 'footage-pending',
    });
    // superseded → a named state with no media at all: the old URL never plays.
    expect(await resolver.resolve('superseded')).toEqual({ state: 'superseded', reason: 'superseded' });
    // revoked → playback stops, the transcript stays readable.
    expect(await resolver.resolve('revoked')).toEqual({
      state: 'revoked',
      reason: 'revoked',
      transcriptUrl: `${mediaBase('revoked')}/transcript.html`,
      purgeCached: true,
    });
  });

  it('an approved package without both captions and a transcript is refused, never half-rendered', async () => {
    const { fetchImpl } = mirror({
      [`/demos/neither.json`]: await rawPackage({ captionsUrl: null, transcriptUrl: null }, 'neither'),
      [`/demos/captions-only.json`]: await rawPackage({ transcriptUrl: null }, 'captions-only'),
      [`/demos/transcript-only.json`]: await rawPackage({ captionsUrl: null }, 'transcript-only'),
    });
    const resolver = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl });
    for (const scenarioId of ['neither', 'captions-only', 'transcript-only']) {
      expect(await resolver.resolve(scenarioId)).toEqual({
        state: 'invalid',
        reason: 'captions-required',
      });
    }
  });

  it('an approved package that was not fully watched, has no named approver or has no approval time is refused', async () => {
    const approvedAt = '2026-10-25T12:00:00Z';
    const { fetchImpl } = mirror({
      [`/demos/unwatched.json`]: await rawPackage(
        { approval: { approvedBy: 'Owner', approvedAt, watchedComplete: false } },
        'unwatched',
      ),
      [`/demos/no-approver.json`]: await rawPackage(
        { approval: { approvedBy: '', approvedAt, watchedComplete: true } },
        'no-approver',
      ),
      [`/demos/no-approved-at.json`]: await rawPackage(
        { approval: { approvedBy: 'Owner', approvedAt: 'not-a-date', watchedComplete: true } },
        'no-approved-at',
      ),
    });
    const resolver = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl });
    for (const scenarioId of ['unwatched', 'no-approver', 'no-approved-at']) {
      expect(await resolver.resolve(scenarioId)).toEqual({
        state: 'invalid',
        reason: 'approval-incomplete',
      });
    }
  });

  it('a revoked package, even cached, never plays and its cache entry is marked for purge', async () => {
    const inner = createMemoryDemoCache();
    const purged: string[] = [];
    const cache: DemoCache = {
      get: (scenarioId) => inner.get(scenarioId),
      put: (scenarioId, entry) => inner.put(scenarioId, entry),
      markForPurge: (scenarioId) => {
        purged.push(scenarioId);
        inner.markForPurge(scenarioId);
      },
    };
    const { fetchImpl } = mirror({
      [`/demos/${SCENARIO_ID}.json`]: await rawPackage({ publicationState: 'revoked' }),
    });
    const resolver = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl, cache });
    expect(await resolver.resolve(SCENARIO_ID)).toEqual({
      state: 'revoked',
      reason: 'revoked',
      transcriptUrl: `${mediaBase(SCENARIO_ID)}/transcript.html`,
      purgeCached: true,
    });
    expect(purged).toEqual([SCENARIO_ID]);
  });

  it('an approved cached package plays offline, with its revision and fetch time surfaced', async () => {
    let t = 1_000;
    const now = (): number => t;
    const cache = createMemoryDemoCache();
    const { fetchImpl } = mirror({ [`/demos/${SCENARIO_ID}.json`]: await rawPackage() });
    const online = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl, now, cache });
    const first = expectPlayable(await online.resolve(SCENARIO_ID));
    expect(first.source).toBe('network');
    expect(first.fetchedAt).toBe(1_000);
    t = 2_000;
    const offline = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl: offlineFetch, now, cache });
    const second = expectPlayable(await offline.resolve(SCENARIO_ID));
    expect(second.source).toBe('cache');
    expect(second.fetchedAt).toBe(1_000); // the original fetch time, not now
    expect(second.packageRevision).toBe(PACKAGE_REVISION);
    expect(second.media.renditions[0]?.url).toBe(`${mediaBase(SCENARIO_ID)}/clip-720.mp4`);
  });

  it('a cached revoked package still never plays offline', async () => {
    const cache = createMemoryDemoCache();
    const { fetchImpl } = mirror({
      [`/demos/${SCENARIO_ID}.json`]: await rawPackage({ publicationState: 'revoked' }),
    });
    const online = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl, cache });
    expect((await online.resolve(SCENARIO_ID)).state).toBe('revoked');
    const offline = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl: offlineFetch, cache });
    // The cache knows why playback stopped; it does not resurrect the media.
    expect(await offline.resolve(SCENARIO_ID)).toEqual({
      state: 'revoked',
      reason: 'revoked',
      transcriptUrl: `${mediaBase(SCENARIO_ID)}/transcript.html`,
      purgeCached: true,
    });
    expect(cache.isMarkedForPurge(SCENARIO_ID)).toBe(true);
  });

  it('no module in src/clients/demo/** references a placeholder video file — there is no fallback media in any state', () => {
    const sources = [schemaSource, resolveSource, indexSource].join('\n');
    expect(sources).not.toMatch(/\.(mp4|webm|mov|m4v|ogv)\b/i);
    expect(sources).not.toMatch(/data:video|blob:/i);
  });

  it('with no mirror configured, resolve returns footage-pending and never touches the network', async () => {
    const { fetchImpl, urls } = mirror({});
    const resolver = createDemoResolver({ fetchImpl });
    expect(await resolver.resolve(SCENARIO_ID)).toEqual({
      state: 'footage-pending',
      reason: 'footage-pending',
    });
    expect(urls).toEqual([]);
  });

  it('the manifest URL comes from the configured mirror as /demos/<scenarioId>.json, and an unpublished scenario is footage-pending', async () => {
    const { fetchImpl, urls } = mirror({});
    const resolver = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl });
    expect(await resolver.resolve(SCENARIO_ID)).toEqual({
      state: 'footage-pending',
      reason: 'footage-pending',
    });
    expect(urls).toEqual([`${MIRROR}/demos/${SCENARIO_ID}.json`]);
  });

  it('a manifest with no registry entry is unlisted: playable by deep link, absent from the index, never silently dropped', async () => {
    const { fetchImpl } = mirror({
      [`/demos/${SCENARIO_ID}.json`]: await rawPackage(),
      [`/demos/${UNLISTED_ID}.json`]: await rawPackage({}, UNLISTED_ID),
    });
    const resolver = createDemoResolver({ mirrorUrl: MIRROR, fetchImpl });
    // Playable by deep link: resolve() never consults the registry.
    const unlisted = expectPlayable(await resolver.resolve(UNLISTED_ID));
    expect(unlisted.scenarioId).toBe(UNLISTED_ID);
    // Absent from the index, but named — not dropped.
    const registry: ScenarioRegistry = [
      {
        scenarioId: 'vision-01',
        engine: 'vision',
        title: 'Vision',
        oneLiner: 'One honest line.',
        posterAlt: 'Vision demo poster',
        order: 1,
      },
      {
        scenarioId: SCENARIO_ID,
        engine: 'teams',
        title: 'Teams',
        oneLiner: 'One honest line.',
        posterAlt: 'Teams demo poster',
        order: 2,
      },
    ];
    const index = buildEnginesIndex(registry, [SCENARIO_ID, UNLISTED_ID, 'vision-01']);
    expect(index.rows.map((row) => row.scenarioId)).toEqual(['vision-01', SCENARIO_ID]);
    expect(index.unlisted).toEqual([UNLISTED_ID]);
  });
});
