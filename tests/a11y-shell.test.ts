import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { routes, notFoundRoute } from '../src/app/routes';
import { renderRoute } from '../src/app/render';
import {
  Button,
  Chip,
  InfoList,
  InfoRow,
  LiveRegion,
  Progress,
  RadioList,
  Sheet,
  SwitchRow,
  useMotion,
  motionSpecs,
  MOTION_NAMES,
} from '../src/kit';
import { handleSheetKeyDown, openSheetEffect } from '../src/kit/overlays';

const pages = [...routes.map((r) => r.path), notFoundRoute.path];

describe('page shell', () => {
  it('gives every page a skip link, one h1, lang, landmarks in focus order', () => {
    for (const path of pages) {
      const html = renderRoute(path);
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
    const html = renderToStaticMarkup(React.createElement(Button, null, 'Get'));
    expect(html).toContain('<button type="button"');
    expect(html).toContain('min-height:44px');
    expect(html).toContain('min-width:44px');
  });

  it('renders an anchor with as="a" and uses real disabled semantics', () => {
    const html = renderToStaticMarkup(
      React.createElement(Button, { as: 'a', href: '/plans', children: 'Plans' }),
    );
    expect(html).toMatch(/^<a href="\/plans"/);
    const disabled = renderToStaticMarkup(
      React.createElement(Button, { disabled: true, children: 'Get' }),
    );
    expect(disabled).toContain('disabled=""');

    const disabledLink = renderToStaticMarkup(
      React.createElement(Button, {
        as: 'a',
        href: '/plans',
        disabled: true,
        children: 'Plans',
      }),
    );
    expect(disabledLink).toContain('aria-disabled="true"');
  });

  it('keeps the 44 px hit region when the caller passes smaller minima', () => {
    const html = renderToStaticMarkup(
      React.createElement(Button, { style: { minHeight: 24, minWidth: 24 }, children: 'Get' }),
    );
    expect(html).toContain('min-height:44px');
    expect(html).toContain('min-width:44px');
  });
});

describe('kit: rows', () => {
  it('renders a label · value pair with a divider and no box on the row', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        InfoList,
        null,
        React.createElement(InfoRow, { label: 'Plan', value: 'Studio' }),
      ),
    );
    expect(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('Plan · Studio');
    const styles = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
    const rowStyle = styles.find((s) => s.includes('display:flex'));
    expect(rowStyle).toBeDefined();
    expect(rowStyle).not.toMatch(/background|border-radius/);
    expect(rowStyle).toContain('border-bottom:1px solid currentColor');
  });

  it('RadioList renders a labelled fieldset with named radios and one checked', () => {
    const html = renderToStaticMarkup(
      React.createElement(RadioList, {
        name: 'plan',
        legend: 'Choose a plan',
        options: [
          { value: 'studio', label: 'Studio' },
          { value: 'pro', label: 'Pro' },
        ],
        value: 'pro',
      }),
    );
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend>Choose a plan</legend>');
    const radios = [...html.matchAll(/<input[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => tag.includes('type="radio"'));
    expect(radios).toHaveLength(2);
    for (const radio of radios) expect(radio).toContain('name="plan"');
    const studio = radios.find((tag) => tag.includes('value="studio"')) ?? '';
    const pro = radios.find((tag) => tag.includes('value="pro"')) ?? '';
    expect(studio).not.toContain('checked');
    expect(pro).toContain('checked');
  });

  it('SwitchRow renders a switch checkbox with its label and checked state', () => {
    const html = renderToStaticMarkup(
      React.createElement(SwitchRow, { label: 'Two-factor authentication', checked: true }),
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('Two-factor authentication');
    expect(html).toContain('checked=""');
  });

  it('Chip reflects selection in aria-pressed and keeps a 44 px target', () => {
    const on = renderToStaticMarkup(
      React.createElement(Chip, { label: 'Monthly', selected: true }),
    );
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('min-height:44px');
    expect(on).toContain('min-width:44px');
    const off = renderToStaticMarkup(
      React.createElement(Chip, { label: 'Monthly', selected: false }),
    );
    expect(off).toContain('aria-pressed="false"');
  });
});

describe('kit: LiveRegion', () => {
  it('is a polite atomic live region with the message text', () => {
    const html = renderToStaticMarkup(
      React.createElement(LiveRegion, { message: 'Plan saved' }),
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('Plan saved');
  });
});

describe('kit: Progress', () => {
  it('renders nothing without a determinate numeric value', () => {
    expect(renderToStaticMarkup(React.createElement(Progress, {}))).toBe('');
    expect(renderToStaticMarkup(React.createElement(Progress, { value: Number.NaN }))).toBe('');
    const html = renderToStaticMarkup(
      React.createElement(Progress, { value: 3, label: 'Loading' }),
    );
    expect(html).toContain('<progress');
    expect(html).toContain('value="3"');
  });
});

describe('kit: Sheet', () => {
  it('is a labelled aria-modal dialog and renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Sheet,
        {
          open: true,
          label: 'Details',
          onClose: () => {},
          children: React.createElement('p', null, 'Body'),
        },
      ),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Details"');
    expect(
      renderToStaticMarkup(
        React.createElement(Sheet, {
          open: false,
          label: 'Details',
          onClose: () => {},
          children: React.createElement('p', null, 'Body'),
        }),
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
    const dialog = { querySelectorAll: () => [first, last], focus: vi.fn() };
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    handleSheetKeyDown(tab, dialog, last, onClose);
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(tab.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('kit: motion specs', () => {
  it('removes motion for every kit name when reduced motion is requested', () => {
    const reduced = motionSpecs(true);
    for (const name of MOTION_NAMES) {
      expect(reduced[name], name).toEqual({ reduced: true, duration: '0s', easing: 'linear' });
    }
    const full = motionSpecs(false);
    for (const name of MOTION_NAMES) {
      expect(full[name].reduced, name).toBe(false);
      expect(full[name].duration, name).not.toBe('0s');
    }
  });
});

describe('kit: useMotion', () => {
  it('returns only the kit motion names', () => {
    function Probe() {
      const motion = useMotion();
      return React.createElement(
        'ul',
        null,
        Object.keys(motion).map((name) => React.createElement('li', { key: name }, name)),
      );
    }
    const html = renderToStaticMarkup(React.createElement(Probe));
    const names = [...html.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
    expect(names).toEqual([...MOTION_NAMES]);
  });
});