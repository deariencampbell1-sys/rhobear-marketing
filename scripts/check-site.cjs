#!/usr/bin/env node
/*
 * The marketing site's gate: assemble it exactly the way
 * .github/workflows/pages.yml does, then check every link, asset and copy rule.
 *
 *   node scripts/check-site.cjs          # build .site-build + check
 *   node scripts/check-site.cjs --keep   # same, and leave the build on disk
 *
 * No dependencies, no network. Exit code 1 on any failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '.claude/skills/rhobear-design');
const MKT = path.join(SRC, 'ui_kits/marketing-site');
const OUT = path.join(ROOT, '.site-build');

// The pages this site is: NORTH_STAR §1 + the legal set. Everything else in the
// folder is an earlier product page and is checked for links only (warn, never fail).
const STRICT_PAGES = [
  'index.html',
  'spaces.html',
  'mcp.html',
  'blueprints.html',
  'download.html',
  'privacy.html',
  'terms.html',
  'aup.html',
];

const failures = [];
const warnings = [];
const pass = (name) => console.log(`  ok   ${name}`);
const fail = (name, detail) => {
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};
const warn = (msg) => {
  warnings.push(msg);
  console.log(`  warn ${msg}`);
};
const check = (name, cond, detail) => (cond ? pass(name) : fail(name, detail));

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true });
}

// ---------------------------------------------------------------- build
function assemble() {
  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  // pages + chassis (same set pages.yml publishes: *.html only, not archive/)
  for (const f of fs.readdirSync(MKT)) {
    if (!f.endsWith('.html')) continue;
    fs.copyFileSync(path.join(MKT, f), path.join(OUT, f));
  }
  for (const f of ['shell.css', 'shell.js', 'sitemap.xml']) {
    const src = path.join(MKT, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
  }
  fs.copyFileSync(path.join(SRC, 'colors_and_type.css'), path.join(OUT, 'colors_and_type.css'));
  copyDir(path.join(SRC, 'assets'), path.join(OUT, 'assets'));
  for (const d of ['beats', 'mobile', 'rho', 'fonts', 'home-bundle']) {
    const src = path.join(MKT, d);
    if (fs.existsSync(src)) copyDir(src, path.join(OUT, d));
  }
  fs.writeFileSync(path.join(OUT, 'CNAME'), 'rhobear.ai\n');

  // pages live two levels deep and reach up for ../../assets; flatten that ref.
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(html|css|js)$/.test(e.name)) continue;
      const before = fs.readFileSync(p, 'utf8');
      const after = before.replaceAll('../../', '');
      if (after !== before) fs.writeFileSync(p, after);
    }
  };
  walk(OUT);
}

// ---------------------------------------------------------------- helpers
const localRef = (ref) => {
  const r = ref.trim();
  if (!r) return null;
  if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(r)) return null;
  if (r.startsWith('#')) return null;
  return r;
};

/** Resolve a page-relative or root-relative ref to a file in the built site. */
function resolves(fromFile, ref) {
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean) return true; // pure #anchor
  const base = clean.startsWith('/')
    ? path.join(OUT, clean.replace(/^\/+/, ''))
    : path.join(path.dirname(fromFile), clean);
  if (fs.existsSync(base)) return true;
  // GitHub Pages serves /x as /x.html and /x/ as /x/index.html
  return fs.existsSync(`${base}.html`) || fs.existsSync(path.join(base, 'index.html'));
}

const read = (f) => fs.readFileSync(f, 'utf8');

