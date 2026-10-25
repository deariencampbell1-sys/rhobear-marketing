import { describe, expect, it } from 'vitest';
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
  productOrder,
  products,
  productsById,
  retention,
  salePolicy,
} from '../src/data';
import * as data from '../src/data';

describe('data entry', () => {
  it('re-exports the source module references', () => {
    expect(data.brand).toBe(brand);
    expect(data.brandSources).toBe(brandSources);
    expect(data.products).toBe(products);
    expect(data.productsById).toBe(productsById);
    expect(data.productOrder).toBe(productOrder);
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

  it('loadContent returns the same object references without cloning', () => {
    const content = loadContent();
    expect(content.brand).toBe(brand);
    expect(content.products).toBe(products);
    expect(content.engines).toBe(engines);
    expect(content.engineScenarios).toBe(engineScenarios);
    expect(content.approvedPriceList).toBe(approvedPriceList);
    expect(content.billingTerms).toBe(billingTerms);
    expect(content.launchOffer).toBe(launchOffer);
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
      'checkoutState',
      'engineScenarios',
      'engines',
      'launchOffer',
      'legalPages',
      'legalStatus',
      'products',
      'retention',
    ]);
  });
});
