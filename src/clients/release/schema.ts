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
  // A hash and a size describe a binary. A row with no artifact (a store
  // listing, a waitlist row) has neither, and must not invent them.
  bytes: number | null;
  sha256: string | null;
  signer: string | null;
  notarization: Notarization;
  availability: ReleaseAvailability;
  acceptedAt: string; // RFC3339
  supersededBy: string | null; // version that replaced this row, if any
};

export type ReleaseManifest = { schema?: typeof RELEASE_MANIFEST_SCHEMA; releases: readonly Release[] };

export type ManifestProblem =
  | 'not-an-object' | 'wrong-schema' | 'bad-platform' | 'bad-sha256' | 'bad-source-sha' | 'bad-bytes'
  | 'bad-url' | 'bad-accepted-at' | 'no-target' | 'notarization-not-passed' | 'signer-missing'
  | 'duplicate-platform'
  | 'ambiguous-supersede' | 'empty';

export type ParsedManifest =
  | { ok: true; releases: readonly Release[] }
  | { ok: false; problems: readonly ManifestProblem[] };

// RFC3339 as published: a 'Z' or a numeric offset (a pipeline may emit either).
const RFC3339_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

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

/**
 * The optional host policy. `isHttpsUrl` proves the scheme and that no
 * credential is smuggled in; it cannot know which hosts we ship from. A caller
 * that knows (the site, once the release host is fixed) passes the allowlist
 * here, so a tampered manifest cannot point the button at an attacker's host.
 * Without it the contract is "any https origin", which is what a first release
 * with an undecided CDN needs; the test below pins both behaviours.
 */
export type ParseOptions = {
  /** Hosts a download may come from. Omitted or empty means any https origin. */
  allowedArtifactHosts?: readonly string[];
  /**
   * Hosts a store link may point at. Separate from the artifact list on purpose:
   * a caller that pins only its own download CDN must not thereby reject every
   * App Store and Play row (and, with an all-or-nothing manifest, blank the
   * whole page).
   */
  allowedStoreHosts?: readonly string[];
};

function hostAllowed(value: string, hosts: readonly string[] | undefined): boolean {
  if (hosts === undefined || hosts.length === 0) return true;
  try {
    return hosts.includes(new URL(value).host);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The unit both manifest rules are judged in: one (product, platform) group.
 * The product id is canonicalised exactly as `resolve.ts` matches it, so a
 * mixed-case or padded id cannot slip two live rows past the rule.
 */
function groupKey(product: string, platform: Platform): string {
  return product.trim().toLowerCase() + '\u0000' + platform;
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
export function parseRelease(raw: unknown, options: ParseOptions = {}): { release: Release } | { problem: ManifestProblem } {
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
  if (bytes !== undefined && bytes !== null && (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0)) {
    return { problem: 'bad-bytes' };
  }
  if (sha256 !== undefined && sha256 !== null
    && (typeof sha256 !== 'string' || !hex64.test(sha256.toLowerCase()))) {
    return { problem: 'bad-sha256' };
  }
  let artifact: string | null = null;
  if (artifactUrl !== undefined && artifactUrl !== null) {
    if (typeof artifactUrl !== 'string' || !isHttpsUrl(artifactUrl)
      || !hostAllowed(artifactUrl, options.allowedArtifactHosts)) {
      return { problem: 'bad-url' };
    }
    artifact = artifactUrl;
  }
  let store: string | null = null;
  if (storeUrl !== undefined && storeUrl !== null) {
    if (typeof storeUrl !== 'string' || !isHttpsUrl(storeUrl)
      || !hostAllowed(storeUrl, options.allowedStoreHosts)) {
      return { problem: 'bad-url' };
    }
    store = storeUrl;
  }
  if (artifact !== null && (bytes === undefined || bytes === null || typeof bytes !== 'number')) {
    return { problem: 'bad-bytes' };
  }
  if (artifact !== null && (sha256 === undefined || sha256 === null || typeof sha256 !== 'string')) {
    return { problem: 'bad-sha256' };
  }
  if (typeof acceptedAt !== 'string' || !isRfc3339(acceptedAt)) return { problem: 'bad-accepted-at' };
  // A row the owner can act on must point somewhere: no download and no store
  // listing is not a release this platform can launch.
  if (availability === 'available' && artifact === null && store === null) {
    return { problem: 'no-target' };
  }
  // Every direct download is signed: the manifest refuses an artifact without a
  // signer, so the all-or-nothing rationale covers the field the button depends
  // on, not just notarization. (A store row is signed by the store.)
  if (artifact !== null) {
    const signerValue = typeof signer === 'string' ? signer.trim() : '';
    if (signerValue.length === 0) return { problem: 'signer-missing' };
  }
  // macOS ships notarized or not at all — but only for a direct download. A
  // store row is notarized by the store, and a pulled or waitlist row ships
  // nothing at all, so neither may be forced to assert a ticket it has not got
  // (that would be a false attestation, and with an all-or-nothing manifest it
  // would blank every other platform too).
  if (platform === 'macos' && artifact !== null && notarization !== 'passed') {
    return { problem: 'notarization-not-passed' };
  }
  // Trimmed and stored trimmed: the chain rules compare these strings, so a
  // padded value must not survive into the manifest and then fail its own lookup.
  const signerValue = typeof signer === 'string' && signer.trim().length > 0 ? signer.trim() : null;
  const supersededValue =
    typeof supersededBy === 'string' && supersededBy.trim().length > 0 ? supersededBy.trim() : null;
  return {
    release: {
      schema: RELEASE_SCHEMA,
      product,
      platform,
      version: version.trim(),
      sourceSha: sourceSha.toLowerCase(),
      artifactUrl: artifact,
      storeUrl: store,
      bytes: artifact === null ? null : (bytes as number),
      sha256: artifact === null ? null : (sha256 as string).toLowerCase(),
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
export function parseManifest(raw: unknown, options: ParseOptions = {}): ParsedManifest {
  const problems: ManifestProblem[] = [];
  let rows: unknown[];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (isRecord(raw)) {
    // The object form must name its schema: a v2 payload must not parse as v1
    // just because it omitted the field. The bare-array form is the documented
    // exception (it carries no envelope to identify).
    if (raw.schema !== RELEASE_MANIFEST_SCHEMA) problems.push('wrong-schema');
    if (!Array.isArray(raw.releases)) return { ok: false, problems: [...problems, 'not-an-object'] };
    rows = raw.releases;
  } else {
    return { ok: false, problems: ['not-an-object'] };
  }
  if (rows.length === 0) return { ok: false, problems: [...problems, 'empty'] };
  const releases: Release[] = [];
  for (const row of rows) {
    const parsed = parseRelease(row, options);
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
    const byVersion = new Map(group.map((row) => [row.version, row] as const));
    for (const release of group) {
      if (release.supersededBy === null) continue;
      if (!versions.has(release.supersededBy) || release.supersededBy === release.version) {
        problems.push('ambiguous-supersede');
        continue;
      }
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
