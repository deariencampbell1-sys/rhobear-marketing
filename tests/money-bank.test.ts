import { describe, expect, it } from 'vitest';
import { createBankClient, formatMoney, type BankSnapshot } from '../src/clients/money/bank';
import type { MoneyTransport } from '../src/clients/money/catalog';
import type { MoneyRequest, MoneyResult } from '../src/clients/money/transport';
import type { Bank, BankState } from '../src/clients/money/schema';

// No network: the fake runs the payload through the parser the client handed
// it, so a fixture below is judged by parseBank exactly as the wire would be.
const okTransport = (payload: unknown): MoneyTransport => ({
  async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
    const data = parse(payload);
    if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'req-1' };
    return { ok: true, data, requestId: 'req-1', fetchedAt: 42 };
  },
});

const failingTransport: MoneyTransport = {
  async get<T>(): Promise<MoneyResult<T>> {
    return { ok: false, reason: 'network', requestId: 'req-1' };
  },
};

// A valid bank body: four decimal strings and a wire state the client only
// passes through.
const fixture = (over: Partial<Bank> = {}): Bank => ({
  revision: 7,
  currency: 'USD',
  creditAvailable: '12.00',
  creditReserved: '3.50',
  allowanceRemaining: '19.00',
  purchasedRemaining: '4.25',
  resetsAt: '2026-11-01T00:00:00Z',
  state: 'available',
  ...over,
});

const MONEY_FIELDS = [
  'creditAvailable', 'creditReserved', 'allowanceRemaining', 'purchasedRemaining',
] as const;

describe('money bank client', () => {
  it('returns reconciling, never zero, when the bank is unreachable', async () => {
    const res = await createBankClient(failingTransport).load();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('an unreachable bank must not report ok');
    expect(res.reason).toBe('network');
    expect(res.snapshot.state).toBe('reconciling');
    expect(res.snapshot.state).not.toBe('empty');
    expect(res.snapshot.stale).toBe(true);
    expect(res.snapshot.canStartPaidWork).toBe(false);
    expect(res.snapshot.revision).toBe(-1);
  });

  // The wire state is the only input to canStartPaidWork; nothing is inferred.
  const wireStates: ReadonlyArray<readonly [BankState, boolean]> = [
    ['available', true],
    ['low', true],
    ['empty', false],
    ['reconciling', false],
  ];

  it('passes state through without computing it', async () => {
    for (const [state, canStart] of wireStates) {
      const res = await createBankClient(okTransport(fixture({ state }))).load();
      expect(res.ok).toBe(true);
      expect(res.snapshot.state).toBe(state);
      expect(res.snapshot.canStartPaidWork).toBe(canStart);
    }
  });

  it('keeps money as decimal strings', async () => {
    const res = await createBankClient(okTransport(fixture())).load();
    expect(res.ok).toBe(true);
    for (const field of MONEY_FIELDS) {
      const value: string = res.snapshot[field];
      expect(typeof value).toBe('string');
    }
  });

  it('marks lastSnapshot stale and does not resurrect a balance', async () => {
    // One client, two transports: the wire goes quiet after a good load.
    let transport: MoneyTransport = failingTransport;
    const gate: MoneyTransport = {
      async get<T>(req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
        return transport.get<T>(req, parse);
      },
    };
    const client = createBankClient(gate);
    expect(client.lastSnapshot()).toBeNull(); // before any load: nothing at all

    transport = okTransport(fixture());
    const good = await client.load();
    expect(good.ok).toBe(true);
    const remembered: BankSnapshot | null = client.lastSnapshot();
    expect(remembered).toEqual({ ...good.snapshot, stale: true, canStartPaidWork: false });
    expect(remembered?.stale).toBe(true);

    // The later failure keeps the remembered values under their stale mark:
    // the balance is never resurrected as fresh, nor replaced by placeholders.
    transport = failingTransport;
    const failed = await client.load();
    expect(failed.ok).toBe(false);
    // Remembered, but it may not authorise paid work: the disk balance is old.
    expect(client.lastSnapshot()).toEqual({ ...good.snapshot, stale: true, canStartPaidWork: false });
  });

  it('formatMoney never invents a zero', () => {
    expect(formatMoney('23.99')).toBe('$23.99');
    expect(formatMoney('')).toBe('');
    expect(formatMoney('abc')).toBe('abc');
    expect(formatMoney('1.2')).toBe('1.2');
  });
});
