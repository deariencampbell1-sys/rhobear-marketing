// W0-01: shared page frame — skip link, header, single h1, main#main, footer.
// Every canonical route and the 404 page render inside this skeleton so the
// landmarks and heading order are identical everywhere.
import * as React from 'react';

export function RouteSkeleton({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <a href="#main">Skip to content</a>
      <header>
        <nav aria-label="Site">
          <a href="/">rhobear.ai</a>
        </nav>
      </header>
      <main id="main">
        <h1>{title}</h1>
        {children}
      </main>
      <footer>
        <nav aria-label="Footer">
          <a href="/privacy">Privacy</a> <a href="/terms">Terms</a>
        </nav>
      </footer>
    </>
  );
}