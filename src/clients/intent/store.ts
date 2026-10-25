// W0-06: the intent lifecycle — create, save, load, consume, clear — over an
// injectable storage adapter. sessionStorage is the default when a window
// exists; tests and install flows inject their own adapter (localStorage for
// deep-link continuity, in-memory in tests). Nothing here throws into the UI:
// a storage that fails (private mode, quota exceeded) degrades to an
// in-memory mirror and the results report `durable: false`, so the destination
// survives for this tab even when persistence does not.
//
// Single-use is a compare-and-set by read-back: the winner writes its record
// with `consumedAt` plus a fresh random nonce and only trusts the win when the
// stored nonce is still its own. Two interleaved consumers then cannot both
// win — the last write wins and the first writer's read-back sees the other
// nonce — so a checkout or job can never run twice.

import {
  createIntentId,
  isCanonicalReturnRoute,
  isIntentKind,
  isIntentPlan,
  isIntentProduct,
  isKnownScenario,
  parseIntent,
  type Intent,
  type IntentKind,
  type IntentProblem,
  type IntentProduct,
  type IntentPlan,
} from './schema';

export const INTENT_STORAGE_KEY = 'rhobear.intent.v1';

/** Behaviour 5: TTL by kind, one place, exported. */
export const CHECKOUT_TTL_MS = 60 * 60 * 1000;
export const DAY_TTL_MS = 24 * CHECKOUT_TTL_MS;
export function ttlMsForKind(kind: IntentKind): number {
  return kind === 'checkout' ? CHECKOUT_TTL_MS : DAY_TTL_MS;
}

/** Behaviour 8: a consumed record is kept only long enough to restore the route. */
export const CONSUMED_RETENTION_MS = 5 * 60 * 1000;

// The record itself is capped at INTENT_MAX_BYTES (512, enforced by
// parseIntent); the stored envelope adds bounded, fixed framing (a version and
// a 22-char nonce), so the store refuses stored text above this ceiling.
export const STORED_MAX_BYTES = 1024;

/**
 * The storage adapter contract — a subset of the DOM Storage interface, with
 * every method allowed to be synchronous (sessionStorage, in-memory) or
 * asynchronous (an extension could wrap IndexedDB). Injected everywhere.
 */
export type IntentStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};

/** A plain in-memory adapter: for tests, and as the degradation target. */
export function memoryIntentStorage(): IntentStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

export type CreateIntentInput = {
  product: IntentProduct;
  kind: IntentKind;
  returnRoute: string;
  plan?: IntentPlan;
  scenario?: string;
};

export type CreateResult =
  | { ok: true; intent: Intent; durable: boolean }
  | { ok: false; problem: IntentProblem };

export type LoadResult =
  | { state: 'active'; intent: Intent; durable: boolean }
  | { state: 'expired' } // no destination: an expired intent is never restored
  | { state: 'consumed'; intent: Intent; durable: boolean }
  | { state: 'invalid' }
  | { state: 'absent' };

export type ConsumeResult =
  | { outcome: 'consumed'; intent: Intent; durable: boolean }
  // The route is the original one, so the screen can restore the destination
  // without repeating the checkout or job.
  | { outcome: 'already-consumed'; returnRoute: string; durable: boolean }
  | { outcome: 'expired' }
  | { outcome: 'invalid' }
  | { outcome: 'absent' };

export type IntentStore = {
  create(input: CreateIntentInput): Promise<CreateResult>;
  save(record: Intent): Promise<CreateResult>;
  load(): Promise<LoadResult>;
  consume(): Promise<ConsumeResult>;
  clear(): Promise<void>;
};

export type IntentStoreDeps = {
  storage?: IntentStorage;
  now?: () => number;
};

// Stored framing: { v: 1, i: <intent record>, n?: <consume nonce> }. The
// envelope exists so the compare-and-set nonce can travel with the record
// without becoming a field of the validated record itself.
type Envelope = { v: 1; i: unknown; n?: string };
const ENVELOPE_VERSION = 1;

function readEnvelope(text: string): { ok: true; env: Envelope } | { ok: false } {
  if (text.length > STORED_MAX_BYTES) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Behaviour 4: broken JSON is `invalid`, never a thrown error.
    return { ok: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false };
  const raw = parsed as Record<string, unknown>;
  if (raw.v !== ENVELOPE_VERSION) return { ok: false };
  if (raw.n !== undefined && typeof raw.n !== 'string') return { ok: false };
  return { ok: true, env: { v: 1, i: raw.i, ...(raw.n !== undefined ? { n: raw.n } : {}) } };
}

function defaultStorage(): IntentStorage {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  } catch {
    // Accessing sessionStorage can itself throw in some privacy modes.
  }
  return memoryIntentStorage();
}

