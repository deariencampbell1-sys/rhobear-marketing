// W0-02: composition only. This file joins the data modules into one
// loadContent() call and exports nothing else — no runtime logic, no defaults,
// no filtering. Truth lives in the modules; this file only composes it.

export { brand, brandSources } from './brand';
export { products, productsById, productOrder } from './products';
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

import { brand } from './brand';
import { products } from './products';
import { engines, engineScenarios } from './engines';
import { approvedPriceList, billingTerms, launchOffer } from './offers';
import { legalStatus, legalPages, checkoutState } from './legal';

/** The shape loadContent() returns: every top-level export of the data modules. */
export type Content = {
  brand: typeof brand;
  products: typeof products;
  engines: typeof engines;
  engineScenarios: typeof engineScenarios;
  approvedPriceList: typeof approvedPriceList;
  billingTerms: typeof billingTerms;
  launchOffer: typeof launchOffer;
  legalStatus: typeof legalStatus;
  legalPages: typeof legalPages;
  checkoutState: typeof checkoutState;
};

export function loadContent(): Content {
  return {
    brand,
    products,
    engines,
    engineScenarios,
    approvedPriceList,
    billingTerms,
    launchOffer,
    legalStatus,
    legalPages,
    checkoutState,
  };
}
