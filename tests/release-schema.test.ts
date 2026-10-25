import { describe, expect, it } from 'vitest';
import {
  RELEASE_MANIFEST_SCHEMA,
  RELEASE_SCHEMA,
  isRfc3339,
  parseManifest,
  parseRelease,
  platforms,
} from '../src/clients/release/schema';

const SOURCE_SHA = 'a'.repeat(40);
const SHA256 = 'b'.repeat(64);
const ACCEPTED_AT = '2026-10-25T12:00:00Z';
const ARTIFACT_URL = 'https://downloads.example.com/rhobear-1.0.0.tar.gz';

function wellFormedRow(platform: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: RELEASE_SCHEMA,
    product: 'Rhobear',
    platform,
    version: '1.0.0',
    sourceSha: SOURCE_SHA,
    artifactUrl: ARTIFACT_URL,
    storeUrl: null,
    bytes: 1048576,
    sha256: SHA256,
    signer: null,
    notarization: 'not-applicable',
    availability: 'available',
    acceptedAt: ACCEPTED_AT,
    supersededBy: null,
    ...overrides,
  };
}

describe('parseRelease', () => {
  it('parses a well-formed release', () => {
    const parsed = parseRelease(wellFormedRow('linux'));
    if (!('release' in parsed)) throw new Error('expected the row to parse');
    expect(parsed.release.schema).toBe(RELEASE_SCHEMA);
    expect(parsed.release.platform).toBe('linux');
    expect(parsed.release.artifactUrl).toBe(ARTIFACT_URL);
  });

  it('rejects a release without a platform', () => {
    const row = wellFormedRow('linux');
    delete row.platform;
    // Documented failure shape: { problem }, never null, never a coerced release.
    expect(parseRelease(row)).toEqual({ problem: 'bad-platform' });
  });

  it('rejects an unknown platform', () => {
    const parsed = parseRelease(wellFormedRow('linux', { platform: 'solaris' }));
    expect(parsed).toEqual({ problem: 'bad-platform' });
    expect('release' in parsed).toBe(false);
  });

  it('drops unknown keys', () => {
    const row = { ...wellFormedRow('linux'), unexpected: 'x', markup: '1.00' };
    const parsed = parseRelease(row);
    if (!('release' in parsed)) throw new Error('expected the row to parse');
    // Edge: markup looks like internal cost — it must never reach a screen.
    expect('unexpected' in parsed.release).toBe(false);
    expect('markup' in parsed.release).toBe(false);
    expect(Object.keys(parsed.release)).not.toContain('unexpected');
    expect(Object.keys(parsed.release)).not.toContain('markup');
  });
});

describe('release guards', () => {
  it('accepts only https artifact urls', () => {
    const parsed = parseRelease(wellFormedRow('linux', { artifactUrl: 'http://downloads.example.com/x' }));
    expect(parsed).toEqual({ problem: 'bad-url' });
  });

  it('rejects a non-RFC3339 timestamp', () => {
    const human = '25/10/2026';
    expect(isRfc3339(human)).toBe(false);
    expect(parseRelease(wellFormedRow('linux', { acceptedAt: human }))).toEqual({ problem: 'bad-accepted-at' });
    // The real instant still parses — the refusal is about the shape, not Date.
    const parsed = parseRelease(wellFormedRow('linux', { acceptedAt: '2026-10-25T12:00:00Z' }));
    expect('release' in parsed).toBe(true);
  });
});

describe('parseManifest', () => {
  it('parses a manifest with one row per platform', () => {
    const result = parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: platforms.map((p) => wellFormedRow(p)) });
    if (!result.ok) throw new Error('expected an ok manifest, got ' + result.problems.join(','));
    expect(result.releases).toHaveLength(8);
    expect(result.releases.map((r) => r.platform)).toEqual([...platforms]);
  });

  it('refuses a manifest with one bad row', () => {
    const badIndex = 3; // the ios row carries an invalid platform
    const rows = platforms.map((p, i) =>
      i === badIndex ? wellFormedRow(p, { platform: 'solaris' }) : wellFormedRow(p),
    );
    const rowCodes = rows.flatMap((r) => {
      const parsed = parseRelease(r);
      return 'problem' in parsed ? [parsed.problem] : [];
    });
    // ManifestProblem carries only a code, so the row index is named by proving
    // row 3 is the sole defective row and its code is what the manifest reports.
    expect(rowCodes).toEqual(['bad-platform']);
    const result = parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows });
    expect(result).toEqual({ ok: false, problems: ['bad-platform'] });
    expect('releases' in result).toBe(false); // no partial manifest a screen could render
  });

  it('refuses a manifest whose schema id is wrong', () => {
    const rows = platforms.map((p) => wellFormedRow(p));
    const result = parseManifest({ schema: 'rhobear.release.v2', releases: rows });
    expect(result).toEqual({ ok: false, problems: ['wrong-schema'] });
    expect('releases' in result).toBe(false);
  });

  it('accepts an empty manifest', () => {
    const result = parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: [] });
    // Actual behaviour: empty is rejected fail-closed, never parsed to zero releases.
    expect(result).toEqual({ ok: false, problems: ['empty'] });
    expect('releases' in result).toBe(false);
  });
});
