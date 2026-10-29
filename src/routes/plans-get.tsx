// W1-03-r1: the commerce-facing static screens — Plans (P01/P02/P04), the
// Get shelf (T01/T03/G01) and the Herald and Regent commercial additions
// (P03). Facts come only from src/data (offers, legal, products) and the real
// release resolver: this file never fetches, never takes a payment and never
// computes money, so every price is the decimal string its own data row holds
// — no arithmetic, no rounding, no derived total. Structural styling only, as
// W1-01/W1-02: 16 px gutters, 24 px block spacing, wrapping rows, kit actions
// at their 44 px minima; no colour, font or motion values. Fail closed: a
// mismatched catalog states the reason with no action, an unconfirmed catalog
// capability fails to the fail-closed wording, and a release whose fields do
// not check out never gains a link. Server-rendered, no client state.
import type { CSSProperties } from 'react';
import type { CatalogView } from '../clients/money/catalog';
import { resolveReleases, type DeviceHints, type ReleaseRow } from '../clients/release/resolve';
import { platforms, type Release } from '../clients/release/schema';
import { checkoutState } from '../data/legal';
import {
  approvedPriceList,
  billingTerms,
  heraldOffers,
  launchOffer,
  planCopy,
  type HeraldOffer,
  type PriceRowId,
} from '../data/offers';
import { products, type ProductEntry } from '../data/products';
import { Button, InfoList, InfoRow } from '../kit';

// Structural layout only: page padding, wrapping action rows, a wrapping
// column for stacked content, and a 100% cap so long rows wrap instead of
// scrolling at 320 px. No visual system is added here.
const pagePadding: CSSProperties = { paddingInline: '16px', paddingBlock: '24px' };
const actionRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px' };
const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '100%' };
const fullWidth: CSSProperties = { maxWidth: '100%' };

// Verbatim strings from the W1-03 brief: a screen may not paraphrase them.
const BLOCKED = 'Catalog mismatch; purchase is blocked.';
const CHECKOUT_LINE = 'Prices are the approved list; the amount and tax are confirmed at checkout.';
const REVIEWS_NOTE = 'Standalone Reviews plans are separate and are published when their cost tests pass.';
const FREE_LOCAL = 'Free is local only: pocket models, the harness and Verifier on your own machine. No hosted credit, engine usage, or trial is included.';
const GET_LOCAL = 'Get the local app';
const ANDROID_NOTE = 'Android purchase is not available; use the web alternative.';
const DEVICE_UNKNOWN = 'We could not identify your device; no platform is selected.';
const JOINING = 'Joining is not open yet.';
const NOT_IN_CHECKOUT = 'Not included in checkout yet';

// P02: only rows whose kind is 'plan' are plans — the top-up add-on renders as
// its own line and can never become a fifth plan.
const approvedPlans = approvedPriceList.filter((row) => row.kind === 'plan');
const topUpRow = approvedPriceList.find((row) => row.kind === 'add-on');
const planCopyFor = (id: PriceRowId): string => (id === 'top-up' ? '' : planCopy[id]);

/**
 * P02/P04's one sell gate: a catalog is attributable and actionable only when
 * it is fresh, sellable, and its plan rows still carry exactly the approved
 * prices and credits. Any doubt fails closed — the approved facts stay, the
 * mismatch is stated, and no Continue is rendered at all.
 */
function catalogMatches(catalog: CatalogView): boolean {
  if (catalog.stale || !catalog.purchasable || catalog.plans.length !== approvedPlans.length) return false;
  return approvedPlans.every((plan) => {
    const row = catalog.plans.find((entry) => entry.sku === plan.id);
    return row !== undefined && row.monthlyPrice === plan.monthly &&
      row.creditIncluded === plan.includedCredit && row.availability === 'available';
  });
}

// P04: [label, catalog capability token, Free, Shell, Shell Plus, Space] in the
// approved price-list order. Labels are approved copy; tokens are the
// catalog's capability vocabulary for the Builds product.
type CapabilityRow = readonly [string, string, string, string, string, string];
const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  ['Verifier', 'verifier', 'Included locally', 'Included', 'Included', 'Included'],
  ['Apollo', 'apollo', 'Not included', 'Included', 'Included', 'Included'],
  ['Zeus', 'zeus', 'Not included', 'Not included', 'Included', 'Included'],
  ['Forge MCP', 'forge-mcp', 'Not included', 'Included', 'Included', 'Included'],
  ['customer OpenRouter key', 'openrouter-key', 'Not included', 'Allowed', 'Allowed', 'Allowed'],
  ['hosted models', 'hosted-models', 'Local only', 'Included by plan', 'Included by plan', 'Included by plan'],
  // The engine capability universe is client-owned payload, so this row never
  // gains a checkout claim — for every plan, not only the Free column.
  ['engine samples', 'engine-samples', NOT_IN_CHECKOUT, NOT_IN_CHECKOUT, NOT_IN_CHECKOUT, NOT_IN_CHECKOUT],
];

