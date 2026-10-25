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
    // The 1.4.0 macOS build is history: exactly one live row per (product, platform)
    // is the rule parseManifest enforces, so the fixture obeys it too.
    row('macos', { artifactUrl: ARTIFACT.macos, notarization: 'passed', supersededBy: EXTRA_VERSION }),
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
    // One result row per manifest entry, and the pair is asserted rather than the
    // platform name alone: a reorder inside a platform would otherwise pass. The
    // resolver sorts the live row of a platform above its history, which is the
    // manifest's own order here (1.4.1 live, 1.4.0 superseded).
    const expected = [...MANIFEST.releases]
      .map((r) => [r.platform, r.version] as const)
      .sort((a, b) => {
        const byPlatform = ['windows', 'macos', 'linux', 'ios', 'android', 'web', 'cli'].indexOf(a[0])
          - ['windows', 'macos', 'linux', 'ios', 'android', 'web', 'cli'].indexOf(b[0]);
        if (byPlatform !== 0) return byPlatform;
        return a[1] === b[1] ? 0 : a[1] < b[1] ? 1 : -1; // live (newer) first
      });
    expect(rows.map((r) => [r.platform, r.version])).toEqual(expected);
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
    const macos = rowWhere(rows, (r) => r.platform === 'macos' && r.version === EXTRA_VERSION);
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

  it('a Linux desktop and a Chromebook both resolve to linux', () => {
    // A shipping platform: the two branches that reach 'linux' get their own test.
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' })).toBe('linux');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36' })).toBe('linux');
    // Android is checked first, so an Android UA never falls through to linux.
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)' })).toBe('android');
  });

  it('uses navigator.platform when the UA is not enough, and refuses an empty UA', () => {
    // The second input channel: an iPadOS or a spoofed UA can leave only
    // navigator.platform to go on.
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe('macos');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ipados');
    expect(detectPlatform({ userAgent: null })).toBe(null);
    expect(detectPlatform({ userAgent: '   ' })).toBe(null);
    expect(detectPlatform({ userAgent: '' })).toBe(null);
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

  it('returns device-unknown when nothing is offered and the device is unknown', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) => ({ ...release, availability: 'unavailable' })),
    };
    const result = resolveReleases(PRODUCT, manifest.releases, UNKNOWN_HINTS);
    expect(result).toEqual({ ok: false, reason: 'device-unknown' });
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
    // A waitlist row is a real answer for the device: it names its reason, so a
    // screen can say "join the list" instead of rendering nothing.
    expect(linux.reason).toBe('waitlist');
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

// Apollo's round-3 review: a URL may only exist on the state that can use it,
// and the belt checks apply to the store link and to a whitespace signer too.
describe('resolveReleases — no live link on a refused row', () => {
  it('a superseded row carries no artifact URL', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) =>
        release.platform === 'macos' && release.version === '1.4.0'
          ? { ...release, supersededBy: EXTRA_VERSION }
          : release,
      ),
    };
    const rows = rowsOf(manifest);
    const superseded = rowWhere(rows, (r) => r.platform === 'macos' && r.version === '1.4.0');
    expect(superseded.state).toBe('unavailable');
    expect(superseded.artifactUrl).toBeNull();
    expect(superseded.storeUrl).toBeNull();
    // The live row keeps its URL.
    const live = rowWhere(rows, (r) => r.platform === 'macos' && r.version === EXTRA_VERSION);
    expect(live.artifactUrl).toBe(ARTIFACT.macos);
  });

  it('an unsigned, insecure or pulled row carries no URL a screen could render', () => {
    const unsigned = rowWhere(rowsOf(manifestWith({ signer: '   ' })), (r) => r.version === EXTRA_VERSION);
    expect(unsigned.reason).toBe('signer-missing');
    expect(unsigned.artifactUrl).toBeNull();

    const insecure = rowWhere(
      rowsOf(manifestWith({ artifactUrl: 'http://releases.example.com/rhobear.dmg' })),
      (r) => r.version === EXTRA_VERSION,
    );
    expect(insecure.reason).toBe('insecure-artifact');
    expect(insecure.artifactUrl).toBeNull();

    const pulled = rowWhere(rowsOf(MANIFEST), (r) => r.platform === 'cli');
    expect(pulled.reason).toBe('marked-unavailable');
    expect(pulled.artifactUrl).toBeNull();
  });

  it('a store row keeps only its store URL, and an insecure store URL is refused', () => {
    const ios = rowWhere(rowsOf(MANIFEST), (r) => r.platform === 'ios');
    expect(ios.state).toBe('store');
    expect(ios.storeUrl).toBe(STORE.ios);
    expect(ios.artifactUrl).toBeNull();

    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) =>
        release.platform === 'ios'
          ? { ...release, storeUrl: 'http://apps.apple.com/app/rhobear/id1234567890' }
          : release,
      ),
    };
    const insecure = rowWhere(rowsOf(manifest), (r) => r.platform === 'ios');
    expect(insecure.state).toBe('unavailable');
    expect(insecure.reason).toBe('insecure-artifact');
    expect(insecure.storeUrl).toBeNull();
  });
});

