// W0-06 behaviours 5–9: TTL per kind, non-mutating load, single-use consume
// (including the interleaved double-consume race), clear and consumed
// retention, and the throwing-storage degradation. Every test runs on an
// injected storage adapter and an injected clock — no setTimeout, no real
// sessionStorage, no sleep.
import { describe, expect, it } from 'vitest';
import { INTENT_KINDS } from '../src/clients/intent/schema';
import {
  CHECKOUT_TTL_MS,
  CONSUMED_RETENTION_MS,
  DAY_TTL_MS,
  INTENT_STORAGE_KEY,
  STORED_MAX_BYTES,
  createIntentStore,
  memoryIntentStorage,
  ttlMsForKind,
  type ConsumeResult,
  type IntentStorage,
} from '../src/clients/intent/store';

const BASE = Date.parse('2026-10-25T12:00:00Z');

function fakeClock(start: number = BASE): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** Synchronous in-memory storage that records every byte it holds. */
function recordingStorage(): IntentStorage & { backing: Map<string, string> } {
  const backing = new Map<string, string>();
  return {
    backing,
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
    },
  };
}

function seededStorage(entries: Record<string, string>): IntentStorage {
  const backing = new Map<string, string>(Object.entries(entries));
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
    },
  };
}

/**
 * A storage fake whose every operation yields a microtask before acting —
 * so two concurrent consume() calls genuinely interleave between read and
 * write instead of running atomically.
 */
function yieldingStorage(): IntentStorage & { ops: string[] } {
  const map = new Map<string, string>();
  const ops: string[] = [];
  let n = 0;
  return {
    ops,
    getItem: async (key: string) => {
      await Promise.resolve();
      ops.push(`get-${n++}`);
      return map.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      await Promise.resolve();
      ops.push(`set-${n++}`);
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      await Promise.resolve();
      ops.push(`del-${n++}`);
      map.delete(key);
    },
  };
}

/** Private mode / quota exceeded: every write throws, reads return nothing. */
function throwingWriteStorage(): IntentStorage {
  const quotaError = new Error('QuotaExceededError');
  return {
    getItem: () => null,
    setItem: () => {
      throw quotaError;
    },
    removeItem: () => {
      throw quotaError;
    },
  };
}

function alreadyConsumed(results: readonly ConsumeResult[]): Extract<ConsumeResult, { outcome: 'already-consumed' }>[] {
  return results.filter((r): r is Extract<ConsumeResult, { outcome: 'already-consumed' }> => r.outcome === 'already-consumed');
}

