// W1-09-r1 (F6): not-found honesty. The 404 page may only render an anchor
// whose visible label is the target route's own title; a destination outside
// the route table renders no anchor at all — never a borrowed "Home" label,
// never the requested path. This file is deliberately separate from
// tests/routes.test.ts, which W1-05-r1/W1-07-r1 hold while this unit runs.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotFound, type SharedLinkResult } from '../src/app/NotFound';
import { routes } from '../src/app/routes';

function renderNotFound(recovery?: SharedLinkResult): string {
  return renderToStaticMarkup(createElement(NotFound, recovery ? { recovery } : {}));
}

/** Every rendered anchor, in document order, as its full markup. */
function anchors(html: string): string[] {
  return [...html.matchAll(/<a [^>]*>[^<]*<\/a>/g)].map((match) => match[0]);
}

/** The recovery note paragraph as markup, or '' when none was rendered. */
function recoveryNote(html: string): string {
  const start = html.indexOf('Continue to the verified destination');
  if (start === -1) return '';
  return html.slice(start, html.indexOf('</p>', start));
}

/** The entity spellings renderToStaticMarkup emits, decoded back to text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** The recovery note's one anchor, as { href, label }, or null. */
function recoveryAnchor(html: string): { href: string; label: string } | null {
  const match = /^Continue to the verified destination <a href="([^"]*)">([^<]*)<\/a>$/.exec(
    recoveryNote(html),
  );
  return match ? { href: decodeEntities(match[1]), label: decodeEntities(match[2]) } : null;
}

// The page with no classification: the shipped state today. Every added
// classification must render exactly these anchors plus at most its own one.
const STATIC_ANCHORS = anchors(renderNotFound());

describe('F6 — a 404 destination link may only be labelled with its own route title', () => {
  it('case 1: an unmapped destination renders no anchor and no fallback label', () => {
    const html = renderNotFound({ kind: 'destination', path: '/no-such-route', reason: 'product' });
    // The classification still renders its note sentence ...
    expect(recoveryNote(html)).toBe('Continue to the verified destination');
    // ... but the anchor is absent: no borrowed label, no raw path, nothing
    // printed in the anchor's place.
    expect(recoveryAnchor(html)).toBeNull();
    expect(recoveryNote(html)).not.toContain('<a');
    expect(html).not.toContain('/no-such-route');
    // The page is exactly its ordinary self: no anchor was added.
    expect(anchors(html)).toEqual(STATIC_ANCHORS);
  });

  it('case 2: a mapped destination renders exactly one anchor carrying the route title', () => {
    const html = renderNotFound({ kind: 'destination', path: '/plans', reason: 'plan' });
    expect(recoveryAnchor(html)).toEqual({ href: '/plans', label: 'Plans and prices' });
    expect([...recoveryNote(html).matchAll(/<a /g)]).toHaveLength(1);
    expect(anchors(html)).toHaveLength(STATIC_ANCHORS.length + 1);
  });

  it('case 3: hostile destinations never appear in the full markup and render no anchor', () => {
    const hostile = [
      '/plans%22%3E%3Cscript%3E',
      'https://evil.example/steal',
      'javascript:alert(1)',
      '//evil.example',
      '/plans?next=//evil.example',
      '/plans"><script>alert(1)</script>',
    ];
    for (const path of hostile) {
      const html = renderNotFound({ kind: 'destination', path, reason: 'valid-intent' });
      // Full-markup assertions: neither the offered path nor any caller
      // fragment reaches the document, raw or HTML-escaped into a label.
      expect(html, path).not.toContain(path);
      expect(html.toLowerCase(), path).not.toContain('evil.example');
      expect(html.toLowerCase(), path).not.toContain('javascript:');
      expect(html, path).not.toContain('alert(1)');
      expect(html, path).not.toContain('<script');
      expect(recoveryAnchor(html), path).toBeNull();
      expect(anchors(html), path).toEqual(STATIC_ANCHORS);
      expect(html, path).toContain('<h1>Page not found</h1>');
    }
  });

  it('case 4: each refusal reason renders its exact sentence and no anchor', () => {
    const refusals = [
      ['unknown-product', 'This product is not recognised.'],
      ['malformed-intent', 'This shared link is malformed or unsupported.'],
      ['expired-intent', 'This shared link has expired.'],
    ] as const;
    for (const [reason, sentence] of refusals) {
      const html = renderNotFound({ kind: 'recovery', reason });
      expect(html, reason).toContain(`<p>${sentence}</p>`);
      expect(recoveryNote(html), reason).toBe('');
      expect(anchors(html), reason).toEqual(STATIC_ANCHORS);
    }
  });

  it('case 5: every route-table path renders its own title, and no route borrows another', () => {
    for (const route of routes) {
      const html = renderNotFound({ kind: 'destination', path: route.path, reason: 'product' });
      expect(recoveryAnchor(html), route.path).toEqual({ href: route.path, label: route.title });
      // One anchor per classification, never a list of guessed destinations.
      expect([...recoveryNote(html).matchAll(/<a /g)], route.path).toHaveLength(1);
    }
    // The sweep really walked the whole table.
    expect(routes.length).toBeGreaterThan(0);
  });

  it('case 6: the shipped no-recovery page still renders, unchanged and anchor-free', () => {
    const html = renderNotFound();
    expect(html).toContain('<h1>Page not found</h1>');
    expect(html).toContain('Sorry, there is no page at this address.');
    expect(recoveryNote(html)).toBe('');
    expect(anchors(html)).toEqual(STATIC_ANCHORS);
    // The page's own static links keep their existing labels.
    expect(html).toContain('<a href="/">Home</a>');
    expect(html).toContain('<a href="/support">Support</a>');
  });

  it('F33: an anchor whose content is nested markup fails the sweep loudly — never silently skipped', () => {
    // The old `[^<]*` content rule matched nothing here and returned no
    // anchor, so the sweep above would pass while this anchor went unseen.
    // The page's real invariant is that its anchors carry text only; the
    // helper must refuse this markup, not skip it.
    const nested = renderToStaticMarkup(
      createElement('a', { href: '/x' }, createElement('span', null, 'Y')),
    );
    expect(nested).toContain('<span>');
    expect(() => anchors(nested)).toThrow(/nested markup/);
  });

  it('edge cases: trailing slash, wrong case, empty and whitespace destinations render no anchor', () => {
    for (const path of ['/plans/', '/Plans', '', '   ', '\t\n']) {
      const html = renderNotFound({ kind: 'destination', path, reason: 'product' });
      const shown = JSON.stringify(path);
      expect(recoveryAnchor(html), shown).toBeNull();
      expect(anchors(html), shown).toEqual(STATIC_ANCHORS);
      expect(html, shown).toContain('<h1>Page not found</h1>');
      expect(html, shown).toContain('<a href="/support">Support</a>');
    }
  });
});
