// Types for scripts/request-path.mjs (plain Node ESM, outside tsconfig's
// include, so its surface is declared here for the tests).
export type PathResolution =
  | { status: 'ok'; file: string }
  | { status: 'bad-request' }
  | { status: 'not-found' };

export function resolveRequestPath(rawUrl: string | undefined, distDir: string): PathResolution;
