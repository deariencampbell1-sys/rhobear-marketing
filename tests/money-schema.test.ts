// W0-03a: proves the hand-written money schema validators fail closed and
// never leak provider-side money fields. Fixtures are raw wire input with
// unknown fields present on purpose; expected results are allowlisted objects.
import { describe, expect, it } from 'vitest';
import {
  isMoney,
  isRfc3339,
  isSha40,
  parseBank,
  parseCatalog,
  parseEntitlement,
  parseQuote,
} from '../src/clients/money/schema';

const SHA = 'a'.repeat(40);
const GENERATED_AT = '2026-10-24T12:00:00Z';

const validCatalog = {
  schema: 'rhobear.catalog.v1',
  catalogVersion: 'catalog-2026-10-24',
  sourceSha: SHA,
  currency: 'USD',
  region: 'US',
  plans: [
    {
      sku: 'shell',
      name: 'Shell',
      monthlyPrice: '23.99',
      creditIncluded: '14.40',
      runtime: 'cloud',
      availability: 'available',
      reason: 'available by invitation',
      providerCost: '111.11',
      markup: '222.22',
      stripeFee: '333.33',
    },
    {
      sku: 'free',
      name: 'Free',
      monthlyPrice: '0.00',
      creditIncluded: '0.00',
      availability: 'unavailable',
    },
  ],
  capabilities: [
    {
      product: 'builds',
      capability: 'sync',
      plans: ['shell'],
      state: 'included',
      providerCost: '111.11',
    },
  ],
  generatedAt: GENERATED_AT,
  providerCost: '111.11',
  markup: '222.22',
  stripeFee: '333.33',
};

const expectedCatalog = {
  schema: 'rhobear.catalog.v1',
  catalogVersion: 'catalog-2026-10-24',
  sourceSha: SHA,
  currency: 'USD',
  region: 'US',
  plans: [
    {
      sku: 'shell',
      name: 'Shell',
      monthlyPrice: '23.99',
      creditIncluded: '14.40',
      runtime: 'cloud',
      availability: 'available',
      reason: 'available by invitation',
    },
    {
      sku: 'free',
      name: 'Free',
      monthlyPrice: '0.00',
      creditIncluded: '0.00',
      availability: 'unavailable',
    },
  ],
  capabilities: [
    {
      product: 'builds',
      capability: 'sync',
      plans: ['shell'],
      state: 'included',
    },
  ],
  generatedAt: GENERATED_AT,
};

const validQuote = {
  operationId: 'op-123',
  accountUuid: 'acct-123',
  catalogVersion: 'catalog-2026-10-24',
  sourceSha: SHA,
  sku: 'shell',
  channel: 'web',
  price: '23.99',
  credit: '14.40',
  tax: '1.92',
  total: '25.91',
  currency: 'USD',
  renewal: 'monthly',
  paidThroughRule: 'through the end of the paid billing month',
  createdAt: GENERATED_AT,
  expiresAt: '2026-10-24T12:15:00Z',
  providerCost: '111.11',
  markup: '222.22',
  stripeFee: '333.33',
};

const expectedQuote = {
  operationId: 'op-123',
  accountUuid: 'acct-123',
  catalogVersion: 'catalog-2026-10-24',
  sourceSha: SHA,
  sku: 'shell',
  channel: 'web',
  price: '23.99',
  credit: '14.40',
  tax: '1.92',
  total: '25.91',
  currency: 'USD',
  renewal: 'monthly',
  paidThroughRule: 'through the end of the paid billing month',
  createdAt: GENERATED_AT,
  expiresAt: '2026-10-24T12:15:00Z',
};

const validEntitlement = {
  accountUuid: 'acct-123',
  product: 'builds',
  capability: 'sync',
  plan: 'shell',
  channel: 'apple',
  state: 'active',
  paidThrough: '2026-11-01T00:00:00Z',
  catalogVersion: 'catalog-2026-10-24',
  revision: 7,
  providerCost: '111.11',
  markup: '222.22',
  stripeFee: '333.33',
};

const expectedEntitlement = {
  accountUuid: 'acct-123',
  product: 'builds',
  capability: 'sync',
  plan: 'shell',
  channel: 'apple',
  state: 'active',
  paidThrough: '2026-11-01T00:00:00Z',
  catalogVersion: 'catalog-2026-10-24',
  revision: 7,
};

const validBank = {
  revision: 0,
  currency: 'USD',
  creditAvailable: '10.00',
  creditReserved: '1.00',
  allowanceRemaining: '5.00',
  purchasedRemaining: '4.00',
  resetsAt: '2026-11-01T00:00:00Z',
  state: 'available',
  providerCost: '111.11',
  markup: '222.22',
  stripeFee: '333.33',
};

const expectedBank = {
  revision: 0,
  currency: 'USD',
  creditAvailable: '10.00',
  creditReserved: '1.00',
  allowanceRemaining: '5.00',
  purchasedRemaining: '4.00',
  resetsAt: '2026-11-01T00:00:00Z',
  state: 'available',
};

