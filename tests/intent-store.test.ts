// W0-06: behaviours 5-9 — TTL by kind, non-mutating load, single-use consume
// (including the interleaved double-consume race), clear and the consumed
// grace window, injectable storage with the throwing-storage degradation.
// Everything runs on an injected in-memory adapter and an injected clock:
// no setTimeout, no real sessionStorage, no sleep.
import { describe, expect, it } from 'vitest';
import { CONSUMED_GRACE_MS, INTENT_TTL_MS } from '../src/clients/intent/schema';
import {
  INTENT_STORAGE_KEY,
  createIntentStore,
  type IntentStorageAdapter,
} from '../src/clients/intent/store';

const HOUR = 60 * 60 * 1000;

function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  const adapter: IntentStorageAdapter = {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
  return { adapter, map };
}

describe('intent store', () => {
  it('ttl is 60 minutes for checkout and 24 hours for install demo and account', async () => {
    expect(INTENT_TTL_MS.checkout).toBe(60 * 60 * 1000);
    expect(INTENT_TTL_MS.install).toBe(24 * HOUR);
    expect(INTENT_TTL_MS.demo).toBe(24 * HOUR);
    expect(INTENT_TTL_MS.account).toBe(24 * HOUR);

    const clock = fakeClock();
    const { adapter } = memoryStorage();
    const store = createIntentStore({ storage: adapter, now: clock.now });

    const checkout = await store.save({
      product: 'builds',
      returnRoute: '/plans',
      kind: 'checkout',
      plan: 'shell',
    });
    expect(checkout.ok).toBe(true);
    const checkoutRecord = checkout.ok ? checkout.record : null;
    expect(checkoutRecord).not.toBeNull();
    if (checkoutRecord) {
      expect(
        Date.parse(checkoutRecord.expiresAt) - Date.parse(checkoutRecord.createdAt),
      ).toBe(INTENT_TTL_MS.checkout);
    }

    const install = await store.save({ product: 'engines', returnRoute: '/engines', kind: 'install' });
    expect(install.ok).toBe(true);
    if (install.ok) {
      expect(Date.parse(install.record.expiresAt) - Date.parse(install.record.createdAt)).toBe(
        INTENT_TTL_MS.install,
      );
    }
  });

  it('load reads without mutating and reports active expired consumed invalid absent', async () => {
    const clock = fakeClock();
    const { adapter, map } = memoryStorage();
    const store = createIntentStore({ storage: adapter, now: clock.now });

    const absent = await store.load();
    expect(absent.state).toBe('absent');
    expect(absent.record).toBeNull();
    expect(absent.destination).toBeNull();

    const saved = await store.save({ product: 'forge', returnRoute: '/forge', kind: 'demo' });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const raw = map.get(INTENT_STORAGE_KEY) as string;
    const active = await store.load();
    expect(active.state).toBe('active');
    expect(active.destination).toBe('/forge');
    expect(active.record?.kind).toBe('demo');
    expect(map.get(INTENT_STORAGE_KEY)).toBe(raw); // read never mutates

    // Expired by exactly one millisecond: expired, destination not restored,
    // storage still untouched by the read.
    clock.advance(24 * HOUR + 1);
    const expired = await store.load();
    expect(expired.state).toBe('expired');
    expect(expired.destination).toBeNull();
    expect(expired.record).not.toBeNull();
    expect(map.get(INTENT_STORAGE_KEY)).toBe(raw);

    // Invalid (tampered / unparsable) never throws and never mutates.
    map.set(INTENT_STORAGE_KEY, 'garbage{{{');
    const invalid = await store.load();
    expect(invalid.state).toBe('invalid');
    expect(invalid.destination).toBeNull();
    expect(map.get(INTENT_STORAGE_KEY)).toBe('garbage{{{');

    // Consumed: still restorable inside the grace window, never a second run.
    clock.advance(-24 * HOUR - 1); // back inside the TTL for a fresh intent
    const fresh = await store.save({ product: 'builds', returnRoute: '/plans', kind: 'checkout', plan: 'shell' });
    expect(fresh.ok).toBe(true);
    const consumedOnce = await store.consume();
    expect(consumedOnce.outcome).toBe('consumed');
    const consumed = await store.load();
    expect(consumed.state).toBe('consumed');
    expect(consumed.destination).toBe('/plans');
  });

  it('consume is single use: the second consume restores the route without repeating the checkout', async () => {
    const clock = fakeClock();
    const { adapter } = memoryStorage();
    const store = createIntentStore({ storage: adapter, now: clock.now });
    await store.save({ product: 'builds', returnRoute: '/plans', kind: 'checkout', plan: 'shell' });

    const first = await store.consume();
    expect(first.outcome).toBe('consumed');
    expect(first.route).toBe('/plans');

    const second = await store.consume();
    expect(second.outcome).toBe('already-consumed');
    expect(second.route).toBe('/plans'); // the original route, so the screen
    // can restore the destination — never a second checkout.
  });

  it('two interleaved consumes on a yielding storage: exactly one wins, the other gets already-consumed with the original route', async () => {
    const clock = fakeClock();
    const { map } = memoryStorage();
    // Yields between read and write so two concurrent consume() calls really
    // interleave — the compare-and-set on the stored record must hold.
    const yielding: IntentStorageAdapter = {
      get: async (key) => {
        await Promise.resolve();
        return map.get(key) ?? null;
      },
      set: async (key, value) => {
        await Promise.resolve();
        map.set(key, value);
      },
      remove: async (key) => {
        map.delete(key);
      },
    };
    const store = createIntentStore({ storage: yielding, now: clock.now });
    const saved = await store.save({ product: 'builds', returnRoute: '/plans', kind: 'checkout', plan: 'shell' });
    expect(saved.ok).toBe(true);

    const results = await Promise.all([store.consume(), store.consume()]);
    const wins = results.filter((r) => r.outcome === 'consumed');
    const losses = results.filter((r) => r.outcome === 'already-consumed');
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(wins[0].route).toBe('/plans');
    expect(losses[0].route).toBe('/plans');
  });

  it('clear removes the record and a consumed record is kept only five minutes then removed on the next load', async () => {
    const clock = fakeClock();
    const { adapter, map } = memoryStorage();
    const store = createIntentStore({ storage: adapter, now: clock.now });

    await store.save({ product: 'builds', returnRoute: '/plans', kind: 'checkout', plan: 'shell' });
    await store.clear();
    expect(map.size).toBe(0);
    expect((await store.load()).state).toBe('absent');

    await store.save({ product: 'builds', returnRoute: '/plans', kind: 'checkout', plan: 'shell' });
    await store.consume();
    clock.advance(CONSUMED_GRACE_MS - 1);
    expect((await store.load()).state).toBe('consumed'); // still restorable
    clock.advance(1);
    const gone = await store.load();
    expect(gone.state).toBe('absent');
    expect(gone.destination).toBeNull();
    expect(map.size).toBe(0); // removed on next load, no redirect loop
  });

  it('a storage that throws on every write degrades to memory and reports durable false without throwing', async () => {
    const clock = fakeClock();
    const throwing: IntentStorageAdapter = {
      get: () => null,
      set: () => {
        throw new Error('quota exceeded');
      },
      remove: () => {},
    };
    const store = createIntentStore({ storage: throwing, now: clock.now });

    const saved = await store.save({ product: 'builds', returnRoute: '/plans', kind: 'checkout', plan: 'shell' });
    expect(saved.ok).toBe(true);
    expect(saved.durable).toBe(false);
    expect(store.durable).toBe(false);

    const loaded = await store.load();
    expect(loaded.state).toBe('active');
    expect(loaded.destination).toBe('/plans'); // destination not silently lost
    expect(loaded.durable).toBe(false);

    const consumed = await store.consume();
    expect(consumed.outcome).toBe('consumed');
    expect(consumed.route).toBe('/plans');
    expect(consumed.durable).toBe(false);
  });

  it('a storage that throws on read degrades to memory and reports durable false without throwing', async () => {
    const clock = fakeClock();
    const throwingRead: IntentStorageAdapter = {
      get: () => {
        throw new Error('private mode');
      },
      set: () => {},
      remove: () => {},
    };
    const store = createIntentStore({ storage: throwingRead, now: clock.now });
    const loaded = await store.load();
    expect(loaded.state).toBe('absent');
    expect(loaded.durable).toBe(false);
  });

  it('an install intent survives a browser restart inside its 24h ttl, and the same intent one second after it', async () => {
    const clock = fakeClock();
    const { adapter } = memoryStorage();
    const firstTab = createIntentStore({ storage: adapter, now: clock.now });
    await firstTab.save({ product: 'engines', returnRoute: '/engines', kind: 'install' });

    clock.advance(1_000); // one second later, "restart": a fresh store, same storage
    const restarted = createIntentStore({ storage: adapter, now: clock.now });
    const after = await restarted.load();
    expect(after.state).toBe('active');
    expect(after.destination).toBe('/engines');

    clock.advance(24 * HOUR - 1_001); // one millisecond inside the TTL
    expect((await restarted.load()).state).toBe('active');
    clock.advance(1);
    expect((await restarted.load()).state).toBe('expired');
  });
});
