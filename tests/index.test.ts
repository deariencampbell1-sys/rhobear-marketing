import { describe, expect, it } from 'vitest';
import type { ProductId } from '../src/data/products';
import {
  approvedPriceList,
  brand,
  billingTerms,
  brandSources,
  checkoutState,
  engineScenarios,
  engines,
  enginesById,
  enginesDestination,
  heraldOffers,
  legalPages,
  legalStatus,
  launchOffer,
  loadContent,
  planCopy,
  productById,
  productOrder,
  products,
  productsById,
  retention,
  salePolicy,
} from '../src/data';
import * as data from '../src/data';

const sourceFiles = import.meta.glob(
  [
    '../**/*.{ts,tsx,js,jsx,mjs,cjs,astro,mdx}',
    '!../node_modules/**',
    '!../dist/**',
    '!../tests/**',
    '!../.git/**',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const nonDataSources = Object.entries(sourceFiles).filter(
  ([path]) => !path.startsWith('../src/data/'),
);

describe('data entry', () => {
  it('re-exports the source module references', () => {
    expect(data.brand).toBe(brand);
    expect(data.brandSources).toBe(brandSources);
    expect(data.products).toBe(products);
    expect(data.productsById).toBe(productsById);
    expect(data.productOrder).toBe(productOrder);
    expect(data.productById).toBe(productById);
    expect(data.engines).toBe(engines);
    expect(data.enginesById).toBe(enginesById);
    expect(data.engineScenarios).toBe(engineScenarios);
    expect(data.enginesDestination).toBe(enginesDestination);
    expect(data.approvedPriceList).toBe(approvedPriceList);
    expect(data.heraldOffers).toBe(heraldOffers);
    expect(data.planCopy).toBe(planCopy);
    expect(data.billingTerms).toBe(billingTerms);
    expect(data.launchOffer).toBe(launchOffer);
    expect(data.salePolicy).toBe(salePolicy);
    expect(data.legalStatus).toBe(legalStatus);
    expect(data.legalPages).toBe(legalPages);
    expect(data.checkoutState).toBe(checkoutState);
    expect(data.retention).toBe(retention);
  });

  it('has exactly the public barrel surface and no internal caveats', () => {
    expect(Object.keys(data).sort()).toEqual(
      [
        'approvedPriceList',
        'billingTerms',
        'brand',
        'brandSources',
        'checkoutState',
        'engineScenarios',
        'engines',
        'enginesById',
        'enginesDestination',
        'heraldOffers',
        'launchOffer',
        'legalPages',
        'legalStatus',
        'loadContent',
        'planCopy',
        'productById',
        'productOrder',
        'products',
        'productsById',
        'retention',
        'salePolicy',
      ].sort(),
    );
    expect((data as Record<string, unknown>).productInternals).toBeUndefined();
  });

  it('looks a product up by id through both paths', () => {
    expect(productById('builds')).toBe(productsById.builds);
    expect(() => productById('no-such-app' as ProductId)).toThrowError(
      'products: no entry for id "no-such-app"',
    );
  });

  it('loadContent returns the same object references without cloning', () => {
    const content = loadContent();
    expect(content.brand).toBe(brand);
    expect(content.brandSources).toBe(brandSources);
    expect(content.products).toBe(products);
    expect(content.productsById).toBe(productsById);
    expect(content.productOrder).toBe(productOrder);
    expect(content.engines).toBe(engines);
    expect(content.enginesById).toBe(enginesById);
    expect(content.engineScenarios).toBe(engineScenarios);
    expect(content.enginesDestination).toBe(enginesDestination);
    expect(content.approvedPriceList).toBe(approvedPriceList);
    expect(content.heraldOffers).toBe(heraldOffers);
    expect(content.planCopy).toBe(planCopy);
    expect(content.billingTerms).toBe(billingTerms);
    expect(content.launchOffer).toBe(launchOffer);
    expect(content.salePolicy).toBe(salePolicy);
    expect(content.legalStatus).toBe(legalStatus);
    expect(content.legalPages).toBe(legalPages);
    expect(content.checkoutState).toBe(checkoutState);
    expect(content.retention).toBe(retention);
  });

  it('loadContent exposes exactly the declared content keys', () => {
    expect(Object.keys(loadContent()).sort()).toEqual([
      'approvedPriceList',
      'billingTerms',
      'brand',
      'brandSources',
      'checkoutState',
      'engineScenarios',
      'engines',
      'enginesById',
      'enginesDestination',
      'heraldOffers',
      'launchOffer',
      'legalPages',
      'legalStatus',
      'planCopy',
      'productOrder',
      'products',
      'productsById',
      'retention',
      'salePolicy',
    ]);
  });
});

describe('entry-point boundary', () => {
  it('keeps loadContent out of every non-data source until Wave 1 wires it', () => {
    for (const [path, source] of nonDataSources) {
      expect(source, path).not.toMatch(/\bloadContent\b/);
    }
  });

  it('keeps the internal caveats out of every other source import', () => {
    for (const [path, source] of Object.entries(sourceFiles)) {
      if (path === '../src/data/products.internal.ts') continue;
      expect(source, path).not.toMatch(
        /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*products\.internal['"]/,
      );
    }
  });
});
