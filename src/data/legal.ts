// W0-02c: legal truth for the front door. The legal pages are being replaced
// and are under legal review before launch; nothing here is a signed
// agreement, and no contact detail is published that was not given to us.
// The retention wording is the owner's answer, not our invention.

export type LegalPage = {
  id: 'privacy' | 'terms' | 'support';
  route: '/privacy' | '/terms' | '/support';
  state: 'owner-review-pending';
  summary: string; // one truthful sentence on what the page covers
  source: { doc: string; section: string };
};

export const legalStatus = {
  state: 'replacement-under-legal-review',
  reason:
    'This site replaces the previous one and its legal pages are under legal review before launch. Nothing here is a signed agreement yet.',
  source: { doc: 'lanes/L9-front-door/CONTRACT.md', section: '2. Routes' },
} as const;

export const checkoutState = {
  state: 'closed',
  reason:
    'Checkout opens when the plans, receipts and refund terms are signed off. No payment is taken on this site today.',
  source: { doc: 'lanes/L9-front-door/CONTRACT.md', section: '3. Generated catalog, quote and entitlement' },
} as const;

export const retention = {
  afterPaidPeriod:
    'A 7-day read-only grace period: you can read and export your work, but you cannot start new jobs.',
  then: 'Your hosted data is deleted. Backups are removed within 30 days.',
  // Q10 covers retention and account deletion; Q13 is the separate old-estate
  // deletion approval, not the account-deletion promise.
  deletion:
    'Deleting your account stops billing first, then deletes your data; backups are gone within 30 days.',
  source: { doc: 'lanes/L9-front-door/OWNER-DECISIONS.md', section: 'Q10 Retention' },
} as const;

export const legalPages: readonly LegalPage[] = [
  {
    id: 'privacy',
    route: '/privacy',
    state: 'owner-review-pending',
    summary:
      'What this site and your account store about you, and for how long it is kept, as set out in the retention terms above.',
    source: { doc: 'lanes/L9-front-door/OWNER-DECISIONS.md', section: 'Q10 Retention' },
  },
  {
    id: 'terms',
    route: '/terms',
    state: 'owner-review-pending',
    summary:
      'The terms for your plan, the shared account usage bank it draws on, and how refunds work.',
    source: {
      doc: 'lanes/L9-front-door/CONTRACT.md',
      section: '3. Generated catalog, quote and entitlement',
    },
  },
  {
    id: 'support',
    route: '/support',
    state: 'owner-review-pending',
    summary:
      'How to reach a person and how fast to expect an answer; the contact route is published when the page is signed off.',
    source: { doc: 'lanes/L9-front-door/CONTRACT.md', section: '2. Routes' },
  },
];
