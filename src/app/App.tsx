// W0-01: route switch — the only place routes are composed. Given a path it
// renders the matching screen inside the shared skeleton, or NotFound.
// W1-02: the Engines destination and the registry scenario shells compose
// here before the placeholder fallback; nothing else changes.
// W1-03: /plans, /get and the Herald and Regent commercial sections compose here too.
import { findRoute, type Route } from './routes';
import { RouteSkeleton } from './RouteSkeleton';
import { NotFound } from './NotFound';
import { PlaceholderPage } from '../routes';
import { EnginesPage, ScenarioPage } from '../routes/engines';
import { GetPage, HeraldCommercial, PlansPage, RegentCommercial } from '../routes/plans-get';

export function App({ path }: { path: string }) {
  const route: Route | undefined = findRoute(path);
  if (!route) return <NotFound />;
  if (route.path === '/engines') {
    return <RouteSkeleton title={route.title}><EnginesPage /></RouteSkeleton>;
  }
  if (route.path.startsWith('/engines/')) {
    return (
      <RouteSkeleton title={route.title}>
        <ScenarioPage scenarioId={route.path.slice('/engines/'.length)} />
      </RouteSkeleton>
    );
  }
  if (route.path === '/plans') return <RouteSkeleton title={route.title}><PlansPage /></RouteSkeleton>;
  if (route.path === '/get') return <RouteSkeleton title={route.title}><GetPage /></RouteSkeleton>;
  if (route.path === '/herald') return <RouteSkeleton title={route.title}><PlaceholderPage route={route} /><HeraldCommercial /></RouteSkeleton>;
  if (route.path === '/regent') return <RouteSkeleton title={route.title}><PlaceholderPage route={route} /><RegentCommercial /></RouteSkeleton>;
  return (
    <RouteSkeleton title={route.title}>
      <PlaceholderPage route={route} />
    </RouteSkeleton>
  );
}