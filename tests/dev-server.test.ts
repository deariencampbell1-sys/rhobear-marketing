import { describe, expect, it } from 'vitest';
import { resolveRequestPath } from '../scripts/request-path.mjs';

// The resolver is pure, so a fixed POSIX dist dir is enough to pin its
// behaviour without a socket or a real filesystem.
const DIST = '/repo/dist';

function fileAt(url: string): string {
  const result = resolveRequestPath(url, DIST);
  if (result.status !== 'ok') {
    throw new Error(`${url}: expected status ok, got ${result.status}`);
  }
  const contained = result.file === DIST || result.file.startsWith(`${DIST}/`);
  expect(contained, `${url}: contained`).toBe(true);
  return result.file;
}

describe('dev server request paths', () => {
  it('serves ordinary paths inside dist, dropping the query string', () => {
    expect(fileAt('/')).toBe(DIST);
    expect(fileAt('/plans/')).toBe(`${DIST}/plans`);
    expect(fileAt('/account/')).toBe(`${DIST}/account`);
    expect(fileAt('/assets/main.js')).toBe(`${DIST}/assets/main.js`);
    expect(fileAt('/plans/?ref=nav')).toBe(`${DIST}/plans`);
  });

  it('keeps // and a bare .. inside dist instead of escaping to the parent', () => {
    expect(fileAt('//')).toBe(DIST);
    // The resolver prefixes '.' so a relative spec can never replace distDir.
    expect(fileAt('..')).toBe(`${DIST}/...`);
  });

  it('allows .. segments that still resolve inside dist', () => {
    expect(fileAt('/a/../b')).toBe(`${DIST}/b`);
  });

  it('rejects traversal above dist as not-found', () => {
    for (const url of [
      '/..',
      '/%2e%2e%2f',
      '/..%2f..%2fetc%2fpasswd',
      '/../dist-other/x',
      '/%2e%2e/%2e%2e/secret',
    ]) {
      expect(resolveRequestPath(url, DIST).status, url).toBe('not-found');
    }
  });

  it('rejects NUL bytes and malformed percent-encoding as bad-request', () => {
    for (const url of ['/%00', '/a%00b', '/%', '/%e0%a4%a']) {
      expect(resolveRequestPath(url, DIST).status, url).toBe('bad-request');
    }
  });
});
