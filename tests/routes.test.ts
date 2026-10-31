import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { routes, notFoundRoute, productPaths, ORIGIN } from '../src/app/routes';
import { renderRoute } from '../src/app/render';
import { classifySharedLink, NotFound, type SharedLinkResult } from '../src/app/NotFound';
import { parseIntent } from '../src/clients/intent/schema';
import { brand, enginesDestination, heraldOffers, productById, products } from '../src/data';
// W1-02-r1: the scenario routes and their titles derive from the real
// registry — ids and order are imported here, never hand-written.
import { engineScenarios, engines, enginesById } from '../src/data/engines';
// W1-01-r1 test 8 reads the owned sources as text (the repo's ?raw style).
import routesSource from '../src/routes/index.tsx?raw';
import notFoundSource from '../src/app/NotFound.tsx?raw';

// The dependency list for this wave is frozen and includes no @types/node, so
// Node builtins are loaded through non-literal dynamic imports and narrowed by
// the small interfaces below. The `any` this produces is confined to these two
// casts at the import boundary.
interface FsLike {
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}
interface CpLike {
  execSync(
    command: string,
    options: { encoding: 'utf8'; timeout: number; env?: Record<string, string | undefined> },
  ): string;
}
// Same boundary as the two casts below: no @types/node in this wave's frozen
// dependency list, so `process` is read through globalThis and narrowed.
const proc = (globalThis as unknown as {
  process?: { pid?: number; env?: Record<string, string | undefined> };
}).process;
const fsName: string = 'node:fs';
const cpName: string = 'node:child_process';
const fs = (await import(fsName)) as unknown as FsLike;
const cp = (await import(cpName)) as unknown as CpLike;

// Every build writes here, never to `dist/`. Two runs of this suite in one
// working copy used to race on `dist/` (vite empties it first), so a green run
// could fail on a build another process was halfway through deleting. The
// directory is per-process, so concurrent runs cannot see each other at all.
// Loud, not quiet: without a pid every run would share `dist-tests-0` and the
// isolation this file exists for would silently disappear.
if (!proc?.pid) throw new Error('routes.test.ts needs process.pid to isolate its build directory');
const DIST = `dist-tests-${proc.pid}`;

const CANONICAL_PATHS = [
  '/',
  '/builds',
  '/forge',
  '/herald',
  '/regent',
  '/reviews',
  '/engines',
  '/plans',
  '/get',
  '/account',
  '/support',
  '/privacy',
  '/terms',
  // W1-02-r1: one canonical path per registry scenario, derived — this is
  // never a second handwritten id list.
  ...engineScenarios.map((scenario) => `/engines/${scenario.scenarioId}`),
];

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageFor(routePath: string): string {
  return routePath === '/' ? `${DIST}/index.html` : `${DIST}${routePath}/index.html`;
}

// W1-01-r1: every owned screen's main action container, as
// [link text, href] pairs — the exact actions the brief pins, shared by the
// SSR tests and the built-HTML test.
const SCREEN_ACTIONS: Record<string, readonly (readonly [string, string])[]> = {
  '/': [
    ['Explore products', '#family-index'],
    ['Watch real work', '/engines'],
  ],
  '/builds': [
    ['Watch Builds', '/engines'],
    ['See plans', '/plans'],
  ],
  '/forge': [
    ['Watch the making', '/engines'],
    ['Explore kits', '/forge#kits'],
  ],
  '/herald': [
    ['See Herald plans', '/plans'],
    ['Watch the card', '/engines'],
  ],
  '/regent': [
    ['Plan my setup', '/support'],
    ['See the desk', '/engines'],
  ],
  '/reviews': [
    ['See review levels', '/reviews#levels'],
    ['Open Reviews web', 'https://reviews.rhobear.ai'],
  ],
};

/** The entity spellings renderToStaticMarkup emits, decoded back to text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** The visible text runs of a markup fragment, each one normalised. */
function visibleRuns(fragment: string): string[] {
  return [...fragment.matchAll(/>([^<>]+)</g)]
    .map((match) => decodeEntities(match[1]).trim().replace(/^·\s*/, ''))
    .filter((text) => text !== '');
}

/** The main region of a rendered document (the owned content, not the shell). */
function mainRegion(html: string): string {
  return html.slice(html.indexOf('<main id="main">'), html.indexOf('</main>'));
}

/**
 * W1-07-r1 (F5/F13): the anti-invention oracle. A visible run is approved
 * only when it equals an approved string after whitespace normalisation —
 * never because it contains, or is contained by, one. This red commit moves
 * the loop's old containment test here unchanged; the negative control below
 * is what fails until the comparison is tightened to equality.
 */
function isApprovedText(run: string, approved: readonly string[]): boolean {
  const normalised = run.toLowerCase();
  return approved.some((approvedText) => approvedText.toLowerCase().includes(normalised));
}

