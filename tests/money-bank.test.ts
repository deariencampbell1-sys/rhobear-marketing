import { describe, expect, it } from 'vitest';
import { createBankClient, formatMoney, type BankSnapshot } from '../src/clients/money/bank';
import type { MoneyTransportGet } from '../src/clients/money/transport';
import type { MoneyRequest, MoneyResult } from '../src/clients/money/transport';
import type { Bank, BankState } from '../src/clients/money/schema';

// No network: the fake runs the payload through the parser the client handed
// it, so a fixture below is judged by parseBank exactly as the wire would be.
const okTransport = (payload: unknown): MoneyTransportGet => ({
  async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
    const data = parse(payload);
    if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'req-1' };
    return { ok: true, data, requestId: 'req-1', fetchedAt: 42 };
  },
});

const failingTransport: MoneyTransportGet = {
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
    // The transport stamps fetchedAt 42, so the client's clock sits on it: a
    // fresh snapshot, and the wire state is the only input to canStartPaidWork.
    // `ok` means "safe to start paid work from", so an empty or reconciling
    // balance is a real balance that does not authorise anything: ok:false,
    // reason 'not-sellable', snapshot still readable.
    for (const [state, canStart] of wireStates) {
      const res = await createBankClient(okTransport(fixture({ state })), { now: () => 42 }).load();
      expect(res.ok).toBe(canStart);
      expect(res.snapshot.state).toBe(state);
      expect(res.snapshot.canStartPaidWork).toBe(canStart);
      if (!res.ok) expect(res.reason).toBe('not-sellable');
    }
  });

  it('keeps money as decimal strings', async () => {
    const res = await createBankClient(okTransport(fixture()), { now: () => 42 }).load();
    expect(res.ok).toBe(true);
    for (const field of MONEY_FIELDS) {
      const value: string = res.snapshot[field];
      expect(typeof value).toBe('string');
    }
  });

  it('marks lastSnapshot stale and does not resurrect a balance', async () => {
    // One client, two transports: the wire goes quiet after a good load.
    let transport: MoneyTransportGet = failingTransport;
    const gate: MoneyTransportGet = {
      async get<T>(req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
        return transport.get<T>(req, parse);
      },
    };
    // The transport stamps fetchedAt 42, so the clock sits on it for the good load.
    const client = createBankClient(gate, { now: () => 42 });
    expect(client.lastSnapshot()).toBeNull(); // before any load: nothing at all

    transport = okTransport(fixture());
    const good = await client.load();
    expect(good.ok).toBe(true); // available and fresh: it authorises
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

// A fetchedAt that is not a timestamp never
// becomes a live balance, and a placeholder snapshot carries no balance claim.
describe('money bank fetchedAt guard', () => {
  it('fails closed when the transport stamps a non-finite fetchedAt', async () => {
    const badStamp: MoneyTransportGet = {
      async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
        const data = parse(fixture());
        if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'req-1' };
        return { ok: true, data, requestId: 'req-1', fetchedAt: Number.NaN };
      },
    };
    const client = createBankClient(badStamp, { now: () => 1_000 });
    const res = await client.load();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('a NaN fetchedAt must not report a live balance');
    expect(res.reason).toBe('invalid-shape');
    expect(res.snapshot.stale).toBe(true);
    expect(res.snapshot.canStartPaidWork).toBe(false);
    expect(res.snapshot.creditAvailable).toBe('');
    expect(client.lastSnapshot()).toBeNull();
  });
});

