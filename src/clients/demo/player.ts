// W0-05b: the player state machine behind the Real demo player journeys
// D01–D08 — `resolve → poster → playing ⇄ paused → ended` with the branches
// `buffering`, `seeking`, `transcript`, `interactive`, `error`, `revoked` and
// `pending`, and nothing else. This is what a person touches: it must never
// autoplay, never present pending, superseded or revoked footage as current
// proof, and never lose the person's place.
//
// House style, as set by `./schema.ts`, `./resolve.ts` and
// `src/clients/release/schema.ts`: no schema library, no network of its own,
// no timers, no suppressed type errors, no logging. The machine consumes
// W0-05a's `DemoPresentation` verbatim and drives one injected media element
// port (`play`, `pause`, `seekTo`) — never a second video UI of our own.
//
// The rules this module pins, one per numbered behaviour of the brief:
//   - D02 (behaviour 9): after resolve the default state is `poster`; autoplay
//     never occurs — the machine calls `media.play()` only on an explicit
//     play, an explicit retry, or an explicit replay from `ended`. The
//     `prefers-reduced-motion: reduce` input reaches the machine itself, not
//     just CSS: it is the only thing that decides whether a completed
//     scenario swap (D04) is announced as the board's `crossfade` or as a
//     direct `none` swap. The 250 ms itself stays where the board put it, in
//     the screen's CSS.
//   - D04 (behaviour 10): chapters are the package's own — selecting one
//     seeks to its real `startSeconds`, and the current chapter is derived
//     from media time (the `positionSeconds` a `timeupdate` carried) and from
//     nothing else. The machine has no timer and no fabricated job progress;
//     `positionSeconds` changes only on `timeupdate`, an explicit seek, an
//     explicit restart, or the zero that re-play from `ended` starts at.
//   - D03/S1 (behaviour 11): opening transcript/proof, leaving briefly,
//     retrying a failed media request and returning from an interactive
//     artifact all restore the same `scenarioId` and `positionSeconds`. Only
//     an explicit `restart()` resets to zero.
//   - D07 (behaviour 12): a media error becomes `error` carrying the actual
//     reason — `decode`, `network` or `http-<status>` — and offers retry,
//     lower rendition and transcript. A repeated failure (an error reached
//     again before playback ever resumed) keeps the chosen scenario and
//     position and produces a support reference id, and it never silently
//     switches to another rendition's poster and calls that playback.
//   - D04 (behaviour 13): a scenario switch keeps the old scenario playing
//     until the new poster is ready — one atomic swap, never a blank frame.
//     When the new scenario has no playable package there is no poster to
//     wait for, so the swap lands on that answer's named state; the old media
//     still played until that instant.
//   - D03 (behaviour 14): `ended` is a state of its own, distinct from
//     `paused` — a pause cannot fold it away — and re-play from `ended`
//     restarts at zero without losing the chosen scenario.
//   - D05 (behaviour 15): an interactive package is used only when its
//     `sandbox` is non-empty and its URL is https and the sandbox contains no
//     `allow-same-origin` token at all — the rule refuses ANY
//     `allow-same-origin` token, with `allow-scripts` or without (it would
//     let the framed page act as the front-door origin — remote code). The
//     token set is ASCII case-insensitive, like HTML's `sandbox` attribute, so the
//     refusal fires on `ALLOW-SAME-ORIGIN`, `Allow-Same-Origin` and any other
//     casing inside a multi-token string. Under W1-01-r1 FU-1 (owner decision
//     B) the sandbox must also contain none of the five refused tokens of
//     `REFUSED_SANDBOX_TOKENS` — the set `./schema.ts` exports once (FU-1:
//     `allow-top-navigation`, `allow-top-navigation-by-user-activation`,
//     `allow-popups-to-escape-sandbox`; W1-03b-r1 FU-2 adds
//     `allow-top-navigation-to-custom-protocols` and
//     `allow-downloads-without-user-activation`) — top navigation would let
//     the framed artifact navigate the front door (custom protocols
//     included), escaped popups would open outside the sandbox and a
//     download without the person's gesture spends their disk — refused as
//     `sandbox-token-refused` immediately after the
//     `allow-same-origin` check, whose precedence is unchanged. Anything else
//     keeps the video path
//     and records the named reason. The sandbox is applied as the iframe
//     sandbox attribute canonicalised the way `./schema.ts` normalises the
//     wire value — lowercased, single-space tokens, never a mixed-case
//     string — and the machine itself fetches nothing and spends nothing.
//   - W0-05b-r3 (Apollo's 2nd review), two owner-flagged decisions on paths
//     the board's happy path never reaches — flagged for the owner, stated
//     here so they are not invented elsewhere:
//     - F4: a rejected resolve is the resolver's own fail-closed answer — the
//       exact `footage-pending` presentation `./resolve.ts` returns whenever
//       the package cannot be gotten (mirror missing, cache empty, body not
//       fetched). The rejection is caught and mapped to that answer, then
//       handled by the same paths (applyPresentation for start/retry,
//       performSwap for a switch). No new reason value is invented and no
//       rejection ever propagates to the UI.
//     - F5: the machine must never wedge. A failed poster load is the
//       screen's to know — one screen event, `poster-error`, mirrors
//       `poster-ready`: the pending swap completes anyway and is presented
//       without the crossfade (`swapTransition: 'none'` — there is no poster
//       to fade through). Unsolicited, the event is ignored.
//     - F8: `lower-rendition` never seeks immediately. The port cannot load
//       the new rendition's source (the screen owns sources), so an immediate
//       `seekTo` would land on the old one. The machine keeps the resume time
//       itself (D06) and issues exactly one `seekTo` on the next `playing`,
//       when the screen has swapped the source. r12 F5: the resume time is
//       CAPTURED when the resume is armed and the seek is to that captured
//       place — never to whatever the live position reports before it fires.
//   - F1: `scenarioId` and `presentation` must never disagree. Every async
//     entry point captures the scenario id (and a generation counter) before
//     its await and discards an answer that lands after a switch or a restart
//     moved the world — the answer is stale and is never applied.
//   - W0-05b-r6 (Apollo's review of the r5 head), two owner-flagged
//     decisions and one field lifecycle, flagged for the owner and stated
//     here so they are not invented elsewhere:
//     - F2: the transcript and interactive sheets are reachable from
//       `buffering` and `seeking` — the board's transcript sheet can replace
//       the video, and a stalled or scrubbing video is still the video. The
//       rule there is the one from `playing`: the media is paused and the
//       sheet returns to `paused` — never into a transient state, which
//       could wedge the machine; the person resumes with one tap.
//     - F4: an error is the person's reality and cancels a pending switch —
//       the offers on it (retry, transcript) are their immediate business,
//       and the picker works from every state (r2's F5) if they still want
//       the switch. The error path clears the pending switch; a switch's own
//       resolve error is not cancelling itself (its swap already happened).
//     - F5: `swapTransition` is cleared at the entry of every public call —
//       `dispatch`, `start`, `retry`, `switchScenario`, `restart` — so the
//       value is non-null exactly in the snapshot returned by the call that
//       performed the swap (see the field's doc).
//   - W0-05b-r7 (Apollo's review of the r6 head), one D07 contradiction:
//     - F1: the `playing` event ALWAYS ends the failure episode. The event's
//       meaning is "the media is playing" — exactly D07's "playback ever
//       resumed" fact — whatever state the machine is in. The old
//       `state === 'buffering'` condition never fired on the lower-rendition
//       resume (that path leaves the machine in `poster` and the `play`
//       dispatch lands it in `playing` without touching `buffering`), so a
//       later failure produced a support reference id even though playback
//       had resumed — the exact outcome D07 forbids, and only when the
//       element did not happen to emit `waiting` first. Only the episode
//       counters reset on that event; the state transition stays
//       `buffering` → `playing` only, and the error state keeps its fields
//       (r5 F1).
//   - W0-05b-r8 (Apollo's review of the r7 head), three honesty fixes:
//     - F3: `lower-rendition` re-checks the kept place against the NEW
//       rendition's real duration before the one-shot resume is armed — a
//       lower rendition may be shorter (nothing in the schema forbids it)
//       and a `seekTo(9)` past the end of the new source would run past the
//       very place D06 promises to keep. The rule is `applyPresentation`'s
//       (`duration === null || position < 0 || position >= duration →
//       positionSeconds = 0`), with its first arm as pinned (r8's edge): a
//       null duration is no bound to check against, so the place is kept —
//       exactly like a `timeupdate` with no known duration (r4 F6).
//     - F4: the support reference id folds in a module-level monotonic
//       sequence. The id it replaces (`sup-${now()}-${errorCount}`) reset its
//       counter every episode, so two episodes in the same millisecond
//       handed out the same id — and the id is the one value support
//       correlates a report with a failure. The sequence is deterministic
//       (never `Math.random`) and the id is minted once per episode, so it
//       stays stable for that episode (D07).
//     - F6: `snapshot()` hands out copies — the error (with its own offers
//       array) and the current chapter are copied out. A screen that mutates
//       what it was handed must never corrupt the machine.
//   - W0-05b-r9 (Apollo's review of the r8 head), one contract fix and three
//     soundness fixes (the captions URL guard's third disguise, F1, lives in
//     `./captions.ts`):
//     - F2: the locked never-throw contract ("nothing is ever thrown into
//       the UI") covers hand-built presentations too. The guards decide the
//       SHAPE before they dereference: a missing `interactive` key is
//       `undefined`, not `null`, and a `sandbox` that is not a string — both
//       land in the EXISTING `absent` refusal (no new value in the frozen
//       vocabulary); a `renditions`/`chapters` that is not an array is
//       treated as empty (the machine degrades, it does not throw), while
//       the legitimate empty shapes pass through untouched.
//     - F3: `leave` from `seeking` pauses the media and lands on `paused`,
//       with `seekReturn` pinned to `paused` — scrub-then-navigate must not
//       leave the clip's audio playing on an unrelated screen, and the
//       in-flight `seeked` must never restore `playing` over a paused
//       element.
//     - F4: the answer's own identity is checked, not only its freshness —
//       the invariant above ("`scenarioId` and `presentation` must never
//       disagree") is enforced against the answer itself. A playable answer
//       naming a different scenario than the one asked for fails closed to
//       the resolver's own `footage-pending` answer (r3 F4's vocabulary) in
//       `start()`, `retry()` and `switchScenario()`.
//     - F5: a `start()` the in-flight guard turns away is remembered. When
//       the in-flight answer lands stale and is discarded while the state is
//       still `resolve` (no switch pending), the dropped caller's slot is
//       refilled by exactly one fresh `resolve()` — the machine is never
//       stranded in `resolve` by a dropped call (a screen whose mount effect
//       fired once would wait forever), and single-flight still holds. A
//       stale discard with NO dropped caller stays a plain discard (r3 F1's
//       edge: a later start() still lands).
//   - W0-05b-r10 (Apollo's review of the r9 head), one answer and three
//     structural fixes:
//     - F2 is ANSWERED, not changed (its policy half is SUPERSEDED by
//       W1-01-r1 FU-1, owner decision B: schema admission and player refusal
//       move together, and the refused set — the five tokens of
//       `./schema.ts`'s exported `REFUSED_SANDBOX_TOKENS`, widened by
//       W1-03b-r1 FU-2 — is refused here as `sandbox-token-refused` after
//       the `allow-same-origin` check). What
//       stands from r10 is beside the policy: the existing
//       `allow-same-origin` refusal now covers the token's case-normalised,
//       whitespace-padded and C0-padded spellings (r10 F2's hardening).
//     - F3: `MediaErrorReason`'s http arm is built by `httpReason()` alone —
//       the brand is a compile-time construct, the runtime strings are
//       unchanged, and the constructor's accept table and the guard's are
//       the same table by construction.
//     - F4: the pure boundary — `openInteractive` (the sandbox decision),
//       `enterError`/`clearEpisode` (the failure-episode accounting over an
//       explicit record) and `decideSeek` (`applySeek`'s transition table)
//       are module-level pure functions; the closure keeps the mutable
//       wiring only. No behaviour change.
//   - W0-05b-r11 (Apollo's union review of the r10 head: the four
//     non-blocking findings of 18:09:17Z plus the two still-open of
//     17:07:39Z), one wedge fix and two hygiene fixes:
//     - F1: the machine must never wedge (r3 F5's rule). restart()'s
//       no-media path handles `interactive` exactly like `transcript` — the
//       sheet lands on `returnState` when set, else the named state
//       underneath (`poster`) — and clears `interactiveSandbox`,
//       `interactiveRefusal` and `returnState` there, as the media path
//       always has. Without it a zero-rendition presentation's interactive
//       sheet survived the restart as `state = 'interactive'` with
//       `returnState === null`, and `close-interactive` — gated on
//       `returnState !== null` — became a permanent no-op.
//     - F5: an error is the person's whole reality (r6 F4) — the error entry
//       clears `interactiveSandbox`, `interactiveRefusal` and `returnState`
//       together with the restart clear (F1). A screen keying the iframe off
//       `interactiveSandbox` must never render the artifact over the error
//       overlay, and no stale return target survives the error.
//     - F6: `play` from `poster`/`paused` is guarded on
//       `activeRendition() !== null` — a playable presentation with zero
//       renditions has nothing for `media.play()` to start, and the machine
//       must not report `playing` over a no-media package. The state is
//       left as it is: no throw, no new refusal value. The guard's state set
//       is exactly `poster`/`paused` (not widened): `error` and `interactive`
//       stay the no-ops they are, and `ended` keeps behaviour 14's re-play.
//   - W0-05b-r12 (Apollo's review of the r11 head, 2026-10-26 19:02:48Z),
//     one contract hole and two D06/S1 contradictions (the round's two LOWs
//     — the strict deep-link hash in `./deeplink.ts` and this module's
//     bounded `httpReason` — live beside their own findings):
//     - F3: the locked never-throw contract ("nothing is ever thrown into
//       the UI") covers the `media` key itself. `activeRenditions()`
//       dereferenced `presentation.media.renditions` with no shape guard —
//       a hand-built/JSON-decoded playable presentation with `media` absent
//       (the r9 F2 class) threw a `TypeError` out of `start()` and every
//       `dispatch()`, while the sibling path has read
//       `presentation.media?.interactive` since r9 F2, proving `media` may
//       be missing. The shape is decided before it is dereferenced: an
//       absent `media` is the empty shape, exactly r9 F2's `renditions`-
//       absent row — the machine degrades to the no-rendition path and
//       never throws.
//     - F4: the null-duration rule, one meaning everywhere (D06/S1: never
//       lose the person's place). `applyPresentation` reset a preserved
//       position to 0 when `durationSeconds === null` while `lower-rendition`
//       kept it — "a null duration is no bound to check against" — and the
//       r8 F3 comment claimed the one rule for both. The rule is now
//       `duration !== null && (position < 0 || position >= duration) →
//       positionSeconds = 0` in BOTH paths: an unknown duration keeps the
//       place (a retry or deep-link start onto one never loses it), a known
//       duration still bounds it (outside it the place resets to 0, never
//       clamped to the end), and a call that never promised to keep the
//       place — `applyPresentation(next, false)`, the swap's start at the
//       new scenario's own zero — still starts at zero.
//     - F5: the one-shot lower-rendition resume seeks to the CAPTURED place,
//       never the live one (D06/S1). The resume was a bare boolean seeking
//       `positionSeconds` at fire time, so a `timeupdate` arriving before
//       `playing` — the screen swapping the source resets it to 0 —
//       retargeted the resume and lost the kept place; the contract pins no
//       event order, so the fix cannot depend on one. The place is captured
//       when the resume is armed (`resumeSeekPosition`) and both consumers —
//       the `playing` resume and the `retry()` whose seekTo IS the resume
//       (r5 F3) — seek to the captured value and report it as the position
//       (the seek is explicit, exactly what `applySeek` does).
//     - F2: `httpReason()` is bounded to the HTTP status space — the
//       integers `0 <= status <= 9999`. Beyond it `String(status)` is no
//       longer injective (`2**53` and `2**53 + 1` are one double and render
//       one decimal), so two distinct inputs built the same reason — and a
//       reason that cannot name its input cannot name a failure (D07).
//       Everything outside the space is `null`; `isMediaErrorReason` — the
//       runtime guard for untyped strings — is unchanged (r10 F3's
//       contract: build reasons with `httpReason()`).
//
// Two mapping notes for the PR, not edits to W0-05a's files:
//   - `DemoPresentation` has five states; the locked machine has no
//     `superseded` or `invalid` slot. Both land in `error` carrying the
//     presentation's own named reason (`superseded` or the `InvalidReason`),
//     so a screen can render the unpublish/block copy from the reason while
//     the machine's state set stays exactly the board's twelve.
//   - `DemoInteractive` cannot travel invalid over W0-05a's parser (it
//     refuses one), so the interactive guard here is defence in depth for
//     hand-built presentations — exactly what behaviour 15 asks the player
//     itself to check.

