import { describe, expect, it } from 'vitest';
// W0-05a — the wire schema and the scenario registry. One fixture built field
// by field from the lane contract §4; each refusal feeds exactly one violation
// so the returned problem code is unambiguous. Fixed strings only — no clocks,
// no network, no schema library: the house style of src/clients/money/schema.ts
// and src/clients/release/schema.ts.
import {
  DEMO_PACKAGE_SCHEMA,
  KNOWN_SCENARIO_IDS,
  KNOWN_SANDBOX_TOKENS,
  PUBLICATION_STATES,
  REFUSED_SANDBOX_TOKENS,
  SANDBOX_TOKENS,
  parseDemoPackage,
  parseScenarioRegistry,
  type DemoProblem,
} from '../src/clients/demo/schema';
// W1-06-r1 F25: the module namespace is imported so the immutability test can
// walk EVERY export and prove each collection is frozen — a named import per
// array would only prove the arrays this file already knows about.
import * as schemaModule from '../src/clients/demo/schema';
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

/** The RegistryProblem code a registry produces, or 'parsed'. */
const registryCodeOf = (raw: unknown): string => {
  const parsed = parseScenarioRegistry(raw);
  return 'problem' in parsed ? parsed.problem : 'parsed';
};

/** One complete registry row; overrides replace one field at a time. */
function registryRow(
  scenarioId: string,
  order: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    scenarioId,
    engine: 'teams',
    title: 'Teams at work',
    oneLiner: 'One honest line.',
    posterAlt: 'Poster alt text',
    order,
    ...overrides,
  };
}

