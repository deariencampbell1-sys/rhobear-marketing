import { describe, expect, it } from 'vitest';
// W0-04c1 — every state the release resolver can produce, proven against the
// real classify() order in src/clients/release/resolve.ts. One manifest built
// from the exported ReleaseManifest type so tsc keeps the rows honest; fixed
// RFC3339 timestamps only — no clocks, no fake timers.
import {
  detectPlatform,
  resolveReleases,
  type DeviceHints,
  type ReleaseRow,
} from '../src/clients/release/resolve';
import {
  RELEASE_SCHEMA,
  type Platform,
  type Release,
  type ReleaseManifest,
} from '../src/clients/release/schema';

const PRODUCT = 'rhobear';
const ACCEPTED_AT = '2024-06-01T12:00:00Z';
const SOURCE_SHA = 'a'.repeat(40);
const SHA256 = 'b'.repeat(64);
const SIGNER = 'release-signing-key';
const EXTRA_VERSION = '1.4.1';
const EXTRA_INDEX = 2; // the mutable second macos row

const ARTIFACT = {
  windows: 'https://releases.example.com/rhobear/1.4.0/rhobear-windows.zip',
  macos: 'https://releases.example.com/rhobear/1.4.0/rhobear-macos.dmg',
  linux: 'https://releases.example.com/rhobear/1.4.0/rhobear-linux.tar.gz',
  web: 'https://releases.example.com/rhobear/1.4.0/rhobear-web.tgz',
  cli: 'https://releases.example.com/rhobear/1.4.0/rhobear-cli',
} as const;

const STORE = {
  ios: 'https://apps.apple.com/app/rhobear/id1234567890',
  android: 'https://play.google.com/store/apps/details?id=com.example.rhobear',
} as const;

/** One manifest row; every field parseManifest requires is set here. */
function row(platform: Platform, patch: Partial<Release> = {}): Release {
  return {
    schema: RELEASE_SCHEMA,
    product: PRODUCT,
    platform,
    version: '1.4.0',
    sourceSha: SOURCE_SHA,
    artifactUrl: null,
    storeUrl: null,
    bytes: 1_000_000,
    sha256: SHA256,
    signer: SIGNER,
    notarization: 'not-applicable',
    availability: 'available',
    acceptedAt: ACCEPTED_AT,
    supersededBy: null,
    ...patch,
  };
}

// Written in canonical platform order — also the resolver's own sort order.
const MANIFEST: ReleaseManifest = {
  releases: [
    row('windows', { artifactUrl: ARTIFACT.windows }),
    row('macos', { artifactUrl: ARTIFACT.macos, notarization: 'passed' }),
    row('macos', { artifactUrl: ARTIFACT.macos, notarization: 'passed', version: EXTRA_VERSION }),
    row('linux', { artifactUrl: ARTIFACT.linux }),
    row('ios', { storeUrl: STORE.ios, signer: null }),
    row('android', { storeUrl: STORE.android, signer: null }),
    row('web', { artifactUrl: ARTIFACT.web }),
    row('cli', { artifactUrl: ARTIFACT.cli, availability: 'unavailable' }),
  ],
};

/** Fresh manifest with the mutable second macos row overridden per test. */
function manifestWith(patch: Partial<Release>): ReleaseManifest {
  return {
    releases: MANIFEST.releases.map((release, index) =>
      index === EXTRA_INDEX ? { ...release, ...patch } : release,
    ),
  };
}

const UNKNOWN_HINTS: DeviceHints = { userAgent: 'TestRunner/1.0' };

function rowsOf(manifest: ReleaseManifest, hints: DeviceHints = UNKNOWN_HINTS): ReleaseRow[] {
  const result = resolveReleases(PRODUCT, manifest.releases, hints);
  if (!result.ok) throw new Error(`resolveReleases failed: ${result.reason}`);
  return result.rows;
}

function rowWhere(rows: readonly ReleaseRow[], match: (r: ReleaseRow) => boolean): ReleaseRow {
  const found = rows.find(match);
  if (found === undefined) throw new Error('expected a matching row, got none');
  return found;
}

