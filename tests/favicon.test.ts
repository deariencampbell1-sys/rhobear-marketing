// The site ships a favicon, and every page points at it.
//
// Without one, every browser asks for /favicon.ico, gets a 404 and logs a
// console error on every page. The icon must be our own file (no third-party
// art), it must exist, and the head of every prerendered page must reference
// it — otherwise the 404 comes back.
//
// The link sweep at the bottom is the other half: no page may link to a URL
// that 404s, and the /404 page must still render "Page not found".
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../src/app/render';
import { routes, notFoundRoute } from '../src/app/routes';

// Same boundary as tests/routes.test.ts: no @types/node in this wave's frozen
// dependency list, so node builtins and `process` are reached through casts.
interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: 'utf8'): string;
  statSync(path: string): { size: number };
}
interface PathLike {
  join(...parts: string[]): string;
}
const proc = (globalThis as unknown as {
  process?: { cwd?: () => string };
}).process;
if (!proc?.cwd) throw new Error('favicon.test.ts needs process.cwd to find public/');
const fsName: string = 'node:fs';
const pathName: string = 'node:path';
const fs = (await import(fsName)) as unknown as FsLike;
const path = (await import(pathName)) as unknown as PathLike;

const publicDir = path.join(proc.cwd(), 'public');

const pages = [...routes.map((r) => r.path), notFoundRoute.path];

describe('favicon', () => {
  it('ships a real ico file and an svg file of our own', () => {
    const ico = path.join(publicDir, 'favicon.ico');
    const svg = path.join(publicDir, 'favicon.svg');
    expect(fs.existsSync(ico), 'public/favicon.ico is missing').toBe(true);
    expect(fs.existsSync(svg), 'public/favicon.svg is missing').toBe(true);
    expect(fs.statSync(ico).size, 'public/favicon.ico is empty').toBeGreaterThan(0);
    expect(fs.statSync(svg).size, 'public/favicon.svg is empty').toBeGreaterThan(0);

    // An ICO starts with the 4-byte header 00 00 01 00 (count 1). A file that
    // is not an icon would fail here rather than 404 in the browser.
    const icoBytes = fs.readFileSync(ico);
    expect([...icoBytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]);

    // The svg is ours and points nowhere else.
    const svgText = String(fs.readFileSync(svg, 'utf8'));
    expect(svgText).toContain('<svg');
    expect(svgText).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  });

  it('is referenced from the head of every page, including the 404 page', () => {
    for (const p of pages) {
      const html = renderRoute(p);
      const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
      expect(head, `${p}: the icon link must be in the head`).toContain(
        '<link rel="icon" href="/favicon.ico"',
      );
      expect(head, `${p}: the svg icon link must be in the head`).toContain(
        '<link rel="icon" href="/favicon.svg"',
      );
    }
  });
});

describe('no page links to a URL that 404s', () => {
  it('every internal link on every page is a route the site serves', () => {
    const known = new Set(routes.map((r) => r.path));
    // Static files the build copies into dist/, not routes.
    const assets = new Set(['/favicon.ico', '/favicon.svg']);
    for (const p of pages) {
      const html = renderRoute(p);
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      for (const href of hrefs) {
        // Fragments and absolute external URLs are not site routes.
        if (href.startsWith('#') || /^[a-z]+:/i.test(href)) continue;
        const target = href.split('#')[0].split('?')[0];
        if (target === '') continue;
        // Hashed build assets live under /assets/ and are named by the build.
        if (target.startsWith('/assets/')) continue;
        expect(
          known.has(target) || assets.has(target),
          `${p} links to ${href}, which is not a route or a shipped asset`,
        ).toBe(true);
      }
    }
  });

  it('the 404 page still renders "Page not found"', () => {
    const html = renderRoute('/404');
    expect(html).toContain('<h1>Page not found</h1>');
  });
});
