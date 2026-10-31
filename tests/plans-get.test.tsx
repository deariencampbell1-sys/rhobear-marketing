import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// W1-03-r1: Plans (P01/P02/P04), the Get shelf (T01/T03/G01) and the Herald /
// Regent commercial additions (P03), through the real App where the brief
// pins real-App behaviour. Facts come from src/data, catalog views come from
// the real catalog client pushed through its own parser, and release rows come
// from the real resolver — no hand-cast wire data anywhere in this file.
import { renderRoute } from '../src/app/render';
import {
  approvedPriceList,
  billingTerms,
  heraldOffers,
  launchOffer,
  planCopy,
  type PriceRowId,
} from '../src/data/offers';
import { checkoutState } from '../src/data/legal';
import { products } from '../src/data/products';
import { createCatalogClient, type CatalogView } from '../src/clients/money/catalog';
import type {
  MoneyRequest,
  MoneyResult,
  MoneyTransportGet,
} from '../src/clients/money/transport';
import { resolveReleases, type DeviceHints } from '../src/clients/release/resolve';
import {
  RELEASE_SCHEMA,
  platforms,
  type Platform,
  type Release,
} from '../src/clients/release/schema';

// The component module lands with the implementation commit. The red run on
// the W1-02 base must still execute every assertion below — especially the
// real-App /plans, /get, /herald and /regent checks — so this one import is
// guarded and each screen test fails on its own instead of the whole file
// failing to load before a single assertion runs.
type Screens = typeof import('../src/routes/plans-get');
const screens: Screens | null = await import('../src/routes/plans-get').catch(() => null);
const requireScreens = (): Screens => {
  if (screens === null) {
    throw new Error('src/routes/plans-get.tsx is not on this commit yet');
  }
  return screens;
};

// The owned source as text (the repo's ?raw style), through the same glob the
// data boundary test uses so the red run does not fail on a missing file.
const sourceModules = import.meta.glob('../src/routes/plans-get.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const plansGetSource = sourceModules['../src/routes/plans-get.tsx'] ?? '';

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

/** The entity spellings renderToStaticMarkup emits, decoded back to text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function render(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

/** The capability table as decoded [header, …row] cell arrays. */
function tableMatrix(html: string): string[][] {
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
  return rows.map((row) =>
    [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) =>
      decodeEntities(cell[1].replace(/<[^>]+>/g, '')).trim(),
    ),
  );
}

/** The page's one main action container (data-primary), up to its close tag. */
function primaryContainer(html: string): string {
  const parts = html.split('data-primary="true"');
  expect(parts.length - 1, 'exactly one data-primary container').toBe(1);
  const rest = parts[1];
  const ends = [rest.indexOf('</div>'), rest.indexOf('</li>')].filter((index) => index >= 0);
  return rest.slice(0, Math.min(...ends));
}

/** The main region of a rendered document (the owned content, not the shell). */
function mainRegion(html: string): string {
  return html.slice(html.indexOf('<main id="main">'), html.indexOf('</main>'));
}

/** One product's section of a rendered document, from its h2 to the next h2. */
function sectionOf(html: string, publicName: string): string {
  const start = html.indexOf(`<h2>${publicName}</h2>`);
  expect(start, `${publicName} section`).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('<h2>', start + 1);
  return html.slice(start, next === -1 ? html.length : next);
}

// ---------------------------------------------------------------- catalog ----
// Wire payloads through the real catalog client and its real parser, in the
// fake-transport pattern of tests/money-catalog.test.ts: the view a screen
// receives is always produced by catalog.ts itself, never hand-built.

const GENERATED_AT = '2026-10-29T12:00:00Z';
const CLOCK = Date.parse('2026-10-29T12:05:00Z');
const CATALOG_VERSION = '2026-10-29.1';

const approvedPlanRows = approvedPriceList.filter((row) => row.kind === 'plan');

const catalogPlanRows = approvedPlanRows.map((row) => ({
  sku: row.id,
  name: row.label,
  monthlyPrice: row.monthly,
  creditIncluded: row.includedCredit,
  availability: 'available' as const,
}));

function wireCatalog(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'rhobear.catalog.v1',
    catalogVersion: CATALOG_VERSION,
    sourceSha: 'a'.repeat(40),
    currency: 'USD',
    region: 'US',
    generatedAt: GENERATED_AT,
    plans: catalogPlanRows.map((plan) => ({ ...plan })),
    capabilities: [
      { product: 'builds', capability: 'apollo', plans: ['shell', 'shell-plus', 'space'], state: 'included' },
    ],
    ...over,
  };
}

/** Plan rows with per-sku overrides, removals and additions. */
function planRows(
  over: Record<string, Record<string, unknown>> = {},
  drop: readonly string[] = [],
  extra: readonly Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  return [
    ...catalogPlanRows
      .filter((plan) => !drop.includes(plan.sku))
      .map((plan) => (over[plan.sku] ? { ...plan, ...over[plan.sku] } : { ...plan })),
    ...extra.map((plan) => ({ ...plan })),
  ];
}

