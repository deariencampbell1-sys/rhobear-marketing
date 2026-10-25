import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { routes, notFoundRoute } from '../src/app/routes';
import { renderRoute } from '../src/app/render';
import { Button, InfoList, InfoRow, Progress, Sheet, useMotion, MOTION_NAMES } from '../src/kit';
import { handleSheetKeyDown, openSheetEffect } from '../src/kit/overlays';

const pages = [...routes.map((r) => r.path), notFoundRoute.path];

describe('page shell', () => {
  it('gives every page a skip link, one h1, lang, landmarks in focus order', () => {
    for (const path of pages) {
      const html = renderRoute(path === '/404' ? '/404' : path);
      expect((html.match(/<h1[\s>]/g) ?? []).length, path).toBe(1);
      expect(html, path).toContain('lang="en"');
      expect(html, path).toContain('href="#main">Skip to content</a>');
      const order = [
        html.indexOf('<a href="#main">'),
        html.indexOf('<header>'),
        html.indexOf('<main id="main">'),
        html.indexOf('<footer>'),
      ];
      expect(order.every((i) => i >= 0), `${path}: landmarks`).toBe(true);
      expect([...order].sort((a, b) => a - b), `${path}: focus order`).toEqual(order);
    }
  });
});

describe('kit: Button', () => {
  it('renders a 44 px minimum target and a real button by default', () => {
    const html = renderToStaticMarkup(<Button>Get</Button>);
    expect(html).toContain('<button type="button"');
    expect(html).toContain('min-height:44px');
    expect(html).toContain('min-width:44px');
  });

  it('renders an anchor with as="a" and uses real disabled semantics', () => {
    const html = renderToStaticMarkup(
      <Button as="a" href="/plans">
        Plans
      </Button>,
    );
    expect(html).toMatch(/^<a href="\/plans"/);
    const disabled = renderToStaticMarkup(<Button disabled>Get</Button>);
    expect(disabled).toContain('disabled');
  });
});

describe('kit: rows', () => {
  it('renders a label · value pair with a divider and no box on the row', () => {
    const html = renderToStaticMarkup(
      <InfoList>
        <InfoRow label="Plan" value="Studio" />
      </InfoList>,
    );
    expect(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('Plan · Studio');
    const styles = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
    const rowStyle = styles.find((s) => s.includes('display:flex'));
    expect(rowStyle).toBeDefined();
    expect(rowStyle).not.toMatch(/border|background|radius/);
    expect(styles.some((s) => s.includes('border-bottom'))).toBe(true);
  });
});

describe('kit: Progress', () => {
  it('renders nothing without a determinate numeric value', () => {
    expect(renderToStaticMarkup(<Progress />)).toBe('');
    expect(renderToStaticMarkup(<Progress value={Number.NaN} />)).toBe('');
    const html = renderToStaticMarkup(<Progress value={3} label="Loading" />);
    expect(html).toContain('<progress');
    expect(html).toContain('value="3"');
  });
});

describe('kit: Sheet', () => {
  it('is a labelled aria-modal dialog and renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <Sheet open={true} label="Details" onClose={() => {}}>
        <p>Body</p>
      </Sheet>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Details"');
    expect(
      renderToStaticMarkup(
        <Sheet open={false} label="Details" onClose={() => {}}>
          <p>Body</p>
        </Sheet>,
      ),
    ).toBe('');
  });

  it('moves focus in on open and restores it to the invoking control on close', () => {
    const invoker = { focus: vi.fn() };
    const first = { focus: vi.fn() };
    const dialog = { querySelectorAll: () => [first], focus: vi.fn() };
    const cleanup = openSheetEffect(dialog, { activeElement: invoker });
    expect(first.focus).toHaveBeenCalledTimes(1);
    cleanup();
    expect(invoker.focus).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and wraps Tab inside the dialog', () => {
    const onClose = vi.fn();
    const escape = { key: 'Escape', shiftKey: false, preventDefault: vi.fn() };
    handleSheetKeyDown(escape, null, null, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);

    const first = { focus: vi.fn() };
    const last = { focus: vi.fn() };
    const dialog = { querySelectorAll: () => [first, last] };
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    handleSheetKeyDown(tab, dialog, last, onClose);
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(tab.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('kit: useMotion', () => {
  it('returns only the kit motion names', () => {
    function Probe() {
      const motion = useMotion();
      return (
        <ul>
          {Object.keys(motion).map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      );
    }
    const html = renderToStaticMarkup(<Probe />);
    const names = [...html.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
    expect(names).toEqual([...MOTION_NAMES]);
  });
});