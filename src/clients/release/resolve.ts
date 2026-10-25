import {
  isHttpsUrl,
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
  | 'superseded'
  | 'waitlist'
  | 'incomplete-artifact'
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
  /** The version that replaced this one, when the manifest says so. */
  supersededBy: string | null;
  artifactUrl: string | null;
  storeUrl: string | null;
  /** Only on a row that offers a binary; null for a store or waitlist row. */
  bytes: number | null;
  sha256: string | null;
  /** RFC3339, carried so a screen can order history without re-reading the manifest. */
  acceptedAt: string;
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
      /**
       * Why nothing is featured, in words a screen can render: the device is
       * unknown, the manifest carries no row for it, or its row cannot be
       * downloaded (a named per-row reason, already on `featured`'s absence).
       */
      featuredReason: 'device-unknown' | 'platform-unavailable' | UnavailableReason | null;
    }
  // 'device-unknown' is the honest name: no platform was matched at all, so the
  // screen says "we could not identify your device", not "unsupported platform".
  | { ok: false; reason: 'no-releases' | 'device-unknown' };

/** iPadOS masquerades as macOS in the UA; touch points are the only honest tell. */
export function detectPlatform(hints: DeviceHints): Platform | null {
  const ua = hints.userAgent;
  if (ua === null || ua.trim() === '') return null;
  if (ua.includes('Windows NT')) return 'windows';
  // Android reports a Linux-flavoured UA and an iPad-like touch count: it stays Android.
  if (ua.includes('Android')) return 'android';
  if (ua.includes('iPhone') || ua.includes('iPod')) return 'ios';
  if (ua.includes('iPad')) return 'ipados';
  const touchKnown = hints.maxTouchPoints !== null && hints.maxTouchPoints !== undefined;
  const touch = touchKnown && (hints.maxTouchPoints as number) > 1;
  const macLike =
    ua.includes('Macintosh') || ua.includes('Mac OS X') || hints.platform === 'MacIntel';
  if (macLike) {
    // An iPad in desktop mode sends a Macintosh UA and no literal 'iPad'; the
    // touch count is the only tell. Without it we do not guess: a Mac is
    // ambiguous with an iPad, and guessing 'macos' would hand an iPad a .dmg.
    if (!touchKnown) return null;
    return touch ? 'ipados' : 'macos';
  }
  if (ua.includes('CrOS')) return 'linux';
  if (ua.includes('Linux')) return 'linux';
  return null;
}

/** Every field a row must satisfy before a control may exist. */
function classify(release: Release): { state: ReleaseRow['state']; reason: UnavailableReason | null } {
  // A waitlist row is a real answer for the device, not a blank: the reason
  // travels so a screen can say "join the list" instead of rendering nothing.
  if (release.availability === 'waitlist') return { state: 'waitlist', reason: 'waitlist' };
  // An owner pulling a build must win over anything the row still carries: an
  // emergency 'unavailable' with a store URL left in place is not a live link.
  if (release.availability !== 'available')
    return { state: 'unavailable', reason: 'marked-unavailable' };
  // A superseded build is history: it is shown, named, and not downloadable.
  if (release.supersededBy !== null) return { state: 'unavailable', reason: 'superseded' };
  if (release.storeUrl !== null && release.artifactUrl === null) {
    // The store link is a live link too: it gets the same https-and-no-credentials
    // check as an artifact, so a bypassing Release[] cannot surface it. It does
    // not need a notarization ticket: the store notarizes what it ships, and
    // requiring 'passed' here would refuse every genuine App Store row.
    if (!isHttpsUrl(release.storeUrl)) return { state: 'unavailable', reason: 'insecure-artifact' };
    return { state: 'store', reason: null };
  }
  if (release.artifactUrl === null) return { state: 'unavailable', reason: 'no-artifact' };
  // The schema's own check, not a second weaker one: it refuses a URL carrying
  // user:pass@ as well as a non-https scheme.
  if (!isHttpsUrl(release.artifactUrl)) return { state: 'unavailable', reason: 'insecure-artifact' };
  // Belt for a Release[] that did not come through parseManifest (which already
  // refuses a macOS row that offers a download without a passed ticket).
  if (release.platform === 'macos' && release.notarization !== 'passed')
    return { state: 'unavailable', reason: 'notarization-incomplete' };
  if (release.signer === null || release.signer.trim() === '')
    return { state: 'unavailable', reason: 'signer-missing' };
  // Belt for a Release[] that bypassed parseManifest: a download with no digest
  // is not something to hand a user.
  if (release.bytes === null || release.sha256 === null)
    return { state: 'unavailable', reason: 'incomplete-artifact' };
  return { state: 'downloadable', reason: null };
}

