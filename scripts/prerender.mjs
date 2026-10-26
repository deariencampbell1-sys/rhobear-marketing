// W0-01: prerender. Renders every canonical route to real HTML in dist/.
// The route table (src/app/routes.ts) is bundled in and drives both the pages
// and sitemap.xml — one source of truth, no hand-written list. Exits non-zero
// if any route is missing from dist, a page has zero or two <h1>, or the
// rendered HTML contains the literal `undefined` or `NaN`.
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = process.cwd();
// RHOBEAR_DIST lets a caller prerender into its own output directory, which is
// what keeps two builds in one working copy from racing on dist/ (the routes
// test builds into dist-tests-<pid>). Unset means the real `dist/`, so the
// production build is unchanged.
const distDir = process.env.RHOBEAR_DIST ? path.resolve(root, process.env.RHOBEAR_DIST) : path.join(root, 'dist');
const cacheDir = path.join(root, '.cache', 'prerender');

// Bundle the renderer and the route table so Node can import the TSX app.
await build({
  configFile: false,
  logLevel: 'warn',
  root,
  build: {
    ssr: true,
    outDir: cacheDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        render: path.join(root, 'src/app/render.tsx'),
        routes: path.join(root, 'src/app/routes.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
  ssr: { noExternal: true },
});

const renderMod = await import(pathToFileURL(path.join(cacheDir, 'render.js')).href);
const routesMod = await import(pathToFileURL(path.join(cacheDir, 'routes.js')).href);
const { renderRoute, renderNotFound } = renderMod;
const { routes, ORIGIN } = routesMod;

await mkdir(distDir, { recursive: true });

// Client assets exist after `vite build`. Stylesheets are injected into every
// page (including 404); only dynamic routes get the hydration script.
async function assetTags() {
  const assetsDir = path.join(distDir, 'assets');
  if (!existsSync(assetsDir)) {
    console.error(
      'prerender failed: dist/assets is missing — run `vite build` before `scripts/prerender.mjs`.',
    );
    process.exit(1);
  }
  const files = await readdir(assetsDir);
  const styles = files
    .filter((f) => f.endsWith('.css'))
    .map((f) => `<link rel="stylesheet" href="/assets/${f}">`)
    .join('');
  const scripts = files
    .filter((f) => f.endsWith('.js'))
    .map((f) => `<script type="module" src="/assets/${f}"></script>`)
    .join('');
  return { styles, scripts };
}

function injectAssets(html, tags) {
  return tags ? html.replace('</body>', `${tags}</body>`) : html;
}

const { styles, scripts } = await assetTags();
const written = [];

for (const route of routes) {
  const tags = styles + (route.kind === 'dynamic' ? scripts : '');
  const html = injectAssets(renderRoute(route.path), tags);
  const file =
    route.path === '/'
      ? path.join(distDir, 'index.html')
      : path.join(distDir, route.path.slice(1), 'index.html');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  written.push({ file, html, kind: route.kind });
}

const notFoundFile = path.join(distDir, '404.html');
const notFoundHtml = injectAssets(renderNotFound(), styles);
await writeFile(notFoundFile, notFoundHtml);
written.push({ file: notFoundFile, html: notFoundHtml, kind: 'static' });

const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  routes.map((r) => `  <url><loc>${ORIGIN}${r.path}</loc></url>`).join('\n') +
  '\n</urlset>\n';
await writeFile(path.join(distDir, 'sitemap.xml'), sitemap);
await writeFile(
  path.join(distDir, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
);

// Validate: fail the build loudly rather than ship a broken page.
const problems = [];
for (const { file, html, kind } of written) {
  const rel = path.relative(distDir, file);
  if (!existsSync(file)) problems.push(`missing page: ${rel}`);
  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1Count !== 1) problems.push(`${rel}: expected exactly one <h1>, found ${h1Count}`);
  if (kind === 'dynamic' && !html.includes('<script type="module"')) {
    problems.push(`${rel}: dynamic route is missing its module script`);
  }
  if (!html.includes('lang="en"')) problems.push(`${rel}: missing lang="en"`);
  if (html.includes('undefined') || html.includes('NaN')) {
    problems.push(`${rel}: rendered HTML contains undefined or NaN`);
  }
}
for (const extra of ['sitemap.xml', 'robots.txt']) {
  if (!existsSync(path.join(distDir, extra))) problems.push(`missing file: ${extra}`);
}

if (problems.length > 0) {
  console.error('prerender failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`prerender: ${written.length} pages written to dist/`);