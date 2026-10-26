// W0-06: the intent lifecycle — create, save, load, consume, clear — over an
// injectable storage adapter. sessionStorage is the default when a window
// exists; tests and install flows inject their own adapter (localStorage for
// deep-link continuity, in-memory in tests). Nothing here throws into the UI:
// a storage that fails (private mode, quota exceeded) degrades to an
// in-memory mirror and the results report `durable: false`, so the destination
// survives for this tab even when persistence does not.
//
// Single-use is enforced in three layers (W0-06 review r1). First, a per-key
// promise queue serialises every consume this tab makes, so two consumers can
// never interleave their read and write at all, whatever the adapter's
// timing. Second, inside that critical section the stored record is re-read
// immediately before the winning write and the consume bails to
// already-consumed if `consumedAt` has appeared — the check that was missing;
// the nonce read-back stays as the last guard against a rival write that
// lands between that re-read and ours. Third, when the Web Locks API exists
// the same critical section takes an exclusive lock that spans tabs, and the
// consume result reports which guarantee was actually obtained
// (`exclusive: 'web-locks' | 'in-process'`): without Web Locks the guarantee
// is this tab only, and the result says so.
//
// Defaults per kind (W0-06 review r2, finding 4): an install intent is
// written to the PERSISTENT adapter — localStorage when a window exists —
// because the PR's claim is that an install intent survives a browser
// restart, and sessionStorage dies with the tab. Every other kind uses
// sessionStorage. An injected adapter is honoured first and used for every
// kind. Reads probe the last-written adapter first, then the other, so a
// restarted tab finds the record wherever it lives.
//
// Clearing reports what actually happened (W0-06 review r2, finding 2): when
// the storage removal fails, the mirror keeps an `absent` tombstone so reads
// never fall back to the stale stored record — a cleared intent cannot
// resurrect — and clear() returns which of the two happened.
//
// The consume body is wrapped (W0-06 review r2, finding 7): a failure inside
// the critical section — for example createIntentId when
// globalThis.crypto.getRandomValues is absent — becomes the outcome
// `invalid`, never a rejection into the UI. create(), save() and persist are
// wrapped in the same discipline (W0-06 review r3, finding 3): the module's
// "nothing here throws into the UI" promise covers them too, and a failure
// inside them resolves to `{ ok: false, problem: 'invalid' }` — reusing the
// existing failure label, never a new problem code.

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

// The record itself is capped at INTENT_MAX_CHARS (512 UTF-16 code units,
// enforced by parseIntent); the stored envelope adds bounded, fixed framing (a
// version and a 22-char nonce), so the store refuses stored text above this
// ceiling. Like INTENT_MAX_CHARS it is enforced against `.length` — UTF-16
// code units, not bytes — so the name says which unit it is (W0-06 review
// r2, finding 5).
export const STORED_MAX_CHARS = 1024;

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
  // W0-06 review r3 (finding 3): `invalid` is the module's existing failure
  // label (the one load and consume already report) for a failure INSIDE — a
  // missing crypto.getRandomValues, a hostile record — never a new problem
  // code and never a rejection into the UI.
  | { ok: false; problem: IntentProblem | 'invalid' };

export type LoadResult =
  | { state: 'active'; intent: Intent; durable: boolean }
  | { state: 'expired' } // no destination: an expired intent is never restored
  | { state: 'consumed'; intent: Intent; durable: boolean }
  | { state: 'invalid' }
  | { state: 'absent' };

/** Which exclusivity guarantee a consume actually ran under. 'web-locks'
 * means an exclusive cross-tab Web Lock was held for the critical section;
 * 'in-process' means only this tab's per-key queue serialised it. A caller
 * that needs a cross-tab guarantee must check this — never assume it. */
export type ConsumeExclusivity = 'web-locks' | 'in-process';

/** The consume critical section's result, before the exclusivity actually
 * obtained is attached to the outcomes that grant or decline the operation. */
type ConsumeCore =
  | { outcome: 'consumed'; intent: Intent; durable: boolean }
  | { outcome: 'already-consumed'; returnRoute: string; durable: boolean }
  | { outcome: 'expired' }
  | { outcome: 'invalid' }
  | { outcome: 'absent' };

