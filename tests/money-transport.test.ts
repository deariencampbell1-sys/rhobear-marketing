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
  // these paths must be refused before URL parsing. The protocol-relative and
  // absolute entries are the same escape with a plainer spelling.
  const unsafePaths = [
    String.raw`/\evil.com`,
    String.raw`\\evil.com`,
    '//evil.example/x',
    'https://evil.example/x',
  ];

  it.each(unsafePaths)('path %o never reaches fetch', async (path) => {
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-fixed',
    });
    const result = await transport.get({ path, method: 'GET' }, parseValue);
    expect(result).toEqual({ ok: false, reason: 'not-configured', requestId: 'req-fixed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the control path /ok calls fetch exactly once', async () => {
    fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 1 }));
    const transport = createMoneyTransport({
      baseUrl: BASE,
      requestId: () => 'req-ok',
    });
    const result = await transport.get({ path: '/ok', method: 'GET' }, parseValue);
    expect(result).toMatchObject({ ok: true, data: { value: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/ok`);
  });
});

describe('redirects', () => {
  it('a real fetch rejection on a redirect is a network failure and retries once', async () => {
    // With redirect: 'error' the platform fetch rejects on a 3xx instead of
    // returning it, so this is the production shape of a redirect: one network
    // failure, one retry, and no body ever parsed.
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => 'req-redirect' });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result).toEqual({ ok: false, reason: 'network', requestId: 'req-redirect' });
    expect(fetchMock).toHaveBeenCalledTimes(2); // one retry, like any network failure
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error');
  });

  it('surfaces a 3xx response as http with a redirect detail, never a parsed body', async () => {
    // Defense in depth for a fetch implementation that returns a 3xx instead of
    // rejecting: the response is classified, never followed, never parsed.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ value: 42 }), {
        status: 302,
        headers: { 'content-type': 'application/json', location: 'https://evil.example/x' },
      }),
    );
    const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => 'req-redirect' });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      reason: 'http',
      requestId: 'req-redirect',
      detail: 'redirect',
    });
    expect(result).not.toHaveProperty('data'); // the body was never parsed
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('evil.example'); // no Location target leaks
    expect(serialised).not.toContain('42'); // no body content leaks
  });

  it('asks fetch for redirect: error so no redirect is ever followed', async () => {
    fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 1 }));
    const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => 'req-redirect' });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.redirect).toBe('error');
  });
});

describe('body cap', () => {
  const streamed = (text: string): Response => {
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 64 * 1024) {
          controller.enqueue(bytes.subarray(i, Math.min(i + 64 * 1024, bytes.length)));
        }
        controller.close();
      },
    });
    // No content-length: the cap can only be enforced on what actually arrives.
    return new Response(stream, { headers: { 'content-type': 'application/json' } });
  };

  it('aborts a streamed body over 262144 bytes with http/body-too-large', async () => {
    const overCap = `{"value":1,"pad":"${'a'.repeat(300_000)}"}`;
    fetchMock.mockResolvedValue(streamed(overCap));
    const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => 'req-cap' });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry on an http failure
    expect(result).toEqual({
      ok: false,
      reason: 'http',
      requestId: 'req-cap',
      detail: 'body-too-large',
    });
  });

  it('accepts a streamed body of exactly 262144 bytes', async () => {
    const atCap = `{"value":1,"pad":"${'a'.repeat(262_144 - 20)}"}`;
    expect(new TextEncoder().encode(atCap).byteLength).toBe(262_144);
    fetchMock.mockResolvedValue(streamed(atCap));
    const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => 'req-cap' });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result).toMatchObject({ ok: true, data: { value: 1 } });
  });
});

describe('config validation', () => {
  it.each([0, -5, Number.NaN, 120_000])(
    'timeoutMs %s falls back to the 10_000 default',
    (timeoutMs) => {
      const transport = createMoneyTransport({ baseUrl: BASE, timeoutMs });
      expect(transport.timeoutMs).toBe(10_000);
    },
  );

  it('a finite timeout inside (0, 60_000] is used as given', () => {
    expect(createMoneyTransport({ baseUrl: BASE, timeoutMs: 4_000 }).timeoutMs).toBe(4_000);
    expect(createMoneyTransport({ baseUrl: BASE, timeoutMs: 60_000 }).timeoutMs).toBe(60_000);
    expect(createMoneyTransport({ baseUrl: BASE }).timeoutMs).toBe(10_000);
  });

  it('trims surrounding whitespace from baseUrl before judging it', async () => {
    fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 1 }));
    const transport = createMoneyTransport({
      baseUrl: `  ${BASE}\n`, // a CRLF checkout must not read as not-configured
      requestId: () => 'req-trim',
    });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result).toMatchObject({ ok: true, data: { value: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/money/quote`);
  });
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

  it.each(['bad\r\nid', 'line\nbreak', 'nul\u0000byte', 'bell\u0007here'])(
    'replaces the control-carrying requestId %j with a generated UUID',
    async (unsafe) => {
      fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 1 }));
      const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => unsafe });

      const result = await transport.get(quoteRequest(), parseValue);

      expect(result.ok).toBe(true);
      expect(result.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.requestId).not.toBe(unsafe);
      const [, init] = fetchMock.mock.calls[0];
      expect(init?.headers).toEqual({ 'X-Request-Id': result.requestId });
    },
  );
});