// ---------------------------------------------------------------- checks
function checkPages() {
  console.log('\nPages exist + are self-describing');
  for (const page of STRICT_PAGES) {
    const file = path.join(OUT, page);
    if (!fs.existsSync(file)) {
      fail(`${page} exists`);
      continue;
    }
    const html = read(file);
    const has = (re) => re.test(html);
    const problems = [];
    if (!has(/<title>[^<]{10,}<\/title>/)) problems.push('title');
    if (!/name="description" content="[^"]{40,}"/.test(html)) problems.push('meta description');
    if (!/rel="canonical" href="https:\/\/rhobear\.ai\//.test(html)) problems.push('canonical');
    if (!has(/<meta charset="utf-8">/i)) problems.push('charset');
    if (!has(/name="viewport"/)) problems.push('viewport');
    if (!has(/class="top-nav"/)) problems.push('nav');
    if (!has(/href="privacy\.html"/)) problems.push('privacy link');
    if (!has(/href="terms\.html"/)) problems.push('terms link');
    if (!has(/href="aup\.html"/)) problems.push('aup link');
    if (!has(/Lean\. Local\. Private\. Yours\./)) problems.push('footer line');
    for (const tag of ['section', 'div', 'main', 'nav', 'footer']) {
      const open = (html.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
      const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      if (open !== close) problems.push(`${tag} ${open}/${close}`);
    }
    check(page, problems.length === 0, problems.join(', '));
  }
}

function checkLinks() {
  console.log('\nLocal links + assets resolve (strict pages)');
  let broken = 0;
  let checked = 0;
  for (const page of STRICT_PAGES) {
    const file = path.join(OUT, page);
    if (!fs.existsSync(file)) continue;
    const html = read(file);
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      const local = localRef(ref);
      if (!local) continue;
      checked++;
      if (!resolves(file, local)) {
        broken++;
        fail(`${page} → ${local}`, 'missing target');
      }
    }
  }
  if (!broken) pass(`${checked} local refs resolve`);

  console.log('\nImages + fonts referenced by CSS resolve');
  for (const css of ['shell.css', 'colors_and_type.css']) {
    const file = path.join(OUT, css);
    const body = read(file);
    const urls = [...body.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
    let bad = 0;
    for (const u of urls) {
      const local = localRef(u);
      if (!local) continue;
      if (!resolves(file, local)) {
        bad++;
        fail(`${css} → ${local}`, 'missing asset');
      }
    }
    if (!bad) pass(`${css} urls resolve (${urls.length})`);
  }

  console.log('\nNo up-two-levels refs survive the flatten');
  let leaks = 0;
  for (const f of fs.readdirSync(OUT)) {
    if (!/\.(html|css|js)$/.test(f)) continue;
    if (read(path.join(OUT, f)).includes('../../')) {
      leaks++;
      fail(`${f} has ../../ after flatten`);
    }
  }
  if (!leaks) pass('no ../../ refs in the publish root');
}

function checkCopy() {
  console.log('\nCopy rules (NORTH_STAR §1, prices, plain-text vendors)');
  const pages = Object.fromEntries(
    STRICT_PAGES.filter((p) => fs.existsSync(path.join(OUT, p))).map((p) => [p, read(path.join(OUT, p))]),
  );

  const home = pages['index.html'] || '';
  check('home says "your own AI workspace in the cloud"', /your own AI workspace in the cloud/i.test(home));
  check('home says "remote control"', /remote control/i.test(home));
  check('home lists all five harnesses', ['Pi', 'Claude Code', 'Codex', 'OpenClaw', 'Hermes'].every((h) => home.includes(h)));
  check('home names the RHOBEAR MCP', /RHOBEAR MCP/.test(home));
  check('home says work is saved to your GitHub', /saved to your GitHub/i.test(home));
  check('home names platforms', ['iPhone', 'iPad', 'Android', 'Mac'].every((p) => home.includes(p)));

  const spaces = pages['spaces.html'] || '';
  check('spaces sells Starter at $19/mo', /\$19\s*(?:\/\s*mo|\/month)/i.test(spaces));
  check('spaces sells Own Space at $29/mo', /\$29\s*(?:\/\s*mo|\/month)/i.test(spaces));
  check('spaces marks the one-time price PRICE_TBD', spaces.includes('PRICE_TBD'));
  check('spaces lists all five harnesses', ['Pi', 'Claude Code', 'Codex', 'OpenClaw', 'Hermes'].every((h) => spaces.includes(h)));
  check('spaces says upgrades are prorated', /prorated/i.test(spaces));
  check('spaces says nothing is preinstalled/pre-signed-in', /pre-?signed-?in/i.test(spaces));

  const mcp = pages['mcp.html'] || '';
  check('mcp is account-only', /account/i.test(mcp) && /refus/i.test(mcp));
  check('mcp names its tool families', ['image', '3D', 'Blueprints'].every((t) => mcp.includes(t)));

  const bp = pages['blueprints.html'] || '';
  check('blueprints says it is not a separate app', /not a separate app/i.test(bp));
  check('blueprints appears as a feature of the harness + MCP', /harness/i.test(bp) && /MCP/.test(bp));

  const dl = pages['download.html'] || '';
  check('download says no Windows build', /No Windows/i.test(dl));
  check('download says nothing is downloadable yet', /nothing to download|not (yet )?public|no public (installer|build)/i.test(dl));

  // Old money that is no longer true anywhere on the new pages.
  const banned = [/\$17\b/, /\$47\b/, /\$87\b/, /\$50\b/, /\$27\b/, /\$99\b/, /\$297\b/];
  const bannedHits = [];
  for (const [name, html] of Object.entries(pages)) {
    for (const re of banned) if (re.test(html)) bannedHits.push(`${name}:${re}`);
  }
  check('no retired prices on the new pages', bannedHits.length === 0, bannedHits.join(', '));

  // Our cost per plan is internal: never show it as if it were the customer's credit.
  const cost = Object.entries(pages).filter(([, h]) => /\$9\b|\$11\b/.test(h)).map(([n]) => n);
  check('credit is never shown as its dollar cost', cost.length === 0, cost.join(', '));

  // OpenRouter is reserved (owner's). Saying so is fine; selling it is not, so only
  // sentences that do not deny it count as a breach.
  const orHits = [];
  for (const [name, html] of Object.entries(pages)) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (/OpenRouter/.test(sentence) && !/not used|never|reserved|no OpenRouter/i.test(sentence)) {
        orHits.push(`${name}: ${sentence.slice(0, 60)}`);
      }
    }
  }
  check('OpenRouter is never sold as plan routing', orHits.length === 0, orHits.join(', '));

  // Vendor logos: names only. Any vendor svg in an img is a breach.
  const vendorSvgs = ['anthropic.svg', 'claude.svg', 'openai.svg', 'google.svg', 'chatgpt.svg'];
  const logoHits = [];
  for (const [name, html] of Object.entries(pages)) {
    for (const svg of vendorSvgs) if (html.includes(svg)) logoHits.push(`${name}:${svg}`);
  }
  check('no vendor logos in page markup', logoHits.length === 0, logoHits.join(', '));

  // Every image needs an alt attribute (screen readers, and the brand rule that
  // decorative art is marked decorative rather than described as UI).
  const noAlt = [];
  for (const [name, html] of Object.entries(pages)) {
    for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) noAlt.push(name);
  }
  check('every img has alt', noAlt.length === 0, [...new Set(noAlt)].join(', '));

  // Blueprints must never be sold as its own product again.
  const bpPrice = Object.entries(pages).filter(([, h]) => /Blueprints[^.]{0,40}(price|subscription|\$\d)/i.test(h));
  check('Blueprints is never priced as a product', bpPrice.length === 0, bpPrice.map(([n]) => n).join(', '));
}

