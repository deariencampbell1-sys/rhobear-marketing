// W0-01: 404 page. Plain apology, links to all five products, /plans,
// /support and a canonical home link. No client-side redirect, no old routes.
import * as React from 'react';
import { RouteSkeleton } from './RouteSkeleton';
import { productPaths, routes } from './routes';

const linkLabel: Record<string, string> = Object.fromEntries(routes.map((r) => [r.path, r.title]));

export function NotFound() {
  return (
    <RouteSkeleton title="Page not found">
      <p>
        Sorry, there is no page at this address. The links below go to the pages
        that exist today.
      </p>
      <ul>
        {productPaths.map((path) => (
          <li key={path}>
            <a href={path}>{linkLabel[path]}</a>
          </li>
        ))}
        <li>
          <a href="/plans">Plans and prices</a>
        </li>
        <li>
          <a href="/support">Support</a>
        </li>
        <li>
          <a href="/">Home</a>
        </li>
      </ul>
    </RouteSkeleton>
  );
}