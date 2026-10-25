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

// judge() reads lastView() only; load/capabilitiesFor exist to satisfy CatalogClient.
const fakeCatalog = (catalogVersion = 'v1', sourceSha = 'a'.repeat(40)): CatalogClient => {
  const view = { catalogVersion, sourceSha, purchasable: true, generatedAt: 0, fetchedAt: 0, stale: false, plans: [], capabilities: [] };
  return {
    async load() { return { ok: true as const, view }; },
    lastView() { return view; },
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
