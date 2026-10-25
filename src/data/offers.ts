// W0-02b: the approved price list, the launch offer and plan copy. Money is
// always a decimal string, never a floating-point number. Prices live only in
// the price list and the Herald offers: no price appears as prose anywhere in
// this file, and no cost, margin or provider field exists here.

export type Money = string; // decimal string, e.g. '23.99' — never a number

/** The fixed ids of the approved price list. */
export type PriceRowId = 'free' | 'shell' | 'shell-plus' | 'space' | 'top-up';

export type PriceRow = {
  id: PriceRowId;
  /** Renderers must branch on this: a top-up adds credit, it is not a plan. */
  kind: 'plan' | 'add-on';
  label: string;
  monthly: Money;
  includedCredit: Money;
  notes: string;
  source: { doc: string; section: string };
};

const priceSource = {
  doc: 'lanes/L9-front-door/CONTRACT.md',
  section: '3. Generated catalog, quote and entitlement',
} as const;
Object.freeze(priceSource);

const approvedPriceListUnfrozen: PriceRow[] = [
  {
    id: 'free',
    kind: 'plan',
    label: 'Free',
    monthly: '0.00',
    includedCredit: '0.00',
    notes: 'local only; pocket models + harness + Verifier; no customer OpenRouter key',
    source: priceSource,
  },
  {
    id: 'shell',
    kind: 'plan',
    label: 'Shell',
    monthly: '23.99',
    includedCredit: '14.40',
    notes: 'Verifier + Apollo + Forge MCP; customer OpenRouter key allowed',
    source: priceSource,
  },
  {
    id: 'shell-plus',
    kind: 'plan',
    label: 'Shell Plus',
    monthly: '50.99',
    includedCredit: '39.60',
    notes: 'adds Zeus',
    source: priceSource,
  },
  {
    id: 'space',
    kind: 'plan',
    label: 'Space',
    monthly: '69.99',
    includedCredit: '39.60',
    notes: 'whole cax21, 8 GB RAM / 4 CPU; disk not shown until L2 confirms',
    source: priceSource,
  },
  {
    // The W0-02b brief mandates `monthly` on every row. For this add-on it is
    // a brief-level shape, not a subscription; renderers must branch on `kind`.
    id: 'top-up',
    kind: 'add-on',
    label: 'Top-up',
    monthly: '9.99',
    includedCredit: '9.00',
    notes: 'requires a plan; adds credit, is not a plan',
    source: priceSource,
  },
];

for (const row of approvedPriceListUnfrozen) {
  Object.freeze(row.source);
  Object.freeze(row);
}

export const approvedPriceList: readonly PriceRow[] = Object.freeze(
  approvedPriceListUnfrozen,
);

// Herald is separate from Builds; CONTRACT §3 (priceSource) is also where its
// Pro and texting offers, including the texting setup charge, are recorded.
export type HeraldOffer = {
  id: string;
  monthly: Money;
  /** One-time setup charge, if the offer has one. */
  setup: Money | null;
  source: { doc: string; section: string };
};

const heraldOffersUnfrozen: HeraldOffer[] = [
  { id: 'herald', monthly: '49.00', setup: null, source: priceSource },
  { id: 'herald-pro', monthly: '99.00', setup: null, source: priceSource },
  { id: 'herald-texting', monthly: '30.00', setup: '39.00', source: priceSource },
];

for (const offer of heraldOffersUnfrozen) {
  Object.freeze(offer.source);
  Object.freeze(offer);
}

export const heraldOffers: readonly HeraldOffer[] = Object.freeze(heraldOffersUnfrozen);

// Monthly is the only billing interval offered, in any form.
export const billingTerms = {
  interval: 'monthly',
  twelveMonthInterval: false,
  otherIntervalsOffered: false,
  source: priceSource,
} as const;
Object.freeze(billingTerms);

// Locked copy: the body sentence cannot drift. Terms are owner-locked to
// lanes/README.md; the seven engine names follow INTENT §3 and the seven-engine
// registry (the newest iteration). README's pre-public "Imagine" alias still
// needs an upstream owner correction in rhobear-north-star (not edited here).
export const launchOffer = {
  headline: 'The first 100 accounts get 90 days of no metered engine usage.',
  body:
    'Engine and MCP calls — Spaces, Forge renders, Designs, Captur\'d, Vision, Search and Teams — are not metered for the first 100 accounts for 90 days from the day each account starts. It is not a free plan: your subscription and your model tokens bill as usual, and the usual abuse and rate limits still apply.',
  state: 'announced', // not 'active': the counter is L2's entitlement flag, not built yet
  source: { doc: 'lanes/README.md', section: 'Locked facts every lane needs — Launch offer' },
  engineNameSource: {
    doc: 'lanes/L9-front-door/INTENT.md',
    section: '3. What each product really is — and what the front door may say',
  },
} as const;
Object.freeze(launchOffer.source);
Object.freeze(launchOffer.engineNameSource);
Object.freeze(launchOffer);

export const salePolicy = {
  subscribersSeeSale: false,
  reason: 'An existing subscriber is never shown another sale; they get Manage on the original channel.',
  source: priceSource,
} as const;
Object.freeze(salePolicy);

// One short truthful sentence per plan, taken only from the notes column of
// the approved price list: no adjectives, no invented capability. Typed
// against PriceRowId so a new plan cannot ship without copy (and a top-up
// cannot silently gain plan copy).
export const planCopy: Record<Exclude<PriceRowId, 'top-up'>, string> = {
  free: 'Local only: pocket models, the harness and Verifier, with no customer OpenRouter key.',
  shell: 'Includes Verifier, Apollo and the Forge MCP, with a customer OpenRouter key allowed.',
  'shell-plus': 'Adds Zeus to Shell.',
  space: 'A whole cax21 with 8 GB RAM and 4 CPU.',
} as const;
Object.freeze(planCopy);
