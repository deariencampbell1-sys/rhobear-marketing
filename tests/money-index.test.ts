import { describe, expect, it, afterEach } from 'vitest';
import {
  createBankClient,
  createMoneySurface,
  createQuoteClient,
  entitlementChannelHandoff,
  presentationByState,
  quoteChannelHandoff,
} from '../src/clients/money';

// No network: fetch is stubbed, and the stub records the request id header, so
// the test can prove that one transport served every client. The bodies are the
// same wire shapes the other money tests use, parsed by the real parsers.

const catalogBody = {
  schema: 'rhobear.catalog.v1',
  catalogVersion: '2026-10-25.1',
  sourceSha: 'a'.repeat(40),
  currency: 'USD',
  region: 'US',
  generatedAt: '2026-10-25T12:00:00Z',
  plans: [
    { sku: 'shell', name: 'Shell', monthlyPrice: '23.99', creditIncluded: '14.40', availability: 'available' },
  ],
  capabilities: [
    { product: 'builds', capability: 'apollo', plans: ['shell'], state: 'included' },
  ],
};

const quoteBody = {
  schema: 'rhobear.quote.v1',
  operationId: 'op-1',
  accountUuid: 'acct-1',
  catalogVersion: '2026-10-25.1',
  sourceSha: 'a'.repeat(40),
  sku: 'shell',
  channel: 'web',
  price: '23.99',
  credit: '14.40',
  tax: '0.00',
  total: '23.99',
  currency: 'USD',
  renewal: 'monthly',
  paidThroughRule: 'end-of-period',
  createdAt: '2026-10-25T12:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z',
};

type Recorded = { url: string; requestId: string };

let restore: (() => void) | null = null;

function stubFetch(): Recorded[] {
  const original = globalThis.fetch;
  const calls: Recorded[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, requestId: String(headers['X-Request-Id'] ?? '') });
    const body = url.includes('/v1/quote') ? quoteBody : catalogBody;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  restore = () => {
    globalThis.fetch = original;
  };
  return calls;
}

afterEach(() => {
  restore?.();
  restore = null;
});

// Five minutes after the fixture catalog was generated: the freshness window is
// open, so a quote can legitimately be ready.
const fixedNow = Date.parse('2026-10-25T12:05:00Z');

describe('money surface', () => {
  it('serves every client from one transport, with one injected clock', async () => {
    const calls = stubFetch();
    let issued = 0;
    const surface = createMoneySurface(
      {
        baseUrl: 'https://api.test',
        now: () => fixedNow,
        requestId: () => {
          issued += 1;
          return `id-${issued}`;
        },
      },
      { now: () => fixedNow },
    );

    const loaded = await surface.catalog.load();
    const quote = await surface.quote.bind({ accountUuid: 'acct-1', sku: 'shell', channel: 'web' });

    expect(loaded.ok).toBe(true);
    expect(quote.kind).toBe('ready');
    // Two requests, two ids from the same generator: a second transport would
    // have its own generator and restart at id-1.
    expect(calls.map((c) => c.requestId)).toEqual(['id-1', 'id-2']);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/catalog', '/v1/quote']);
  });

  it('lets the injected clock decide quote expiry, so no screen reads the wall clock', async () => {
    stubFetch();
    const surface = createMoneySurface(
      { baseUrl: 'https://api.test', now: () => Date.parse('2100-01-01T00:00:00Z') },
      { now: () => Date.parse('2100-01-01T00:00:00Z') },
    );

    const quote = await surface.quote.bind({ accountUuid: 'acct-1', sku: 'shell', channel: 'web' });

    expect(quote.kind).toBe('expired');
  });

  it('hands a screen the same catalog view twice: live, then stale but still readable', async () => {
    stubFetch();
    const surface = createMoneySurface(
      { baseUrl: 'https://api.test', now: () => fixedNow },
      { now: () => fixedNow },
    );

    const loaded = await surface.catalog.load();
    expect(loaded.ok).toBe(true);
    expect(surface.catalog.lastView()?.purchasable).toBe(false);
    expect(surface.catalog.lastView()?.stale).toBe(true);
  });

  it('exposes the aliased channel handoffs and the presentation table from the barrel', () => {
    expect(quoteChannelHandoff.web).toBe('stripe-portal');
    expect(entitlementChannelHandoff.apple).toBe('native-manage');
    expect(presentationByState.active).toBe('manage');
    expect(presentationByState['free-local']).toBe('upgrade');
    expect(typeof createQuoteClient).toBe('function');
    expect(typeof createBankClient).toBe('function');
  });
});

