// W0-06 behaviours 5–9: TTL per kind, non-mutating load, single-use consume
// (including the interleaved double-consume race), clear and consumed
// retention, and the throwing-storage degradation. Every test runs on an
// injected storage adapter and an injected clock — no setTimeout, no real
// sessionStorage, no sleep.
import { describe, expect, it, vi } from 'vitest';
import {
  INTENT_KINDS,
  INTENT_PLANS,
  INTENT_PRODUCTS,
  isIntentKind,
  isIntentPlan,
  isIntentProduct,
  isKnownScenario,
  isRfc3339,
  type Intent,
  type IntentProblem,
} from '../src/clients/intent/schema';
import {
  CHECKOUT_TTL_MS,
  CONSUMED_RETENTION_MS,
  DAY_TTL_MS,
  INTENT_STORAGE_KEY,
  STORED_MAX_CHARS,
  createIntentStore,
  memoryIntentStorage,
  ttlMsForKind,
  type ConsumeResult,
  type CreateIntentInput,
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

/** Two "tabs" over one backing map: independent adapters, shared bytes. */
function sharedBacking(backing: Map<string, string>): IntentStorage {
  return {
    getItem: async (key) => backing.get(key) ?? null,
    setItem: async (key, value) => {
      backing.set(key, value);
    },
    removeItem: async (key) => {
      backing.delete(key);
    },
  };
}

/** yieldingStorage over a shared backing map, for two-store races. */
function yieldingStorageOver(backing: Map<string, string>): IntentStorage {
  return {
    getItem: async (key) => {
      await Promise.resolve();
      return backing.get(key) ?? null;
    },
    setItem: async (key, value) => {
      await Promise.resolve();
      backing.set(key, value);
    },
    removeItem: async (key) => {
      await Promise.resolve();
      backing.delete(key);
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
      storage: seededStorage({ [INTENT_STORAGE_KEY]: 'x'.repeat(STORED_MAX_CHARS + 1) }),
      now: fakeClock().now,
    });
    expect(await oversized.load()).toEqual({ state: 'invalid' });
    // W0-06 review r2 (finding 5): the cap is enforced in UTF-16 code units,
    // and the exported constant's name says which unit it is.
    expect(STORED_MAX_CHARS, 'the stored-envelope cap is measured in code units').toBe(1024);
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
    // And clearing reports honestly what it achieved: here the removal
    // itself throws, so only the mirror tombstone could be laid (finding 2).
    await expect(store.clear()).resolves.toEqual({ cleared: 'mirror-only' });
  });

  it('a removeItem that throws: clear() reports it honestly, load() is absent and the cleared record never resurrects', async () => {
    // A cleared intent whose storage removeItem fails must not resurrect on
    // the next load or consume (W0-06 review r2, finding 2): the mirror keeps
    // an absent tombstone so reads never fall back to the stale stored record.
    const staleLive = {
      v: 1,
      i: {
        id: 'q83N-vxK2mPp0QeR5sT8uAw',
        product: 'forge',
        plan: 'shell',
        returnRoute: '/plans',
        kind: 'checkout',
        createdAt: '2026-10-25T12:00:00.000Z',
        expiresAt: '2026-10-25T13:00:00.000Z',
      },
    };
    const backing = new Map([[INTENT_STORAGE_KEY, JSON.stringify(staleLive)]]);
    const store = createIntentStore({
      storage: {
        getItem: async (key) => backing.get(key) ?? null,
        setItem: async (key, value) => {
          backing.set(key, value);
        },
        removeItem: async () => {
          throw new Error('storage is wedged');
        },
      },
      now: fakeClock().now,
    });
    expect((await store.load()).state, 'precondition: the stale stored record is live').toBe('active');
    // clear() reports the failure honestly instead of pretending.
    await expect(store.clear()).resolves.toEqual({ cleared: 'mirror-only' });
    // The record is absent — never the old one, however many reads.
    expect(await store.load()).toEqual({ state: 'absent' });
    expect(await store.load()).toEqual({ state: 'absent' });
    expect(await store.consume()).toEqual({ outcome: 'absent' });
    // The stale bytes are still on disk — it is the tombstone that keeps
    // them invisible.
    expect(backing.get(INTENT_STORAGE_KEY)).toBeTruthy();
  });

  it('an install intent lands in the persistent default (localStorage) and a checkout intent in the session default', async () => {
    // The PR claims install intents survive a browser restart, so the default
    // for kind 'install' must be persistent storage, not sessionStorage
    // (W0-06 review r2, finding 4). A fake window exposes both adapters.
    const session = recordingStorage();
    const persistent = recordingStorage();
    vi.stubGlobal('window', { sessionStorage: session, localStorage: persistent });
    try {
      // No injected adapter: the defaults decide where each kind lives.
      const store = createIntentStore();
      const install = await store.create({ product: 'builds', kind: 'install', returnRoute: '/get' });
      expect(install.ok).toBe(true);
      expect(
        persistent.backing.get(INTENT_STORAGE_KEY) ?? '',
        'the install intent lands in the persistent adapter',
      ).toContain('"kind":"install"');
      expect(session.backing.has(INTENT_STORAGE_KEY), 'the session adapter must not hold the install intent').toBe(false);
      expect((await store.load()).state).toBe('active');

      // A restart: a new default store reads the install intent back from the
      // persistent adapter — the survival claim is actually true.
      const restarted = createIntentStore();
      const afterRestart = await restarted.load();
      expect(afterRestart.state).toBe('active');
      if (afterRestart.state === 'active') expect(afterRestart.intent.kind).toBe('install');

      const checkoutStore = createIntentStore();
      const checkout = await checkoutStore.create({ product: 'forge', kind: 'checkout', returnRoute: '/plans' });
      expect(checkout.ok).toBe(true);
      expect(session.backing.get(INTENT_STORAGE_KEY) ?? '', 'the checkout intent lands in the session adapter').toContain(
        '"kind":"checkout"',
      );
      expect((await checkoutStore.load()).state).toBe('active');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a store whose crypto.getRandomValues is unavailable returns an outcome from consume(), never a rejection', async () => {
    // The module promises nothing here throws into the UI (W0-06 review r2,
    // finding 7): a body failure — createIntentId when crypto.getRandomValues
    // is absent — becomes the outcome `invalid` instead of a rejection.
    const record = {
      id: 'q83N-vxK2mPp0QeR5sT8uAw',
      product: 'forge',
      plan: 'shell',
      returnRoute: '/plans',
      kind: 'checkout',
      createdAt: '2026-10-25T12:00:00.000Z',
      expiresAt: '2026-10-25T13:00:00.000Z',
    };
    const store = createIntentStore({
      storage: seededStorage({ [INTENT_STORAGE_KEY]: JSON.stringify({ v: 1, i: record }) }),
      now: fakeClock().now,
    });
    vi.stubGlobal('crypto', {}); // getRandomValues absent
    try {
      const result = await store.consume();
      expect(result.outcome, 'an outcome, not a rejection').toBe('invalid');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('two consumers with asymmetric latency: A settles entirely before B writes, exactly one wins', async () => {
    // One backing store, two "tabs". Tab A's adapter is instant; tab B's
    // adapter defers every operation after its first read until A's consume
    // has fully settled — A's whole critical section completes before B's
    // write could ever land. Only a re-read immediately before B's write can
    // catch this; a nonce alone cannot.
    const backing = new Map<string, string>();
    const clock = fakeClock();
    const storeA = createIntentStore({ storage: sharedBacking(backing), now: clock.now });
    const created = await storeA.create({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    expect(created.ok).toBe(true);

    let bReads = 0;
    let bWrites = 0;
    let bWaitedForA = false;
    const consumeA: { current: Promise<ConsumeResult> | null } = { current: null };
    const storeB = createIntentStore({
      storage: {
        getItem: async (key) => {
          bReads += 1;
          if (bReads > 1 && consumeA.current) {
            bWaitedForA = true;
            await consumeA.current.catch(() => undefined);
          }
          return backing.get(key) ?? null;
        },
        setItem: async (key, value) => {
          bWrites += 1;
          if (consumeA.current) {
            bWaitedForA = true;
            await consumeA.current.catch(() => undefined);
          }
          backing.set(key, value);
        },
        removeItem: async (key) => {
          backing.delete(key);
        },
      },
      now: clock.now,
    });

    const pendingB = storeB.consume(); // B reads first, then parks
    const pendingA = storeA.consume();
    consumeA.current = pendingA;
    const [resA, resB] = await Promise.all([pendingA, pendingB]);
    expect(bWaitedForA, 'the asymmetric delay must have actually applied').toBe(true);
    expect(bWrites, 'B must never reach its write: the re-read before it catches A').toBe(0);

    const winners = [resA, resB].filter((r) => r.outcome === 'consumed');
    expect(winners, 'exactly one consumer may win').toHaveLength(1);
    expect(resA.outcome).toBe('consumed');
    expect(resB.outcome).toBe('already-consumed');
    if (resB.outcome === 'already-consumed') expect(resB.returnRoute).toBe('/plans');
  });

  it('with navigator.locks present the consume takes an exclusive web lock and reports web-locks', async () => {
    const requests: { name: string; mode: string }[] = [];
    const fakeLocks = {
      request<R>(name: string, options: { mode: 'exclusive' | 'shared' }, body: (lock: unknown) => Promise<R> | R): Promise<R> {
        requests.push({ name, mode: options.mode });
        return Promise.resolve(body({ name, mode: options.mode }));
      },
    };
    vi.stubGlobal('navigator', { locks: fakeLocks });
    try {
      const store = createIntentStore({ storage: memoryIntentStorage(), now: fakeClock().now });
      await store.create({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
      const won = await store.consume();
      expect(won.outcome).toBe('consumed');
      if (won.outcome === 'consumed') expect(won.exclusive).toBe('web-locks');
      expect(requests).toEqual([{ name: `${INTENT_STORAGE_KEY}#consume`, mode: 'exclusive' }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a fake exclusive lock manager serialises two independent stores over one backing', async () => {
    const held = new Set<string>();
    const waiters: (() => void)[] = [];
    const requests: { name: string; mode: string }[] = [];
    const fakeLocks = {
      request<R>(name: string, options: { mode: 'exclusive' | 'shared' }, body: () => Promise<R> | R): Promise<R> {
        requests.push({ name, mode: options.mode });
        const acquire = (): Promise<R> => {
          if (!held.has(name)) {
            held.add(name);
            return Promise.resolve()
              .then(body)
              .finally(() => {
                held.delete(name);
                const next = waiters.shift();
                if (next) next();
              });
          }
          return new Promise<void>((resolve) => waiters.push(resolve)).then(acquire);
        };
        return acquire();
      },
    };
    vi.stubGlobal('navigator', { locks: fakeLocks });
    try {
      const backing = new Map<string, string>();
      const clock = fakeClock();
      const seeder = createIntentStore({ storage: sharedBacking(backing), now: clock.now });
      await seeder.create({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
      // Two independent stores ("tabs") with yielding adapters over the same
      // backing: only the exclusive lock keeps their consumes from racing.
      const tabA = createIntentStore({ storage: yieldingStorageOver(backing), now: clock.now });
      const tabB = createIntentStore({ storage: yieldingStorageOver(backing), now: clock.now });
      const [ra, rb] = await Promise.all([tabA.consume(), tabB.consume()]);
      expect([ra, rb].filter((r) => r.outcome === 'consumed'), 'exactly one tab wins').toHaveLength(1);
      const winner = ra.outcome === 'consumed' ? ra : rb;
      expect(winner.outcome === 'consumed' && winner.exclusive).toBe('web-locks');
      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(requests.every((r) => r.mode === 'exclusive')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('without navigator.locks the consume still serialises and reports the weaker in-process guarantee', async () => {
    const store = createIntentStore({ storage: yieldingStorage(), now: fakeClock().now });
    await store.create({ product: 'herald', kind: 'account', returnRoute: '/account' });
    const [a, b] = await Promise.all([store.consume(), store.consume()]);
    expect([a, b].filter((r) => r.outcome === 'consumed')).toHaveLength(1);
    for (const r of [a, b]) {
      if (r.outcome === 'consumed' || r.outcome === 'already-consumed') {
        expect(r.exclusive, 'no web locks here: the result must not claim them').toBe('in-process');
      }
    }
  });

  it('a navigator.locks that rejects degrades to the in-process guarantee and still serialises', async () => {
    const fakeLocks = {
      request<R>(_name: string, _options: { mode: 'exclusive' | 'shared' }, _body: () => Promise<R> | R): Promise<R> {
        return Promise.reject(new Error('locks unavailable'));
      },
    };
    vi.stubGlobal('navigator', { locks: fakeLocks });
    try {
      const store = createIntentStore({ storage: yieldingStorage(), now: fakeClock().now });
      await store.create({ product: 'builds', kind: 'install', returnRoute: '/builds' });
      const [a, b] = await Promise.all([store.consume(), store.consume()]);
      expect([a, b].filter((r) => r.outcome === 'consumed')).toHaveLength(1);
      for (const r of [a, b]) {
        if (r.outcome === 'consumed' || r.outcome === 'already-consumed') {
          expect(r.exclusive).toBe('in-process');
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a failed write leaves the newest record in the mirror: load and consume see it, not the stale stored value', async () => {
    // The last good stored value predates the failed write and still answers
    // getItem — here an old, already-consumed record. The mirror holds the
    // most recent write, so it must outrank the stale stored value.
    const staleConsumed = {
      v: 1,
      i: {
        id: 'staleidQmPp0QeR5sT8uAw',
        product: 'builds',
        returnRoute: '/account',
        kind: 'account',
        createdAt: '2026-10-24T11:00:00.000Z',
        expiresAt: '2026-10-25T11:00:00.000Z',
        consumedAt: '2026-10-25T11:30:00.000Z',
      },
    };
    const backing = new Map([[INTENT_STORAGE_KEY, JSON.stringify(staleConsumed)]]);
    const store = createIntentStore({
      storage: {
        getItem: async (key) => backing.get(key) ?? null, // keeps answering with the stale value
        setItem: async () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: async (key) => {
          backing.delete(key);
        },
      },
      now: fakeClock().now,
    });
    const created = await store.create({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    expect(created, 'the new record lands in the mirror').toMatchObject({ ok: true, durable: false });

    const loaded = await store.load();
    expect(loaded.state, 'load must see the newest record, not the stale consumed one').toBe('active');
    if (loaded.state === 'active') {
      expect(loaded.intent.returnRoute).toBe('/plans');
      expect(loaded.durable).toBe(false);
    }

    const won = await store.consume();
    expect(won.outcome, 'the first consume must run the checkout, not report it already done').toBe('consumed');
    if (won.outcome === 'consumed') {
      expect(won.intent.returnRoute).toBe('/plans');
      expect(won.durable).toBe(false);
    }
  });

  it('create() rejects each invalid field with its own problem code and writes nothing', async () => {
    const storage = recordingStorage();
    const store = createIntentStore({ storage, now: fakeClock().now });
    const base = { product: 'builds', kind: 'checkout', returnRoute: '/get' } as const;
    const cases: readonly { input: CreateIntentInput; problem: IntentProblem }[] = [
      { input: { ...base, product: 'not-a-product' } as unknown as CreateIntentInput, problem: 'bad-product' },
      { input: { ...base, kind: 'not-a-kind' } as unknown as CreateIntentInput, problem: 'bad-kind' },
      { input: { ...base, returnRoute: '/not-canonical' }, problem: 'bad-return-route' },
      { input: { ...base, plan: 'not-a-plan' } as unknown as CreateIntentInput, problem: 'bad-plan' },
      { input: { ...base, scenario: 'not-a-scenario' }, problem: 'bad-scenario' },
    ];
    for (const { input, problem } of cases) {
      expect(await store.create(input), problem).toEqual({ ok: false, problem });
    }
    expect(storage.backing.size, 'a rejected intent is written nowhere').toBe(0);
  });

  it('the exported predicates accept exactly their allowlists and reject everything else', () => {
    for (const product of INTENT_PRODUCTS) expect(isIntentProduct(product), product).toBe(true);
    for (const plan of INTENT_PLANS) expect(isIntentPlan(plan), plan).toBe(true);
    for (const kind of INTENT_KINDS) expect(isIntentKind(kind), kind).toBe(true);
    for (const scenario of ['forge-01', 'search-01', 'teams-01', 'designs-01', 'capturd-01', 'vision-01', 'spaces-01']) {
      expect(isKnownScenario(scenario), scenario).toBe(true);
    }
    const rejected: unknown[] = ['nope', 'Builds', '', 7, null, undefined, {}, [], true];
    for (const bad of rejected) {
      expect(isIntentProduct(bad), String(bad)).toBe(false);
      expect(isIntentPlan(bad), String(bad)).toBe(false);
      expect(isIntentKind(bad), String(bad)).toBe(false);
      expect(isKnownScenario(bad), String(bad)).toBe(false);
    }
  });

  it('save() round-trips a valid record and refuses an invalid one with a problem code', async () => {
    const storage = recordingStorage();
    const store = createIntentStore({ storage, now: fakeClock().now });
    const created = await store.create({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const saved = await store.save({ ...created.intent, plan: 'space' });
    expect(saved).toMatchObject({ ok: true, durable: true });
    const loaded = await store.load();
    expect(loaded.state).toBe('active');
    if (loaded.state === 'active') expect(loaded.intent.plan).toBe('space');
    const refused = await store.save({ ...created.intent, product: 'not-a-product' } as unknown as Intent);
    expect(refused).toEqual({ ok: false, problem: 'bad-product' });
    expect(storage.backing.get(INTENT_STORAGE_KEY), 'the refused record was not written').toContain('"space"');
  });

  it('isRfc3339 accepts real instants and refuses impossible dates and malformed shapes', () => {
    expect(isRfc3339('2026-10-25T12:00:00Z')).toBe(true);
    expect(isRfc3339('2026-10-25T12:00:00.000Z')).toBe(true);
    expect(isRfc3339('2026-10-25T14:00:00+02:00')).toBe(true);
    // 30 February does not exist: Date.parse would silently roll it to March.
    expect(isRfc3339('2026-02-30T00:00:00Z')).toBe(false);
    expect(isRfc3339('2026-13-01T00:00:00Z')).toBe(false);
    expect(isRfc3339('2026-10-25 12:00:00Z')).toBe(false);
    expect(isRfc3339('2026-10-25T12:00:00')).toBe(false);
    expect(isRfc3339('not-a-date')).toBe(false);
  });
});
