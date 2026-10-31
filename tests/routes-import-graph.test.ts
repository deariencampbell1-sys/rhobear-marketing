// F26 (W1-11-r1): the route table is the metadata path. App.tsx,
// scripts/prerender.mjs and sitemap.xml all read src/app/routes.ts, so every
// module it imports is loaded in a metadata context. Before this unit the
// route table imported `scenarioRouteTitle` from src/routes/engines.tsx — a
// page module — so reading the route table transitively loaded a React page
// tree, with whatever hooks, environment assumptions and side effects it
// carries. This walker keeps that coupling deleted: src/app/routes.ts and
// everything it reaches must contain no page module (src/routes/** or any
// .tsx file).
//
// Walk contract:
//   - follows relative static value imports and re-exports
//     (`import ... from`, `import '...'`, `export ... from`, `export * from`);
//   - collects `import type` / `export type` and all-`type` specifier lists
//     separately and does not traverse them: TypeScript erases them, so they
//     are compile-time-only edges that cannot load a page at runtime. The
//     suite asserts they exist nowhere in this graph rather than hiding them;
//   - ignores dynamic `import('...')`: it only loads when a runtime caller
//     evaluates it, and the metadata path (App's module read, prerender,
//     sitemap) never calls one;
//   - ignores import-looking text inside comments and inside string literals
//     that is not the module specifier of an import/export statement.
//
// The dependency list for this wave is frozen and includes no @types/node, so
// Node builtins are loaded through non-literal dynamic imports and narrowed by
// the small interfaces below. The `unknown` casts are confined to that
// boundary.
import { describe, expect, it } from 'vitest';
import { findRoute, notFoundRoute, ORIGIN, routes } from '../src/app/routes';
import { engineScenarios, engines, scenarioRouteTitle } from '../src/data/engines';

interface FsLike {
  readFileSync(path: string, encoding: 'utf8'): string;
}
interface PathLike {
  resolve(...parts: string[]): string;
  dirname(path: string): string;
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  sep: string;
}
interface UrlLike {
  fileURLToPath(url: string | URL): string;
}
const fsName: string = 'node:fs';
const pathName: string = 'node:path';
const urlName: string = 'node:url';
const fs = (await import(fsName)) as unknown as FsLike;
const path = (await import(pathName)) as unknown as PathLike;
const url = (await import(urlName)) as unknown as UrlLike;

// This file is <root>/tests/routes-import-graph.test.ts.
const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

interface ModuleEdge {
  specifier: string;
  /** `import type` / `export type` / a specifier list that is all `type`. */
  typeOnly: boolean;
}

/** Replace comments with spaces, keeping string literals and line structure. */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < source.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length) {
        const c = source[i];
        out += c;
        i += 1;
        if (c === '\\' && i < source.length) {
          out += source[i];
          i += 1;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

interface StringSpan {
  start: number;
  end: number;
  value: string;
}

/** Every quoted string literal in the comment-free code, with positions. */
function collectStringSpans(code: string): StringSpan[] {
  const spans: StringSpan[] = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch !== '"' && ch !== "'" && ch !== '`') {
      i += 1;
      continue;
    }
    const start = i;
    i += 1;
    let value = '';
    while (i < code.length) {
      const c = code[i];
      if (c === '\\') {
        value += c;
        i += 1;
        if (i < code.length) {
          value += code[i];
          i += 1;
        }
        continue;
      }
      i += 1;
      if (c === ch) break;
      value += c;
    }
    spans.push({ start, end: i, value });
  }
  return spans;
}

/** The nearest preceding `import`/`export` keyword that owns this literal. */
function statementKeywordBefore(code: string, literalStart: number): number {
  const prefix = code.slice(0, literalStart);
  const re = /\b(?:import|export)\b/g;
  let found = -1;
  let match = re.exec(prefix);
  while (match !== null) {
    found = match.index;
    match = re.exec(prefix);
  }
  return found;
}

/**
 * A statement is compile-time-only when it says `type` at statement level or
 * when its brace clause is a list where every entry is `type`-prefixed. A
 * default or namespace binding before the brace clause keeps it a value
 * import even if the brace clause is all types.
 */
function isTypeOnlyStatement(text: string): boolean {
  const trimmed = text.trimStart();
  if (/^(?:import|export)\s+type\b/.test(trimmed)) return true;
  if (!/^(?:import|export)\s*\{/.test(trimmed)) return false;
  const braces = /\{([\s\S]*)\}/.exec(trimmed);
  if (braces === null) return false;
  const entries = braces[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 && entries.every((entry) => /^type\s/.test(entry));
}

/** Static import/export edges of one module, comments and stray strings excluded. */
function parseModuleSpecifiers(source: string): ModuleEdge[] {
  const code = stripComments(source);
  const edges: ModuleEdge[] = [];
  for (const span of collectStringSpans(code)) {
    const before = code.slice(0, span.start);
    const isFrom = /\bfrom\s*$/.test(before);
    const isBareImport = /(?:^|[^\w$.])import\s*$/.test(before);
    if (!isFrom && !isBareImport) continue;
    if (!isFrom) {
      edges.push({ specifier: span.value, typeOnly: false });
      continue;
    }
    const keyword = statementKeywordBefore(code, span.start);
    if (keyword < 0) continue;
    edges.push({
      specifier: span.value,
      typeOnly: isTypeOnlyStatement(code.slice(keyword, span.start)),
    });
  }
  return edges;
}

const EXTENSIONS = ['.ts', '.tsx'] as const;

/** Extensionless and `../` resolution: `./x` → `./x.ts`/`.tsx`/`index.ts`. */
function resolveModuleFile(importerAbs: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(importerAbs), specifier);
  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => `${base}${extension}`),
    ...EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      fs.readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // Not a readable file: try the next resolution candidate.
    }
  }
  return undefined;
}