function transport(payload: unknown, now: () => number): MoneyTransportGet {
  const fetchedAt = now();
  return {
    async get<T>(
      _request: MoneyRequest,
      parse: (raw: unknown) => T | null,
    ): Promise<MoneyResult<T>> {
      const data = parse(payload);
      if (data === null) return { ok: false, reason: 'invalid-shape', requestId: 'r1' };
      return { ok: true, data, requestId: 'r1', fetchedAt };
    },
  };
}

async function viewOf(
  payload: Record<string, unknown> = wireCatalog(),
  now: () => number = () => CLOCK,
): Promise<CatalogView> {
  const client = createCatalogClient(transport(payload, now), { now });
  await client.load();
  const view = client.currentView();
  if (view === null) throw new Error('catalog fixture produced no view');
  return view;
}

async function staleView(): Promise<CatalogView> {
  let now = CLOCK;
  const client = createCatalogClient(transport(wireCatalog(), () => now), { now: () => now });
  await client.load();
  now = CLOCK + 900_001; // past the client's 15-minute fetch freshness window
  const view = client.currentView();
  if (view === null) throw new Error('stale fixture produced no view');
  return view;
}

// --------------------------------------------------------------- releases ----
// Complete Release rows in the shape tests/release-resolve.test.ts builds.

const RELEASE_AT = '2026-10-01T12:00:00Z';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const UNKNOWN_UA = 'TestRunner/1.0';
const unknownHints: DeviceHints = { userAgent: UNKNOWN_UA };

function releaseRow(product: string, platform: Platform, patch: Partial<Release> = {}): Release {
  return {
    schema: RELEASE_SCHEMA,
    product,
    platform,
    version: '1.4.0',
    sourceSha: 'a'.repeat(40),
    artifactUrl: null,
    storeUrl: null,
    bytes: 1_000_000,
    sha256: 'b'.repeat(64),
    signer: 'release-signing-key',
    notarization: 'not-applicable',
    availability: 'available',
    acceptedAt: RELEASE_AT,
    supersededBy: null,
    ...patch,
  };
}

const ARTIFACT = {
  windows: 'https://releases.example.com/builds/1.4.0/builds-windows.zip',
  macos: 'https://releases.example.com/builds/1.4.0/builds-macos.dmg',
  linux: 'https://releases.example.com/builds/1.4.0/builds-linux.tar.gz',
  web: 'https://releases.example.com/builds/1.4.0/builds-web.tgz',
  cli: 'https://releases.example.com/builds/1.4.0/builds-cli',
} as const;
const STORE = {
  ios: 'https://apps.apple.com/app/rhobear-builds/id1234567890',
  android: 'https://play.google.com/store/apps/details?id=ai.rhobear.builds',
} as const;

/** A real Builds shelf: downloads, store rows, one pulled row. */
const buildsReleases: readonly Release[] = [
  releaseRow('builds', 'windows', { artifactUrl: ARTIFACT.windows }),
  releaseRow('builds', 'macos', { artifactUrl: ARTIFACT.macos, notarization: 'passed' }),
  releaseRow('builds', 'linux', { artifactUrl: ARTIFACT.linux }),
  releaseRow('builds', 'web', { artifactUrl: ARTIFACT.web }),
  releaseRow('builds', 'cli', { artifactUrl: ARTIFACT.cli, availability: 'unavailable' }),
  releaseRow('builds', 'ios', { storeUrl: STORE.ios, signer: null }),
  releaseRow('builds', 'android', { storeUrl: STORE.android, signer: null }),
];