import {
  isScenarioId,
  KNOWN_SCENARIO_IDS,
  REFUSED_SANDBOX_TOKENS,
  type DemoChapter,
  type DemoRendition,
} from './schema';
import type { DemoPresentation, InvalidReason } from './resolve';
// The https rule is the release client's, as `./schema.ts` already uses it.
import { isHttpsUrl } from '../release/schema';

/** The media element the machine drives. A screen binds it to the real one. */
export type DemoMediaElement = {
  play(): void;
  pause(): void;
  seekTo(positionSeconds: number): void;
};

/**
 * The actual reason a media request failed (D07): decode, network,
 * `http-<status>`. r10 F3: build the http arm with `httpReason()` — it is
 * the one constructor, it renders `http-<status>` for a status in the HTTP
 * status space (the integers `0 <= status <= 9999`, r12 F2) or returns
 * `null`, and the type's http arm is what it returns. The brand is a
 * compile-time construct; the runtime strings are unchanged (`http-0`,
 * `http-200`, `http-1000`). The contract, plainly: build reasons with
 * `httpReason()`; `isMediaErrorReason` — the runtime predicate for untyped
 * input — accepts the canonical renderings the constructor produces and
 * refuses every other spelling the raw template admits (`http-1.5`,
 * `http-007`, `http-+200`, `http--200`).
 */
