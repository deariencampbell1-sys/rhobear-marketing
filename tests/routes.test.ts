import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes, notFoundRoute, productPaths, ORIGIN } from '../src/app/routes';
import { renderRoute } from '../src/app/render';

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

describe('route table', () => {
  it('has exactly the 13 canonical paths plus the 404 case, each once', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toEqual(CANONICAL_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
    expect(notFoundRoute.path).toBe('/404');
    expect(notFoundRoute.kind).toBe('static');
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

  it('writes an index.html for every route, 404.html, sitemap.xml and robots.txt', () => {
    for (const route of routes) {
      expect(fs.existsSync(pageFor(route.path)), pageFor(route.path)).toBe(true);
    }
    for (const file of [`${DIST}/404.html`, `${DIST}/sitemap.xml`, `${DIST}/robots.txt`]) {
      expect(fs.existsSync(file), file).toBe(true);
    }
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

  it('lists exactly the canonical routes in sitemap.xml', () => {
    const sitemap = fs.readFileSync(`${DIST}/sitemap.xml`, 'utf8');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(CANONICAL_PATHS.map((p) => `${ORIGIN}${p}`));
  });

  it('allows all in robots.txt and points at the sitemap', () => {
    const robots = fs.readFileSync(`${DIST}/robots.txt`, 'utf8');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
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
});