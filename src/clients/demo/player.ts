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
//     casing inside a multi-token string. Anything else keeps the video path
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
//       when the screen has swapped the source.
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
//       the switch. `enterError` clears the pending switch; a switch's own
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

import { isScenarioId, KNOWN_SCENARIO_IDS, type DemoChapter, type DemoRendition } from './schema';
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
 * `http-<status>`. The number is a non-negative HTTP status rendered in
 * canonical decimal — `http-0`, `http-200`, `http-1000`: exactly what
 * `http-${number}` produces for a non-negative integer. Spellings the
 * template also matches but the wire never renders (`http-1.5`, `http-007`,
 * `http-+200`) are not reasons and `isMediaErrorReason` refuses them
 * (r6 F8: the guard and the type agree on exactly the canonical members).
 */
export type MediaErrorReason = 'decode' | 'network' | `http-${number}`;

// F9 (W0-05b-r4) kept the guard and the type in agreement on the integers;
// r6 F8 narrows the guard to the canonical renderings `http-${number}`
// produces for non-negative integers — `0`, or a positive integer with no
// leading zero. The r4 widening (`/^http-[+-]?[0-9]+$/`, which admitted
// `http-+200`, `http--200` and `http-007`) is gone: those are spellings the
// type does not canonically produce and the wire never renders.
const HTTP_STATUS_REASON = /^http-(0|[1-9][0-9]*)$/;

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
  | 'sandbox-allows-same-origin';

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
  let errorCount = 0;
  let supportReferenceId: string | null = null;
  let lastErrorKind: 'media' | 'resolve' = 'resolve';
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
  // F1: every in-flight answer (start, retry, switchScenario) captures this
  // counter and the scenario id before its await. A switch or a restart bumps
  // the counter; an answer that lands after the bump is stale and discarded.
  let generation = 0;
  // F8: the one-shot resume a lower-rendition switch leaves behind — exactly
  // one `seekTo` on the next `playing`, then never again.
  let resumeSeekPending = false;

  function activeRenditions(): readonly DemoRendition[] {
    return presentation !== null && presentation.state === 'playable'
      ? presentation.media.renditions
      : [];
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
    for (const chapter of rendition.chapters) {
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

  /** One support reference per failure episode, from the host's clock. */
  function makeSupportReferenceId(): string {
    return `sup-${now().toString(36)}-${errorCount.toString(36)}`;
  }

  type PlayerFailureReason = MediaErrorReason | InvalidReason | 'superseded';

  function enterError(reason: PlayerFailureReason, kind: 'media' | 'resolve'): void {
    // r6 F4: an error is the person's reality and cancels a pending switch —
    // the offers on it (retry, transcript) are their immediate business, and
    // the picker works from every state (r2's F5) if they still want the
    // switch. The cancellation leaves no half-state: the swap transition is
    // untouched (a cancellation is no swap) and the switch's own late answer
    // is stale from here. A switch's own resolve error is not cancelling
    // itself: `performSwap` cleared the pending switch and recorded the swap
    // before that answer's error ever reaches this line.
    pendingSwitch = null;
    lastErrorKind = kind;
    errorCount += 1;
    // A repeated failure — an error reached again before playback ever
    // resumed — produces the support reference id (D07), stable for the rest
    // of the episode so a person is never handed two ids for one problem.
    if (errorCount >= 2 && supportReferenceId === null) {
      supportReferenceId = makeSupportReferenceId();
    }
    error = { reason, supportReferenceId, offers: offersFor() };
    state = 'error';
  }

  /**
   * Land on a resolved presentation. `keepPosition` preserves the person's
   * place (S1); otherwise the new scenario starts at its own zero. A
   * preserved position is re-checked against the real duration and ignored
   * outside it — never clamped to the end (behaviour 18's rule, held here
   * too because a deep-link position can arrive before the package does).
   */
  function applyPresentation(next: DemoPresentation, keepPosition: boolean): void {
    presentation = next;
    renditionIndex = 0;
    error = null;
    returnState = null;
    interactiveSandbox = null;
    interactiveRefusal = null;
    // F8: a new presentation is a new source — a resume flag left by an older
    // lower-rendition switch is stale and must never fire against it.
    resumeSeekPending = false;
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
      errorCount = 0;
      supportReferenceId = null;
      unplayableReason = null;
      state = 'poster';
      const duration = activeDuration();
      if (duration === null || positionSeconds < 0 || positionSeconds >= duration) {
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
      enterError('superseded', 'resolve');
      return;
    }
    unplayableReason = next.reason;
    enterError(next.reason, 'resolve');
  }

  function applySeek(target: number): void {
    const duration = activeDuration();
    // F11 — two controls, two rules. A scrub can reach the end and stop
    // there, so this bound is `0 <= t <= duration`. A deep link starts a clip
    // — a start at the very end is meaningless — so its fragment bound is
    // `0 <= t < duration` (`./deeplink.ts`). The two rules are deliberate.
    if (duration === null || !Number.isFinite(target) || target < 0 || target > duration) return;
    if (state === 'transcript' || state === 'interactive') {
      // A chapter link from the transcript sheet seeks the real media while
      // the sheet stays open; Close restores the control at the new place.
      media.seekTo(target);
      positionSeconds = target;
      return;
    }
    if (
      state === 'poster' ||
      state === 'playing' ||
      state === 'paused' ||
      state === 'buffering' ||
      state === 'ended' ||
      state === 'seeking'
    ) {
      // F2: where the scrub returns to is captured on the way in. A second
      // seek while already seeking must not re-capture: the state is
      // 'seeking' now, and the clobber would send a scrub that started during
      // playback back to 'paused' — the UI would lie until the next tap.
      if (state !== 'seeking') {
        seekReturn = state === 'playing' || state === 'buffering' ? 'playing' : 'paused';
      }
      media.seekTo(target);
      positionSeconds = target;
      state = 'seeking';
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
    errorCount = 0;
    supportReferenceId = null;
    scenarioId = swapScenarioId;
    applyPresentation(next, false);
  }

  function snapshot(): DemoPlayerSnapshot {
    const rendition = activeRendition();
    return {
      state,
      scenarioId,
      positionSeconds,
      durationSeconds: rendition === null ? null : rendition.durationSeconds,
      currentChapter: currentChapterOf(rendition),
      renditionIndex,
      pendingSwitchTo: pendingSwitch === null ? null : pendingSwitch.scenarioId,
      swapTransition,
      interactiveSandbox,
      interactiveRefusal,
      error,
      unplayableReason,
      transcriptUrl: transcriptUrlOf(),
      reducedMotion,
    };
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
    if (state !== 'resolve' || resolving) return snapshot();
    resolving = true;
    const capturedScenarioId = scenarioId;
    const capturedGeneration = generation;
    try {
      const next = await resolveOrFailClosed(scenarioId);
      // F1: a switch or a restart landed while this answer was in flight —
      // applying it would put one scenario's presentation under another's id.
      if (answerIsStale(capturedScenarioId, capturedGeneration)) return snapshot();
      applyPresentation(next, true);
      return snapshot();
    } finally {
      resolving = false;
    }
  }

  async function retry(): Promise<DemoPlayerSnapshot> {
    // r6 F5: every public call clears the swap transition on entry (field doc).
    swapTransition = null;
    if (state !== 'error' || resolving) return snapshot();
    if (lastErrorKind === 'media' && activeRendition() !== null) {
      // A failed media request is retried as a media request — real playback
      // of the same source at the preserved position (S1), on the person's
      // explicit tap, never automatically. The overlay goes at once: an
      // error must not outlive its failure — while the failure episode itself
      // continues until playback resumes (the `playing` event ends it), which
      // is what makes a second failure name a support reference id (D07).
      error = null;
      // r5 F3: this seekTo IS the resume. If a lower-rendition switch left
      // the F8 one-shot behind, it is consumed here — or the next `playing`
      // would fire a second seek for one resume.
      resumeSeekPending = false;
      media.seekTo(positionSeconds);
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
      applyPresentation(next, true);
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
    if (next.state === 'playable' && activeRendition() !== null) {
      token.presentation = next;
      // The poster phase is settled by the screen (F5/F7): `poster-ready`
      // crossfades through the poster, `poster-error` completes the swap
      // without one — and if the answer landed first, the swap waits for
      // that verdict rather than wedging.
      if (token.posterReady) performSwap(next, nextScenarioId, true);
      else if (token.posterFailed) performSwap(next, nextScenarioId, false);
      return snapshot();
    }
    // No old media keeps playing through this swap — either nothing plays
    // yet, or the new answer has no poster to wait for — so the swap lands
    // directly: on the new poster, or on the answer's named state. r4 F5:
    // the board's crossfade is for swapping AWAY from playing media; with no
    // old media there is nothing to fade out of and the new poster has not
    // loaded, so the swap is presented as `none` — a screen must never flash
    // an unloaded poster mid-crossfade.
    performSwap(next, nextScenarioId, activeRendition() !== null);
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
      errorCount = 0;
      supportReferenceId = null;
      media.pause();
      media.seekTo(0);
      positionSeconds = 0;
      state = 'poster';
      returnState = null;
      interactiveSandbox = null;
      interactiveRefusal = null;
      // F8: the resume point no longer exists — the place is zero now.
      resumeSeekPending = false;
      return snapshot();
    }
    // The state itself does not move from a named no-media state —
    // `pending` restarts as `pending`. The transcript sheet over one is the
    // single exception to holding still: its return target is cleared here,
    // so it lands back on the named state underneath rather than lingering
    // with a Close that has nowhere to go (r3 F5: the machine never wedges).
    if (state === 'transcript' && returnState !== null) state = returnState;
    returnState = null;
    // r5 F1: when the state stays `error` (the resolve-error, no-rendition
    // case), its error fields stay with it — `error`, `unplayableReason`,
    // `errorCount` and `supportReferenceId` describe the state that stands.
    // Clearing them would hand the screen `{ state: 'error', error: null }`
    // and a blank error overlay. Everywhere else they are stale and cleared
    // (r4 F2's rule).
    if (state !== 'error') {
      error = null;
      errorCount = 0;
      supportReferenceId = null;
    }
    return snapshot();
  }

  function dispatch(event: DemoPlayerEvent): DemoPlayerSnapshot {
    // r6 F5: every public call clears the swap transition on entry (field
    // doc) — a swap performed by THIS dispatch records its own below.
    swapTransition = null;
    switch (event.type) {
      case 'play': {
        if (state === 'poster' || state === 'paused') {
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
        // rendition rather than the old one.
        if (resumeSeekPending) {
          resumeSeekPending = false;
          media.seekTo(positionSeconds);
        }
        // r7 F1: the `playing` event ALWAYS ends the failure episode — the
        // event means the media is playing, which is D07's "playback ever
        // resumed" fact, whatever state the machine is in (the
        // lower-rendition resume arrives here through `poster`/`playing` and
        // never through `buffering`, which is how the episode used to leak).
        // Only the episode counters reset; the error state and its fields
        // are the state's own and are untouched (r5 F1).
        errorCount = 0;
        supportReferenceId = null;
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
          const chapter = rendition.chapters.find((c) => c.label === event.label);
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
            ? presentation.media.interactive
            : null;
        if (interactive === null) {
          interactiveRefusal = 'absent';
          break;
        }
        if (interactive.sandbox.trim() === '') {
          interactiveRefusal = 'sandbox-empty';
          break;
        }
        if (!isHttpsUrl(interactive.url)) {
          interactiveRefusal = 'url-not-https';
          break;
        }
        // Any `allow-same-origin` token is refused outright — with
        // `allow-scripts` or without: it would let the framed page act as
        // this origin: remote code. HTML's sandbox token set is ASCII
        // case-insensitive, so the match is too: `ALLOW-SAME-ORIGIN` and any
        // other casing are the same token and the same refusal.
        const sandboxTokens = interactive.sandbox.trim().toLowerCase().split(/\s+/);
        if (sandboxTokens.includes('allow-same-origin')) {
          interactiveRefusal = 'sandbox-allows-same-origin';
          break;
        }
        interactiveRefusal = null;
        // As the iframe sandbox attribute, canonicalised the way
        // `./schema.ts` normalises the wire value: lowercased,
        // single-space tokens — never a mixed-case string.
        interactiveSandbox = sandboxTokens.join(' ');
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
          enterError(event.reason, 'media');
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
            renditionIndex = best;
            // F8 (owner-flagged): no seekTo here. The port cannot load the new
            // rendition's source — the screen owns sources — so an immediate
            // seek would land on the old one. The machine keeps the resume
            // time itself (D06) and issues exactly one `seekTo` on the next
            // `playing`, when the screen has swapped the source.
            resumeSeekPending = true;
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
        if (state === 'playing' || state === 'buffering') {
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
