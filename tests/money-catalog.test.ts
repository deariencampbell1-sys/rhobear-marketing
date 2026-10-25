import { describe, expect, it } from 'vitest';
import { createCatalogClient, type CatalogView, type MoneyTransport } from '../src/clients/money/catalog';
import type { MoneyRequest, MoneyResult } from '../src/clients/money/transport';

const fakeCatalog = (over: Record<string, unknown> = {}) => ({
  schema: 'rhobear.catalog.v1',
  catalogVersion: '2026-10-25.1',
  sourceSha: 'a'.repeat(40),
  currency: 'USD',
  region: 'US',
  generatedAt: '2026-10-25T12:00:00Z',
  plans: [
    { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'available' },
    { sku: 'space', name: 'Space', monthlyPrice: '69.99', creditIncluded: '39.60', availability: 'available' },
  ],
  capabilities: [
    { product: 'builds', capability: 'apollo', plans: ['shell'], state: 'included' },
    { product: 'builds', capability: 'zeus', plans: [], state: 'unknown' },
  ],
  ...over,
});

// The fake transport pushes the wire shape through catalog.ts's own parser and
// stamps fetchedAt on the injected clock when the payload was recorded, so a
// payload replayed after the freshness window is honestly old. No network.
const fakeTransport = (payload: unknown, clock: () => number = Date.now, requestId = 'r1'): MoneyTransport => {
  const fetchedAt = clock();
  return {
    async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
      const data = parse(payload);
      if (data === null) return { ok: false, reason: 'invalid-shape', requestId };
      return { ok: true, data, requestId, fetchedAt };
    },
  };
};

const failingTransport: MoneyTransport = { get: async <T>(): Promise<MoneyResult<T>> => ({ ok: false, reason: 'network', requestId: 'r1' }) };

const loadView = async (client: ReturnType<typeof createCatalogClient>): Promise<CatalogView> => {
  const res = await client.load();
  if (!res.ok) throw new Error(`load failed: ${res.reason}`);
  return res.view;
};

describe('money catalog client', () => {
  it('fails closed on a transport error', async () => {
    const client = createCatalogClient(failingTransport);
    expect(await client.load()).toEqual({ ok: false, reason: 'network', requestId: 'r1' });
    expect(client.lastView()).toBeNull();
  });

  it('is purchasable only when every plan row is available', async () => {
    const catalog = fakeCatalog({ plans: [
      { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'available' },
      { sku: 'space', name: 'Space', monthlyPrice: '69.99', creditIncluded: '39.60', availability: 'unavailable', reason: 'renewal review' },
    ] });
    // The clock sits five minutes after the catalog was generated, so the
    // freshness window is genuinely open and this test is about plan rows.
    const nearGeneratedAt = () => Date.parse('2026-10-25T12:05:00Z');
    const view = await loadView(createCatalogClient(fakeTransport(catalog), { now: nearGeneratedAt }));
    expect(view.purchasable).toBe(false);
    expect(view.reason).toBeUndefined();
    expect(view.plans.find((p) => p.sku === 'space')?.reason).toBe('renewal review');
  });

  it('marks a fetched catalog stale after the freshness window and never purchasable', async () => {
    let clock = 1_000_000_000;
    const client = createCatalogClient(fakeTransport(fakeCatalog(), () => clock), { now: () => clock, freshnessMs: 900_000 });
    const fresh = await loadView(client);
    expect(fresh.stale).toBe(false);
    expect(fresh.purchasable).toBe(true);
    clock += 900_001;
    const aged = await loadView(client);
    expect(aged.stale).toBe(true);
    expect(aged.purchasable).toBe(false);
    expect(aged.reason).toBe('stale');
  });

  it('returns capabilities for one product and keeps unknown rows unknown', async () => {
    const client = createCatalogClient(fakeTransport(fakeCatalog(), () => 1_000_000_000), { now: () => 1_000_000_000 });
    await loadView(client);
    const builds = client.capabilitiesFor('builds');
    expect(builds).toHaveLength(2);
    expect(builds.find((c) => c.capability === 'zeus')?.state).toBe('unknown');
    expect(client.capabilitiesFor('herald')).toEqual([]);
  });

  it('never hands back a purchasable lastView and leaks no provider cost', async () => {
    const now = () => 1_000_000_000;
    const client = createCatalogClient(fakeTransport(fakeCatalog(), now), { now });
    await loadView(client);
    const cached = client.lastView();
    expect(cached).not.toBeNull();
    expect(cached?.purchasable).toBe(false);
    expect(cached?.stale).toBe(true);
    const leaky = fakeCatalog({ providerCost: '0.40', plans: [
      { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'available', providerCost: '0.40' },
      { sku: 'space', name: 'Space', monthlyPrice: '69.99', creditIncluded: '39.60', availability: 'available' },
    ] });
    const viewed = await loadView(createCatalogClient(fakeTransport(leaky, now), { now }));
    expect(JSON.stringify(viewed)).not.toContain('providerCost');
  });
});

// Appended after Apollo's review of PR #56: a successful load is remembered even
// when it cannot be sold from, because the screen still has to show the plans,
// the capabilities and the reason.
describe('money catalog memory', () => {
  it('remembers a successful view that is not purchasable, and marks it stale for reuse', async () => {
    const catalog = fakeCatalog({ plans: [
      { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'available' },
      { sku: 'space', name: 'Space', monthlyPrice: '69.99', creditIncluded: '39.60', availability: 'unavailable', reason: 'renewal review' },
    ] });
    const client = createCatalogClient(fakeTransport(catalog));
    const view = await loadView(client);
    expect(view.purchasable).toBe(false);

    const remembered = client.lastView();
    expect(remembered).not.toBeNull();
    expect(remembered?.catalogVersion).toBe('2026-10-25.1');
    expect(remembered?.purchasable).toBe(false);
    expect(remembered?.stale).toBe(true);
    expect(remembered?.reason).toBe('stale');
  });

  it('answers capabilitiesFor from the remembered view, per product', async () => {
    const client = createCatalogClient(fakeTransport(fakeCatalog({ plans: [
      { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'unavailable' },
    ] })));
    await loadView(client);

    expect(client.capabilitiesFor('builds')).toHaveLength(2);
    expect(client.capabilitiesFor('reviews')).toEqual([]);
  });

  it('still remembers nothing after a failed load', async () => {
    const client = createCatalogClient(failingTransport);
    await client.load();
    expect(client.lastView()).toBeNull();
    expect(client.capabilitiesFor('builds')).toEqual([]);
  });
});

