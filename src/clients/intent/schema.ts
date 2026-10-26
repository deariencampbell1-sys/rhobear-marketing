// W0-06: hand-written validation for the sign-in intent record — no zod, no
// schema library, in the house style of src/clients/money/schema.ts and
// src/clients/release/schema.ts. Every parser fails closed and rebuilds the
// record field by field from an allowlist (never a spread of the raw input),
// so unknown keys — and with them any credential that somehow arrived — are
// dropped before storage or a screen ever sees them.
//
// The intent is the only thing this repo carries through the sign-in handoff:
// a small, expiring, allowlisted record with an opaque random id. It never
// contains a token, session, card, receipt, email or account UUID, and its
// return route is one of the canonical routes and nothing else.

// W0-06 review r5 (finding 6): the scenario allowlist lives in ./scenarios as
// a literal and this module imports ONLY that — the runtime client must not
// import the engines registry at module load (every front-door consumer of the
// intent client would pull the whole data module into its bundle for a short
// allowlist and inherit its init-time failure modes). The drift guard moved
// with the list: tests/intent-schema.test.ts imports the registry and asserts
// the two sets are equal, in both directions, with a named failure. A rename
// in the registry must be migrated deliberately — never edited silently into
// someone's sign-in.
import { INTENT_SCENARIOS } from './scenarios';

/** The only return routes an intent may carry. Anything else is rejected. */
export const CANONICAL_RETURN_ROUTES = Object.freeze([
  '/',
  '/builds',
  '/forge',
  '/herald',
  '/regent',
  '/reviews',
  '/engines',
  '/plans',
  '/get',
  '/account',
  '/support',
  '/privacy',
  '/terms',
] as const);

export type CanonicalReturnRoute = (typeof CANONICAL_RETURN_ROUTES)[number];

export const INTENT_PRODUCTS = Object.freeze([
  'builds',
  'forge',
  'herald',
  'regent',
  'reviews',
  'engines',
] as const);
export type IntentProduct = (typeof INTENT_PRODUCTS)[number];

export const INTENT_PLANS = Object.freeze(['free', 'shell', 'shell-plus', 'space'] as const);
export type IntentPlan = (typeof INTENT_PLANS)[number];

export const INTENT_KINDS = Object.freeze(['checkout', 'install', 'demo', 'account'] as const);
export type IntentKind = (typeof INTENT_KINDS)[number];

// The allowlist itself now lives in ./scenarios (W0-06 review r5, finding 6);
// the set below is the membership check parseIntent and the store use.
const scenarioIdSet: ReadonlySet<string> = new Set(INTENT_SCENARIOS);

export type Intent = {
  id: string; // opaque, ≥ 128 bits of crypto entropy, URL-safe
  product: IntentProduct;
  scenario?: string; // allowlisted engine scenario id, when known
  plan?: IntentPlan;
  returnRoute: string; // always one of CANONICAL_RETURN_ROUTES
  kind: IntentKind;
  createdAt: string; // RFC3339
  expiresAt: string; // RFC3339
  consumedAt?: string; // RFC3339, set exactly once by the store's consume
};

/**
 * The record's declared keys. Behaviour 3: nothing here carries a credential —
 * there is no token, session, card, receipt, email or accountUuid field, and
 * `parseIntent` strips anything outside this list.
 */
export const INTENT_KEYS = Object.freeze([
  'id',
  'product',
  'scenario',
  'plan',
  'returnRoute',
  'kind',
  'createdAt',
  'expiresAt',
  'consumedAt',
] as const);

/** Behaviour 4: the serialised record is capped at 512 UTF-16 code units —
 * JSON.stringify().length counts code units, not UTF-8 bytes, and this
 * constant's name says which unit is enforced. */
export const INTENT_MAX_CHARS = 512;

export type IntentProblem =
  | 'not-an-object'
  | 'bad-id'
  | 'bad-product'
  | 'bad-plan'
  | 'bad-scenario'
  | 'bad-return-route'
  | 'bad-kind'
  | 'bad-created-at'
  | 'bad-expires-at'
  | 'bad-consumed-at'
  | 'too-large';

export type ParsedIntent = { ok: true; intent: Intent } | { ok: false; problem: IntentProblem };

// RFC3339 with an explicit zone, then a real instant — never a junk string
// Date would coerce. Same discipline as src/clients/release/schema.ts.
const RFC3339_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isRfc3339(value: string): boolean {
  if (!RFC3339_SHAPE.test(value)) return false;
  if (!Number.isFinite(Date.parse(value))) return false;
  // Date.parse normalises impossible dates (2026-02-30 becomes 2 March), so
  // the calendar is checked against the digits that were actually written.
  // new Date(0) + setUTCFullYear takes the year literally (W0-06 review r5,
  // finding 7): Date.UTC maps a year below 100 to 1900 + year and would
  // refuse a well-formed early instant.
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

// 22 unpadded base64url characters carry 132 bits (≥ 128). There is no upper
// bound here on purpose: an over-long id is refused by the 512-byte serialised
// cap with problem 'too-large', which is the one bound that covers every field
// at once.
const URL_SAFE_ID = /^[A-Za-z0-9_-]{22,}$/;

export function isIntentProduct(v: unknown): v is IntentProduct {
  return typeof v === 'string' && (INTENT_PRODUCTS as readonly string[]).includes(v);
}

export function isIntentPlan(v: unknown): v is IntentPlan {
  return typeof v === 'string' && (INTENT_PLANS as readonly string[]).includes(v);
}

export function isIntentKind(v: unknown): v is IntentKind {
  return typeof v === 'string' && (INTENT_KINDS as readonly string[]).includes(v);
}

/** Exact allowlist membership — absolute URLs, `//host`, query strings and
 * encoded traversal all fail because they are not on the list. */
export function isCanonicalReturnRoute(v: unknown): v is CanonicalReturnRoute {
  return typeof v === 'string' && (CANONICAL_RETURN_ROUTES as readonly string[]).includes(v);
}

export function isKnownScenario(v: unknown): boolean {
  return typeof v === 'string' && scenarioIdSet.has(v);
}

// Hand-rolled base64url: no Buffer in browser code, no btoa dependency.
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      out += B64URL[(value >>> (bits - 6)) & 63];
      bits -= 6;
    }
  }
  if (bits > 0) out += B64URL[(value << (6 - bits)) & 63];
  return out;
}

