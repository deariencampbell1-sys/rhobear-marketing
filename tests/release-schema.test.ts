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
    // macOS ships notarized or not at all, so the macOS fixture is notarized.
    notarization: platform === 'macos' ? 'passed' : 'not-applicable',
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

  it('rejects an empty manifest', () => {
    const result = parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: [] });
    // Empty is rejected fail-closed, never parsed to zero releases.
    expect(result).toEqual({ ok: false, problems: ['empty'] });
    expect('releases' in result).toBe(false);
  });
});

// Every rejection path of the row parser, one test per ManifestProblem code, so
// a dropped or reordered check cannot ship unnoticed.
describe('parseRelease rejection codes', () => {
  const code = (row: unknown): string => {
    const parsed = parseRelease(row);
    return 'problem' in parsed ? parsed.problem : 'parsed';
  };

  it('not-an-object: a non-object, and each untyped field', () => {
    expect(code('a string')).toBe('not-an-object');
    expect(code(null)).toBe('not-an-object');
    expect(code(wellFormedRow('linux', { product: '' }))).toBe('not-an-object');
    expect(code(wellFormedRow('linux', { version: '' }))).toBe('not-an-object');
    expect(code(wellFormedRow('linux', { availability: 'sometimes' }))).toBe('not-an-object');
    expect(code(wellFormedRow('linux', { notarization: 'maybe' }))).toBe('not-an-object');
    expect(code(wellFormedRow('linux', { signer: 42 }))).toBe('not-an-object');
    expect(code(wellFormedRow('linux', { supersededBy: 42 }))).toBe('not-an-object');
  });

  it('wrong-schema: a row that is not rhobear.release.v1', () => {
    expect(code(wellFormedRow('linux', { schema: 'rhobear.release.v2' }))).toBe('wrong-schema');
    expect(code(wellFormedRow('linux', { schema: undefined }))).toBe('wrong-schema');
  });

  it('bad-platform: missing and unknown', () => {
    const missing = wellFormedRow('linux');
    delete missing.platform;
    expect(code(missing)).toBe('bad-platform');
    expect(code(wellFormedRow('solaris'))).toBe('bad-platform');
  });

  it('bad-source-sha and bad-sha256: wrong length, wrong alphabet, wrong type', () => {
    expect(code(wellFormedRow('linux', { sourceSha: 'a'.repeat(39) }))).toBe('bad-source-sha');
    expect(code(wellFormedRow('linux', { sourceSha: 'z'.repeat(40) }))).toBe('bad-source-sha');
    expect(code(wellFormedRow('linux', { sourceSha: 123 }))).toBe('bad-source-sha');
    expect(code(wellFormedRow('linux', { sha256: 'b'.repeat(63) }))).toBe('bad-sha256');
    expect(code(wellFormedRow('linux', { sha256: 'b'.repeat(64) + '\n' }))).toBe('bad-sha256');
    expect(code(wellFormedRow('linux', { sha256: null }))).toBe('bad-sha256');
  });

  it('bad-bytes: zero, negative, fractional and non-numeric', () => {
    expect(code(wellFormedRow('linux', { bytes: 0 }))).toBe('bad-bytes');
    expect(code(wellFormedRow('linux', { bytes: -1 }))).toBe('bad-bytes');
    expect(code(wellFormedRow('linux', { bytes: 1.5 }))).toBe('bad-bytes');
    expect(code(wellFormedRow('linux', { bytes: '1048576' }))).toBe('bad-bytes');
  });

  it('bad-url: http, credentials in the URL, and a non-string', () => {
    expect(code(wellFormedRow('linux', { artifactUrl: 'http://downloads.example.com/x' }))).toBe('bad-url');
    expect(code(wellFormedRow('linux', { artifactUrl: 'https://user:pass@downloads.example.com/x' }))).toBe('bad-url');
    expect(code(wellFormedRow('linux', { artifactUrl: 42 }))).toBe('bad-url');
    expect(code(wellFormedRow('ios', { artifactUrl: null, storeUrl: 'ftp://apps.example.com/x' }))).toBe('bad-url');
  });

  it('bad-accepted-at: a human date and a junk instant', () => {
    expect(code(wellFormedRow('linux', { acceptedAt: '25/10/2026' }))).toBe('bad-accepted-at');
    expect(code(wellFormedRow('linux', { acceptedAt: '2026-13-45T99:99:99Z' }))).toBe('bad-accepted-at');
    expect(code(wellFormedRow('linux', { acceptedAt: 0 }))).toBe('bad-accepted-at');
  });

  it('accepts both RFC3339 forms: a Z and a numeric offset', () => {
    expect(code(wellFormedRow('linux', { acceptedAt: '2026-10-25T12:00:00Z' }))).toBe('parsed');
    expect(code(wellFormedRow('linux', { acceptedAt: '2026-10-25T12:00:00+02:00' }))).toBe('parsed');
    expect(code(wellFormedRow('linux', { acceptedAt: '2026-10-25T12:00:00.500-05:00' }))).toBe('parsed');
    expect(isRfc3339('2026-10-25T12:00:00+02:00')).toBe(true);
    expect(isRfc3339('2026-10-25 12:00:00Z')).toBe(false); // no space separator
  });

  it('no-target: available with neither an artifact nor a store link', () => {
    expect(code(wellFormedRow('linux', { artifactUrl: null, storeUrl: null }))).toBe('no-target');
  });

  it('notarization-not-passed: macOS with required, not-applicable or a non-passed ticket', () => {
    expect(code(wellFormedRow('macos', { notarization: 'required' }))).toBe('notarization-not-passed');
    // 'not-applicable' on macOS is a data error, not a licence to ship.
    expect(code(wellFormedRow('macos', { notarization: 'not-applicable' }))).toBe('notarization-not-passed');
    // A passed ticket still needs a target and is otherwise a valid row.
    expect(code(wellFormedRow('macos', { notarization: 'passed' }))).toBe('parsed');
    // Another platform is unaffected.
    expect(code(wellFormedRow('linux', { notarization: 'not-applicable' }))).toBe('parsed');
  });

  it('normalises hash case and stores it lowercase', () => {
    const parsed = parseRelease(wellFormedRow('linux', { sha256: 'B'.repeat(64), sourceSha: 'A'.repeat(40) }));
    if (!('release' in parsed)) throw new Error('expected uppercase hashes to parse');
    expect(parsed.release.sha256).toBe('b'.repeat(64));
    expect(parsed.release.sourceSha).toBe('a'.repeat(40));
  });
});

