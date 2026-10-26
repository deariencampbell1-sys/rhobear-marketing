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
//     `sandbox` is non-empty and its URL is https and the sandbox does not
//     contain `allow-same-origin` beside `allow-scripts` (that pair would let
//     the framed page act as the front-door origin — remote code). Anything
//     else keeps the video path and records the named reason. The sandbox is
//     applied verbatim as the iframe sandbox attribute (as `./schema.ts`
//     pinned it), and the machine itself fetches nothing and spends nothing.
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

import { isScenarioId, type DemoChapter, type DemoRendition } from './schema';
import type { DemoPresentation, InvalidReason } from './resolve';
// The https rule is the release client's, as `./schema.ts` already uses it.
import { isHttpsUrl } from '../release/schema';

/** The media element the machine drives. A screen binds it to the real one. */
export type DemoMediaElement = {
  play(): void;
  pause(): void;
  seekTo(positionSeconds: number): void;
};

/** The actual reason a media request failed (D07): decode, network, http-<status>. */
export type MediaErrorReason = 'decode' | 'network' | `http-${number}`;

const HTTP_STATUS_REASON = /^http-[1-9][0-9]{0,2}$/;

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
  /** How the last completed scenario swap was presented (behaviour 9). */
  swapTransition: 'crossfade' | 'none' | null;
  /** The sandbox to apply verbatim as the iframe sandbox attribute. */
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
  } | null = null;

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
    if (!keepPosition) positionSeconds = 0;
    if (next.state === 'playable') {
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
      seekReturn = state === 'playing' || state === 'buffering' ? 'playing' : 'paused';
      media.seekTo(target);
      positionSeconds = target;
      state = 'seeking';
    }
  }

  function performSwap(next: DemoPresentation, swapScenarioId: string): void {
    // The old media plays until this instant; the swap is one step (no blank
    // frame), and under reduced motion it is presented without the board's
    // crossfade — the reduced-motion input, applied in the machine.
    media.pause();
    pendingSwitch = null;
    swapTransition = reducedMotion ? 'none' : 'crossfade';
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

  async function start(): Promise<DemoPlayerSnapshot> {
    if (state !== 'resolve') return snapshot();
    const next = await config.resolver.resolve(scenarioId);
    applyPresentation(next, true);
    return snapshot();
  }

  async function retry(): Promise<DemoPlayerSnapshot> {
    if (state !== 'error') return snapshot();
    if (lastErrorKind === 'media' && activeRendition() !== null) {
      // A failed media request is retried as a media request — real playback
      // of the same source at the preserved position (S1), on the person's
      // explicit tap, never automatically.
      media.seekTo(positionSeconds);
      media.play();
      state = 'buffering';
      return snapshot();
    }
    const next = await config.resolver.resolve(scenarioId);
    applyPresentation(next, true);
    return snapshot();
  }

  async function switchScenario(nextScenarioId: string): Promise<DemoPlayerSnapshot> {
    if (!isScenarioId(nextScenarioId) || activeRendition() === null) return snapshot();
    const token = {
      scenarioId: nextScenarioId,
      presentation: null as DemoPresentation | null,
      posterReady: false,
    };
    pendingSwitch = token;
    const next = await config.resolver.resolve(nextScenarioId);
    // A newer switch or a restart may have condemned this one meanwhile.
    if (pendingSwitch !== token) return snapshot();
    if (next.state === 'playable') {
      token.presentation = next;
      if (token.posterReady) performSwap(next, nextScenarioId);
      return snapshot();
    }
    // No poster will ever be ready for this answer; the old media played
    // until this instant and the swap lands on the named state.
    performSwap(next, nextScenarioId);
    return snapshot();
  }

  function restart(): DemoPlayerSnapshot {
    if (activeRendition() !== null) {
      media.pause();
      media.seekTo(0);
      positionSeconds = 0;
      state = 'poster';
      error = null;
      errorCount = 0;
      supportReferenceId = null;
      returnState = null;
      interactiveSandbox = null;
      interactiveRefusal = null;
      pendingSwitch = null;
    }
    return snapshot();
  }

  function dispatch(event: DemoPlayerEvent): DemoPlayerSnapshot {
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
        // progress and the current chapter come from.
        if (
          activeRendition() !== null &&
          Number.isFinite(event.positionSeconds) &&
          event.positionSeconds >= 0
        ) {
          positionSeconds = event.positionSeconds;
        }
        break;
      }
      case 'waiting': {
        if (state === 'playing') state = 'buffering';
        break;
      }
      case 'playing': {
        if (state === 'buffering') {
          state = 'playing';
          // Playback resumed: the failure episode is over.
          errorCount = 0;
          supportReferenceId = null;
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
        if (
          transcriptUrlOf() !== null &&
          (state === 'poster' ||
            state === 'playing' ||
            state === 'paused' ||
            state === 'ended' ||
            state === 'error' ||
            state === 'revoked')
        ) {
          returnState = state === 'playing' ? 'paused' : state;
          if (state === 'playing') media.pause();
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
        // `allow-same-origin` beside `allow-scripts` would let the framed
        // page act as this origin: remote code. It is refused outright.
        if (interactive.sandbox.trim().split(/\s+/).includes('allow-same-origin')) {
          interactiveRefusal = 'sandbox-allows-same-origin';
          break;
        }
        if (state === 'poster' || state === 'playing' || state === 'paused' || state === 'ended') {
          interactiveRefusal = null;
          // Verbatim, as `./schema.ts` pinned it: the iframe sandbox attribute.
          interactiveSandbox = interactive.sandbox;
          returnState = state === 'playing' ? 'paused' : state;
          if (state === 'playing') media.pause();
          state = 'interactive';
        }
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
            media.seekTo(positionSeconds);
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
        if (pendingSwitch !== null) {
          pendingSwitch.posterReady = true;
          if (pendingSwitch.presentation !== null) {
            performSwap(pendingSwitch.presentation, pendingSwitch.scenarioId);
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