/**
 * One violated field per refusal code — the only gate between a hostile body
 * and a rendered package. The table is typed as a total record over
 * `DemoProblem`, so the compiler refuses both directions of drift: an
 * eighteenth code cannot arrive unpinned (missing key) and an extra key
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
  'unknown-scenario': {
    note: 'a registry row naming a valid-shaped id the board does not',
    body: [registryRow('invented-99', 1)],
  },
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

  it('a package URL with any query or fragment is refused: X-Goog-Signature, Policy, Key-Pair-Id, Azure se/sp and a #token fragment', () => {
    // An immutable link carries no query and no fragment at all: a denylist of
    // parameter names is a promise to keep it complete forever — GCS signs
    // with X-Goog-Signature/X-Goog-Expires, CloudFront with Policy and
    // Key-Pair-Id, Azure SAS with se/sp — and url.searchParams never even sees
    // a fragment, so #token=… would sail past any parameter-name check.
    const condemned = [
      `${BASE}/poster.png?X-Goog-Signature=sig`,
      `${BASE}/poster.png?Policy=ey-policy`,
      `${BASE}/poster.png?Key-Pair-Id=key`,
      `${BASE}/poster.png?se=2026-10-26&sp=rl`,
      `${BASE}/poster.png#token=abc`,
    ];
    for (const posterUrl of condemned) {
      expect(codeOf(wellFormed({ posterUrl })), posterUrl).toBe('bad-url');
    }
  });

  it("the revision must be a path segment and must have a revision shape (rev- prefixed): 's', '1' and 'demos' are refused, a real revision on the path is accepted", () => {
    // The shape, chosen once and stated in the module doc: a package revision
    // is `rev-` plus a non-empty run of alphanumerics, dots and dashes — the
    // publisher's stamp (rev-2026-10-25-1). A revision validated only as
    // non-empty ('s', '1', 'demos') matches almost any media path, so the
    // shape is enforced here and the URL rule demands a whole path segment,
    // not a substring.
    for (const packageRevision of ['s', '1', 'demos', '', 'rev-']) {
      expect(codeOf(wellFormed({ packageRevision })), packageRevision).toBe('bad-package-revision');
    }
    // The revision present only as a substring of a longer segment is not
    // anchored and is refused.
    expect(
      codeOf(
        wellFormed({
          posterUrl: `https://media.example.com/demos/teams-01/x${PACKAGE_REVISION}y/poster.png`,
        }),
      ),
    ).toBe('bad-url');
    // A real revision, as a whole path segment, is accepted.
    expect(codeOf(wellFormed())).toBe('parsed');
  });

  it('an interactive sandbox is an allow-listed token set: allow-same-origin is refused, and so is an unknown token', () => {
    // W0-05b carries this string into an iframe sandbox attribute on the
    // front-door origin: allow-same-origin — especially beside allow-scripts —
    // lets the framed page act as the front-door origin and escape the
    // sandbox, so it is refused outright, and every remaining token must be a
    // known sandbox token. An allow-list, not a denylist.
    for (const sandbox of [
      'allow-scripts allow-same-origin',
      'allow-same-origin',
      'allow-escape-sandbox',
      'allow-scripts allow-fake-power',
    ]) {
      expect(codeOf(wellFormed({ interactive: { url: `${BASE}/try.html`, sandbox } })), sandbox).toBe(
        'bad-interactive',
      );
    }
    // Tabs and repeated spaces between allow-listed tokens parse, and the
    // value W0-05b receives is the normalized token list.
    const parsed = parseDemoPackage(
      wellFormed({
        interactive: { url: `${BASE}/try.html`, sandbox: 'allow-scripts\t allow-popups  allow-forms' },
      }),
    );
    if (!('package' in parsed)) throw new Error('expected the package to parse');
    expect(parsed.package.interactive?.sandbox).toBe('allow-scripts allow-popups allow-forms');
  });

  it('evidence inputs normalize when absent and null, and pass through when present', () => {
    for (const inputsLike of [undefined, null]) {
      const parsed = parseDemoPackage(
        wellFormed({
          evidence: { inputs: inputsLike, runIds: ['run-1'], logs: [], artifactHashes: ['c'.repeat(64)] },
        }),
      );
      if (!('package' in parsed)) throw new Error('expected the package to parse');
      expect(parsed.package.evidence.inputs).toEqual([]);
    }
    const parsed = parseDemoPackage(
      wellFormed({
        evidence: {
          inputs: ['stdin.json'],
          runIds: ['run-1'],
          logs: [],
          artifactHashes: ['c'.repeat(64)],
        },
      }),
    );
    if (!('package' in parsed)) throw new Error('expected the package to parse');
    expect(parsed.package.evidence.inputs).toEqual(['stdin.json']);
  });

  it('a valid interactive object parses, with its immutable url and sandbox carried through', () => {
    const parsed = parseDemoPackage(
      wellFormed({ interactive: { url: `${BASE}/try.html`, sandbox: 'allow-scripts' } }),
    );
    if (!('package' in parsed)) throw new Error('expected the package to parse');
    expect(parsed.package.interactive).toEqual({ url: `${BASE}/try.html`, sandbox: 'allow-scripts' });
  });

  it('a non-string captionsUrl and a non-string transcriptUrl each refuse', () => {
    expect(codeOf(wellFormed({ captionsUrl: 7 }))).toBe('bad-url');
    expect(codeOf(wellFormed({ transcriptUrl: false }))).toBe('bad-url');
  });

  it('every DemoProblem refusal code is pinned: one violated field per code, all seventeen', () => {
    const codes = Object.keys(oneViolationPerCode) as DemoProblem[];
    expect(codes).toHaveLength(17);
    const pinned = new Map<string, number>();
    for (const code of codes) {
      const fixture = oneViolationPerCode[code];
      // Each fixture violates exactly the check its code names, so the refusal
      // is unambiguous: the gate fires with its own code and no other.
      // `unknown-scenario` is the registry's refusal; every other code names a
      // package body refusal from parseDemoPackage.
      const produced =
        code === 'unknown-scenario' ? registryCodeOf(fixture.body) : codeOf(fixture.body);
      expect(produced, fixture.note).toBe(code);
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
  it('the demo modules judge dates through one isRfc3339', () => {
    // schema.ts's re-export is the demo surface's single date judgment:
    // resolve.ts imports isRfc3339 through ./schema, not a second time from
    // ../release/schema, and neither demo module keeps a private copy.
    expect(resolveSource).toMatch(/import\s*\{[^}]*\bisRfc3339\b[^}]*\}\s*from\s*'\.\/schema'/);
    expect(resolveSource).not.toMatch(/isRfc3339[^;]*from\s*'\.\.\/release\/schema'/);
    expect(schemaSource).toContain('export { isRfc3339 };');
    expect(schemaSource).not.toMatch(/function isRfc3339/);
    expect(resolveSource).not.toMatch(/function isRfc3339/);
  });

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

// W1-06-r1 — Apollo's F23/F24/F25, made construction rather than claim: the
// admitted sandbox list is DERIVED from the known set (F23), the admitted
// count and the refused set are pinned symmetrically (F24), and every
// exported collection is frozen with no by-reference alias (F25). The
// behaviour the construction must not change is pinned in
// tests/demo-player.test.ts.

/**
 * The nine admitted tokens exactly as shipped at the base (a4f205e0), in
 * order — a frozen literal here, never read from the module under test, so
 * the derivation cannot silently change the policy.
 */
