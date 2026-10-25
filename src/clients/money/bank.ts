// W0-03e: the bank client. Committed, account-scoped credit mapped straight
// through: `state` passes through untouched (no computed 'low', no computed
// 'empty'), every money value stays a decimal string, and the one derived
// flag is canStartPaidWork — true for 'available' and 'low' alone. A failed
// fetch is state 'reconciling' with stale: true, revision -1 and placeholder
// strings the renderer must never print as a real balance — never 'empty'.

// MoneyTransport lives in catalog.ts: a local alias for the exact signature
// createMoneyTransport returns (transport.ts exports the factory, not the type).
import type { MoneyTransport } from './catalog';
import { parseBank, type Bank, type BankState } from './schema';

export type BankSnapshot = {
  state: BankState;
  revision: number;
  creditAvailable: string;
  creditReserved: string;
  allowanceRemaining: string;
  purchasedRemaining: string;
  resetsAtMs: number | null;
  stale: boolean;
  fetchedAt: number;
  canStartPaidWork: boolean;
};

export type BankResult =
  | { ok: true; snapshot: BankSnapshot }
  | { ok: false; snapshot: BankSnapshot; reason: BankUnavailableReason };

export type BankUnavailableReason =
  | 'not-configured' | 'network' | 'timeout' | 'http' | 'parse' | 'invalid-shape';

export function createBankClient(
  transport: MoneyTransport,
  options: { now?: () => number } = {},
): {
  load(): Promise<BankResult>;
  lastSnapshot(): BankSnapshot | null;
} {
  const now = options.now ?? (() => Date.now());
  let previous: BankSnapshot | null = null;

  function toSnapshot(bank: Bank, fetchedAt: number, stale: boolean): BankSnapshot {
    const parsedResetsAt = Date.parse(bank.resetsAt);
    const resetsAtMs = Number.isNaN(parsedResetsAt) ? null : parsedResetsAt;
    return {
      state: bank.state,
      revision: bank.revision,
      creditAvailable: bank.creditAvailable,
      creditReserved: bank.creditReserved,
      allowanceRemaining: bank.allowanceRemaining,
      purchasedRemaining: bank.purchasedRemaining,
      resetsAtMs,
      stale,
      fetchedAt,
      canStartPaidWork: bank.state === 'available' || bank.state === 'low',
    };
  }

  // Unreachable: 'reconciling' + stale mark the placeholders as not a balance.
  // revision -1 and canStartPaidWork: false keep the renderer from trusting them.
  function unreachable(_reason: BankUnavailableReason, fetchedAt: number): BankSnapshot {
    return {
      state: 'reconciling',
      revision: -1,
      creditAvailable: '0.00',
      creditReserved: '0.00',
      allowanceRemaining: '0.00',
      purchasedRemaining: '0.00',
      resetsAtMs: null,
      stale: true,
      fetchedAt,
      canStartPaidWork: false,
    };
  }

  return {
    async load(): Promise<BankResult> {
      const res = await transport.get<Bank>({ path: '/v1/bank', method: 'GET' }, parseBank);
      if (!res.ok) {
        const snapshot = unreachable(res.reason, now());
        return { ok: false, snapshot, reason: res.reason };
      }
      const snapshot = toSnapshot(res.data, res.fetchedAt, false);
      previous = snapshot;
      return { ok: true, snapshot };
    },
    lastSnapshot() {
      return previous ? { ...previous, stale: true } : null;
    },
  };
}

// Display only: validate the decimal string, prefix '$', never re-round it.
// An unrecognised value is returned unchanged — never coerced, never '0.00'.
export function formatMoney(value: string): string {
  return /^\d{1,9}\.\d{2}$/.test(value) ? `$${value}` : value;
}
