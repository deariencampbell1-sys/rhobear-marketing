// W1-01: the route-aware static screens — home (A01/A02/A04/A06/E01) and the
// five product pages (U01–U05) — plus the shared OfflinePanel. Copy comes
// from approved facts in src/data/brand, src/data/products and
// src/data/engines, plus the labels the W1-01 brief pins; nothing here is
// invented. The content entry point is deliberately not used here — the
// content-boundary test keeps it inside the data layer.
//
// The PlaceholderPage API is unchanged so App.tsx is untouched: it switches
// only on '/', '/builds', '/forge', '/herald', '/regent' and '/reviews', and
// every other route keeps the original placeholder verbatim. RouteSkeleton
// stays the only page frame (via App) — no second page title and no second
// <h1> anywhere below. All content is static server-rendered HTML: no script,
// no network, no client state on these screens.
import type { CSSProperties, ReactNode } from 'react';
import type { Route } from '../app/routes';
import { brand } from '../data/brand';
import { productById, products, type ProductEntry } from '../data/products';
import { enginesDestination } from '../data/engines';
import { Button, InfoList, InfoRow } from '../kit';

// Structural layout only: wrapping flex for action rows and page padding.
// No visual system is added here — no fixed page-width container, no colour,
// font or motion values.
const pagePadding: CSSProperties = { paddingInline: '16px', paddingBlock: '24px' };
const actionRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px' };

/**
 * The page's main action container. `data-primary="true"` marks it for the
 * acceptance check; the kit Button guarantees the 44 px minimum dimensions
 * and the visible kit focus on every link inside it.
 */
function MainActions({ children }: { children: ReactNode }) {
  return (
    <div data-primary="true" style={actionRow}>
      {children}
    </div>
  );
}

/**
 * The shared offline shell copy (A01's offline state): static, truthful and
 * not network detection. It exposes navigation and infers nothing — never a
 * balance, subscription, installation, payment or job outcome.
 */
export function OfflinePanel() {
  return (
    <section style={pagePadding}>
      <h2>Offline</h2>
      <p>
        You can still use these page links. Cached information may be stale;
        nothing here infers your balance, subscription, installation, payment,
        or job success.
      </p>
      <ul>
        <li>
          <a href="/">Home</a>
        </li>
        {products.map((product) => (
          <li key={product.id}>
            <a href={`/${product.id}`}>{product.publicName}</a>
          </li>
        ))}
        <li>
          <a href="/engines">Engines</a>
        </li>
        <li>
          <a href="/support">Support</a>
        </li>
      </ul>
    </section>
  );
}

/** The proof state every screen shows until an approved recording exists. */
function ProofBlock() {
  return (
    <section style={pagePadding}>
      <h2>Proof</h2>
      <p>Recording in review</p>
    </section>
  );
}

/** Home A01: the hero — brand facts and the two first actions. */
function Hero() {
  return (
    <section style={pagePadding}>
      <h2>One front door for the family</h2>
      <p>{brand.tagline}</p>
      <p>{brand.taglineExplanation}</p>
      <p>{brand.familyLine}</p>
      <MainActions>
        <Button as="a" href="#family-index">
          Explore products
        </Button>
        <Button as="a" href="/engines" variant="secondary">
          Watch real work
        </Button>
      </MainActions>
    </section>
  );
}

/**
 * Home A02: the family index — the five apps in `products` array order, then
 * Engines labelled as a Destination, never a sixth app. Names stay visible
 * text; there are no approved image assets, so nothing is faked.
 */
function FamilyIndex() {
  return (
    <section id="family-index" style={pagePadding}>
      <h2>Family index</h2>
      {products.map((product) => (
        <article key={product.id}>
          <h3>{product.publicName}</h3>
          <p>{product.oneLiner}</p>
          <InfoList>
            <InfoRow label="Availability" value={product.availability.label} />
          </InfoList>
          <p>
            <Button as="a" href={`/${product.id}`} variant="secondary">
              {product.publicName}
            </Button>
          </p>
        </article>
      ))}
      <article>
        <h3>{enginesDestination.publicName}</h3>
        <p>{enginesDestination.oneLiner}</p>
        <InfoList>
          <InfoRow label="Destination" value={enginesDestination.publicName} />
        </InfoList>
        <p>
          <Button as="a" href="/engines" variant="secondary">
            {enginesDestination.publicName}
          </Button>
        </p>
      </article>
    </section>
  );
}

/**
 * Home A04: store / repository / MCP arrival. A store, repository or MCP
 * arrival never implies installation or entitlement — the copy says so.
 */
function Arrival() {
  return (
    <section style={pagePadding}>
      <h2>Arrival</h2>
      <article>
        <h3>Arriving from the App Store</h3>
        <p>
          <Button as="a" href="/builds" variant="secondary">
            See Builds availability
          </Button>
        </p>
      </article>
      <article>
        <h3>Arriving from GitHub</h3>
        <p>
          <Button as="a" href="#family-index" variant="secondary">
            Explore the family
          </Button>
        </p>
      </article>
      <article>
        <h3>Arriving from an @ MCP</h3>
        <p>
          <Button as="a" href="/engines" variant="secondary">
            See Engines
          </Button>
        </p>
      </article>
      <p>
        A store, repository, or MCP arrival does not mean an app is installed
        or access is granted.
      </p>
    </section>
  );
}

