// W0-03d: the entitlement client. One view per load, and the two rules that
// shape it: an existing subscriber is never shown a sale (every known view
// carries showsPrice: false) and an unknown answer is never rendered as "not
// subscribed" — transport failure, an invalid body and a session mismatch all
// fail closed to state 'unknown' / 'reconcile', never to 'free-local'.

import { parseEntitlement, type Entitlement } from './schema';
// One transport type in the tree: transport.ts derives it from the factory's
// return type, and this client takes only the read it uses.
import type { MoneyTransportGet } from './transport';

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

/**
 * The presentation a subscriber state earns at a given moment. Judged by the
 * caller on every read, never cached: a view held across the paid-through
 * boundary must stop saying 'manage'.
 */
function presentationOf(state: Entitlement['state'], paidThroughMs: number | null, at: number): Presentation {
  const subscriberState = state === 'active' || state === 'canceled-until-paid-through';
  const pastPaidThrough = paidThroughMs === null || paidThroughMs <= at;
  return subscriberState && pastPaidThrough ? 'expired' : presentationByState[state];
}

/**
 * Where a subscriber manages or renews. An **expired** subscriber renews in the
 * same place a live one manages — the Stripe portal for web, the native store
 * for apple and google — so 'expired' is not a dead end with no route at all.
 */
function handoffOf(presentation: Presentation, channel: Entitlement['channel']): ChannelHandoff | undefined {
  return presentation === 'manage' || presentation === 'expired' ? channelHandoff[channel] : undefined;
}

export function createEntitlementClient(
  transport: MoneyTransportGet,
  options: { now?: () => number } = {},
): {
  load(input: EntitlementLoadInput): Promise<EntitlementView>;
} {
  const now = options.now ?? (() => Date.now());
  // The two verdict fields are getters re-judged against the clock on every
  // read, on a frozen object: a screen holding the view across the paid-through
  // boundary cannot keep showing 'manage'.
  function liveView(base: Extract<EntitlementView, { state: 'known' }>): EntitlementView {
    const view = { ...base };
    Object.defineProperty(view, 'presentation', {
      enumerable: true,
      get() {
        return presentationOf(base.entitlement.state, base.paidThroughMs, now());
      },
    });
    Object.defineProperty(view, 'handoff', {
      enumerable: true,
      get() {
        return handoffOf(presentationOf(base.entitlement.state, base.paidThroughMs, now()), base.entitlement.channel);
      },
    });
    return Object.freeze(view);
  }

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
      // The response must answer the question we asked — the same account, the
      // same product, and the same capability when one was requested. Anything
      // else is a session mismatch, not a view.
      if (entitlement.accountUuid !== input.accountUuid || entitlement.product !== input.product) {
        return {
          state: 'unknown', presentation: 'reconcile',
          reason: 'session-mismatch', requestId: res.requestId,
        };
      }
      if (input.capability !== undefined && entitlement.capability !== input.capability) {
        return {
          state: 'unknown', presentation: 'reconcile',
          reason: 'session-mismatch', requestId: res.requestId,
        };
      }
      const parsedPaidThrough = Date.parse(entitlement.paidThrough ?? '');
      const paidThroughMs = Number.isNaN(parsedPaidThrough) ? null : parsedPaidThrough;
      return liveView({
        state: 'known',
        presentation: presentationOf(entitlement.state, paidThroughMs, now()),
        entitlement,
        paidThroughMs,
        handoff: handoffOf(presentationOf(entitlement.state, paidThroughMs, now()), entitlement.channel),
        showsPrice: false,
      });
    },
  };
}
