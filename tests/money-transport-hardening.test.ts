import { describe, expect, it, vi, afterEach } from 'vitest';
import { createMoneyTransport } from '../src/clients/money/transport';

const BASE = 'https://api.example.test';

const makeTransport = (over: Record<string, unknown> = {}) =>
  createMoneyTransport({ baseUrl: BASE, ...(over as object) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('money transport hardening', () => {
  it('refuses a redirect instead of following it out of the allowed origin', async () => {
    const fetchStub = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/x' } }));
    vi.stubGlobal('fetch', fetchStub);
    const res = await makeTransport().get({ path: '/v1/catalog', method: 'GET' }, () => ({}));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('http');
    expect(res.detail).toContain('redirect');
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('stops reading a body that exceeds the byte cap, even without content-length', async () => {
    const big = 'x'.repeat(1_100_000);
    const fetchStub = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const bytes = new TextEncoder().encode(big);
          for (let i = 0; i < bytes.length; i += 65_536) controller.enqueue(bytes.slice(i, i + 65_536));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchStub);
    const res = await makeTransport().get({ path: '/v1/catalog', method: 'GET' }, () => ({}));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.detail).toBe('body-too-large');
  });

  it('never calls fetch for a path that leaves the origin', async () => {
    const fetchStub = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const t = makeTransport();
    for (const path of ['//evil.test/x', 'https://evil.test/x']) {
      const res = await t.get({ path, method: 'GET' }, () => ({}));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('not-configured');
    }
    expect(fetchStub).not.toHaveBeenCalled();
    const ok = await t.get({ path: '/ok', method: 'GET' }, () => ({ fine: true }));
    expect(ok.ok).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default timeout for impossible values', () => {
    for (const bad of [0, -5, Number.NaN, 120_000]) {
      expect(makeTransport({ timeoutMs: bad }).timeoutMs).toBe(10_000);
    }
    expect(makeTransport({ timeoutMs: 4_000 }).timeoutMs).toBe(4_000);
  });

  it('replaces an unsafe request id instead of sending a header fetch would reject', async () => {
    let sent: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sent = headers['X-Request-Id'] ?? null;
        return new Response('{}', { status: 200 });
      }),
    );
    const t = makeTransport({ requestId: () => 'bad\r\nid' });
    const res = await t.get({ path: '/v1/catalog', method: 'GET' }, () => ({}));
    expect(res.ok).toBe(true);
    expect(sent).not.toBeNull();
    expect(sent as unknown as string).not.toContain('\r');
    expect(sent as unknown as string).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts a baseUrl with surrounding whitespace', async () => {
    const fetchStub = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const t = createMoneyTransport({ baseUrl: `  ${BASE}\n` });
    const res = await t.get({ path: '/v1/catalog', method: 'GET' }, () => ({}));
    expect(res.ok).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