/**
 * Home A06: the eligibility truth. No payment control appears here and the
 * visitor is never claimed to be eligible.
 */
function Eligibility() {
  return (
    <section style={pagePadding}>
      <h2>Eligibility</h2>
      <p>
        Eligibility is enforced at account and payment boundaries. Paid offers
        are US-only and 18+.
      </p>
      <p>
        Unknown region or age is not eligibility. An unsupported region or age
        must not be shown a payment control.
      </p>
      <p>
        <Button as="a" href="/terms" variant="secondary">
          Read terms
        </Button>{' '}
        <Button as="a" href="/support" variant="secondary">
          Ask support
        </Button>
      </p>
    </section>
  );
}

function HomePage() {
  return (
    <>
      <Hero />
      <FamilyIndex />
      <Arrival />
      <Eligibility />
      <ProofBlock />
      <OfflinePanel />
    </>
  );
}

/**
 * U01–U05's shared skeleton: oneLiner as the page's first h2, promise, the
 * whatItIs bullet list, the Availability / What that means rows and the proof
 * block. Product-specific sections and actions come below through `children`,
 * then the OfflinePanel. No price, checkout, testimonial, metric or
 * availability beyond the data.
 */
function ProductScreen({ product, children }: { product: ProductEntry; children: ReactNode }) {
  return (
    <>
      <section style={pagePadding}>
        <h2>{product.oneLiner}</h2>
        <p>{product.promise}</p>
        <ul>
          {product.whatItIs.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <InfoList>
          <InfoRow label="Availability" value={product.availability.label} />
          <InfoRow label="What that means" value={product.availability.reason} />
        </InfoList>
      </section>
      <ProofBlock />
      {children}
      <OfflinePanel />
    </>
  );
}

// U05: the review levels are the Reviews promise's own words — Verifier,
// Apollo and Zeus — never a new capability description.
const REVIEW_LEVELS = ['Verifier', 'Apollo', 'Zeus'] as const;

function ProductActions({ product }: { product: ProductEntry }) {
  switch (product.id) {
    case 'builds':
      return (
        <MainActions>
          <Button as="a" href="/engines">
            Watch Builds
          </Button>
          <Button as="a" href="/plans" variant="secondary">
            See plans
          </Button>
        </MainActions>
      );
    case 'forge':
      return (
        <>
          <MainActions>
            <Button as="a" href="/engines">
              Watch the making
            </Button>
            <Button as="a" href="/forge#kits" variant="secondary">
              Explore kits
            </Button>
          </MainActions>
          <section id="kits">
            <h2>Kits</h2>
            <InfoList>
              <InfoRow label="Availability" value={product.availability.label} />
              <InfoRow label="What that means" value={product.availability.reason} />
            </InfoList>
          </section>
        </>
      );
    case 'herald':
      return (
        <MainActions>
          <Button as="a" href="/plans">
            See Herald plans
          </Button>
          <Button as="a" href="/engines" variant="secondary">
            Watch the card
          </Button>
        </MainActions>
      );
    case 'regent':
      return (
        <>
          <MainActions>
            <Button as="a" href="/support">
              Plan my setup
            </Button>
            <Button as="a" href="/engines" variant="secondary">
              See the desk
            </Button>
          </MainActions>
          <section style={pagePadding}>
            <InfoList>
              <InfoRow label="Synthetic prototype" value="No live agency data is shown." />
            </InfoList>
          </section>
        </>
      );
    case 'reviews':
      return (
        <>
          <MainActions>
            <Button as="a" href="/reviews#levels">
              See review levels
            </Button>
            <Button as="a" href="https://reviews.rhobear.ai" variant="secondary">
              Open Reviews web
            </Button>
          </MainActions>
          <section id="levels">
            <h2>Review levels</h2>
            <ul>
              {REVIEW_LEVELS.map((level) => (
                <li key={level}>{level}</li>
              ))}
            </ul>
          </section>
        </>
      );
  }
}

export function PlaceholderPage({ route }: { route: Route }) {
  switch (route.path) {
    case '/':
      return <HomePage />;
    case '/builds':
    case '/forge':
    case '/herald':
    case '/regent':
    case '/reviews': {
      const product = productById(route.path.slice(1) as ProductEntry['id']);
      return (
        <ProductScreen product={product}>
          <ProductActions product={product} />
        </ProductScreen>
      );
    }
    default:
      return (
        <section>
          <p>
            This page is being built. Content, demos and availability appear here
            only when they are real.
          </p>
          {route.kind === 'dynamic' ? (
            <p>Sign in to see your account. Nothing about your account is shown until you do.</p>
          ) : null}
        </section>
      );
  }
}