declare const HTTP_REASON_BRAND: unique symbol;
export type HttpMediaErrorReason = `http-${number}` & { readonly [HTTP_REASON_BRAND]: true };
export type MediaErrorReason = 'decode' | 'network' | HttpMediaErrorReason;

// F9 (W0-05b-r4) kept the guard and the type in agreement on the integers;
// r6 F8 narrowed the guard to the canonical renderings — `0`, or a positive
// integer with no leading zero. The r4 widening (`/^http-[+-]?[0-9]+$/`,
// which admitted `http-+200`, `http--200` and `http-007`) is gone: those are
// spellings the wire never renders. r10 F3: this pattern is the single
// definition of "canonical", shared by the constructor and the guard, so the
// two accept tables cannot drift apart. r12 F2: the pattern and the guard
// are unchanged — the runtime predicate for untyped strings is exactly what
// it has always been; the constructor adds the HTTP status-space bound
// (`0 <= status <= 9999`) beside them.
const HTTP_STATUS_REASON = /^http-(0|[1-9][0-9]*)$/;

/**
 * The one constructor for the http arm (r10 F3): the canonical
 * `http-<status>` rendering for a status in the HTTP status space, or
 * `null`. r12 F2: the input is bounded to the integers `0 <= status <=
 * 9999` — the smallest named ceiling that covers every status the wire
 * renders. Beyond it `String(status)` is no longer injective (`2**53` and
 * `2**53 + 1` are one double and render one decimal), and a reason that
 * cannot name its input cannot name a failure (D07) — so every status
 * outside the space is `null`, whatever it would have rendered. Inside it
 * the rendering is canonical and the two accept tables agree one-way:
 * everything this returns passes `isMediaErrorReason`, while the `null`
 * cases are non-integers (`1.5`, `NaN`, `Infinity`), negatives, out-of-space
 * statuses (`10000`, `2**53`) and statuses whose decimal rendering is not
 * canonical (`1e21` → `1e+21`). The guard is the runtime predicate for
 * untyped strings and is deliberately unchanged (r12 F2): it still accepts
 * every canonical spelling, including one the bounded constructor can no
 * longer build. `http-0` is included: the guard accepts it, so the
 * constructor agrees.
 */
export function httpReason(status: number): HttpMediaErrorReason | null {
  if (!Number.isInteger(status) || status < 0 || status > 9999) return null;
  const rendered: string = `http-${String(status)}`;
  return HTTP_STATUS_REASON.test(rendered) ? (rendered as HttpMediaErrorReason) : null;
}

export function isMediaErrorReason(value: unknown): value is MediaErrorReason {
  return (
    typeof value === 'string' &&
    (value === 'decode' || value === 'network' || HTTP_STATUS_REASON.test(value))
  );
}

/** Why the interactive artifact was refused and the video path kept (D05). */
export type InteractiveRefusalReason =
  | 'absent'
  | 'sandbox-empty'
  | 'url-not-https'
  | 'sandbox-allows-same-origin'
  // W1-01-r1 FU-1 (owner decision B), widened by W1-03b-r1 FU-2: a sandbox
  // naming any of the five dropped tokens — the exact set
  // `REFUSED_SANDBOX_TOKENS`, exported once from `./schema.ts` and imported
  // here (F2: one source of truth, no second literal). Schema admission
  // refuses the same tokens; this is the player-side half of that one
  // policy.
  | 'sandbox-token-refused';

/** The board's twelve player states, and no state the board does not have. */
export type DemoPlayerStateName =
  | 'resolve'
  | 'poster'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'buffering'
  | 'seeking'
  | 'transcript'
  | 'interactive'
  | 'error'
  | 'revoked'
  | 'pending';

/** Why nothing plays, when nothing plays: the presentation's own named reason. */
export type DemoUnplayableReason = 'footage-pending' | 'superseded' | 'revoked' | InvalidReason;

export type DemoPlayerOffer = 'retry' | 'lower-rendition' | 'transcript';

export type DemoPlayerError = {
  reason: MediaErrorReason | InvalidReason | 'superseded';
  /** Non-null once a failure repeats; one reference per failure episode. */
  supportReferenceId: string | null;
  offers: readonly DemoPlayerOffer[];
};

export type DemoPlayerSnapshot = {
  state: DemoPlayerStateName;
  scenarioId: string;
  /** Media time. It moves on `timeupdate` — never on a timer. */
  positionSeconds: number;
  /** The chosen rendition's real duration; null when nothing plays. */
  durationSeconds: number | null;
  /** Derived from media time and the package's real chapters; never invented. */
  currentChapter: DemoChapter | null;
  renditionIndex: number;
  /** The scenario a switch is waiting on, while the old one keeps playing. */
  pendingSwitchTo: string | null;
  /**
   * How the last completed scenario swap was presented (behaviour 9).
   * Cleared at the entry of every public call — `dispatch`, `start`, `retry`,
   * `switchScenario`, `restart` — so the value is non-null exactly in the
   * snapshot returned by the call that performed the swap (a plain
   * `snapshot()` read is pure and reports it until the next call). The very
   * next call carries `null`: a screen keying its animation off this field
   * never re-applies it on an unrelated render (r6 F5).
   */
  swapTransition: 'crossfade' | 'none' | null;
  /** The canonicalised sandbox to apply as the iframe sandbox attribute. */
  interactiveSandbox: string | null;
  interactiveRefusal: InteractiveRefusalReason | null;
  error: DemoPlayerError | null;
  unplayableReason: DemoUnplayableReason | null;
  transcriptUrl: string | null;
  reducedMotion: boolean;
};

export type DemoPlayerEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'timeupdate'; positionSeconds: number }
  | { type: 'waiting' }
  | { type: 'playing' }
  | { type: 'seek'; positionSeconds: number }
  | { type: 'seeked' }
  | { type: 'select-chapter'; label: string }
  | { type: 'open-transcript' }
  | { type: 'close-transcript' }
  | { type: 'open-interactive' }
  | { type: 'close-interactive' }
  | { type: 'media-error'; reason: MediaErrorReason }
  | { type: 'lower-rendition' }
  | { type: 'ended' }
  | { type: 'poster-ready' }
  // F5: the poster surface is the screen's — this is the screen saying its
  // poster image failed. The pending swap completes anyway, without the
  // crossfade (there is no poster to fade through); unsolicited, ignored.
  | { type: 'poster-error' }
  | { type: 'leave' }
  | { type: 'return' };

export type DemoPlayerConfig = {
  scenarioId: string;
  /** W0-05a's resolver. The machine makes the real call; tests stub this port. */
  resolver: { resolve(scenarioId: string): Promise<DemoPresentation> };
  media: DemoMediaElement;
  /** `prefers-reduced-motion: reduce` — an input to the machine (D02). */
  reducedMotion: boolean;
  now?: () => number;
  /** A validated deep-link position; re-checked against the real duration. */
  positionSeconds?: number;
};

export type DemoPlayer = {
  snapshot(): DemoPlayerSnapshot;
  /** D01: the real resolve. From `resolve` to the presentation's state. */
  start(): Promise<DemoPlayerSnapshot>;
  /** D07: a real retry — the media request again, or the resolve again. */
  retry(): Promise<DemoPlayerSnapshot>;
  /** D04: the old scenario keeps playing until the new poster is ready. */
  switchScenario(scenarioId: string): Promise<DemoPlayerSnapshot>;
  dispatch(event: DemoPlayerEvent): DemoPlayerSnapshot;
  /** The only thing that resets the position to zero (S1). */
  restart(): DemoPlayerSnapshot;
};

