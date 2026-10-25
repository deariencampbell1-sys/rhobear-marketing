// W0-06: the intent store — create/save/load/consume/clear over an
// injectable storage adapter. Reads never mutate (one exception: a consumed
// record is garbage-collected once its restore window has passed). Consume
// is single-use and race-safe: it stamps `consumedAt` plus a fresh nonce,
// writes, then re-reads — a compare-and-set on the stored record, so two
// interleaved consumers can never both win. A storage that throws (private
// mode, quota exceeded) degrades to in-memory for this tab and every result
// reports `durable: false`; nothing throws into the UI and the destination
// is never silently lost.
import {
  CONSUMED_GRACE_MS,
  createIntentRecord,
  generateIntentId,
  isRfc3339,
  parseIntentJson,
  serialiseIntent,
  type IntentInput,
  type IntentRecord,
} from './schema';

export const INTENT_STORAGE_KEY = 'rhobear.intent.v1';

export interface IntentStorageAdapter {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

export type IntentLoadState = 'active' | 'expired' | 'consumed' | 'invalid' | 'absent';

export type IntentLoadResult = {
  state: IntentLoadState;
  record: IntentRecord | null;
  /** The route to put the person back on; null unless active or consumed. */
  destination: string | null;
  durable: boolean;
};

export type IntentConsumeOutcome =
  | 'consumed'
  | 'already-consumed'
  | 'expired'
  | 'invalid'
  | 'absent';

export type IntentConsumeResult = {
  outcome: IntentConsumeOutcome;
  /** For consumed and already-consumed: the original route, never a rerun. */
  route: string | null;
  record: IntentRecord | null;
  durable: boolean;
};

export type IntentSaveResult =
  | { ok: true; record: IntentRecord; durable: boolean }
  | { ok: false; reason: 'invalid'; issues: string[]; durable: boolean };

/** Browser default: sessionStorage, wrapped in the adapter shape. Anything
 * injectable works — tests use in-memory maps; a screen may pass a
 * `localStorage` adapter for install deep-links. */
function defaultSessionStorage(): IntentStorageAdapter {
  const memory = new Map<string, string>();
  const fallback: IntentStorageAdapter = {
    get: (key) => memory.get(key) ?? null,
    set: (key, value) => {
      memory.set(key, value);
    },
    remove: (key) => {
      memory.delete(key);
    },
  };
  try {
    if (typeof sessionStorage === 'undefined') return fallback;
    const native = sessionStorage;
    return {
      get: (key) => native.getItem(key),
      set: (key, value) => {
        native.setItem(key, value);
      },
      remove: (key) => {
        native.removeItem(key);
      },
    };
  } catch {
    return fallback;
  }
}

export function createIntentStore(
  options: { storage?: IntentStorageAdapter; now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  const storage = options.storage ?? defaultSessionStorage();

  let degraded = false;
  // Mirror of the last known record: written on every write, read whenever
  // the real adapter is gone (degraded) or yields nothing after a failure.
  const memory = new Map<string, string>();

  const readRaw = async (): Promise<string | null> => {
    if (degraded) return memory.get(INTENT_STORAGE_KEY) ?? null;
    try {
      const value = await storage.get(INTENT_STORAGE_KEY);
      return value ?? memory.get(INTENT_STORAGE_KEY) ?? null;
    } catch {
      degraded = true;
      return memory.get(INTENT_STORAGE_KEY) ?? null;
    }
  };

  const writeRaw = async (value: string | null): Promise<void> => {
    if (value === null) memory.delete(INTENT_STORAGE_KEY);
    else memory.set(INTENT_STORAGE_KEY, value);
    if (degraded) return;
    try {
      if (value === null) await storage.remove(INTENT_STORAGE_KEY);
      else await storage.set(INTENT_STORAGE_KEY, value);
    } catch {
      // Private mode or quota exceeded: keep the intent in memory for this
      // tab and report durable: false — never throw into the UI.
      degraded = true;
    }
  };

  const save = async (input: IntentInput): Promise<IntentSaveResult> => {
    const created = createIntentRecord(input, { now });
    if (!created.ok) return { ...created, durable: !degraded };
    const text = serialiseIntent(created.record);
    if (text === null) {
      return {
        ok: false,
        reason: 'invalid',
        issues: ['serialised intent exceeds 512 bytes'],
        durable: !degraded,
      };
    }
    await writeRaw(text);
    return { ok: true, record: created.record, durable: !degraded };
  };

  // Behaviour 6: load reports state without mutating the stored record —
  // the single exception is behaviour 8's GC of a consumed record whose
  // five-minute restore window has passed.
  const load = async (): Promise<IntentLoadResult> => {
    const raw = await readRaw();
    if (raw === null) {
      return { state: 'absent', record: null, destination: null, durable: !degraded };
    }
    const record = parseIntentJson(raw);
    if (record === null) {
      return { state: 'invalid', record: null, destination: null, durable: !degraded };
    }
    const at = now();
    if (record.consumedAt !== undefined) {
      if (
        isRfc3339(record.consumedAt) &&
        at - Date.parse(record.consumedAt) >= CONSUMED_GRACE_MS
      ) {
        await writeRaw(null);
        return { state: 'absent', record: null, destination: null, durable: !degraded };
      }
      return {
        state: 'consumed',
        record,
        destination: record.returnRoute,
        durable: !degraded,
      };
    }
    if (at >= Date.parse(record.expiresAt)) {
      return { state: 'expired', record, destination: null, durable: !degraded };
    }
    return { state: 'active', record, destination: record.returnRoute, durable: !degraded };
  };

  // Behaviour 7: consume is single-use. The nonce makes the compare-and-set
  // exact even when two consumers stamp the same millisecond: whoever's
  // write survives last wins, the loser re-reads a different raw and reports
  // already-consumed with the original route.
  const consume = async (): Promise<IntentConsumeResult> => {
    const current = await load();
    if (current.state === 'absent' || current.state === 'invalid') {
      return { outcome: current.state, route: null, record: null, durable: !degraded };
    }
    if (current.state === 'expired') {
      return { outcome: 'expired', route: null, record: current.record, durable: !degraded };
    }
    if (current.state === 'consumed') {
      return {
        outcome: 'already-consumed',
        route: current.destination,
        record: current.record,
        durable: !degraded,
      };
    }
    const active = current.record;
    if (active === null) {
      return { outcome: 'absent', route: null, record: null, durable: !degraded };
    }
    const record: IntentRecord = { ...active, consumedAt: new Date(now()).toISOString() };
    const mine = JSON.stringify({ ...record, consumeNonce: generateIntentId() });
    await writeRaw(mine);
    const after = await readRaw();
    if (after === mine) {
      return { outcome: 'consumed', route: record.returnRoute, record, durable: !degraded };
    }
    const winner = parseIntentJson(after ?? '');
    return {
      outcome: 'already-consumed',
      route: winner?.returnRoute ?? record.returnRoute,
      record: winner ?? record,
      durable: !degraded,
    };
  };

  const clear = async (): Promise<void> => {
    await writeRaw(null);
  };

  return {
    save,
    load,
    consume,
    clear,
    /** False once the storage adapter has failed; the store keeps working in memory. */
    get durable(): boolean {
      return !degraded;
    },
  };
}
