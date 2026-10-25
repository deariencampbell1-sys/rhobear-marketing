// W0-02a: the five RHOBEAR apps, in brand.appOrder order, with sourced claims
// only. Every user-visible string is a literal below; no URLs, prices, counts
// or testimonials are invented here.

import { brand } from './brand';

// local until W0-02c composes the model
export interface ProductEntry {
  id: 'builds' | 'forge' | 'herald' | 'regent' | 'reviews';
  publicName: string;
  oneLiner: string;
  promise: string;
  whatItIs: string[];
  truthBoundary: string;
  availability: {
    state: 'not-available' | 'testflight' | 'waitlist';
    label: string;
    reason: string;
  };
  links: { download?: string };
  source: { doc: string; section: string };
  extraSources?: { doc: string; section: string }[];
}

export const products: readonly ProductEntry[] = [
  {
    id: 'builds',
    publicName: 'Builds',
    oneLiner: 'Your work, your devices, one Rho.',
    promise:
      'Builds is the native and web GUI for rho, our own harness — your local device plus a private shell or server, with your work, memory, models and one account usage bank.',
    whatItIs: [
      'A native and web GUI for rho, our own harness.',
      'Your local device plus a private shell or server.',
      'Your work, memory, models and one account usage bank.',
    ],
    truthBoundary:
      'Cloud and native substance are real, the locked UX is being rebuilt, and TestFlight 1.0 (build 32) is owner-confirmed as the only accepted mobile release; other release targets are not proved available.',
    availability: {
      state: 'testflight',
      label: 'TestFlight 1.0 (32) by invitation',
      reason: 'App Store and other platform releases are not published yet.',
    },
    links: {},
    source: { doc: 'lanes/L9-front-door/INTENT.md', section: '3. Products' },
    extraSources: [{ doc: 'lanes/L9-front-door/OWNER-DECISIONS.md', section: 'Q13' }],
  },
  {
    id: 'forge',
    publicName: 'Forge',
    oneLiner: 'Say it. Hold it.',
    promise:
      'Forge takes a photo, a sentence or a model to an approved concept, then a checked printable model, with precise edits, paint and split, a matching slice, printer handoff and physical completion.',
    whatItIs: [
      'A photo, a sentence or a model becomes an approved concept.',
      'A checked printable model with precise edits, paint and split, and a matching slice.',
      'Printer handoff through to physical completion.',
    ],
    truthBoundary:
      'The engine, desktop and scripts are substantial, but direct printing, camera control, farm and six-platform release are not all production-proven, and Dojo Hinge V3, the first commercial kit, awaits physical-fit acceptance.',
    availability: {
      state: 'waitlist',
      label: 'Early access by invitation',
      reason: 'First commercial kit is in physical-fit validation.',
    },
    links: {},
    source: { doc: 'lanes/L9-front-door/INTENT.md', section: '3. Products' },
  },
  {
    id: 'herald',
    publicName: 'Herald',
    oneLiner: 'Your card. Your assistant. Your business, answered.',
    promise:
      'Herald is your business phone and assistant: your card, your assistant, your business, answered.',
    whatItIs: [
      'A business phone and an assistant for your business.',
      'Your card, your assistant, your business, answered.',
    ],
    truthBoundary:
      'Availability and entitlements come from its own lane; there is no self-serve checkout on this site.',
    availability: {
      state: 'waitlist',
      label: 'Talk to us',
      reason: 'Herald is quoted and set up with you, not bought from a price card here.',
    },
    links: {},
    source: { doc: 'lanes/L9-front-door/INTENT.md', section: '3. Products' },
  },
  {
    id: 'regent',
    publicName: 'Regent',
    oneLiner: 'The desk beside the call.',
    promise: 'Regent is the desk beside the call.',
    whatItIs: [
      'The desk beside the call.',
      'Early access is by invitation, with terms set in its own lane.',
    ],
    truthBoundary:
      'There is no self-serve quote, no agency data is published, and no live call handling is claimed in public.',
    availability: {
      state: 'waitlist',
      label: 'Early access by invitation',
      reason: 'Regent has no self-serve quote; terms come from its own lane.',
    },
    links: {},
    source: { doc: 'lanes/L9-front-door/INTENT.md', section: '3. Products' },
  },
  {
    id: 'reviews',
    publicName: 'Reviews',
    oneLiner: 'Check the code. Review the change. Fix and merge with proof.',
    promise:
      'Reviews checks the code, reviews the change, and fixes and merges with proof, at the levels Verifier, Apollo and Zeus.',
    whatItIs: [
      'Checks the code, reviews the change, and fixes and merges with proof.',
      'Levels: Verifier, Apollo and Zeus.',
    ],
    truthBoundary:
      'Apollo and Zeus work today as reviewer and builder agents; standalone paid Reviews plans are not published.',
    availability: {
      state: 'waitlist',
      label: 'Included with a plan',
      reason: 'Standalone Reviews pricing is not published; it comes with the plans that include it.',
    },
    links: {},
    source: { doc: 'lanes/L9-front-door/INTENT.md', section: '3. Products' },
  },
];

// The ids in display order, straight from brand.appOrder.
export const productOrder: readonly ProductEntry['id'][] = brand.appOrder;

function productById(id: ProductEntry['id']): ProductEntry {
  const found = products.find((product) => product.id === id);
  if (!found) {
    throw new Error('products: products and productOrder disagree');
  }
  return found;
}

export const productsById: Readonly<Record<ProductEntry['id'], ProductEntry>> = {
  builds: productById('builds'),
  forge: productById('forge'),
  herald: productById('herald'),
  regent: productById('regent'),
  reviews: productById('reviews'),
};
