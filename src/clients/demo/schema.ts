// W0-05a: hand-written wire validation for `rhobear.demo-package.v1` plus the
// scenario registry. Every public demo is footage pending until Captur'd (L8c)
// publishes an immutable, fully watched, owner-approved package; this module is
// the only place that decides whether a fetched body even claims to be one.
//
// House style, as set by `src/clients/money/schema.ts` and
// `src/clients/release/schema.ts`: no schema library, no coercion, no network,
// no suppressed type errors, no logging. Parsers build a fresh object field by
// field (allowlist — never a spread of the raw body), so unknown keys are
// dropped before any screen sees them, and every refusal is a named
// `{ problem }` code, never null and never a coerced package.
//
// Two conventions this module pins, both stated in the PR:
//   - `contentHash` is the lowercase-hex SHA-256 of the serialized package with
//     the `contentHash` key removed (a digest cannot cover itself). Serialized
//     means one canonical form — object keys sorted at every level, finite
//     numbers as `JSON.stringify` writes them — defined in `./resolve.ts`, so
//     key order and number spelling cannot change the digest. It is corruption
//     detection, not a signature: the mirror host is the trust anchor.
//   - Every URL in a package must be https, carry no credentials, carry no
//     query and no fragment at all (an immutable link has neither, and a
//     denylist of parameter names is a promise to keep it complete forever),
//     and contain the package revision as a whole path segment — that
//     anchoring is what makes a URL immutable.
//   - A package revision has one shape: `rev-` plus a non-empty run of
//     alphanumerics, dots and dashes — the publisher's stamp, as in
//     `rev-2026-10-25-1`. That format is assumed (L8c's publisher is the one
//     this front door has seen); if it ever stamps differently,
//     `PACKAGE_REVISION_PATTERN` is the single place to change.
//   - `interactive.sandbox` is an allow-list of known sandbox tokens,
//     normalized to a single-space token list; `allow-same-origin` is refused
//     outright. W0-05b applies it verbatim as an iframe sandbox attribute.

import { isRfc3339, isHttpsUrl } from '../release/schema';
// The board names the scenarios; this client imports them rather than
// duplicating the table. A scenario id invented here would be drift.
import { engines } from '../../data/engines';

export const DEMO_PACKAGE_SCHEMA = 'rhobear.demo-package.v1';

export type PublicationState = 'pending' | 'approved' | 'superseded' | 'revoked';

export const PUBLICATION_STATES: readonly PublicationState[] = [
  'pending',
  'approved',
  'superseded',
  'revoked',
];

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
// The revision shape (see the header): `rev-` plus a non-empty run of
// alphanumerics, dots and dashes. A revision validated only as non-empty —
// 's', '1', 'demos' — matches almost any media path, so the shape is enforced
// wherever a revision is taken from a body.
const PACKAGE_REVISION_PATTERN = /^rev-[A-Za-z0-9._-]+$/;

// The sandbox tokens a package may name: the known iframe sandbox tokens
// minus `allow-same-origin`, which is refused outright — beside
// `allow-scripts` it would let the framed page act as the front-door origin
// and escape the sandbox entirely. An allow-list, never a denylist: a token
// that is not here is `bad-interactive`.
const SANDBOX_TOKENS: readonly string[] = [
  'allow-downloads',
  'allow-downloads-without-user-activation',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
];

export type DemoChapter = { label: string; startSeconds: number };

export type DemoRendition = {
  url: string;
  mime: 'video/mp4';
  width: number;
  height: number;
  durationSeconds: number;
  chapters: readonly DemoChapter[];
};

export type DemoInteractive = {
  url: string;
  /** The normalized, single-space token list from the sandbox allow-list. */
  sandbox: string;
};

export type DemoEvidence = {
  inputs: readonly string[];
  runIds: readonly string[];
  logs: readonly string[];
  artifactHashes: readonly string[];
};

export type DemoApproval = {
  // May be '' before approval; resolve() refuses an `approved` package without
  // a named approver.
  approvedBy: string;
  // RFC3339 when approval is complete; resolve() re-checks the instant.
  approvedAt: string;
  // The contract publishes literally `true`. Over the wire this arrives as a
  // boolean, so shape-wise any boolean parses here; resolve() refuses an
  // `approved` package whose value is not literally true, because that is
  // where the refusal can be named on the screen instead of buried as a shape
  // error. A `pending` package legitimately has no completed watch yet.
  watchedComplete: boolean;
};

