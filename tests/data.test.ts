// W0-02d: proves the composed content model. Every assertion here is a real
// constraint on the data — a data change fails until this test is updated in
// the same commit. Imports go through src/data/index, the single composition.
import { describe, expect, it } from 'vitest';
import {
  approvedPriceList,
  billingTerms,
  brand,
  brandSources,
  checkoutState,
  engineScenarios,
  engines,
  enginesDestination,
  heraldOffers,
  productsById,
  launchOffer,
  legalPages,
  legalStatus,
  planCopy,
  products,
  productOrder,
  retention,
} from '../src/data/index';
import { productInternals } from '../src/data/products.internal';

const ALLOWED_DOCS = [
  'lanes/L9-front-door/INTENT.md',
  'lanes/L9-front-door/CONTRACT.md',
  'lanes/L9-front-door/OWNER-DECISIONS.md',
  'lanes/README.md',
] as const;

const DECIMAL_STRING = /^\d+\.\d{2}$/;

function expectSourced(source: { doc: string; section: string }, label: string): void {
  expect(ALLOWED_DOCS, `${label}: doc must be on the allowlist`).toContain(source.doc);
  expect(source.section.trim().length, `${label}: section must be non-empty`).toBeGreaterThan(0);
}

function expectDecimalString(value: unknown, label: string): void {
  expect(typeof value, `${label}: must be a string, never a float`).toBe('string');
  expect(value, `${label}: must match /^\\d+\\.\\d{2}$/`).toMatch(DECIMAL_STRING);
}

describe('five apps, one destination', () => {
  it('has exactly five products in brand.appOrder order', () => {
    expect(products.length).toBe(5);
    expect(products.map((product) => product.id)).toEqual([...brand.appOrder]);
  });

  it('points the engines destination at /engines with public name Engines', () => {
    expect(brand.enginesDestination).toBe('/engines');
    expect(enginesDestination.publicName).toBe('Engines');
  });

  it('freezes the brand object and its appOrder array at runtime', () => {
    expect(Object.isFrozen(brand)).toBe(true);
    expect(Object.isFrozen(brand.appOrder)).toBe(true);
  });
});

describe('one-liners are verbatim', () => {
  // Literal transcription of the five one-liners. A changed word in
  // src/data/products.ts fails this until the test is updated in the same commit.
  const expectedOneLiners: Record<string, string> = {
    builds: 'Your work, your devices, one Rho.',
    forge: 'Say it. Hold it.',
    herald: 'Your card. Your assistant. Your business, answered.',
    regent: 'The desk beside the call.',
    reviews: 'Check the code. Review the change. Fix and merge with proof.',
  };

  it('matches the recorded one-liner for every product id', () => {
    expect(Object.keys(expectedOneLiners).sort()).toEqual([...brand.appOrder].sort());
    for (const product of products) {
      expect(product.oneLiner, product.id).toBe(expectedOneLiners[product.id]);
    }
  });
});

describe('every claim is sourced', () => {
  it('cites an allowlisted doc and a non-empty section on every claim', () => {
    expect(products.length).toBeGreaterThan(0);
    for (const product of products) {
      expectSourced(product.source, `product ${product.id}`);
      for (const extra of product.extraSources ?? []) {
        expectSourced(extra, `product ${product.id} extraSources`);
      }
    }
    expect(engines.length).toBeGreaterThan(0);
    for (const engine of engines) {
      expectSourced(engine.source, `engine ${engine.id}`);
    }
    expect(engineScenarios.length).toBeGreaterThan(0);
    for (const scenario of engineScenarios) {
      expectSourced(scenario.source, `scenario ${scenario.scenarioId}`);
    }
    expect(legalPages.length).toBeGreaterThan(0);
    for (const page of legalPages) {
      expectSourced(page.source, `legal page ${page.id}`);
    }
    for (const [key, source] of Object.entries(brandSources)) {
      expectSourced(source, `brand ${key}`);
    }
    expect(approvedPriceList.length).toBeGreaterThan(0);
    for (const row of approvedPriceList) {
      expectSourced(row.source, `price row ${row.id}`);
    }
  });
});

describe('prices are decimal strings, not floats', () => {
  it('formats every money field as /^\d+\.\d{2}$/', () => {
    for (const row of approvedPriceList) {
      expectDecimalString(row.monthly, `${row.id}.monthly`);
      expectDecimalString(row.includedCredit, `${row.id}.includedCredit`);
    }
    // heraldOffers carries `monthly` plus a one-time `setup`; it has no
    // includedCredit field. Both money fields are checked.
    expect(heraldOffers.length).toBeGreaterThan(0);
    for (const offer of heraldOffers) {
      expectDecimalString(offer.monthly, `${offer.id}.monthly`);
      if (offer.setup !== null) {
        expectDecimalString(offer.setup, `${offer.id}.setup`);
      }
    }
  });
});

describe('the price list equals the contract', () => {
  // Hardcoded contract table: a data change fails until this test is updated
  // in the same commit. Compared value for value and order for order.
  const expectedPriceList = [
    { id: 'free', monthly: '0.00', includedCredit: '0.00' },
    { id: 'shell', monthly: '23.99', includedCredit: '14.40' },
    { id: 'shell-plus', monthly: '50.99', includedCredit: '39.60' },
    { id: 'space', monthly: '69.99', includedCredit: '39.60' },
    { id: 'top-up', monthly: '9.99', includedCredit: '9.00' },
  ];

  it('matches the contract exactly', () => {
    expect(
      approvedPriceList.map((row) => ({
        id: row.id,
        monthly: row.monthly,
        includedCredit: row.includedCredit,
      })),
    ).toEqual(expectedPriceList);
  });
});

