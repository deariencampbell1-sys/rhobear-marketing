import { describe, expect, it } from 'vitest';
import {
  RELEASE_MANIFEST_SCHEMA,
  RELEASE_SCHEMA,
  isRfc3339,
  parseManifest as parseManifestStrict,
  parseRelease as parseReleaseStrict,
  platforms,
  type ParseOptions,
} from '../src/clients/release/schema';

// The host policy is required by design (an open default is a fail-open default),
// so the suite states it once, exactly as the site will.
const HOSTS: ParseOptions = {
  allowedArtifactHosts: ['releases.example.com', 'downloads.example.com'],
  allowedStoreHosts: ['apps.apple.com', 'play.google.com'],
};
const parseRelease = (raw: unknown, options: ParseOptions = HOSTS) => parseReleaseStrict(raw, options);
const parseManifest = (raw: unknown, options: ParseOptions = HOSTS) => parseManifestStrict(raw, options);

const SOURCE_SHA = 'a'.repeat(40);

/** The ManifestProblem code a row produces, or 'parsed'. */
const code = (row: unknown): string => {
  const parsed = parseRelease(row);
  return 'problem' in parsed ? parsed.problem : 'parsed';
};
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
    // A direct download is signed; a store row is signed by the store.
    signer: 'release-signing-key',
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

// Apollo's round-4 review: the macOS notarization gate must apply to a download,
// not to a row that ships nothing; a row without a binary carries no hash; and
// the caller can pin the hosts a manifest may point at.
describe('parseRelease — macOS notarization only gates a download', () => {
  it('accepts a pulled macOS row that never got its ticket', () => {
    // The emergency pull path: the owner pulls a build whose notarization never
    // came back. Refusing it would blank every other platform in an
    // all-or-nothing manifest, and demanding 'passed' would be a false attestation.
    const pulled = wellFormedRow('macos', {
      availability: 'unavailable', artifactUrl: null, storeUrl: null, notarization: 'required',
    });
    expect(code(pulled)).toBe('parsed');
  });

  it('accepts a macOS waitlist row and a macOS store row without a ticket', () => {
    const waitlist = wellFormedRow('macos', {
      availability: 'waitlist', artifactUrl: null, storeUrl: null, notarization: 'required',
    });
    expect(code(waitlist)).toBe('parsed');
    const store = wellFormedRow('macos', {
      availability: 'available', artifactUrl: null, storeUrl: 'https://apps.apple.com/app/id1',
      notarization: 'required',
    });
    expect(code(store)).toBe('parsed');
  });

  it('still refuses a macOS download without a passed ticket', () => {
    expect(code(wellFormedRow('macos', { notarization: 'required' }))).toBe('notarization-not-passed');
    expect(code(wellFormedRow('macos', { notarization: 'not-applicable' }))).toBe('notarization-not-passed');
  });
});

describe('parseRelease — a row without a binary carries no hash', () => {
  it('nulls the hash and the size on a store row, even when the wire sent them', () => {
    const parsed = parseRelease(wellFormedRow('ios', {
      artifactUrl: null, storeUrl: 'https://apps.apple.com/app/id1', signer: null,
    }));
    if (!('release' in parsed)) throw new Error('a store row parses');
    expect(parsed.release.bytes).toBeNull();
    expect(parsed.release.sha256).toBeNull();
  });

  it('requires both when there is an artifact, and validates them when present', () => {
    expect(code(wellFormedRow('linux', { bytes: undefined }))).toBe('bad-bytes');
    expect(code(wellFormedRow('linux', { sha256: null }))).toBe('bad-sha256');
    expect(code(wellFormedRow('linux', { bytes: 0 }))).toBe('bad-bytes');
    expect(code(wellFormedRow('linux', { sha256: 'nope' }))).toBe('bad-sha256');
  });
});

