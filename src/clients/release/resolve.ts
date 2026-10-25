import {
  platforms,
  type Platform,
  type Release,
  type ReleaseAvailability,
} from './schema';

/** What the device is, as far as we can tell from the request. */
export type DeviceHints = {
  userAgent: string | null;
  // navigator.platform, when the caller has it; may be '' on modern browsers.
  platform?: string | null;
  // navigator.maxTouchPoints; iPadOS reports a Macintosh UA with touch points > 1.
  maxTouchPoints?: number | null;
};

/** Named reasons. A screen renders the reason, never a bare disabled control. */
export type UnavailableReason =
  | 'no-artifact'
  | 'insecure-artifact'
  | 'notarization-incomplete'
  | 'signer-missing'
  | 'marked-unavailable'
  | 'platform-unavailable';

export type ReleaseRow = {
  platform: Platform;
  version: string;
  sourceSha: string;
  availability: ReleaseAvailability;
  /** 'downloadable' is the ONLY state a download control may be enabled for. */
  state: 'downloadable' | 'store' | 'waitlist' | 'unavailable';
  isCurrentDevice: boolean;
  /** Present only when state needs it; never a guess. */
  reason: UnavailableReason | null;
  artifactUrl: string | null;
  storeUrl: string | null;
  bytes: number;
  sha256: string;
};

export type ResolveResult =
  | {
      ok: true;
      /** current device first, then the canonical platform order. */
      rows: ReleaseRow[];
      detection: 'known' | 'unknown';
      currentPlatform: Platform | null;
      /** The single row to feature, or null when the device's row cannot be downloaded. */
      featured: ReleaseRow | null;
    }
  | { ok: false; reason: 'no-releases' | 'platform-mismatch' };

/** iPadOS masquerades as macOS in the UA; touch points are the only honest tell. */
export function detectPlatform(hints: DeviceHints): Platform | null {
  const ua = hints.userAgent;
  if (ua === null || ua.trim() === '') return null;
  if (ua.includes('Windows NT')) return 'windows';
  // Android reports a Linux-flavoured UA and an iPad-like touch count: it stays Android.
  if (ua.includes('Android')) return 'android';
  if (ua.includes('iPhone') || ua.includes('iPod')) return 'ios';
  if (ua.includes('iPad')) return 'ipados';
  const touch =
    hints.maxTouchPoints !== null &&
    hints.maxTouchPoints !== undefined &&
    hints.maxTouchPoints > 1;
  const macLike =
    ua.includes('Macintosh') || ua.includes('Mac OS X') || hints.platform === 'MacIntel';
  if (macLike) return touch ? 'ipados' : 'macos';
  if (ua.includes('CrOS')) return 'linux';
  if (ua.includes('Linux')) return 'linux';
  return null;
}

function isHttps(url: string | null): boolean {
  return url !== null && url.startsWith('https://');
}

/** Every field a row must satisfy before a control may exist. */
function classify(release: Release): { state: ReleaseRow['state']; reason: UnavailableReason | null } {
  if (release.availability === 'waitlist') return { state: 'waitlist', reason: null };
  if (release.storeUrl !== null && release.artifactUrl === null)
    return { state: 'store', reason: null };
  if (release.availability !== 'available')
    return { state: 'unavailable', reason: 'marked-unavailable' };
  if (release.artifactUrl === null) return { state: 'unavailable', reason: 'no-artifact' };
  if (!isHttps(release.artifactUrl)) return { state: 'unavailable', reason: 'insecure-artifact' };
  if (release.platform === 'macos' && release.notarization === 'required')
    return { state: 'unavailable', reason: 'notarization-incomplete' };
  if (release.signer === null || release.signer === '')
    return { state: 'unavailable', reason: 'signer-missing' };
  return { state: 'downloadable', reason: null };
}

function toRow(release: Release, currentPlatform: Platform | null): ReleaseRow {
  const { state, reason } = classify(release);
  return {
    platform: release.platform,
    version: release.version,
    sourceSha: release.sourceSha,
    availability: release.availability,
    state,
    reason,
    isCurrentDevice: release.platform === currentPlatform,
    artifactUrl: release.artifactUrl,
    storeUrl: release.storeUrl,
    bytes: release.bytes,
    sha256: release.sha256,
  };
}

export function resolveReleases(product: string, releases: readonly Release[], hints: DeviceHints): ResolveResult {
  const matching = releases.filter((release) => release.product === product);
  if (matching.length === 0) return { ok: false, reason: 'no-releases' };

  const currentPlatform = detectPlatform(hints);
  const detection: 'known' | 'unknown' = currentPlatform === null ? 'unknown' : 'known';

  const rows = matching
    .map((release) => toRow(release, currentPlatform))
    .sort((a, b) => {
      if (a.isCurrentDevice !== b.isCurrentDevice) return a.isCurrentDevice ? -1 : 1;
      return platforms.indexOf(a.platform) - platforms.indexOf(b.platform);
    });

  const candidate = rows.find(
    (row) => row.platform === currentPlatform && (row.state === 'downloadable' || row.state === 'store'),
  );
  const featured = candidate === undefined ? null : candidate;

  const nothingToShow = rows.every((row) => row.state === 'unavailable');
  if (nothingToShow && detection === 'unknown') {
    return { ok: false, reason: 'platform-mismatch' };
  }

  return { ok: true, rows, detection, currentPlatform, featured };
}