describe('monthly only', () => {
  it('offers no interval other than monthly', () => {
    expect(billingTerms.interval).toBe('monthly');
    expect(billingTerms.otherIntervalsOffered).toBe(false);
    expect(billingTerms.twelveMonthInterval).toBe(false);
  });
});

describe('nothing is available yet', () => {
  it('keeps every product short of available with a stated reason', () => {
    for (const product of products) {
      expect(product.availability.state, product.id).not.toBe('available');
      expect(
        product.availability.reason.trim().length,
        `${product.id}.availability.reason`,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps every engine scenario footage-pending, at least seven of them', () => {
    expect(engineScenarios.length).toBeGreaterThanOrEqual(7);
    for (const scenario of engineScenarios) {
      expect(scenario.publicationState, scenario.scenarioId).toBe('footage-pending');
    }
  });
});

describe('legal truth', () => {
  it('states replacement-under-legal-review, a closed checkout and three retention phases', () => {
    expect(legalStatus.state).toBe('replacement-under-legal-review');
    expect(checkoutState.state).toBe('closed');
    expect(retention.afterPaidPeriod.trim().length).toBeGreaterThan(0);
    expect(retention.then.trim().length).toBeGreaterThan(0);
    expect(retention.deletion.trim().length).toBeGreaterThan(0);
  });
});

describe('the launch offer is not a free plan', () => {
  it('says so in its body and is announced, not active', () => {
    expect(launchOffer.body.toLowerCase()).toContain('not a free plan');
    expect(launchOffer.state).toBe('announced');
  });
});

describe('productsById', () => {
  // Inherited from the W0-02d review fix: productsById was rebuilt on a null
  // prototype so an unknown id can never resolve through Object.prototype.
  it('has a null prototype so unknown ids cannot resolve', () => {
    expect(Object.getPrototypeOf(productsById)).toBeNull();
    const byName = productsById as unknown as Record<string, unknown>;
    expect(byName.constructor).toBeUndefined();
    expect(byName.toString).toBeUndefined();
  });

  it('has every productOrder id and exactly those keys', () => {
    for (const id of productOrder) {
      expect(Object.prototype.hasOwnProperty.call(productsById, id), id).toBe(true);
    }
    expect(Object.keys(productsById)).toEqual([...productOrder]);
  });

  it('maps each id to the same object as the products entry', () => {
    for (const product of products) {
      expect(productsById[product.id]).toBe(product);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(productsById)).toBe(true);
  });
});

describe('public data is frozen at runtime', () => {
  it('freezes the products array, every entry and the nested lists', () => {
    expect(Object.isFrozen(products)).toBe(true);
    for (const product of products) {
      expect(Object.isFrozen(product), product.id).toBe(true);
      expect(Object.isFrozen(product.whatItIs), product.id).toBe(true);
      expect(Object.isFrozen(product.availability), product.id).toBe(true);
      if (product.extraSources) {
        expect(Object.isFrozen(product.extraSources), product.id).toBe(true);
      }
    }
  });

  it('freezes the internals object and each internal value', () => {
    expect(Object.isFrozen(productInternals)).toBe(true);
    for (const internals of Object.values(productInternals)) {
      expect(Object.isFrozen(internals)).toBe(true);
    }
  });
});

describe('Herald availability', () => {
  it('routes to a quote while checkout is closed', () => {
    expect(checkoutState.state).toBe('closed');
    expect(productsById.herald.availability).toEqual({
      state: 'waitlist',
      label: 'Talk to us',
      reason: 'Herald is quoted and set up with you; checkout is not open on this site.',
    });
  });
});

describe('public product keys', () => {
  it('gives every public product exactly the public keys', () => {
    const publicKeys = [
      'availability',
      'id',
      'links',
      'oneLiner',
      'promise',
      'publicName',
      'source',
      'whatItIs',
    ];
    for (const product of products) {
      const expected = [
        ...publicKeys,
        ...(product.extraSources ? ['extraSources'] : []),
      ].sort();
      expect(Object.keys(product).sort(), product.id).toEqual(expected);
    }
  });
});

describe('public product data safety', () => {
  it('publishes no links, URLs or dollar prices', () => {
    for (const product of products) {
      expect(product.links, product.id).toEqual({});
    }
    const json = JSON.stringify(products);
    expect(json).not.toMatch(/https?:/);
    expect(json).not.toMatch(/\$\d/);
  });
});

describe('no build number or codename leaks into public fields', () => {
  it('serialises the public tree without any forbidden token', () => {
    // Exact-case tokens: the public availability state union legitimately uses
    // lowercase 'testflight' (assertion 7 expects such states); the brief marks
    // assertion 9 case-insensitive and this one not. products.internal.ts is
    // deliberately excluded — it is internal.
    const publicJson = JSON.stringify({ products, engines, planCopy, launchOffer });
    for (const token of ['Dojo', 'TestFlight', '32', 'internal']) {
      expect(publicJson, `public data must not contain "${token}"`).not.toContain(token);
    }
  });
});
