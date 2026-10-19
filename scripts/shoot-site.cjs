#!/usr/bin/env node
/*
 * Screenshots for the visual review. Builds the site (via check-site.cjs), serves
 * the publish root on localhost, and shoots each page at 390 px and 1440 px.
 *
 *   node scripts/shoot-site.cjs            # all pages, both widths
 *   node scripts/shoot-site.cjs index.html spaces.html
 *
 * Playwright is not a dependency of this repo. Point at an install with
 * PLAYWRIGHT_PATH=/path/to/playwright if the auto-detect misses.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.site-build');
const SHOTS = path.join(ROOT, 'screenshots');
const WIDTHS = [390, 1440];

const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['index.html', 'spaces.html', 'mcp.html', 'blueprints.html', 'download.html', 'privacy.html', 'terms.html', 'aup.html'];

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    '/work/repos/rhobear-builds-desktop/node_modules/playwright',
    '/work/repos/rb-N12-rho-cli/node_modules/playwright',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* next */
    }
  }
  console.error('Playwright not found. Set PLAYWRIGHT_PATH to an install.');
  process.exit(2);
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(process.env.HOME || '', '.cache/ms-playwright');
  if (!fs.existsSync(cache)) return undefined;
  const dirs = fs
    .readdirSync(cache)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const d of dirs) {
    const p = path.join(cache, d, 'chrome-linux64/chrome');
    if (fs.existsSync(p)) return p;
    const legacy = path.join(cache, d, 'chrome-linux/chrome');
    if (fs.existsSync(legacy)) return legacy;
  }
  return undefined;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
};

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(OUT, rel);
    if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const gate = spawnSync(process.execPath, [path.join(__dirname, 'check-site.cjs'), '--keep'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (gate.status !== 0) {
    console.error('\nGate is red; shooting anyway so the failure can be seen.');
  }

  const { chromium } = loadPlaywright();
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  // This machine's Playwright build and its browser cache are out of step; use a
  // cached Chromium explicitly rather than downloading one.
  const browser = await chromium.launch({ executablePath: findChrome() });
  let shot = 0;
  const overflow = [];

  for (const page of PAGES) {
    if (!fs.existsSync(path.join(OUT, page))) {
      console.log(`  skip ${page} (not built)`);
      continue;
    }
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const tab = await ctx.newPage();
      const res = await tab.goto(`${base}/${page}`, { waitUntil: 'networkidle' });
      // let the starfield paint and any hover transitions settle
      await tab.waitForTimeout(700);
      const name = `${page.replace(/\.html$/, '')}-${width}.png`;
      await tab.screenshot({ path: path.join(SHOTS, name), fullPage: true });
      // A page that scrolls sideways on a phone is broken, full stop.
      const scrollW = await tab.evaluate(() => document.documentElement.scrollWidth);
      if (scrollW > width + 1) overflow.push(`${name} scrollWidth ${scrollW} > ${width}`);
      console.log(`  ${name}  ${res.status()}  scrollWidth ${scrollW}`);
      shot++;
      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  console.log(`\n${shot} screenshots in ${path.relative(ROOT, SHOTS)}/`);
  if (overflow.length) {
    console.log(`${overflow.length} page(s) overflow horizontally:`);
    for (const o of overflow) console.log(`  - ${o}`);
    process.exit(1);
  }
})();
