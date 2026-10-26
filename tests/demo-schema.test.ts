import { describe, expect, it } from 'vitest';
// W0-05a — the wire schema and the scenario registry. One fixture built field
// by field from the lane contract §4; each refusal feeds exactly one violation
// so the returned problem code is unambiguous. Fixed strings only — no clocks,
// no network, no schema library: the house style of src/clients/money/schema.ts
// and src/clients/release/schema.ts.
import {
  DEMO_PACKAGE_SCHEMA,
  KNOWN_SCENARIO_IDS,
  parseDemoPackage,
  parseScenarioRegistry,
  type DemoProblem,
} from '../src/clients/demo/schema';
import { createDemoResolver, type FetchLike } from '../src/clients/demo/resolve';
// The id-set test compares the client's table against the registry itself —
// the registry is imported, never duplicated.
import { engineScenarios, engines } from '../src/data/engines';
// Source assertions in the repo's ?raw style (see tests/demo-resolve.test.ts).
import schemaSource from '../src/clients/demo/schema.ts?raw';
import resolveSource from '../src/clients/demo/resolve.ts?raw';
import indexSource from '../src/clients/demo/index.ts?raw';

const SOURCE_REVISION = 'a'.repeat(40); // 40 hex, as the contract requires
const PACKAGE_REVISION = 'rev-2026-10-25-1';
const SCENARIO_ID = 'teams-01'; // a board scenario id, never an invented one
const BASE = `https://media.example.com/demos/${SCENARIO_ID}/${PACKAGE_REVISION}`;

/** A contract-complete package body; overrides replace one field at a time. */
function wellFormed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: DEMO_PACKAGE_SCHEMA,
    engineOrProduct: 'teams',
    scenarioId: SCENARIO_ID,
    packageRevision: PACKAGE_REVISION,
    publicationState: 'approved',
    sourceApp: 'capturd',
    sourceRevision: SOURCE_REVISION,
    renditions: [
      {
        url: `${BASE}/clip-720.mp4`,
        mime: 'video/mp4',
        width: 1280,
        height: 720,
        durationSeconds: 42,
        chapters: [{ label: 'Intro', startSeconds: 0 }],
      },
    ],
    posterUrl: `${BASE}/poster.png`,
    captionsUrl: `${BASE}/captions.vtt`,
    transcriptUrl: `${BASE}/transcript.html`,
    evidence: { runIds: ['run-1'], logs: [], artifactHashes: ['c'.repeat(64)] },
    approval: { approvedBy: 'Owner', approvedAt: '2026-10-25T12:00:00Z', watchedComplete: true },
    contentHash: 'd'.repeat(64),
    immutableUrls: true,
    ...overrides,
  };
}

/** The DemoProblem code a body produces, or 'parsed'. */
const codeOf = (raw: unknown): string => {
  const parsed = parseDemoPackage(raw);
  return 'problem' in parsed ? parsed.problem : 'parsed';
};

/**
 * One violated field per refusal code — the only gate between a hostile body
 * and a rendered package. The table is typed as a total record over
 * `DemoProblem`, so the compiler refuses both directions of drift: a
 * seventeenth code cannot arrive unpinned (missing key) and an extra key
 * cannot hide here (excess property check).
 */
