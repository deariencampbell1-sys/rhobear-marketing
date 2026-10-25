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
    // No touch hint at all: a Mac and an iPad in desktop mode are the same UA,
    // so the device is unknown rather than guessed as macOS.
    expect(detectPlatform({ userAgent: ua })).toBe(null);
    expect(detectPlatform({ userAgent: ua, maxTouchPoints: null })).toBe(null);
  });

  it('a phone user agent resolves to the phone platform', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' })).toBe('ios');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)' })).toBe('android');
    // Implementation: an unrecognised UA gets no fallback — it is null.
    expect(detectPlatform({ userAgent: 'SomeUnknownAgent/1.0' })).toBe(null);
  });
});

// The two fail-closed rules: an owner-pulled build wins over a leftover store
// link, and a superseded build is shown, named, and never offered or featured.
describe('resolveReleases fail-closed rules', () => {
  // A real Mac sends a Macintosh UA *and* maxTouchPoints 0; without the touch
  // hint the device is ambiguous with an iPad in desktop mode and detection
  // returns null (see the iPad test above).
  const MAC_HINTS: DeviceHints = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    maxTouchPoints: 0,
  };

  const resolveOne = (manifest: ReleaseManifest, hints: DeviceHints) => {
    const result = resolveReleases(PRODUCT, manifest.releases, hints);
    if (!result.ok) throw new Error(`resolveReleases failed: ${result.reason}`);
    return result;
  };

  // Index 1 is the 1.4.0 macOS row; index 2 is the newer 1.4.1 row.
  const supersedeFirstMacos = (): ReleaseManifest => ({
    releases: MANIFEST.releases.map((release, index) =>
      index === 1 ? { ...release, supersededBy: EXTRA_VERSION } : release,
    ),
  });

  it('an unavailable row is unavailable even when it still carries a store link', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) =>
        release.platform === 'ios'
          ? { ...release, availability: 'unavailable', storeUrl: STORE.ios, artifactUrl: null }
          : release,
      ),
    };
    const result = resolveOne(manifest, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    const ios = rowWhere(result.rows, (r) => r.platform === 'ios');

    expect(ios.state).toBe('unavailable');
    expect(ios.reason).toBe('marked-unavailable');
    expect(result.featured?.platform).not.toBe('ios');
  });

  it('a superseded build is shown, named, and never downloadable', () => {
    const rows = rowsOf(supersedeFirstMacos());
    const superseded = rowWhere(rows, (r) => r.platform === 'macos' && r.version === '1.4.0');

    expect(superseded.state).toBe('unavailable');
    expect(superseded.reason).toBe('superseded');
    expect(superseded.supersededBy).toBe(EXTRA_VERSION);
  });

  it('features the newer build when the first macOS row is the superseded one', () => {
    const result = resolveOne(supersedeFirstMacos(), MAC_HINTS);
    const older = rowWhere(result.rows, (r) => r.platform === 'macos' && r.version === '1.4.0');
    const newer = rowWhere(result.rows, (r) => r.platform === 'macos' && r.version === EXTRA_VERSION);

    expect(older.reason).toBe('superseded');
    expect(newer.state).toBe('downloadable');
    expect(result.featured?.version).toBe(EXTRA_VERSION);
  });

  it('a manifest whose every row is superseded features nothing', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) => ({ ...release, supersededBy: '9.9.9' })),
    };
    const result = resolveOne(manifest, MAC_HINTS);

    expect(result.featured).toBeNull();
    // The cli row is pulled outright ('marked-unavailable'), which outranks
    // 'superseded'; what matters is that nothing here is offered.
    expect(result.rows.every((row) => row.state === 'unavailable' || row.state === 'waitlist')).toBe(true);
  });
});

// The states and fail-closed branches the resolver had no test for: the two
// ok:false reasons, the waitlist row, and the ordering that keeps a superseded
// build from rendering above the one that replaced it.
describe('resolveReleases — fail-closed branches', () => {
  it('returns no-releases for a product the manifest does not carry', () => {
    const result = resolveReleases('herald', MANIFEST.releases, UNKNOWN_HINTS);
    expect(result).toEqual({ ok: false, reason: 'no-releases' });
  });

  it('returns platform-mismatch when nothing is offered and the device is unknown', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) => ({ ...release, availability: 'unavailable' })),
    };
    const result = resolveReleases(PRODUCT, manifest.releases, UNKNOWN_HINTS);
    expect(result).toEqual({ ok: false, reason: 'platform-mismatch' });
  });

  it('still answers a known device when every row is unavailable', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) => ({ ...release, availability: 'unavailable' })),
    };
    const result = resolveReleases(PRODUCT, manifest.releases, {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    if (!result.ok) throw new Error('a known device gets the honest unavailable rows');
    expect(result.detection).toBe('known');
    expect(result.featured).toBeNull();
    expect(result.rows.every((row) => row.state === 'unavailable')).toBe(true);
  });

  it('offers a waitlist row as waitlist, never as a download or a store link', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) =>
        release.platform === 'linux'
          ? { ...release, availability: 'waitlist', artifactUrl: null, storeUrl: null }
          : release,
      ),
    };
    const rows = rowsOf(manifest);
    const linux = rowWhere(rows, (r) => r.platform === 'linux');
    expect(linux.state).toBe('waitlist');
    expect(linux.reason).toBeNull();
  });

  it('never offers an artifact URL that carries credentials', () => {
    const rows = rowsOf(manifestWith({ artifactUrl: 'https://user:pass@releases.example.com/rhobear.dmg' }));
    const extra = rowWhere(rows, (r) => r.version === EXTRA_VERSION);
    expect(extra.state).toBe('unavailable');
    expect(extra.reason).toBe('insecure-artifact');
  });

  it('never marks a macOS build downloadable unless its ticket passed', () => {
    // Belt for a Release[] that bypassed parseManifest, which refuses this row.
    const rows = rowsOf(manifestWith({ notarization: 'not-applicable' }));
    const extra = rowWhere(rows, (r) => r.version === EXTRA_VERSION);
    expect(extra.state).toBe('unavailable');
    expect(extra.reason).toBe('notarization-incomplete');
  });

  it('orders a live build above the superseded one on the same platform', () => {
    // The manifest lists 1.4.1 before 1.4.0 and supersedes 1.4.0 with it.
    const manifest: ReleaseManifest = {
      releases: [
        row('macos', { artifactUrl: ARTIFACT.macos, notarization: 'passed', version: '1.4.1' }),
        row('macos', {
          artifactUrl: ARTIFACT.macos, notarization: 'passed',
          version: '1.4.0', supersededBy: '1.4.1', acceptedAt: '2024-05-01T12:00:00Z',
        }),
      ],
    };
    const rows = rowsOf(manifest);
    expect(rows.map((r) => r.version)).toEqual(['1.4.1', '1.4.0']);
    expect(rows[1].reason).toBe('superseded');
  });

  it('carries acceptedAt so history can be ordered without the manifest', () => {
    const rows = rowsOf(MANIFEST);
    expect(rows.every((row) => row.acceptedAt === ACCEPTED_AT)).toBe(true);
  });
});