export type DemoPackage = {
  schema: typeof DEMO_PACKAGE_SCHEMA;
  engineOrProduct: string;
  scenarioId: string;
  packageRevision: string;
  publicationState: PublicationState;
  sourceApp: string;
  sourceRevision: string; // 40 hex, stored lowercase
  renditions: readonly DemoRendition[];
  posterUrl: string;
  // Both required for an approved package (resolve enforces
  // `captions-required`); absent on a package that is not approved yet.
  captionsUrl: string | null; // WebVTT
  transcriptUrl: string | null;
  interactive: DemoInteractive | null;
  evidence: DemoEvidence;
  approval: DemoApproval;
  // SHA-256 of the serialized body with this key removed; see the header.
  contentHash: string;
  immutableUrls: true;
};

export type DemoProblem =
  | 'not-an-object'
  | 'wrong-schema'
  | 'bad-scenario-id'
  | 'bad-engine-or-product'
  | 'bad-package-revision'
  | 'bad-source-app'
  | 'bad-source-revision'
  | 'bad-publication-state'
  | 'bad-immutable'
  | 'empty-renditions'
  | 'bad-rendition'
  | 'bad-url'
  | 'bad-interactive'
  | 'bad-evidence'
  | 'bad-approval'
  | 'bad-content-hash'
  // The registry's refusal for a valid-shaped scenario id the board's table
  // does not name (`parseScenarioRegistry` returns it); it sits in this table
  // because the demo surface's refusal codes are one set.
  | 'unknown-scenario';

export type ParsedDemoPackage = { package: DemoPackage } | { problem: DemoProblem };

// The scenario ids the /engines deep link may carry: lowercase, then lowercase
// alphanumerics and dashes. The same guard validates the id before it is ever
// interpolated into a mirror URL.
export const SCENARIO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isScenarioId(value: string): boolean {
  return value.length <= 64 && SCENARIO_ID_PATTERN.test(value);
}

/**
 * The immutability gate every package URL must pass: https (and no smuggled
 * credentials, via the release client's rule), no query and no fragment at
 * all — a cached signed link would break and an access grant would leak — and
 * a path anchored to the package revision as a whole segment.
 */
export function isImmutableHttpsUrl(value: string, packageRevision: string): boolean {
  if (!isHttpsUrl(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // The signed/expiring parameter shapes, named as documentation of the
  // class: any of these condemns the URL outright.
  for (const name of url.searchParams.keys()) {
    const lower = name.toLowerCase();
    if (lower.startsWith('x-amz-')) return false;
    if (lower === 'token' || lower === 'signature' || lower === 'sig' || lower === 'expires') {
      return false;
    }
  }
  // …and an immutable link carries no query and no fragment at all. An
  // allow-list of parameter names would be a promise to keep it complete
  // forever — GCS signs with X-Goog-Signature/X-Goog-Expires, CloudFront with
  // Policy and Key-Pair-Id, Azure SAS with se/sp — and url.searchParams never
  // even sees a fragment, where #token=… would hide.
  if (url.search !== '' || url.hash !== '') return false;
  // The revision is anchored as a whole path segment: a substring match — the
  // revision inside a longer segment — is not a promise that the bytes under
  // this URL are the ones that were verified.
  return url.pathname.split('/').includes(packageRevision);
}

// One isRecord for the whole demo surface: `./resolve.ts` imports this copy.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPublicationState(value: unknown): value is PublicationState {
  return typeof value === 'string' && (PUBLICATION_STATES as readonly string[]).includes(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A list of strings, or null when the value is not one. */
function parseStringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

/** Absent (undefined/null) normalizes to []; present must be a string list. */
function optionalList(value: unknown): readonly string[] | null {
  if (value === undefined || value === null) return [];
  return parseStringList(value);
}

type RenditionParse = { rendition: DemoRendition } | { problem: 'bad-url' | 'bad-rendition' };

function parseRendition(raw: unknown, packageRevision: string): RenditionParse {
  if (!isRecord(raw)) return { problem: 'bad-rendition' };
  // Every URL rule in the package shares one code: a rendition URL that is not
  // https, not immutable or not revision-anchored is refused as bad-url.
  if (typeof raw.url !== 'string' || !isImmutableHttpsUrl(raw.url, packageRevision)) {
    return { problem: 'bad-url' };
  }
  if (raw.mime !== 'video/mp4') return { problem: 'bad-rendition' };
  if (typeof raw.width !== 'number' || !Number.isInteger(raw.width) || raw.width <= 0) {
    return { problem: 'bad-rendition' };
  }
  if (typeof raw.height !== 'number' || !Number.isInteger(raw.height) || raw.height <= 0) {
    return { problem: 'bad-rendition' };
  }
  if (
    typeof raw.durationSeconds !== 'number' ||
    !Number.isFinite(raw.durationSeconds) ||
    raw.durationSeconds <= 0
  ) {
    return { problem: 'bad-rendition' };
  }
  if (!Array.isArray(raw.chapters)) return { problem: 'bad-rendition' };
  const chapters: DemoChapter[] = [];
  for (const item of raw.chapters) {
    if (!isRecord(item)) return { problem: 'bad-rendition' };
    if (!nonEmptyString(item.label)) return { problem: 'bad-rendition' };
    if (
      typeof item.startSeconds !== 'number' ||
      !Number.isFinite(item.startSeconds) ||
      item.startSeconds < 0
    ) {
      return { problem: 'bad-rendition' };
    }
    chapters.push({ label: item.label.trim(), startSeconds: item.startSeconds });
  }
  return {
    rendition: {
      url: raw.url,
      mime: 'video/mp4',
      width: raw.width,
      height: raw.height,
      durationSeconds: raw.durationSeconds,
      chapters,
    },
  };
}

function parseEvidence(value: unknown): DemoEvidence | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.artifactHashes)) return null;
  const artifactHashes: string[] = [];
  for (const hash of value.artifactHashes) {
    if (typeof hash !== 'string' || !HEX64.test(hash.trim().toLowerCase())) return null;
    artifactHashes.push(hash.trim().toLowerCase());
  }
  const inputs = optionalList(value.inputs);
  const runIds = optionalList(value.runIds);
  const logs = optionalList(value.logs);
  if (inputs === null || runIds === null || logs === null) return null;
  return { inputs, runIds, logs, artifactHashes };
}

