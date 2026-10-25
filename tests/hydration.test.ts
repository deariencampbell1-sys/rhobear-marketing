// W0-01: the client entry decides which routes ship JavaScript. These tests
// exercise src/main.tsx directly with a fake hydrateRoot, so the static-route
// / dynamic-route split is proven at runtime rather than by grepping dist.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { hydrateRootMock } = vi.hoisted(() => ({ hydrateRootMock: vi.fn() }));

vi.mock('react-dom/client', () => ({ hydrateRoot: hydrateRootMock }));

const rootElement = { id: 'root' };

function stubBrowser(pathname: string) {
  const getElementById = vi.fn((id: string) => (id === 'root' ? rootElement : null));
  vi.stubGlobal('window', { location: { pathname } });
  vi.stubGlobal('document', { getElementById });
  return getElementById;
}

async function loadEntry(pathname: string) {
  vi.resetModules();
  hydrateRootMock.mockClear();
  const getElementById = stubBrowser(pathname);
  await import('../src/main');
  return getElementById;
}

function hydratedElement(): React.ReactElement<{ path: string }> {
  expect(hydrateRootMock).toHaveBeenCalledTimes(1);
  const [root, element] = hydrateRootMock.mock.calls[0] as [
    unknown,
    React.ReactElement<{ path: string }>,
  ];
  expect(root).toBe(rootElement);
  return element;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  hydrateRootMock.mockClear();
});

describe('src/main client entry', () => {
  it('hydrates /account with the root element and an <App path="/account">', async () => {
    const getElementById = await loadEntry('/account');
    expect(getElementById).toHaveBeenCalledWith('root');

    const element = hydratedElement();
    const { App } = await import('../src/app/App');
    expect(element.type).toBe(App);
    expect(element.props.path).toBe('/account');
  });

  it('never hydrates a static route', async () => {
    const getElementById = await loadEntry('/plans');
    expect(getElementById).not.toHaveBeenCalled();
    expect(hydrateRootMock).not.toHaveBeenCalled();
  });

  it('normalises /account/ and hydrates the canonical path', async () => {
    await loadEntry('/account/');
    expect(hydratedElement().props.path).toBe('/account');
  });

  it('does not throw and does not hydrate for //', async () => {
    await expect(loadEntry('//')).resolves.toBeDefined();
    expect(hydrateRootMock).not.toHaveBeenCalled();
  });

  it('does nothing when #root is absent', async () => {
    vi.resetModules();
    hydrateRootMock.mockClear();
    vi.stubGlobal('window', { location: { pathname: '/account' } });
    vi.stubGlobal('document', { getElementById: vi.fn(() => null) });
    await import('../src/main');
    expect(hydrateRootMock).not.toHaveBeenCalled();
  });
});