const oneViolationPerCode = {
  'not-an-object': { note: 'a JSON null is not a package object', body: null },
  'wrong-schema': { note: 'the schema id', body: wellFormed({ schema: 'rhobear.demo-package.v2' }) },
  'bad-scenario-id': { note: 'the scenarioId shape', body: wellFormed({ scenarioId: 'Teams_01' }) },
  'bad-engine-or-product': { note: 'engineOrProduct', body: wellFormed({ engineOrProduct: '' }) },
  'bad-package-revision': { note: 'packageRevision', body: wellFormed({ packageRevision: '' }) },
  'bad-source-app': { note: 'sourceApp', body: wellFormed({ sourceApp: '' }) },
  'bad-source-revision': { note: 'sourceRevision', body: wellFormed({ sourceRevision: 'abc123' }) },
  'bad-publication-state': {
    note: 'publicationState',
    body: wellFormed({ publicationState: 'live' }),
  },
  'bad-immutable': { note: 'immutableUrls', body: wellFormed({ immutableUrls: false }) },
  'empty-renditions': { note: 'renditions', body: wellFormed({ renditions: [] }) },
  'bad-rendition': {
    note: 'the rendition mime',
    body: wellFormed({
      renditions: [
        {
          url: `${BASE}/clip-720.mp4`,
          mime: 'video/webm',
          width: 1280,
          height: 720,
          durationSeconds: 42,
          chapters: [],
        },
      ],
    }),
  },
  'bad-url': {
    note: 'the posterUrl scheme',
    body: wellFormed({
      posterUrl: `http://media.example.com/demos/${SCENARIO_ID}/${PACKAGE_REVISION}/poster.png`,
    }),
  },
  'bad-interactive': {
    note: 'interactive.sandbox',
    body: wellFormed({ interactive: { url: `${BASE}/try.html`, sandbox: '' } }),
  },
  'bad-evidence': {
    note: 'evidence.artifactHashes',
    body: wellFormed({ evidence: { runIds: ['run-1'], logs: [], artifactHashes: 'nope' } }),
  },
  'bad-approval': {
    note: 'approval.approvedAt',
    body: wellFormed({ approval: { approvedBy: 'Owner', approvedAt: 5, watchedComplete: true } }),
  },
  'bad-content-hash': { note: 'contentHash shape', body: wellFormed({ contentHash: 'nothex' }) },
} satisfies Record<DemoProblem, { note: string; body: unknown }>;