/**
 * Validate one package body. The first problem wins, in a fixed order:
 * not-an-object → wrong-schema → bad-scenario-id → bad-engine-or-product →
 * bad-package-revision → bad-source-app → bad-source-revision →
 * bad-publication-state → bad-immutable → empty-renditions → bad-rendition →
 * bad-url (renditions, poster, captions, transcript) → bad-interactive →
 * bad-evidence → bad-approval → bad-content-hash. Tests feed one violation at
 * a time, so the returned code is always the one the fixture named.
 */
export function parseDemoPackage(raw: unknown): ParsedDemoPackage {
  if (!isRecord(raw)) return { problem: 'not-an-object' };
  if (raw.schema !== DEMO_PACKAGE_SCHEMA) return { problem: 'wrong-schema' };

  const scenarioIdRaw = raw.scenarioId;
  if (typeof scenarioIdRaw !== 'string' || !isScenarioId(scenarioIdRaw.trim())) {
    return { problem: 'bad-scenario-id' };
  }
  const scenarioId = scenarioIdRaw.trim();
  if (!nonEmptyString(raw.engineOrProduct)) return { problem: 'bad-engine-or-product' };
  if (
    typeof raw.packageRevision !== 'string' ||
    !PACKAGE_REVISION_PATTERN.test(raw.packageRevision.trim())
  ) {
    return { problem: 'bad-package-revision' };
  }
  const packageRevision = raw.packageRevision.trim();
  if (!nonEmptyString(raw.sourceApp)) return { problem: 'bad-source-app' };
  const sourceRevisionRaw = raw.sourceRevision;
  if (typeof sourceRevisionRaw !== 'string' || !HEX40.test(sourceRevisionRaw.trim().toLowerCase())) {
    return { problem: 'bad-source-revision' };
  }
  if (!isPublicationState(raw.publicationState)) return { problem: 'bad-publication-state' };
  // The envelope either declares its URLs immutable or it is not a package.
  if (raw.immutableUrls !== true) return { problem: 'bad-immutable' };

  if (!Array.isArray(raw.renditions) || raw.renditions.length === 0) {
    return { problem: 'empty-renditions' };
  }
  const renditions: DemoRendition[] = [];
  for (const item of raw.renditions) {
    const parsed = parseRendition(item, packageRevision);
    if ('problem' in parsed) return parsed;
    renditions.push(parsed.rendition);
  }

  const posterUrl = raw.posterUrl;
  if (typeof posterUrl !== 'string' || !isImmutableHttpsUrl(posterUrl, packageRevision)) {
    return { problem: 'bad-url' };
  }
  let captionsUrl: string | null = null;
  if (raw.captionsUrl !== undefined && raw.captionsUrl !== null) {
    if (typeof raw.captionsUrl !== 'string' || !isImmutableHttpsUrl(raw.captionsUrl, packageRevision)) {
      return { problem: 'bad-url' };
    }
    captionsUrl = raw.captionsUrl;
  }
  let transcriptUrl: string | null = null;
  if (raw.transcriptUrl !== undefined && raw.transcriptUrl !== null) {
    if (
      typeof raw.transcriptUrl !== 'string' ||
      !isImmutableHttpsUrl(raw.transcriptUrl, packageRevision)
    ) {
      return { problem: 'bad-url' };
    }
    transcriptUrl = raw.transcriptUrl;
  }

  let interactive: DemoInteractive | null = null;
  if (raw.interactive !== undefined && raw.interactive !== null) {
    const candidate = raw.interactive;
    if (!isRecord(candidate)) return { problem: 'bad-interactive' };
    if (typeof candidate.url !== 'string' || !isImmutableHttpsUrl(candidate.url, packageRevision)) {
      return { problem: 'bad-interactive' };
    }
    if (typeof candidate.sandbox !== 'string') return { problem: 'bad-interactive' };
    // Split on any whitespace — tabs and repeated spaces are just spacing.
    const sandboxTokens = candidate.sandbox.trim().split(/\s+/);
    if (sandboxTokens[0] === '') return { problem: 'bad-interactive' };
    for (const token of sandboxTokens) {
      if (!(SANDBOX_TOKENS as readonly string[]).includes(token)) {
        return { problem: 'bad-interactive' };
      }
    }
    interactive = { url: candidate.url, sandbox: sandboxTokens.join(' ') };
  }

  const evidence = parseEvidence(raw.evidence);
  if (evidence === null) return { problem: 'bad-evidence' };

  const approvalRaw = raw.approval;
  if (!isRecord(approvalRaw)) return { problem: 'bad-approval' };
  if (
    typeof approvalRaw.approvedBy !== 'string' ||
    typeof approvalRaw.approvedAt !== 'string' ||
    typeof approvalRaw.watchedComplete !== 'boolean'
  ) {
    return { problem: 'bad-approval' };
  }

  const contentHash = raw.contentHash;
  if (typeof contentHash !== 'string' || !HEX64.test(contentHash.trim().toLowerCase())) {
    return { problem: 'bad-content-hash' };
  }

  return {
    package: {
      schema: DEMO_PACKAGE_SCHEMA,
      engineOrProduct: raw.engineOrProduct.trim(),
      scenarioId,
      packageRevision,
      publicationState: raw.publicationState,
      sourceApp: raw.sourceApp.trim(),
      sourceRevision: sourceRevisionRaw.trim().toLowerCase(),
      renditions,
      posterUrl,
      captionsUrl,
      transcriptUrl,
      interactive,
      evidence,
      approval: {
        approvedBy: approvalRaw.approvedBy.trim(),
        approvedAt: approvalRaw.approvedAt,
        watchedComplete: approvalRaw.watchedComplete,
      },
      contentHash: contentHash.trim().toLowerCase(),
      immutableUrls: true,
    },
  };
}