const BASE_ADMITTED_SANDBOX_TOKENS: readonly string[] = Object.freeze([
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-presentation',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
]);

/**
 * The full known iframe sandbox token universe, as the base shipped it: the
 * nine admitted tokens plus the five refused tokens plus `allow-same-origin`.
 * Written out from the base, not read from the module under test.
 */
const BASE_KNOWN_SANDBOX_TOKENS: readonly string[] = Object.freeze([
  'allow-downloads',
  'allow-downloads-without-user-activation',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
]);

describe('demo sandbox policy — one construction (W1-06-r1)', () => {
  it('F23: the admitted list is derived — known − refused − allow-same-origin — never a second hand-kept literal', () => {
    // Both sides are written out from the base: the module's known set is
    // pinned against the base universe, then the derivation is recomputed
    // from that literal and compared with the module's admitted export.
    expect([...KNOWN_SANDBOX_TOKENS]).toEqual([...BASE_KNOWN_SANDBOX_TOKENS]);
    const derived = BASE_KNOWN_SANDBOX_TOKENS.filter(
      (token) => token !== 'allow-same-origin' && !REFUSED_SANDBOX_TOKENS.includes(token),
    );
    expect([...SANDBOX_TOKENS]).toEqual([...derived]);
    expect([...SANDBOX_TOKENS]).toEqual([...BASE_ADMITTED_SANDBOX_TOKENS]);
  });

  it('F24: the admitted set is exactly nine — the count is pinned, so a tenth token cannot slip in', () => {
    expect(SANDBOX_TOKENS).toHaveLength(9);
  });

  it('F24: the refused set is exactly the five owner-refused tokens — pinned symmetrically', () => {
    expect([...REFUSED_SANDBOX_TOKENS]).toEqual([
      'allow-top-navigation',
      'allow-top-navigation-by-user-activation',
      'allow-popups-to-escape-sandbox',
      'allow-top-navigation-to-custom-protocols',
      'allow-downloads-without-user-activation',
    ]);
  });

  it('F24: the two collections are disjoint — no refused token is admitted by the derivation', () => {
    for (const token of REFUSED_SANDBOX_TOKENS) {
      expect(SANDBOX_TOKENS, token).not.toContain(token);
    }
    expect(SANDBOX_TOKENS.filter((token) => REFUSED_SANDBOX_TOKENS.includes(token))).toEqual([]);
  });

  it('F23 edge: allow-same-origin is known but never admitted — the derivation drops it by name', () => {
    expect([...KNOWN_SANDBOX_TOKENS]).toContain('allow-same-origin');
    expect([...SANDBOX_TOKENS]).not.toContain('allow-same-origin');
  });

  it('F23: the known set is exactly admitted ∪ refused ∪ allow-same-origin — no token unaccounted for', () => {
    const union = [
      ...BASE_ADMITTED_SANDBOX_TOKENS,
      ...REFUSED_SANDBOX_TOKENS,
      'allow-same-origin',
    ].sort();
    expect([...KNOWN_SANDBOX_TOKENS].sort()).toEqual(union);
    expect(new Set(KNOWN_SANDBOX_TOKENS).size).toBe(KNOWN_SANDBOX_TOKENS.length);
  });

  it('F25: every exported collection is frozen — strict-mode push, splice and index assignment all throw and leave the policy unchanged', () => {
    // Every array the module exports, walked from its namespace: a new
    // collection cannot be added export-unfrozen and hide from this test.
    for (const [name, value] of Object.entries(schemaModule)) {
      if (Array.isArray(value)) expect(Object.isFrozen(value), name).toBe(true);
    }
    for (const collection of [
      KNOWN_SANDBOX_TOKENS,
      REFUSED_SANDBOX_TOKENS,
      SANDBOX_TOKENS,
      PUBLICATION_STATES,
      KNOWN_SCENARIO_IDS,
    ]) {
      expect(Object.isFrozen(collection)).toBe(true);
    }

    // Strict mode is the test module's mode (ESM): a silent no-op cannot
    // mask a live mutation — each attempt must throw, and the values must be
    // exactly what they were.
    const before = [...SANDBOX_TOKENS];
    const mutable = SANDBOX_TOKENS as unknown as string[];
    expect(() => mutable.push('allow-same-origin'), 'push').toThrow(TypeError);
    expect(() => mutable.splice(0, 1), 'splice').toThrow(TypeError);
    expect(() => {
      mutable[0] = 'allow-same-origin';
    }, 'index assignment').toThrow(TypeError);
    expect([...SANDBOX_TOKENS]).toEqual(before);
  });

  it('F25: no export is a live alias of another — copies mutate freely while the exported policy stays distinct and frozen', () => {
    expect(SANDBOX_TOKENS).not.toBe(KNOWN_SANDBOX_TOKENS);
    expect(SANDBOX_TOKENS).not.toBe(REFUSED_SANDBOX_TOKENS);
    expect(KNOWN_SANDBOX_TOKENS).not.toBe(REFUSED_SANDBOX_TOKENS);
    const copy = [...SANDBOX_TOKENS];
    copy.push('allow-same-origin');
    expect(copy).toHaveLength(10);
    expect([...SANDBOX_TOKENS]).toEqual([...BASE_ADMITTED_SANDBOX_TOKENS]);
  });
});

