// W0-02: composition only. This file joins the data modules into one
// loadContent() call and adds no logic beyond re-exports and composition — no
// defaults, no filtering. Truth lives in the modules; this file only composes it.
//
// Migration note (W0-02d): loadContent() now returns composed data instead of
// null, replacing the W0-01 SiteContent contract with Content. No page imports
// it yet, so the placeholder fallback is not bypassed; Wave 1 wires the screens.
export { brand, brandSources } from './brand';
export { productById, products, productsById, productOrder } from './products';
export { engines, enginesById, engineScenarios, enginesDestination } from './engines';
export {
  approvedPriceList,
  heraldOffers,
  planCopy,
  billingTerms,
  launchOffer,
  salePolicy,
} from './offers';
export { legalStatus, legalPages, checkoutState, retention } from './legal';

import { brand, brandSources } from './brand';
import { products, productsById, productOrder } from './products';
import { engines, enginesById, engineScenarios, enginesDestination } from './engines';
import {
  approvedPriceList,
  heraldOffers,
  planCopy,
  billingTerms,
  launchOffer,
  salePolicy,
} from './offers';
import { legalStatus, legalPages, checkoutState, retention } from './legal';

/** Every public data export except the productById helper. */
export type Content = {
  brand: typeof brand;
  brandSources: typeof brandSources;
  products: typeof products;
  productsById: typeof productsById;
  productOrder: typeof productOrder;
  engines: typeof engines;
  enginesById: typeof enginesById;
  engineScenarios: typeof engineScenarios;
  enginesDestination: typeof enginesDestination;
  approvedPriceList: typeof approvedPriceList;
  heraldOffers: typeof heraldOffers;
  planCopy: typeof planCopy;
  billingTerms: typeof billingTerms;
  launchOffer: typeof launchOffer;
  salePolicy: typeof salePolicy;
  legalStatus: typeof legalStatus;
  legalPages: typeof legalPages;
  checkoutState: typeof checkoutState;
  retention: typeof retention;
};

export function loadContent(): Content {
  return {
    brand,
    brandSources,
    products,
    productsById,
    productOrder,
    engines,
    enginesById,
    engineScenarios,
    enginesDestination,
    approvedPriceList,
    heraldOffers,
    planCopy,
    billingTerms,
    launchOffer,
    salePolicy,
    legalStatus,
    legalPages,
    checkoutState,
    retention,
  };
}
