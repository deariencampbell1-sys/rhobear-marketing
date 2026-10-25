// W0-03c: the quote client. A quote binds one account, one catalog revision and
// one SKU. judge() only compares what the wire sent against the bind input and
// the last catalog view: it never prices, never recomputes a total, and there
// is no argument anywhere that can turn a stale quote into a ready one.

import { parseQuote, type Quote } from './schema';
// MoneyTransport lives in catalog.ts: a local alias for the exact signature
// createMoneyTransport returns (transport.ts exports the factory, not the type).
import type { CatalogClient, MoneyTransport } from './catalog';

export type QuoteDrift = 'catalogVersion' | 'sourceSha' | 'sku' | 'channel' | 'accountUuid';

export type QuoteUnavailableReason =
  | 'not-configured' | 'network' | 'timeout' | 'http' | 'parse' | 'invalid-shape' | 'no-total'
  | 'catalog-stale';

export type QuoteState =
  | { kind: 'ready'; quote: Quote; requestId: string }
  | { kind: 'stale'; quote: Quote; differences: readonly QuoteDrift[]; requestId: string }
  | { kind: 'expired'; quote: Quote; requestId: string }
  | { kind: 'foreign'; quote: Quote; requestId: string }
  | { kind: 'unavailable'; reason: QuoteUnavailableReason; requestId: string };

export type QuoteBindInput = { accountUuid: string; sku: string; channel: 'web' | 'apple' | 'google' };

export type QuoteClient = {
  bind(input: QuoteBindInput): Promise<QuoteState>;
  reconfirm(state: QuoteState): Promise<QuoteState>;
};

// Channel -> the screen that reaches checkout; a UI can render this directly.
export const channelHandoff: Readonly<Record<'web' | 'apple' | 'google', string>> = {
  web: 'stripe-portal',
  apple: 'native-manage',
  google: 'play-manage',
};

export function createQuoteClient(
  transport: MoneyTransport,
  catalog: CatalogClient,
  options: { now?: () => number } = {},
): QuoteClient {
  const now = options.now ?? (() => Date.now());
  const bound = new Map<string, QuoteBindInput & { requestId: string }>(); // operationId -> the input that made it
  const BOUND_LIMIT = 32;

  function judge(quote: Quote, input: QuoteBindInput, requestId: string): QuoteState {
    if (!quote.total || quote.total.length === 0) return { kind: 'unavailable', reason: 'no-total', requestId };
    if (quote.accountUuid !== input.accountUuid) return { kind: 'foreign', quote, requestId };
    const expiresMs = Date.parse(quote.expiresAt);
    if (!Number.isFinite(expiresMs) || now() >= expiresMs) return { kind: 'expired', quote, requestId };
    // lastView() is history by contract: always stale, never purchasable. A live
    // price has to judge itself against the live view.
    const view = catalog.currentView ? catalog.currentView() : catalog.lastView();
    // A ready quote is only ready against a catalog we would actually sell from.
    // lastView() is always stale and never purchasable, so a live price needs a
    // fresh load; anything less is refused here rather than trusted by a screen.
    if (view === null || view.stale || !view.purchasable) {
      return { kind: 'unavailable', reason: 'catalog-stale', requestId };
    }
    const differences: QuoteDrift[] = [];
    if (view === null || quote.catalogVersion !== view.catalogVersion) differences.push('catalogVersion');
    if (view === null || quote.sourceSha !== view.sourceSha) differences.push('sourceSha');
    if (quote.sku !== input.sku) differences.push('sku');
    if (quote.channel !== input.channel) differences.push('channel');
    if (differences.length > 0) return { kind: 'stale', quote, differences, requestId };
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
      bound.set(res.data.operationId, { ...input, requestId: res.requestId });
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
