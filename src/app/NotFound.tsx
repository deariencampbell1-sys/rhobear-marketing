// W0-01/W1-01: the 404 page and fail-closed shared-link recovery (A03).
// Plain apology, the canonical destination links, the shared OfflinePanel and
// — when a shared link was classified — either one exact recovery label or a
// plain link to the already-verified destination. No client-side redirect, no
// old routes, no stored-provider flow: the classifier below is pure, marks
// nothing consumed, and the requested URL is never reflected into the DOM.
import { RouteSkeleton } from './RouteSkeleton';
import { findRoute, productPaths, routes } from './routes';
import { OfflinePanel } from '../routes';
import {
  isCanonicalReturnRoute,
  isIntentPlan,
  isIntentProduct,
  isKnownScenario,
  parseIntent,
} from '../clients/intent/schema';

/**
 * What a shared link resolves to, fail-closed. A `destination` is a canonical
 * path already validated by the real intent/product/scenario/plan guards; a
 * `recovery` is the refusal case with its one named reason. There is no third
 * shape: nothing here can carry a raw input string.
 */
export type SharedLinkResult =
  | { kind: 'destination'; path: string; reason: 'valid-intent' | 'product' | 'scenario' | 'plan' }
  | { kind: 'recovery'; reason: 'unknown-product' | 'malformed-intent' | 'expired-intent' };

/**
 * Classify a shared link from its query pieces. Pure and total: every input
 * is `unknown` and every refusal is a named recovery reason — malformed or
 * unknown values never fall back to home and are never reflected anywhere.
 * Precedence is fixed (intent → product → scenario → plan):
 *
 *   1. `intent` present: `parseIntent` is the only judge. Any refusal is
 *      `malformed-intent`; an instant at or past `expiresAt` is
 *      `expired-intent`; otherwise the already validated `returnRoute` is the
 *      `valid-intent` destination. The record is never marked consumed and
 *      nothing here redirects.
 *   2. `product` present: `isIntentProduct` or `unknown-product`; a valid
 *      product (including `engines`) maps to `/${product}`.
 *   3. `scenario` present: `isKnownScenario` or `malformed-intent`; a known
 *      scenario maps to the currently canonical `/engines` (W1-02 owns the
 *      scenario pages).
 *   4. `plan` present: `isIntentPlan` or `malformed-intent`; a valid plan maps
 *      to `/plans`.
 *   5. Anything else is `malformed-intent`.
 */
export function classifySharedLink(
  input: {
    intent?: unknown;
    product?: unknown;
    plan?: unknown;
    scenario?: unknown;
  },
  now: number,
): SharedLinkResult {
  const { intent, product, plan, scenario } = input;

  if (intent !== undefined) {
    const parsed = parseIntent(intent);
    if (!parsed.ok) return { kind: 'recovery', reason: 'malformed-intent' };
    const record = parsed.intent;
    if (Date.parse(record.expiresAt) <= now) return { kind: 'recovery', reason: 'expired-intent' };
    // parseIntent already validated the route; the canonical guard is the
    // one rule, enforced again at the boundary so this function alone says
    // what leaves it.
    if (!isCanonicalReturnRoute(record.returnRoute)) {
      return { kind: 'recovery', reason: 'malformed-intent' };
    }
    return { kind: 'destination', path: record.returnRoute, reason: 'valid-intent' };
  }

  if (product !== undefined) {
    if (!isIntentProduct(product)) return { kind: 'recovery', reason: 'unknown-product' };
    return { kind: 'destination', path: `/${product}`, reason: 'product' };
  }

  if (scenario !== undefined) {
    if (!isKnownScenario(scenario)) return { kind: 'recovery', reason: 'malformed-intent' };
    return { kind: 'destination', path: '/engines', reason: 'scenario' };
  }

  if (plan !== undefined) {
    if (!isIntentPlan(plan)) return { kind: 'recovery', reason: 'malformed-intent' };
    return { kind: 'destination', path: '/plans', reason: 'plan' };
  }

  return { kind: 'recovery', reason: 'malformed-intent' };
}

// Route labels for links — never the requested URL, never an arbitrary path.
const linkLabel: Record<string, string> = Object.fromEntries(routes.map((r) => [r.path, r.title]));

const recoveryLabels = {
  'unknown-product': 'This product is not recognised.',
  'malformed-intent': 'This shared link is malformed or unsupported.',
  'expired-intent': 'This shared link has expired.',
} as const;

/** The classified shared link, as one exact label or one ordinary link. */
function RecoveryNote({ recovery }: { recovery: SharedLinkResult }) {
  if (recovery.kind === 'destination') {
    // F6: an anchor exists only for a route-table destination, and its label
    // is that route's own title — never a fallback, never the requested path.
    // An unmapped destination renders the note with no anchor at all.
    const route = findRoute(recovery.path);
    if (!route) return <p>Continue to the verified destination</p>;
    return (
      <p>
        Continue to the verified destination <a href={route.path}>{route.title}</a>
      </p>
    );
  }
  return <p>{recoveryLabels[recovery.reason]}</p>;
}

export function NotFound({ recovery }: { recovery?: SharedLinkResult }) {
  return (
    <RouteSkeleton title="Page not found">
      <p>
        Sorry, there is no page at this address. The links below go to the pages
        that exist today.
      </p>
      {recovery ? <RecoveryNote recovery={recovery} /> : null}
      <ul>
        <li>
          <a href="/">Home</a>
        </li>
        {productPaths.map((path) => (
          <li key={path}>
            <a href={path}>{linkLabel[path]}</a>
          </li>
        ))}
        <li>
          <a href="/engines">Engines</a>
        </li>
        <li>
          <a href="/plans">Plans and prices</a>
        </li>
        <li>
          <a href="/support">Support</a>
        </li>
      </ul>
      <OfflinePanel />
    </RouteSkeleton>
  );
}