/**
 * The approved copy draws the table; the catalog may only confirm it. A
 * capability the catalog reports as 'unknown' fails its whole row closed, and
 * a claimed cell ('Included' / 'Included by plan') whose catalog state is
 * anything but 'included' fails closed too: the shipped matrix is never
 * printed as-is over a catalog that does not say so, and no unknown cell ever
 * becomes a claim. Rendered without a catalog, the approved copy stands.
 */
function capabilityRow(view: CatalogView | null, token: string, cells: readonly string[]): string[] {
  const entry = view === null ? undefined
    : view.capabilities.find((item) => item.product === 'builds' && item.capability === token);
  if (entry?.state === 'unknown') return cells.map(() => NOT_IN_CHECKOUT);
  const claimed = (cell: string): boolean => cell === 'Included' || cell === 'Included by plan';
  return cells.map((cell) => (claimed(cell) && entry !== undefined && entry.state !== 'included')
    ? NOT_IN_CHECKOUT : cell);
}

export interface PlansPageProps {
  /** The loaded catalog view, when the page is rendered with one; null otherwise. */
  catalog?: CatalogView | null;
}

/** P01/P02/P04: the plans page — approved prices, closed checkout, capabilities. */
export function PlansPage({ catalog = null }: PlansPageProps = {}): JSX.Element {
  const blocked = catalog !== null && !catalogMatches(catalog);
  const attributed = catalog !== null && !blocked;
  return (
    <>
      <section style={pagePadding}>
        <h2>Plans</h2>
        <p>{launchOffer.headline}</p>
        <p>{launchOffer.body}</p>
        <ul>
          {approvedPlans.map((plan) => (
            <li key={plan.id} style={stack}>
              <h3>{plan.label}</h3>
              <p>${plan.monthly} per month · ${plan.includedCredit} included credit · Renews {billingTerms.interval}</p>
              <p>{planCopyFor(plan.id)}</p>
              <p>{plan.notes}</p>
            </li>
          ))}
          {topUpRow === undefined ? null : (
            <li style={stack}>
              <p>{topUpRow.label}: ${topUpRow.monthly} adds ${topUpRow.includedCredit}; plan required</p>
            </li>
          )}
        </ul>
      </section>
      <section style={pagePadding}>
        <h2>Checkout</h2>
        <p>{CHECKOUT_LINE}</p>
        {blocked ? <p>{BLOCKED}</p> : null}
        {attributed ? (
          <InfoList>
            <InfoRow label="catalogVersion" value={catalog.catalogVersion} />
            <InfoRow label="generatedAt" value={new Date(catalog.generatedAt).toISOString()} />
          </InfoList>
        ) : null}
        {blocked ? null : (
          <div data-primary="true" style={stack}>
            <Button disabled>Continue</Button>
            <p>{checkoutState.reason}</p>
          </div>
        )}
      </section>
      <section style={pagePadding}>
        <h2>Included in each plan</h2>
        {/* overflow-wrap: anywhere keeps the five-column table inside the
            gutter at 200% text: cells break and stack their words instead of
            widening the page — no fixed sizing, no horizontal scroll. */}
        <div style={fullWidth}>
          <table style={{ ...fullWidth, overflowWrap: 'anywhere' }}>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {approvedPlans.map((plan) => <th key={plan.id} scope="col">{plan.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_ROWS.map(([label, token, ...cells]) => (
                <tr key={token}>
                  <th scope="row">{label}</th>
                  {capabilityRow(catalog, token, cells).map((cell, index) => (
                    <td key={approvedPlans[index].id}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section style={pagePadding}>
        <h2>Reviews and Free</h2>
        <p>{REVIEWS_NOTE}</p>
        <p>{FREE_LOCAL}</p>
        <div style={actionRow}>
          <Button as="a" href="/get" variant="secondary">{GET_LOCAL}</Button>
        </div>
      </section>
    </>
  );
}

type Shelf = { product: ProductEntry; result: ReturnType<typeof resolveReleases> };

/** One platform line of a resolved shelf: facts, named reason, then controls. */
function ReleaseLine({ row, primary, showAndroid }: {
  row: ReleaseRow; primary: boolean; showAndroid: boolean;
}): JSX.Element {
  return (
    <li data-primary={primary ? 'true' : undefined}>
      <span>{row.platform}</span> · <span>{row.state}</span> · {row.version}
      {row.reason === null ? null : <> · Reason: {row.reason}</>}
      {primary ? <> · Current device</> : null}
      {row.state === 'waitlist' ? <> · {JOINING}</> : null}
      {showAndroid ? <> {ANDROID_NOTE}</> : null}
      {row.state === 'store' && row.storeUrl !== null
        ? <Button as="a" href={row.storeUrl}>Open store</Button> : null}
      {row.state === 'downloadable' && row.artifactUrl !== null
        ? <Button as="a" href={row.artifactUrl}>Download</Button> : null}
    </li>
  );
}

export interface GetPageProps {
  /** The parsed manifest rows (callers with real rows); empty by default. */
  releases?: readonly Release[];
  /** Device detection hints; without them no platform is selected. */
  hints?: DeviceHints;
}

/** T01/T03/G01: every product and platform, with a link only where one is safe. */
export function GetPage({ releases = [], hints }: GetPageProps = {}): JSX.Element {
  const resolved = hints ?? { userAgent: null };
  const shelves: Shelf[] = products.map((product) => ({
    product,
    result: resolveReleases(product.id, releases, resolved),
  }));
  // The Android truth sits in the first section that shows an Android row
  // (every fallback section does), so it reads exactly once per page.
  const androidAt = shelves.findIndex((shelf) =>
    shelf.result.ok ? shelf.result.rows.some((row) => row.platform === 'android') : true);
  const deviceUnknown = shelves.some((shelf) =>
    (!shelf.result.ok && shelf.result.reason === 'device-unknown') ||
    (shelf.result.ok && shelf.result.featuredReason === 'device-unknown'));
  return (
    <>
      {deviceUnknown ? <p style={pagePadding}>{DEVICE_UNKNOWN}</p> : null}
      {shelves.map((shelf, index) => (
        <section key={shelf.product.id} style={pagePadding}>
          <h2>{shelf.product.publicName}</h2>
          <p>{shelf.product.availability.label} — {shelf.product.availability.reason}</p>
          {shelf.result.ok ? (
            <ul>
              {shelf.result.rows.map((row) => (
                <ReleaseLine key={row.platform} row={row}
                  primary={shelf.result.ok && shelf.result.featured === row}
                  showAndroid={index === androidAt && row.platform === 'android'} />
              ))}
            </ul>
          ) : (
            <ul>
              {platforms.map((platform) => (
                <li key={platform}>
                  <span>{platform}</span> · unavailable
                  {shelf.product.availability.state === 'waitlist' ? <> · {JOINING}</> : null}
                </li>
              ))}
            </ul>
          )}
          {index === androidAt && !shelf.result.ok ? <p>{ANDROID_NOTE}</p> : null}
        </section>
      ))}
    </>
  );
}

// P03: Herald's labels derive from its own offer ids; values interpolate the
// approved decimal strings only — never a total, never an arithmetic result.
const offerLabel = (offer: HeraldOffer): string =>
  offer.id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
const offerValue = (offer: HeraldOffer): string =>
  `$${offer.monthly} per month${offer.setup === null ? '' : ` plus $${offer.setup} setup`}`;

/** P03: Herald's own commercial facts — its three offers, and nothing else. */
export function HeraldCommercial(): JSX.Element {
  return (
    <section style={pagePadding}>
      <h2>Herald</h2>
      <InfoList>
        {heraldOffers.map((offer) => (
          <InfoRow key={offer.id} label={offerLabel(offer)} value={offerValue(offer)} />
        ))}
      </InfoList>
      <div style={actionRow}>
        <Button as="a" href="/support" variant="secondary">Contact</Button>
      </div>
    </section>
  );
}

/** P03: Regent's commercial section is guided setup — no price, no cart. */
export function RegentCommercial(): JSX.Element {
  return (
    <section style={pagePadding}>
      <h2>Guided setup only</h2>
      <InfoList>
        <InfoRow label="Synthetic prototype" value="No live agency data is shown." />
      </InfoList>
      <div style={actionRow}>
        <Button as="a" href="/support" variant="secondary">Request setup</Button>
      </div>
    </section>
  );
}