export type ConsumeResult =
  | { outcome: 'consumed'; intent: Intent; durable: boolean; exclusive: ConsumeExclusivity }
  // The route is the original one, so the screen can restore the destination
  // without repeating the checkout or job.
  | { outcome: 'already-consumed'; returnRoute: string; durable: boolean; exclusive: ConsumeExclusivity }
  | { outcome: 'expired' }
  | { outcome: 'invalid' }
  | { outcome: 'absent' };

/** What clear() actually achieved (W0-06 review r2, finding 2). 'storage':
 * the stored record is gone. 'mirror-only': the storage removal failed, so
 * the mirror now holds an absent tombstone — reads report absent and the
 * stale stored record can never resurrect. */
export type ClearResult = { cleared: 'storage' | 'mirror-only' };

export type IntentStore = {
  create(input: CreateIntentInput): Promise<CreateResult>;
  save(record: Intent): Promise<CreateResult>;
  load(): Promise<LoadResult>;
  consume(): Promise<ConsumeResult>;
  clear(): Promise<ClearResult>;
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

// The Web Locks name under which consume's critical section runs. It spans
// tabs on the same origin; where the API is missing, the per-key queue is the
// only guard and the result reports 'in-process' (W0-06 review r1).
const CONSUME_LOCK_NAME = `${INTENT_STORAGE_KEY}#consume`;

function webLockManager(): LockManager | null {
  if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function') return navigator.locks;
  return null;
}

/**
 * Run `body` as one critical section: under an exclusive cross-tab Web Lock
 * when the API exists, otherwise directly (the per-key queue still serialises
 * this tab). Reports which guarantee was obtained. A lock that cannot be
 * granted at all degrades to the in-process guarantee rather than failing the
 * consume; a failure inside the body propagates untouched.
 */
async function underConsumeLock(
  body: () => Promise<ConsumeCore>,
): Promise<{ core: ConsumeCore; exclusive: ConsumeExclusivity }> {
  const locks = webLockManager();
  if (locks) {
    let ran = false;
    try {
      const core = await locks.request(CONSUME_LOCK_NAME, { mode: 'exclusive' }, async () => {
        ran = true;
        return body();
      });
      return { core, exclusive: 'web-locks' };
    } catch {
      if (ran) {
        // Unreachable while the body is wrapped (finding 7), kept as a
        // guard: even a body failure must not reject — it becomes `invalid`.
        return { core: { outcome: 'invalid' }, exclusive: 'web-locks' };
      }
      return { core: await body(), exclusive: 'in-process' };
    }
  }
  return { core: await body(), exclusive: 'in-process' };
}

function readEnvelope(text: string): { ok: true; env: Envelope } | { ok: false } {
  if (text.length > STORED_MAX_CHARS) return { ok: false };
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

function windowStorage(which: 'session' | 'persistent'): IntentStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    const found = which === 'persistent' ? window.localStorage : window.sessionStorage;
    return found ?? null;
  } catch {
    // Accessing storage can itself throw in some privacy modes.
    return null;
  }
}