describe('parseRelease — host policy is fail-closed', () => {
  it('an empty artifact allowlist trusts nothing', () => {
    expect(parseRelease(wellFormedRow('linux'), { allowedArtifactHosts: [] }))
      .toEqual({ problem: 'bad-url' });
  });

  it('the store default covers the two stores we ship through', () => {
    const store = wellFormedRow('ios', {
      artifactUrl: null, storeUrl: 'https://apps.apple.com/app/id1', signer: null,
    });
    expect(parseRelease(store, { allowedArtifactHosts: [] })).toHaveProperty('release');
  });

  it('a store host off the default list is refused', () => {
    const store = wellFormedRow('ios', {
      artifactUrl: null, storeUrl: 'https://store.example.com/app', signer: null,
    });
    expect(parseRelease(store, { allowedArtifactHosts: [] })).toEqual({ problem: 'bad-url' });
  });
});

describe('parseRelease — artifact host policy', () => {
  const allowed = { allowedArtifactHosts: ['downloads.example.com', 'apps.apple.com'] } as const;

  it('accepts a host on the allowlist and refuses any other', () => {
    expect(parseRelease(wellFormedRow('linux'), allowed)).toHaveProperty('release');
    expect(parseRelease(wellFormedRow('linux', { artifactUrl: 'https://evil.example/x' }), allowed))
      .toEqual({ problem: 'bad-url' });
  });

  it('states the policy, so there is no open default to fall back on', () => {
    // The type requires allowedArtifactHosts; an empty list trusts nothing, and
    // an off-list host is refused (both asserted above). Nothing here can be
    // read as "any https origin".
    expect(parseRelease(wellFormedRow('linux'), { allowedArtifactHosts: ['downloads.example.com'] }))
      .toHaveProperty('release');
  });
});

describe('parseRelease — blank strings normalise at the parser', () => {
  it('treats a whitespace signer as no signer and a whitespace supersede as none', () => {
    // On a store row a blank signer is simply "no signer"; on a download it is
    // the signer-missing refusal (a download is always signed).
    const store = parseRelease(wellFormedRow('ios', {
      artifactUrl: null, storeUrl: 'https://apps.apple.com/app/id1', signer: '   ',
    }));
    if (!('release' in store)) throw new Error('a blank signer on a store row is not a failure');
    expect(store.release.signer).toBeNull();
    expect(code(wellFormedRow('linux', { signer: '   ' }))).toBe('signer-missing');

    const chained = parseRelease(wellFormedRow('linux', { supersededBy: '   ' }));
    if (!('release' in chained)) throw new Error('a blank supersede is not a parse failure');
    expect(chained.release.supersededBy).toBeNull();
  });
});

// Apollo's round-5 review: the host policy is per-link, the chain rules compare
// canonical ids, a padded value cannot defeat them, and a direct download needs
// a signer at the manifest layer.
describe('parseRelease — host policy per link', () => {
  const artifactOnly = { allowedArtifactHosts: ['downloads.example.com'] } as const;

  it('a download-CDN allowlist does not reject a store row', () => {
    const store = wellFormedRow('ios', {
      artifactUrl: null, storeUrl: 'https://apps.apple.com/app/id1', signer: null,
    });
    // The App Store host is not the download CDN, and that is not a problem.
    expect(parseRelease(store, artifactOnly)).toHaveProperty('release');
  });

  it('a store allowlist is its own list', () => {
    const store = wellFormedRow('ios', {
      artifactUrl: null, storeUrl: 'https://apps.apple.com/app/id1', signer: null,
    });
    const android = wellFormedRow('android', {
      artifactUrl: null, storeUrl: 'https://play.google.com/store/apps/details?id=x', signer: null,
    });
    expect(parseRelease(store, { allowedArtifactHosts: [], allowedStoreHosts: ['play.google.com'] }))
      .toEqual({ problem: 'bad-url' });
    expect(parseRelease(android, { allowedArtifactHosts: [], allowedStoreHosts: ['play.google.com'] }))
      .toHaveProperty('release');
  });

  it('an off-list download host is refused', () => {
    expect(parseRelease(wellFormedRow('linux', { artifactUrl: 'https://evil.example/x' }), artifactOnly))
      .toEqual({ problem: 'bad-url' });
  });
});

