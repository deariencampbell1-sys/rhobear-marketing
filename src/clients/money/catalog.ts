import type { MoneyRequest, MoneyResult } from './transport';
import { parseCatalog, type CatalogPlan, type CatalogCapability } from './schema';

// Local alias: transport.ts exports createMoneyTransport but no MoneyTransport
// type; this mirrors the exact signature returned by createMoneyTransport.
export type MoneyTransport = {
  get<T>(req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>>;
};

export type CatalogUnavailableReason =
  | 'not-configured' | 'network' | 'timeout' | 'http' | 'parse' | 'invalid-shape' | 'stale';

export type CatalogView = {
  purchasable: boolean;
  catalogVersion: string;
  sourceSha: string;
  generatedAt: number;
  fetchedAt: number;
  stale: boolean;
  plans: readonly CatalogPlan[];
  capabilities: readonly CatalogCapability[];
  reason?: CatalogUnavailableReason;
};

export type CatalogLoaded =
  | { ok: true; view: CatalogView }
  | { ok: false; reason: CatalogUnavailableReason; requestId: string };

export type CatalogClient = {
  load(): Promise<CatalogLoaded>;
  lastView(): CatalogView | null;                       // previous successful view, always stale + not purchasable
  // The live view: the last load as it judged itself. Optional so a fake in a
  // test does not have to model it; a caller that needs a price must use this,
  // never lastView().
  currentView?(): CatalogView | null;
  capabilitiesFor(product: string): readonly CatalogCapability[];
};

export type CatalogOptions = { now?: () => number; freshnessMs?: number };

const DEFAULT_FRESHNESS_MS = 900_000;

export function createCatalogClient(transport: MoneyTransport, options: CatalogOptions = {}): CatalogClient {
  const now = options.now ?? (() => Date.now());
  const freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS;
  let last: { view: CatalogView } | null = null;

  function buildView(catalog: ReturnType<typeof parseCatalog> & object, fetchedAt: number): CatalogView {
    const generatedAt = Date.parse(catalog.generatedAt);
    const generatedBad = Number.isNaN(generatedAt);
    // Two ages matter: how long ago we fetched, and how long ago the catalog was
    // generated. A fresh fetch of a ten-day-old catalog is still a stale price.
    const fetchedAge = now() - fetchedAt;
    const generatedAge = generatedBad ? Number.POSITIVE_INFINITY : now() - generatedAt;
    const stale = generatedBad || fetchedAge > freshnessMs || generatedAge > freshnessMs;
    const allAvailable = catalog.plans.every((p) => p.availability === 'available');
    const purchasable = !stale && allAvailable;
    return {
      purchasable,
      catalogVersion: catalog.catalogVersion,
      sourceSha: catalog.sourceSha,
      generatedAt: generatedBad ? 0 : generatedAt,
      fetchedAt,
      stale,
      plans: catalog.plans,
      capabilities: catalog.capabilities,
      reason: stale ? 'stale' : undefined,
    };
  }

  return {
    async load(): Promise<CatalogLoaded> {
      const res = await transport.get<ReturnType<typeof parseCatalog> & object>(
        { path: '/v1/catalog', method: 'GET' },
        parseCatalog,
      );
      if (!res.ok) return { ok: false, reason: res.reason, requestId: res.requestId };
      // Age is measured from when the transport fetched the body, not from this call:
      // a re-load must be able to observe that the catalog on disk is old.
      const fetchedAt = Number.isFinite(res.fetchedAt) ? res.fetchedAt : now();
      const view = buildView(res.data, fetchedAt);
      // Every successful load is remembered: a screen must still be able to
      // show the plans, the capabilities and the reason when it cannot sell.
      last = { view };
      return { ok: true, view };
    },
    lastView() {
      if (!last) return null;
      return { ...last.view, stale: true, purchasable: false, reason: 'stale' };
    },
    currentView() {
      // As the load judged itself: `stale` here is the freshness verdict, not
      // the forced-stale history that lastView() reports.
      return last ? last.view : null;
    },
    capabilitiesFor(product: string) {
      const view = last?.view;
      if (!view) return [];
      return view.capabilities.filter((row) => row.product === product);
    },
  };
}
