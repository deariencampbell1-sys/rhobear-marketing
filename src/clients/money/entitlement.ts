// W0-03d: the entitlement client. One view per load, and the two rules that
// shape it: an existing subscriber is never shown a sale (every known view
// carries showsPrice: false) and an unknown answer is never rendered as "not
// subscribed" — transport failure, an invalid body and a session mismatch all
// fail closed to state 'unknown' / 'reconcile', never to 'free-local'.

import { parseEntitlement, type Entitlement } from './schema';
// MoneyTransport lives in catalog.ts: a local alias for the exact signature
// createMoneyTransport returns (transport.ts exports the factory, not the type).
import type { MoneyTransport } from './catalog';

export type Presentation =
  | 'manage' | 'upgrade' | 'export-only' | 'expired'
  | 'confirming' | 'billing-issue' | 'conflict' | 'reconcile';

export type ChannelHandoff = 'stripe-portal' | 'native-manage' | 'play-manage';

export type EntitlementUnavailableReason =
  | 'not-configured' | 'network' | 'timeout' | 'http' | 'parse' | 'invalid-shape' | 'session-mismatch';

export type EntitlementView =
  | { state: 'known'; presentation: Presentation; entitlement: Entitlement; paidThroughMs: number | null;
      handoff?: ChannelHandoff; showsPrice: false }
  | { state: 'unknown'; presentation: 'reconcile'; reason: EntitlementUnavailableReason; requestId: string };

export type EntitlementLoadInput = { accountUuid: string; product: string; capability?: string };

export const channelHandoff: Readonly<Record<'web' | 'apple' | 'google', ChannelHandoff>> = {
  web: 'stripe-portal', apple: 'native-manage', google: 'play-manage',
};

export const presentationByState: Readonly<Record<Entitlement['state'], Presentation>> = {
  active: 'manage',
  'canceled-until-paid-through': 'manage',
  'free-local': 'upgrade',
  grace: 'export-only',
  expired: 'expired',
  pending: 'confirming',
  'past-due': 'billing-issue',
  conflict: 'conflict',
  unknown: 'reconcile',
};

export function conflictSupport(): { route: '/support'; mustVerifyFirst: true } {
  return { route: '/support', mustVerifyFirst: true };
}

export function createEntitlementClient(
  transport: MoneyTransport,
  options: { now?: () => number } = {},
): {
  load(input: EntitlementLoadInput): Promise<EntitlementView>;
} {
  const now = options.now ?? (() => Date.now());
  return {
    async load(input) {
      const query: Record<string, string> = { accountUuid: input.accountUuid, product: input.product };
      if (input.capability !== undefined) query.capability = input.capability;
      const res = await transport.get<Entitlement>(
        { path: '/v1/entitlements', method: 'GET', query },
        parseEntitlement,
      );
      if (!res.ok) {
        return { state: 'unknown', presentation: 'reconcile', reason: res.reason, requestId: res.requestId };
      }
      const entitlement = res.data;
      // The response must answer the question we asked: another account's
      // entitlement, or another product's, is a session mismatch, not a view.
      if (entitlement.accountUuid !== input.accountUuid || entitlement.product !== input.product) {
        return {
          state: 'unknown', presentation: 'reconcile',
          reason: 'session-mismatch', requestId: res.requestId,
        };
      }
      const parsedPaidThrough = Date.parse(entitlement.paidThrough ?? '');
      const paidThroughMs = Number.isNaN(parsedPaidThrough) ? null : parsedPaidThrough;
      // The subscriber states: a subscriber whose paid-through date has passed is
      // expired, not upgraded. (Named for what it holds, not for what it means.)
      const subscriberState = entitlement.state === 'active' || entitlement.state === 'canceled-until-paid-through';
      const pastPaidThrough = paidThroughMs === null || paidThroughMs <= now();
      const presentation = subscriberState && pastPaidThrough ? 'expired' : presentationByState[entitlement.state];
      const handoff = presentation === 'manage' ? channelHandoff[entitlement.channel] : undefined;
      return { state: 'known', presentation, entitlement, paidThroughMs, handoff, showsPrice: false };
    },
  };
}
