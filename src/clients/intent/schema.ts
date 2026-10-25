// W0-06: the intent record that carries a person's place through sign-in.
// The front door owns only this small, safe, expiring record: an opaque
// crypto-random id, an allowlisted return route and an expiry. No credential
// field exists here — tokens, sessions, cards, receipts, emails and account
// UUIDs belong to L2 — and the schema both omits them and strips unknown
// keys on parse, so nothing smuggled in can survive a round trip.
import { z } from 'zod';
import { engineScenarios } from '../../data/engines';

/** Behaviour: the canonical return routes — the only values ever accepted. */
export const INTENT_RETURN_ROUTES = [
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
] as const;
export type IntentReturnRoute = (typeof INTENT_RETURN_ROUTES)[number];

export const INTENT_PRODUCTS = [
  'builds',
  'forge',
  'herald',
  'regent',
  'reviews',
  'engines',
] as const;
export type IntentProduct = (typeof INTENT_PRODUCTS)[number];

export const INTENT_PLANS = ['free', 'shell', 'shell-plus', 'space'] as const;
export type IntentPlan = (typeof INTENT_PLANS)[number];

export const INTENT_KINDS = ['checkout', 'install', 'demo', 'account'] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

/** Behaviour 5: TTL by kind, in one place. */
export const INTENT_TTL_MS: Record<IntentKind, number> = {
  checkout: 60 * 60 * 1000,
  install: 24 * 60 * 60 * 1000,
  demo: 24 * 60 * 60 * 1000,
  account: 24 * 60 * 60 * 1000,
};

/** Behaviour 8: a consumed record is kept only long enough to restore the route. */
export const CONSUMED_GRACE_MS = 5 * 60 * 1000;

/** Behaviour 4: the whole serialised intent is capped at 512 bytes. */
export const MAX_INTENT_SERIALISED_BYTES = 512;

// Scenario ids come from the W0-02 data layer — one source of truth, no
// second allowlist to drift.
const ENGINE_SCENARIO_IDS: ReadonlySet<string> = new Set(
  engineScenarios.map((scenario) => scenario.scenarioId),
);

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const isRfc3339 = (value: string): boolean =>
  RFC3339.test(value) && Number.isFinite(Date.parse(value));

export const isSafeReturnRoute = (value: string): boolean => {
  // Exact membership first: anything not spelled exactly like a canonical
  // route is rejected — absolute URLs, protocol strings, //host, query
  // strings, fragments, encoded traversal, trailing slashes, casing games.
  if (!(INTENT_RETURN_ROUTES as readonly string[]).includes(value)) return false;
  // Defence in depth: a single leading slash and nothing but lowercase
  // letters — no separator, escape or second slash can ever hide here.
  return /^\/[a-z]*$/.test(value);
};

export const intentRecordSchema = z.object({
  // 16 random bytes, base64url: 22 URL-safe characters, 128 bits.
  id: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  product: z.enum(INTENT_PRODUCTS),
  // Allowlisted engine scenario id, when known.
  scenario: z
    .string()
    .refine((value) => ENGINE_SCENARIO_IDS.has(value))
    .optional(),
  plan: z.enum(INTENT_PLANS).optional(),
  returnRoute: z.string().refine(isSafeReturnRoute),
  kind: z.enum(INTENT_KINDS),
  createdAt: z.string().refine(isRfc3339),
  expiresAt: z.string().refine(isRfc3339),
  consumedAt: z.string().refine(isRfc3339).optional(),
});
export type IntentRecord = z.infer<typeof intentRecordSchema>;

/**
 * Behaviour 1: 128 bits of crypto randomness, URL-safe, derived from
 * nothing but the RNG — the generator takes no time, email, account or
 * plan input at all.
 */
export function generateIntentId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type IntentInput = {
  product: IntentProduct;
  scenario?: string;
  plan?: IntentPlan;
  returnRoute: string;
  kind: IntentKind;
};

export type CreateIntentResult =
  | { ok: true; record: IntentRecord }
  | { ok: false; reason: 'invalid'; issues: string[] };

/**
 * Builds and validates a whole intent. A rejected route (or any other
 * invalid field) fails the whole intent — there is no silent fallback to `/`.
 */
export function createIntentRecord(
  input: IntentInput,
  options: { now?: () => number; id?: () => string } = {},
): CreateIntentResult {
  const at = (options.now ?? Date.now)();
  const candidate = {
    id: (options.id ?? generateIntentId)(),
    product: input.product,
    ...(input.scenario !== undefined ? { scenario: input.scenario } : {}),
    ...(input.plan !== undefined ? { plan: input.plan } : {}),
    returnRoute: input.returnRoute,
    kind: input.kind,
    createdAt: new Date(at).toISOString(),
    expiresAt: new Date(at + INTENT_TTL_MS[input.kind]).toISOString(),
  };
  const parsed = intentRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  const serialised = JSON.stringify(parsed.data);
  if (new TextEncoder().encode(serialised).length > MAX_INTENT_SERIALISED_BYTES) {
    return { ok: false, reason: 'invalid', issues: ['serialised intent exceeds 512 bytes'] };
  }
  return { ok: true, record: parsed.data };
}

/** Serialises for storage; null when the record somehow exceeds the cap. */
export function serialiseIntent(record: IntentRecord): string | null {
  const text = JSON.stringify(record);
  if (new TextEncoder().encode(text).length > MAX_INTENT_SERIALISED_BYTES) return null;
  return text;
}

/**
 * Behaviour 4: parsing storage text never throws into the UI. Unparsable
 * JSON, a JSON scalar or a malformed record all come back as null — the
 * store maps null to `invalid`.
 */
export function parseIntentJson(text: string): IntentRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = intentRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
