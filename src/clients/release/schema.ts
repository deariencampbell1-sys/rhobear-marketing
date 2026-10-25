// W0-04a: the only place that decides whether a release row is real. A
// download button may only exist when an accepted, signed (or notarized where
// required) artifact exists for that product and that platform. Every parser
// here fails closed and builds a fresh object field by field (allowlist —
// never a spread of `raw`), so unknown keys are dropped before any screen
// sees them. Hand-written validation in the house style of
// `src/clients/money/schema.ts`: no schema library, no coercion, no network,
// no suppressed type errors, no logging.

export const RELEASE_SCHEMA = 'rhobear.release.v1';
export const RELEASE_MANIFEST_SCHEMA = 'rhobear.release-manifest.v1';

export const platforms = ['windows', 'macos', 'linux', 'ios', 'ipados', 'android', 'web', 'cli'] as const;
export type Platform = (typeof platforms)[number];

// Hashes are compared case-insensitively and stored lowercase: a CI tool that
// emits uppercase SHA-256 is a valid digest, not a broken release.
const hex64 = /^[0-9a-f]{64}$/;
const hex40 = /^[0-9a-f]{40}$/;

export type ReleaseAvailability = 'available' | 'unavailable' | 'waitlist';
export type Notarization = 'not-applicable' | 'required' | 'passed';

export type Release = {
  schema: typeof RELEASE_SCHEMA;
  product: string;
  platform: Platform;
  version: string;
  sourceSha: string;
  artifactUrl: string | null;
  storeUrl: string | null;
  bytes: number;
  sha256: string;
  signer: string | null;
  notarization: Notarization;
  availability: ReleaseAvailability;
  acceptedAt: string; // RFC3339
  supersededBy: string | null; // version that replaced this row, if any
};

export type ReleaseManifest = { schema?: typeof RELEASE_MANIFEST_SCHEMA; releases: readonly Release[] };

export type ManifestProblem =
  | 'not-an-object' | 'wrong-schema' | 'bad-platform' | 'bad-sha256' | 'bad-source-sha' | 'bad-bytes'
  | 'bad-url' | 'bad-accepted-at' | 'no-target' | 'notarization-not-passed' | 'duplicate-platform'
  | 'ambiguous-supersede' | 'empty';

export type ParsedManifest =
  | { ok: true; releases: readonly Release[] }
  | { ok: false; problems: readonly ManifestProblem[] };

