import { describe, expect, it } from 'vitest';
import {
  checkoutState,
  legalPages,
  legalStatus,
  retention,
} from '../src/data/legal';

const CONTRACT = 'lanes/L9-front-door/CONTRACT.md';
const OWNER = 'lanes/L9-front-door/OWNER-DECISIONS.md';

describe('legal status', () => {
  it('keeps the replacement under legal review', () => {
    expect(legalStatus).toEqual({
      state: 'replacement-under-legal-review',
      reason:
        'This site replaces the previous one and its legal pages are under legal review before launch. Nothing here is a signed agreement yet.',
      source: { doc: CONTRACT, section: '2. Routes' },
    });
  });

  it('keeps checkout closed until the terms are signed off', () => {
    expect(checkoutState).toEqual({
      state: 'closed',
      reason:
        'Checkout opens when the plans, receipts and refund terms are signed off. No payment is taken on this site today.',
      source: { doc: CONTRACT, section: '3. Generated catalog, quote and entitlement' },
    });
  });
});

describe('retention', () => {
  it('keeps the owner-confirmed retention words exact', () => {
    expect(retention).toEqual({
      afterPaidPeriod:
        'A 7-day read-only grace period: you can read and export your work, but you cannot start new jobs.',
      then: 'Your hosted data is deleted. Backups are removed within 30 days.',
      deletion:
        'Deleting your account stops billing first, then deletes your data; backups are gone within 30 days.',
      source: { doc: OWNER, section: 'Q10 Retention' },
    });
  });
});

describe('legal pages', () => {
  it('has exactly privacy, terms and support in order', () => {
    expect(legalPages.map(({ id, route, state }) => ({ id, route, state }))).toEqual([
      { id: 'privacy', route: '/privacy', state: 'owner-review-pending' },
      { id: 'terms', route: '/terms', state: 'owner-review-pending' },
      { id: 'support', route: '/support', state: 'owner-review-pending' },
    ]);
  });

  it('keeps each summary and source exact', () => {
    expect(legalPages).toEqual([
      {
        id: 'privacy',
        route: '/privacy',
        state: 'owner-review-pending',
        summary:
          'What this site and your account store about you, and for how long it is kept, as set out in the retention terms above.',
        source: { doc: OWNER, section: 'Q10 Retention' },
      },
      {
        id: 'terms',
        route: '/terms',
        state: 'owner-review-pending',
        summary:
          'The terms for your plan, the shared account usage bank it draws on, and how refunds work.',
        source: { doc: CONTRACT, section: '3. Generated catalog, quote and entitlement' },
      },
      {
        id: 'support',
        route: '/support',
        state: 'owner-review-pending',
        summary:
          'How to reach a person and how fast to expect an answer; the contact route is published when the page is signed off.',
        source: { doc: CONTRACT, section: '2. Routes' },
      },
    ]);
  });

  it('does not invent a contact detail or promise a live agreement', () => {
    const text = JSON.stringify([legalStatus, checkoutState, retention, legalPages]);
    expect(text).not.toMatch(/https?:|@[a-z0-9.-]+\.[a-z]{2,}|\(\d{3}\)\s*\d{3}-\d{4}/i);
    expect(legalPages.every((page) => page.state === 'owner-review-pending')).toBe(true);
  });
});