const FORBIDDEN_FIELDS = ['providerCost', 'markup', 'stripeFee'];

function omit(source: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...source };
  delete copy[key];
  return copy;
}

describe('valid wire shapes parse to exactly the allowlisted object', () => {
  it('parses a catalog', () => {
    expect(parseCatalog(validCatalog)).toEqual(expectedCatalog);
  });

  it('parses a quote', () => {
    expect(parseQuote(validQuote)).toEqual(expectedQuote);
  });

  it('parses an entitlement', () => {
    expect(parseEntitlement(validEntitlement)).toEqual(expectedEntitlement);
  });

  it('parses a bank', () => {
    expect(parseBank(validBank)).toEqual(expectedBank);
  });
});

describe('unknown provider-side fields are dropped', () => {
  const parsedFixtures = [
    { label: 'catalog', parse: () => parseCatalog(validCatalog) },
    { label: 'quote', parse: () => parseQuote(validQuote) },
    { label: 'entitlement', parse: () => parseEntitlement(validEntitlement) },
    { label: 'bank', parse: () => parseBank(validBank) },
  ];

  it.each(parsedFixtures)('$label has no unknown field at any depth', ({ parse }) => {
    const result = parse();
    expect(result).not.toBeNull();
    if (result === null) throw new Error('fixture should parse');
    for (const key of FORBIDDEN_FIELDS) {
      expect(key in result, `${key} must not survive parsing`).toBe(false);
    }
    const serialised = JSON.stringify(result);
    for (const key of FORBIDDEN_FIELDS) {
      expect(serialised, `${key} must not survive parsing`).not.toContain(key);
    }
    expect(serialised).not.toContain('111.11');
    expect(serialised).not.toContain('222.22');
    expect(serialised).not.toContain('333.33');
  });
});

describe('every required key is required', () => {
  const catalogKeys = [
    'schema',
    'catalogVersion',
    'sourceSha',
    'currency',
    'region',
    'plans',
    'capabilities',
    'generatedAt',
  ];
  const quoteKeys = [
    'operationId',
    'accountUuid',
    'catalogVersion',
    'sourceSha',
    'sku',
    'channel',
    'price',
    'credit',
    'tax',
    'total',
    'currency',
    'renewal',
    'paidThroughRule',
    'createdAt',
    'expiresAt',
  ];
  const entitlementKeys = [
    'accountUuid',
    'product',
    'capability',
    'plan',
    'channel',
    'state',
    'paidThrough',
    'catalogVersion',
    'revision',
  ];
  const bankKeys = [
    'revision',
    'currency',
    'creditAvailable',
    'creditReserved',
    'allowanceRemaining',
    'purchasedRemaining',
    'resetsAt',
    'state',
  ];

  it.each(catalogKeys)('parseCatalog returns null without %s', (key) => {
    expect(parseCatalog(omit(validCatalog, key))).toBeNull();
  });

  it.each(quoteKeys)('parseQuote returns null without %s', (key) => {
    expect(parseQuote(omit(validQuote, key))).toBeNull();
  });

  it.each(entitlementKeys)('parseEntitlement returns null without %s', (key) => {
    expect(parseEntitlement(omit(validEntitlement, key))).toBeNull();
  });

  it.each(bankKeys)('parseBank returns null without %s', (key) => {
    expect(parseBank(omit(validBank, key))).toBeNull();
  });
});

describe('money is a decimal string, never a number', () => {
  const BAD_MONEY: (string | number | null)[] = [
    '23.9',
    '23.990',
    '23',
    '.99',
    '1,000.00',
    '-1.00',
    ' 23.99',
    '23.99 ',
    '',
    23.99,
    null,
  ];

  it.each(BAD_MONEY)('parseQuote rejects money variant %o', (bad) => {
    expect(parseQuote({ ...validQuote, price: bad })).toBeNull();
    expect(parseQuote({ ...validQuote, credit: bad })).toBeNull();
    expect(parseQuote({ ...validQuote, tax: bad })).toBeNull();
    expect(parseQuote({ ...validQuote, total: bad })).toBeNull();
  });

  it.each(BAD_MONEY)('parseCatalog rejects money variant %o', (bad) => {
    const firstPlan = validCatalog.plans[0];
    expect(
      parseCatalog({
        ...validCatalog,
        plans: [{ ...firstPlan, monthlyPrice: bad }],
      }),
    ).toBeNull();
    expect(
      parseCatalog({
        ...validCatalog,
        plans: [{ ...firstPlan, creditIncluded: bad }],
      }),
    ).toBeNull();
  });

  it.each(BAD_MONEY)('parseBank rejects money variant %o', (bad) => {
    expect(parseBank({ ...validBank, creditAvailable: bad })).toBeNull();
    expect(parseBank({ ...validBank, creditReserved: bad })).toBeNull();
    expect(parseBank({ ...validBank, allowanceRemaining: bad })).toBeNull();
    expect(parseBank({ ...validBank, purchasedRemaining: bad })).toBeNull();
  });

  it('refuses a quote without total instead of recomputing it', () => {
    expect(parseQuote(omit(validQuote, 'total'))).toBeNull();
  });
});

