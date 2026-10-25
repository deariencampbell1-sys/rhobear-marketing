import { describe, expect, it } from 'vitest';
import { createQuoteClient, type QuoteBindInput } from '../src/clients/money/quote';
import type { CatalogClient, MoneyTransport } from '../src/clients/money/catalog';
import type { MoneyRequest, MoneyResult } from '../src/clients/money/transport';
import type { Quote } from '../src/clients/money/schema';

// No network, no account, no card, no fixture from src/. The fake hands the raw
// payload to the client unparsed: judge() — not the wire parser — owns every
// refusal this file checks (a no-total quote never survives parseQuote).
const fakeTransport = (payload: unknown): MoneyTransport => ({
  async get<T>(_req: MoneyRequest, _parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
    if (typeof payload !== 'object' || payload === null) return { ok: false, reason: 'invalid-shape', requestId: 'req-1' };
    return { ok: true, data: payload as T, requestId: 'req-1', fetchedAt: 1 };
  },
});

// judge() reads currentView() only. These fakes honour the CatalogClient
// contract the way the real client does: currentView() is the live view and
// lastView() is history (always stale, never purchasable). load() and
// capabilitiesFor() exist to satisfy the interface.
const fakeCatalog = (catalogVersion = 'v1', sourceSha = 'a'.repeat(40)): CatalogClient => {
  const view = { catalogVersion, sourceSha, purchasable: true, generatedAt: 0, fetchedAt: 0, stale: false, plans: [], capabilities: [] };
  return {
    async load() { return { ok: true as const, view }; },
    lastView() { return { ...view, stale: true, purchasable: false, reason: 'stale' as const }; },
    currentView() { return { ...view }; },
    capabilitiesFor() { return []; },
  };
};

const fakeQuote = (over: Partial<Quote> = {}): Quote => ({
  operationId: 'op-1', accountUuid: 'acct-1', catalogVersion: 'v1',
  sourceSha: 'a'.repeat(40), sku: 'shell', channel: 'web',
  price: '19.99', credit: '0.00', tax: '6.00', total: '25.99',
  currency: 'USD', renewal: 'monthly', paidThroughRule: 'end-of-period',
  createdAt: '2099-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
  ...over,
});

const input: QuoteBindInput = { accountUuid: 'acct-1', sku: 'shell', channel: 'web' };

const countingTransport = (payload: unknown) => {
  let calls = 0;
  const inner = fakeTransport(payload);
  const transport: MoneyTransport = {
    async get<T>(req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
      calls += 1;
      return inner.get(req, parse);
    },
  };
  return { calls: () => calls, transport };
};

describe('money quote client', () => {
  it('refuses a quote with no total instead of recomputing one', async () => {
    const state = await createQuoteClient(fakeTransport(fakeQuote({ total: '' })), fakeCatalog()).bind(input);
    expect(state).toEqual({ kind: 'unavailable', reason: 'no-total', requestId: 'req-1' });
    const json = JSON.stringify(state);
    expect(json).not.toContain('25.99');    // the quote's total was never copied back out
    expect(json).not.toMatch(/\d+\.\d{2}/);  // no numeric price anywhere on the state
    expect(json).not.toMatch(/"price"/);    // no price field on the state
  });

  it('treats the expiry instant as expired', async () => {
    const expires = Date.parse('2099-01-01T00:00:00Z');
    let now = expires;
    const client = createQuoteClient(fakeTransport(fakeQuote()), fakeCatalog(), { now: () => now });
    expect((await client.bind(input)).kind).toBe('expired');
    now = expires - 1;
    expect((await client.bind(input)).kind).not.toBe('expired');
  });

  it('refuses a quote for another account', async () => {
    const quote = fakeQuote({ accountUuid: 'acct-2' });
    const client = createQuoteClient(fakeTransport(quote), fakeCatalog(), { now: () => 0 });
    expect(await client.bind(input)).toEqual({ kind: 'foreign', quote, requestId: 'req-1' });
  });

  it('lists every drift field when the catalog moved', async () => {
    const client = createQuoteClient(fakeTransport(fakeQuote()), fakeCatalog('v2', 'b'.repeat(40)), { now: () => 0 });
    const state = await client.bind({ accountUuid: 'acct-1', sku: 'space', channel: 'apple' });
    expect(state).toMatchObject({ kind: 'stale' });
    const differences = state.kind === 'stale' ? [...state.differences].sort() : [];
    expect(differences).toEqual(['catalogVersion', 'channel', 'sku', 'sourceSha']);
  });

  it('does not refetch when reconfirming an expired, foreign or unavailable quote', async () => {
    const run = async (payload: unknown, now: () => number) => {
      const { calls, transport } = countingTransport(payload);
      const client = createQuoteClient(transport, fakeCatalog(), { now });
      const state = await client.bind(input);
      return { state, again: await client.reconfirm(state), calls: calls() };
    };
    const expired = await run(fakeQuote(), () => Date.parse('2099-01-01T00:00:00Z'));
    const foreign = await run(fakeQuote({ accountUuid: 'acct-2' }), () => 0);
    const unavailable = await run(fakeQuote({ total: '' }), () => 0);
    expect([expired.state.kind, foreign.state.kind, unavailable.state.kind]).toEqual(['expired', 'foreign', 'unavailable']);
    for (const s of [expired, foreign, unavailable]) {
      expect(s.again).toBe(s.state);
      expect(s.calls).toBe(1);
    }
  });
});