describe('W1-03-r1 plans, commercial routes and get', () => {
  it('plans render approved prices credit and monthly terms without arithmetic', () => {
    const { PlansPage } = requireScreens();
    const html = render(<PlansPage />);
    // Exactly the four plans, in the owner's order, and no fifth plan row.
    const headings = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]);
    expect(headings).toEqual(['Free', 'Shell', 'Shell Plus', 'Space']);
    for (const plan of approvedPlanRows) {
      expect(html, plan.id).toContain(`$${plan.monthly} per month`);
      expect(html, plan.id).toContain(`$${plan.includedCredit} included credit`);
      expect(html, plan.id).toContain(planCopy[plan.id as Exclude<PriceRowId, 'top-up'>]);
      expect(html, plan.id).toContain(plan.notes);
    }
    // Every dollar figure on the page is an approved decimal string: no
    // computed, rounded or interpolated money anywhere.
    const money = [...html.matchAll(/\$\d+\.\d{2}/g)].map((match) => match[0]);
    expect(new Set(money)).toEqual(
      new Set(['$0.00', '$23.99', '$50.99', '$69.99', '$14.40', '$39.60', '$9.99', '$9.00']),
    );
    expect(occurrences(html, ' per month')).toBe(4);
    expect(occurrences(html, ' included credit')).toBe(4);
    // The top-up is a separate add-on row, derived from its own fields.
    const topUp = approvedPriceList.find((row) => row.kind === 'add-on');
    expect(topUp).toBeDefined();
    expect(html).toContain(`$${topUp?.monthly} adds $${topUp?.includedCredit}; plan required`);
    // One launch headline, one launch body (decoded: renderToStaticMarkup
    // escapes the apostrophe in "Captur'd"), and monthly only.
    expect(occurrences(decodeEntities(html), launchOffer.headline)).toBe(1);
    expect(occurrences(decodeEntities(html), launchOffer.body)).toBe(1);
    expect(occurrences(html, `Renews ${billingTerms.interval}`)).toBe(4);
    expect(html).not.toMatch(/annual|yearly|\b12 months?\b|\b\d+ ?months? free\b/i);
  });

  it('checkout remains closed beside the disabled action', () => {
    const { PlansPage } = requireScreens();
    const html = render(<PlansPage />);
    expect(html).toContain(
      'Prices are the approved list; the amount and tax are confirmed at checkout.',
    );
    expect(html).toMatch(/<button type="button"[^>]*disabled[^>]*>Continue<\/button>/);
    // The explanation sits in the same main action container as the action.
    const primary = primaryContainer(html);
    expect(primary).toContain('>Continue</button>');
    expect(primary).toContain(checkoutState.reason);
    // No plan intent, no account redirect, no payment surface, and the only
    // button on the page is the disabled one.
    expect(html).not.toMatch(/stripe|payment intent|<input|<form|type="submit"|href="\/account"/i);
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('disabled');
    expect(checkoutState.state).toBe('closed');
  });

  it('capability matrix uses words and unknown stays unknown', async () => {
    const { PlansPage } = requireScreens();
    const html = render(<PlansPage />);
    const matrix = tableMatrix(html);
    expect(matrix).toHaveLength(8);
    expect(matrix[0]).toEqual(['Capability', 'Free', 'Shell', 'Shell Plus', 'Space']);
    const rows = matrix.slice(1);
    expect(rows.map((row) => row[0])).toEqual([
      'Verifier',
      'Apollo',
      'Zeus',
      'Forge MCP',
      'customer OpenRouter key',
      'hosted models',
      'engine samples',
    ]);
    const expected = [
      ['Included locally', 'Included', 'Included', 'Included'],
      ['Not included', 'Included', 'Included', 'Included'],
      ['Not included', 'Not included', 'Included', 'Included'],
      ['Not included', 'Included', 'Included', 'Included'],
      ['Not included', 'Allowed', 'Allowed', 'Allowed'],
      ['Local only', 'Included by plan', 'Included by plan', 'Included by plan'],
      ['Not included in checkout yet', 'Not included in checkout yet', 'Not included in checkout yet', 'Not included in checkout yet'],
    ];
    for (let r = 0; r < expected.length; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        expect(rows[r][c + 1], `${rows[r][0]}/${matrix[0][c + 1]}`).toBe(expected[r][c]);
      }
    }
    // Words, never colour or a checkmark, and never an invented capability.
    expect(html).not.toMatch(/[✓✔☑]/);
    expect(html).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|background|color:/i);
    // A catalog capability in the unknown state renders the fail-closed cell
    // wording for that row — never a tick, never a guessed mapping.
    const view = await viewOf(
      wireCatalog({
        capabilities: [{ product: 'builds', capability: 'zeus', plans: [], state: 'unknown' }],
      }),
    );
    const unknownHtml = render(<PlansPage catalog={view} />);
    const unknownMatrix = tableMatrix(unknownHtml);
    expect(unknownMatrix[3]).toEqual([
      'Zeus',
      'Not included in checkout yet',
      'Not included in checkout yet',
      'Not included in checkout yet',
      'Not included in checkout yet',
    ]);
    expect(unknownHtml).not.toMatch(/[✓✔☑]/);
  });

  it('catalog capability states and missing entries fail closed', async () => {
    const { PlansPage } = requireScreens();
    const NIC = 'Not included in checkout yet';
    // One render of the default fixture (only Apollo is carried): 'included'
    // keeps the three claimed Apollo cells as shipped; the absent Zeus entry
    // fails closed only on the cells the matrix claims ('Included' for Shell
    // Plus / Space) and keeps its two unclaimed 'Not included' words (F18).
    const defaultHtml = render(<PlansPage catalog={await viewOf(wireCatalog())} />);
    const matrix = tableMatrix(defaultHtml);
    expect(matrix).toHaveLength(8);
    expect(matrix[2]).toEqual(['Apollo', 'Not included', 'Included', 'Included', 'Included']);
    expect(matrix[3]).toEqual(['Zeus', 'Not included', 'Not included', NIC, NIC]);
    // 'not-included' is a real parser state: it flips only the three claimed
    // Apollo cells; Free's unclaimed cell keeps its approved word.
    const notIncluded = tableMatrix(render(
      <PlansPage
        catalog={await viewOf(wireCatalog({
          capabilities: [
            {
              product: 'builds',
              capability: 'apollo',
              plans: ['shell', 'shell-plus', 'space'],
              state: 'not-included',
            },
          ],
        }))}
      />,
    ));
    expect(notIncluded[2]).toEqual(['Apollo', 'Not included', NIC, NIC, NIC]);
    expect(notIncluded[3]).toEqual(['Zeus', 'Not included', 'Not included', NIC, NIC]);
  });

  it('capability table follows approved plan count and order', () => {
    const { PlansPage } = requireScreens();
    // The columns derive from the approved plan rows themselves: exactly four,
    // in the owner's data order, and the header mirrors those labels.
    expect(approvedPlanRows).toHaveLength(4);
    expect(approvedPlanRows.map((plan) => plan.id)).toEqual([
      'free',
      'shell',
      'shell-plus',
      'space',
    ]);
    const html = render(<PlansPage />);
    const matrix = tableMatrix(html);
    expect(matrix).toHaveLength(8);
    expect(matrix[0]).toEqual(['Capability', ...approvedPlanRows.map((plan) => plan.label)]);
    // Five cells in every row (row label + one per approved plan) and no
    // undefined cell anywhere — a missing capability cell fails closed.
    for (const row of matrix) {
      expect(row).toHaveLength(5);
      for (const cell of row) {
        expect(cell).not.toContain('undefined');
        expect(cell).not.toBe('');
      }
    }
    expect(html).not.toContain('undefined');
  });

  it('matching catalog is attributed and mismatch blocks purchase', async () => {
    const { PlansPage } = requireScreens();
    // A matching, fresh catalog is attributed with its version and the exact
    // generation timestamp, and checkout is still closed under checkoutState.
    const matching = render(<PlansPage catalog={await viewOf()} />);
    expect(matching).not.toContain('Catalog mismatch; purchase is blocked.');
    expect(matching).toContain(CATALOG_VERSION);
    expect(matching).toContain(new Date(GENERATED_AT).toISOString());
    expect(matching).toMatch(/<button[^>]*disabled[^>]*>Continue<\/button>/);
    expect(matching).toContain(checkoutState.reason);
    for (const plan of approvedPlanRows) {
      expect(matching, plan.id).toContain(`$${plan.monthly} per month`);
    }
    const blockedCases: readonly (readonly [string, CatalogView])[] = [
      ['changed price', await viewOf(wireCatalog({ plans: planRows({ shell: { monthlyPrice: '24.00' } }) }))],
      ['changed credit', await viewOf(wireCatalog({ plans: planRows({ 'shell-plus': { creditIncluded: '40.00' } }) }))],
      ['missing sku', await viewOf(wireCatalog({ plans: planRows({}, ['space']) }))],
      [
        'extra sku',
        await viewOf(
          wireCatalog({
            plans: planRows({}, [], [
              {
                sku: 'studio',
                name: 'Studio',
                monthlyPrice: '99.00',
                creditIncluded: '0.00',
                availability: 'available',
              },
            ]),
          }),
        ),
      ],
      ['stale view', await staleView()],
      [
        'not purchasable',
        await viewOf(
          wireCatalog({
            plans: planRows({ space: { availability: 'unavailable', reason: 'renewal review' } }),
          }),
        ),
      ],
    ];
    for (const [name, view] of blockedCases) {
      const html = render(<PlansPage catalog={view} />);
      expect(html, name).toContain('Catalog mismatch; purchase is blocked.');
      expect(html, name).not.toMatch(/<button[^>]*>Continue<\/button>/);
      expect(html, name).not.toContain('data-primary="true"');
      // Approved display facts stay visible while purchase is blocked.
      expect(html, name).toContain('$23.99 per month');
      expect(html, name).toContain('$14.40 included credit');
    }
  });

  it('free and Reviews copy makes no hosted or bundled claim', () => {
    const { PlansPage } = requireScreens();
    const html = render(<PlansPage />);
    expect(html).toContain(
      'Free is local only: pocket models, the harness and Verifier on your own machine. No hosted credit, engine usage, or trial is included.',
    );
    expect(html).toMatch(/<a href="\/get"[^>]*>Get the local app<\/a>/);
    expect(html).toContain(
      'Standalone Reviews plans are separate and are published when their cost tests pass.',
    );
    // The mandated negation appears exactly once; no positive free, annual,
    // trial, bundled or coming-soon claim exists anywhere on the page.
    expect(occurrences(html, 'It is not a free plan')).toBe(1);
    expect(occurrences(html, 'free plan')).toBe(1);
    expect(occurrences(html, 'trial')).toBe(1);
    expect(html).not.toMatch(
      /coming soon|free for (three|\d+)|\bfree (hosted|trial|month|months)\b|annual|yearly|bundled|included free/i,
    );
    expect(html).not.toMatch(/for the first \d+ (months|years)/i);
  });

  it('Herald uses only its own offers and Regent is guided setup', () => {
    // Real App pages: W1-01 content preserved, one h1, and only the additions
    // this brief pins.
    const herald = renderRoute('/herald');
    expect((herald.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    const heraldProduct = products.find((product) => product.id === 'herald');
    expect(heraldProduct).toBeDefined();
    expect(herald).toContain(heraldProduct?.oneLiner);
    expect(herald).toContain(heraldProduct?.promise);
    expect(herald).toContain(heraldProduct?.availability.label);
    expect(herald).toContain(heraldProduct?.availability.reason);
    expect(herald).toContain('Recording in review');
    expect(herald).toContain('See Herald plans');
    expect(herald).toContain('Watch the card');
    // The three own offers, in data order, exact values, string interpolation.
    expect(heraldOffers.map((offer) => offer.id)).toEqual([
      'herald',
      'herald-pro',
      'herald-texting',
    ]);
    // Labels derive from the offer ids, in data order.
    const labelOrder = ['<dt>Herald</dt>', '<dt>Herald Pro</dt>', '<dt>Herald Texting</dt>'];
    let cursor = herald.indexOf('<h2>Herald</h2>');
    expect(cursor).toBeGreaterThanOrEqual(0);
    for (const label of labelOrder) {
      const at = herald.indexOf(label);
      expect(at, label).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(herald).toContain('$49.00 per month');
    expect(herald).toContain('$99.00 per month');
    expect(herald).toContain('$30.00 per month');
    expect(herald).toContain('$39.00 setup');
    expect(occurrences(herald, 'per month')).toBe(3);
    const valueOrder = ['$49.00', '$99.00', '$30.00'];
    cursor = 0;
    for (const value of valueOrder) {
      const at = herald.indexOf(value);
      expect(at, value).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(herald).toMatch(/<a href="\/support"[^>]*>Contact<\/a>/);
    // No Builds plan is substituted into Herald's page.
    for (const price of ['$23.99', '$50.99', '$69.99', '$14.40', '$39.60']) {
      expect(herald, price).not.toContain(price);
    }
    expect(herald).not.toMatch(/<button[^>]*>Continue<\/button>/);

    const regent = renderRoute('/regent');
    expect((regent.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(regent).toContain('Guided setup only');
    expect(regent).toContain('Synthetic prototype');
    expect(regent).toContain('No live agency data is shown.');
    expect(regent).toMatch(/<a href="\/support"[^>]*>Request setup<\/a>/);
    expect(regent).toContain('Plan my setup');
    expect(regent).toContain('See the desk');
    const regentProduct = products.find((product) => product.id === 'regent');
    expect(regent).toContain(regentProduct?.availability.reason);
    // No price, no cart and no compliance-success claim.
    expect(regent).not.toMatch(/\$\d/);
    expect(regent).not.toMatch(/add to cart|\bcart\b|self-serve checkout|checkout now/i);
    expect(regent).not.toMatch(/compliance (success|passed|complete|certified)/i);
    expect(regent).not.toMatch(/<button[^>]*>Continue<\/button>/);
  });

  it('empty release input renders every product and platform without links', () => {
    // Real App first: the static /get shelf carries the Android truth exactly
    // once and no artifact or store link of any kind.
    const appHtml = renderRoute('/get');
    expect(
      occurrences(appHtml, 'Android purchase is not available; use the web alternative.'),
    ).toBe(1);
    // No artifact or store href anywhere in the owned region (the head's
    // canonical link is not an action).
    expect(mainRegion(appHtml)).not.toMatch(/href="https?:\/\//);
    expect(appHtml).not.toMatch(/play\.google\.com|apps\.apple\.com/);
    expect((appHtml.match(/<h1[\s>]/g) ?? []).length).toBe(1);

    const { GetPage } = requireScreens();
    const html = render(<GetPage />);
    for (const product of products) {
      const section = sectionOf(html, product.publicName);
      for (const platform of platforms) {
        expect(section, `${product.publicName}/${platform}`).toContain(`>${platform}<`);
      }
      expect(section, product.publicName).toContain(product.availability.label);
      expect(section, product.publicName).toContain(product.availability.reason);
    }
    expect(occurrences(html, 'Android purchase is not available; use the web alternative.')).toBe(1);
    // Zero hrefs: no download link, no store link, no badge, no waitlist form.
    expect(html).not.toContain('href="');
    expect(html).not.toMatch(/<img|play\.google\.com|apps\.apple\.com|badge/i);
    expect(html).not.toMatch(/<form|<input/i);
    expect(occurrences(html, 'Joining is not open yet.')).toBeGreaterThanOrEqual(1);
    expect(html).toContain('unavailable');

    // Unknown device with matching-but-unavailable releases: every platform
    // stays visible and the device sentence replaces any selected platform.
    const allUnavailable: readonly Release[] = products.map((product) =>
      releaseRow(product.id, 'windows', { availability: 'unavailable' }),
    );
    const unknown = render(<GetPage releases={allUnavailable} hints={unknownHints} />);
    expect(unknown).toContain('We could not identify your device; no platform is selected.');
    for (const product of products) {
      const section = sectionOf(unknown, product.publicName);
      for (const platform of platforms) {
        expect(section, `${product.publicName}/${platform}`).toContain(`>${platform}<`);
      }
    }
    expect(unknown).not.toContain('href="');
    expect(unknown).not.toContain('data-primary="true"');
  });

  it('known OS features only a real downloadable or store row', () => {
    const { GetPage } = requireScreens();
    const html = render(<GetPage releases={buildsReleases} hints={{ userAgent: WINDOWS_UA }} />);
    const builds = sectionOf(html, 'Builds');
    // The current device's row comes first and is the only primary row.
    expect(builds.indexOf('>windows<')).toBeLessThan(builds.indexOf('>macos<'));
    const primary = primaryContainer(html);
    expect(primary).toContain('Current device');
    expect(primary).toContain(`href="${ARTIFACT.windows}"`);
    expect(primary).toMatch(/<a href="[^"]*"[^>]*>Download<\/a>/);
    // Every other platform of the shelf stays visible.
    for (const platform of ['windows', 'macos', 'linux', 'web', 'cli', 'ios', 'android']) {
      expect(builds, platform).toContain(`>${platform}<`);
    }
    expect(html).toContain('Current device');
    // Store rows expose only their own validated store URL, labelled Open store.
    expect(html).toContain(`href="${STORE.ios}"`);
    expect(html).toContain(`href="${STORE.android}"`);
    expect(occurrences(html, '>Open store</a>')).toBe(2);
    // The pulled CLI row keeps its artifact URL out of the page entirely.
    expect(html).not.toContain(ARTIFACT.cli);
    // Named reasons of the non-featured rows are visible in words.
    expect(builds).toContain('marked-unavailable');
    // An unknown OS renders every row with no featured (primary) row at all.
    const unknown = render(<GetPage releases={buildsReleases} hints={unknownHints} />);
    expect(unknown).not.toContain('data-primary="true"');
    expect(unknown).not.toContain('Current device');
    expect(unknown).toContain('We could not identify your device; no platform is selected.');
    const unknownBuilds = sectionOf(unknown, 'Builds');
    for (const platform of ['windows', 'macos', 'linux', 'web', 'cli', 'ios', 'android']) {
      expect(unknownBuilds, platform).toContain(`>${platform}<`);
    }
    expect(unknownBuilds).toContain(`href="${ARTIFACT.windows}"`);
    expect(resolveReleases('builds', buildsReleases, unknownHints)).toMatchObject({
      ok: true,
      detection: 'unknown',
      featured: null,
      featuredReason: 'device-unknown',
    });
  });

  it('unsafe unavailable superseded and incomplete releases never gain links', () => {
    const { GetPage } = requireScreens();
    const cases: readonly (readonly [string, Release, string])[] = [
      ['owner pulled', releaseRow('builds', 'windows', { availability: 'unavailable' }), 'marked-unavailable'],
      ['superseded', releaseRow('builds', 'windows', { supersededBy: '1.5.0' }), 'superseded'],
      ['signer missing', releaseRow('builds', 'windows', { artifactUrl: ARTIFACT.windows, signer: null }), 'signer-missing'],
      ['incomplete artifact', releaseRow('builds', 'windows', { artifactUrl: ARTIFACT.windows, sha256: null }), 'incomplete-artifact'],
      ['insecure artifact', releaseRow('builds', 'windows', { artifactUrl: 'http://releases.example.com/x.zip' }), 'insecure-artifact'],
      ['notarization incomplete', releaseRow('builds', 'macos', { artifactUrl: ARTIFACT.macos, notarization: 'required' }), 'notarization-incomplete'],
      ['no artifact', releaseRow('builds', 'windows'), 'no-artifact'],
      ['waitlist', releaseRow('builds', 'windows', { availability: 'waitlist' }), 'waitlist'],
    ];
    for (const [name, release, reason] of cases) {
      const html = render(<GetPage releases={[release]} hints={{ userAgent: WINDOWS_UA }} />);
      const builds = sectionOf(html, 'Builds');
      expect(builds, name).toContain(reason);
      expect(builds, name).not.toMatch(/href="https?:\/\//);
      expect(builds, name).not.toContain('Open store');
      expect(builds, name).not.toContain('data-primary="true"');
      expect(html, name).not.toMatch(/<img|badge/i);
    }
    // The waitlist row says joining is closed and offers no form.
    const waitlist = render(
      <GetPage
        releases={[releaseRow('builds', 'windows', { availability: 'waitlist' })]}
        hints={{ userAgent: WINDOWS_UA }}
      />,
    );
    expect(waitlist).toContain('Joining is not open yet.');
    expect(waitlist).not.toMatch(/<form|<input/i);
  });

  it('android disclosure appears once without an android row', () => {
    const { GetPage } = requireScreens();
    // One complete Windows release per product and no Android release: the
    // known device keeps every resolver result ok, so no shelf has an Android
    // row and the disclosure must still read once, in the first section.
    const windowsOnly = products.map((product) =>
      releaseRow(product.id, 'windows', { artifactUrl: ARTIFACT.windows }),
    );
    const hints: DeviceHints = { userAgent: WINDOWS_UA };
    for (const product of products) {
      expect(resolveReleases(product.id, windowsOnly, hints).ok, product.id).toBe(true);
    }
    const html = render(<GetPage releases={windowsOnly} hints={hints} />);
    expect(html).not.toContain('>android<');
    expect(
      occurrences(html, 'Android purchase is not available; use the web alternative.'),
    ).toBe(1);
    // The ordinary Android-row shelf and the no-release fallback shelf each
    // keep their single note — never twice.
    const withAndroid = render(<GetPage releases={buildsReleases} hints={hints} />);
    expect(
      occurrences(withAndroid, 'Android purchase is not available; use the web alternative.'),
    ).toBe(1);
    const noReleases = render(<GetPage />);
    expect(
      occurrences(noReleases, 'Android purchase is not available; use the web alternative.'),
    ).toBe(1);
  });

  it('owned static screens are substantive and fail closed', () => {
    // The two real-App assertions the brief pins for the red run first: the
    // approved plan facts on /plans and the Android truth on /get.
    const plans = renderRoute('/plans');
    expect(plans).toContain('Shell Plus');
    expect(plans).toContain('$50.99');
    expect(plans).not.toContain('Catalog mismatch; purchase is blocked.');
    const get = renderRoute('/get');
    expect(get).toContain('Android purchase is not available; use the web alternative.');

    const paths = ['/plans', '/get', '/herald', '/regent'];
    for (const path of paths) {
      const html = renderRoute(path);
      const text = visibleText(html);
      expect((html.match(/<h1[\s>]/g) ?? []).length, `${path}: one h1`).toBe(1);
      expect(html, path).not.toMatch(/<script|<img|<video|<iframe|<audio|<source/i);
      expect(html, path).not.toContain('undefined');
      expect(html, path).not.toContain('NaN');
      expect(text.length, `${path}: meaningful text`).toBeGreaterThan(300);
      expect(text, path).not.toMatch(/testimonial/i);
      expect(text, path).not.toMatch(/\b\d[\d,]*\s+(downloads|users|installs|customers|reviews)\b/i);
      expect(text, path).not.toMatch(
        /(installed|payment|purchase|checkout)\s+(successfully|succeeded|successful|complete|completed|confirmed)/i,
      );
      expect(text, path).not.toMatch(/you (have|now) (installed|paid|purchased)/i);
    }
    // Structural-only styling: no motion, no design tokens, no fixed width.
    expect(plansGetSource).not.toMatch(/animation|transition/i);
    expect(plansGetSource).not.toMatch(
      /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|\bcolor\s*:|font-family|font-size/i,
    );
    expect(plansGetSource).not.toMatch(/(?:^|[^A-Za-z])width\s*[:=]/i);
    for (const match of plansGetSource.matchAll(/maxWidth\s*:\s*([^,}]+)/g)) {
      expect(match[1].trim(), 'maxWidth is only the 100% wrap').toBe("'100%'");
    }
    // Every action keeps the kit's 44 px minima on every owned screen.
    const { GetPage: GetShelf, PlansPage: Plans } = requireScreens();
    const screensHtml = [
      render(<Plans />),
      render(<GetShelf releases={buildsReleases} hints={{ userAgent: WINDOWS_UA }} />),
      renderRoute('/herald'),
      renderRoute('/regent'),
    ];
    for (const html of screensHtml) {
      const styles = [...html.matchAll(/<(?:a|button) [^>]*style="([^"]*)"/g)].map(
        (match) => match[1],
      );
      expect(styles.length).toBeGreaterThan(0);
      for (const style of styles) {
        expect(style, style).toContain('min-height:44px');
        expect(style, style).toContain('min-width:44px');
      }
    }
  });

  // --------------------------------------- W1-05-r1 review fixes (F16-F22) ----

  it('an unparseable or missing generatedAt blocks instead of throwing (F16)', async () => {
    const { PlansPage } = requireScreens();
    const view = await viewOf();
    // The parser admits only RFC3339 timestamps, so these views model a
    // corrupted or absent field reaching the page: the page must state the
    // mismatch instead of calling toISOString() on an invalid date (RangeError
    // would take the whole route down) and must not render a raw timestamp.
    const broken: readonly (readonly [string, CatalogView])[] = [
      ['unparseable timestamp', { ...view, generatedAt: Number.NaN }],
      ['missing timestamp', { ...view, generatedAt: undefined as unknown as number }],
    ];
    for (const [name, catalog] of broken) {
      expect(() => render(<PlansPage catalog={catalog} />), name).not.toThrow();
      const html = render(<PlansPage catalog={catalog} />);
      expect(html, name).toContain('Catalog mismatch; purchase is blocked.');
      expect(html, name).not.toContain('data-primary="true"');
      expect(html, name).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(html, name).not.toContain('generatedAt');
    }
    // A finite timestamp is still attributed: the guard rejects only doubt.
    const ok = render(<PlansPage catalog={view} />);
    expect(ok).not.toContain('Catalog mismatch; purchase is blocked.');
    expect(ok).toContain(new Date(GENERATED_AT).toISOString());
  });

  it('catalog absence closes only checkout claims and keeps local facts (F18)', async () => {
    const { PlansPage } = requireScreens();
    const NIC = 'Not included in checkout yet';
    const matrix = tableMatrix(render(<PlansPage catalog={await viewOf()} />));
    // Verifier is the pinned case: the catalog never mentions it, so its three
    // checkout claims fall closed while 'Included locally' — a local fact, not
    // a purchase — keeps the approved words.
    expect(matrix[1]).toEqual(['Verifier', 'Included locally', NIC, NIC, NIC]);
    // The same rule applies to every absent entry: unclaimed words stay,
    // claimed cells close.
    expect(matrix[3]).toEqual(['Zeus', 'Not included', 'Not included', NIC, NIC]);
    expect(matrix[4]).toEqual(['Forge MCP', 'Not included', NIC, NIC, NIC]);
    expect(matrix[6]).toEqual(['hosted models', 'Local only', NIC, NIC, NIC]);
  });

  it('Allowed is a checkout claim the catalog cannot withhold (F19)', async () => {
    const { PlansPage } = requireScreens();
    const NIC = 'Not included in checkout yet';
    // A catalog that withholds the capability cannot let the approved table
    // keep reading 'Allowed' for the paid plans.
    const denied = await viewOf(wireCatalog({
      capabilities: [
        {
          product: 'builds',
          capability: 'openrouter-key',
          plans: ['shell', 'shell-plus', 'space'],
          state: 'not-included',
        },
      ],
    }));
    expect(tableMatrix(render(<PlansPage catalog={denied} />))[5]).toEqual([
      'customer OpenRouter key', 'Not included', NIC, NIC, NIC,
    ]);
    // A catalog that explicitly includes it keeps the permitted wording.
    const included = await viewOf(wireCatalog({
      capabilities: [
        {
          product: 'builds',
          capability: 'openrouter-key',
          plans: ['shell', 'shell-plus', 'space'],
          state: 'included',
        },
      ],
    }));
    expect(tableMatrix(render(<PlansPage catalog={included} />))[5]).toEqual([
      'customer OpenRouter key', 'Not included', 'Allowed', 'Allowed', 'Allowed',
    ]);
  });

  it('non-USD or unapproved-region catalogs do not match (F20)', async () => {
    const { PlansPage } = requireScreens();
    const view = await viewOf();
    // The parser only admits USD / US (src/clients/money/schema.ts), so these
    // views model the fields the review found unguarded: a page printing $ is
    // never blessed by a catalog whose money or region it cannot vouch for.
    const cases: readonly (readonly [string, CatalogView])[] = [
      ['non-USD currency', { ...view, currency: 'EUR' } as unknown as CatalogView],
      ['unapproved region', { ...view, region: 'CA' } as unknown as CatalogView],
    ];
    for (const [name, catalog] of cases) {
      const html = render(<PlansPage catalog={catalog} />);
      expect(html, name).toContain('Catalog mismatch; purchase is blocked.');
      expect(html, name).not.toContain('data-primary="true"');
      expect(html, name).not.toContain(CATALOG_VERSION);
      expect(html, name).not.toContain(new Date(GENERATED_AT).toISOString());
    }
  });

  it('defensive branches render their fail-closed wording (F21)', () => {
    const { PlanList, CapabilityTable, GetPage } = requireScreens();
    const NIC = 'Not included in checkout yet';

    // 1. No add-on row: the four approved plans still render, no orphan line
    //    and no empty list item.
    const noTopUp = render(<PlanList plans={approvedPlanRows} topUp={undefined} />);
    expect((noTopUp.match(/<h3>/g) ?? [])).toHaveLength(4);
    expect(noTopUp).not.toContain('Top-up');
    expect(noTopUp).not.toContain('undefined');

    // 2. A short capability row: the positional fallback fills every missing
    //    plan column with the fail-closed cell, never undefined.
    const short = render(<CapabilityTable catalog={null} rows={[['Verifier', 'verifier']]} />);
    const matrix = tableMatrix(short);
    expect(matrix).toHaveLength(2);
    expect(matrix[1]).toEqual(['Verifier', NIC, NIC, NIC, NIC]);
    expect(short).not.toContain('undefined');

    // 3. Every release unavailable and the device unknown: the device
    //    sentence renders and no platform is featured.
    const allUnavailable: readonly Release[] = products.map((product) =>
      releaseRow(product.id, 'windows', { availability: 'unavailable' }),
    );
    const unknown = render(<GetPage releases={allUnavailable} hints={unknownHints} />);
    expect(
      occurrences(unknown, 'We could not identify your device; no platform is selected.'),
    ).toBe(1);
    expect(unknown).not.toContain('data-primary="true"');
  });

  it('planCopyFor has no top-up arm and plans never include the add-on (F22)', () => {
    const { PlansPage } = requireScreens();
    // Grep proof: the copy resolver's own definition carries no 'top-up'
    // branch, because the plans-only filter is the invariant.
    const definition = plansGetSource
      .split('\n')
      .find((line) => line.includes('const planCopyFor'));
    expect(definition).toBeDefined();
    expect(definition).not.toContain("'top-up'");
    // The filter's output never contains the add-on id, so the narrowed type
    // is not papering over a live path.
    expect(approvedPlanRows.map((plan) => plan.id)).not.toContain('top-up');
    const html = render(<PlansPage />);
    expect((html.match(/<h3>/g) ?? [])).toHaveLength(4);
    const topUp = approvedPriceList.find((row) => row.kind === 'add-on');
    if (topUp === undefined) throw new Error('the approved add-on row is missing');
    expect(html).toContain(`${topUp.label}: $${topUp.monthly} adds $${topUp.includedCredit}; plan required`);
    for (const copy of Object.values(planCopy)) {
      expect(html).toContain(copy);
    }
  });
});