/**
 * r10 F4: the sandbox decision (D05), pure — the one place that says what a
 * validated sandbox and URL mean. `{ sandbox }` is the canonicalised
 * attribute to apply; `{ reason }` is the named refusal. The
 * `allow-same-origin` refusal covers the token's case-normalised,
 * whitespace-padded and C0-padded spellings (the decoration class
 * `./captions.ts` normalises): the token set is ASCII case-insensitive, like
 * HTML's `sandbox` attribute, and no decoration of the refused token
 * survives it. W1-01-r1 FU-1 (owner decision B), widened by W1-03b-r1 FU-2,
 * refuses the five tokens of `REFUSED_SANDBOX_TOKENS` — imported from
 * `./schema.ts`, the set's single definition — as `sandbox-token-refused`,
 * immediately after the `allow-same-origin` check — schema admission and
 * this refusal move together (`./schema.ts`'s allow-list drops all five), so
 * a token the schema admits still reaches the applied sandbox verbatim.
 */
export function openInteractive(
  sandbox: unknown,
  url: string,
): { sandbox: string } | { reason: InteractiveRefusalReason } {
  // The shape is decided before it is dereferenced (r9 F2): a hand-built
  // presentation can omit the key (`undefined`, not `null`) or carry a
  // `sandbox` that is not a string — both land in the EXISTING `absent`
  // refusal: no new value in the frozen vocabulary.
  if (typeof sandbox !== 'string') return { reason: 'absent' };
  if (sandbox.trim() === '') return { reason: 'sandbox-empty' };
  if (!isHttpsUrl(url)) return { reason: 'url-not-https' };
  const tokens = sandbox.trim().toLowerCase().split(/\s+/);
  // The refusal reads each token's spelling, not its decoration: the C0 and
  // space edges a hostile value may pad the refused token with are gone
  // before the comparison (r10 F2's hardening — the policy is untouched).
  const names = tokens.map((token) =>
    token.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, ''),
  );
  // Any `allow-same-origin` token is refused outright — with `allow-scripts`
  // or without: it would let the framed page act as this origin: remote code.
  if (names.includes('allow-same-origin')) return { reason: 'sandbox-allows-same-origin' };
  // W1-01-r1 FU-1 (owner decision B), widened by W1-03b-r1 FU-2: the tokens
  // `./schema.ts` no longer admits are refused here too — schema admission
  // and player refusal move together, with tests in both directions. F2: the
  // set is `./schema.ts`'s exported `REFUSED_SANDBOX_TOKENS`, imported above
  // — the one copy of the list, so the allow-list and this refusal move by
  // construction.
  if (names.some((name) => REFUSED_SANDBOX_TOKENS.includes(name))) {
    return { reason: 'sandbox-token-refused' };
  }
  // Applied as the iframe sandbox attribute, canonicalised the way
  // `./schema.ts` normalises the wire value: lowercased, single-space tokens
  // — never a mixed-case string. On a schema-valid input whose tokens survive
  // the refusals above this is the string verbatim.
  return { sandbox: tokens.join(' ') };
}

/**
 * r10 F4: the failure-episode record (D07) — consecutive errors before
 * playback resumes — stated explicitly, so the accounting below is pure over
 * it and the closure holds the mutable wiring only.
 */
export type FailureEpisode = {
  /** Consecutive failures before playback resumes (D07). */
  errorCount: number;
  /** One reference per episode: minted on the repeated failure, stable after. */
  supportReferenceId: string | null;
  /** What failed last — what `retry()` re-runs. Not an episode counter. */
  lastErrorKind: 'media' | 'resolve';
};

/**
 * The failure-episode accounting, pure (r10 F4): the episode one failure
 * later. A repeated failure — an error reached again before playback ever
 * resumed — produces the support reference id (D07), minted exactly once per
 * episode so a person is never handed two ids for one problem. The mint is
 * injected (it needs the host's clock and the module sequence) so this
 * function itself never touches the outside.
 */
export function enterError(
  episode: FailureEpisode,
  kind: 'media' | 'resolve',
  mintSupportReference: (errorCount: number) => string,
): FailureEpisode {
  const errorCount = episode.errorCount + 1;
  const supportReferenceId =
    errorCount >= 2 && episode.supportReferenceId === null
      ? mintSupportReference(errorCount)
      : episode.supportReferenceId;
  return { errorCount, supportReferenceId, lastErrorKind: kind };
}

/**
 * The episode is over — the counters reset on "playback resumed", a fresh
 * presentation or a swap (r7 F1, r4 F1). `lastErrorKind` is not an episode
 * counter: it says what failed last and stays with the record, because
 * `retry()` reads it and nothing else re-sets it.
 */
export function clearEpisode(episode: FailureEpisode): FailureEpisode {
  return { errorCount: 0, supportReferenceId: null, lastErrorKind: episode.lastErrorKind };
}

/** `applySeek`'s transition table (r10 F4): what a seek means from a state. */
export type SeekDecision =
  | { kind: 'ignore' }
  | { kind: 'sheet-seek'; positionSeconds: number }
  | { kind: 'scrub'; positionSeconds: number; seekReturn: 'playing' | 'paused'; state: 'seeking' };

/**
 * `applySeek`'s transition table, pure (r10 F4): what a seek from this state
 * to this target, against this duration, means. F11 — two controls, two
 * rules: a scrub can reach the end and stop there, so this bound is
 * `0 <= t <= duration`; a deep link starts a clip — a start at the very end
 * is meaningless — so its fragment bound is `0 <= t < duration`
 * (`./deeplink.ts`). The two rules are deliberate.
 */
export function decideSeek(
  state: DemoPlayerStateName,
  seekReturn: 'playing' | 'paused',
  target: number,
  duration: number | null,
): SeekDecision {
  if (duration === null || !Number.isFinite(target) || target < 0 || target > duration) {
    return { kind: 'ignore' };
  }
  if (state === 'transcript' || state === 'interactive') {
    // A chapter link from the transcript sheet seeks the real media while
    // the sheet stays open; Close restores the control at the new place.
    return { kind: 'sheet-seek', positionSeconds: target };
  }
  if (
    state === 'poster' ||
    state === 'playing' ||
    state === 'paused' ||
    state === 'buffering' ||
    state === 'ended' ||
    state === 'seeking'
  ) {
    return {
      kind: 'scrub',
      positionSeconds: target,
      // F2: where the scrub returns to is captured on the way in. A second
      // seek while already seeking must not re-capture: the state is
      // 'seeking' now, and the clobber would send a scrub that started during
      // playback back to 'paused' — the UI would lie until the next tap.
      seekReturn:
        state !== 'seeking'
          ? state === 'playing' || state === 'buffering'
            ? 'playing'
            : 'paused'
          : seekReturn,
      state: 'seeking',
    };
  }
  return { kind: 'ignore' };
}

/**
 * r8 F4: a module-level monotonic sequence for the support reference id. The
 * per-episode `errorCount` reset every episode and could collide across
 * episodes in the same millisecond; this counter only ever moves forward.
 * Deterministic — no `Math.random`, so a test can pin the whole id.
 */
let supportReferenceSequence = 0;