// The two manifest-wide rules, tested as chains rather than pairs: a real
// history of two cut releases must not be mistaken for a duplicate.
describe('parseManifest platform rules', () => {
  const chain = (...versions: string[]): Record<string, unknown>[] =>
    versions.map((version, index) =>
      wellFormedRow('macos', {
        version,
        notarization: 'passed',
        // Each row names the next; the last row is the live one.
        supersededBy: index === versions.length - 1 ? null : versions[index + 1],
      }),
    );

  it('accepts a two-row supersede chain', () => {
    const result = parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: chain('1.0.0', '1.1.0') });
    expect(result.ok).toBe(true);
  });

  it('accepts a three-row supersede chain', () => {
    const result = parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: chain('1.0.0', '1.1.0', '1.2.0') });
    if (!result.ok) throw new Error('a v1 -> v2 -> v3 chain is history, not a duplicate: ' + result.problems.join(','));
    expect(result.releases.map((r) => r.version)).toEqual(['1.0.0', '1.1.0', '1.2.0']);
  });

  it('flags two live rows on one (product, platform)', () => {
    const rows = [wellFormedRow('linux', { version: '1.0.0' }), wellFormedRow('linux', { version: '1.1.0' })];
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows })).toEqual({
      ok: false,
      problems: ['duplicate-platform'],
    });
  });

  it('flags a duplicate once per group, not once per pair', () => {
    const rows = [
      wellFormedRow('linux', { version: '1.0.0' }),
      wellFormedRow('linux', { version: '1.1.0' }),
      wellFormedRow('linux', { version: '1.2.0' }),
    ];
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows })).toEqual({
      ok: false,
      problems: ['duplicate-platform'],
    });
  });

  it('does not confuse the same version on two platforms', () => {
    const rows = [wellFormedRow('linux', { version: '1.0.0' }), wellFormedRow('windows', { version: '1.0.0' })];
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows }).ok).toBe(true);
  });

  it('flags a supersede target that does not exist', () => {
    const rows = [wellFormedRow('linux', { version: '1.0.0', supersededBy: '9.9.9' })];
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows })).toEqual({
      ok: false,
      problems: ['ambiguous-supersede'],
    });
  });

  it('flags a supersede target that exists only on another platform', () => {
    const rows = [
      wellFormedRow('linux', { version: '1.0.0', supersededBy: '1.1.0' }),
      wellFormedRow('windows', { version: '1.1.0' }),
    ];
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows })).toEqual({
      ok: false,
      problems: ['ambiguous-supersede'],
    });
  });

  it('flags a supersede cycle with no live head', () => {
    const rows = [
      wellFormedRow('linux', { version: '1.0.0', supersededBy: '1.1.0' }),
      wellFormedRow('linux', { version: '1.1.0', supersededBy: '1.0.0' }),
    ];
    const result = parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems).toContain('ambiguous-supersede');
  });

  it('flags a row superseded by itself', () => {
    const rows = [wellFormedRow('linux', { version: '1.0.0', supersededBy: '1.0.0' })];
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows })).toEqual({
      ok: false,
      problems: ['ambiguous-supersede'],
    });
  });
});

// Both documented input shapes: a bare array is accepted, and a `releases` that
// is not an array is refused rather than iterated.
describe('parseManifest input shapes', () => {
  it('accepts a bare array of rows', () => {
    const result = parseManifest([wellFormedRow('linux')]);
    expect(result.ok).toBe(true);
  });

  it('refuses a releases field that is not an array', () => {
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: 'x' })).toEqual({
      ok: false,
      problems: ['not-an-object'],
    });
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA })).toEqual({
      ok: false,
      problems: ['not-an-object'],
    });
  });

  it('refuses an object manifest that names no schema', () => {
    // A v2 payload that omits the id must not parse as v1: the object form has
    // an envelope, so the envelope is required.
    expect(parseManifest({ releases: [wellFormedRow('linux')] })).toEqual({
      ok: false,
      problems: ['wrong-schema'],
    });
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: 'x' })).toEqual({
      ok: false,
      problems: ['not-an-object'],
    });
  });

  it('refuses a non-object, non-array document', () => {
    expect(parseManifest('nope')).toEqual({ ok: false, problems: ['not-an-object'] });
    expect(parseManifest(null)).toEqual({ ok: false, problems: ['not-an-object'] });
  });
});
