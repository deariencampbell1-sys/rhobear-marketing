// The transport type has exactly one definition (transport.ts, derived from the
// factory's return type); a client only needs `get`.
import type { MoneyTransportGet } from './transport';
import { parseCatalog, type CatalogPlan, type CatalogCapability } from './schema';



export type CatalogUnavailableReason =
  | 'not-configured' | 'network' | 'timeout' | 'http' | 'parse' | 'invalid-shape' | 'stale'
  // The catalog is fresh, but a plan row in it cannot be sold (unavailable):
  // the screen renders the plan's own reason, and no price is offered.
  | 'not-purchasable';

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

/**
 * `ok: true` means "fresh enough to sell from", not merely "the fetch worked":
 * a load that comes back aged (or from a generatedAt past the window) is
 * `ok: false, reason: 'stale'`, and the rows stay readable through
 * `currentView()` / `lastView()` / `capabilitiesFor()`. A caller that gates on
 * `ok` alone therefore cannot render an aged price.
 */
export type CatalogLoaded =
  | { ok: true; view: CatalogView }
  | { ok: false; reason: CatalogUnavailableReason; requestId: string };

export type CatalogClient = {
  load(): Promise<CatalogLoaded>;
  lastView(): CatalogView | null;   // previous successful view, always stale + not purchasable
  // The live view, re-judged on every read: the last load as it would judge
  // itself now, and never purchasable once a later refresh has failed.
  currentView(): CatalogView | null;
  capabilitiesFor(product: string): readonly CatalogCapability[];
};

export type CatalogOptions = {
  now?: () => number;
  /** How old a *fetch* may be before the catalog is stale. Default 15 minutes. */
  freshnessMs?: number;
  /**
   * How old the catalog's own `generatedAt` may be. Separate from the fetch
   * window on purpose: L2 publishes the catalog on a daily cadence, so a
   * ten-minute-old fetch of a twelve-hour-old catalog is current, while a
   * two-day-old generation is not. Default 24 hours.
   */
  generatedFreshnessMs?: number;
};

const DEFAULT_FRESHNESS_MS = 900_000;
const DEFAULT_GENERATED_FRESHNESS_MS = 86_400_000;

type ParsedCatalog = NonNullable<ReturnType<typeof parseCatalog>>;

// The remembered catalog is frozen the moment it is stored: currentView() hands
// the plan and capability rows to screens, and a screen that mutated one must
// not be able to rewrite the state that quote.judge() reads as its sell gate.
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export function createCatalogClient(transport: MoneyTransportGet, options: CatalogOptions = {}): CatalogClient {
  const now = options.now ?? (() => Date.now());
  const freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS;
  const generatedFreshnessMs = options.generatedFreshnessMs ?? DEFAULT_GENERATED_FRESHNESS_MS;
  // What was loaded (frozen), when the transport fetched it, and whether the
  // most recent refresh failed. The verdict is recomputed from these on every
  // read, so a view can age into stale and a failed refresh can withdraw it.
  let last: { catalog: ParsedCatalog; fetchedAt: number; refreshFailed: boolean } | null = null;

  function buildView(catalog: ParsedCatalog, fetchedAt: number, refreshFailed: boolean): CatalogView {
    const generatedAt = Date.parse(catalog.generatedAt);
    // Unreachable from the wire (parseCatalog refuses a non-RFC3339 generatedAt,
    // and money-catalog.test.ts pins that refusal); kept as a belt for a view
    // built by hand.
    const generatedBad = Number.isNaN(generatedAt);
    // A fetchedAt that is not a finite number is not a timestamp: it fails
    // closed rather than defaulting to "just now".
    const fetchedBad = !Number.isFinite(fetchedAt);
    // Two ages matter: how long ago we fetched, and how long ago the catalog was
    // generated. A fresh fetch of a ten-day-old catalog is still a stale price.
    // A clock that is not a finite number cannot age anything: fail closed
    // rather than treat NaN comparisons (always false) as fresh.
    const current = now();
    const nowBad = !Number.isFinite(current);
    const fetchedAge = fetchedBad || nowBad ? Number.POSITIVE_INFINITY : current - fetchedAt;
    // A generatedAt in the future is server-side clock skew, not age; it is
    // clamped rather than trusted, and the fetch age still governs freshness.
    const generatedAge = generatedBad || nowBad ? Number.POSITIVE_INFINITY : Math.max(0, current - generatedAt);
    // A negative fetch age means our clock moved backwards since the fetch; that
    // is not evidence of freshness, so it is stale too.
    const stale = refreshFailed || fetchedBad || generatedBad || nowBad
      || fetchedAge < 0
      || fetchedAge > freshnessMs || generatedAge > generatedFreshnessMs;
    const allAvailable = catalog.plans.every((p) => p.availability === 'available');
    const purchasable = !stale && allAvailable;
    return {
      purchasable,
      catalogVersion: catalog.catalogVersion,
      sourceSha: catalog.sourceSha,
      generatedAt: generatedBad ? 0 : generatedAt,
      fetchedAt: fetchedBad ? 0 : fetchedAt,
      stale,
      plans: catalog.plans,
      capabilities: catalog.capabilities,
      // A view that is fresh but cannot be sold says why, so a screen never has
      // to infer it from `purchasable: false` alone.
      reason: stale ? 'stale' : purchasable ? undefined : 'not-purchasable',
    };
  }

  function liveView(): CatalogView | null {
    if (last === null) return null;
    return buildView(last.catalog, last.fetchedAt, last.refreshFailed);
  }

  return {
    async load(): Promise<CatalogLoaded> {
      const res = await transport.get<ParsedCatalog>(
        { path: '/v1/catalog', method: 'GET' },
        parseCatalog,
      );
      if (!res.ok) {
        // A failed refresh withdraws the sell gate: the remembered rows stay
        // readable for display, but nothing may be sold off a catalog whose
        // most recent load errored.
        if (last !== null) last = { ...last, refreshFailed: true };
        return { ok: false, reason: res.reason, requestId: res.requestId };
      }
      // Age is measured from when the transport fetched the body, not from this call:
      // a re-load must be able to observe that the catalog on disk is old.
      const fetchedAt = res.fetchedAt;
      const catalog = deepFreeze(res.data);
      last = { catalog, fetchedAt, refreshFailed: false };
      const view = buildView(catalog, fetchedAt, false);
      // Every load is remembered, so a screen can still show the plans, the
      // capabilities and the reason when it cannot sell. But a load that cannot
      // be sold from is not a success: `ok` means sellable, not fetched.
      if (view.stale) return { ok: false, reason: 'stale', requestId: res.requestId };
      if (!view.purchasable) return { ok: false, reason: 'not-purchasable', requestId: res.requestId };
      return { ok: true, view };
    },
    lastView() {
      const view = liveView();
      if (view === null) return null;
      // History by contract: always stale, never purchasable.
      return { ...view, stale: true, purchasable: false, reason: 'stale' };
    },
    currentView() {
      // Re-judged on every read against the current clock and the outcome of
      // the most recent refresh.
      const view = liveView();
      return view === null ? null : { ...view };
    },
    capabilitiesFor(product: string) {
      if (last === null) return [];
      return last.catalog.capabilities.filter((row) => row.product === product);
    },
  };
}