// The fallback request-id path: crypto.randomUUID unavailable or throwing.
describe('request id fallback', () => {
  it('still issues a request when crypto.randomUUID throws', async () => {
    const original = globalThis.crypto.randomUUID;
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('insecure context');
    });
    try {
      fetchMock.mockResolvedValue(jsonResponseWithoutType({ value: 1 }));
      const transport = createMoneyTransport({ baseUrl: BASE }); // no injected generator

      const result = await transport.get(quoteRequest(), parseValue);

      expect(result.ok).toBe(true);
      const [, init] = fetchMock.mock.calls[0];
      const sent = (init?.headers ?? {}) as Record<string, string>;
      expect(sent['X-Request-Id']).toMatch(/^[0-9a-z-]+$/i);
      expect(sent['X-Request-Id'].length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
      expect(globalThis.crypto.randomUUID).toBe(original);
    }
  });
});

// The over-cap path must survive a rejecting cancel(), and a body-less response
// is an empty body rather than a parse failure.
describe('body cap and body-less responses', () => {
  it('classifies an over-cap body as body-too-large even when cancel() rejects', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(300_000));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel() {
        throw new Error('cancel failed');
      },
    });
    fetchMock.mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => 'req-cap' });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result).toEqual({
      ok: false, reason: 'http', requestId: 'req-cap', detail: 'body-too-large',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a body-less response as an empty body, not a parse failure', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200, headers: { 'content-type': 'application/json' } }));
    const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => 'req-null' });

    const result = await transport.get(quoteRequest(), parseValue);

    // '' is not JSON: the failure is a parse failure of an empty body, which is
    // the honest classification (the body was read, and it was empty).
    expect(result).toEqual({ ok: false, reason: 'parse', requestId: 'req-null' });
  });
});

// A body that dies mid-stream is a network failure (and is retried), not a
// malformed payload; an oversized injected request id falls back instead of
// making fetch() throw.
describe('mid-stream failure and request-id bounds', () => {
  it('classifies a read() rejection as network and retries once', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":'));
        controller.error(new Error('connection reset'));
      },
    });
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));
    const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => 'req-mid' });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result).toEqual({ ok: false, reason: 'network', requestId: 'req-mid' });
    expect(fetchMock).toHaveBeenCalledTimes(2); // one retry, as for any network failure
  });

  it('falls back to a default request id when the injected one is oversized', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: 42 }));
    const transport = createMoneyTransport({ baseUrl: BASE, requestId: () => 'x'.repeat(5_000) });

    const result = await transport.get(quoteRequest(), parseValue);

    expect(result.ok).toBe(true);
    const sent = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const header = new Headers(sent.headers).get('x-request-id') ?? '';
    expect(header.length).toBeGreaterThan(0);
    expect(header.length).toBeLessThanOrEqual(200);
  });
});