describe('parseDemoPackage', () => {
  it('parses a well-formed package and drops unknown keys before any screen sees them', () => {
    const parsed = parseDemoPackage({ ...wellFormed(), providerCost: 3, markup: 'x' });
    if (!('package' in parsed)) throw new Error('expected the package to parse');
    expect(parsed.package.schema).toBe('rhobear.demo-package.v1');
    expect(parsed.package.scenarioId).toBe(SCENARIO_ID);
    expect(parsed.package.publicationState).toBe('approved');
    expect(parsed.package.renditions[0]?.url).toBe(`${BASE}/clip-720.mp4`);
    expect('providerCost' in parsed.package).toBe(false);
    expect('markup' in parsed.package).toBe(false);
  });

  it('a package with the wrong schema id is refused with its own code', () => {
    expect(codeOf(wellFormed({ schema: 'rhobear.demo-package.v2' }))).toBe('wrong-schema');
  });

  it('a package with a non-https URL is refused with its own code', () => {
    expect(
      codeOf(
        wellFormed({
          posterUrl: `http://media.example.com/demos/${SCENARIO_ID}/${PACKAGE_REVISION}/poster.png`,
        }),
      ),
    ).toBe('bad-url');
  });

  it('a package whose sourceRevision is not 40 hex is refused with its own code', () => {
    expect(codeOf(wellFormed({ sourceRevision: 'abc123' }))).toBe('bad-source-revision');
  });

  it('a package with no approval object is refused with its own code', () => {
    const raw = wellFormed();
    delete raw.approval;
    expect(codeOf(raw)).toBe('bad-approval');
  });

  it('a package with empty renditions is refused with its own code', () => {
    expect(codeOf(wellFormed({ renditions: [] }))).toBe('empty-renditions');
  });

  it('a signed or expiring URL is refused, one parameter at a time', () => {
    // Cached playback would break and the link would leak access, so every
    // signed/expiring parameter shape from the lane brief is refused.
    const target = `${BASE}/clip-720.mp4`;
    const signedUrls = [
      `${target}?X-Amz-Expires=900`,
      `${target}?X-Amz-Signature=abc`,
      `${target}?token=t`,
      `${target}?signature=s`,
      `${target}?sig=s`,
      `${target}?expires=99`,
      `${target}?EXPIRES=99`,
    ];
    for (const url of signedUrls) {
      const raw = wellFormed({
        renditions: [
          { url, mime: 'video/mp4', width: 1280, height: 720, durationSeconds: 42, chapters: [] },
        ],
      });
      expect(codeOf(raw)).toBe('bad-url');
    }
  });

  it('a URL whose path carries no revision component is refused', () => {
    // A revision-anchored path is what makes a URL immutable; without it the
    // mirror could silently swap the bytes under a stable-looking link.
    expect(codeOf(wellFormed({ posterUrl: 'https://media.example.com/demos/teams-01/poster.png' }))).toBe(
      'bad-url',
    );
  });

  it('every DemoProblem refusal code is pinned: one violated field per code, all sixteen', () => {
    const codes = Object.keys(oneViolationPerCode) as DemoProblem[];
    expect(codes).toHaveLength(16);
    const pinned = new Map<string, number>();
    for (const code of codes) {
      const fixture = oneViolationPerCode[code];
      // Each fixture violates exactly the check its code names, so the refusal
      // is unambiguous: the gate fires with its own code and no other.
      expect(codeOf(fixture.body), fixture.note).toBe(code);
      pinned.set(code, (pinned.get(code) ?? 0) + 1);
    }
    // Every member of DemoProblem is covered exactly once — no code left
    // unpinned, no code pinned twice.
    for (const code of codes) {
      expect(pinned.get(code), code).toBe(1);
    }
  });

  it('every rendition field is gated: width, height, duration and chapters each refuse a bad value', () => {
    const badFields: Record<string, Record<string, unknown>> = {
      width: { width: 0 },
      height: { height: 720.5 },
      duration: { durationSeconds: 0 },
      chapters: { chapters: 'Intro' },
    };
    for (const [field, override] of Object.entries(badFields)) {
      const raw = wellFormed({
        renditions: [
          {
            url: `${BASE}/clip-720.mp4`,
            mime: 'video/mp4',
            width: 1280,
            height: 720,
            durationSeconds: 42,
            chapters: [{ label: 'Intro', startSeconds: 0 }],
            ...override,
          },
        ],
      });
      expect(codeOf(raw), field).toBe('bad-rendition');
    }
  });

  it('a package whose renditions hold one valid and one invalid entry refuses the whole package', () => {
    const raw = wellFormed({
      renditions: [
        {
          url: `${BASE}/clip-720.mp4`,
          mime: 'video/mp4',
          width: 1280,
          height: 720,
          durationSeconds: 42,
          chapters: [{ label: 'Intro', startSeconds: 0 }],
        },
        {
          url: `${BASE}/clip-1080.mp4`,
          mime: 'video/mp4',
          width: 1920,
          height: 1080,
          durationSeconds: -1,
          chapters: [],
        },
      ],
    });
    expect(codeOf(raw)).toBe('bad-rendition');
  });

  it("the scenario id set is the registry's, in registry order, with no duplicates", () => {
    // Compared against the registry itself: a literal list here would only
    // prove the client's table matches another literal list.
    const fromEngines = engines.flatMap((engine) => [...engine.scenarioIds]);
    const fromScenarios = engineScenarios.map((scenario) => scenario.scenarioId);
    expect([...KNOWN_SCENARIO_IDS]).toEqual(fromEngines);
    expect([...KNOWN_SCENARIO_IDS]).toEqual(fromScenarios);
    expect(fromEngines.length).toBeGreaterThan(0);
    expect(new Set(KNOWN_SCENARIO_IDS).size).toBe(KNOWN_SCENARIO_IDS.length);
    expect(new Set(fromEngines).size).toBe(fromEngines.length);
  });
});

describe('demo module cohesion', () => {
  it('the demo modules share one isRecord and one registry row type', () => {
    // resolve.ts imports isRecord from ./schema — the repo's ?raw source
    // assertion style — instead of defining a second copy.
    expect(resolveSource).toMatch(/import\s*\{[^}]*\bisRecord\b[^}]*\}\s*from\s*'\.\/schema'/);
    expect(schemaSource.match(/function isRecord\(/g) ?? []).toHaveLength(1);
    expect(resolveSource).not.toMatch(/function isRecord\(/);
    // One registry row type across the two modules — EnginesIndexRow is gone —
    // and the barrel's two `export *` lines export that single definition.
    expect((schemaSource + resolveSource).match(/export type ScenarioRegistryRow\b/g) ?? []).toHaveLength(1);
    for (const source of [schemaSource, resolveSource, indexSource]) {
      expect(source).not.toMatch(/EnginesIndexRow/);
    }
    expect(indexSource).toContain(`export * from './schema';`);
    expect(indexSource).toContain(`export * from './resolve';`);
  });
});

