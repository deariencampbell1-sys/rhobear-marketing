// W0-01: renderToStaticMarkup for one route. Produces a complete HTML
// document (lang, head, canonical, real body content) that is readable with
// JavaScript disabled; scripts are injected later by scripts/prerender.mjs
// and only on dynamic routes.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';
import { findRoute, notFoundRoute } from './routes';

export function renderRoute(path: string): string {
  const route = findRoute(path);
  const title = route ? route.title : notFoundRoute.title;
  const docTitle = path === '/' ? 'rhobear.ai' : `${title} · rhobear.ai`;
  return (
    '<!doctype html>' +
    renderToStaticMarkup(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{docTitle}</title>
          {route ? <link rel="canonical" href={`https://rhobear.ai${route.path}`} /> : null}
        </head>
        <body>
          <div id="root">
            <App path={path} />
          </div>
        </body>
      </html>,
    )
  );
}

export function renderNotFound(): string {
  return renderRoute('/404');
}