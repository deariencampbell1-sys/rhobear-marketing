// The dynamic route must hydrate without a hydration error.
//
// /account is the only 'dynamic' route: the prerenderer writes its HTML with
// renderRoute() and the browser then hydrates it with hydrateRoot. React's
// hydrateRoot expects markup produced by renderToString. When the prerenderer
// used renderToStaticMarkup instead, the static form serialised adjacent text
// nodes differently and every /account load threw React error #425 — "Text
// content does not match server-rendered HTML" — twelve times per load.
//
// This test hydrates the real prerendered markup in a DOM and fails if React
// reports a single hydration error. It does not check that some string is
// present in a source file: the only thing it asserts is the outcome of an
// actual hydration.
//
// The negative control at the bottom proves the harness can see a mismatch —
// without it, a test that silently stopped hydrating would still pass.
//
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateRoot, type Root } from 'react-dom/client';
import { App } from '../src/app/App';
import { renderRoute } from '../src/app/render';

/** Everything React reported while the page hydrated. */
interface HydrationReport {
  /** Errors React handed to onRecoverableError (React error #425 and friends). */
  recoverable: string[];
  /** Warnings React wrote to console.error, e.g. "Text content did not match". */
  consoleErrors: string[];
  /** The container React hydrated, still in the document. */
  container: Element | null;
}

/** The roots hydrated by the current test, unmounted after it. */
const roots: Root[] = [];

/**
 * Hydrate the markup for `path` in the current DOM and report what React said.
 * The markup comes from renderRoute(), the same function scripts/prerender.mjs
 * writes to disk, so this exercises the shipped bytes.
 */
async function hydratePage(path: string, markup?: string): Promise<HydrationReport> {
  const html = markup ?? renderRoute(path);
  // Parse the real page, then put only the hydrated subtree into this
  // document, so the container React hydrates is the one it will attach to.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const parsedRoot = parsed.getElementById('root');
  if (!parsedRoot) throw new Error(`no #root in the markup for ${path}`);
  document.body.innerHTML = parsedRoot.outerHTML;

  const recoverable: string[] = [];
  const consoleErrors: string[] = [];
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map((a) => String(a)).join(' '));
    });

  let root: Root;
  try {
    const container = document.getElementById('root');
    if (!container) throw new Error('the #root container was not installed');
    root = hydrateRoot(container, <App path={path} />, {
      onRecoverableError: (error) => {
        recoverable.push(error instanceof Error ? error.message : String(error));
      },
    });
    // Let React finish the hydration pass and flush its warnings.
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    consoleError.mockRestore();
  }

  roots.push(root);
  return { recoverable, consoleErrors, container: document.getElementById('root') };
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    await root?.unmount();
  }
  document.body.innerHTML = '';
});

describe('/account hydrates without a hydration error', () => {
  it('reports no recoverable error and no console error while hydrating', async () => {
    const report = await hydratePage('/account');

    expect(
      report.recoverable,
      `React reported hydration errors: ${report.recoverable.join(' | ')}`,
    ).toEqual([]);
    expect(
      report.consoleErrors,
      `React logged hydration errors: ${report.consoleErrors.join(' | ')}`,
    ).toEqual([]);
  });

  it('keeps the server-rendered content instead of replacing it', async () => {
    const report = await hydratePage('/account');

    // The heading React rendered on the server is still the heading in the DOM.
    expect(report.container?.querySelector('h1')?.textContent).toBe('Account');
  });

  it('negative control: the harness does see a mismatch when the markup is wrong', async () => {
    // Corrupt the heading text in the server markup. A harness that cannot see
    // hydration errors would report nothing here — so this control fails if the
    // test above has stopped proving anything.
    const html = renderRoute('/account');
    const broken = html.replace(/(<h1[^>]*>)Account(<\/h1>)/, '$1Acount$2');
    expect(broken, 'the control must actually change the markup').not.toBe(html);

    const report = await hydratePage('/account', broken);

    expect(
      report.recoverable.length + report.consoleErrors.length,
      'a mismatched markup must be reported as a hydration error',
    ).toBeGreaterThan(0);
  });
});
