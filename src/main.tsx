// W0-01: client entry. Static routes ship no JavaScript at all; only routes
// marked 'dynamic' load this bundle and hydrate their shell to read live
// account/money state in the browser.
import { hydrateRoot } from 'react-dom/client';
import { App } from './app/App';
import { findRoute } from './app/routes';

const raw = window.location.pathname;
const path = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
const route = findRoute(path);
if (route && route.kind === 'dynamic') {
  const root = document.getElementById('root');
  if (root) {
    hydrateRoot(root, <App path={path} />);
  }
}