// The remembered balance is immutable, its age is re-judged on every read, and
// a large credit still renders.
describe('money bank memory and age', () => {
  it('freezes the remembered snapshot and hands out a copy', async () => {
    const client = createBankClient(okTransport(fixture()), { now: () => 1_000 });
    const res = await client.load();
    if (!res.ok) throw new Error('the fixture bank loads');
    // The returned object is frozen: writing to it throws, and history is intact.
    expect(() => {
      (res.snapshot as { creditAvailable: string }).creditAvailable = '999.00';
    }).toThrow();
    expect(client.lastSnapshot()?.creditAvailable).toBe('12.00');
    expect(client.currentSnapshot()?.creditAvailable).toBe('12.00');
  });

  it('stops authorising paid work once the snapshot ages past its window', async () => {
    let clock = 1_000_000;
    // The transport stamps fetchedAt on the same clock the client judges with.
    const stamped: MoneyTransportGet = {
      async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
        const data = parse(fixture());
        if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'req-1' };
        return { ok: true, data, requestId: 'req-1', fetchedAt: clock };
      },
    };
    const client = createBankClient(stamped, { now: () => clock, freshnessMs: 60_000 });
    const res = await client.load();
    expect(res.ok).toBe(true);
    expect(client.currentSnapshot()?.canStartPaidWork).toBe(true);

    clock += 60_001;
    const aged = client.currentSnapshot();
    expect(aged?.stale).toBe(true);
    expect(aged?.canStartPaidWork).toBe(false);
    // The value is still there to show, marked stale.
    expect(aged?.creditAvailable).toBe('12.00');
  });

  it('answers currentSnapshot with null before any load', () => {
    expect(createBankClient(okTransport(fixture())).currentSnapshot()).toBeNull();
  });

  it('formatMoney renders a large credit and still refuses a bad shape', () => {
    expect(formatMoney('1234567.89')).toBe('$1234567.89');
    expect(formatMoney('123456789012.34')).toBe('$123456789012.34');
    expect(formatMoney('1.2')).toBe('1.2');
  });
});

// A held snapshot must age on its own, and a failed read must withdraw whatever
// the previous good read authorised.
describe('money bank live verdicts', () => {
  const stampedTransport = (clock: () => number): MoneyTransportGet => ({
    async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
      const data = parse(fixture());
      if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'req-1' };
      return { ok: true, data, requestId: 'req-1', fetchedAt: clock() };
    },
  });

  it('a snapshot a screen holds stops authorising paid work as it ages', async () => {
    let clock = 1_000_000;
    const client = createBankClient(stampedTransport(() => clock), { now: () => clock, freshnessMs: 60_000 });
    const res = await client.load();
    if (!res.ok) throw new Error('the fixture bank loads');
    const held = res.snapshot;
    expect(held.canStartPaidWork).toBe(true);

    clock += 60_001; // the screen did not reload, the object is the same one
    expect(held.canStartPaidWork).toBe(false);
    expect(held.stale).toBe(true);
    expect(held.creditAvailable).toBe('12.00'); // still readable, marked stale
  });

  it('a failed read withdraws authorisation from the balance loaded before it', async () => {
    let clock = 1_000_000;
    let failing = false;
    const transport: MoneyTransportGet = {
      async get<T>(_req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>> {
        if (failing) return { ok: false, reason: 'network', requestId: 'req-1' };
        const data = parse(fixture());
        if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'req-1' };
        return { ok: true, data, requestId: 'req-1', fetchedAt: clock };
      },
    };
    const client = createBankClient(transport, { now: () => clock });
    const good = await client.load();
    if (!good.ok) throw new Error('the fixture bank loads');
    const held = good.snapshot;
    expect(held.canStartPaidWork).toBe(true);

    failing = true;
    expect((await client.load()).ok).toBe(false);
    // The same held object now refuses paid work, and so does the accessor.
    expect(held.canStartPaidWork).toBe(false);
    expect(client.currentSnapshot()?.canStartPaidWork).toBe(false);
  });

  it('fails closed on a clock that is not a number', async () => {
    const client = createBankClient(okTransport(fixture()), { now: () => Number.NaN });
    const res = await client.load();
    // A non-finite clock cannot age anything, so nothing is authorised: the
    // snapshot is still returned, marked stale, under a not-sellable refusal.
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('a NaN clock must not authorise paid work');
    expect(res.reason).toBe('not-sellable');
    expect(res.snapshot.canStartPaidWork).toBe(false);
    expect(res.snapshot.stale).toBe(true);
  });
});

// The one bank field derived rather than copied: resetsAtMs, including the
// branch that hands a renderer null instead of NaN.
describe('money bank resetsAtMs', () => {
  it('parses the wire timestamp', async () => {
    const res = await createBankClient(okTransport(fixture()), { now: () => 42 }).load();
    expect(res.snapshot.resetsAtMs).toBe(Date.parse('2026-11-01T00:00:00Z'));
  });

  it('is null, never NaN, for an unparseable timestamp', async () => {
    const res = await createBankClient(okTransport(fixture({ resetsAt: 'not-a-date' })), { now: () => 42 }).load();
    expect(res.snapshot.resetsAtMs).toBeNull();
    expect(Number.isNaN(res.snapshot.resetsAtMs as unknown as number)).toBe(false);
  });
});