// Apollo's round-4 review: a store or waitlist row carries no hash, the store
// path is notarized by the store rather than by us, and the product id is
// matched canonically.
describe('resolveReleases — no binary, no hash; store rows need no ticket', () => {
  it('a store row carries neither a size nor a digest', () => {
    const ios = rowWhere(rowsOf(MANIFEST), (r) => r.platform === 'ios');
    expect(ios.state).toBe('store');
    expect(ios.bytes).toBeNull();
    expect(ios.sha256).toBeNull();
  });

  it('a waitlist row carries neither a size nor a digest', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) =>
        release.platform === 'linux'
          ? { ...release, availability: 'waitlist', artifactUrl: null, storeUrl: null }
          : release,
      ),
    };
    const linux = rowWhere(rowsOf(manifest), (r) => r.platform === 'linux');
    expect(linux.bytes).toBeNull();
    expect(linux.sha256).toBeNull();
  });

  it('a macOS store row is a live store link without a notarization ticket', () => {
    // The store notarizes what it ships; requiring 'passed' here would refuse
    // every genuine App Store row.
    const manifest: ReleaseManifest = {
      releases: [
        row('macos', {
          artifactUrl: null, storeUrl: STORE.ios, notarization: 'required', signer: null,
        }),
      ],
    };
    const macos = rowWhere(rowsOf(manifest), (r) => r.platform === 'macos');
    expect(macos.state).toBe('store');
    expect(macos.reason).toBeNull();
  });

  it('matches the product id case- and whitespace-insensitively', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) => ({ ...release, product: '  RhoBear ' })),
    };
    const result = resolveReleases('rhobear', manifest.releases, UNKNOWN_HINTS);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.rows.length : 0).toBe(manifest.releases.length);
  });
});

// Apollo's round-5 review: the store half of the featured selection, the reason
// a screen renders when nothing is featured, and a digest only on a download.
describe('resolveReleases — featured reasons and digests', () => {
  const IPHONE: DeviceHints = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' };

  it('features a store row on the device it belongs to', () => {
    const result = resolveReleases(PRODUCT, MANIFEST.releases, IPHONE);
    if (!result.ok) throw new Error('the iPhone resolves');
    expect(result.featured?.platform).toBe('ios');
    expect(result.featured?.state).toBe('store');
    expect(result.featuredReason).toBeNull();
  });

  it('says device-unknown when the device cannot be identified', () => {
    const result = resolveReleases(PRODUCT, MANIFEST.releases, UNKNOWN_HINTS);
    if (!result.ok) throw new Error('an unknown device still gets the rows');
    expect(result.detection).toBe('unknown');
    expect(result.featured).toBeNull();
    expect(result.featuredReason).toBe('device-unknown');
  });

  it('says platform-unavailable when the device is known but has no row', () => {
    // An iPad in desktop mode is identified (touch points), and the fixture
    // manifest carries no ipados row: that is a different message from "we do
    // not know your device" and from "your row cannot be downloaded".
    const result = resolveReleases(PRODUCT, MANIFEST.releases, {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      maxTouchPoints: 5,
    });
    if (!result.ok) throw new Error('a known device gets rows');
    expect(result.currentPlatform).toBe('ipados');
    expect(result.featured).toBeNull();
    expect(result.featuredReason).toBe('platform-unavailable');
  });

  it('carries a digest only on a downloadable row', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) =>
        release.platform === 'macos' && release.version === '1.4.0'
          ? { ...release, supersededBy: EXTRA_VERSION }
          : release,
      ),
    };
    const rows = rowsOf(manifest);
    const superseded = rowWhere(rows, (r) => r.platform === 'macos' && r.version === '1.4.0');
    expect(superseded.state).toBe('unavailable');
    expect(superseded.bytes).toBeNull();
    expect(superseded.sha256).toBeNull();
    const live = rowWhere(rows, (r) => r.platform === 'macos' && r.version === EXTRA_VERSION);
    expect(live.bytes).not.toBeNull();
    expect(live.sha256).not.toBeNull();
  });
});

// Apollo's round-6 review: a waitlist device gets a reason, and a Release[] that
// bypassed the manifest cannot hand out a download with no digest.
describe('resolveReleases — waitlist reason and bypassed rows', () => {
  it('names the waitlist for the device it belongs to', () => {
    const manifest: ReleaseManifest = {
      releases: MANIFEST.releases.map((release) =>
        release.platform === 'linux'
          ? { ...release, availability: 'waitlist', artifactUrl: null, storeUrl: null, signer: null }
          : release,
      ),
    };
    const result = resolveReleases(PRODUCT, manifest.releases, {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    });
    if (!result.ok) throw new Error('a waitlist device still gets rows');
    expect(result.currentPlatform).toBe('linux');
    expect(result.featured).toBeNull();
    // Not a blank: the screen can say "join the list" for this device.
    expect(result.featuredReason).toBe('waitlist');
  });

  it('refuses a downloadable row with no digest when the manifest was bypassed', () => {
    const broken = MANIFEST.releases.map((release) =>
      release.platform === 'linux' ? { ...release, bytes: null, sha256: null } : release,
    );
    const rows = rowsOf({ releases: broken });
    const linux = rowWhere(rows, (r) => r.platform === 'linux');
    expect(linux.state).toBe('unavailable');
    expect(linux.reason).toBe('incomplete-artifact');
    expect(linux.artifactUrl).toBeNull();
  });
});
