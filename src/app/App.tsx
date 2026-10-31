// W0-01: route switch — the only place routes are composed. Given a path it
// renders the matching screen inside the shared skeleton, or NotFound.
// W1-02: the Engines destination and the registry scenario shells compose
// here before the placeholder fallback; nothing else changes.
// W1-03: /plans, /get and the Herald and Regent commercial sections compose here too.
import { findRoute, type Route } from './routes';
import { RouteSkeleton } from './RouteSkeleton';
import { NotFound } from './NotFound';
import { Footer } from './Footer';
import { PlaceholderPage } from '../routes';
import { EnginesPage, ScenarioPage } from '../routes/engines';
import { LegalSupportPage } from '../routes/legal-support';
import { GetPage, HeraldCommercial, PlansPage, RegentCommercial } from '../routes/plans-get';

export function App({ path }: { path: string }) {
  const route: Route | undefined = findRoute(path);
  let page: JSX.Element;
  if (!route) page = <NotFound />;
  else if (route.path === '/engines') {
    page = <RouteSkeleton title={route.title}><EnginesPage /></RouteSkeleton>;
  } else if (route.path.startsWith('/engines/')) {
    page = (
      <RouteSkeleton title={route.title}>
        <ScenarioPage scenarioId={route.path.slice('/engines/'.length)} />
      </RouteSkeleton>
    );
  } else if (route.path === '/plans') {
    page = <RouteSkeleton title={route.title}><PlansPage /></RouteSkeleton>;
  } else if (route.path === '/get') {
    page = <RouteSkeleton title={route.title}><GetPage /></RouteSkeleton>;
  } else if (route.path === '/herald') {
    page = <RouteSkeleton title={route.title}><PlaceholderPage route={route} /><HeraldCommercial /></RouteSkeleton>;
  } else if (route.path === '/regent') {
    page = <RouteSkeleton title={route.title}><PlaceholderPage route={route} /><RegentCommercial /></RouteSkeleton>;
  } else if (route.path === '/privacy' || route.path === '/terms' || route.path === '/support') {
    page = <RouteSkeleton title={route.title}><LegalSupportPage path={route.path} /></RouteSkeleton>;
  } else {
    page = (
      <RouteSkeleton title={route.title}>
        <PlaceholderPage route={route} />
      </RouteSkeleton>
    );
  }
  return <>{page}<Footer /></>;
}