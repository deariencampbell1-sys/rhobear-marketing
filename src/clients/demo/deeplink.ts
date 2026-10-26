// W0-05b: the `/engines/<scenarioId>` deep link and its `#t=<seconds>`
// fragment (behaviour 18). The route is the board's; this module decides what
// a link means and refuses everything it did not promise.
//
// The contract, one rule per sentence of the brief:
//   - `/engines/<scenarioId>` plus an optional `#t=<seconds>` fragment. Any
//     other path is `not-found`.
//   - An unknown or non-allowlisted scenario is `not-found` — never a
//     redirect, never a list of unapproved scenarios. The allowlist is the
//     board's (`KNOWN_SCENARIO_IDS`) unless a caller names its own.
//   - `t` must be a finite number inside the media duration
//     (`0 <= t < mediaDurationSeconds`); anything else is ignored — the link
//     still opens the player, at no position. Never clamped to the end, never
//     an error page (the `#t=42` on a 12 s package edge).
//   - The fragment carries nothing else — no token, email, account or receipt
//     id. A fragment that is not exactly `t=<value>` is not our format and is
//     refused as `bad-fragment`; a `t` whose value is unusable is ignored as
//     `t` rules say. Either way the parsed link carries the scenario and the
//     position and nothing else — a smuggled value is never echoed anywhere.
//   - A query string is never read: position comes from the fragment only.
//     (`?t=42` positions nobody; `?t=99#t=7` positions at 7.)
//
// House style: hand-written validation, named refusal codes, no schema
// library, no coercion, no network.

import { isScenarioId, KNOWN_SCENARIO_IDS } from './schema';

export type DemoDeepLinkParts = {
  pathname: string;
  /** Never read for media position. Present so tests can prove it. */
  search?: string;
  hash?: string;
};

export type ParsedDemoDeepLink =
  | { kind: 'player'; scenarioId: string; positionSeconds: number | null }
  | { kind: 'not-found'; reason: 'bad-path' | 'unknown-scenario' | 'bad-fragment' };

/** The board's route: `/engines/<scenarioId>`, one segment, no trailing slash. */
const ENGINES_ROUTE = /^\/engines\/([^/]+)$/;

/**
 * The fragment rule: empty means no position; `t=<value>` is the one thing a
 * fragment may carry. Anything else — a second key, a separator, a smuggled
 * token — is refused as `bad-fragment`, and a `t` value that is not a usable
 * number is ignored (the link opens with no position).
 */
function parseFragmentPosition(hash: string): { position: number | null } | { refused: true } {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return { position: null };
  if (!raw.startsWith('t=') || /[&;]/.test(raw)) return { refused: true };
  const value = raw.slice(2);
  if (value.trim() === '') return { position: null };
  const seconds = Number(value);
  return { position: Number.isFinite(seconds) ? seconds : null };
}

export function parseDemoDeepLink(
  parts: DemoDeepLinkParts,
  mediaDurationSeconds: number,
  allowlist: readonly string[] = KNOWN_SCENARIO_IDS,
): ParsedDemoDeepLink {
  const match = ENGINES_ROUTE.exec(parts.pathname);
  if (match === null) return { kind: 'not-found', reason: 'bad-path' };
  const rawId = match[1];
  if (!isScenarioId(rawId) || !allowlist.includes(rawId)) {
    return { kind: 'not-found', reason: 'unknown-scenario' };
  }
  const fragment = parseFragmentPosition(parts.hash ?? '');
  if ('refused' in fragment) return { kind: 'not-found', reason: 'bad-fragment' };
  // Inside the media duration or ignored — never clamped, never an error.
  const positionSeconds =
    fragment.position !== null &&
    Number.isFinite(mediaDurationSeconds) &&
    mediaDurationSeconds > 0 &&
    fragment.position >= 0 &&
    fragment.position < mediaDurationSeconds
      ? fragment.position
      : null;
  return { kind: 'player', scenarioId: rawId, positionSeconds };
}
