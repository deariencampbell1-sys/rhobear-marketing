// W0-05b: the `/engines/<scenarioId>` deep link and its `#t=<seconds>`
// fragment (behaviour 18). The route is the board's; this module decides what
// a link means and refuses everything it did not promise.
//
// The contract, one rule per sentence of the brief:
//   - `/engines/<scenarioId>` plus an optional `#t=<seconds>` fragment. Any
//     other path is `not-found`.
//   - An unknown or non-allowlisted scenario is `not-found` — never a
//     redirect, never a list of unapproved scenarios. The allowlist is the
//     board's (`KNOWN_SCENARIO_IDS`) unless a caller names its own (r11 F4:
//     a caller's value that is not an array is no allowlist — the built-in
//     list stands and nothing is thrown).
//   - `t` must match the grammar — a number with at most three decimals and
//     nothing else (F10) — and then be a finite number inside the media
//     duration (`0 <= t < mediaDurationSeconds`, F11: a deep link starts a
//     clip, so a start at the very end is meaningless); a grammatical number
//     outside that range is ignored — the link still opens the player, at no
//     position. Never clamped to the end, never an error page (the `#t=42`
//     on a 12 s package edge).
//   - The fragment carries nothing else — no token, email, account or receipt
//     id. A fragment that is not exactly `t=<value>` is not our format and is
//     refused as `bad-fragment`, and so is a `t` whose value is not the
//     grammar's (F10: a second `#`, a unit suffix, whitespace beyond the
//     grammar, an empty value). Either way the parsed link carries the
//     scenario and the position and nothing else — a smuggled value is never
//     echoed anywhere.
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
 * fragment may carry, and <value> must match the grammar (F10) — unsigned
 * digits, at most three decimal digits, nothing else. r6 F7 dropped the r3
 * grammar's sign extension: the board's position is unsigned ("a valid
 * `0 <= t < duration` position in seconds"), so `#t=+42`, `#t=-5` and
 * `#t=+0` are outside the grammar entirely. Anything else — a second `#`, a
 * unit suffix, whitespace beyond the grammar, an empty value, a signed
 * literal — is not our format and is refused as `bad-fragment`. A number the
 * grammar allows but the media duration does not is ignored instead: the link
 * still opens the player, at no position (behaviour 18's rule).
 */
const FRAGMENT_SECONDS = /^\d+(\.\d{1,3})?$/;

function parseFragmentPosition(hash: string): { position: number | null } | { refused: true } {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') return { position: null };
  if (!raw.startsWith('t=') || /[&;#]/.test(raw)) return { refused: true };
  const value = raw.slice(2);
  if (!FRAGMENT_SECONDS.test(value)) return { refused: true };
  return { position: Number(value) };
}

export function parseDemoDeepLink(
  parts: DemoDeepLinkParts,
  mediaDurationSeconds: number,
  allowlist: readonly string[] = KNOWN_SCENARIO_IDS,
): ParsedDemoDeepLink {
  // r10 F6: the shape is decided before anything is dereferenced — the
  // locked never-throw contract ("nothing is ever thrown into the UI")
  // covers the parsed location too, hand-built or hostile. Each malformed
  // half falls back to its empty shape: a location that is not an object, or
  // a `pathname` that is not a string, has no path parts at all — the
  // `bad-path` refusal an empty path gets — and a `hash` that is not a
  // string is no fragment — no position — exactly like the absent `hash` a
  // valid location has always carried. A valid location is bit-identical
  // through this guard.
  if (parts === null || typeof parts !== 'object') return { kind: 'not-found', reason: 'bad-path' };
  const pathname = typeof parts.pathname === 'string' ? parts.pathname : null;
  if (pathname === null) return { kind: 'not-found', reason: 'bad-path' };
  const match = ENGINES_ROUTE.exec(pathname);
  if (match === null) return { kind: 'not-found', reason: 'bad-path' };
  const rawId = match[1];
  // r11 F4: the allowlist is shape-guarded before it is used — the locked
  // never-throw contract covers the parse's own parameters, and a JS caller's
  // `null` or object escapes the default parameter only to throw out of
  // `.includes`. Anything that is not an array falls back to the built-in
  // list (`KNOWN_SCENARIO_IDS`): refuse nothing, never throw.
  const allowed = Array.isArray(allowlist) ? allowlist : KNOWN_SCENARIO_IDS;
  if (!isScenarioId(rawId) || !allowed.includes(rawId)) {
    return { kind: 'not-found', reason: 'unknown-scenario' };
  }
  const fragment = parseFragmentPosition(typeof parts.hash === 'string' ? parts.hash : '');
  if ('refused' in fragment) return { kind: 'not-found', reason: 'bad-fragment' };
  // F11 — two controls, two rules. A deep link starts a clip — a start at
  // the very end is meaningless — so the fragment is `0 <= t < duration`.
  // A scrub can reach the end and stop there, so `applySeek`
  // (`./player.ts`) is `0 <= t <= duration`. The two rules are deliberate.
  // Out of this range the value is ignored: the link still opens the player,
  // at no position — never clamped, never an error page.
  // r10 F5: the `Number.isFinite` and `> 0` conjuncts are belt-and-braces
  // beside the range check — a NaN, zero or negative duration already falls
  // out of `position < mediaDurationSeconds` — while an infinite duration
  // needs the finiteness arm to fall out at all. Pinned by the r10 F5
  // duration table; the conjuncts stay, do not remove them.
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
