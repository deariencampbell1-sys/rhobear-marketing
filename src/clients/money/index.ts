// W0-03f: the money surface barrel. Re-exports only, plus one factory that
// gives a screen a single call: every client underneath shares one transport
// and one clock, so there is no second configuration to keep honest.

export * from './transport';
export * from './schema';
export * from './catalog';

// quote.ts and entitlement.ts both export `channelHandoff` (same shape, two
// owners). Their own files keep the name; these two lines are explicit lists
// so the collision is aliased here instead of renamed there.
export type {
  QuoteDrift, QuoteUnavailableReason, QuoteState, QuoteBindInput, QuoteClient,
} from './quote';
export { channelHandoff as quoteChannelHandoff, createQuoteClient } from './quote';
export type {
  Presentation, ChannelHandoff, EntitlementUnavailableReason, EntitlementView,
  EntitlementLoadInput,
} from './entitlement';
export {
  channelHandoff as entitlementChannelHandoff,
  presentationByState, conflictSupport, createEntitlementClient,
} from './entitlement';

export * from './bank';

import type { MoneyTransportConfig } from './transport';
import { createMoneyTransport } from './transport';
import { createCatalogClient, type CatalogClient } from './catalog';
import { createQuoteClient } from './quote';
import { createEntitlementClient } from './entitlement';
import { createBankClient } from './bank';

/** One call a screen makes; every client shares the same transport. */
export function createMoneySurface(config: MoneyTransportConfig, options: { now?: () => number } = {}) {
  const transport = createMoneyTransport(config);
  const catalog: CatalogClient = createCatalogClient(transport, options);
  return {
    transport,
    catalog,
    quote: createQuoteClient(transport, catalog, options),
    entitlement: createEntitlementClient(transport, options),
    bank: createBankClient(transport, options),
  };
}

export type MoneySurface = ReturnType<typeof createMoneySurface>;
