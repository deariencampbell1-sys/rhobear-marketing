import { describe, expect, it } from 'vitest';
// A .mjs build script has no declaration file and this wave's dependency list
// is frozen (no @types/node), so the shape is asserted here in one cast rather
// than sprinkled through the assertions.
// @ts-expect-error - scripts/prerender.mjs ships no types
import { resolvePaths as resolvePathsUntyped } from '../scripts/prerender.mjs';

const resolvePaths = resolvePathsUntyped as (
  root: string,
  env?: Record<string, string | undefined>,
) => { distDir: string; cacheDir: string };

// The production default is the one branch nothing else exercises: every other
// test sets RHOBEAR_DIST, so this file is the only place that says "unset means
// dist/ and .cache/prerender". It is a pure function so that stays cheap.
describe('prerender output paths', () => {
  const root = '/srv/rhobear-marketing';

  it('unset RHOBEAR_DIST writes to dist/ and the shared prerender cache, exactly as before this change', () => {
    expect(resolvePaths(root, {})).toEqual({
      distDir: '/srv/rhobear-marketing/dist',
      cacheDir: '/srv/rhobear-marketing/.cache/prerender',
    });
    expect(resolvePaths(root, { RHOBEAR_DIST: '' })).toEqual({
      distDir: '/srv/rhobear-marketing/dist',
      cacheDir: '/srv/rhobear-marketing/.cache/prerender',
    });
  });

  it('a set RHOBEAR_DIST moves both the output and the SSR bundle cache, so two builds cannot share either', () => {
    expect(resolvePaths(root, { RHOBEAR_DIST: 'dist-tests-4242' })).toEqual({
      distDir: '/srv/rhobear-marketing/dist-tests-4242',
      cacheDir: '/srv/rhobear-marketing/.cache/prerender-dist-tests-4242',
    });
  });

  it('two processes get two caches: the isolation the flake needed is in the paths, not in timing', () => {
    const a = resolvePaths(root, { RHOBEAR_DIST: 'dist-tests-1001' });
    const b = resolvePaths(root, { RHOBEAR_DIST: 'dist-tests-1002' });
    expect(a.cacheDir).not.toBe(b.cacheDir);
    expect(a.distDir).not.toBe(b.distDir);
  });

  it('a relative RHOBEAR_DIST resolves under the working copy and can never escape it', () => {
    expect(resolvePaths(root, { RHOBEAR_DIST: './out/test' }).distDir).toBe('/srv/rhobear-marketing/out/test');
    expect(resolvePaths(root, { RHOBEAR_DIST: 'dist-x' }).distDir.startsWith(root)).toBe(true);
  });
});
