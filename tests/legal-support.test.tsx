import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../src/app/render';
import { checkoutState, legalPages, legalStatus, retention } from '../src/data/legal';
import { products } from '../src/data/products';
import type { ServiceErrorProps, ServiceErrorStatus } from '../src/app/ServiceError';

type ServiceErrorModule = typeof import('../src/app/ServiceError');
const serviceError: ServiceErrorModule | null = await import('../src/app/ServiceError').catch(() => null);
const errorSourceModules = import.meta.glob('../src/app/ServiceError.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const errorSource = errorSourceModules['../src/app/ServiceError.tsx'] ?? '';

function requireServiceError(): ServiceErrorModule {
  if (serviceError === null) throw new Error('src/app/ServiceError.tsx is not on this commit yet');
  return serviceError;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
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
  const { ServiceError } = requireServiceError();
  return renderToStaticMarkup(createElement(ServiceError, props));
}

const legalPaths = ['/privacy', '/terms', '/support'] as const;

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
