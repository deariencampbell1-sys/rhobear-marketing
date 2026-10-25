// W0-02b: the approved price list, the launch offer and plan copy. Money is
// always a decimal string, never a floating-point number. Prices live only in
// the price list and the Herald offers: no price appears as prose anywhere in
// this file, and no cost, margin or provider field exists here.

export type Money = string; // decimal string, e.g. '23.99' — never a number

export type PriceRow = {
  id: string;
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

export const approvedPriceList: readonly PriceRow[] = [
  {
    id: 'free',
    label: 'Free',
    monthly: '0.00',
    includedCredit: '0.00',
    notes: 'local only; pocket models + harness + Verifier; no customer OpenRouter key',
    source: priceSource,
  },
  {
    id: 'shell',
    label: 'Shell',
    monthly: '23.99',
    includedCredit: '14.40',
    notes: 'Verifier + Apollo + Forge MCP; customer OpenRouter key allowed',
    source: priceSource,
  },
  {
    id: 'shell-plus',
    label: 'Shell Plus',
    monthly: '50.99',
    includedCredit: '39.60',
    notes: 'adds Zeus',
    source: priceSource,
  },
  {
    id: 'space',
    label: 'Space',
    monthly: '69.99',
    includedCredit: '39.60',
    notes: 'whole cax21, 8 GB RAM / 4 CPU; disk not shown until L2 confirms',
    source: priceSource,
  },
  {
    id: 'top-up',
    label: 'Top-up',
    monthly: '9.99',
    includedCredit: '9.00',
    notes: 'requires a plan; adds credit, is not a plan',
    source: priceSource,
  },
];

// Herald is separate from Builds and priced in its own lane.
export type HeraldOffer = {
  id: string;
  monthly: Money;
  /** One-time setup charge, if the offer has one. */
  setup: Money | null;
  source: { doc: string; section: string };
};

export const heraldOffers: readonly HeraldOffer[] = [
  { id: 'herald', monthly: '49.00', setup: null, source: priceSource },
  { id: 'herald-pro', monthly: '99.00', setup: null, source: priceSource },
  { id: 'herald-texting', monthly: '30.00', setup: '39.00', source: priceSource },
];

// Monthly is the only billing interval offered, in any form.
export const billingTerms = {
  interval: 'monthly',
  twelveMonthInterval: false,
  otherIntervalsOffered: false,
  source: priceSource,
} as const;

// Locked copy: this text cannot drift.
export const launchOffer = {
  headline: 'The first 100 accounts get 90 days of no metered engine usage.',
  body:
    'Engine and MCP calls — Imagine, Forge renders, Designs, Captur’d, Vision, Search and Teams — are not metered for the first 100 accounts for 90 days from the day each account starts. It is not a free plan: your subscription and your model tokens bill as usual, and the usual abuse and rate limits still apply.',
  state: 'announced', // not 'active': the counter is L2's entitlement flag, not built yet
  source: { doc: 'lanes/README.md', section: 'Locked facts every lane needs — Launch offer' },
} as const;

export const salePolicy = {
  subscribersSeeSale: false,
  reason: 'An existing subscriber is never shown another sale; they get Manage on the original channel.',
  source: priceSource,
} as const;

// One short truthful sentence per plan, taken only from the notes column of
// the approved price list: no adjectives, no invented capability.
export const planCopy = {
  free: 'Local only: pocket models, the harness and Verifier, with no customer OpenRouter key.',
  shell: 'Includes Verifier, Apollo and the Forge MCP, with a customer OpenRouter key allowed.',
  'shell-plus': 'Adds Zeus to Shell.',
  space: 'A whole cax21 with 8 GB RAM and 4 CPU.',
} as const;