function toRepoRelative(rootAbs: string, fileAbs: string): string {
  return path.relative(rootAbs, fileAbs).split(path.sep).join('/');
}

/** `src/routes/**` is a page tree, and so is every `.tsx` module. */
function isPageModule(repoRelativePath: string): boolean {
  return repoRelativePath.startsWith('src/routes/') || repoRelativePath.endsWith('.tsx');
}

interface ImportGraph {
  /** Modules loaded when the entry is imported (the runtime graph). */
  runtime: Set<string>;
  /** Type-only edges found but deliberately not traversed. */
  typeOnly: Set<string>;
}

function walkImportGraph(entryAbs: string, rootAbs: string): ImportGraph {
  const runtime = new Set<string>();
  const typeOnly = new Set<string>();
  const queue: string[] = [entryAbs];
  while (queue.length > 0) {
    const fileAbs = queue.pop();
    if (fileAbs === undefined) break;
    const relativePath = toRepoRelative(rootAbs, fileAbs);
    if (runtime.has(relativePath)) continue;
    runtime.add(relativePath);
    let source: string;
    try {
      source = fs.readFileSync(fileAbs, 'utf8');
    } catch {
      continue;
    }
    for (const edge of parseModuleSpecifiers(source)) {
      if (!edge.specifier.startsWith('.')) continue;
      const resolved = resolveModuleFile(fileAbs, edge.specifier);
      if (resolved === undefined) continue;
      const resolvedRelative = toRepoRelative(rootAbs, resolved);
      if (edge.typeOnly) {
        typeOnly.add(resolvedRelative);
        continue;
      }
      if (!runtime.has(resolvedRelative)) queue.push(resolved);
    }
  }
  return { runtime, typeOnly };
}

const ROUTE_TABLE = path.join(ROOT, 'src/app/routes.ts');

describe('F26: the route table reaches no page module', () => {
  it('resolves relative imports transitively up from src/app/routes.ts', () => {
    const { runtime } = walkImportGraph(ROUTE_TABLE, ROOT);
    const pageModules = [...runtime].filter(isPageModule).sort();
    expect(
      pageModules,
      `src/app/routes.ts reaches page modules: ${pageModules.join(', ') || '(none)'}`,
    ).toEqual([]);
  });

  it('positive control: the extensionless ../data/engines import resolves to the data module', () => {
    // Without this, a walker that silently resolves nothing would pass.
    const { runtime } = walkImportGraph(ROUTE_TABLE, ROOT);
    expect(runtime.has('src/app/routes.ts')).toBe(true);
    expect(runtime.has('src/data/engines.ts')).toBe(true);
    expect(runtime.size).toBeGreaterThanOrEqual(2);
    const resolved = resolveModuleFile(ROUTE_TABLE, '../data/engines');
    expect(resolved).toBeDefined();
    expect(toRepoRelative(ROOT, resolved as string)).toBe('src/data/engines.ts');
    // Directory index resolution too: ../data resolves to ../data/index.ts.
    const indexResolved = resolveModuleFile(ROUTE_TABLE, '../data');
    expect(indexResolved).toBeDefined();
    expect(toRepoRelative(ROOT, indexResolved as string)).toBe('src/data/index.ts');
  });

  it('positive control: flags a known page module, so the page rule cannot silently pass', () => {
    expect(isPageModule('src/routes/engines.tsx')).toBe(true);
    expect(isPageModule('src/app/App.tsx')).toBe(true);
    expect(isPageModule('src/data/engines.ts')).toBe(false);
  });

  it('does not leave a type-only edge to a page module hidden in the graph', () => {
    const { typeOnly } = walkImportGraph(ROUTE_TABLE, ROOT);
    const typeOnlyPages = [...typeOnly].filter(isPageModule).sort();
    expect(typeOnlyPages).toEqual([]);
  });
});