describe('content hash canonical form', () => {
  // The producer side of the rule resolve.ts pins, written out from the
  // documented rule rather than imported from the resolver: object keys
  // sorted at every level, arrays in wire order, finite numbers as
  // JSON.stringify writes them (shortest round-trip).
  const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    const scalar = JSON.stringify(value);
    return scalar === undefined ? 'null' : scalar;
  };

  const sha256Hex = async (text: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    let hex = '';
    for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
    return hex;
  };

  const reverseKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((item) => reverseKeys(item));
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record).reverse()) out[key] = reverseKeys(record[key]);
      return out;
    }
    return value;
  };

  it('the content hash is over a canonical form: key order and 1e3 versus 1000 do not change the digest of the same package', async () => {
    const body: Record<string, unknown> = {
      schema: DEMO_PACKAGE_SCHEMA,
      engineOrProduct: 'teams',
      scenarioId: SCENARIO_ID,
      packageRevision: PACKAGE_REVISION,
      publicationState: 'approved',
      sourceApp: 'capturd',
      sourceRevision: SOURCE_REVISION,
      renditions: [
        {
          url: `${BASE}/clip-720.mp4`,
          mime: 'video/mp4',
          width: 1280,
          height: 720,
          durationSeconds: 1000,
          chapters: [{ label: 'Intro', startSeconds: 0 }],
        },
      ],
      posterUrl: `${BASE}/poster.png`,
      captionsUrl: `${BASE}/captions.vtt`,
      transcriptUrl: `${BASE}/transcript.html`,
      evidence: { runIds: ['run-1'], logs: [], artifactHashes: ['c'.repeat(64)] },
      approval: { approvedBy: 'Owner', approvedAt: '2026-10-25T12:00:00Z', watchedComplete: true },
      immutableUrls: true,
    };
    const contentHash = await sha256Hex(canonicalJson(body));
    // Two wire spellings of the same package: reversed key order at every
    // level, and 1e3 where the other writes 1000.
    const forward = JSON.stringify({ ...body, contentHash });
    const reversed = JSON.stringify(reverseKeys({ ...body, contentHash })).replace(
      '"durationSeconds":1000',
      '"durationSeconds":1e3',
    );
    const plays = async (rawText: string) => {
      const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, text: async () => rawText });
      const presentation = await createDemoResolver({
        mirrorUrl: 'https://site.example',
        fetchImpl,
      }).resolve(SCENARIO_ID);
      if (presentation.state !== 'playable') {
        throw new Error(`expected playable, got ${JSON.stringify(presentation)}`);
      }
      return presentation;
    };
    const a = await plays(forward);
    const b = await plays(reversed);
    expect(a.contentHash).toBe(contentHash);
    expect(b.contentHash).toBe(contentHash);
  });
});

describe('parseScenarioRegistry', () => {
  const row = (scenarioId: string, order: number) => ({
    scenarioId,
    engine: 'teams',
    title: 'Teams at work',
    oneLiner: 'One honest line.',
    posterAlt: 'Poster alt text',
    order,
  });

  it('parses a registry, and refuses duplicates, non-arrays and malformed rows', () => {
    const parsed = parseScenarioRegistry([row('teams-01', 1)]);
    if (!('rows' in parsed)) throw new Error('expected the registry to parse');
    expect(parsed.rows.length).toBe(1);
    expect(parseScenarioRegistry([row('teams-01', 1), row('teams-01', 2)])).toEqual({
      problem: 'duplicate-scenario',
    });
    expect(parseScenarioRegistry({})).toEqual({ problem: 'not-an-array' });
    expect(parseScenarioRegistry([{ scenarioId: 'teams-01' }])).toEqual({ problem: 'bad-row' });
  });
});
