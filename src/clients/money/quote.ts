// W0-03c: the quote client. A quote binds one account, one catalog revision and
// one SKU. judge() only compares what the wire sent against the bind input and
// the live catalog view: it never prices, never recomputes a total, and there
// is no argument anywhere that can turn a stale quote into a ready one.

import { parseQuote, type Quote } from './schema';
// One transport type in the tree: transport.ts derives it from the factory's
// return type, and this client takes only the read it uses.
import type { CatalogClient } from './catalog';
import type { MoneyTransportGet } from './transport';

export type QuoteDrift = 'catalogVersion' | 'sourceSha' | 'sku' | 'channel' | 'price';

export type QuoteUnavailableReason =
  | 'not-configured' | 'network' | 'timeout' | 'http' | 'parse' | 'invalid-shape' | 'no-total'
  | 'catalog-stale' | 'sku-not-in-catalog';

/**
 * A quote that is not `ready` carries **no price at all**. A renderer that reads
 * `state.quote.total` and branches on presence rather than on `kind` must not be
 * able to show an expired total or another account's offer as the current one;
 * `price`, `credit`, `tax` and `total` are null on every non-ready variant.
 */
export type QuoteState =
  | { kind: 'ready'; quote: Quote; requestId: string }
  | { kind: 'stale'; quote: PricedlessQuote; differences: readonly QuoteDrift[]; requestId: string }
  | { kind: 'expired'; quote: PricedlessQuote; requestId: string }
  | { kind: 'foreign'; quote: PricedlessQuote; requestId: string }
  | { kind: 'unavailable'; reason: QuoteUnavailableReason; requestId: string };

export type PricedlessQuote = Omit<Quote, 'price' | 'credit' | 'tax' | 'total'> & {
  price: null; credit: null; tax: null; total: null;
};

/** Strip every amount from a quote that is not being offered. */
function pricedless(quote: Quote): PricedlessQuote {
  return { ...quote, price: null, credit: null, tax: null, total: null };
}

export type QuoteBindInput = { accountUuid: string; sku: string; channel: 'web' | 'apple' | 'google' };

export type QuoteClient = {
  bind(input: QuoteBindInput): Promise<QuoteState>;
  reconfirm(state: QuoteState): Promise<QuoteState>;
};

export function createQuoteClient(
  transport: MoneyTransportGet,
  catalog: CatalogClient,
  options: { now?: () => number } = {},
): QuoteClient {
  const now = options.now ?? (() => Date.now());
  const bound = new Map<string, QuoteBindInput>(); // operationId -> the input that made it
  const BOUND_LIMIT = 32;

  function judge(quote: Quote, input: QuoteBindInput, requestId: string): QuoteState {
    if (!quote.total || quote.total.length === 0) return { kind: 'unavailable', reason: 'no-total', requestId };
    if (quote.accountUuid !== input.accountUuid) return { kind: 'foreign', quote: pricedless(quote), requestId };
    const expiresMs = Date.parse(quote.expiresAt);
    if (!Number.isFinite(expiresMs) || now() >= expiresMs) {
      return { kind: 'expired', quote: pricedless(quote), requestId };
    }
    // currentView() is the live view, re-judged on every read; lastView() is
    // history by contract (always stale, never purchasable) and is never used
    // as a sell gate.
    const view = catalog.currentView();
    // A ready quote is only ready against a catalog we would actually sell from:
    // fresh, and with every plan row available.
    if (view === null || view.stale || !view.purchasable) {
      return { kind: 'unavailable', reason: 'catalog-stale', requestId };
    }
    // The quote must be for a SKU the live catalog actually sells, at the price
    // the catalog publishes: a quote for a vanished SKU, or one priced 0.01 for a
    // 69.99 plan, is not something to call ready.
    const plan = view.plans.find((row) => row.sku === quote.sku);
    if (plan === undefined) return { kind: 'unavailable', reason: 'sku-not-in-catalog', requestId };
    const differences: QuoteDrift[] = [];
    if (quote.catalogVersion !== view.catalogVersion) differences.push('catalogVersion');
    if (quote.sourceSha !== view.sourceSha) differences.push('sourceSha');
    if (quote.sku !== input.sku) differences.push('sku');
    if (quote.channel !== input.channel) differences.push('channel');
    if (quote.price !== plan.monthlyPrice) differences.push('price');
    if (differences.length > 0) {
      return { kind: 'stale', quote: pricedless(quote), differences, requestId };
    }
    return { kind: 'ready', quote, requestId };
  }

  async function bind(input: QuoteBindInput): Promise<QuoteState> {
    const res = await transport.get<Quote>(
      {
        path: '/v1/quote',
        method: 'GET',
        query: { accountUuid: input.accountUuid, sku: input.sku, channel: input.channel },
      },
      parseQuote,
    );
    if (!res.ok) return { kind: 'unavailable', reason: res.reason, requestId: res.requestId };
    const state = judge(res.data, input, res.requestId);
    if (state.kind === 'ready' || state.kind === 'stale') {
      // Bounded: the oldest binding is dropped so a long session cannot grow the
      // map without limit. A dropped binding only costs one reconfirm refusal.
      if (bound.size >= BOUND_LIMIT) {
        const oldest = bound.keys().next();
        if (!oldest.done) bound.delete(oldest.value);
      }
      bound.set(res.data.operationId, { ...input });
    }
    return state;
  }

  return {
    bind,
    async reconfirm(state) {
      if (state.kind === 'expired' || state.kind === 'foreign' || state.kind === 'unavailable') return state;
      const input = bound.get(state.quote.operationId);
      if (!input) return { kind: 'unavailable', reason: 'invalid-shape', requestId: state.requestId };
      bound.delete(state.quote.operationId); // the re-bind issues a new operationId
      return bind(input);
    },
  };
}