// The only non-data strings any owned screen may show: the labels and
// sentences this brief mandates, and nothing else. Anti-invention is checked
// against this list plus src/data strings and route titles.
const PINNED_LABELS = [
  'One front door for the family',
  'Explore products',
  'Watch real work',
  'Family index',
  'Destination',
  'Arrival',
  'Arriving from the App Store',
  'See Builds availability',
  'Arriving from GitHub',
  'Explore the family',
  'Arriving from an @ MCP',
  'See Engines',
  'A store, repository, or MCP arrival does not mean an app is installed or access is granted.',
  'Eligibility',
  'Eligibility is enforced at account and payment boundaries. Paid offers are US-only and 18+.',
  'Unknown region or age is not eligibility. An unsupported region or age must not be shown a payment control.',
  'Read terms',
  'Ask support',
  'Proof',
  'Recording in review',
  'Availability',
  'What that means',
  'Watch Builds',
  'See plans',
  'Watch the making',
  'Explore kits',
  'Kits',
  'See Herald plans',
  'Watch the card',
  'Plan my setup',
  'See the desk',
  'Synthetic prototype',
  'No live agency data is shown.',
  'See review levels',
  'Open Reviews web',
  'Review levels',
  'Verifier',
  'Apollo',
  'Zeus',
  'Offline',
  'You can still use these page links. Cached information may be stale; nothing here infers your balance, subscription, installation, payment, or job success.',
  // W1-02-r1: the tiny allowlist of labels and sentences the engines/proof
  // brief pins verbatim — nothing else is admitted.
  'Builds mini app',
  '@ MCP',
  'The real recording, captions and transcript appear after approval. No mock or stock clip is shown.',
  'Open proof shell',
  'Live samples',
  'Try a sample',
  'Samples open when the engine service and quota are live.',
  'Back to Engines',
];

/** Every approved string: src/data facts, route titles and the pinned labels. */
function approvedStrings(): string[] {
  const approved = [
    brand.name,
    brand.tagline,
    brand.taglineExplanation,
    brand.familyLine,
    enginesDestination.publicName,
    enginesDestination.oneLiner,
    ...routes.map((r) => r.title),
    ...PINNED_LABELS,
  ];
  for (const product of products) {
    approved.push(
      product.publicName,
      product.oneLiner,
      product.promise,
      ...product.whatItIs,
      product.availability.label,
      product.availability.reason,
    );
  }
  // W1-02-r1: approved engine facts — names and MCP handles only; engines
  // carry no public description beyond the pending state.
  for (const engine of engines) {
    approved.push(engine.publicName, engine.mcpHandle);
  }
  approved.push(enginesDestination.whatItIs);
  return approved;
}

// W1-03-r1 amendment 1 (Niobe, 2026-10-29): P03 puts Herald's own offers on
// /herald, so those four P03 strings — `$49.00 per month`, `$99.00 per month`,
// `$30.00 per month` and `$39.00 setup`, derived from the heraldOffers rows the
// page renders, never retyped — are the only dollar strings that page may show
// and the only price text it may invent. The texting row renders both of its
// charges in one visible run joined by the page's own "plus", so that composed
// run is derived from the same offer here as well. Approved for /herald only.
function heraldApprovedTexts(): string[] {
  const texts: string[] = [];
  for (const offer of heraldOffers) {
    const monthly = `$${offer.monthly} per month`;
    texts.push(monthly);
    if (offer.setup === null) continue;
    const setup = `$${offer.setup} setup`;
    texts.push(setup);
    texts.push(`${monthly} plus ${setup}`);
  }
  return texts;
}

// W1-03-r1 amendment 2 (Niobe, 2026-10-29): P03 also mandates Herald's row
// labels, derived from the heraldOffers ids exactly as the page derives them —
// never retyped. Approved for /herald only.
function heraldOfferLabels(): string[] {
  return heraldOffers.map((offer) =>
    offer.id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
  );
}

// Amendment 1: strip /herald's four approved P03 prices and leave everything
// else byte-identical — every other owned page keeps the blanket no-price rule.
function withoutHeraldPrices(path: string, text: string): string {
  if (path !== '/herald') return text;
  return heraldApprovedTexts().reduce((rest, price) => rest.split(price).join(''), text);
}

// W1-01-r1 shared-link fixtures: built through parseIntent-valid fields and
// the real parseIntent, never fabricated invalid TypeScript objects.
const NOW = Date.parse('2026-11-01T00:30:00Z');

function intentFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'AAAAAAAAAAAAAAAAAAAAAA',
    product: 'builds',
    returnRoute: '/builds',
    kind: 'demo',
    createdAt: '2026-11-01T00:00:00Z',
    expiresAt: '2026-11-01T01:00:00Z',
    ...overrides,
  };
}

function validIntent(overrides: Record<string, unknown> = {}) {
  const parsed = parseIntent(intentFields(overrides));
  if (!parsed.ok) throw new Error(`intent fixture refused by parseIntent: ${parsed.problem}`);
  return parsed.intent;
}