function checkSitemap() {
  console.log('\nSitemap lists exactly the pages we sell');
  const file = path.join(OUT, 'sitemap.xml');
  if (!fs.existsSync(file)) return fail('sitemap.xml exists');
  const xml = read(file);
  const locs = [...xml.matchAll(/<loc>https:\/\/rhobear\.ai\/([^<]*)<\/loc>/g)].map((m) => m[1] || 'index.html');
  const expected = [...STRICT_PAGES];
  const missing = expected.filter((p) => !locs.includes(p));
  const extra = locs.filter((p) => !expected.includes(p));
  check('sitemap covers every sold page', missing.length === 0, missing.join(', '));
  check('sitemap links nothing retired', extra.length === 0, extra.join(', '));
  for (const loc of locs) {
    if (!resolves(path.join(OUT, 'sitemap.xml'), loc)) fail(`sitemap → ${loc}`, 'missing page');
  }
}

function linkAuditLegacy() {
  console.log('\nLegacy pages (link check only, non-fatal)');
  for (const f of fs.readdirSync(OUT)) {
    if (!f.endsWith('.html') || STRICT_PAGES.includes(f)) continue;
    const file = path.join(OUT, f);
    const html = read(file);
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    const broken = refs.map(localRef).filter((r) => r && !resolves(file, r));
    if (broken.length) warn(`${f}: ${[...new Set(broken)].slice(0, 3).join(', ')}`);
  }
}

// ---------------------------------------------------------------- main
console.log('Assembling the site the way pages.yml does…');
assemble();
const files = [];
(function count(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) count(p);
    else files.push(p);
  }
})(OUT);
console.log(`  ${files.length} files in ${path.relative(ROOT, OUT)}`);

checkPages();
checkLinks();
checkCopy();
checkSitemap();
linkAuditLegacy();

if (!process.argv.includes('--keep')) rmrf(OUT);

console.log('');
if (warnings.length) console.log(`${warnings.length} warning(s)`);
if (failures.length) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('Gate green.');
