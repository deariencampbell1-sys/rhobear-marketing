import { describe, expect, it } from 'vitest';
import {
  channelHandoff,
  conflictSupport,
  createEntitlementClient,
  presentationByState,
  type EntitlementView,
  type Presentation,
} from '../src/clients/money/entitlement';
import type { MoneyTransport } from '../src/clients/money/catalog';
import type { MoneyRequest, MoneyResult } from '../src/clients/money/transport';
import type { Entitlement, EntitlementState } from '../src/clients/money/schema';

// No network: the fake runs the payload through the parser the client handed
// it, so every fixture below is judged by parseEntitlement itself — the same
// refusal the real transport would apply.
const okTransport = (payload: unknown): MoneyTransport => ({
  async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
    const data = parse(payload);
    if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'req-1' };
    return { ok: true, data, requestId: 'req-1', fetchedAt: 1 };
  },
});

const failingTransport: MoneyTransport = {
  async get<T>(): Promise<MoneyResult<T>> {
    return { ok: false, reason: 'network', requestId: 'req-1' };
  },
};

// A valid entitlement: a paying subscriber, paid through the far future, so
// nothing below can mistake them for someone to sell to.
const fixture = (over: Partial<Entitlement> = {}): Entitlement => ({
  accountUuid: 'acct-1',
  product: 'builds',
  capability: 'apollo',
  plan: 'shell',
  channel: 'web',
  state: 'active',
  paidThrough: '2999-01-01T00:00:00Z',
  catalogVersion: '2026-10-25.1',
  revision: 7,
  ...over,
});

const loadWith = (transport: MoneyTransport) =>
  createEntitlementClient(transport).load({ accountUuid: 'acct-1', product: 'builds' });

const viewOf = (over: Partial<Entitlement> = {}) => loadWith(okTransport(fixture(over)));

// The known variant is the one carrying an entitlement; assert it by name.
const asKnown = async (view: EntitlementView) => {
  expect(view.state).toBe('known');
  if (view.state !== 'known') throw new Error(`expected a known view, got ${view.state}`);
  return view;
};

describe('money entitlement client', () => {
  it('fails closed to reconcile on any transport error', async () => {
    const view = await loadWith(failingTransport);
    expect(view).toEqual({
      state: 'unknown', presentation: 'reconcile', reason: 'network', requestId: 'req-1',
    });
    expect(view.state).not.toBe('free-local');
    expect(JSON.stringify(view)).not.toContain('free-local');
    expect('entitlement' in view).toBe(false);
  });

  // Table-driven: nine wire states, nine presentations, no defaults.
  const presentationTable: ReadonlyArray<readonly [EntitlementState, Presentation]> = [
    ['active', 'manage'],
    ['canceled-until-paid-through', 'manage'],
    ['free-local', 'upgrade'],
    ['grace', 'export-only'],
    ['expired', 'expired'],
    ['pending', 'confirming'],
    ['past-due', 'billing-issue'],
    ['conflict', 'conflict'],
    ['unknown', 'reconcile'],
  ];

  it('maps all nine states to their presentations', async () => {
    expect(presentationTable).toHaveLength(9);
    for (const [state, expected] of presentationTable) {
      expect(presentationByState[state]).toBe(expected);
      const known = await asKnown(await viewOf({ state }));
      expect(known.presentation).toBe(expected);
    }
  });

  it('makes an expired paidThrough expired, not manage', async () => {
    const ended = await asKnown(await viewOf({
      state: 'canceled-until-paid-through', paidThrough: '2020-01-01T00:00:00Z',
    }));
    expect(ended.presentation).toBe('expired');
    expect(ended.handoff).toBeUndefined();
    for (const channel of ['web', 'apple', 'google'] as const) {
      const live = await asKnown(await viewOf({
        state: 'canceled-until-paid-through',
        paidThrough: '2999-01-01T00:00:00Z',
        channel,
      }));
      expect(live.presentation).toBe('manage');
      expect(live.handoff).toBe(channelHandoff[channel]);
    }
  });

  it('never shows a sale to a subscriber and never sends an apple subscriber to stripe', async () => {
    const view = await asKnown(await viewOf({
      state: 'active', paidThrough: '2999-01-01T00:00:00Z', channel: 'apple',
    }));
    expect(view.presentation).toBe('manage');
    expect(view.showsPrice).toBe(false);
    expect(view.handoff).toBe('native-manage');
    // Neutralise the flag's own key, then judge the rest of the serialised view.
    const serialised = JSON.stringify(view).split('showsPrice').join('flag');
    expect(serialised).not.toMatch(/price|offer|sale|discount|checkout/i);
    expect(serialised).not.toMatch(/stripe/i);
  });

  it('returns a support route, not a purchase route, on conflict', async () => {
    const view = await asKnown(await viewOf({ state: 'conflict', paidThrough: null }));
    expect(view.presentation).toBe('conflict');
    expect(view.handoff).toBeUndefined();
    expect(conflictSupport().route).toBe('/support');
    expect(conflictSupport().mustVerifyFirst).toBe(true);
  });
});