export function createIntentStore(deps: IntentStoreDeps = {}): IntentStore {
  // W0-06 review r2 (finding 4): the default adapter depends on the intent's
  // kind — install intents go to the persistent adapter (localStorage when a
  // window exists) so they survive a browser restart; every other kind goes
  // to sessionStorage, which dies with the tab. An injected adapter is
  // honoured first and used for every kind.
  const injected = deps.storage ?? null;
  const sessionDefault = injected ?? windowStorage('session') ?? memoryIntentStorage();
  const persistentDefault = injected ?? windowStorage('persistent') ?? sessionDefault;
  const adapters: readonly IntentStorage[] =
    sessionDefault === persistentDefault ? [sessionDefault] : [sessionDefault, persistentDefault];
  // The adapter the newest write went to; reads probe it first.
  let holder: IntentStorage | null = null;
  const now = deps.now ?? (() => Date.now());
  // The mirror is written on every failed storage write and consulted on
  // every read that storage cannot answer. It is what makes private mode
  // survivable: the intent works for this tab and reports durable: false.
  // A `null` entry is a tombstone (W0-06 review r2, finding 2): the storage
  // removal failed, so reads must report absent instead of falling back to
  // the stale stored record.
  const mirror = new Map<string, string | null>();

  /** The default adapter for a kind (finding 4): install intents must
   * survive a browser restart, so their default is the persistent adapter;
   * every other kind dies with the tab on purpose. */
  function adapterDefaultFor(kind: IntentKind): IntentStorage {
    return kind === 'install' ? persistentDefault : sessionDefault;
  }

  async function readRaw(): Promise<{ text: string | null; durable: boolean; from: IntentStorage | null }> {
    // The mirror holds the most recent write whenever the last setItem
    // failed, so it outranks whatever storage still answers with (W0-06
    // review r1): a read-back of a stale stored value must never defeat the
    // record this tab has just written. A tombstone (null) reports absent
    // for the same reason (W0-06 review r2, finding 2). While the mirror
    // answers, the result is, honestly, not durable.
    const mirrored = mirror.get(INTENT_STORAGE_KEY);
    if (mirrored !== undefined) return { text: mirrored, durable: false, from: null };
    // Probe the last-written adapter first, then the others, so a restarted
    // tab finds an install record in persistent storage and every other
    // record in the session adapter (W0-06 review r2, finding 4).
    const order = holder ? [holder, ...adapters.filter((a) => a !== holder)] : adapters;
    for (const adapter of order) {
      try {
        const text = await adapter.getItem(INTENT_STORAGE_KEY);
        if (text !== null) return { text, durable: true, from: adapter };
      } catch {
        // A failing adapter is skipped, like a failing write degrades.
      }
    }
    return { text: null, durable: false, from: null };
  }

  async function writeRaw(text: string, adapter: IntentStorage): Promise<boolean> {
    try {
      await adapter.setItem(INTENT_STORAGE_KEY, text);
      mirror.delete(INTENT_STORAGE_KEY);
      return true;
    } catch {
      mirror.set(INTENT_STORAGE_KEY, text);
      return false;
    }
  }

  async function removeRaw(): Promise<ClearResult> {
    let removed = true;
    for (const adapter of adapters) {
      try {
        await adapter.removeItem(INTENT_STORAGE_KEY);
      } catch {
        removed = false;
      }
    }
    if (removed) {
      mirror.delete(INTENT_STORAGE_KEY);
      return { cleared: 'storage' };
    }
    // The storage removal failed: the stale stored record is still there.
    // Keep an absent tombstone in the mirror so reads report absent instead
    // of resurrecting the record the person cleared (W0-06 review r2, finding 2).
    mirror.set(INTENT_STORAGE_KEY, null);
    return { cleared: 'mirror-only' };
  }

  type Decoded =
    | { kind: 'absent' }
    | { kind: 'invalid' }
    | { kind: 'record'; intent: Intent; durable: boolean; from: IntentStorage | null };

  async function decodeStored(): Promise<Decoded> {
    const { text, durable, from } = await readRaw();
    if (text === null) return { kind: 'absent' };
    const envelope = readEnvelope(text);
    if (!envelope.ok) return { kind: 'invalid' };
    const parsed = parseIntent(envelope.env.i);
    if (!parsed.ok) return { kind: 'invalid' };
    return { kind: 'record', intent: parsed.intent, durable, from };
  }

  /** W0-06 review r3 (finding 3): the whole body is wrapped like the consume
   * body — any failure inside resolves to `{ ok: false, problem: 'invalid' }`
   * instead of rejecting into the UI. */
  async function persist(record: Intent): Promise<CreateResult> {
    try {
      const checked = parseIntent(record);
      if (!checked.ok) return { ok: false, problem: checked.problem };
      const text = JSON.stringify({ v: ENVELOPE_VERSION, i: checked.intent } satisfies Envelope);
      if (text.length > STORED_MAX_CHARS) return { ok: false, problem: 'too-large' };
      // The kind decides the default adapter (finding 4); the store remembers
      // it as the holder so reads find the record again.
      const adapter = injected ?? adapterDefaultFor(record.kind);
      holder = adapter;
      const durable = await writeRaw(text, adapter);
      return { ok: true, intent: checked.intent, durable };
    } catch {
      return { ok: false, problem: 'invalid' };
    }
  }

  async function create(input: CreateIntentInput): Promise<CreateResult> {
    try {
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
      return await persist(record);
    } catch {
      // W0-06 review r3 (finding 3): createIntentId when
      // globalThis.crypto.getRandomValues is absent, a hostile clock — an
      // outcome, never a rejection.
      return { ok: false, problem: 'invalid' };
    }
  }

  async function save(record: Intent): Promise<CreateResult> {
    try {
      return await persist(record);
    } catch {
      return { ok: false, problem: 'invalid' };
    }
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

  // Per-key serialisation of consume (W0-06 review r1): two consumers in this
  // tab can never interleave their read and write, whatever the adapter's
  // timing. Web Locks, when present, extends the same exclusion across tabs.
  const consumeQueues = new Map<string, Promise<unknown>>();

  function enqueuePerKey<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = consumeQueues.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    consumeQueues.set(key, tail);
    void tail.then(() => {
      if (consumeQueues.get(key) === tail) consumeQueues.delete(key);
    });
    return run;
  }

  async function consume(): Promise<ConsumeResult> {
    const { core, exclusive } = await enqueuePerKey(INTENT_STORAGE_KEY, () => underConsumeLock(runConsumeBody));
    if (core.outcome === 'consumed' || core.outcome === 'already-consumed') {
      return { ...core, exclusive };
    }
    return core;
  }

  /** The consume critical section's inner logic. Runs under the per-key
   * queue and, when the Web Locks API exists, an exclusive cross-tab lock. */
  async function runConsumeBodyInner(): Promise<ConsumeCore> {
    const decoded = await decodeStored();
    if (decoded.kind === 'absent') return { outcome: 'absent' };
    if (decoded.kind === 'invalid') return { outcome: 'invalid' };
    const current = decoded.intent;
    // The consumed stamp is written back to the adapter the record actually
    // came from (W0-06 review r2, finding 4): marking it consumed elsewhere
    // would leave the original record unconsumed.
    const target = decoded.from ?? adapterDefaultFor(current.kind);
    // A consumed record never re-runs: the caller gets the original route so
    // the screen can restore the destination without repeating the checkout.
    if (current.consumedAt !== undefined) {
      return { outcome: 'already-consumed', returnRoute: current.returnRoute, durable: decoded.durable };
    }
    if (Date.parse(current.expiresAt) <= now()) return { outcome: 'expired' };

    // Re-read immediately before the winning write (W0-06 review r1):
    // `consumedAt` may have appeared since the first read. The nonce only
    // catches a rival write that lands after ours; this check catches one
    // that completed before it.
    const preWrite = await readRaw();
    if (preWrite.text !== null) {
      const rival = readEnvelope(preWrite.text);
      if (rival.ok) {
        const rivalRecord = parseIntent(rival.env.i);
        if (rivalRecord.ok && rivalRecord.intent.consumedAt !== undefined) {
          return {
            outcome: 'already-consumed',
            returnRoute: rivalRecord.intent.returnRoute,
            durable: preWrite.durable,
          };
        }
      }
    }

    // Compare-and-set by read-back (see the module comment).
    const nonce = createIntentId();
    const wonRecord: Intent = { ...current, consumedAt: new Date(now()).toISOString() };
    await writeRaw(JSON.stringify({ v: ENVELOPE_VERSION, i: wonRecord, n: nonce } satisfies Envelope), target);
    holder = target;
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

  /** W0-06 review r2 (finding 7): nothing here throws into the UI, and that
   * includes the body itself. Any failure inside the critical section —
   * createIntentId when globalThis.crypto.getRandomValues is absent, a
   * hostile adapter — becomes the outcome `invalid` instead of a rejection,
   * keeping the total-function contract. */
  async function runConsumeBody(): Promise<ConsumeCore> {
    try {
      return await runConsumeBodyInner();
    } catch {
      return { outcome: 'invalid' };
    }
  }

  async function clear(): Promise<ClearResult> {
    return removeRaw();
  }

  return { create, save, load, consume, clear };
}
