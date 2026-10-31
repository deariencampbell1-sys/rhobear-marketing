import type { CSSProperties } from 'react';
import { CheckoutClosedNotice } from '../app/CheckoutClosedNotice';
import { legalPages, legalStatus, retention, type LegalPage } from '../data/legal';

const pagePadding: CSSProperties = { paddingInline: '16px', paddingBlock: '24px' };
const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '100%' };

export function LegalSupportPage({ path }: { path: LegalPage['route'] }): JSX.Element | null {
  const page = legalPages.find((entry) => entry.route === path);
  if (page === undefined) return null;
  return (
    <section style={{ ...pagePadding, ...stack }}>
      <p>{page.summary}</p>
      <p>{legalStatus.reason}</p>
      {page.id === 'privacy' ? (
        <div style={stack}>
          <p>{retention.afterPaidPeriod}</p>
          <p>{retention.then}</p>
          <p>{retention.deletion}</p>
        </div>
      ) : null}
      {page.id === 'privacy' || page.id === 'terms' ? <CheckoutClosedNotice /> : null}
    </section>
  );
}
