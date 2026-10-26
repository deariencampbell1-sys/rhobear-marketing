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
} from '../src/clients/demo/schema';

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

  it('names exactly the seven board scenario ids, imported from the engines data — never duplicated', () => {
    expect([...KNOWN_SCENARIO_IDS]).toEqual([
      'teams-01',
      'designs-01',
      'forge-01',
      'capturd-01',
      'vision-01',
      'search-01',
      'spaces-01',
    ]);
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
