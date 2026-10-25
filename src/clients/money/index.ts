// W0-03f: the money surface barrel. Re-exports only, plus one factory that
// gives a screen a single call: every client underneath shares one transport
// and one clock, so there is no second configuration to keep honest.

export * from './transport';
export * from './schema';
export * from './catalog';
// quote.ts no longer carries a channel->handoff table at all (it only compares
// `quote.channel` with the bind input), so entitlement.ts is the single owner of
// channelHandoff and the two barrels below can be plain re-exports with no
// aliasing.
export * from './quote';
export * from './entitlement';
export * from './bank';

import type { MoneyTransportConfig } from './transport';
import { createMoneyTransport } from './transport';
import { createCatalogClient, type CatalogClient } from './catalog';
import { createQuoteClient } from './quote';
import { createEntitlementClient } from './entitlement';
import { createBankClient } from './bank';

/**
 * One call a screen makes; every client shares the same transport.
 *
 * There is literally one clock: options.now, when given, is the transport's
 * clock too, so fetchedAt (stamped by the transport) and every freshness or
 * expiry verdict are judged on the same epoch.
 */
export function createMoneySurface(config: MoneyTransportConfig, options: { now?: () => number } = {}) {
  const clock = options.now ?? config.now;
  const transport = createMoneyTransport({ ...config, now: clock });
  const clientOptions = { now: clock };
  const catalog: CatalogClient = createCatalogClient(transport, clientOptions);
  return {
    transport,
    catalog,
    quote: createQuoteClient(transport, catalog, clientOptions),
    entitlement: createEntitlementClient(transport, clientOptions),
    bank: createBankClient(transport, clientOptions),
  };
}

export type MoneySurface = ReturnType<typeof createMoneySurface>;