/**
 * Behaviour 1: the id is generated from crypto.getRandomValues and nothing
 * else. It takes no argument, so it cannot be derived from time, email,
 * account or plan; two calls in the same millisecond already differ.
 */
export function createIntentId(): string {
  const bytes = new Uint8Array(16); // 128 bits of entropy
  globalThis.crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

/**
 * The only place a stored intent record becomes trustworthy. Rejects the whole
 * record on any problem (behaviour 2: no silent fallback to '/'), rebuilds it
 * from the allowlist (behaviour 3: unknown keys stripped) and enforces the
 * 512-code-unit serialised cap (behaviour 4).
 */
export function parseIntent(raw: unknown): ParsedIntent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problem: 'not-an-object' };
  }
  const rec = raw as Record<string, unknown>;

  if (typeof rec.id !== 'string' || !URL_SAFE_ID.test(rec.id)) {
    return { ok: false, problem: 'bad-id' };
  }
  const id = rec.id;

  if (!isIntentProduct(rec.product)) return { ok: false, problem: 'bad-product' };
  const product = rec.product;

  let scenario: string | undefined;
  if (rec.scenario !== undefined) {
    if (typeof rec.scenario !== 'string' || !scenarioIdSet.has(rec.scenario)) {
      return { ok: false, problem: 'bad-scenario' };
    }
    scenario = rec.scenario;
  }

  let plan: IntentPlan | undefined;
  if (rec.plan !== undefined) {
    if (!isIntentPlan(rec.plan)) return { ok: false, problem: 'bad-plan' };
    plan = rec.plan;
  }

  if (!isCanonicalReturnRoute(rec.returnRoute)) return { ok: false, problem: 'bad-return-route' };
  const returnRoute = rec.returnRoute;

  if (!isIntentKind(rec.kind)) return { ok: false, problem: 'bad-kind' };
  const kind = rec.kind;

  if (typeof rec.createdAt !== 'string' || !isRfc3339(rec.createdAt)) {
    return { ok: false, problem: 'bad-created-at' };
  }
  const createdAt = rec.createdAt;

  if (typeof rec.expiresAt !== 'string' || !isRfc3339(rec.expiresAt)) {
    return { ok: false, problem: 'bad-expires-at' };
  }
  const expiresAt = rec.expiresAt;

  // An expiresAt not strictly after createdAt is a self-contradicting record
  // (expired before it existed): refused with bad-expires-at (W0-06 review r1).
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    return { ok: false, problem: 'bad-expires-at' };
  }

  let consumedAt: string | undefined;
  if (rec.consumedAt !== undefined) {
    if (typeof rec.consumedAt !== 'string' || !isRfc3339(rec.consumedAt)) {
      return { ok: false, problem: 'bad-consumed-at' };
    }
    // W0-06 review r3 (finding 4): range-checked against the record's own
    // lifetime. A stamp before createdAt is a record consumed before it
    // existed; a stamp after expiresAt is a future stamp that makes
    // now() - consumedAt negative forever and pins the consumed record
    // indefinitely. Both are refused with bad-consumed-at.
    if (Date.parse(rec.consumedAt) < Date.parse(createdAt) || Date.parse(rec.consumedAt) > Date.parse(expiresAt)) {
      return { ok: false, problem: 'bad-consumed-at' };
    }
    consumedAt = rec.consumedAt;
  }

  // Allowlist rebuild — DRIVEN by INTENT_KEYS (W0-06 review r5, finding 8):
  // the constant is a control, not documentation. Each declared key is mapped
  // from the values validated above (an absent optional maps to undefined and
  // stays a declared key), so the rebuild and the constant cannot drift with
  // no compile error: the parsed record's keys are exactly INTENT_KEYS, and a
  // key outside the list is refused entry — a token, session, card, receipt,
  // email or account UUID that arrived alongside the record is gone here,
  // before any screen or store sees it. The rebuilt record is frozen (W0-06
  // review r5, finding 5): no consumer can rewrite the allowlist's own output
  // through it.
  const validated: Record<string, unknown> = { id, product, returnRoute, kind, createdAt, expiresAt };
  if (scenario !== undefined) validated.scenario = scenario;
  if (plan !== undefined) validated.plan = plan;
  if (consumedAt !== undefined) validated.consumedAt = consumedAt;
  const intent = Object.freeze(
    Object.fromEntries(INTENT_KEYS.map((key) => [key, validated[key]])),
  ) as Intent;

  if (JSON.stringify(intent).length > INTENT_MAX_CHARS) {
    return { ok: false, problem: 'too-large' };
  }
  return { ok: true, intent };
}
