// W0-01: renderToString for one route. Produces a complete HTML document
// (lang, head, canonical, real body content) that is readable with JavaScript
// disabled; scripts are injected later by scripts/prerender.mjs and only on
// dynamic routes.
//
// renderToString, not renderToStaticMarkup: /account is the one dynamic route
// and the browser hydrates it with hydrateRoot, which expects the markup
// renderToString produced. The two renderers serialise adjacent text children
// differently — renderToString writes a `<!-- -->` separator between them so
// hydration can re-attach each text node to the right one, while
// renderToStaticMarkup omits it. With the static renderer every /account load
// threw React error #425 twelve times, "Text content does not match
// server-rendered HTML", and React fell back to client rendering the whole
// page.
//
// The separator is invisible in a browser: the text a reader sees is
// unchanged, but the raw bytes are (a price renders as `$<!-- -->50.99`, not
// `$50.99`), so anything that measures text has to read the visible text.
import { renderToString } from 'react-dom/server';
import { App } from './App';
import { findRoute, notFoundRoute, ORIGIN } from './routes';

export function renderRoute(path: string): string {
  const route = findRoute(path);
  const title = route ? route.title : notFoundRoute.title;
  const docTitle = path === '/' ? 'rhobear.ai' : `${title} · rhobear.ai`;
  return (
    '<!doctype html>' +
    renderToString(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{docTitle}</title>
          {/* The site's own favicon, prerendered into every page so no page
              requests a /favicon.ico that does not exist and logs a 404. */}
          <link rel="icon" href="/favicon.ico" sizes="32x32" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          {route ? <link rel="canonical" href={`${ORIGIN}${route.path}`} /> : null}
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