describe('resolveReleases', () => {
  it('resolves one row per platform in manifest order', () => {
    const rows = rowsOf(MANIFEST);
    // One result row per manifest entry (the extra macos row included);
    // the fixture lists platforms in canonical order, so order is preserved.
    expect(rows.map((r) => r.platform)).toEqual(MANIFEST.releases.map((r) => r.platform));
  });

  it('a signed https artifact is downloadable', () => {
    const rows = rowsOf(MANIFEST);
    const windows = rowWhere(rows, (r) => r.platform === 'windows');
    expect(windows.state).toBe('downloadable');
  });

  it('a macos build without complete notarization is unavailable', () => {
    // Brief says override to 'pending'; the schema's Notarization is
    // 'not-applicable' | 'required' | 'passed' — 'required' is the incomplete state.
    const rows = rowsOf(manifestWith({ notarization: 'required' }));
    const extra = rowWhere(rows, (r) => r.version === EXTRA_VERSION);
    expect(extra.state).toBe('unavailable');
    expect(extra.reason).toBe('notarization-incomplete');
  });

  it('a macos build with complete notarization is downloadable', () => {
    // Brief says 'complete'; the schema spells a passed notarization 'passed'.
    const rows = rowsOf(MANIFEST);
    const macos = rowWhere(rows, (r) => r.platform === 'macos' && r.version === '1.4.0');
    expect(macos.state).toBe('downloadable');
  });
});

describe('resolveReleases — artifact checks on the mutable row', () => {
  it('an artifact without a signer is unavailable', () => {
    const rows = rowsOf(manifestWith({ signer: '' }));
    const extra = rowWhere(rows, (r) => r.version === EXTRA_VERSION);
    expect(extra.state).toBe('unavailable');
    expect(extra.reason).toBe('signer-missing');
  });

  it('an http artifact is never offered', () => {
    const rows = rowsOf(
      manifestWith({ artifactUrl: 'http://releases.example.com/rhobear/rhobear-macos.dmg' }),
    );
    const extra = rowWhere(rows, (r) => r.version === EXTRA_VERSION);
    expect(extra.state).toBe('unavailable');
    expect(extra.reason).toBe('insecure-artifact');
  });

  it('a platform with no artifact is unavailable', () => {
    const rows = rowsOf(manifestWith({ artifactUrl: null, storeUrl: null }));
    const extra = rowWhere(rows, (r) => r.version === EXTRA_VERSION);
    expect(extra.state).toBe('unavailable');
    expect(extra.reason).toBe('no-artifact');
  });

  it('a store row points at the store', () => {
    const rows = rowsOf(MANIFEST);
    const ios = rowWhere(rows, (r) => r.platform === 'ios');
    expect(ios.state).toBe('store');
    expect(ios.artifactUrl).toBeNull();
    expect(ios.storeUrl).toBe(STORE.ios);
  });
});

describe('resolveReleases — availability and detection', () => {
  it('a row marked unavailable says so', () => {
    const rows = rowsOf(MANIFEST);
    const cli = rowWhere(rows, (r) => r.platform === 'cli');
    expect(cli.state).toBe('unavailable');
    expect(cli.reason).toBe('marked-unavailable');
  });

  it('an unknown platform is not invented', () => {
    // Implementation: no row is fabricated — the hinted platform (ipados)
    // is simply absent from the result rather than marked unavailable.
    const rows = rowsOf(MANIFEST, {
      userAgent: 'Mozilla/5.0 (iPad; CPU iPad OS 17_5 like Mac OS X)',
      maxTouchPoints: 5,
    });
    expect(rows.some((r) => r.platform === 'ipados')).toBe(false);
    expect(rows.map((r) => r.platform)).not.toContain('ipados');
  });

  it('an iPad is not offered the macOS build', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
    expect(detectPlatform({ userAgent: ua, maxTouchPoints: 5 })).toBe('ipados');
    expect(detectPlatform({ userAgent: ua, maxTouchPoints: 0 })).toBe('macos');
  });

  it('a phone user agent resolves to the phone platform', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' })).toBe('ios');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)' })).toBe('android');
    // Implementation: an unrecognised UA gets no fallback — it is null.
    expect(detectPlatform({ userAgent: 'SomeUnknownAgent/1.0' })).toBe(null);
  });
});
