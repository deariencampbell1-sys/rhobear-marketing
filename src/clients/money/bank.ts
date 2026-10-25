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

export type BankOptions = {
  now?: () => number;
  /** How old a fetched balance may be before it stops authorising paid work. Default 15 minutes. */
  freshnessMs?: number;
};

const DEFAULT_BANK_FRESHNESS_MS = 900_000;

export function createBankClient(
  transport: MoneyTransport,
  options: BankOptions = {},
): {
  load(): Promise<BankResult>;
  lastSnapshot(): BankSnapshot | null;
  /**
   * The last balance, re-judged against the clock now: a snapshot held by a
   * screen for an hour stops authorising paid work on its own. `null` when
   * nothing was ever loaded.
   */
  currentSnapshot(): BankSnapshot | null;
} {
  const now = options.now ?? (() => Date.now());
  const freshnessMs = options.freshnessMs ?? DEFAULT_BANK_FRESHNESS_MS;
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
  function unreachable(fetchedAt: number): BankSnapshot {
    return {
      state: 'reconciling',
      revision: -1,
      // Empty, not '0.00': a plausible-looking zero is a balance claim, and we
      // do not have one. formatMoney('') returns '' unchanged, so a renderer
      // that forgets to gate on state prints nothing rather than "$0.00".
      creditAvailable: '',
      creditReserved: '',
      allowanceRemaining: '',
      purchasedRemaining: '',
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
        const snapshot = unreachable(now());
        return { ok: false, snapshot, reason: res.reason };
      }
      // A fetchedAt that is not a finite number is not a timestamp: the balance
      // cannot be aged, so it is never remembered as a live balance.
      if (!Number.isFinite(res.fetchedAt)) {
        return { ok: false, snapshot: unreachable(now()), reason: 'invalid-shape' };
      }
      // Frozen and stored: a caller cannot rewrite the remembered balance, and
      // `currentSnapshot()` re-judges its age instead of trusting this moment.
      const snapshot = Object.freeze(toSnapshot(res.data, res.fetchedAt, false));
      previous = snapshot;
      return { ok: true, snapshot: { ...snapshot } };
    },
    lastSnapshot() {
      // A remembered snapshot is history: it never authorises new paid work,
      // because the balance on disk may already be spent.
      return previous ? { ...previous, stale: true, canStartPaidWork: false } : null;
    },
    currentSnapshot() {
      if (previous === null) return null;
      const age = now() - previous.fetchedAt;
      const aged = !Number.isFinite(age) || age < 0 || age > freshnessMs;
      if (!aged) return { ...previous };
      return { ...previous, stale: true, canStartPaidWork: false };
    },
  };
}

// Display only: validate the decimal string, prefix '$', never re-round it.
// An unrecognised value is returned unchanged — never coerced, never '0.00'.
// Twelve integer digits is deliberate headroom over the nine a price needs:
// a large credit balance must still render, and the shape is what is validated,
// not the magnitude.
export function formatMoney(value: string): string {
  return /^\d{1,12}\.\d{2}$/.test(value) ? `$${value}` : value;
}
