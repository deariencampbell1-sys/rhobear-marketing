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
//   - redirects are refused (redirect: 'error'), never followed out of the
//     guarded origin, and a redirect response is never parsed;
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
const MAX_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 262_144;
const JSON_CONTENT_TYPE = 'application/json';
// A header value is bytes, and anything outside printable ASCII (a control
// character, a lone CR/LF, a non-ASCII codepoint) either breaks the header line
// or is re-encoded by the runtime; such a value is never sent.
const CONTROL_CHAR = /[^\u0020-\u007e]/;

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
  try {
    return crypto.randomUUID();
  } catch {
    return fallbackRequestId();
  }
}

// crypto.randomUUID() is unavailable outside secure contexts and an injected
// generator may throw or return nothing; get() must never reject for this.
// A value carrying CR, LF or any control character is refused too: it would
// corrupt the header line, and fetch would reject it as a TypeError that
// looks like a network failure and triggers a pointless retry.
function safeRequestId(newRequestId: () => string): string {
  let candidate: unknown;
  try {
    candidate = newRequestId();
  } catch {
    return fallbackRequestId();
  }
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return fallbackRequestId();
  }
  // Bounded in length as well as in character set: an oversized id is rejected
  // by fetch() as a TypeError, which would look like a network failure and cost
  // a pointless retry on every call.
  if (candidate.length > MAX_REQUEST_ID_CHARS || CONTROL_CHAR.test(candidate)) return defaultRequestId();
  return candidate;
}

// baseUrl must be an absolute https origin; anything else never reaches fetch.
// Userinfo, search and hash are rejected so the configured base cannot smuggle
// a credential or a second scope into every request.
function safeBaseUrl(baseUrl: string | undefined): URL | null {
  // A CRLF checkout or a quoted env value must not turn a configured base
  // into not-configured, so the value is trimmed before it is judged.
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith('https://')) return null;
  try {
    const parsed = new URL(trimmed);
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

// Thrown by readCappedBody once the running byte count passes the cap; the
// caller maps it to a failure before any of the body is parsed.
const BODY_TOO_LARGE = Symbol('money.body-too-large');

// Long enough for a uuid or a trace id, short enough that no header validator
// rejects it.
const MAX_REQUEST_ID_CHARS = 200;

// The cap is enforced on the bytes actually received, so a chunked or
// header-less response cannot stream past it the way a content-length-only
// check allows.
async function readCappedBody(response: Response): Promise<string> {
  const body = response.body;
  if (body === null) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      // Stop the stream immediately: an over-cap body is never fully read. A
      // rejecting cancel() must not turn this into a 'parse' failure, so it is
      // swallowed here and the over-cap classification is preserved.
      try {
        await reader.cancel();
      } catch {
        // The stream is already unusable; the reason below is the one that matters.
      }
      throw BODY_TOO_LARGE;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
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
        redirect: 'error',
      });
    } catch {
      if (controller.signal.aborted) {
        return { outcome: 'fail', reason: 'timeout' };
      }
      return { outcome: 'fail', reason: 'network' };
    }
    if (response.status >= 300 && response.status < 400) {
      // A redirect is never followed and never parsed: it only survives as a
      // failure whose detail records why the body is not here.
      return { outcome: 'fail', reason: 'http', detail: 'redirect' };
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
    // The body is read through the stream with a running byte count and parsed
    // by hand; response.json() would ignore the cap. Reading and parsing are
    // separated on purpose: a connection that drops mid-body is a network
    // failure (and is retried), not a malformed payload.
    let body: string;
    try {
      body = await readCappedBody(response);
    } catch (error) {
      if (controller.signal.aborted) return { outcome: 'fail', reason: 'timeout' };
      if (error === BODY_TOO_LARGE) {
        return { outcome: 'fail', reason: 'http', detail: 'body-too-large' };
      }
      return { outcome: 'fail', reason: 'network' };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
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

export type MoneyTransport = ReturnType<typeof createMoneyTransport>;

/**
 * What a client actually needs from a transport: one read. A client that takes
 * this cannot be handed a fake that lies about a timeout it never uses.
 */
export type MoneyTransportGet = Pick<MoneyTransport, 'get'>;

export function createMoneyTransport(config: MoneyTransportConfig): {
  get<T>(req: MoneyRequest, parse: (raw: unknown) => T | null): Promise<MoneyResult<T>>;
  timeoutMs: number; // the validated value in use, exposed for callers and tests
} {
  // timeoutMs must be a finite number in (0, 60_000]; 0, -5, NaN, Infinity and
  // anything above the ceiling fall back to the default instead of throwing.
  const requestedTimeout = config.timeoutMs;
  const timeoutMs =
    typeof requestedTimeout === 'number' &&
    Number.isFinite(requestedTimeout) &&
    requestedTimeout > 0 &&
    requestedTimeout <= MAX_TIMEOUT_MS
      ? requestedTimeout
      : DEFAULT_TIMEOUT_MS;
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

  return { get, timeoutMs };
}
