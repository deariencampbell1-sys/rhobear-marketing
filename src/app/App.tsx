// W0-01: route switch — the only place routes are composed. Given a path it
// renders the matching screen inside the shared skeleton, or NotFound.
import { findRoute, notFoundRoute, type Route } from './routes';
import { RouteSkeleton } from './RouteSkeleton';
import { NotFound } from './NotFound';
import { PlaceholderPage } from '../routes';

export function App({ path }: { path: string }) {
  const route: Route | undefined = findRoute(path);
  if (!route) return <NotFound />;
  return (
    <RouteSkeleton title={route.title}>
      <PlaceholderPage route={route} />
    </RouteSkeleton>
  );
}

export { NotFound, notFoundRoute };