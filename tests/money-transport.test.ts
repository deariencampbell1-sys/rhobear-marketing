// W0-03a: proves the money transport fails closed, never fetches on unsafe
// input and only retries GET network/timeout failures. There is no real
// network here: every test stubs the global fetch with a deterministic fake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMoneyTransport } from '../src/clients/money/transport';
import type { MoneyRequest } from '../src/clients/money/transport';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const fetchMock = vi.fn<FetchFn>();
const BASE = 'https://api.example.com';

function quoteRequest(overrides: Partial<MoneyRequest> = {}): MoneyRequest {
  return { path: '/money/quote', method: 'GET', ...overrides };
}

function parseValue(raw: unknown): { value: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as { value?: unknown }).value;
  return typeof value === 'number' ? { value } : null;
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(value), { ...init, headers });
}

// JSON body with no content-type header at all, to prove absent headers work.
function jsonResponseWithoutType(value: unknown): Response {
  const response = new Response(JSON.stringify(value));
  response.headers.delete('content-type');
  return response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('not configured', () => {
  it.each([
    undefined,
    '',
    'http://x',
    'not a url',
    'ftp://api.example.com',
    'https://',
    'https://user@api.example.com',
    'https://user:pass@api.example.com',
    'https://api.example.com/?token=secret',
    'https://api.example.com/#fragment',
  ])('baseUrl %o returns not-configured without fetching', async (baseUrl) => {
    const transport = createMoneyTransport({
      baseUrl,
      requestId: () => 'req-fixed',
    });
    const result = await transport.get(quoteRequest(), parseValue);
    expect(result).toEqual({ ok: false, reason: 'not-configured', requestId: 'req-fixed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const unsafePaths = [
    '//evil.com',
    String.raw`/\evil.com`,
    String.raw`\\evil.com`,
    'https://evil.com',
    'not-relative',
    '/money?x=1',
    '/money#fragment',
    '/money quote',
    '/money\tquote',
    '/money\u0000quote',
    '/money\u0080quote',
    String.raw`/money\quote`,
    '/.',
    '/..',
    '/./money',
    '/money/../other',
    '/money/%2e%2e/other',
  ];

  it.each(unsafePaths)('path %o returns not-configured without fetching', async (path) => {
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-fixed',
    });
    const result = await transport.get({ path, method: 'GET' }, parseValue);
    expect(result).toEqual({ ok: false, reason: 'not-configured', requestId: 'req-fixed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a non-GET request returns not-configured without fetching', async () => {
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-fixed',
    });
    const request = { path: '/money/quote', method: 'POST' } as unknown as MoneyRequest;
    const result = await transport.get(request, parseValue);
    expect(result).toEqual({ ok: false, reason: 'not-configured', requestId: 'req-fixed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('origin guard', () => {
  // new URL('/\evil.com', 'https://api.example.com') resolves to evil.com, so
  // these paths must be refused before URL parsing.
  it.each([String.raw`/\evil.com`, String.raw`\\evil.com`])(
    'path %o never reaches fetch',
    async (path) => {
      const transport = createMoneyTransport({
        baseUrl: BASE,
        requestId: () => 'req-fixed',
      });
      const result = await transport.get({ path, method: 'GET' }, parseValue);
      expect(result).toEqual({ ok: false, reason: 'not-configured', requestId: 'req-fixed' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('happy path', () => {
  it('returns parsed data, one request id and the injected fetch time', async () => {
    fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 42 }));
    const transport = createMoneyTransport({
      baseUrl: BASE,
      now: () => 123_456_789,
      requestId: () => 'req-happy',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result).toEqual({
      ok: true,
      data: { value: 42 },
      requestId: 'req-happy',
      fetchedAt: 123_456_789,
    });
    if (!result.ok) throw new Error('expected a successful result');
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toEqual({ 'X-Request-Id': result.requestId });
  });

  it('sends a GET with same-origin credentials, no-store cache and no auth header', async () => {
    fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 1 }));
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-policy',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('GET');
    expect(init?.cache).toBe('no-store');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toEqual({ 'X-Request-Id': 'req-policy' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([`${BASE}/v1`, `${BASE}/v1/`])(
    'preserves the base path prefix for baseUrl %s',
    async (baseUrl) => {
      fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 1 }));
      const transport = createMoneyTransport({
        baseUrl,
        requestId: () => 'req-prefix',
      });

      const result = await transport.get(
        quoteRequest({ query: { sku: 'shell' } }),
        parseValue,
      );

      expect(result.ok).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.example.com/v1/money/quote?sku=shell',
      );
    },
  );
});

describe('retries', () => {
  it('retries a network failure once with the same request id', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-network',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual({ 'X-Request-Id': 'req-network' });
    }
    expect(result).toMatchObject({
      ok: false,
      reason: 'network',
      requestId: 'req-network',
    });
  });

  it('succeeds on the retry after the first attempt fails with a network error', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(jsonResponseWithoutType({ value: 7 }));
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-retry',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      data: { value: 7 },
      requestId: 'req-retry',
    });
  });

  it('maps an abort at timeoutMs to timeout and retries exactly once', async () => {
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal === undefined || signal === null) {
            reject(new Error('no signal'));
            return;
          }
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const transport = createMoneyTransport({
      baseUrl: BASE,
      timeoutMs: 15,
      requestId: () => 'req-timeout',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual({ 'X-Request-Id': 'req-timeout' });
    }
    if (result.ok) throw new Error('expected a timeout failure');
    expect(result.reason).toBe('timeout');
    expect(result.requestId).toBe('req-timeout');
  });

  it('clears its timeout timer on the success path', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 1 }));
    const transport = createMoneyTransport({
      baseUrl: BASE,
      timeoutMs: 60_000,
      now: () => 1,
      requestId: () => 'req-timer',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result.ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('failures that must not retry', () => {
  it('keeps an HTTP 503 to one attempt and a status-only detail', async () => {
    fetchMock.mockResolvedValue(
      new Response('upstream said no', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-http',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (result.ok) throw new Error('expected an HTTP failure');
    expect(result.reason).toBe('http');
    expect(result.detail).toBe('HTTP 503');
    expect(result.requestId).toBe('req-http');
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('api.example.com');
    expect(serialised).not.toContain('upstream said no');
    expect(serialised).not.toMatch(/token|cookie|authorization/i);
  });

  it('maps invalid JSON to parse with one attempt', async () => {
    fetchMock.mockResolvedValue(
      new Response('not json at all', {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-json',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (result.ok) throw new Error('expected a parse failure');
    expect(result.reason).toBe('parse');
    expect(result.requestId).toBe('req-json');
  });

  it('maps a null parser result to invalid-shape with one attempt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: 1 }));
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-shape',
    });

    const result = await transport.get(quoteRequest(), () => null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (result.ok) throw new Error('expected an invalid-shape failure');
    expect(result.reason).toBe('invalid-shape');
    expect(result.requestId).toBe('req-shape');
  });

  it('maps a throwing parser to invalid-shape with one attempt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: 1 }));
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-throw',
    });

    const result = await transport.get(quoteRequest(), () => {
      throw new Error('parser exploded');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (result.ok) throw new Error('expected an invalid-shape failure');
    expect(result.reason).toBe('invalid-shape');
    expect(result.requestId).toBe('req-throw');
  });

  it('refuses a non-JSON content type without reading the body', async () => {
    const response = new Response('{"value": 1}', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const jsonSpy = vi.spyOn(response, 'json');
    fetchMock.mockResolvedValue(response);
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-type',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jsonSpy).not.toHaveBeenCalled();
    if (result.ok) throw new Error('expected a parse failure');
    expect(result.reason).toBe('parse');
  });

  it('refuses a declared content-length above 262144 without reading the body', async () => {
    const response = new Response('{"value": 1}', {
      headers: { 'content-type': 'application/json', 'content-length': '262145' },
    });
    const jsonSpy = vi.spyOn(response, 'json');
    fetchMock.mockResolvedValue(response);
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-length',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jsonSpy).not.toHaveBeenCalled();
    if (result.ok) throw new Error('expected a parse failure');
    expect(result.reason).toBe('parse');
  });

  it('accepts a declared content-length at the 262144 limit', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ value: 1 }), {
        headers: { 'content-type': 'application/json', 'content-length': '262144' },
      }),
    );
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-limit',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result).toMatchObject({ ok: true, data: { value: 1 } });
  });
});

describe('request id generation never rejects get()', () => {
  const requestIdCases: { label: string; requestId: () => string }[] = [
    {
      label: 'throws',
      requestId: () => {
        throw new Error('randomUUID unavailable');
      },
    },
    {
      label: 'returns an empty string',
      requestId: () => '',
    },
  ];

  it.each(requestIdCases)('falls back when requestId $label', async ({ requestId }) => {
    fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 1 }));
    const transport = createMoneyTransport({ baseUrl: BASE, requestId });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result.ok).toBe(true);
    expect(typeof result.requestId).toBe('string');
    expect(result.requestId.length).toBeGreaterThan(0);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toEqual({ 'X-Request-Id': result.requestId });
  });
});
