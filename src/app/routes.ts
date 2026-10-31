// W0-01: the canonical route table. Single source of truth for App.tsx,
// prerender output and sitemap.xml. Wave 1 fills pages; paths never move.
// W1-02: the seven scenario routes derive from the engines registry below.

import { engineScenarios, scenarioRouteTitle } from '../data/engines';

export type RouteKind = 'static' | 'dynamic';

/** Canonical public origin used by canonical links, sitemap.xml and robots.txt. */
export const ORIGIN = 'https://rhobear.ai';

export interface Route {
  /** Canonical path, always starting with '/'. */
  path: string;
  /** Page title, used in <title> and the page's single <h1>. */
  title: string;
  /** 'dynamic' screens hydrate to read live account/money state. */
  kind: RouteKind;
  /** Grouping for navigation and the 404 page's link list. */
  group: 'product' | 'platform' | 'commerce' | 'about' | 'account' | 'home';
}

const baseRoutes: readonly Route[] = [
  { path: '/', title: 'Home', kind: 'static', group: 'home' },
  { path: '/builds', title: 'Builds', kind: 'static', group: 'product' },
  { path: '/forge', title: 'Forge', kind: 'static', group: 'product' },
  { path: '/herald', title: 'Herald', kind: 'static', group: 'product' },
  { path: '/regent', title: 'Regent', kind: 'static', group: 'product' },
  { path: '/reviews', title: 'Reviews', kind: 'static', group: 'product' },
  { path: '/engines', title: 'Engines', kind: 'static', group: 'platform' },
  { path: '/plans', title: 'Plans and prices', kind: 'static', group: 'commerce' },
  { path: '/get', title: 'Download', kind: 'static', group: 'commerce' },
  { path: '/account', title: 'Account', kind: 'dynamic', group: 'account' },
  { path: '/support', title: 'Support', kind: 'static', group: 'about' },
  { path: '/privacy', title: 'Privacy', kind: 'static', group: 'about' },
  { path: '/terms', title: 'Terms', kind: 'static', group: 'about' },
] as const;

/**
 * W1-02: one static route per registry scenario, derived from
 * `engineScenarios` — ids, order and titles come from the registry, never
 * from a hand-copied list. With the seven board scenarios this makes 20
 * canonical routes; `/account` stays the only dynamic one.
 */
const scenarioRoutes: readonly Route[] = engineScenarios.map((scenario) => ({
  path: `/engines/${scenario.scenarioId}`,
  title: scenarioRouteTitle(scenario.engineId),
  kind: 'static',
  group: 'platform',
}));

export const routes: readonly Route[] = [...baseRoutes, ...scenarioRoutes];

/** The not-found case: rendered for unknown paths, prerendered to dist/404.html. */
export const notFoundRoute: Route = {
  path: '/404',
  title: 'Page not found',
  kind: 'static',
  group: 'about',
};

/** The five product links shown on the 404 page. */
export const productPaths = routes.filter((r) => r.group === 'product').map((r) => r.path);

export function findRoute(path: string): Route | undefined {
  return routes.find((r) => r.path === path);
}