describe('hashes and timestamps', () => {
  const BAD_SHA: (string | number)[] = [
    '',
    SHA.slice(0, 39),
    `${SHA}a`,
    SHA.toUpperCase(),
    'g'.repeat(40),
    123,
  ];

  it.each(BAD_SHA)('parseQuote rejects sourceSha %o', (bad) => {
    expect(parseQuote({ ...validQuote, sourceSha: bad })).toBeNull();
  });

  it.each(BAD_SHA)('parseCatalog rejects sourceSha %o', (bad) => {
    expect(parseCatalog({ ...validCatalog, sourceSha: bad })).toBeNull();
  });

  const BAD_TIMESTAMP: (string | number)[] = [
    '',
    ' 2026-10-24T12:00:00Z',
    '2026-10-24T12:00:00',
    '2026-10-24',
    'not a time',
    '2026-13-01T00:00:00Z',
    0,
  ];

  it.each(BAD_TIMESTAMP)('parseQuote rejects expiresAt %o', (bad) => {
    expect(parseQuote({ ...validQuote, expiresAt: bad })).toBeNull();
  });

  it.each(BAD_TIMESTAMP)('parseCatalog rejects generatedAt %o', (bad) => {
    expect(parseCatalog({ ...validCatalog, generatedAt: bad })).toBeNull();
  });

  it('keeps createdAt a plain non-empty string, not RFC3339', () => {
    expect(parseQuote({ ...validQuote, createdAt: 'as recorded upstream' })).not.toBeNull();
  });
});

describe('revisions', () => {
  it.each([0, -1, 1.5, 2.0000001, Number.NaN, '3', null])(
    'parseEntitlement rejects revision %o',
    (bad) => {
      expect(parseEntitlement({ ...validEntitlement, revision: bad })).toBeNull();
    },
  );

  it('parseEntitlement rejects a missing revision', () => {
    expect(parseEntitlement(omit(validEntitlement, 'revision'))).toBeNull();
  });

  it('parseBank rejects revision -1', () => {
    expect(parseBank({ ...validBank, revision: -1 })).toBeNull();
  });

  it('parseBank rejects a non-integer revision', () => {
    expect(parseBank({ ...validBank, revision: 1.5 })).toBeNull();
  });

  it('parseBank accepts revision 0, which is a real bank revision', () => {
    expect(parseBank(validBank)).not.toBeNull();
  });
});

describe('string fields required by the review fix cannot be empty', () => {
  it('parseQuote rejects an empty paidThroughRule', () => {
    expect(parseQuote({ ...validQuote, paidThroughRule: '' })).toBeNull();
  });

  it('parseQuote rejects an empty createdAt', () => {
    expect(parseQuote({ ...validQuote, createdAt: '' })).toBeNull();
  });

  it('parseBank rejects an empty resetsAt', () => {
    expect(parseBank({ ...validBank, resetsAt: '' })).toBeNull();
  });

  it('parseEntitlement keeps paidThrough as string | null', () => {
    expect(parseEntitlement({ ...validEntitlement, paidThrough: null })).not.toBeNull();
    expect(parseEntitlement(validEntitlement)).not.toBeNull();
    expect(parseEntitlement({ ...validEntitlement, paidThrough: 123 })).toBeNull();
  });
});

describe('isMoney', () => {
  it.each([
    ['0.00', true],
    ['23.99', true],
    ['999999999.99', true],
    ['1000000000.00', false],
    ['23.9', false],
    ['23.990', false],
    ['23', false],
    ['.99', false],
    ['1,000.00', false],
    ['-1.00', false],
    [' 23.99', false],
    ['23.99 ', false],
    ['', false],
    [23.99, false],
    [0, false],
    [null, false],
    [undefined, false],
  ])('isMoney(%o) is %s', (value, expected) => {
    expect(isMoney(value)).toBe(expected);
  });
});

describe('isRfc3339', () => {
  it.each([
    ['2026-10-24T12:00:00Z', true],
    ['2026-10-24T12:00:00.123Z', true],
    ['2026-10-24T12:00:00+05:30', true],
    ['2026-10-24T12:00:00-08:00', true],
    ['2026-10-24T12:00:00', false],
    ['2026-10-24', false],
    ['2026-13-01T00:00:00Z', false],
    ['not a time', false],
    ['', false],
    [0, false],
    [null, false],
  ])('isRfc3339(%o) is %s', (value, expected) => {
    expect(isRfc3339(value)).toBe(expected);
  });
});

describe('isSha40', () => {
  it.each([
    [SHA, true],
    [SHA.slice(0, 39), false],
    [`${SHA}a`, false],
    [SHA.toUpperCase(), false],
    ['g'.repeat(40), false],
    ['', false],
    [123, false],
    [null, false],
  ])('isSha40(%o) is %s', (value, expected) => {
    expect(isSha40(value)).toBe(expected);
  });
});
