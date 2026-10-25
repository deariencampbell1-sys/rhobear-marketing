import { describe, expect, it } from 'vitest';
import { createCatalogClient, type CatalogView } from '../src/clients/money/catalog';
import type { MoneyTransportGet } from '../src/clients/money/transport';
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
const fakeTransport = (payload: unknown, clock: () => number = Date.now, requestId = 'r1'): MoneyTransportGet => {
  const fetchedAt = clock();
  return {
    async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
      const data = parse(payload);
      if (data === null) return { ok: false, reason: 'invalid-shape', requestId };
      return { ok: true, data, requestId, fetchedAt };
    },
  };
};

const failingTransport: MoneyTransportGet = { get: async <T>(): Promise<MoneyResult<T>> => ({ ok: false, reason: 'network', requestId: 'r1' }) };

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
    const client = createCatalogClient(fakeTransport(catalog, nearGeneratedAt), { now: nearGeneratedAt });
    // Fresh, but a plan row cannot be sold, so this is not an ok load.
    expect(await client.load()).toEqual({ ok: false, reason: 'not-purchasable', requestId: 'r1' });
    const view = client.currentView();
    expect(view?.purchasable).toBe(false);
    expect(view?.stale).toBe(false);
    expect(view?.plans.find((p) => p.sku === 'space')?.reason).toBe('renewal review');
  });

  it('marks a fetched catalog stale after the freshness window and never purchasable', async () => {
    let clock = 1_000_000_000;
    const client = createCatalogClient(fakeTransport(fakeCatalog(), () => clock), { now: () => clock, freshnessMs: 900_000 });
    const fresh = await loadView(client);
    expect(fresh.stale).toBe(false);
    expect(fresh.purchasable).toBe(true);
    clock += 900_001;
    // `ok` means sellable, not fetched: an aged load is a stale failure, and the
    // rows stay readable for display.
    const aged = await client.load();
    expect(aged).toEqual({ ok: false, reason: 'stale', requestId: 'r1' });
    expect(client.currentView()?.stale).toBe(true);
    expect(client.currentView()?.purchasable).toBe(false);
    expect(client.currentView()?.reason).toBe('stale');
    expect(client.lastView()?.catalogVersion).toBe('2026-10-25.1');
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

// A successful load is remembered even when it cannot be sold from, because the
// screen still has to show the plans, the capabilities and the reason.
describe('money catalog memory', () => {
  it('remembers a successful view that is not purchasable, and marks it stale for reuse', async () => {
    const catalog = fakeCatalog({ plans: [
      { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'available' },
      { sku: 'space', name: 'Space', monthlyPrice: '69.99', creditIncluded: '39.60', availability: 'unavailable', reason: 'renewal review' },
    ] });
    // Five minutes after generatedAt: the freshness window is open, so this is
    // about plan rows rather than the clock.
    const nearGeneratedAt = () => Date.parse('2026-10-25T12:05:00Z');
    const client = createCatalogClient(fakeTransport(catalog, nearGeneratedAt), { now: nearGeneratedAt });
    expect(await client.load()).toEqual({ ok: false, reason: 'not-purchasable', requestId: 'r1' });

    const remembered = client.lastView();
    expect(remembered).not.toBeNull();
    expect(remembered?.catalogVersion).toBe('2026-10-25.1');
    expect(remembered?.purchasable).toBe(false);
    expect(remembered?.stale).toBe(true);
    expect(remembered?.reason).toBe('stale');
  });

  it('answers capabilitiesFor from the remembered view, per product', async () => {
    const nearGeneratedAt = () => Date.parse('2026-10-25T12:05:00Z');
    const client = createCatalogClient(fakeTransport(fakeCatalog({ plans: [
      { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'unavailable' },
    ] }), nearGeneratedAt), { now: nearGeneratedAt });
    await client.load(); // not-purchasable, and still remembered

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


// An unparseable generatedAt is stale, never fresh, and no test leans on the
// wall clock: every clock here is injected.
describe('money catalog unparseable date', () => {
  // parseCatalog already refuses a generatedAt that is not RFC3339, so this is
  // the shape the failure actually takes: the whole catalog is refused and
  // nothing is remembered. (The NaN guard in catalog.ts stays as a belt for a
  // view built by hand; the wire cannot reach it.)
  it('refuses a catalog whose generatedAt is not a date', async () => {
    const catalog = fakeCatalog({ generatedAt: 'not-a-date' });
    const nearGeneratedAt = () => Date.parse('2026-10-25T12:05:00Z');
    const client = createCatalogClient(fakeTransport(catalog, nearGeneratedAt), { now: nearGeneratedAt });
    const result = await client.load();
    expect(result.ok).toBe(false);
    expect(result.ok ? 'ok' : result.reason).toBe('invalid-shape');
    expect(client.lastView()).toBeNull();
  });

  it('stamps fetchedAt from the injected clock, not from the machine clock', async () => {
    const nearGeneratedAt = () => Date.parse('2026-10-25T12:05:00Z');
    const client = createCatalogClient(fakeTransport(fakeCatalog(), nearGeneratedAt), { now: nearGeneratedAt });
    const view = await loadView(client);
    expect(view.fetchedAt).toBe(nearGeneratedAt());
    expect(view.stale).toBe(false);
    expect(view.purchasable).toBe(true);
  });
});

// The sell gate must survive a failed refresh, must re-judge age on every read,
// must fail closed on a bad timestamp, and the remembered view must not be
// mutable by whoever reads it.
describe('money catalog sell gate', () => {
  // A transport whose next response can be made to fail on demand.
  const controllableTransport = (payload: unknown, clock: () => number) => {
    let failing = false;
    const transport: MoneyTransportGet = {
      async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
        if (failing) return { ok: false, reason: 'network', requestId: 'r1' };
        const data = parse(payload);
        if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'r1' };
        return { ok: true, data, requestId: 'r1', fetchedAt: clock() };
      },
    };
    return { transport, fail: (value: boolean) => { failing = value; } };
  };

  it('withdraws the live view when a refresh fails after a good load', async () => {
    const clock = () => 1_000_000_000;
    const wire = controllableTransport(fakeCatalog(), clock);
    const client = createCatalogClient(wire.transport, { now: clock });

    expect((await loadView(client)).purchasable).toBe(true);
    expect(client.currentView()?.purchasable).toBe(true);

    wire.fail(true);
    expect(await client.load()).toEqual({ ok: false, reason: 'network', requestId: 'r1' });

    // Not sellable, but still readable for display.
    expect(client.currentView()?.stale).toBe(true);
    expect(client.currentView()?.purchasable).toBe(false);
    expect(client.currentView()?.reason).toBe('stale');
    expect(client.lastView()?.purchasable).toBe(false);
    expect(client.capabilitiesFor('builds')).toHaveLength(2);
  });

  it('re-judges age on every read, so a view ages into stale without a reload', async () => {
    let clock = 1_000_000_000;
    const client = createCatalogClient(fakeTransport(fakeCatalog(), () => clock), { now: () => clock, freshnessMs: 900_000 });

    expect((await loadView(client)).purchasable).toBe(true);
    expect(client.currentView()?.stale).toBe(false);

    clock += 900_001;
    expect(client.currentView()?.stale).toBe(true);
    expect(client.currentView()?.purchasable).toBe(false);
    expect(client.currentView()?.reason).toBe('stale');
  });

  it('fails closed when fetchedAt is not a timestamp', async () => {
    const now = () => 1_000_000_000;
    const badFetchedAt: MoneyTransportGet = {
      async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
        const data = parse(fakeCatalog());
        if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'r1' };
        return { ok: true, data, requestId: 'r1', fetchedAt: Number.NaN };
      },
    };
    const client = createCatalogClient(badFetchedAt, { now });
    // A non-finite stamp is stale, so the load is not a success.
    expect(await client.load()).toEqual({ ok: false, reason: 'stale', requestId: 'r1' });
    expect(client.currentView()?.stale).toBe(true);
    expect(client.currentView()?.purchasable).toBe(false);
  });

  it('fails closed when the clock moves backwards past the fetch', async () => {
    let clock = 1_000_000_000;
    const client = createCatalogClient(fakeTransport(fakeCatalog(), () => clock), { now: () => clock });
    expect((await loadView(client)).purchasable).toBe(true);

    clock -= 1_000_000;
    expect(client.currentView()?.stale).toBe(true);
    expect(client.currentView()?.purchasable).toBe(false);
  });

  it('hands out copies, so a caller cannot mutate the remembered sell gate', async () => {
    const now = () => 1_000_000_000;
    const client = createCatalogClient(fakeTransport(fakeCatalog(), now), { now });
    const view = await loadView(client);
    expect(view.purchasable).toBe(true);

    const live = client.currentView();
    expect(live).not.toBeNull();
    if (live === null) throw new Error('a loaded catalog must have a live view');
    // The rows are frozen, so the stored catalog cannot be edited into a
    // sellable state through a view a screen is holding...
    expect(Object.isFrozen(live.plans)).toBe(true);
    expect(Object.isFrozen(live.plans[0])).toBe(true);
    // ...and the view itself is a copy: writing to it changes nothing.
    live.purchasable = false;
    // A frozen row cannot be written at all (strict mode throws), so the stored
    // catalog keeps the availability it was parsed with.
    expect(() => {
      (live.plans[0] as unknown as { availability: string }).availability = 'unavailable';
    }).toThrow();
    expect(client.currentView()?.purchasable).toBe(true);
    expect(client.currentView()?.plans[0].availability).toBe('available');
    expect(client.currentView()).not.toBe(client.currentView());
  });
});

// The generation cadence gets its own window, and a fresh catalog that cannot
// be sold from is not an ok load.
describe('money catalog windows and sellability', () => {
  const at = (iso: string) => () => Date.parse(iso);

  it('judges generation age on its own window, not the fetch window', async () => {
    // Fetched now, generated 12 hours ago: the fetch is fresh and the catalog is
    // current (L2 publishes daily), so this is sellable.
    const clock = at('2026-10-26T00:00:00Z');
    const client = createCatalogClient(
      fakeTransport(fakeCatalog({ generatedAt: '2026-10-25T12:00:00Z' }), clock),
      { now: clock },
    );
    const view = await loadView(client);
    expect(view.stale).toBe(false);
    expect(view.purchasable).toBe(true);
  });

  it('refuses a catalog generated past the generation window', async () => {
    const clock = at('2026-10-27T13:00:00Z'); // 49 h after generatedAt
    const client = createCatalogClient(
      fakeTransport(fakeCatalog({ generatedAt: '2026-10-25T12:00:00Z' }), clock),
      { now: clock },
    );
    expect(await client.load()).toEqual({ ok: false, reason: 'stale', requestId: 'r1' });
    expect(client.currentView()?.stale).toBe(true);
  });

  it('reports not-purchasable, not ok, when a plan row cannot be sold', async () => {
    const clock = at('2026-10-25T12:05:00Z');
    const client = createCatalogClient(
      fakeTransport(fakeCatalog({ plans: [
        { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'unavailable' },
      ] }), clock),
      { now: clock },
    );
    // Fresh, so not stale; still not an ok load, because no price may be offered.
    expect(await client.load()).toEqual({ ok: false, reason: 'not-purchasable', requestId: 'r1' });
    // The rows stay readable for the screen that explains why.
    expect(client.currentView()?.purchasable).toBe(false);
    expect(client.currentView()?.stale).toBe(false);
    expect(client.lastView()?.plans).toHaveLength(1);
  });
});

// A clock that is not a number cannot age anything, and a fresh-but-unsellable
// view says why it cannot be sold.
describe('money catalog clock and reason', () => {
  it('fails closed on a clock that is not a number', async () => {
    const client = createCatalogClient(fakeTransport(fakeCatalog()), { now: () => Number.NaN });
    expect(await client.load()).toEqual({ ok: false, reason: 'stale', requestId: 'r1' });
    expect(client.currentView()?.purchasable).toBe(false);
    expect(client.currentView()?.stale).toBe(true);
  });

  it('names not-purchasable on a fresh view that cannot be sold from', async () => {
    const clock = () => Date.parse('2026-10-25T12:05:00Z');
    const client = createCatalogClient(
      fakeTransport(fakeCatalog({ plans: [
        { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'unavailable' },
      ] }), clock),
      { now: clock },
    );
    await client.load();
    expect(client.currentView()?.stale).toBe(false);
    expect(client.currentView()?.purchasable).toBe(false);
    expect(client.currentView()?.reason).toBe('not-purchasable');
  });
});