describe('walker internals: what it follows and what it ignores', () => {
  it('follows static value imports and re-exports', () => {
    const edges = parseModuleSpecifiers(`
      import './side-effect';
      import a from './a';
      import * as ns from './ns';
      import { b, c as d } from './bc';
      export { e } from './e';
      export * from './star';
      export * as everything from './everything';
    `);
    expect(edges.map((edge) => edge.specifier)).toEqual([
      './side-effect',
      './a',
      './ns',
      './bc',
      './e',
      './star',
      './everything',
    ]);
    expect(edges.every((edge) => !edge.typeOnly)).toBe(true);
  });

  it('collects import type / export type as compile-time-only', () => {
    const edges = parseModuleSpecifiers(`
      import type { A } from './a';
      import type B from './b';
      export type { C } from './c';
      export type * from './d';
      import { type E, type F } from './ef';
    `);
    expect(edges.map((edge) => [edge.specifier, edge.typeOnly])).toEqual([
      ['./a', true],
      ['./b', true],
      ['./c', true],
      ['./d', true],
      ['./ef', true],
    ]);
  });

  it('follows a mixed type/value specifier list as runtime', () => {
    const edges = parseModuleSpecifiers(`
      import { type A, b } from './mixed';
      import x, { type C } from './default-with-type';
    `);
    expect(edges).toEqual([
      { specifier: './mixed', typeOnly: false },
      { specifier: './default-with-type', typeOnly: false },
    ]);
  });

  it('ignores dynamic import() and import.meta', () => {
    const edges = parseModuleSpecifiers(`
      const lazy = import('./lazy');
      const value = await import(\`./template-lazy\`);
      const meta = import.meta.url;
      import './real';
    `);
    expect(edges.map((edge) => edge.specifier)).toEqual(['./real']);
  });

  it('is not fooled by comments or string literals', () => {
    const edges = parseModuleSpecifiers(`
      // import './comment-line'
      /* import './comment-block' */
      /**
       * export * from './comment-doc'
       */
      const text = "import './string-literal'";
      const other = 'export * from "./other-literal"';
      import /* not a specifier */ './real';
    `);
    expect(edges.map((edge) => edge.specifier)).toEqual(['./real']);
  });
});

// W1-11-r1: the relocation is behaviour-free. These pins are the base
// commit's titles written out literally; a title that moves by one character
// fails here before it can reach prerender or sitemap.xml.
const EXPECTED_ROUTES: readonly { path: string; title: string }[] = [
  { path: '/', title: 'Home' },
  { path: '/builds', title: 'Builds' },
  { path: '/forge', title: 'Forge' },
  { path: '/herald', title: 'Herald' },
  { path: '/regent', title: 'Regent' },
  { path: '/reviews', title: 'Reviews' },
  { path: '/engines', title: 'Engines' },
  { path: '/plans', title: 'Plans and prices' },
  { path: '/get', title: 'Download' },
  { path: '/account', title: 'Account' },
  { path: '/support', title: 'Support' },
  { path: '/privacy', title: 'Privacy' },
  { path: '/terms', title: 'Terms' },
  { path: '/engines/teams-01', title: 'Teams proof' },
  { path: '/engines/designs-01', title: 'Designs proof' },
  { path: '/engines/forge-01', title: 'Forge renders proof' },
  { path: '/engines/capturd-01', title: "Captur'd proof" },
  { path: '/engines/vision-01', title: 'Vision proof' },
  { path: '/engines/search-01', title: 'Search proof' },
  { path: '/engines/spaces-01', title: 'Spaces proof' },
];

const EXPECTED_SITEMAP =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  EXPECTED_ROUTES.map((route) => `  <url><loc>https://rhobear.ai${route.path}</loc></url>`).join(
    '\n',
  ) +
  '\n</urlset>\n';

describe('W1-11-r1: every rendered title stays byte-identical', () => {
  it('pins the 20 canonical routes and their titles', () => {
    expect(routes).toHaveLength(20);
    expect(routes.map((route) => ({ path: route.path, title: route.title }))).toEqual(
      EXPECTED_ROUTES,
    );
  });

  it('pins the 21st prerendered page: the 404 title', () => {
    expect(EXPECTED_ROUTES.length + 1).toBe(21);
    expect({ path: notFoundRoute.path, title: notFoundRoute.title }).toEqual({
      path: '/404',
      title: 'Page not found',
    });
  });

  it('keeps every scenario title derived from the registry public name', () => {
    for (const scenario of engineScenarios) {
      const engine = engines.find((candidate) => candidate.id === scenario.engineId);
      if (engine === undefined) throw new Error(`no engine for scenario ${scenario.scenarioId}`);
      expect(scenarioRouteTitle(scenario.engineId)).toBe(`${engine.publicName} proof`);
    }
  });

  it('fails closed for an engine id the registry does not hold', () => {
    expect(scenarioRouteTitle('not-a-registry-engine')).toBe('Proof unavailable');
  });

  it('has no route entry for a scenario id no registry row names', () => {
    expect(findRoute('/engines/not-a-registry-scenario')).toBeUndefined();
  });

  it('renders sitemap.xml byte-for-byte from the pinned route table', () => {
    expect(ORIGIN).toBe('https://rhobear.ai');
    const sitemap =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      routes.map((route) => `  <url><loc>${ORIGIN}${route.path}</loc></url>`).join('\n') +
      '\n</urlset>\n';
    expect(sitemap).toBe(EXPECTED_SITEMAP);
  });
});