// reconfirm() must re-fetch and re-judge a live quote, and must refuse a state
// it never issued.
describe('money quote reconfirm', () => {
  const liveCatalog = (catalogVersion = 'v1'): CatalogClient => {
    const view = {
      catalogVersion, sourceSha: 'a'.repeat(40), purchasable: true,
      generatedAt: 0, fetchedAt: 0, stale: false, plans: [], capabilities: [],
    };
    return {
      async load() { return { ok: true as const, view }; },
      lastView() { return { ...view, stale: true, purchasable: false, reason: 'stale' as const }; },
      currentView() { return { ...view }; },
      capabilitiesFor() { return []; },
    };
  };

  const mutableTransport = (payload: () => unknown) => {
    let calls = 0;
    const transport: MoneyTransport = {
      async get<T>(_req: MoneyRequest, _parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
        calls += 1;
        return { ok: true, data: payload() as T, requestId: `req-${calls}`, fetchedAt: 1 };
      },
    };
    return { transport, calls: () => calls };
  };

  it('re-fetches and re-judges a ready quote', async () => {
    const wire = mutableTransport(() => fakeQuote());
    const client = createQuoteClient(wire.transport, liveCatalog(), { now: () => Date.parse('2026-10-25T00:00:00Z') });

    const ready = await client.bind(input);
    expect(ready.kind).toBe('ready');

    const again = await client.reconfirm(ready);
    expect(again.kind).toBe('ready');
    expect(wire.calls()).toBe(2);
  });

  it('re-fetches a stale quote and still reports the drift it can see', async () => {
    let version = 'v1';
    const wire = mutableTransport(() => fakeQuote({ catalogVersion: version }));
    const client = createQuoteClient(wire.transport, liveCatalog('v1'), { now: () => Date.parse('2026-10-25T00:00:00Z') });

    const stale = await client.bind(input);
    expect(stale.kind).toBe('ready');

    version = 'v2';
    const reconfirmed = await client.reconfirm(stale);
    expect(reconfirmed.kind).toBe('stale');
    expect(reconfirmed.kind === 'stale' ? reconfirmed.differences : []).toContain('catalogVersion');
    expect(wire.calls()).toBe(2);
  });

  it('refuses to reconfirm a quote it never issued', async () => {
    const wire = mutableTransport(() => fakeQuote());
    const client = createQuoteClient(wire.transport, liveCatalog(), { now: () => Date.parse('2026-10-25T00:00:00Z') });

    const forged = { kind: 'ready' as const, quote: fakeQuote({ operationId: 'never-issued' }), requestId: 'req-x' };
    const result = await client.reconfirm(forged);

    expect(result.kind).toBe('unavailable');
    expect(result.kind === 'unavailable' ? result.reason : '').toBe('invalid-shape');
    expect(wire.calls()).toBe(0);
  });
});


