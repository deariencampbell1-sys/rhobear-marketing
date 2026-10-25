import { describe, expect, it } from 'vitest';
import {
  checkoutState,
  legalPages,
  legalStatus,
  retention,
} from '../src/data/legal';

const CONTRACT_IA = {
  doc: 'lanes/L9-front-door/CONTRACT.md',
  section: '2. Public information architecture and routes',
};

const CONTRACT_CATALOG = {
  doc: 'lanes/L9-front-door/CONTRACT.md',
  section: '3. Generated catalog, quote and entitlement',
};

const OWNER_LEGAL = {
  doc: 'lanes/L9-front-door/OWNER-DECISIONS.md',
  section: 'Q12 Legal',
};

const OWNER_RETENTION = {
  doc: 'lanes/L9-front-door/OWNER-DECISIONS.md',
  section: 'Q10 Retention',
};

describe('legal status', () => {
  it('pins the replacement-under-legal-review state, reason and source', () => {
    expect(legalStatus).toEqual({
      state: 'replacement-under-legal-review',
      reason:
        'This site replaces the previous one and its legal pages are under legal review before launch. Nothing here is a signed agreement yet.',
      source: OWNER_LEGAL,
    });
  });
});

describe('checkout state', () => {
  it('pins checkout closed, the exact reason and the contract source', () => {
    expect(checkoutState).toEqual({
      state: 'closed',
      reason:
        'Checkout opens when the plans, receipts and refund terms are signed off. No payment is taken on this site today.',
      source: CONTRACT_CATALOG,
    });
  });
});

describe('retention', () => {
  // The retention and deletion strings are the owner's Q10 answer
  // (OWNER-DECISIONS.md, Q10 Retention, 2026-10-25) — not our invention.
  // Q12 still requires legal review before paid launch; this is not an approval.
  it('pins the exact owner-approved retention strings and source', () => {
    expect(retention.afterPaidPeriod).toBe(
      'A 7-day read-only grace period: you can read and export your work, but you cannot start new jobs.',
    );
    expect(retention.then).toBe(
      'Your hosted data is deleted. Backups are removed within 30 days.',
    );
    expect(retention.deletion).toBe(
      'Deleting your account stops billing first, then deletes your data; backups are gone within 30 days.',
    );
    expect(retention.source).toEqual(OWNER_RETENTION);
  });
});

describe('legal pages', () => {
  it('has exactly three pages with the exact ids and routes', () => {
    expect(legalPages).toHaveLength(3);
    expect(legalPages.map((page) => page.id)).toEqual(['privacy', 'terms', 'support']);
    expect(legalPages.map((page) => page.route)).toEqual([
      '/privacy',
      '/terms',
      '/support',
    ]);
  });

  it('leaves every page in owner review', () => {
    for (const page of legalPages) {
      expect(page.state, page.id).toBe('owner-review-pending');
    }
  });

  it('pins every page summary verbatim', () => {
    expect(legalPages.map((page) => page.summary)).toEqual([
      'What this site and your account store about you, and for how long it is kept, as set out in the retention terms above.',
      'The terms for your plan, the shared account usage bank it draws on, and how refunds work.',
      'How to reach a person and how fast to expect an answer; the contact route is published when the page is signed off.',
    ]);
  });

  it('cites the exact source per page: privacy Q10, terms CONTRACT §3, support CONTRACT §2 IA', () => {
    expect(legalPages.map((page) => page.source)).toEqual([
      OWNER_RETENTION,
      CONTRACT_CATALOG,
      CONTRACT_IA,
    ]);
  });

  it('never cites the non-heading "2. Routes" string', () => {
    for (const source of [legalStatus.source, ...legalPages.map((page) => page.source)]) {
      expect(source.section, source.doc).not.toContain('2. Routes');
    }
  });

  it('keeps every page object exact, with no extra fields', () => {
    expect(legalPages).toEqual([
      {
        id: 'privacy',
        route: '/privacy',
        state: 'owner-review-pending',
        summary:
          'What this site and your account store about you, and for how long it is kept, as set out in the retention terms above.',
        source: OWNER_RETENTION,
      },
      {
        id: 'terms',
        route: '/terms',
        state: 'owner-review-pending',
        summary:
          'The terms for your plan, the shared account usage bank it draws on, and how refunds work.',
        source: CONTRACT_CATALOG,
      },
      {
        id: 'support',
        route: '/support',
        state: 'owner-review-pending',
        summary:
          'How to reach a person and how fast to expect an answer; the contact route is published when the page is signed off.',
        source: CONTRACT_IA,
      },
    ]);
  });

  it('does not invent a contact detail or promise a live agreement', () => {
    const text = JSON.stringify([legalStatus, checkoutState, retention, legalPages]);
    expect(text).not.toMatch(/https?:|@[a-z0-9.-]+\.[a-z]{2,}|\(\d{3}\)\s*\d{3}-\d{4}/i);
    expect(legalPages.every((page) => page.state === 'owner-review-pending')).toBe(true);
  });
});

describe('published legal copy', () => {
  it('contains no email, phone or URL detail', () => {
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        strings.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(collect);
      }
    };
    collect({ legalStatus, checkoutState, retention, legalPages });

    expect(strings.length).toBeGreaterThan(0);
    for (const text of strings) {
      expect(text).not.toContain('@');
      expect(text).not.toContain('http');
      expect(text).not.toContain('$');
    }
  });
});