describe('parseScenarioRegistry', () => {
  it('parses a registry, and refuses duplicates, non-arrays and malformed rows', () => {
    const parsed = parseScenarioRegistry([registryRow('teams-01', 1)]);
    if (!('rows' in parsed)) throw new Error('expected the registry to parse');
    expect(parsed.rows.length).toBe(1);
    expect(parseScenarioRegistry([registryRow('teams-01', 1), registryRow('teams-01', 2)])).toEqual({
      problem: 'duplicate-scenario',
    });
    expect(parseScenarioRegistry({})).toEqual({ problem: 'not-an-array' });
    expect(parseScenarioRegistry([{ scenarioId: 'teams-01' }])).toEqual({ problem: 'bad-row' });
  });

  it('a registry row naming an invented scenario id is unknown-scenario, and every registry id parses', () => {
    // KNOWN_SCENARIO_IDS is enforced now, not merely documented: a
    // valid-shaped but invented id is exactly the drift the board's table
    // exists to stop before it reaches /engines, and it refuses with its own
    // code.
    expect(parseScenarioRegistry([registryRow('invented-99', 1)])).toEqual({
      problem: 'unknown-scenario',
    });
    // Next to a valid row, only the bad row refuses — in either position.
    const good = registryRow('teams-01', 1);
    expect(parseScenarioRegistry([good, registryRow('invented-99', 2)])).toEqual({
      problem: 'unknown-scenario',
    });
    expect(parseScenarioRegistry([registryRow('invented-99', 1), good])).toEqual({
      problem: 'unknown-scenario',
    });
    const alone = parseScenarioRegistry([good]);
    if (!('rows' in alone)) throw new Error('expected the registry to parse');
    expect(alone.rows.map((row) => row.scenarioId)).toEqual(['teams-01']);
    // Every id the board names parses clean.
    const all = parseScenarioRegistry(
      KNOWN_SCENARIO_IDS.map((scenarioId, i) => registryRow(scenarioId, i + 1)),
    );
    if (!('rows' in all)) throw new Error('expected the registry to parse');
    expect(all.rows.map((row) => row.scenarioId)).toEqual([...KNOWN_SCENARIO_IDS]);
  });
});
