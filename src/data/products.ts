// W0-02a: the five RHOBEAR apps, in brand.appOrder order, with sourced claims
// only. Every user-visible string is a literal below; no URLs, prices, counts
// or testimonials are invented here. Internal-only caveats live in
// products.internal.ts and are never rendered on any screen.

import { brand } from './brand';

// Ids derive from brand, never a hand-written union. The alias stays exported
// because products.internal.ts keys its caveats by it.
export type ProductId = (typeof brand.appOrder)[number];

export interface ProductEntry {
  id: (typeof brand.appOrder)[number];
  publicName: string;
  oneLiner: string;
  promise: string;
  whatItIs: readonly string[];
  availability: {
    state: 'not-available' | 'testflight' | 'waitlist';
    label: string;
    reason: string;
  };
  links: { download?: string };
  source: { doc: string; section: string };
  extraSources?: { doc: string; section: string }[];
}

const productsUnfrozen: ProductEntry[] = [
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
    availability: {
      state: 'testflight',
      label: 'By invitation',
      reason: 'Mobile access is invitation-only today; the other platforms are not published.',
    },
    links: {},
    source: {
      doc: 'lanes/L9-front-door/INTENT.md',
      section: '3. What each product really is — and what the front door may say',
    },
    extraSources: [
      {
        doc: 'lanes/L9-front-door/INTENT.md',
        section: '4. Money, account, download and demo reality — Get / release truth',
      },
    ],
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
    availability: {
      state: 'waitlist',
      label: 'Early access by invitation',
      reason: 'First commercial kit is in physical-fit validation.',
    },
    links: {},
    source: {
      doc: 'lanes/L9-front-door/INTENT.md',
      section: '3. What each product really is — and what the front door may say',
    },
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
    // Herald is quoted in its own lane (see offers.heraldOffers), and checkout
    // is closed on this site (see legal.checkoutState).
    availability: {
      state: 'waitlist',
      label: 'Talk to us',
      reason: 'Herald is quoted and set up with you; checkout is not open on this site.',
    },
    links: {},
    source: {
      doc: 'lanes/L9-front-door/INTENT.md',
      section: '3. What each product really is — and what the front door may say',
    },
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
    availability: {
      state: 'waitlist',
      label: 'Early access by invitation',
      reason: 'Regent has no self-serve quote; terms come from its own lane.',
    },
    links: {},
    source: {
      doc: 'lanes/L9-front-door/INTENT.md',
      section: '3. What each product really is — and what the front door may say',
    },
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
    availability: {
      state: 'waitlist',
      label: 'Included with a plan',
      reason: 'Standalone Reviews pricing is not published; it comes with the plans that include it.',
    },
    links: {},
    source: {
      doc: 'lanes/L9-front-door/INTENT.md',
      section: '3. What each product really is — and what the front door may say',
    },
  },
];

// Deep-freeze each entry and its nested lists: `as const` is compile-time only,
// so this is what actually stops one module mutating another's product data.
for (const product of productsUnfrozen) {
  Object.freeze(product.whatItIs);
  Object.freeze(product.availability);
  if (product.extraSources) {
    Object.freeze(product.extraSources);
  }
  Object.freeze(product);
}

export const products: readonly ProductEntry[] = Object.freeze(productsUnfrozen);

// The ids in display order: a frozen copy of brand.appOrder, not a live alias.
export const productOrder: readonly ProductId[] = Object.freeze([...brand.appOrder]);

export function productById(id: ProductId): ProductEntry {
  const found = products.find((product) => product.id === id);
  if (!found) {
    throw new Error(`products: no entry for id "${id}"`);
  }
  return found;
}

// Built from the products array — no hand-written key list to drift. Null
// prototype like enginesById: an unknown id must never resolve through
// Object.prototype (`productsById['constructor']` must be undefined).
const productsByIdUnfrozen = Object.create(null) as Record<ProductId, ProductEntry>;
for (const product of products) {
  productsByIdUnfrozen[product.id] = product;
}

export const productsById: Readonly<Record<ProductId, ProductEntry>> =
  Object.freeze(productsByIdUnfrozen);

// Module-scope guard: the display order in brand.appOrder must be fully covered
// by the product table, so adding an app in one place fails loudly here.
const missing = brand.appOrder.filter((id) => !productsById[id]);
if (missing.length) throw new Error(`products and productOrder disagree: missing ${missing.join(', ')}`);