/**
 * A row carries a URL only when its state may use one: `artifactUrl` on
 * 'downloadable', `storeUrl` on 'store'. Every other state gets nulls, so a
 * screen that reads the URL instead of gating on `state` still cannot render a
 * link to an unsigned, insecure, pulled or superseded build.
 */
function toRow(release: Release, currentPlatform: Platform | null): ReleaseRow {
  const { state, reason } = classify(release);
  const downloadable = state === 'downloadable';
  const store = state === 'store';
  return {
    platform: release.platform,
    version: release.version,
    sourceSha: release.sourceSha,
    availability: release.availability,
    state,
    reason,
    supersededBy: release.supersededBy,
    isCurrentDevice: release.platform === currentPlatform,
    artifactUrl: downloadable ? release.artifactUrl : null,
    storeUrl: store ? release.storeUrl : null,
    bytes: downloadable ? release.bytes : null,
    sha256: downloadable ? release.sha256 : null,
    acceptedAt: release.acceptedAt,
  };
}

/** The canonical product id: the manifest and the page must agree on case and spacing. */
function canonicalProduct(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveReleases(product: string, releases: readonly Release[], hints: DeviceHints): ResolveResult {
  // Matched canonically, so a pipeline that emits 'Rhobear' and a page that asks
  // for 'rhobear' do not silently degrade to "nothing shipped yet".
  const wanted = canonicalProduct(product);
  const matching = releases.filter((release) => canonicalProduct(release.product) === wanted);
  if (matching.length === 0) return { ok: false, reason: 'no-releases' };

  const currentPlatform = detectPlatform(hints);
  const detection: 'known' | 'unknown' = currentPlatform === null ? 'unknown' : 'known';

  const rows = matching
    .map((release) => toRow(release, currentPlatform))
    .sort((a, b) => {
      if (a.isCurrentDevice !== b.isCurrentDevice) return a.isCurrentDevice ? -1 : 1;
      const byPlatform = platforms.indexOf(a.platform) - platforms.indexOf(b.platform);
      if (byPlatform !== 0) return byPlatform;
      // Within one platform the live build comes before the history, then the
      // newest accepted first: a superseded build never renders above the one
      // that replaced it.
      const aSuperseded = a.supersededBy === null ? 0 : 1;
      const bSuperseded = b.supersededBy === null ? 0 : 1;
      if (aSuperseded !== bSuperseded) return aSuperseded - bSuperseded;
      const byAccepted = Date.parse(b.acceptedAt) - Date.parse(a.acceptedAt);
      if (Number.isFinite(byAccepted) && byAccepted !== 0) return byAccepted;
      return b.version.localeCompare(a.version, undefined, { numeric: true });
    });

  // Featured is the device's live row: a superseded row can never be it, because
  // classify() already refuses to mark one downloadable or store.
  const candidate = rows.find(
    (row) =>
      row.platform === currentPlatform &&
      row.supersededBy === null &&
      (row.state === 'downloadable' || row.state === 'store'),
  );
  const featured = candidate === undefined ? null : candidate;

  const nothingToShow = rows.every((row) => row.state === 'unavailable');
  if (nothingToShow && detection === 'unknown') {
    return { ok: false, reason: 'device-unknown' };
  }

  // What a screen says when there is nothing to feature. 'platform-unavailable'
  // is the honest signal for "we know the device and the manifest has no row for
  // it", which is otherwise indistinguishable from "the row exists but is not
  // downloadable".
  const deviceRow = currentPlatform === null
    ? undefined
    : rows.find((row) => row.platform === currentPlatform);
  const featuredReason: 'device-unknown' | 'platform-unavailable' | UnavailableReason | null =
    featured !== null
      ? null
      : currentPlatform === null
        ? 'device-unknown'
        : deviceRow === undefined
          ? 'platform-unavailable'
          : deviceRow.reason;

  return { ok: true, rows, detection, currentPlatform, featured, featuredReason };
}