/** The board's scenario ids, imported from the engines data — the registry names these and no others, and `parseScenarioRegistry` enforces it: any other id is `unknown-scenario`. */
export const KNOWN_SCENARIO_IDS: readonly string[] = Object.freeze(
  engines.flatMap((engine) => [...engine.scenarioIds]),
);

export type ScenarioRegistryRow = {
  scenarioId: string;
  engine: string;
  title: string;
  oneLiner: string;
  posterAlt: string;
  order: number;
};

export type ScenarioRegistry = readonly ScenarioRegistryRow[];

export type RegistryProblem = 'not-an-array' | 'bad-row' | 'duplicate-scenario' | 'unknown-scenario';

/**
 * The /engines index input, validated. A registry row the board does not know
 * would name an invented scenario, so the id must pass the same shape guard a
 * deep link does and must name a scenario the board knows — anything else is
 * `unknown-scenario`, the drift the table above exists to stop; titles and alt
 * text must be present because a screen renders them and poster alt text is
 * not optional.
 */
export function parseScenarioRegistry(
  raw: unknown,
): { rows: ScenarioRegistry } | { problem: RegistryProblem } {
  if (!Array.isArray(raw)) return { problem: 'not-an-array' };
  const rows: ScenarioRegistryRow[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) return { problem: 'bad-row' };
    const scenarioId = item.scenarioId;
    if (typeof scenarioId !== 'string' || !isScenarioId(scenarioId.trim())) {
      return { problem: 'bad-row' };
    }
    const id = scenarioId.trim();
    // KNOWN_SCENARIO_IDS is enforced, not merely documented: the registry
    // names the board's scenarios and no others.
    if (!KNOWN_SCENARIO_IDS.includes(id)) return { problem: 'unknown-scenario' };
    if (
      !nonEmptyString(item.engine) ||
      !nonEmptyString(item.title) ||
      !nonEmptyString(item.oneLiner) ||
      !nonEmptyString(item.posterAlt) ||
      typeof item.order !== 'number' ||
      !Number.isFinite(item.order)
    ) {
      return { problem: 'bad-row' };
    }
    if (seen.has(id)) return { problem: 'duplicate-scenario' };
    seen.add(id);
    rows.push({
      scenarioId: id,
      engine: item.engine.trim(),
      title: item.title.trim(),
      oneLiner: item.oneLiner.trim(),
      posterAlt: item.posterAlt.trim(),
      order: item.order,
    });
  }
  return { rows };
}

// isRfc3339 is imported above for re-export convenience of the demo surface:
// resolve.ts and W0-05b's player both judge `approval.approvedAt` with it.
export { isRfc3339 };