const RFC3339_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Strict shape first, then a real instant — never a junk string Date coerces. */
export function isRfc3339(value: string): boolean {
  if (!RFC3339_SHAPE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/** https only; a URL carrying credentials (user:pass@) is never a download. */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The unit both manifest rules are judged in: one (product, platform) group. */
function groupKey(product: string, platform: Platform): string {
  return product + '\u0000' + platform;
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (platforms as readonly string[]).includes(value);
}

function isAvailability(value: unknown): value is ReleaseAvailability {
  return value === 'available' || value === 'unavailable' || value === 'waitlist';
}

function isNotarization(value: unknown): value is Notarization {
  return value === 'not-applicable' || value === 'required' || value === 'passed';
}

/**
 * Validate one row, returning the first problem in a fixed order so callers
 * and tests always see the same reason for the same broken row:
 * not-an-object → wrong-schema → bad-platform → bad-source-sha → bad-sha256 →
 * bad-bytes → bad-url → bad-accepted-at → no-target → notarization-not-passed.
 */
export function parseRelease(raw: unknown): { release: Release } | { problem: ManifestProblem } {
  if (!isRecord(raw)) return { problem: 'not-an-object' };
  const schema = raw.schema;
  const product = raw.product;
  const platform = raw.platform;
  const version = raw.version;
  const sourceSha = raw.sourceSha;
  const artifactUrl = raw.artifactUrl;
  const storeUrl = raw.storeUrl;
  const bytes = raw.bytes;
  const sha256 = raw.sha256;
  const signer = raw.signer;
  const notarization = raw.notarization;
  const availability = raw.availability;
  const acceptedAt = raw.acceptedAt;
  const supersededBy = raw.supersededBy;
  // Shape of fields that carry no dedicated problem code: not-an-object.
  if (typeof product !== 'string' || product.length === 0) return { problem: 'not-an-object' };
  if (typeof version !== 'string' || version.length === 0) return { problem: 'not-an-object' };
  if (!isAvailability(availability)) return { problem: 'not-an-object' };
  if (!isNotarization(notarization)) return { problem: 'not-an-object' };
  if (signer !== undefined && signer !== null && typeof signer !== 'string') {
    return { problem: 'not-an-object' };
  }
  if (supersededBy !== undefined && supersededBy !== null && typeof supersededBy !== 'string') {
    return { problem: 'not-an-object' };
  }
  if (schema !== RELEASE_SCHEMA) return { problem: 'wrong-schema' };
  if (!isPlatform(platform)) return { problem: 'bad-platform' };
  if (typeof sourceSha !== 'string' || !hex40.test(sourceSha.toLowerCase())) return { problem: 'bad-source-sha' };
  if (typeof sha256 !== 'string' || !hex64.test(sha256.toLowerCase())) return { problem: 'bad-sha256' };
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) {
    return { problem: 'bad-bytes' };
  }
  let artifact: string | null = null;
  if (artifactUrl !== undefined && artifactUrl !== null) {
    if (typeof artifactUrl !== 'string' || !isHttpsUrl(artifactUrl)) return { problem: 'bad-url' };
    artifact = artifactUrl;
  }
  let store: string | null = null;
  if (storeUrl !== undefined && storeUrl !== null) {
    if (typeof storeUrl !== 'string' || !isHttpsUrl(storeUrl)) return { problem: 'bad-url' };
    store = storeUrl;
  }
  if (typeof acceptedAt !== 'string' || !isRfc3339(acceptedAt)) return { problem: 'bad-accepted-at' };
  // A row the owner can act on must point somewhere: no download and no store
  // listing is not a release this platform can launch.
  if (availability === 'available' && artifact === null && store === null) {
    return { problem: 'no-target' };
  }
  // macOS ships notarized or not at all: 'required' means the ticket was
  // requested but has not come back, so no button may exist yet.
  // macOS ships notarized or not at all: 'required' means the ticket was
  // requested but has not come back, and 'not-applicable' on a macOS row is a
  // data error, so neither may produce a download button.
  if (platform === 'macos' && notarization !== 'passed') {
    return { problem: 'notarization-not-passed' };
  }
  const signerValue = typeof signer === 'string' && signer.trim().length > 0 ? signer : null;
  const supersededValue =
    typeof supersededBy === 'string' && supersededBy.trim().length > 0 ? supersededBy : null;
  return {
    release: {
      schema: RELEASE_SCHEMA,
      product,
      platform,
      version,
      sourceSha: sourceSha.toLowerCase(),
      artifactUrl: artifact,
      storeUrl: store,
      bytes,
      sha256: sha256.toLowerCase(),
      signer: signerValue,
      notarization,
      availability,
      acceptedAt,
      supersededBy: supersededValue,
    },
  };
}

/**
 * Accepts a bare array of rows or `{ schema, releases }`. Collects every
 * problem rather than stopping at the first — and any problem means ok:false,
 * never a partial list a screen could render a button from.
 *
 * Granularity, decided here and stated once: the manifest is all-or-nothing. A
 * manifest is produced by our own publish pipeline, so a row that is not
 * notarized (or has no target, or a bad hash) is a publishing error and must
 * fail the whole manifest before it ships — a release page that quietly drops
 * one platform is worse than one that says "no releases yet". `resolve.ts`
 * still carries a per-row `notarization-incomplete` reason; it is a belt for a
 * `Release[]` that did not come through this function, not a second policy.
 */
export function parseManifest(raw: unknown): ParsedManifest {
  const problems: ManifestProblem[] = [];
  let rows: unknown[];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (isRecord(raw)) {
    if (raw.schema !== undefined && raw.schema !== RELEASE_MANIFEST_SCHEMA) {
      problems.push('wrong-schema');
    }
    if (!Array.isArray(raw.releases)) return { ok: false, problems: [...problems, 'not-an-object'] };
    rows = raw.releases;
  } else {
    return { ok: false, problems: ['not-an-object'] };
  }
  if (rows.length === 0) return { ok: false, problems: [...problems, 'empty'] };
  const releases: Release[] = [];
  for (const row of rows) {
    const parsed = parseRelease(row);
    if ('problem' in parsed) problems.push(parsed.problem);
    else releases.push(parsed.release);
  }
  // Group by (product, platform): the owner launches platform by platform, so
  // that pair is the unit both manifest rules are judged in.
  const groups = new Map<string, Release[]>();
  for (const release of releases) {
    const key = groupKey(release.product, release.platform);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [release]);
    else group.push(release);
  }
  for (const group of groups.values()) {
    // Exactly one live row per group. A supersede chain (v1 -> v2 -> v3, only
    // v3 live) is the normal history of two cut releases and is not a
    // duplicate; two rows that both claim to be current are.
    const live = group.filter((release) => release.supersededBy === null);
    if (live.length > 1) problems.push('duplicate-platform');
  }
  for (const group of groups.values()) {
    // A supersede target must exist in the same group — a macos row superseded
    // by a Windows version string is an orphan, not a chain — and every chain
    // must reach a live head rather than loop.
    const versions = new Set(group.map((release) => release.version));
    for (const release of group) {
      if (release.supersededBy === null) continue;
      if (!versions.has(release.supersededBy) || release.supersededBy === release.version) {
        problems.push('ambiguous-supersede');
        continue;
      }
      const byVersion = new Map(group.map((row) => [row.version, row] as const));
      let cursor: Release | undefined = release;
      let steps = 0;
      while (cursor !== undefined && cursor.supersededBy !== null && steps <= group.length) {
        cursor = byVersion.get(cursor.supersededBy);
        steps += 1;
      }
      if (cursor === undefined || cursor.supersededBy !== null) problems.push('ambiguous-supersede');
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, releases };
}