// A quote is only ready against a catalog we would actually sell from, and a
// binding is evicted on reconfirm.
describe('money quote live-catalog gate', () => {
  const catalogWith = (over: Record<string, unknown>): CatalogClient => {
    const view = {
      catalogVersion: 'v1', sourceSha: 'a'.repeat(40), purchasable: true,
      generatedAt: 0, fetchedAt: 0, stale: false, plans: [], capabilities: [], ...over,
    };
    return {
      async load() { return { ok: true as const, view }; },
      lastView() { return { ...view, stale: true, purchasable: false, reason: 'stale' as const }; },
      currentView() { return { ...view }; },
      capabilitiesFor() { return []; },
    };
  };

  const at = () => Date.parse('2026-10-25T00:00:00Z');

  it('refuses to make a quote ready off a stale catalog', async () => {
    const client = createQuoteClient(fakeTransport(fakeQuote()), catalogWith({ stale: true }), { now: at });
    const state = await client.bind(input);
    expect(state.kind).toBe('unavailable');
    expect(state.kind === 'unavailable' ? state.reason : '').toBe('catalog-stale');
  });

  it('refuses to make a quote ready off a catalog that cannot be sold from', async () => {
    const client = createQuoteClient(fakeTransport(fakeQuote()), catalogWith({ purchasable: false }), { now: at });
    const state = await client.bind(input);
    expect(state.kind).toBe('unavailable');
    expect(state.kind === 'unavailable' ? state.reason : '').toBe('catalog-stale');
  });

  it('refuses a quote when no catalog was ever loaded', async () => {
    const empty: CatalogClient = {
      async load() { return { ok: false as const, reason: 'network', requestId: 'r0' }; },
      lastView() { return null; },
      currentView() { return null; },
      capabilitiesFor() { return []; },
    };
    const client = createQuoteClient(fakeTransport(fakeQuote()), empty, { now: at });
    expect((await client.bind(input)).kind).toBe('unavailable');
  });
});


// lastView() is never the sell gate, and the
// bounded binding map evicts the oldest operation instead of growing forever.
describe('money quote sell gate and binding limit', () => {
  const liveShape = {
    catalogVersion: 'v1', sourceSha: 'a'.repeat(40), purchasable: true,
    generatedAt: 0, fetchedAt: 0, stale: false, plans: [], capabilities: [],
  };

  it('never reads lastView() as the sell gate', async () => {
    const catalog: CatalogClient = {
      async load() { return { ok: true as const, view: liveShape }; },
      // A live-looking history view must not authorise a sale...
      lastView() { return { ...liveShape }; },
      // ...because the live view says the catalog is stale.
      currentView() { return { ...liveShape, stale: true, purchasable: false, reason: 'stale' as const }; },
      capabilitiesFor() { return []; },
    };
    const state = await createQuoteClient(fakeTransport(fakeQuote()), catalog, { now: () => 0 }).bind(input);
    expect(state.kind === 'unavailable' ? state.reason : state.kind).toBe('catalog-stale');
  });

  it('drops the oldest binding once 32 are open, and keeps the newest', async () => {
    let issued = 0;
    const transport: MoneyTransport = {
      async get<T>(_req: MoneyRequest, _parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
        issued += 1;
        return { ok: true, data: fakeQuote({ operationId: `op-${issued}` }) as T, requestId: `req-${issued}`, fetchedAt: 1 };
      },
    };
    const client = createQuoteClient(transport, fakeCatalog(), { now: () => 0 });
    const states = [];
    for (let i = 0; i < 33; i += 1) states.push(await client.bind(input));
    const first = states[0];
    const last = states[states.length - 1];
    expect(first.kind).toBe('ready');
    expect(last.kind).toBe('ready');
    // The oldest binding was evicted: its reconfirm refuses without a refetch.
    const evicted = await client.reconfirm(first);
    expect(evicted.kind === 'unavailable' ? evicted.reason : evicted.kind).toBe('invalid-shape');
    expect(issued).toBe(33);
    // The newest binding is still live and reconfirms with a refetch.
    const kept = await client.reconfirm(last);
    expect(kept.kind).toBe('ready');
    expect(issued).toBe(34);
  });
});

// The production path for "no total": parseQuote refuses it before judge() ever
// sees it, so the state a screen receives is invalid-shape. judge()'s own
// no-total guard is a belt for a fake or a hand-built quote.
describe('money quote production parser path', () => {
  const parsingTransport = (payload: unknown): MoneyTransport => ({
    async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
      const data = parse(payload);
      if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'req-1' };
      return { ok: true, data, requestId: 'req-1', fetchedAt: 1 };
    },
  });

  it('reports invalid-shape, not no-total, when the wire quote has no total', async () => {
    const client = createQuoteClient(parsingTransport(fakeQuote({ total: '' })), fakeCatalog(), { now: () => 0 });
    expect(await client.bind(input)).toEqual({
      kind: 'unavailable', reason: 'invalid-shape', requestId: 'req-1',
    });
  });

  it('still judges a well-formed wire quote through the real parser', async () => {
    const client = createQuoteClient(parsingTransport(fakeQuote()), fakeCatalog(), { now: () => 0 });
    expect((await client.bind(input)).kind).toBe('ready');
  });
});
