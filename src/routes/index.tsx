// W0-01: one PlaceholderPage used by every canonical route. Wave 1 replaces
// it with real screens. Copy is honest and generic: no invented claims,
// prices, availability, testimonials, counts or screenshots.
import type { Route } from '../app/routes';

export function PlaceholderPage({ route }: { route: Route }) {
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