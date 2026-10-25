// W0-03a: the money transport. L2 owns identity, money, entitlement and the
// bank; this client only fetches published wire shapes over an injectable
// transport and fails closed to a truthful state on every path. The L2
// endpoints are not live yet, so nothing here assumes a response — each
// failure mode maps to a MoneyFailureReason the caller can render honestly.
//
// Invariants enforced in code:
//   - a missing/unsafe baseUrl or path never touches fetch;
//   - exactly one retry, only for GET network/timeout failures;
//   - one X-Request-Id per request, never derived from any credential;
//   - nothing is logged, and no detail ever carries a token, cookie,
//     Authorization header, query string or body.

export type MoneyTransportConfig = {
  baseUrl: string | undefined; // import.meta.env.VITE_RHOBEAR_API_BASE at the call site
  timeoutMs?: number; // default 10_000
  now?: () => number; // injectable clock, default Date.now
  requestId?: () => string; // injectable, default crypto.randomUUID()
};

export type MoneyRequest = {
  path: string; // must start with '/', never a full URL host
  method: 'GET';
  query?: Record<string, string>;
};

export type MoneyFailureReason =
  | 'not-configured' // baseUrl absent
  | 'network' // fetch threw
  | 'timeout' // abort at timeoutMs
  | 'http' // non-2xx
  | 'invalid-shape' // schema validation failed
  | 'parse'; // body was not JSON

export type MoneyResult<T> =
  | { ok: true; data: T; requestId: string; fetchedAt: number }
  | { ok: false; reason: MoneyFailureReason; requestId: string; detail?: string };

type AttemptResult<T> =
  | { outcome: 'ok'; data: T }
  | { outcome: 'fail'; reason: MoneyFailureReason; detail?: string };

const DEFAULT_TIMEOUT_MS = 10_000;

function defaultRequestId(): string {
  return crypto.randomUUID();
}

// baseUrl must be an absolute https origin; anything else never reaches fetch.
function safeBaseUrl(baseUrl: string | undefined): URL | null {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return null;
  if (!baseUrl.startsWith('https://')) return null;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname === '') return null;
    return parsed;
  } catch {
    return null;
  }
}

// A path must be site-relative: no scheme, no protocol-relative '//', so a
// caller can never point the client at another host.
function safePath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (path.includes('://')) return false;
  return true;
}

function buildUrl(base: URL, req: MoneyRequest): string {
  const url = new URL(req.path, base);
  if (req.query !== undefined) {
    for (const key of Object.keys(req.query)) {
      url.searchParams.set(key, req.query[key]);
    }
  }
  return url.toString();
}

async function attempt<T>(
  url: string,
  timeoutMs: number,
  requestId: string,
  parse: (raw: unknown) => T | null,
): Promise<AttemptResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'X-Request-Id': requestId },
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        return { outcome: 'fail', reason: 'timeout' };
      }
      return { outcome: 'fail', reason: 'network' };
    }
    if (response.status < 200 || response.status >= 300) {
      // detail carries at most the HTTP status; never query, headers or body.
      return { outcome: 'fail', reason: 'http', detail: `HTTP ${response.status}` };
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      if (controller.signal.aborted) {
        return { outcome: 'fail', reason: 'timeout' };
      }
      return { outcome: 'fail', reason: 'parse' };
    }
    const data = parse(raw);
    if (data === null) return { outcome: 'fail', reason: 'invalid-shape' };
    return { outcome: 'ok', data };
  } finally {
    clearTimeout(timer);
  }
}

export function createMoneyTransport(config: MoneyTransportConfig): {
  get<T>(req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>>;
} {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = config.now ?? Date.now;
  const newRequestId = config.requestId ?? defaultRequestId;

  async function get<T>(
    req: MoneyRequest,
    parse: (raw: unknown) => T | null,
  ): Promise<MoneyResult<T>> {
    const requestId = newRequestId();
    const base = safeBaseUrl(config.baseUrl);
    if (base === null || !safePath(req.path) || req.method !== 'GET') {
      return { ok: false, reason: 'not-configured', requestId };
    }
    let url: string;
    try {
      url = buildUrl(base, req);
    } catch {
      return { ok: false, reason: 'not-configured', requestId };
    }
    let result = await attempt<T>(url, timeoutMs, requestId, parse);
    const retriable =
      result.outcome === 'fail' &&
      req.method === 'GET' &&
      (result.reason === 'network' || result.reason === 'timeout');
    if (retriable) {
      // Exactly one retry, and only for GET network/timeout failures.
      result = await attempt<T>(url, timeoutMs, requestId, parse);
    }
    if (result.outcome === 'fail') {
      return { ok: false, reason: result.reason, requestId, detail: result.detail };
    }
    return { ok: true, data: result.data, requestId, fetchedAt: now() };
  }

  return { get };
}