describe('parseRelease — signer and padded ids', () => {
  it('refuses a direct download with no signer', () => {
    expect(code(wellFormedRow('linux', { signer: null }))).toBe('signer-missing');
    expect(code(wellFormedRow('linux', { signer: '   ' }))).toBe('signer-missing');
    // A store row needs none.
    expect(code(wellFormedRow('ios', {
      artifactUrl: null, storeUrl: 'https://apps.apple.com/app/id1', signer: null,
    }))).toBe('parsed');
  });

  it('stores version and supersededBy trimmed, so a padded chain still resolves', () => {
    const rows = [
      wellFormedRow('linux', { version: ' 1.0.0 ', supersededBy: ' 1.1.0 ' }),
      wellFormedRow('linux', { version: '1.1.0' }),
    ];
    const result = parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows });
    if (!result.ok) throw new Error('a padded chain must parse: ' + result.problems.join(','));
    expect(result.releases[0].version).toBe('1.0.0');
    expect(result.releases[0].supersededBy).toBe('1.1.0');
  });

  it('groups by canonical product, so mixed case cannot hide two live rows', () => {
    const rows = [
      wellFormedRow('linux', { product: 'Rhobear', version: '1.0.0' }),
      wellFormedRow('linux', { product: ' rhobear ', version: '1.1.0' }),
    ];
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows })).toEqual({
      ok: false,
      problems: ['duplicate-platform'],
    });
  });
});

// Apollo's round-6 review: the gates follow the offer, not a leftover URL; an id
// of spaces is not an id; a duplicate version is a duplicate row; and an
// impossible calendar date is not a timestamp.
describe('parseRelease — the offer decides the gates', () => {
  it('an emergency pull may keep its artifact fields and still parse', () => {
    // availability flipped, URL and digest left in place, no ticket and no signer:
    // the row ships nothing, so it must not fail the whole manifest.
    const pulled = wellFormedRow('macos', {
      availability: 'unavailable', notarization: 'required', signer: null,
    });
    expect(parseRelease(pulled)).toHaveProperty('release');
  });

  it('a waitlist row needs no signer and no digest', () => {
    const waitlist = wellFormedRow('linux', {
      availability: 'waitlist', artifactUrl: null, storeUrl: null, signer: null, bytes: null, sha256: null,
    });
    expect(parseRelease(waitlist)).toHaveProperty('release');
  });
});

describe('parseRelease — ids and calendar', () => {
  it('refuses an id of spaces', () => {
    expect(code(wellFormedRow('linux', { product: '   ' }))).toBe('not-an-object');
    expect(code(wellFormedRow('linux', { version: '   ' }))).toBe('not-an-object');
  });

  it('refuses a duplicate version even when neither row is live', () => {
    const rows = [
      wellFormedRow('linux', { version: '1.0.0', supersededBy: '1.1.0' }),
      wellFormedRow('linux', { version: '1.0.0', supersededBy: '1.1.0' }),
      wellFormedRow('linux', { version: '1.1.0' }),
    ];
    expect(parseManifest({ schema: RELEASE_MANIFEST_SCHEMA, releases: rows })).toEqual({
      ok: false,
      problems: ['duplicate-platform'],
    });
  });

  it('refuses an impossible calendar date', () => {
    expect(isRfc3339('2026-02-30T12:00:00Z')).toBe(false);
    expect(isRfc3339('2026-13-01T12:00:00Z')).toBe(false);
    expect(isRfc3339('2026-02-28T12:00:00Z')).toBe(true);
    expect(code(wellFormedRow('linux', { acceptedAt: '2026-02-30T12:00:00Z' }))).toBe('bad-accepted-at');
  });
});