describe('intent store', () => {
  it('checkout intents live 60 minutes and install, demo and account intents 24 hours', async () => {
    expect(CHECKOUT_TTL_MS).toBe(60 * 60 * 1000);
    expect(DAY_TTL_MS).toBe(24 * CHECKOUT_TTL_MS);
    const clock = fakeClock();
    const store = createIntentStore({ storage: memoryIntentStorage(), now: clock.now });
    for (const kind of INTENT_KINDS) {
      const created = await store.create({ product: 'builds', kind, returnRoute: '/get' });
      expect(created.ok, kind).toBe(true);
      if (created.ok) {
        const span = Date.parse(created.intent.expiresAt) - Date.parse(created.intent.createdAt);
        expect(span, kind).toBe(ttlMsForKind(kind));
        const expected = kind === 'checkout' ? CHECKOUT_TTL_MS : DAY_TTL_MS;
        expect(ttlMsForKind(kind), kind).toBe(expected);
      }
    }
  });

  it('load reports active, expired, consumed, invalid or absent and never mutates on read', async () => {
    // absent
    const empty = createIntentStore({ storage: memoryIntentStorage(), now: fakeClock().now });
    expect(await empty.load()).toEqual({ state: 'absent' });

    // active, and reading never mutates the stored bytes
    const storage = recordingStorage();
    const clock = fakeClock();
    const store = createIntentStore({ storage, now: clock.now });
    const created = await store.create({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    expect(created.ok).toBe(true);
    const before = storage.backing.get(INTENT_STORAGE_KEY);
    expect(before).toBeTruthy();
    const first = await store.load();
    const second = await store.load();
    expect(first.state).toBe('active');
    expect(second.state).toBe('active');
    if (first.state === 'active' && second.state === 'active') {
      expect(first.intent.returnRoute).toBe('/plans');
      expect(second.intent.id).toBe(first.intent.id);
    }
    expect(storage.backing.get(INTENT_STORAGE_KEY)).toBe(before);

    // expired by exactly one millisecond: expired, and no destination is restored
    clock.advance(CHECKOUT_TTL_MS + 1);
    const expired = await store.load();
    expect(expired).toEqual({ state: 'expired' });

    // consumed
    clock.advance(-1); // back to exactly expiresAt is still expired, so move to a fresh record
    const fresh = createIntentStore({ storage: memoryIntentStorage(), now: fakeClock().now });
    await fresh.create({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    await fresh.consume();
    const consumed = await fresh.load();
    expect(consumed.state).toBe('consumed');
    if (consumed.state === 'consumed') expect(consumed.intent.returnRoute).toBe('/reviews');

    // invalid: broken JSON, wrong shapes and oversized stored text are all
    // `invalid` — never a thrown error into the UI
    const invalidStore = createIntentStore({
      storage: seededStorage({ [INTENT_STORAGE_KEY]: '{oops not json' }),
      now: fakeClock().now,
    });
    expect(await invalidStore.load()).toEqual({ state: 'invalid' });
    const wrongShape = createIntentStore({
      storage: seededStorage({ [INTENT_STORAGE_KEY]: '"just a string"' }),
      now: fakeClock().now,
    });
    expect(await wrongShape.load()).toEqual({ state: 'invalid' });
    const envelopeOnly = createIntentStore({
      storage: seededStorage({ [INTENT_STORAGE_KEY]: '{"v":1}' }),
      now: fakeClock().now,
    });
    expect(await envelopeOnly.load()).toEqual({ state: 'invalid' });
    const oversized = createIntentStore({
      storage: seededStorage({ [INTENT_STORAGE_KEY]: 'x'.repeat(STORED_MAX_BYTES + 1) }),
      now: fakeClock().now,
    });
    expect(await oversized.load()).toEqual({ state: 'invalid' });
  });

  it('a second consume restores the route without repeating the checkout', async () => {
    const clock = fakeClock();
    const store = createIntentStore({ storage: memoryIntentStorage(), now: clock.now });
    await store.create({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    const first = await store.consume();
    expect(first.outcome).toBe('consumed');
    // The second call must not re-run the operation: it reports the original
    // route so the screen can restore the destination, nothing more.
    const second = await store.consume();
    expect(second.outcome).toBe('already-consumed');
    if (second.outcome === 'already-consumed') expect(second.returnRoute).toBe('/plans');

    // Two consume() calls interleaved on a storage that yields between read
    // and write: exactly one wins, the loser gets already-consumed with the
    // original route — a checkout can never run twice.
    const yielding = yieldingStorage();
    const racing = createIntentStore({ storage: yielding, now: fakeClock().now });
    await racing.create({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
    const [a, b] = await Promise.all([racing.consume(), racing.consume()]);
    const results = [a, b];
    expect(results.filter((r) => r.outcome === 'consumed')).toHaveLength(1);
    const losers = alreadyConsumed(results);
    expect(losers).toHaveLength(1);
    expect(losers[0].returnRoute).toBe('/engines');
  });

  it('clear removes the record and a consumed record is dropped five minutes after use', async () => {
    const storage = recordingStorage();
    const clock = fakeClock();
    const store = createIntentStore({ storage, now: clock.now });
    await store.create({ product: 'herald', kind: 'account', returnRoute: '/account' });
    await store.clear();
    expect(await store.load()).toEqual({ state: 'absent' });
    expect(storage.backing.has(INTENT_STORAGE_KEY)).toBe(false);
    await store.clear(); // clearing an empty store is fine

    // A consumed record is kept only long enough to restore the route.
    await store.create({ product: 'herald', kind: 'account', returnRoute: '/account' });
    await store.consume();
    clock.advance(CONSUMED_RETENTION_MS - 1);
    const withinRetention = await store.load();
    expect(withinRetention.state).toBe('consumed');
    expect(storage.backing.has(INTENT_STORAGE_KEY)).toBe(true);
    clock.advance(1);
    const pastRetention = await store.load();
    expect(pastRetention).toEqual({ state: 'absent' });
    expect(storage.backing.has(INTENT_STORAGE_KEY)).toBe(false);
  });

  it('a storage that throws degrades to memory and reports durable false', async () => {
    const clock = fakeClock();
    const store = createIntentStore({ storage: throwingWriteStorage(), now: clock.now });
    // The intent is still created — in memory, for this tab — and the result
    // says so instead of throwing into the UI.
    const created = await store.create({ product: 'regent', kind: 'install', returnRoute: '/get' });
    expect(created).toMatchObject({ ok: true, durable: false });
    if (created.ok) expect(created.intent.returnRoute).toBe('/get');
    // The destination is not silently lost: load still sees it.
    const loaded = await store.load();
    expect(loaded.state).toBe('active');
    if (loaded.state === 'active') {
      expect(loaded.intent.returnRoute).toBe('/get');
      expect(loaded.durable).toBe(false);
    }
    // The lifecycle works end to end in memory.
    const won = await store.consume();
    expect(won.outcome).toBe('consumed');
    if (won.outcome === 'consumed') expect(won.durable).toBe(false);
    const again = await store.consume();
    expect(again.outcome).toBe('already-consumed');
    if (again.outcome === 'already-consumed') expect(again.returnRoute).toBe('/get');
    // And clearing never throws either.
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
