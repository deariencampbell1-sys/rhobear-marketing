import { describe, expect, it } from 'vitest';
import { engines } from '../src/data/engines';
import {
  approvedPriceList,
  billingTerms,
  heraldOffers,
  launchOffer,
  planCopy,
  salePolicy,
} from '../src/data/offers';

const PRICE_SOURCE = {
  doc: 'lanes/L9-front-door/CONTRACT.md',
  section: '3. Generated catalog, quote and entitlement',
};

const MONEY = /^\d+\.\d{2}$/;

describe('approvedPriceList', () => {
  it('has exactly the five plans in order', () => {
    expect(approvedPriceList.map((row) => row.id)).toEqual([
      'free',
      'shell',
      'shell-plus',
      'space',
      'top-up',
    ]);
  });

  it('keeps the exact monthly and included credit strings', () => {
    expect(
      approvedPriceList.map(({ id, monthly, includedCredit }) => ({
        id,
        monthly,
        includedCredit,
      })),
    ).toEqual([
      { id: 'free', monthly: '0.00', includedCredit: '0.00' },
      { id: 'shell', monthly: '23.99', includedCredit: '14.40' },
      { id: 'shell-plus', monthly: '50.99', includedCredit: '39.60' },
      { id: 'space', monthly: '69.99', includedCredit: '39.60' },
      { id: 'top-up', monthly: '9.99', includedCredit: '9.00' },
    ]);
  });

  it('stores every Money value as a two-decimal string', () => {
    for (const row of approvedPriceList) {
      expect(row.monthly, row.id).toMatch(MONEY);
      expect(row.includedCredit, row.id).toMatch(MONEY);
    }
    for (const offer of heraldOffers) {
      expect(offer.monthly, offer.id).toMatch(MONEY);
      if (offer.setup !== null) {
        expect(offer.setup, offer.id).toMatch(MONEY);
      }
    }
  });

  it('cites the exact contract source on every row', () => {
    for (const row of approvedPriceList) {
      expect(row.source, row.id).toEqual(PRICE_SOURCE);
    }
  });

  it('models plans as plans and the top-up as an add-on', () => {
    for (const row of approvedPriceList) {
      expect(row.kind, row.id).toBe(row.id === 'top-up' ? 'add-on' : 'plan');
    }
  });
});

describe('heraldOffers', () => {
  it('keeps the three Herald offers and their setup charges', () => {
    expect(heraldOffers.map(({ id, monthly, setup }) => ({ id, monthly, setup }))).toEqual([
      { id: 'herald', monthly: '49.00', setup: null },
      { id: 'herald-pro', monthly: '99.00', setup: null },
      { id: 'herald-texting', monthly: '30.00', setup: '39.00' },
    ]);
  });

  it('cites the exact contract source on every offer', () => {
    for (const offer of heraldOffers) {
      expect(offer.source, offer.id).toEqual(PRICE_SOURCE);
    }
  });
});

describe('billing terms', () => {
  it('offers monthly as the only billing interval', () => {
    expect(billingTerms).toEqual({
      interval: 'monthly',
      twelveMonthInterval: false,
      otherIntervalsOffered: false,
      source: PRICE_SOURCE,
    });
  });
});

describe('sale policy', () => {
  it('never shows a sale to an existing subscriber', () => {
    expect(salePolicy).toEqual({
      subscribersSeeSale: false,
      reason:
        'An existing subscriber is never shown another sale; they get Manage on the original channel.',
      source: PRICE_SOURCE,
    });
  });
});

describe('plan copy', () => {
  it('keeps the four approved plan sentences', () => {
    expect(planCopy).toEqual({
      free: 'Local only: pocket models, the harness and Verifier, with no customer OpenRouter key.',
      shell: 'Includes Verifier, Apollo and the Forge MCP, with a customer OpenRouter key allowed.',
      'shell-plus': 'Adds Zeus to Shell.',
      space: 'A whole cax21 with 8 GB RAM and 4 CPU.',
    });
  });

  it('covers exactly the non-top-up price ids', () => {
    const planIds = approvedPriceList
      .map((row) => row.id)
      .filter((id) => id !== 'top-up');
    expect(Object.keys(planCopy).sort()).toEqual([...planIds].sort());
  });

  it('covers exactly the rows marked kind: plan', () => {
    const planRowIds = approvedPriceList
      .filter((row) => row.kind === 'plan')
      .map((row) => row.id)
      .sort();
    expect(Object.keys(planCopy).sort()).toEqual(planRowIds);
  });
});

describe('launch offer', () => {
  it('is announced, not active', () => {
    expect(launchOffer.state).toBe('announced');
  });

  it('pins the exact launch offer body', () => {
    expect(launchOffer.body).toBe(
      'Engine and MCP calls — Spaces, Forge renders, Designs, Captur\'d, Vision, Search and Teams — are not metered for the first 100 accounts for 90 days from the day each account starts. It is not a free plan: your subscription and your model tokens bill as usual, and the usual abuse and rate limits still apply.',
    );
  });

  it('cites the locked offer terms and the newest engine-name source', () => {
    expect(launchOffer.source).toEqual({
      doc: 'lanes/README.md',
      section: 'Locked facts every lane needs — Launch offer',
    });
    expect(launchOffer.engineNameSource).toEqual({
      doc: 'lanes/L9-front-door/INTENT.md',
      section: '3. What each product really is — and what the front door may say',
    });
  });

  it('names every public engine from the engines registry', () => {
    expect(engines.length).toBe(7);
    for (const engine of engines) {
      expect(launchOffer.body, engine.publicName).toContain(engine.publicName);
    }
  });
});
