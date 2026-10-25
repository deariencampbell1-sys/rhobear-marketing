// W0-03a: the money transport. L2 owns identity, money, entitlement and the
// bank; this client only fetches published wire shapes over an injectable
// transport and fails closed to a truthful state on every path. The L2
// endpoints are not live yet, so nothing here assumes a response — each
// failure mode maps to a MoneyFailureReason the caller can render honestly.
//
// Deployment constraint: baseUrl (VITE_RHOBEAR_API_BASE) must be an absolute
// https origin that is either same-origin with this site or reached through a
// same-origin proxy. Requests use credentials: 'same-origin' and
// cache: 'no-store'; the transport has no auth-header mechanism and never
// attaches a token or cookie itself.
//
// Invariants enforced in code:
//   - a missing/unsafe baseUrl, an unsafe path or a non-GET request never
//     touches fetch;
//   - exactly one retry, only for GET network/timeout failures;
//   - one X-Request-Id per logical request, never derived from any credential;
//   - nothing is logged, and no detail ever carries a token, cookie,
//     Authorization header, query string or body.

export type MoneyTransportConfig = {
  // Absolute https origin, same-origin with this site or behind a same-origin proxy.
  baseUrl: string | undefined;
  timeoutMs?: number; // default 10_000
  now?: () => number; // injectable clock, default Date.now
  requestId?: () => string; // injectable; default crypto.randomUUID(), with a safe fallback
};

export type MoneyRequest = {
  path: string; // must start with '/', never a full URL host
  method: 'GET';
  query?: Record<string, string>;
};

export type MoneyFailureReason =
  | 'not-configured' // baseUrl absent/unsafe, or path unsafe, or non-GET
  | 'network' // fetch threw
  | 'timeout' // abort at timeoutMs
  | 'http' // non-2xx
  | 'invalid-shape' // schema validation failed, or the parser threw
  | 'parse'; // body was not JSON, or refused before parsing

export type MoneyResult<T> =
  | { ok: true; data: T; requestId: string; fetchedAt: number }
  | { ok: false; reason: MoneyFailureReason; requestId: string; detail?: string };

type AttemptResult<T> =
  | { outcome: 'ok'; data: T }
  | { outcome: 'fail'; reason: MoneyFailureReason; detail?: string };

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 262_144;
const JSON_CONTENT_TYPE = 'application/json';

// Conservative path allowlist: normal route characters and percent escapes
// only. It excludes '\', whitespace, C0/C1 controls, '?' and '#'.
const SAFE_PATH_PATTERN = /^[A-Za-z0-9\-._~%/]+$/;
const COMPLETE_PERCENT_ESCAPE = /^(?:[^%]|%[0-9A-Fa-f]{2})*$/;

let fallbackRequestIdCounter = 0;

function fallbackRequestId(): string {
  fallbackRequestIdCounter += 1;
  return `fallback-${Date.now().toString(36)}-${fallbackRequestIdCounter.toString(36)}`;
}

function defaultRequestId(): string {
  return crypto.randomUUID();
}

// crypto.randomUUID() is unavailable outside secure contexts and an injected
// generator may throw or return nothing; get() must never reject for this.
function safeRequestId(newRequestId: () => string): string {
  try {
    const candidate = newRequestId();
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  } catch {
    // Fall through to the deterministic fallback below.
  }
  return fallbackRequestId();
}

// baseUrl must be an absolute https origin; anything else never reaches fetch.
// Userinfo, search and hash are rejected so the configured base cannot smuggle
// a credential or a second scope into every request.
function safeBaseUrl(baseUrl: string | undefined): URL | null {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return null;
  if (!baseUrl.startsWith('https://')) return null;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname === '') return null;
    if (parsed.username !== '' || parsed.password !== '') return null;
    if (parsed.search !== '' || parsed.hash !== '') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isDotSegment(segment: string): boolean {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded === '.' || decoded === '..';
  } catch {
    return true; // malformed percent escape: refuse rather than guess
  }
}

// A path must be site-relative: no scheme, no protocol-relative '//' and no
// character the URL parser could reinterpret as a host boundary. Backslashes
// matter here: new URL('/\evil.com', 'https://api.example.com') escapes to
// evil.com, so they are refused before URL parsing ever sees them.
function safePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (!SAFE_PATH_PATTERN.test(path)) return false;
  if (!COMPLETE_PERCENT_ESCAPE.test(path)) return false;
  return !path.split('/').some(isDotSegment);
}

// Keep the configured base path prefix (e.g. '/v1') instead of resolving the
// request path against the origin root, then assert the result stayed on the
// configured https origin.
function buildUrl(base: URL, req: MoneyRequest): string | null {
  const basePath = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${basePath}${req.path}`, base.origin);
  if (req.query !== undefined) {
    for (const key of Object.keys(req.query)) {
      url.searchParams.set(key, req.query[key]);
    }
  }
  if (url.protocol !== 'https:' || url.origin !== base.origin) return null;
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
        cache: 'no-store',
        credentials: 'same-origin',
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
    const contentType = response.headers.get('content-type');
    if (contentType !== null && !contentType.toLowerCase().startsWith(JSON_CONTENT_TYPE)) {
      // Refuse without reading the body: the wire shape is declared non-JSON.
      return { outcome: 'fail', reason: 'parse' };
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const declared = contentLength.trim();
      if (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES) {
        // Declared oversize (or unparseable) body: refuse before reading it.
        return { outcome: 'fail', reason: 'parse' };
      }
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
    let data: T | null;
    try {
      data = parse(raw);
    } catch {
      return { outcome: 'fail', reason: 'invalid-shape' };
    }
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
    const requestId = safeRequestId(newRequestId);
    const base = safeBaseUrl(config.baseUrl);
    if (base === null || !safePath(req.path) || req.method !== 'GET') {
      return { ok: false, reason: 'not-configured', requestId };
    }
    let url: string;
    try {
      const built = buildUrl(base, req);
      if (built === null) {
        return { ok: false, reason: 'not-configured', requestId };
      }
      url = built;
    } catch {
      return { ok: false, reason: 'not-configured', requestId };
    }
    let result = await attempt<T>(url, timeoutMs, requestId, parse);
    const retriable =
      result.outcome === 'fail' &&
      req.method === 'GET' &&
      (result.reason === 'network' || result.reason === 'timeout');
    if (retriable) {
      // Exactly one retry, and only for GET network/timeout failures. Reusing
      // the same X-Request-Id across the pair is intentional: both attempts are
      // one logical request, so server logs can join them. Worst-case latency
      // for a single get() is therefore 2 × timeoutMs.
      result = await attempt<T>(url, timeoutMs, requestId, parse);
    }
    if (result.outcome === 'fail') {
      return { ok: false, reason: result.reason, requestId, detail: result.detail };
    }
    return { ok: true, data: result.data, requestId, fetchedAt: now() };
  }

  return { get };
}