export function createIntentStore(deps: IntentStoreDeps = {}): IntentStore {
  const storage = deps.storage ?? defaultStorage();
  const now = deps.now ?? (() => Date.now());
  // The mirror is written on every failed storage write and consulted on
  // every read that storage cannot answer. It is what makes private mode
  // survivable: the intent works for this tab and reports durable: false.
  const mirror = new Map<string, string>();

  async function readRaw(): Promise<{ text: string | null; durable: boolean }> {
    let fromStorage: string | null = null;
    try {
      fromStorage = await storage.getItem(INTENT_STORAGE_KEY);
    } catch {
      fromStorage = null;
    }
    if (fromStorage !== null && fromStorage !== undefined) return { text: fromStorage, durable: true };
    const mirrored = mirror.get(INTENT_STORAGE_KEY);
    return { text: mirrored ?? null, durable: false };
  }

  async function writeRaw(text: string): Promise<boolean> {
    try {
      await storage.setItem(INTENT_STORAGE_KEY, text);
      mirror.delete(INTENT_STORAGE_KEY);
      return true;
    } catch {
      mirror.set(INTENT_STORAGE_KEY, text);
      return false;
    }
  }

  async function removeRaw(): Promise<void> {
    try {
      await storage.removeItem(INTENT_STORAGE_KEY);
    } catch {
      // Clearing must never throw into the UI.
    }
    mirror.delete(INTENT_STORAGE_KEY);
  }

  type Decoded =
    | { kind: 'absent' }
    | { kind: 'invalid' }
    | { kind: 'record'; intent: Intent; durable: boolean };

  async function decodeStored(): Promise<Decoded> {
    const { text, durable } = await readRaw();
    if (text === null) return { kind: 'absent' };
    const envelope = readEnvelope(text);
    if (!envelope.ok) return { kind: 'invalid' };
    const parsed = parseIntent(envelope.env.i);
    if (!parsed.ok) return { kind: 'invalid' };
    return { kind: 'record', intent: parsed.intent, durable };
  }

  async function persist(record: Intent): Promise<CreateResult> {
    const checked = parseIntent(record);
    if (!checked.ok) return { ok: false, problem: checked.problem };
    const text = JSON.stringify({ v: ENVELOPE_VERSION, i: checked.intent } satisfies Envelope);
    if (text.length > STORED_MAX_BYTES) return { ok: false, problem: 'too-large' };
    const durable = await writeRaw(text);
    return { ok: true, intent: checked.intent, durable };
  }

  async function create(input: CreateIntentInput): Promise<CreateResult> {
    // Reject before anything is written: a bad route fails the whole intent,
    // with no fallback to '/'.
    if (!isIntentProduct(input.product)) return { ok: false, problem: 'bad-product' };
    if (!isIntentKind(input.kind)) return { ok: false, problem: 'bad-kind' };
    if (!isCanonicalReturnRoute(input.returnRoute)) return { ok: false, problem: 'bad-return-route' };
    if (input.plan !== undefined && !isIntentPlan(input.plan)) return { ok: false, problem: 'bad-plan' };
    if (input.scenario !== undefined && !isKnownScenario(input.scenario)) {
      return { ok: false, problem: 'bad-scenario' };
    }
    const createdAtMs = now();
    const record: Intent = {
      id: createIntentId(),
      product: input.product,
      ...(input.scenario !== undefined ? { scenario: input.scenario } : {}),
      ...(input.plan !== undefined ? { plan: input.plan } : {}),
      returnRoute: input.returnRoute,
      kind: input.kind,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + ttlMsForKind(input.kind)).toISOString(),
    };
    return persist(record);
  }

  async function save(record: Intent): Promise<CreateResult> {
    return persist(record);
  }

  async function load(): Promise<LoadResult> {
    const decoded = await decodeStored();
    if (decoded.kind === 'absent') return { state: 'absent' };
    if (decoded.kind === 'invalid') return { state: 'invalid' };
    const { intent, durable } = decoded;
    if (intent.consumedAt !== undefined) {
      // Behaviour 8: a consumed record is kept only long enough to restore the
      // route and is then removed on the next load. This cleanup is load's
      // ONLY mutation — active records are never touched by a read.
      if (now() - Date.parse(intent.consumedAt) >= CONSUMED_RETENTION_MS) {
        await removeRaw();
        return { state: 'absent' };
      }
      return { state: 'consumed', intent, durable };
    }
    // An expiresAt that has passed by even one millisecond is expired.
    if (Date.parse(intent.expiresAt) <= now()) return { state: 'expired' };
    return { state: 'active', intent, durable };
  }

  async function consume(): Promise<ConsumeResult> {
    const decoded = await decodeStored();
    if (decoded.kind === 'absent') return { outcome: 'absent' };
    if (decoded.kind === 'invalid') return { outcome: 'invalid' };
    const current = decoded.intent;
    // A consumed record never re-runs: the caller gets the original route so
    // the screen can restore the destination without repeating the checkout.
    if (current.consumedAt !== undefined) {
      return { outcome: 'already-consumed', returnRoute: current.returnRoute, durable: decoded.durable };
    }
    if (Date.parse(current.expiresAt) <= now()) return { outcome: 'expired' };

    // Compare-and-set by read-back (see the module comment).
    const nonce = createIntentId();
    const wonRecord: Intent = { ...current, consumedAt: new Date(now()).toISOString() };
    await writeRaw(JSON.stringify({ v: ENVELOPE_VERSION, i: wonRecord, n: nonce } satisfies Envelope));
    const confirm = await readRaw();
    if (confirm.text === null) {
      // The confirming read failed: grant nothing, re-run nothing.
      return { outcome: 'already-consumed', returnRoute: current.returnRoute, durable: confirm.durable };
    }
    const envelope = readEnvelope(confirm.text);
    if (!envelope.ok) {
      return { outcome: 'already-consumed', returnRoute: current.returnRoute, durable: confirm.durable };
    }
    if (envelope.env.n === nonce) {
      return { outcome: 'consumed', intent: wonRecord, durable: confirm.durable };
    }
    // Another consumer won the race. Their record carries the original route.
    const winner = parseIntent(envelope.env.i);
    return {
      outcome: 'already-consumed',
      returnRoute: winner.ok ? winner.intent.returnRoute : current.returnRoute,
      durable: confirm.durable,
    };
  }

  async function clear(): Promise<void> {
    await removeRaw();
  }

  return { create, save, load, consume, clear };
}