export function createDemoPlayer(config: DemoPlayerConfig): DemoPlayer {
  const { media, reducedMotion } = config;
  const now = config.now ?? (() => Date.now());
  const initialPosition =
    typeof config.positionSeconds === 'number' &&
    Number.isFinite(config.positionSeconds) &&
    config.positionSeconds >= 0
      ? config.positionSeconds
      : 0;

  let presentation: DemoPresentation | null = null;
  let state: DemoPlayerStateName = 'resolve';
  let scenarioId = config.scenarioId;
  let positionSeconds = initialPosition;
  let renditionIndex = 0;
  let error: DemoPlayerError | null = null;
  let unplayableReason: DemoUnplayableReason | null = null;
  let interactiveSandbox: string | null = null;
  let interactiveRefusal: InteractiveRefusalReason | null = null;
  let swapTransition: 'crossfade' | 'none' | null = null;
  // The state a transcript/interactive branch returns to (D06/D05: Close and
  // Back restore the control they took).
  let returnState: DemoPlayerStateName | null = null;
  // Where an in-flight seek returns: playback continues if it was running.
  let seekReturn: 'playing' | 'paused' = 'paused';
  // A failure episode: consecutive errors before playback resumes (D07).
  // r10 F4: one explicit record the pure accounting (`enterError`/
  // `clearEpisode`) runs over; the closure holds the mutable wiring only.
  let episode: FailureEpisode = {
    errorCount: 0,
    supportReferenceId: null,
    lastErrorKind: 'resolve',
  };
  let pendingSwitch: {
    scenarioId: string;
    presentation: DemoPresentation | null;
    posterReady: boolean;
    // F5, mirroring posterReady: the screen's poster image failed before the
    // answer landed. The poster settles once — whichever verdict arrives
    // first decides — and a failed one completes the swap with no crossfade.
    posterFailed: boolean;
  } | null = null;
  // An in-flight resolve (start) or re-resolve (retry): one call at a time —
  // a second call while one is in flight returns the snapshot unchanged,
  // never a second resolve racing the first (React StrictMode, double-tap).
  let resolving = false;
  // r9 F5: a `start()` turned away by that guard is recorded here. When the
  // in-flight answer then lands stale and is discarded while the state is
  // still `resolve`, the dropped caller's slot is refilled by exactly one
  // fresh `resolve()` — the machine is never stranded in `resolve` by a
  // dropped call.
  let startTurnedAway = false;
  // F1: every in-flight answer (start, retry, switchScenario) captures this
  // counter and the scenario id before its await. A switch or a restart bumps
  // the counter; an answer that lands after the bump is stale and discarded.
  let generation = 0;
  // F8: the one-shot resume a lower-rendition switch leaves behind — exactly
  // one `seekTo` on the next `playing`, then never again. r12 F5: the resume
  // seeks to the place CAPTURED when it was armed (`resumeSeekPosition`),
  // never to the live position — a `timeupdate` arriving before the resume
  // fires (the screen swapping the source resets it to 0) must never
  // retarget it (D06/S1: never lose the person's place). The contract pins
  // no event order, so the capture — not the order — is the fix.
  let resumeSeekPending = false;
  let resumeSeekPosition: number | null = null;

  // r9 F2: a hand-built rendition's `chapters` may not be an array — treated
  // as empty (the machine degrades, it does not throw). The legitimate empty
  // case (`chapters: []`) passes through untouched.
  function chaptersOf(rendition: DemoRendition): readonly DemoChapter[] {
    return Array.isArray(rendition.chapters) ? rendition.chapters : [];
  }

  function activeRenditions(): readonly DemoRendition[] {
    if (presentation === null || presentation.state !== 'playable') return [];
    // r9 F2: the same for `media.renditions` — a non-array is empty (the
    // schema's `empty-renditions` problem's shape passes through untouched).
    // r12 F3: the shape guard covers the `media` key itself — the locked
    // never-throw contract reaches every dereference. A hand-built/JSON-
    // decoded playable presentation may carry no `media` at all (the sibling
    // `open-interactive` path has read `presentation.media?.interactive`
    // since r9 F2): an absent `media` is the empty shape too, exactly r9
    // F2's `renditions`-absent row — the machine degrades to the
    // no-rendition path and never throws a TypeError out of `start()` or a
    // `dispatch()`.
    const renditions = presentation.media?.renditions;
    return Array.isArray(renditions) ? renditions : [];
  }

  function activeRendition(): DemoRendition | null {
    const renditions = activeRenditions();
    return renditions[renditionIndex] ?? renditions[0] ?? null;
  }

  function activeDuration(): number | null {
    const rendition = activeRendition();
    return rendition === null ? null : rendition.durationSeconds;
  }

  function transcriptUrlOf(): string | null {
    if (presentation === null) return null;
    if (presentation.state === 'playable' || presentation.state === 'revoked') {
      return presentation.transcriptUrl;
    }
    return null;
  }

  /**
   * The current chapter, derived from media time alone: the real chapter with
   * the greatest `startSeconds` at or before the position. No job progress,
   * no timer — the position is only ever what the media reported.
   */
  function currentChapterOf(rendition: DemoRendition | null): DemoChapter | null {
    if (rendition === null) return null;
    let found: DemoChapter | null = null;
    for (const chapter of chaptersOf(rendition)) {
      if (chapter.startSeconds <= positionSeconds) {
        if (found === null || chapter.startSeconds > found.startSeconds) found = chapter;
      }
    }
    return found;
  }

  function hasLowerRendition(): boolean {
    const current = activeRendition();
    if (current === null) return false;
    const pixels = current.width * current.height;
    return activeRenditions().some((r) => r.width * r.height < pixels);
  }

  function offersFor(): DemoPlayerOffer[] {
    const offers: DemoPlayerOffer[] = ['retry'];
    if (hasLowerRendition()) offers.push('lower-rendition');
    if (transcriptUrlOf() !== null) offers.push('transcript');
    return offers;
  }

  /**
   * One support reference per failure episode, from the host's clock. r8 F4:
   * the module-level monotonic sequence is folded into the id — the episode's
   * `errorCount` alone handed out the same id to two episodes in one
   * millisecond. The sequence is minted into the id exactly once per episode,
   * so the id is unique per episode and stable for the whole of it. r10 F4:
   * this is the mint the pure `enterError` is handed — the clock is the one
   * thing the accounting cannot be pure about.
   */
  function mintSupportReference(errorCount: number): string {
    supportReferenceSequence += 1;
    return `sup-${now().toString(36)}-${errorCount.toString(36)}${supportReferenceSequence.toString(36)}`;
  }

  type PlayerFailureReason = MediaErrorReason | InvalidReason | 'superseded';

  /**
   * Land on `error`: the state and its fields, wired around the pure episode
   * accounting (r10 F4's `enterError`).
   */
  function recordError(reason: PlayerFailureReason, kind: 'media' | 'resolve'): void {
    // r6 F4: an error is the person's reality and cancels a pending switch —
    // the offers on it (retry, transcript) are their immediate business, and
    // the picker works from every state (r2's F5) if they still want the
    // switch. The cancellation leaves no half-state: the swap transition is
    // untouched (a cancellation is no swap) and the switch's own late answer
    // is stale from here. A switch's own resolve error is not cancelling
    // itself: `performSwap` cleared the pending switch and recorded the swap
    // before that answer's error ever reaches this line.
    pendingSwitch = null;
    // r11 F5: the error is the person's whole reality — the sheet fields are
    // stale the moment it lands. A screen keying the iframe off
    // `interactiveSandbox` must never render the artifact over the error
    // overlay, and no return target may survive for a sheet Close to be
    // gated on: all three are cleared here, together with the restart clear
    // (r11 F1).
    interactiveSandbox = null;
    interactiveRefusal = null;
    returnState = null;
    episode = enterError(episode, kind, mintSupportReference);
    error = { reason, supportReferenceId: episode.supportReferenceId, offers: offersFor() };
    state = 'error';
  }

  /**
   * Land on a resolved presentation. `keepPosition` preserves the person's
   * place (S1); otherwise the new scenario starts at its own zero. A
   * preserved position is re-checked against the real duration and ignored
   * outside it — never clamped to the end (behaviour 18's rule, held here
   * too because a deep-link position can arrive before the package does).
   * r12 F4: the re-check is against a KNOWN duration only — an unknown
   * duration (`null`) is no bound to check against and keeps the place, the
   * one rule shared with `lower-rendition`'s re-check (r8 F3's edge). A call
   * that never promised to keep the place (`keepPosition = false`, the
   * swap's start at the new scenario's own zero) is not protected by the
   * rule and still resets.
   */
  function applyPresentation(next: DemoPresentation, keepPosition: boolean): void {
    presentation = next;
    renditionIndex = 0;
    error = null;
    returnState = null;
    interactiveSandbox = null;
    interactiveRefusal = null;
    // F8: a new presentation is a new source — a resume flag left by an older
    // lower-rendition switch is stale and must never fire against it (r12
    // F5: its captured place goes with it).
    resumeSeekPending = false;
    resumeSeekPosition = null;
    if (!keepPosition) positionSeconds = 0;
    if (next.state === 'playable') {
      // F1 (W0-05b-r4): a failure episode ends when the media is healthy
      // again. A presentation that lands playable has real media, so the
      // person's next media failure is their FIRST again — D07's support
      // reference id is for a *repeated* failure and must never fire on a
      // stale count carried across a recovered resolve (the `play` dispatch
      // sets `playing` directly, so the `playing` handler's reset cannot be
      // relied on here). Reset on `next.state === 'playable'` rather than
      // keying the episode to `lastErrorKind`: only playable media proves
      // the failure is behind them — a pending or revoked answer proves
      // nothing about the media and keeps the episode open.
      episode = clearEpisode(episode);
      unplayableReason = null;
      state = 'poster';
      const duration = activeDuration();
      // r12 F4: the one null-duration rule, everywhere (D06/S1: never lose
      // the person's place). A KNOWN duration bounds the place — outside it
      // it resets to 0, never clamped to the end (behaviour 18's rule) —
      // while an unknown duration is no bound to check against and the place
      // is kept, exactly like `lower-rendition`'s re-check (r8 F3's edge) and
      // a `timeupdate` with no known duration (r4 F6).
      if (duration !== null && (positionSeconds < 0 || positionSeconds >= duration)) {
        positionSeconds = 0;
      }
      if (keepPosition && positionSeconds > 0) media.seekTo(positionSeconds);
      return;
    }
    positionSeconds = 0;
    if (next.state === 'footage-pending') {
      unplayableReason = 'footage-pending';
      state = 'pending';
      return;
    }
    if (next.state === 'revoked') {
      unplayableReason = 'revoked';
      state = 'revoked';
      return;
    }
    // superseded and invalid have no slot in the board's state set: they are
    // `error` carrying the presentation's own named reason (see the header).
    if (next.state === 'superseded') {
      unplayableReason = 'superseded';
      recordError('superseded', 'resolve');
      return;
    }
    unplayableReason = next.reason;
    recordError(next.reason, 'resolve');
  }

  function applySeek(target: number): void {
    // r10 F4: `decideSeek` is the transition table (with the F11 two-rules
    // bound and the F2 capture rule living at the table); this is the wiring
    // — the port calls and the fields the decision moves.
    const decision = decideSeek(state, seekReturn, target, activeDuration());
    if (decision.kind === 'ignore') return;
    media.seekTo(decision.positionSeconds);
    positionSeconds = decision.positionSeconds;
    if (decision.kind === 'scrub') {
      seekReturn = decision.seekReturn;
      state = decision.state;
    }
  }

  function performSwap(next: DemoPresentation, swapScenarioId: string, crossfade: boolean): void {
    // The old media plays until this instant; the swap is one step (no blank
    // frame). It is presented with the board's crossfade only when a real
    // poster stood ready to fade through (F5: a swap completed by a failed
    // poster has none) and motion is not reduced — the reduced-motion input,
    // applied in the machine. From a state with no media there is nothing to
    // pause: the null port is never touched.
    if (activeRendition() !== null) media.pause();
    pendingSwitch = null;
    swapTransition = crossfade && !reducedMotion ? 'crossfade' : 'none';
    // A swap is a new episode whatever the answer lands on (r4 F1 keeps this
    // reset as it was; applyPresentation resets again on a playable landing).
    episode = clearEpisode(episode);
    scenarioId = swapScenarioId;
    applyPresentation(next, false);
  }

  function snapshot(): DemoPlayerSnapshot {
    const rendition = activeRendition();
    const chapter = currentChapterOf(rendition);
    return {
      state,
      scenarioId,
      positionSeconds,
      durationSeconds: rendition === null ? null : rendition.durationSeconds,
      // r8 F6: a copy — the chapter is the rendition's own element, and a
      // screen that mutates what it is handed must not corrupt the machine
      // (the next read re-derives it from media time either way).
      currentChapter: chapter === null ? null : { ...chapter },
      renditionIndex,
      pendingSwitchTo: pendingSwitch === null ? null : pendingSwitch.scenarioId,
      swapTransition,
      interactiveSandbox,
      interactiveRefusal,
      // r8 F6: the same for the error — the machine's own object and its
      // offers array are never handed out live.
      error: error === null ? null : { ...error, offers: [...error.offers] },
      unplayableReason,
      transcriptUrl: transcriptUrlOf(),
      reducedMotion,
    };
  }

  /**
   * r9 F4: the answer's own identity is checked, not only its freshness —
   * the header's invariant ("`scenarioId` and `presentation` must never
   * disagree") is enforced against the answer itself, so a resolver/cache
   * bug returning B's presentation under A's id is never presented as A. A
   * playable answer naming a different scenario than the one asked for is
   * discarded fail-closed: the resolver's own `footage-pending` answer (r3
   * F4's vocabulary) — never a new value, never a throw.
   */
  function answerIdentityOrPending(
    next: DemoPresentation,
    askedScenarioId: string,
  ): DemoPresentation {
    if (next.state === 'playable' && next.scenarioId !== askedScenarioId) {
      return { state: 'footage-pending', reason: 'footage-pending' };
    }
    return next;
  }

  /**
   * F4 (owner-flagged): a rejected resolve is the resolver's own fail-closed
   * answer — the exact `footage-pending` presentation `./resolve.ts` returns
   * whenever the package cannot be gotten. The machine invents no new reason
   * value, and no rejection ever propagates to the UI.
   */
  async function resolveOrFailClosed(id: string): Promise<DemoPresentation> {
    try {
      return await config.resolver.resolve(id);
    } catch {
      return { state: 'footage-pending', reason: 'footage-pending' };
    }
  }

  /**
   * F1: an answer is stale when the world moved while it was in flight: a
   * switch landed (the scenario id changed), a restart landed (the generation
   * changed), or a switch is in flight (a pending switch condemns a plain
   * start). A stale answer is discarded and never applied.
   */
  function answerIsStale(capturedScenarioId: string, capturedGeneration: number): boolean {
    return (
      scenarioId !== capturedScenarioId ||
      generation !== capturedGeneration ||
      pendingSwitch !== null
    );
  }

  async function start(): Promise<DemoPlayerSnapshot> {
    // r6 F5: every public call clears the swap transition on entry (field doc).
    swapTransition = null;
    if (state !== 'resolve' || resolving) {
      // r9 F5: a start() the in-flight guard turns away is REMEMBERED — the
      // screen's mount effect may fire exactly once, and a drop with no
      // record would strand the machine in `resolve` when the in-flight
      // answer lands stale (see the stale path below).
      if (resolving && state === 'resolve') startTurnedAway = true;
      return snapshot();
    }
    resolving = true;
    const capturedScenarioId = scenarioId;
    const capturedGeneration = generation;
    let refill = false;
    try {
      const next = await resolveOrFailClosed(scenarioId);
      // F1: a switch or a restart landed while this answer was in flight —
      // applying it would put one scenario's presentation under another's id.
      if (answerIsStale(capturedScenarioId, capturedGeneration)) {
        // r9 F5: the stale path re-enters the resolve — the discarded slot is
        // refilled by exactly one fresh `resolve()` — when the state is still
        // `resolve`, a caller was turned away above (the drop is what made
        // this slot owed), and no switch is pending (a pending switch lands
        // and moves the state itself). With no dropped caller the discard
        // stays a plain discard (r3 F1's edge, unchanged: a later start()
        // still lands). Single-flight still holds — the refill runs only
        // after this resolve has settled.
        refill = startTurnedAway && state === 'resolve' && pendingSwitch === null;
      } else {
        // r9 F4: the answer's own identity — a playable answer naming a
        // different scenario fails closed to the footage-pending answer.
        applyPresentation(answerIdentityOrPending(next, capturedScenarioId), true);
      }
    } finally {
      resolving = false;
      // Whatever this settle did — applied, discarded or refilled — the
      // turned-away caller's slot is served by it.
      startTurnedAway = false;
    }
    return refill ? start() : snapshot();
  }

  async function retry(): Promise<DemoPlayerSnapshot> {
    // r6 F5: every public call clears the swap transition on entry (field doc).
    swapTransition = null;
    if (state !== 'error' || resolving) return snapshot();
    if (episode.lastErrorKind === 'media' && activeRendition() !== null) {
      // A failed media request is retried as a media request — real playback
      // of the same source at the preserved position (S1), on the person's
      // explicit tap, never automatically. The overlay goes at once: an
      // error must not outlive its failure — while the failure episode itself
      // continues until playback resumes (the `playing` event ends it), which
      // is what makes a second failure name a support reference id (D07).
      error = null;
      // r5 F3: this seekTo IS the resume. If a lower-rendition switch left
      // the F8 one-shot behind, it is consumed here — or the next `playing`
      // would fire a second seek for one resume. r12 F5: it seeks to the
      // CAPTURED place when one is armed — exactly like the `playing` resume,
      // never the live position a `timeupdate` may have retargeted — and
      // reports it as the position (the seek is explicit). With no one-shot
      // behind it, the target is the position as it always was.
      const retryResume = resumeSeekPosition ?? positionSeconds;
      resumeSeekPending = false;
      resumeSeekPosition = null;
      media.seekTo(retryResume);
      positionSeconds = retryResume;
      media.play();
      state = 'buffering';
      return snapshot();
    }
    resolving = true;
    const capturedScenarioId = scenarioId;
    const capturedGeneration = generation;
    try {
      const next = await resolveOrFailClosed(scenarioId);
      // F1: the same discipline as start() — a stale answer is discarded.
      if (answerIsStale(capturedScenarioId, capturedGeneration)) return snapshot();
      // r9 F4: the same discipline as start() — the answer's own identity, or
      // fail closed to the footage-pending answer.
      applyPresentation(answerIdentityOrPending(next, capturedScenarioId), true);
      return snapshot();
    } finally {
      resolving = false;
    }
  }

  async function switchScenario(nextScenarioId: string): Promise<DemoPlayerSnapshot> {
    // r6 F5: every public call clears the swap transition on entry (field doc).
    swapTransition = null;
    // A person can always pick another scenario (behaviour 13): the picker
    // works from every state — pending, revoked and resolve-error included —
    // so only a scenario id the board does not have is refused (F3): the
    // shape, and then the board's own ids. An invented scenario id must
    // never reach the snapshot.
    if (!isScenarioId(nextScenarioId) || !KNOWN_SCENARIO_IDS.includes(nextScenarioId)) {
      return snapshot();
    }
    // F1: this switch condemns every in-flight answer; its own answer is
    // condemned by anything later — a second switch, or a restart.
    generation += 1;
    const capturedGeneration = generation;
    const token = {
      scenarioId: nextScenarioId,
      presentation: null as DemoPresentation | null,
      posterReady: false,
      posterFailed: false,
    };
    pendingSwitch = token;
    const next = await resolveOrFailClosed(nextScenarioId);
    // A newer switch or a restart may have condemned this one meanwhile (F1).
    if (pendingSwitch !== token || generation !== capturedGeneration) return snapshot();
    // r9 F4: the answer's own identity, checked against the id asked for — a
    // mismatch fails closed to the footage-pending answer and lands on the
    // picked scenario's `pending`, never the wrong presentation's poster.
    const checked = answerIdentityOrPending(next, nextScenarioId);
    if (checked.state === 'playable' && activeRendition() !== null) {
      token.presentation = checked;
      // The poster phase is settled by the screen (F5/F7): `poster-ready`
      // crossfades through the poster, `poster-error` completes the swap
      // without one — and if the answer landed first, the swap waits for
      // that verdict rather than wedging.
      if (token.posterReady) performSwap(checked, nextScenarioId, true);
      else if (token.posterFailed) performSwap(checked, nextScenarioId, false);
      return snapshot();
    }
    // No old media keeps playing through this swap — either nothing plays
    // yet, or the new answer has no poster to wait for — so the swap lands
    // directly: on the new poster, or on the answer's named state. r4 F5:
    // the board's crossfade is for swapping AWAY from playing media; with no
    // old media there is nothing to fade out of and the new poster has not
    // loaded, so the swap is presented as `none` — a screen must never flash
    // an unloaded poster mid-crossfade.
    performSwap(checked, nextScenarioId, activeRendition() !== null);
    return snapshot();
  }

  function restart(): DemoPlayerSnapshot {
    // r6 F5: the swap transition is cleared at every public call's entry
    // (field doc) — a swap that is history: a screen must never re-apply its
    // animation.
    swapTransition = null;
    // Restart lands (F1): every in-flight answer is stale from here, and an
    // in-flight switch this restart abandons leaves nothing dangling behind
    // it. restart() is the only reset of the person's place (S1), so it is
    // also the only thing that can condemn the answer of a resolve that was
    // asked for before it.
    generation += 1;
    pendingSwitch = null;
    // r4 F2: the stale fields are cleared from EVERY state, not only the
    // media-bearing one — a restart from `pending` or `revoked` must not
    // leave a return target or an error behind for the next screen to
    // re-apply. r5 F1 narrows one case of that rule: the error fields of a
    // restart that leaves the state as `error` describe the state that stays
    // and stay with it (below).
    if (activeRendition() !== null) {
      // The media-bearing path (r4 F2, unchanged): a media error restarts to
      // `poster` and its error fields are stale.
      error = null;
      episode = clearEpisode(episode);
      media.pause();
      media.seekTo(0);
      positionSeconds = 0;
      state = 'poster';
      returnState = null;
      interactiveSandbox = null;
      interactiveRefusal = null;
      // F8: the resume point no longer exists — the place is zero now (r12
      // F5: its captured value goes with it).
      resumeSeekPending = false;
      resumeSeekPosition = null;
      return snapshot();
    }
    // The state itself does not move from a named no-media state —
    // `pending` restarts as `pending`. The transcript and interactive sheets
    // over one are the single exception to holding still: their return
    // target is read here and cleared, so they land back on the named state
    // underneath rather than lingering with a Close that has nowhere to go
    // (r3 F5: the machine never wedges). r11 F1: `interactive` is handled
    // exactly like `transcript` — land on `returnState` when set, else the
    // named state underneath (`poster`) — and the sheet fields are cleared
    // here too, as the media path above always has: `interactiveSandbox`
    // and `interactiveRefusal` must not survive a restart.
    if (state === 'transcript' || state === 'interactive') state = returnState ?? 'poster';
    returnState = null;
    interactiveSandbox = null;
    interactiveRefusal = null;
    // r5 F1: when the state stays `error` (the resolve-error, no-rendition
    // case), its error fields stay with it — `error`, `unplayableReason`,
    // `errorCount` and `supportReferenceId` describe the state that stands.
    // Clearing them would hand the screen `{ state: 'error', error: null }`
    // and a blank error overlay. Everywhere else they are stale and cleared
    // (r4 F2's rule).
    if (state !== 'error') {
      error = null;
      episode = clearEpisode(episode);
    }
    return snapshot();
  }

  function dispatch(event: DemoPlayerEvent): DemoPlayerSnapshot {
    // r6 F5: every public call clears the swap transition on entry (field
    // doc) — a swap performed by THIS dispatch records its own below.
    swapTransition = null;
    switch (event.type) {
      case 'play': {
        // r11 F6: the poster/paused transition is guarded on media that
        // exists — a playable presentation with zero renditions has nothing
        // for `media.play()` to start, and the machine must not report
        // `playing` over a no-media package. The state is left as it is: no
        // throw, no new refusal value. The guard's state set is exactly
        // `poster`/`paused` (not widened): `error` and `interactive` stay
        // the no-ops they are, and `ended` keeps behaviour 14's re-play.
        if ((state === 'poster' || state === 'paused') && activeRendition() !== null) {
          media.play();
          state = 'playing';
        } else if (state === 'ended') {
          // Re-play from ended restarts at zero and keeps the scenario (D03).
          positionSeconds = 0;
          media.seekTo(0);
          media.play();
          state = 'playing';
        }
        break;
      }
      case 'pause': {
        if (state === 'playing' || state === 'buffering') {
          media.pause();
          state = 'paused';
        }
        break;
      }
      case 'timeupdate': {
        // Media time is the only clock: this is where the position, the
        // progress and the current chapter come from. r4 F6: a spurious
        // position past the end is clamped to the real duration —
        // `positionSeconds > durationSeconds` must never stand until
        // `ended` — while a position with no known duration is accepted as
        // it stands. The guard keeps rejecting non-finite and negative
        // positions outright.
        if (Number.isFinite(event.positionSeconds) && event.positionSeconds >= 0) {
          const duration = activeDuration();
          positionSeconds =
            duration !== null && event.positionSeconds > duration
              ? duration
              : event.positionSeconds;
        }
        break;
      }
      case 'waiting': {
        if (state === 'playing') state = 'buffering';
        break;
      }
      case 'playing': {
        // F8: the resume a lower-rendition switch left behind is issued now —
        // on the first `playing` after the screen has loaded the new source,
        // exactly once. The port cannot load a source (it is play/pause/
        // seekTo), so this is the only ordering that lands the seek on the new
        // rendition rather than the old one. r12 F5: the seek goes to the
        // place captured when the resume was armed — the kept place — and
        // becomes the position (the seek is explicit). The live
        // `positionSeconds` may have moved (the screen swapping the source
        // resets it to 0, and the contract pins no event order); it must
        // never retarget the resume (D06/S1: never lose the person's place).
        if (resumeSeekPending) {
          resumeSeekPending = false;
          const resume = resumeSeekPosition ?? positionSeconds;
          resumeSeekPosition = null;
          media.seekTo(resume);
          positionSeconds = resume;
        }
        // r7 F1: the `playing` event ALWAYS ends the failure episode — the
        // event means the media is playing, which is D07's "playback ever
        // resumed" fact, whatever state the machine is in (the
        // lower-rendition resume arrives here through `poster`/`playing` and
        // never through `buffering`, which is how the episode used to leak).
        // Only the episode counters reset; the error state and its fields
        // are the state's own and are untouched (r5 F1).
        episode = clearEpisode(episode);
        if (state === 'buffering') {
          state = 'playing';
        }
        break;
      }
      case 'seek': {
        applySeek(event.positionSeconds);
        break;
      }
      case 'seeked': {
        if (state === 'seeking') state = seekReturn;
        break;
      }
      case 'select-chapter': {
        // D04: a chapter seeks to its real startSeconds — and a chapter that
        // does not exist is never sought to.
        const rendition = activeRendition();
        if (rendition !== null) {
          const chapter = chaptersOf(rendition).find((c) => c.label === event.label);
          if (chapter !== undefined) applySeek(chapter.startSeconds);
        }
        break;
      }
      case 'open-transcript': {
        // r6 F2: the sheet is reachable from `buffering` and `seeking` too —
        // a stalled or scrubbing video is still the video (the board's
        // transcript sheet can replace it), and a silent dead button is worst
        // exactly where it is most likely to be reached. From those transient
        // states the rule is the one from `playing`: the media is paused and
        // the sheet returns to `paused` — returning into a transient state
        // could wedge the machine; the person resumes with one tap. The
        // in-flight `seeked` of a scrub that lands while the sheet is open
        // changes nothing here (its handler only moves the `seeking` state).
        if (
          transcriptUrlOf() !== null &&
          (state === 'poster' ||
            state === 'playing' ||
            state === 'paused' ||
            state === 'ended' ||
            state === 'buffering' ||
            state === 'seeking' ||
            state === 'error' ||
            state === 'revoked')
        ) {
          returnState =
            state === 'playing' || state === 'buffering' || state === 'seeking'
              ? 'paused'
              : state;
          if (state === 'playing' || state === 'buffering' || state === 'seeking') media.pause();
          state = 'transcript';
        }
        break;
      }
      case 'close-transcript': {
        if (state === 'transcript' && returnState !== null) {
          state = returnState;
          returnState = null;
        }
        break;
      }
      case 'open-interactive': {
        // r5 F4: the whole action — a refusal recorded or the artifact
        // opened — is gated on the states the board opens an interactive
        // from. r6 F2 adds the transient media states `buffering` and
        // `seeking`, with the `playing` rule: the media is paused and the
        // sheet returns to `paused`, never into a transient state (see
        // `open-transcript`). From any other state the snapshot is unchanged,
        // whatever the artifact carries: `open-interactive` is a true no-op
        // there.
        if (
          state !== 'poster' &&
          state !== 'playing' &&
          state !== 'paused' &&
          state !== 'ended' &&
          state !== 'buffering' &&
          state !== 'seeking'
        ) {
          break;
        }
        const interactive =
          presentation !== null && presentation.state === 'playable'
            ? (presentation.media?.interactive ?? null)
            : null;
        // r9 F2 / r10 F4: the whole decision — the shape before it is
        // dereferenced (a missing key is `undefined`, not `null`; a
        // non-string `sandbox`), the empty sandbox, the https URL, the
        // `allow-same-origin` refusal (case-normalised, whitespace-padded and
        // C0-padded spellings alike) and the verbatim application — is the
        // module-level pure `openInteractive`. This is the wiring: what it
        // decides is recorded and the machine moves only on the open. Both
        // shape cases land in the EXISTING `absent` refusal (r9 F2): no new
        // value in the frozen vocabulary, and no TypeError out of dispatch.
        const decision = openInteractive(interactive?.sandbox, interactive?.url ?? '');
        if ('reason' in decision) {
          interactiveRefusal = decision.reason;
          break;
        }
        interactiveRefusal = null;
        // As the iframe sandbox attribute: the schema's validated list
        // applied verbatim — canonicalised the way `./schema.ts` normalises
        // the wire value (lowercased, single-space tokens), which on a
        // schema-valid input is the string unchanged (r10 F2's contract).
        interactiveSandbox = decision.sandbox;
        returnState =
          state === 'playing' || state === 'buffering' || state === 'seeking'
            ? 'paused'
            : state;
        if (state === 'playing' || state === 'buffering' || state === 'seeking') media.pause();
        state = 'interactive';
        break;
      }
      case 'close-interactive': {
        if (state === 'interactive' && returnState !== null) {
          state = returnState;
          returnState = null;
          interactiveSandbox = null;
        }
        break;
      }
      case 'media-error': {
        // The actual reason, or no event at all: the machine never invents
        // one. A media error can only concern media that exists.
        if (isMediaErrorReason(event.reason) && activeRendition() !== null) {
          recordError(event.reason, 'media');
        }
        break;
      }
      case 'lower-rendition': {
        // D07's third offer, taken only on the person's tap: move to the
        // largest strictly smaller rendition and keep the place. Never taken
        // silently — a failed request never swaps renditions on its own.
        const current = activeRendition();
        if (state === 'error' && current !== null) {
          const renditions = activeRenditions();
          const pixels = current.width * current.height;
          let best: number | null = null;
          for (let i = 0; i < renditions.length; i += 1) {
            const candidatePixels = renditions[i].width * renditions[i].height;
            if (candidatePixels < pixels) {
              if (
                best === null ||
                candidatePixels > renditions[best].width * renditions[best].height
              ) {
                best = i;
              }
            }
          }
          if (best !== null) {
            // r8 F3: the kept place is re-checked against the NEW rendition's
            // real duration before the resume is armed — the one rule
            // `applyPresentation` shares (r12 F4:
            // `duration !== null && (position < 0 || position >= duration) →
            // positionSeconds = 0`), so a lower rendition that ends before
            // the kept place can never resume past its own end (a lower
            // rendition may be shorter — nothing in the schema forbids it).
            // A null duration is no bound to check against and the place is
            // kept — r8 F3's edge, exactly like a `timeupdate` with no known
            // duration (r4 F6).
            const nextDuration: number | null = renditions[best].durationSeconds;
            if (nextDuration !== null && (positionSeconds < 0 || positionSeconds >= nextDuration)) {
              positionSeconds = 0;
            }
            renditionIndex = best;
            // F8 (owner-flagged): no seekTo here. The port cannot load the new
            // rendition's source — the screen owns sources — so an immediate
            // seek would land on the old one. The machine keeps the resume
            // time itself (D06) and issues exactly one `seekTo` on the next
            // `playing`, when the screen has swapped the source. r12 F5: the
            // resume time is CAPTURED here — after the re-check above — and
            // the seek is to that captured place, whatever the live position
            // reports before it fires.
            resumeSeekPending = true;
            resumeSeekPosition = positionSeconds;
            state = 'poster';
            error = null;
          }
        }
        break;
      }
      case 'ended': {
        if (state === 'playing' || state === 'buffering' || state === 'seeking') {
          const duration = activeDuration();
          if (duration !== null) positionSeconds = duration;
          state = 'ended';
        }
        break;
      }
      case 'poster-ready': {
        if (pendingSwitch !== null && !pendingSwitch.posterFailed) {
          pendingSwitch.posterReady = true;
          if (pendingSwitch.presentation !== null) {
            performSwap(pendingSwitch.presentation, pendingSwitch.scenarioId, true);
          }
        }
        break;
      }
      case 'poster-error': {
        // F5 (owner-flagged): the machine must never wedge. The screen's
        // poster failed — there is no poster to fade through — so the pending
        // swap completes anyway and is presented without the crossfade. With
        // no pending swap (one already settled, or none was ever pending) the
        // event is ignored.
        if (pendingSwitch !== null && !pendingSwitch.posterReady) {
          pendingSwitch.posterFailed = true;
          if (pendingSwitch.presentation !== null) {
            performSwap(pendingSwitch.presentation, pendingSwitch.scenarioId, false);
          }
        }
        break;
      }
      case 'leave': {
        // Leaving briefly: the media stops and the place is kept (S1).
        // r9 F3: `seeking` is in the pause set — scrub-then-navigate must
        // not leave the clip's audio playing on an unrelated screen — and
        // where the in-flight seek returns is pinned to `paused`, so the
        // late `seeked` keeps `paused` and never restores `playing` over a
        // paused element.
        if (state === 'playing' || state === 'buffering' || state === 'seeking') {
          seekReturn = 'paused';
          media.pause();
          state = 'paused';
        }
        break;
      }
      case 'return': {
        // Coming back: the media is restored to the preserved place, and
        // playback never starts on its own.
        if (activeRendition() !== null && state !== 'resolve') media.seekTo(positionSeconds);
        break;
      }
    }
    return snapshot();
  }

  return { snapshot, start, retry, switchScenario, dispatch, restart };
}
