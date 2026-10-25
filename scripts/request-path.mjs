// W0-01: request path handling for the dev server. Pure — no sockets and no
// filesystem — so traversal and decoding can be tested directly.
// A request is decoded, resolved under distDir, and rejected if the resolved
// path escapes distDir. The caller maps each status to an HTTP response.
import path from 'node:path';

/**
 * Resolve a raw request URL to a candidate file inside distDir.
 * - malformed percent-encoding or a NUL byte → { status: 'bad-request' }
 * - a path that resolves outside distDir → { status: 'not-found' }
 * - anything else → { status: 'ok', file }, where file may not exist yet
 * @param {string | undefined} rawUrl
 * @param {string} distDir absolute dist directory
 * @returns {{ status: 'ok', file: string } | { status: 'bad-request' } | { status: 'not-found' }}
 */
export function resolveRequestPath(rawUrl, distDir) {
  let decoded;
  try {
    decoded = decodeURIComponent((rawUrl ?? '/').split('?')[0]);
  } catch {
    return { status: 'bad-request' };
  }
  if (decoded.includes('\0')) return { status: 'bad-request' };

  const file = path.resolve(distDir, '.' + decoded);
  if (file !== distDir && !file.startsWith(distDir + path.sep)) {
    return { status: 'not-found' };
  }
  return { status: 'ok', file };
}