describe('route table', () => {
  it('route table has 13 canonical section routes plus seven registry scenarios', () => {
    const paths = routes.map((r) => r.path);
    // Exact ordered paths: the 13 canonical section routes plus one route per
    // registry scenario, each exactly once.
    expect(CANONICAL_PATHS).toHaveLength(20);
    expect(paths).toEqual(CANONICAL_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
    expect(notFoundRoute.path).toBe('/404');
    expect(notFoundRoute.kind).toBe('static');
    // The scenario half derives from the registry: ids, order and titles.
    expect(CANONICAL_PATHS.slice(13)).toEqual(
      engineScenarios.map((scenario) => `/engines/${scenario.scenarioId}`),
    );
    for (const scenario of engineScenarios) {
      const route = routes.find((r) => r.path === `/engines/${scenario.scenarioId}`);
      expect(route?.title, scenario.scenarioId).toBe(
        `${enginesById[scenario.engineId].publicName} proof`,
      );
      expect(route?.group, scenario.scenarioId).toBe('platform');
      expect(route?.kind, scenario.scenarioId).toBe('static');
    }
    // Only /account receives a client bundle.
    expect(routes.filter((r) => r.kind === 'dynamic').map((r) => r.path)).toEqual(['/account']);
  });

  it('marks only /account dynamic and keeps kinds and groups valid', () => {
    for (const route of routes) {
      expect(['static', 'dynamic']).toContain(route.kind);
      expect(['product', 'platform', 'commerce', 'about', 'account', 'home']).toContain(
        route.group,
      );
    }
    expect(routes.find((r) => r.path === '/account')?.kind).toBe('dynamic');
    expect(routes.filter((r) => r.kind === 'dynamic').map((r) => r.path)).toEqual(['/account']);
  });
});

// W1-07-r1 (F4): the anti-invention oracle must never silently read the wrong
// region: mainRegion asserts exactly one <main> landmark per rendered page and
// fails loudly on zero or two. A nested <main> still counts one.
describe('W1-07-r1 main landmark guard (F4)', () => {
  it('fails loudly on a page with zero <main> landmarks', () => {
    expect(() => mainRegion('<div>no landmark here</div>')).toThrow(/<main>/);
  });

  it('fails loudly on a page with two <main> landmarks', () => {
    const two = '<main id="main">first</main><main id="main">second</main>';
    expect(() => mainRegion(two)).toThrow(/<main>/);
  });

  it('counts a <main> nested inside another element as exactly one', () => {
    const nested = '<div><main id="main">the real region</main></div>';
    expect(mainRegion(nested)).toContain('the real region');
  });

  it('every real page passes with exactly one <main>', () => {
    for (const path of [...CANONICAL_PATHS, '/404']) {
      expect(() => mainRegion(renderRoute(path)), path).not.toThrow();
    }
  });
});

// W1-07-r1 (F5/F13): the negative control that closes the substring hole.
// Approval is equality after whitespace normalisation: a longer invented
// string that contains an approved one, and a substring of an approved one,
// both fail; the genuinely approved string still passes.
describe('W1-07-r1 anti-invention oracle (F5/F13)', () => {
  const APPROVED = ['Teams at work'];

  it('rejects an invented string that contains an approved one', () => {
    expect(isApprovedText('Teams at work — buy now', APPROVED)).toBe(false);
  });

  it('rejects a substring of an approved string', () => {
    expect(isApprovedText('Teams', APPROVED)).toBe(false);
  });

  it('accepts the approved string after whitespace normalisation', () => {
    expect(isApprovedText('Teams at work', APPROVED)).toBe(true);
    expect(isApprovedText('  Teams\n at   work  ', APPROVED)).toBe(true);
  });
});

// W1-07-r1 (F12): one malformed registry row must never kill the whole route
// table at import. The mock replaces only engineScenarios (importActual +
// spread), so the dynamic import below runs the real route derivation with one
// bad row and proves the good page and the bad page both still exist.
describe('W1-07-r1 registry robustness (F12)', () => {
  it('imports cleanly with a malformed engineId and fails only that page closed', async () => {
    vi.resetModules();
    vi.doMock('../src/data/engines', async () => {
      const actual = await vi.importActual<typeof import('../src/data/engines')>('../src/data/engines');
      return {
        ...actual,
        engineScenarios: [
          ...actual.engineScenarios,
          {
            scenarioId: 'malformed-01',
            engineId: 'no-such-engine',
            publicationState: 'footage-pending' as const,
            source: actual.enginesDestination.source,
          },
        ],
      };
    });
    try {
      const [{ routes: guardedRoutes, findRoute: guardedFindRoute }, { renderRoute: renderGuarded }] =
        await Promise.all([import('../src/app/routes'), import('../src/app/render')]);
      // The table imports and serves both routes: no whole-table failure.
      const paths = guardedRoutes.map((route) => route.path);
      expect(paths).toContain('/engines/teams-01');
      expect(paths).toContain('/engines/malformed-01');
      // The bad row fails its own page closed with the page's own wording...
      expect(guardedFindRoute('/engines/malformed-01')?.title).toBe('Proof unavailable');
      const bad = renderGuarded('/engines/malformed-01');
      expect(bad).toContain('Proof unavailable');
      expect(bad).toContain('href="/support"');
      // ...and the good page keeps its real registry title and content.
      expect(guardedFindRoute('/engines/teams-01')?.title).toBe('Teams proof');
      const good = renderGuarded('/engines/teams-01');
      expect(good).toContain('Teams');
      expect(good).toContain('Recording in review');
      expect(good).not.toContain('Proof unavailable');
    } finally {
      vi.doUnmock('../src/data/engines');
      vi.resetModules();
    }
  });
});

describe('prerender output', () => {
  beforeAll(() => {
    // Always build from source, into this process's own directory, so these
    // assertions can never run against a stale bundle from an earlier build and
    // two concurrent runs of this suite can never invalidate each other.
    // The real build script, not a hand-assembled command line: `npm run build`
    // is `tsc --noEmit && vite build && node scripts/prerender.mjs`, and
    // `RHOBEAR_DIST` redirects both the vite output and the prerender output, so
    // this exercises the production path while writing nothing into `dist/`.
    cp.execSync('npm run build', {
      encoding: 'utf8',
      timeout: 240_000,
      env: { ...(proc?.env ?? {}), RHOBEAR_DIST: DIST },
    });
  }, 240_000);

  afterAll(() => {
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.rmSync(`.cache/prerender-${DIST}`, { recursive: true, force: true });
  });

  it('prerender emits 20 routes plus 404 and the sitemap matches exactly', () => {
    expect(routes).toHaveLength(20);
    for (const route of routes) {
      expect(fs.existsSync(pageFor(route.path)), pageFor(route.path)).toBe(true);
    }
    for (const file of [`${DIST}/404.html`, `${DIST}/sitemap.xml`, `${DIST}/robots.txt`]) {
      expect(fs.existsSync(file), file).toBe(true);
    }
    const sitemap = fs.readFileSync(`${DIST}/sitemap.xml`, 'utf8');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(CANONICAL_PATHS.map((p) => `${ORIGIN}${p}`));
    // No invented scenario: every /engines/ page is a registry scenario page.
    expect(locs.filter((loc) => loc.includes('/engines/'))).toEqual(
      engineScenarios.map((scenario) => `${ORIGIN}/engines/${scenario.scenarioId}`),
    );
  });

  it('renders every page readable with JavaScript disabled', () => {
    const pages = [...routes.map((r) => r.path), '/404'];
    for (const path of pages) {
      const file = path === '/404' ? `${DIST}/404.html` : pageFor(path);
      const html = fs.readFileSync(file, 'utf8');
      const text = visibleText(html);
      expect((html.match(/<h1[\s>]/g) ?? []).length, `${path}: one <h1>`).toBe(1);
      expect(html.includes('lang="en"'), `${path}: lang`).toBe(true);
      expect(html.includes('id="main"'), `${path}: #main`).toBe(true);
      expect(text.length, `${path}: visible text`).toBeGreaterThanOrEqual(40);
      expect(html.includes('undefined'), `${path}: no undefined`).toBe(false);
      expect(html.includes('NaN'), `${path}: no NaN`).toBe(false);
    }
  });

  it('injects the client bundle into /account and leaves static pages script-free', () => {
    const account = fs.readFileSync(`${DIST}/account/index.html`, 'utf8');
    expect(account).toMatch(/<script type="module" src="\/assets\/[^"]+\.js"><\/script>/);
    for (const file of [`${DIST}/index.html`, `${DIST}/plans/index.html`, `${DIST}/404.html`]) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toContain('<script');
    }
  });

  it('allows all in robots.txt and points at the sitemap', () => {
    const robots = fs.readFileSync(`${DIST}/robots.txt`, 'utf8');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('owned static pages are substantive without JavaScript', () => {
    // The built home and product HTML — the same pages the acceptance server
    // serves — carries the content and the exact actions with no script at all.
    const owned = new Map<string, string>([['/', fs.readFileSync(`${DIST}/index.html`, 'utf8')]]);
    for (const product of products) {
      owned.set(`/${product.id}`, fs.readFileSync(pageFor(`/${product.id}`), 'utf8'));
    }
    for (const [path, html] of owned) {
      const text = visibleText(html);
      expect((html.match(/<h1[\s>]/g) ?? []).length, `${path}: one <h1>`).toBe(1);
      expect(text.length, `${path}: meaningful text`).toBeGreaterThan(400);
      expect(html, `${path}: no script`).not.toContain('<script');
      expect(html, `${path}: no undefined`).not.toContain('undefined');
      expect(html, `${path}: no NaN`).not.toContain('NaN');
      for (const [label, href] of SCREEN_ACTIONS[path]) {
        expect(html, `${path}: ${label}`).toContain(label);
        expect(html, `${path}: ${label}`).toContain(`href="${href}"`);
      }
    }
  });

  it('engines and every scenario are substantive static HTML', () => {
    const enginesHtml = decodeEntities(fs.readFileSync(pageFor('/engines'), 'utf8'));
    const enginesText = visibleText(enginesHtml);
    expect((enginesHtml.match(/<h1[\s>]/g) ?? []).length, '/engines: one h1').toBe(1);
    expect(enginesText.length, '/engines: meaningful text').toBeGreaterThan(800);
    expect(enginesHtml, '/engines: no script').not.toContain('<script');
    expect(enginesHtml, '/engines: no undefined').not.toContain('undefined');
    expect(enginesHtml, '/engines: no NaN').not.toContain('NaN');
    for (const engine of engines) {
      expect(enginesHtml, engine.publicName).toContain(engine.publicName);
      expect(enginesHtml, engine.mcpHandle).toContain(engine.mcpHandle);
    }
    expect(enginesHtml, '/engines: pending state').toContain('Recording in review');
    for (const scenario of engineScenarios) {
      const path = `/engines/${scenario.scenarioId}`;
      const engine = enginesById[scenario.engineId];
      const html = decodeEntities(fs.readFileSync(pageFor(path), 'utf8'));
      const text = visibleText(html);
      expect((html.match(/<h1[\s>]/g) ?? []).length, `${path}: one h1`).toBe(1);
      expect(text.length, `${path}: meaningful text`).toBeGreaterThan(150);
      expect(html, `${path}: no script`).not.toContain('<script');
      expect(html, `${path}: no undefined`).not.toContain('undefined');
      expect(html, `${path}: no NaN`).not.toContain('NaN');
      expect(html, `${path}: engine`).toContain(engine.publicName);
      expect(html, `${path}: mcp`).toContain(engine.mcpHandle);
      expect(html, `${path}: pending state`).toContain('Recording in review');
    }
  });
});

describe('unknown route', () => {
  it('renders the not-found page with links to all five product paths', () => {
    const html = renderRoute('/no-such-page');
    expect(html).toContain('Page not found');
    for (const path of productPaths) {
      expect(html, path).toContain(`href="${path}"`);
    }
    expect(html).toContain('href="/plans"');
    expect(html).toContain('href="/support"');
    expect(html).toContain('href="/"');
  });

  it('unknown scenario renders 404 without redirect', () => {
    // A known scenario page is a real page — the 404 is only for unknowns.
    expect(renderRoute('/engines/teams-01')).not.toContain('Page not found');
    const html = renderRoute('/engines/invented-99');
    expect(html).toContain('Page not found');
    // Six destinations plus support, in the shared 404 shell.
    for (const href of [
      '/',
      '/builds',
      '/forge',
      '/herald',
      '/regent',
      '/reviews',
      '/engines',
      '/support',
    ]) {
      expect(html, href).toContain(`href="${href}"`);
    }
    expect(html).toContain('href="/plans"');
    // The unknown id is never reflected and nothing redirects.
    expect(html).not.toContain('invented-99');
    expect(html).not.toMatch(/http-equiv|window\.location|location\.(href|replace|assign)|<script/i);
  });
});

// W1-01-r1: the home and five product screens (A01/A02/A04/A06 and U01–U05),
// the shared offline/404 shell, fail-closed shared-link recovery (A03) and
// the anti-invention and composition checks.
describe('W1-01-r1 screens', () => {
  it('home renders the family in approved data order', () => {
    const home = renderRoute('/');
    expect((home.match(/<h1[\s>]/g) ?? []).length, 'one h1').toBe(1);
    for (const fact of [brand.tagline, brand.taglineExplanation, brand.familyLine]) {
      expect(home, fact).toContain(fact);
    }
    // Five products in `products` array order, then Engines — each entry's
    // oneLiner is unique on the page, so first-occurrence order is the order.
    const oneLiners = [
      ...products.map((product) => product.oneLiner),
      enginesDestination.oneLiner,
    ];
    let cursor = -1;
    for (const oneLiner of oneLiners) {
      const at = home.indexOf(oneLiner);
      expect(at, oneLiner).toBeGreaterThan(cursor);
      cursor = at;
    }
    for (const product of products) {
      expect(home, product.publicName).toContain(product.publicName);
      expect(home, product.availability.label).toContain(product.availability.label);
      expect(home, product.id).toContain(`href="/${product.id}"`);
    }
    expect(home).toContain(enginesDestination.publicName);
    expect(home).toContain('id="family-index"');
    expect(home).toContain('href="#family-index"');
    expect(home).toContain('href="/engines"');
    expect(home).toContain('Recording in review');
  });

  it('arrival and eligibility never infer a grant', () => {
    const home = renderRoute('/');
    const arrivals: readonly (readonly [string, string, string])[] = [
      ['Arriving from the App Store', 'See Builds availability', '/builds'],
      ['Arriving from GitHub', 'Explore the family', '#family-index'],
      ['Arriving from an @ MCP', 'See Engines', '/engines'],
    ];
    const bounds = arrivals.map(([label]) => home.indexOf(label));
    expect(bounds.every((at) => at >= 0), 'three distinct A04 labels').toBe(true);
    expect([...bounds].sort((a, b) => a - b), 'labels are distinct and ordered').toEqual(bounds);
    for (let i = 0; i < arrivals.length; i += 1) {
      const [label, action, href] = arrivals[i];
      const region = home.slice(bounds[i], bounds[i + 1] ?? home.length);
      expect(region, label).toContain(action);
      expect(region, label).toContain(`href="${href}"`);
    }
    expect(home).toContain(
      'A store, repository, or MCP arrival does not mean an app is installed or access is granted.',
    );
    expect(home).toContain(
      'Eligibility is enforced at account and payment boundaries. Paid offers are US-only and 18+.',
    );
    expect(home).toContain(
      'Unknown region or age is not eligibility. An unsupported region or age must not be shown a payment control.',
    );
    expect(home).toContain('Read terms');
    expect(home).toContain('href="/terms"');
    expect(home).toContain('Ask support');
    expect(home).toContain('href="/support"');
    // Never a grant: no install-success or eligibility-success wording and no
    // payment control anywhere on the screen.
    const text = visibleText(home);
    expect(text).not.toMatch(/installed successfully|you are eligible|eligibility confirmed/i);
    expect(text).not.toMatch(/payment (succeeded|complete)|pay now|buy now|add to cart|checkout now/i);
    expect(home).not.toMatch(/<input|<form/);
  });

  it('product pages render exact approved content and actions', () => {
    for (const product of products) {
      const path = `/${product.id}`;
      const html = renderRoute(path);
      expect((html.match(/<h1[\s>]/g) ?? []).length, `${path}: one h1`).toBe(1);
      expect(html, `${path}: oneLiner`).toContain(product.oneLiner);
      expect(html, `${path}: promise`).toContain(product.promise);
      for (const item of product.whatItIs) {
        expect(html, `${path}: ${item}`).toContain(item);
      }
      expect(html, `${path}: availability label`).toContain(product.availability.label);
      expect(html, `${path}: availability reason`).toContain(product.availability.reason);
      expect(html, `${path}: proof label`).toContain('Proof');
      expect(html, `${path}: proof state`).toContain('Recording in review');
      for (const [label, href] of SCREEN_ACTIONS[path]) {
        expect(html, `${path}: ${label}`).toContain(label);
        expect(html, `${path}: ${label}`).toContain(`href="${href}"`);
      }
      // No price on any owned page — /herald alone shows its own P03 offer
      // strings (amendment 1); once they are removed no other price remains.
      expect(withoutHeraldPrices(path, html), path).not.toMatch(/\$\d/);
    }

    // Forge: a real #kits section holding Forge's own availability facts —
    // no invented kit name, price or shipping claim.
    const forge = renderRoute('/forge');
    const kitsStart = forge.indexOf('<section id="kits">');
    expect(kitsStart, 'Forge #kits').toBeGreaterThanOrEqual(0);
    const kits = forge.slice(kitsStart, forge.indexOf('</section>', kitsStart));
    expect(kits).toContain('Kits');
    expect(kits).toContain(productById('forge').availability.label);
    expect(kits).toContain(productById('forge').availability.reason);

    // Reviews: #levels with exactly Verifier, Apollo, Zeus in that order and
    // no new capability description — the names are the promise's own words.
    const reviews = renderRoute('/reviews');
    const levelsStart = reviews.indexOf('<section id="levels">');
    expect(levelsStart, 'Reviews #levels').toBeGreaterThanOrEqual(0);
    const levels = reviews.slice(levelsStart, reviews.indexOf('</section>', levelsStart));
    expect(visibleRuns(levels)).toEqual(['Review levels', 'Verifier', 'Apollo', 'Zeus']);
    const reviewsFacts = [
      productById('reviews').promise,
      ...productById('reviews').whatItIs,
    ].join(' ');
    for (const level of ['Verifier', 'Apollo', 'Zeus']) {
      expect(reviewsFacts, level).toContain(level);
    }

    // Regent: the synthetic label and the no-live-data truth.
    const regent = renderRoute('/regent');
    expect(regent).toContain('Synthetic prototype');
    expect(regent).toContain('No live agency data is shown.');
  });
});

describe('W1-01-r1 offline and recovery shell', () => {
  it('offline and 404 expose six canonical destinations plus support without inferred state', () => {
    const pages = new Map<string, string>([['/', renderRoute('/')]]);
    for (const product of products) {
      pages.set(`/${product.id}`, renderRoute(`/${product.id}`));
    }
    pages.set('/no-such-page', renderRoute('/no-such-page'));
    for (const [path, html] of pages) {
      for (const href of ['/', '/builds', '/forge', '/herald', '/regent', '/reviews', '/engines', '/support']) {
        expect(html, `${path} -> ${href}`).toContain(`href="${href}"`);
      }
      // The offline wording is a stale-cache caution, not network detection.
      expect(html, path).toContain('Cached information may be stale');
      const text = visibleText(html).toLowerCase();
      for (const phrase of [
        'zero balance',
        'not subscribed',
        'payment succeeded',
        'installed successfully',
        'job succeeded',
      ]) {
        expect(text, `${path} says "${phrase}"`).not.toContain(phrase);
      }
    }
    // The 404 page keeps its plans link.
    expect(pages.get('/no-such-page') ?? '').toContain('href="/plans"');
  });

  it('shared-link recovery fails closed in precedence order', () => {
    const cases: readonly (readonly [string, Record<string, unknown>, SharedLinkResult])[] = [
      ['unknown product', { product: 'nope' }, { kind: 'recovery', reason: 'unknown-product' }],
      [
        'hostile product value',
        { product: 'evil<script>alert(1)</script>' },
        { kind: 'recovery', reason: 'unknown-product' },
      ],
      ['non-string product', { product: 42 }, { kind: 'recovery', reason: 'unknown-product' }],
      [
        'absolute URL destination',
        { intent: intentFields({ returnRoute: 'https://evil.example/steal' }) },
        { kind: 'recovery', reason: 'malformed-intent' },
      ],
      [
        'protocol-relative destination',
        { intent: intentFields({ returnRoute: '//evil.example' }) },
        { kind: 'recovery', reason: 'malformed-intent' },
      ],
      [
        'traversal destination',
        { intent: intentFields({ returnRoute: '/builds/../../../etc/passwd' }) },
        { kind: 'recovery', reason: 'malformed-intent' },
      ],
      [
        'query-smuggled destination',
        { intent: intentFields({ returnRoute: '/account?next=//evil.example' }) },
        { kind: 'recovery', reason: 'malformed-intent' },
      ],
      ['non-object intent', { intent: 'not-an-object' }, { kind: 'recovery', reason: 'malformed-intent' }],
      [
        'expired intent at exact expiry',
        { intent: validIntent({ expiresAt: '2026-11-01T00:30:00Z' }) },
        { kind: 'recovery', reason: 'expired-intent' },
      ],
      [
        'expired intent before now',
        { intent: validIntent({ createdAt: '2026-10-31T23:00:00Z', expiresAt: '2026-11-01T00:00:00Z' }) },
        { kind: 'recovery', reason: 'expired-intent' },
      ],
      [
        'valid intent destination',
        { intent: validIntent({ returnRoute: '/reviews' }) },
        { kind: 'destination', path: '/reviews', reason: 'valid-intent' },
      ],
      ['valid product destination', { product: 'builds' }, { kind: 'destination', path: '/builds', reason: 'product' }],
      [
        'engines product destination',
        { product: 'engines' },
        { kind: 'destination', path: '/engines', reason: 'product' },
      ],
      [
        'known scenario destination',
        { scenario: 'teams-01' },
        { kind: 'destination', path: '/engines', reason: 'scenario' },
      ],
      ['unknown scenario', { scenario: 'invented-99' }, { kind: 'recovery', reason: 'malformed-intent' }],
      ['valid plan destination', { plan: 'shell' }, { kind: 'destination', path: '/plans', reason: 'plan' }],
      ['unknown plan', { plan: 'enterprise' }, { kind: 'recovery', reason: 'malformed-intent' }],
      ['empty input', {}, { kind: 'recovery', reason: 'malformed-intent' }],
      [
        'intent beats product',
        { intent: validIntent({ returnRoute: '/herald' }), product: 'forge' },
        { kind: 'destination', path: '/herald', reason: 'valid-intent' },
      ],
      [
        'product beats scenario',
        { product: 'reviews', scenario: 'teams-01' },
        { kind: 'destination', path: '/reviews', reason: 'product' },
      ],
      [
        'scenario beats plan',
        { scenario: 'teams-01', plan: 'shell' },
        { kind: 'destination', path: '/engines', reason: 'scenario' },
      ],
    ];
    for (const [name, input, expected] of cases) {
      expect(classifySharedLink(input, NOW), name).toEqual(expected);
    }

    // A valid intent yields its exact validated returnRoute, is never marked
    // consumed, and never redirects.
    const intent = validIntent({ returnRoute: '/regent' });
    const result = classifySharedLink({ intent }, NOW);
    expect(result).toEqual({ kind: 'destination', path: intent.returnRoute, reason: 'valid-intent' });
    expect(intent.consumedAt).toBeUndefined();

    // The recovery screen fails closed: no automatic navigation, no raw
    // hostile input in the HTML, and only the pinned label for a refusal.
    const hostile = renderToStaticMarkup(
      createElement(NotFound, {
        recovery: classifySharedLink({ intent: intentFields({ returnRoute: 'https://evil.example/steal' }) }, NOW),
      }),
    );
    expect(hostile).toContain('This shared link is malformed or unsupported.');
    expect(hostile).not.toContain('evil.example');
    expect(hostile).not.toMatch(/http-equiv|window\.location|location\.(href|replace|assign)|<script/i);
    const unknownProduct = renderToStaticMarkup(
      createElement(NotFound, {
        recovery: classifySharedLink({ product: 'evil<script>alert(1)</script>' }, NOW),
      }),
    );
    expect(unknownProduct).toContain('This product is not recognised.');
    expect(unknownProduct).not.toContain('alert(1)');
    const expired = renderToStaticMarkup(
      createElement(NotFound, {
        recovery: classifySharedLink(
          { intent: validIntent({ expiresAt: '2026-11-01T00:30:00Z' }) },
          NOW,
        ),
      }),
    );
    expect(expired).toContain('This shared link has expired.');

    // A destination is an ordinary link to the classifier's path — nothing
    // else navigates.
    const destination = renderToStaticMarkup(
      createElement(NotFound, { recovery: classifySharedLink({ product: 'forge' }, NOW) }),
    );
    expect(destination).toContain('Continue to the verified destination');
    expect(destination).toContain('href="/forge"');
    expect(destination).not.toMatch(/http-equiv|window\.location|location\.(href|replace|assign)|<script/i);
  });
});

describe('W1-01-r1 anti-invention and composition', () => {
  it('anti-invention allows only approved data and pinned labels', () => {
    const approved = approvedStrings();
    const owned = [
      '/',
      ...products.map((product) => `/${product.id}`),
      // W1-02-r1: the check extends to Engines and every scenario page.
      '/engines',
      ...engineScenarios.map((scenario) => `/engines/${scenario.scenarioId}`),
    ];
    for (const path of owned) {
      // Amendment 1 + 2: the approved-text list gains the four P03 price
      // strings, the derived offer labels and Contact for /herald only, and
      // Guided setup only / Request setup for /regent only; every other path is
      // checked against the same list as ever.
      // Regent disclosure strings are already approved in PINNED_LABELS; they are pinned copy, not src/data facts.
      const approvedFor = path === '/herald'
        ? [...approved, ...heraldApprovedTexts(), ...heraldOfferLabels(), 'Contact']
        : path === '/regent'
          ? [...approved, 'Guided setup only', 'Request setup']
          : approved;
      for (const run of visibleRuns(mainRegion(renderRoute(path)))) {
        expect(isApprovedText(run, approvedFor), `${path}: unapproved text node "${run}"`).toBe(true);
      }
      const html = renderRoute(path);
      const text = visibleText(html);
      expect(withoutHeraldPrices(path, text), path).not.toMatch(/\$\d/);
      expect(text, path).not.toMatch(/\bImagine\b|\bLabs\b|Blueprint mode|\bNeo\b/);
      expect(text, path).not.toMatch(
        /\b\d[\d,]*\s+(downloads|users|installs|customers|engines|apps)\b/i,
      );
      expect(text, path).not.toMatch(/\btestimonial\b/i);
    }
  });

  it('responsive composition has no fixed page width or motion', () => {
    for (const [path, source] of [
      ['src/routes/index.tsx', routesSource],
      ['src/app/NotFound.tsx', notFoundSource],
    ] as const) {
      expect(source, path).not.toMatch(/animation|transition/i);
      // No width declarations at all (camelCase minWidth/maxWidth on actions
      // aside), no fixed max width, and no raw colour or font values.
      expect(source, path).not.toMatch(/(?:^|[^A-Za-z])width\s*[:=]/i);
      expect(source, path).not.toMatch(/maxWidth\s*:\s*['"]?\d/i);
      expect(source, path).not.toMatch(
        /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|\bcolor\s*:|font-family|font-size/i,
      );
    }
    // Action styles preserve the 44 px minima: one main action container per
    // owned page, every link inside it at least 44 by 44.
    for (const path of ['/', ...products.map((product) => `/${product.id}`)]) {
      const html = renderRoute(path);
      const containers = html.split('data-primary="true"');
      expect(containers.length - 1, `${path}: one data-primary container`).toBe(1);
      const container = containers[1].slice(0, containers[1].indexOf('</div>'));
      const links = [...container.matchAll(/<a [^>]*style="([^"]*)"/g)].map((match) => match[1]);
      expect(links.length, `${path}: styled action links`).toBeGreaterThan(0);
      for (const style of links) {
        expect(style, `${path}: ${style}`).toContain('min-height:44px');
        expect(style, `${path}: ${style}`).toContain('min-width:44px');
      }
    }
  });
});