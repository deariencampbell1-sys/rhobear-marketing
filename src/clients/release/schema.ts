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
  if (typeof sourceSha !== 'string' || !hex40.test(sourceSha)) return { problem: 'bad-source-sha' };
  if (typeof sha256 !== 'string' || !hex64.test(sha256)) return { problem: 'bad-sha256' };
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
  if (platform === 'macos' && notarization === 'required') {
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
      sourceSha,
      artifactUrl: artifact,
      storeUrl: store,
      bytes,
      sha256,
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
  // Two live rows for one (product, platform) is ambiguous unless one names
  // the other as its replacement: the owner launches platform by platform.
  const flagged = new Set<string>();
  for (let i = 0; i < releases.length; i++) {
    for (let j = i + 1; j < releases.length; j++) {
      const a = releases[i];
      const b = releases[j];
      if (a.product !== b.product || a.platform !== b.platform) continue;
      if (a.supersededBy === b.version || b.supersededBy === a.version) continue;
      const key = a.product + '\u0000' + a.platform;
      if (flagged.has(key)) continue;
      flagged.add(key);
      problems.push('duplicate-platform');
    }
  }
  const versions = new Set<string>();
  for (const release of releases) versions.add(release.version);
  for (const release of releases) {
    if (release.supersededBy !== null && !versions.has(release.supersededBy)) {
      problems.push('ambiguous-supersede');
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, releases };
}
