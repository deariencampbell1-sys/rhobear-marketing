import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../src/app/render';
import { CheckoutClosedNotice } from '../src/app/CheckoutClosedNotice';
import { checkoutState, legalPages, legalStatus, retention } from '../src/data/legal';
import { products } from '../src/data/products';
import { ServiceError, type ServiceErrorProps, type ServiceErrorStatus } from '../src/app/ServiceError';

const errorSourceModules = import.meta.glob('../src/app/ServiceError.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const errorSource = errorSourceModules['../src/app/ServiceError.tsx'] ?? '';
const appSourceModules = import.meta.glob('../src/app/App.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const appSource = appSourceModules['../src/app/App.tsx'] ?? '';

const namedEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decode the named and numeric entities a renderer emits, in one pass. */
function decodeEntities(text: string): string {
  return text.replace(/&(#(?:[xX][0-9a-fA-F]+|\d+)|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return namedEntities[body] ?? match;
  });
}

function mainRegion(html: string): string {
  return html.slice(html.indexOf('<main id="main">'), html.indexOf('</main>'));
}

function sharedFooter(html: string): string {
  const start = html.indexOf('<footer data-shared-footer="true">');
  if (start < 0) return '';
  const end = html.indexOf('</footer>', start);
  return end < 0 ? '' : html.slice(start, end + '</footer>'.length);
}

function errorMarkup(props: ServiceErrorProps): string {
  return renderToStaticMarkup(createElement(ServiceError, props));
}

const legalPaths = ['/privacy', '/terms', '/support'] as const;

describe('entity decoding helper', () => {
  // L4: the old helper decoded three entities only; pin the full named and
  // numeric set the renderer can emit.
  it('decodes named and numeric entities in one pass', () => {
    expect(decodeEntities('&lt;b&gt; &quot;q&quot; &#39; &#x27; &#X41; &amp;')).toBe(
      `<b> "q" ' ' A &`,
    );
  });

  it('asserts escaped script-like text as text, never as markup', () => {
    const text = '<script>alert(1)</script>';
    const html = renderToStaticMarkup(createElement('p', null, text));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(decodeEntities(html)).toBe(`<p>${text}</p>`);
  });
});

describe('legal and support pages', () => {
  it('renders each page from legal data with one h1 and no invented date', () => {
    for (const path of legalPaths) {
      const page = legalPages.find((entry) => entry.route === path);
      expect(page, path).toBeDefined();
      const html = decodeEntities(renderRoute(path));
      expect((html.match(/<h1[\s>]/g) ?? []).length, path).toBe(1);
      expect(html, path).toContain(page?.summary ?? '');
      expect(html, path).toContain(legalStatus.reason);
      expect(html, path).not.toMatch(/last updated/i);
      expect(mainRegion(html), path).not.toMatch(/<script|<img|<video|<iframe/i);
    }
  });

  it('renders the complete retention summary on privacy', () => {
    const html = decodeEntities(renderRoute('/privacy'));
    expect(html).toContain(retention.afterPaidPeriod);
    expect(html).toContain(retention.then);
    expect(html).toContain(retention.deletion);
  });

  it('support publishes only its pending contact state and existing routes', () => {
    const support = legalPages.find((page) => page.id === 'support');
    const html = decodeEntities(renderRoute('/support'));
    const body = html.slice(html.indexOf('<body>'));
    expect(html).toContain(support?.summary ?? '');
    expect(body).not.toContain('@');
    expect(body).not.toContain('tel:');
    expect(body).not.toMatch(/<form|<input/i);
    expect(body).not.toMatch(/href="https?:\/\//i);
    expect(body).not.toContain('href="/account"');
  });
});

describe('shared checkout notice', () => {
  it('renders one identical data-derived notice on plans privacy and terms', () => {
    for (const path of ['/plans', '/privacy', '/terms']) {
      const html = decodeEntities(renderRoute(path));
      expect(html.split(checkoutState.reason).length - 1, path).toBe(1);
    }
  });

  // H1: the non-'closed' branch is a real behaviour path, so both branches are
  // pinned by rendering the component directly instead of only through the
  // static module data the pages use.
  it('renders nothing at all when the state is not closed', () => {
    for (const state of ['open', '', 'CLOSED', 'signed-off']) {
      const html = renderToStaticMarkup(
        createElement(CheckoutClosedNotice, { state, reason: checkoutState.reason }),
      );
      expect(html, state).toBe('');
    }
  });

  it('renders exactly one paragraph carrying exactly the closed reason', () => {
    const reason = 'Checkout is closed while the terms are signed off.';
    const html = renderToStaticMarkup(
      createElement(CheckoutClosedNotice, { state: 'closed', reason }),
    );
    expect((html.match(/<p[\s>]/g) ?? []).length).toBe(1);
    expect(html).toBe(`<p>${reason}</p>`);
  });

  it('defaults to the module checkout data, so a data flip is caught', () => {
    const html = renderToStaticMarkup(createElement(CheckoutClosedNotice));
    expect(html).toBe(renderToStaticMarkup(createElement('p', null, checkoutState.reason)));
    expect(html).toContain(checkoutState.reason);
  });
});

describe('shared footer', () => {
  it('has exactly the approved destinations and no invented commercial lines', () => {
    const expected = [
      ...products.map((product) => `/${product.id}`),
      '/plans',
      '/get',
      '/support',
      '/privacy',
      '/terms',
    ];
    for (const path of ['/', '/builds', '/plans', '/privacy']) {
      const footer = sharedFooter(renderRoute(path));
      expect(footer, path).not.toBe('');
      const targets = [...footer.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      expect(targets, path).toEqual(expected);
      expect(footer, path).not.toMatch(/©|&copy;|trademark|company|social|newsletter|cookie/i);
      expect(footer, path).not.toMatch(/<input|<form/i);
    }
  });

  it('stays outside main and keeps its labels out of existing guarded regions', () => {
    for (const path of ['/', '/builds']) {
      const html = renderRoute(path);
      const footer = sharedFooter(html);
      const main = mainRegion(html);
      expect(footer, path).not.toBe('');
      expect(main, path).not.toContain('<footer');
      expect(main, path).not.toContain('data-shared-footer');
      const labels = [...footer.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]);
      expect(labels.length, path).toBeGreaterThan(0);
      for (const label of labels) expect(main, `${path}: ${label}`).not.toContain(label);
    }
  });

  // L2: the 404 path also composes the shared footer; pin the landmark and the
  // exact approved destination set (anti-invention: no unapproved destination).
  it('composes the 404 path with the same approved footer destinations', () => {
    const expected = [
      ...products.map((product) => `/${product.id}`),
      '/plans',
      '/get',
      '/support',
      '/privacy',
      '/terms',
    ];
    const html = renderRoute('/404');
    const footer = sharedFooter(html);
    expect(footer).not.toBe('');
    const targets = [...footer.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(targets).toEqual(expected);
    expect(targets).toEqual(
      [...sharedFooter(renderRoute('/')).matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    );
    expect(footer).not.toMatch(/©|&copy;|trademark|company|social|newsletter|cookie/i);
    expect(footer).not.toMatch(/<input|<form/i);
  });
});

describe('App source', () => {
  // L2: the published diff flagged a missing trailing newline at App.tsx EOF.
  it('ends App.tsx with a trailing newline', () => {
    expect(appSource.endsWith('\n')).toBe(true);
  });
});

describe('E04 service error shell', () => {
  const cases: readonly [ServiceErrorStatus, string][] = [
    [401, 'Sign in, then try the request again.'],
    [402, 'Check your bank or credit before trying again.'],
    [403, 'Check the capability and access before trying again.'],
    [409, 'Review the conflict before trying again.'],
    [429, 'Try again after 20 seconds.'],
    [503, 'Try again after service recovery.'],
  ];

  it.each(cases)('maps %s to its own safe next action', (status, nextAction) => {
    const html = errorMarkup({
      status,
      requestRef: `req-${status}`,
      ...(status === 429 ? { retryAfterSeconds: 20 } : {}),
    });
    expect(html).toContain(nextAction);
    expect(html).toContain(`Request reference: req-${status}`);
    expect(html).not.toContain('Last committed');
  });

  it('shows a supplied committed revision and time only when one exists', () => {
    const html = errorMarkup({
      status: 503,
      requestRef: 'req-committed',
      lastCommitted: { revision: 'a4f205e0', time: '2026-10-31T00:00:00Z' },
    });
    expect(html).toContain('Last committed revision: a4f205e0');
    expect(html).toContain('2026-10-31T00:00:00Z');
  });

  // M3: the pair renders only when both halves are usable — neither half may
  // leak on its own.
  it('renders no half pair when only one of revision and time is usable', () => {
    const unparseableTime = errorMarkup({
      status: 503,
      requestRef: 'req-bad-time',
      lastCommitted: { revision: 'abc', time: 'not-a-date' },
    });
    expect(unparseableTime).not.toContain('Last committed');
    expect(unparseableTime).not.toContain('abc');
    expect(unparseableTime).not.toContain('not-a-date');

    const unparseableRevision = errorMarkup({
      status: 503,
      requestRef: 'req-bad-revision',
      lastCommitted: { revision: 'a b', time: '2026-10-31T00:00:00Z' },
    });
    expect(unparseableRevision).not.toContain('Last committed');
    expect(unparseableRevision).not.toContain('a b');
    expect(unparseableRevision).not.toContain('2026-10-31T00:00:00Z');
  });

  // M3: a non-finite delay is not a delay — it falls back and never renders.
  it('treats non-finite retry-after values as no delay', () => {
    for (const retryAfterSeconds of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const html = errorMarkup({
        status: 429,
        requestRef: 'req-nonfinite',
        retryAfterSeconds,
      });
      expect(html, String(retryAfterSeconds)).toContain('Try again shortly.');
      expect(html, String(retryAfterSeconds)).not.toMatch(/after .* seconds/i);
      expect(html, String(retryAfterSeconds)).not.toContain(String(retryAfterSeconds));
    }
  });

  // M3: a negative delay falls back to the shell's own next step.
  it('falls back for a negative retry-after instead of rendering a negative clause', () => {
    const html = errorMarkup({ status: 429, requestRef: 'req-negative', retryAfterSeconds: -1 });
    expect(html).toContain('The service is busy.');
    expect(html).toContain('Try again shortly.');
    expect(html).not.toContain('-1 seconds');
    expect(html).not.toMatch(/Try again after -/);
  });

  // L1: the boundary is positive-only. 0 is not a delay, so it falls back
  // like a negative; a very large delay stays a readable whole number of
  // seconds and never drops into exponent notation.
  it('renders the seconds clause only for a positive retry-after', () => {
    const zero = errorMarkup({ status: 429, requestRef: 'req-zero', retryAfterSeconds: 0 });
    expect(zero).toContain('The service is busy.');
    expect(zero).toContain('Try again shortly.');
    expect(zero).not.toContain('0 seconds');

    const huge = errorMarkup({ status: 429, requestRef: 'req-huge', retryAfterSeconds: 1e21 });
    expect(huge).toContain(`Try again after ${'1' + '0'.repeat(21)} seconds.`);
    expect(huge).not.toContain('NaN');
    expect(huge).not.toMatch(/Try again after [\d.]+e[+-]?\d+/i);
  });

  it('never renders hostile provider text stack hosts or paths', () => {
    const props = {
      status: 503,
      requestRef: 'req http://10.0.0.1/private\nError: provider exploded',
      providerText: 'raw provider text',
      stack: 'Error: provider exploded\n at /private/server.ts',
      internalUrl: 'http://10.0.0.1/private',
    } as ServiceErrorProps;
    const html = errorMarkup(props);
    expect(html).toContain('Request reference: not available');
    expect(html).not.toContain('raw provider text');
    expect(html).not.toContain('provider exploded');
    expect(html).not.toContain('http://10.');
    expect(html).not.toContain('/private/server.ts');
  });

  it('invents neither a 429 delay nor a retry loop', () => {
    const html = errorMarkup({ status: 429, requestRef: 'req-busy' });
    expect(html).toContain('The service is busy.');
    expect(html).toContain('Try again shortly.');
    expect(html).not.toMatch(/after \d+ seconds?/i);
    expect(errorSource).not.toMatch(/fetch\s*\(|setInterval\s*\(|setTimeout\s*\(|while\s*\(/);
  });
});
