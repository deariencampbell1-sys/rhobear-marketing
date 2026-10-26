import { describe, expect, it } from 'vitest';
// W0-05b — the player state machine (behaviour 8 = JOURNEY D01–D08) with
// position preservation. Tests first: this file is committed while
// `src/clients/demo/player.ts` does not exist, so the run is red before any
// implementation exists.
//
// Every fixture here is a fake package (a hand-built DemoPresentation in the
// shapes W0-05a exports) and a fake media element (play/pause/seekTo spies) —
// no real media, no network, no timer. The one real call is the D01 test at
// the bottom, which runs the real W0-05a resolver with no mirror configured
// and proves the machine resolves to the locked footage-pending state.
import {
  createDemoPlayer,
  isMediaErrorReason,
  type DemoMediaElement,
  type DemoPlayer,
  type DemoPlayerEvent,
  type MediaErrorReason,
} from '../src/clients/demo/player';
import { createDemoResolver, type DemoPresentation } from '../src/clients/demo/resolve';
import type { DemoChapter, DemoInteractive, DemoRendition } from '../src/clients/demo/schema';

const PACKAGE_REVISION = 'rev-2026-10-25-1';
const SOURCE_REVISION = 'a'.repeat(40);
const SCENARIO_ID = 'teams-01'; // a board scenario id
const SWITCHED_SCENARIO_ID = 'designs-01'; // a board scenario id
const mediaBase = (scenarioId: string) =>
  `https://media.example.com/demos/${scenarioId}/${PACKAGE_REVISION}`;

const CHAPTERS: readonly DemoChapter[] = [
  { label: 'Preparation', startSeconds: 0 },
  { label: 'The run', startSeconds: 30 },
  { label: 'Review', startSeconds: 37.5 },
];

const INTERACTIVE: DemoInteractive = {
  url: `${mediaBase(SCENARIO_ID)}/artifact.html`,
  sandbox: 'allow-scripts',
};

function rendition(
  width: number,
  height: number,
  durationSeconds: number,
  chapters: readonly DemoChapter[] = CHAPTERS,
): DemoRendition {
  return {
    url: `${mediaBase(SCENARIO_ID)}/clip-${width}.mp4`,
    mime: 'video/mp4',
    width,
    height,
    durationSeconds,
    chapters,
  };
}

/** A fake package: a contract-complete playable presentation, hand-built. */
function playable(
  options: {
    scenarioId?: string;
    renditions?: readonly DemoRendition[];
    interactive?: DemoInteractive | null;
  } = {},
): DemoPresentation {
  const scenarioId = options.scenarioId ?? SCENARIO_ID;
  return {
    state: 'playable',
    scenarioId,
    packageRevision: PACKAGE_REVISION,
    sourceRevision: SOURCE_REVISION,
    contentHash: 'd'.repeat(64),
    source: 'network',
    fetchedAt: 1_000,
    media: {
      renditions: options.renditions ?? [rendition(1280, 720, 42)],
      posterUrl: `${mediaBase(scenarioId)}/poster.png`,
      interactive: options.interactive === undefined ? { ...INTERACTIVE } : options.interactive,
    },
    captionsUrl: `${mediaBase(scenarioId)}/captions.vtt`,
    transcriptUrl: `${mediaBase(scenarioId)}/transcript.html`,
  };
}

const footagePending: DemoPresentation = { state: 'footage-pending', reason: 'footage-pending' };

function revoked(): DemoPresentation {
  return {
    state: 'revoked',
    reason: 'revoked',
    transcriptUrl: `${mediaBase(SCENARIO_ID)}/transcript.html`,
    purgeCached: true,
  };
}

type FakeMedia = DemoMediaElement & { calls: string[] };

function fakeMedia(): FakeMedia {
  const calls: string[] = [];
  return {
    calls,
    play: () => {
      calls.push('play');
    },
    pause: () => {
      calls.push('pause');
    },
    seekTo: (positionSeconds: number) => {
      calls.push(`seekTo:${positionSeconds}`);
    },
  };
}

function stubResolver(byScenarioId: Record<string, DemoPresentation>) {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (scenarioId: string): Promise<DemoPresentation> => {
      calls.push(scenarioId);
      return byScenarioId[scenarioId] ?? footagePending;
    },
  };
}

/** A resolver that answers from a queue per call, repeating its last answer. */
function queuedResolver(queue: readonly DemoPresentation[]) {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (scenarioId: string): Promise<DemoPresentation> => {
      calls.push(scenarioId);
      return queue[Math.min(calls.length - 1, queue.length - 1)];
    },
  };
}

/** A deferred answer, as a real resolve can hang on the network. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * A playing player whose media has failed at position 9 on a two-rendition
 * package: the state `lower-rendition` is taken from (D07).
 */
async function playerInMediaError(): Promise<{ player: DemoPlayer; media: FakeMedia }> {
  const media = fakeMedia();
  const player = createDemoPlayer({
    scenarioId: SCENARIO_ID,
    resolver: stubResolver({
      [SCENARIO_ID]: playable({ renditions: [rendition(1280, 720, 42), rendition(854, 480, 42)] }),
    }),
    media,
    reducedMotion: false,
  });
  await player.start();
  player.dispatch({ type: 'play' });
  player.dispatch({ type: 'timeupdate', positionSeconds: 9 });
  player.dispatch({ type: 'media-error', reason: 'network' });
  expect(player.snapshot().state).toBe('error');
  return { player, media };
}

/** The same, on a single-rendition package: `lower-rendition` has nowhere to go. */
async function playerInMediaErrorSingle(): Promise<{ player: DemoPlayer; media: FakeMedia }> {
  const media = fakeMedia();
  const player = createDemoPlayer({
    scenarioId: SCENARIO_ID,
    resolver: stubResolver({ [SCENARIO_ID]: playable({ renditions: [rendition(1280, 720, 42)] }) }),
    media,
    reducedMotion: false,
  });
  await player.start();
  player.dispatch({ type: 'play' });
  player.dispatch({ type: 'timeupdate', positionSeconds: 9 });
  player.dispatch({ type: 'media-error', reason: 'network' });
  expect(player.snapshot().state).toBe('error');
  return { player, media };
}

/** A started, playing player whose package carries one interactive artifact. */
async function playerWithInteractive(
  sandbox: string,
): Promise<{ player: DemoPlayer; media: FakeMedia }> {
  const media = fakeMedia();
  const player = createDemoPlayer({
    scenarioId: SCENARIO_ID,
    resolver: stubResolver({
      [SCENARIO_ID]: playable({
        interactive: { url: `${mediaBase(SCENARIO_ID)}/artifact.html`, sandbox },
      }),
    }),
    media,
    reducedMotion: false,
  });
  await player.start();
  player.dispatch({ type: 'play' });
  return { player, media };
}

describe('demo player state machine', () => {
  it('behaviour 8 (D01–D08): the machine runs resolve → poster → playing ⇄ paused → ended with the buffering, seeking, transcript, interactive, error, revoked and pending branches', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });

    const seen: string[] = [player.snapshot().state];
    expect(player.snapshot().state).toBe('resolve');
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);

    await player.start();
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('poster');

    player.dispatch({ type: 'play' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('playing');

    player.dispatch({ type: 'pause' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('paused');

    player.dispatch({ type: 'play' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('playing');

    player.dispatch({ type: 'waiting' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('buffering');

    player.dispatch({ type: 'playing' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('playing');

    player.dispatch({ type: 'seek', positionSeconds: 5 });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('seeking');
    player.dispatch({ type: 'seeked' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('playing');

    player.dispatch({ type: 'pause' });
    player.dispatch({ type: 'open-transcript' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('transcript');
    player.dispatch({ type: 'close-transcript' });
    expect(player.snapshot().state).toBe('paused');

    player.dispatch({ type: 'open-interactive' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('interactive');
    player.dispatch({ type: 'close-interactive' });
    expect(player.snapshot().state).toBe('paused');

    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'ended' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('ended');

    player.dispatch({ type: 'media-error', reason: 'network' });
    seen.push(player.snapshot().state);
    expect(player.snapshot().state).toBe('error');

    // The pending branch: the locked footage-pending state and copy.
    const pendingPlayer = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: footagePending }),
      media: fakeMedia(),
      reducedMotion: false,
    });
    await pendingPlayer.start();
    seen.push(pendingPlayer.snapshot().state);
    expect(pendingPlayer.snapshot().state).toBe('pending');
    expect(pendingPlayer.snapshot().unplayableReason).toBe('footage-pending');

    // The revoked branch: playback stopped, transcript kept.
    const revokedPlayer = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: revoked() }),
      media: fakeMedia(),
      reducedMotion: false,
    });
    await revokedPlayer.start();
    seen.push(revokedPlayer.snapshot().state);
    expect(revokedPlayer.snapshot().state).toBe('revoked');
    expect(revokedPlayer.snapshot().unplayableReason).toBe('revoked');
    expect(revokedPlayer.snapshot().transcriptUrl).toBe(
      `${mediaBase(SCENARIO_ID)}/transcript.html`,
    );

    // Every state the board names, and no state it does not: the twelve
    // states of resolve → poster → playing ⇄ paused → ended plus branches.
    expect([...new Set(seen)].sort()).toEqual(
      [
        'buffering',
        'ended',
        'error',
        'interactive',
        'paused',
        'pending',
        'playing',
        'poster',
        'resolve',
        'revoked',
        'seeking',
        'transcript',
      ].sort(),
    );

    // The machine drives the real media element and nothing else.
    for (const call of media.calls) {
      expect(call).toMatch(/^(play|pause|seekTo:)/);
    }
  });

  it('behaviour 9 (D02): reduced motion is an input to the machine — after resolve the default state is poster, autoplay never occurs, and a scenario swap is direct without the crossfade', async () => {
    for (const reducedMotion of [true, false]) {
      const media = fakeMedia();
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({
          [SCENARIO_ID]: playable(),
          [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
        }),
        media,
        reducedMotion,
      });
      await player.start();
      // The default state after resolve is poster — for both settings — and
      // nothing has started playback without an explicit play.
      expect(player.snapshot().state).toBe('poster');
      expect(player.snapshot().reducedMotion).toBe(reducedMotion);
      expect(media.calls).not.toContain('play');

      // Media events describing readiness never play anything either.
      player.dispatch({ type: 'timeupdate', positionSeconds: 1 });
      player.dispatch({ type: 'waiting' });
      player.dispatch({ type: 'playing' });
      player.dispatch({ type: 'poster-ready' });
      expect(media.calls).not.toContain('play');

      // Only an explicit play plays.
      player.dispatch({ type: 'play' });
      expect(media.calls).toContain('play');

      // The reduced-motion input reaches the machine's own behaviour: a
      // scenario swap is direct without the board's crossfade when reduced.
      await player.switchScenario(SWITCHED_SCENARIO_ID);
      player.dispatch({ type: 'poster-ready' });
      expect(player.snapshot().swapTransition).toBe(reducedMotion ? 'none' : 'crossfade');
    }
  });

  it("behaviour 10 (D04): chapter selection seeks to the chapter's real startSeconds and the current chapter comes from media time, never from a timer or fabricated progress", async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().currentChapter?.label).toBe('Preparation');

    // Chapter selection seeks to the chapter's real startSeconds.
    player.dispatch({ type: 'select-chapter', label: 'The run' });
    expect(media.calls).toContain('seekTo:30');
    expect(player.snapshot().positionSeconds).toBe(30);
    player.dispatch({ type: 'seeked' });

    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 37.6 });
    expect(player.snapshot().currentChapter?.label).toBe('Review');
    player.dispatch({ type: 'timeupdate', positionSeconds: 29.9 });
    expect(player.snapshot().currentChapter?.label).toBe('Preparation');
    player.dispatch({ type: 'timeupdate', positionSeconds: 35 });
    expect(player.snapshot().currentChapter?.label).toBe('The run');

    // The chapter and the position move only with media time: nothing else in
    // the machine advances them — no timer, no fabricated job progress.
    player.dispatch({ type: 'pause' });
    player.dispatch({ type: 'waiting' });
    player.dispatch({ type: 'poster-ready' });
    player.dispatch({ type: 'leave' });
    player.dispatch({ type: 'return' });
    expect(player.snapshot().positionSeconds).toBe(35);
    expect(player.snapshot().currentChapter?.label).toBe('The run');

    // A chapter that does not exist is never sought to.
    const callsBefore = media.calls.length;
    player.dispatch({ type: 'select-chapter', label: 'No such chapter' });
    expect(media.calls.length).toBe(callsBefore);
  });

  it('behaviour 11 (S1 / D03): transcript, a brief leave, a retry and the interactive artifact restore the same scenario and position, and only restart() resets to zero', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 17.25 });

    // Opening transcript/proof and closing it.
    player.dispatch({ type: 'open-transcript' });
    player.dispatch({ type: 'close-transcript' });
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().positionSeconds).toBe(17.25);

    // Leaving briefly and returning — the place is kept and nothing autoplays.
    const playsBefore = media.calls.filter((call) => call === 'play').length;
    player.dispatch({ type: 'leave' });
    player.dispatch({ type: 'return' });
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().positionSeconds).toBe(17.25);
    expect(media.calls.filter((call) => call === 'play').length).toBe(playsBefore);

    // Returning from an interactive artifact.
    player.dispatch({ type: 'open-interactive' });
    expect(player.snapshot().state).toBe('interactive');
    player.dispatch({ type: 'close-interactive' });
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().positionSeconds).toBe(17.25);

    // Retrying a failed media request restores the same scenario and position.
    player.dispatch({ type: 'media-error', reason: 'decode' });
    expect(player.snapshot().state).toBe('error');
    await player.retry();
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().positionSeconds).toBe(17.25);
    expect(media.calls).toContain('seekTo:17.25');

    // Only an explicit restart() resets to zero.
    player.restart();
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().positionSeconds).toBe(0);
    expect(player.snapshot().state).toBe('poster');
    expect(media.calls).toContain('seekTo:0');
  });

  it('behaviour 12 (D07): a media error names its actual reason and offers retry, lower rendition and transcript; a repeated failure keeps the scenario and position and yields a support reference id', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable({
          renditions: [rendition(1280, 720, 42), rendition(854, 480, 42)],
        }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 9 });

    // The actual reason, and the three ways out.
    player.dispatch({ type: 'media-error', reason: 'decode' });
    expect(player.snapshot().state).toBe('error');
    expect(player.snapshot().error?.reason).toBe('decode');
    expect(player.snapshot().error?.offers).toEqual(['retry', 'lower-rendition', 'transcript']);
    expect(player.snapshot().error?.supportReferenceId).toBeNull();
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().positionSeconds).toBe(9);

    // A decode error followed by a retry that fails again: the scenario and
    // the position survive, and a support reference id is produced.
    await player.retry();
    expect(player.snapshot().state).toBe('buffering');
    const callsBefore = media.calls.length;
    player.dispatch({ type: 'media-error', reason: 'http-503' });
    expect(player.snapshot().state).toBe('error');
    expect(player.snapshot().error?.reason).toBe('http-503');
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().positionSeconds).toBe(9);
    const supportId = player.snapshot().error?.supportReferenceId;
    expect(supportId).toMatch(/^sup-[0-9a-z]+-[0-9a-z]+$/);
    // Stable across reads — one reference per failure episode.
    expect(player.snapshot().error?.supportReferenceId).toBe(supportId);

    // It never silently switches to another rendition's poster and calls it
    // playback: the rendition is unchanged, no state claims playback, and the
    // failure itself triggered no media call.
    expect(player.snapshot().renditionIndex).toBe(0);
    expect(player.snapshot().state).toBe('error');
    expect(media.calls.length).toBe(callsBefore);

    // The offered lower rendition is a real, explicit choice that keeps the
    // position — the smaller of the two fake renditions.
    player.dispatch({ type: 'lower-rendition' });
    expect(player.snapshot().renditionIndex).toBe(1);
    expect(player.snapshot().state).toBe('poster');
    expect(player.snapshot().positionSeconds).toBe(9);
  });

  it('behaviour 13 (D04): switching scenario keeps the old scenario playing until the new poster is ready, then swaps with no blank frame', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 6 });

    await player.switchScenario(SWITCHED_SCENARIO_ID);
    // The old scenario is still playing: nothing paused, nothing swapped.
    expect(player.snapshot().state).toBe('playing');
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().positionSeconds).toBe(6);
    expect(player.snapshot().pendingSwitchTo).toBe(SWITCHED_SCENARIO_ID);
    expect(media.calls).not.toContain('pause');

    // The new poster is ready: one atomic swap, old media stopped at that
    // moment — never a blank frame between the two.
    player.dispatch({ type: 'poster-ready' });
    expect(player.snapshot().state).toBe('poster');
    expect(player.snapshot().scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(player.snapshot().pendingSwitchTo).toBeNull();
    expect(media.calls).toContain('pause');
  });

  it('behaviour 14 (D03): ended is distinct from paused, and re-play from ended restarts at zero without losing the chosen scenario', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'ended' });
    expect(player.snapshot().state).toBe('ended');

    // ended is not paused, and a pause cannot fold it into paused.
    player.dispatch({ type: 'pause' });
    expect(player.snapshot().state).toBe('ended');

    // Re-play from ended restarts at zero and keeps the chosen scenario.
    player.dispatch({ type: 'play' });
    expect(player.snapshot().state).toBe('playing');
    expect(player.snapshot().positionSeconds).toBe(0);
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(media.calls).toContain('seekTo:0');
  });

  it('behaviour 15 (D05): an interactive package is used only with a non-empty sandbox and an https URL — otherwise the video path is used and the reason is recorded, with no remote code', async () => {
    // The accepted case: the sandbox is applied verbatim and never contains
    // allow-same-origin — no remote code, and the machine spends nothing.
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'open-interactive' });
    expect(player.snapshot().state).toBe('interactive');
    expect(player.snapshot().interactiveSandbox).toBe('allow-scripts');
    expect(player.snapshot().interactiveSandbox).not.toMatch(/allow-same-origin/);
    expect(player.snapshot().interactiveRefusal).toBeNull();
    player.dispatch({ type: 'close-interactive' });
    expect(player.snapshot().positionSeconds).toBe(0);

    // Each refused case: the video path is used and the reason is recorded.
    const refusals: ReadonlyArray<{
      interactive: DemoInteractive | null;
      reason: string;
    }> = [
      { interactive: null, reason: 'absent' },
      { interactive: { url: `${mediaBase(SCENARIO_ID)}/artifact.html`, sandbox: '   ' }, reason: 'sandbox-empty' },
      {
        interactive: {
          url: `http://media.example.com/demos/${SCENARIO_ID}/${PACKAGE_REVISION}/artifact.html`,
          sandbox: 'allow-scripts',
        },
        reason: 'url-not-https',
      },
      {
        interactive: {
          url: `${mediaBase(SCENARIO_ID)}/artifact.html`,
          sandbox: 'allow-scripts allow-same-origin',
        },
        reason: 'sandbox-allows-same-origin',
      },
    ];
    for (const refusal of refusals) {
      const refusalMedia = fakeMedia();
      const refusalPlayer = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({
          [SCENARIO_ID]: playable({ interactive: refusal.interactive }),
        }),
        media: refusalMedia,
        reducedMotion: false,
      });
      await refusalPlayer.start();
      refusalPlayer.dispatch({ type: 'play' });
      const callsBefore = refusalMedia.calls.length;
      refusalPlayer.dispatch({ type: 'open-interactive' });
      // The video path is used: still playing, nothing paused or fetched.
      expect(refusalPlayer.snapshot().state).toBe('playing');
      expect(refusalPlayer.snapshot().interactiveRefusal).toBe(refusal.reason);
      expect(refusalPlayer.snapshot().interactiveSandbox).toBeNull();
      expect(refusalMedia.calls.length).toBe(callsBefore);
    }

    // The media element is the machine's only port: play, pause, seekTo and
    // nothing else — no remote code path, no account call.
    for (const call of media.calls) {
      expect(call).toMatch(/^(play|pause|seekTo:)/);
    }
  });

  it('F1 (behaviour 15): the sandbox guard is ASCII case-insensitive — ALLOW-SAME-ORIGIN is refused to the video path, the reason recorded, the iframe sandbox never populated', async () => {
    const { player, media } = await playerWithInteractive('ALLOW-SAME-ORIGIN');
    const callsBefore = media.calls.length;
    player.dispatch({ type: 'open-interactive' });
    // The video path is used: still playing, nothing paused or fetched.
    expect(player.snapshot().state).toBe('playing');
    expect(player.snapshot().interactiveRefusal).toBe('sandbox-allows-same-origin');
    expect(player.snapshot().interactiveSandbox).toBeNull();
    expect(media.calls.length).toBe(callsBefore);
  });

  it('F1 (behaviour 15): the sandbox guard refuses Allow-Same-Origin — the reason recorded, the iframe sandbox never populated', async () => {
    const { player, media } = await playerWithInteractive('Allow-Same-Origin');
    const callsBefore = media.calls.length;
    player.dispatch({ type: 'open-interactive' });
    expect(player.snapshot().state).toBe('playing');
    expect(player.snapshot().interactiveRefusal).toBe('sandbox-allows-same-origin');
    expect(player.snapshot().interactiveSandbox).toBeNull();
    expect(media.calls.length).toBe(callsBefore);
  });

  it('F1 (behaviour 15): the sandbox guard refuses the mixed-case token inside a multi-token string — `allow-scripts ALLOW-SAME-ORIGIN` never becomes an iframe', async () => {
    const { player, media } = await playerWithInteractive('allow-scripts ALLOW-SAME-ORIGIN');
    const callsBefore = media.calls.length;
    player.dispatch({ type: 'open-interactive' });
    expect(player.snapshot().state).toBe('playing');
    expect(player.snapshot().interactiveRefusal).toBe('sandbox-allows-same-origin');
    expect(player.snapshot().interactiveSandbox).toBeNull();
    expect(media.calls.length).toBe(callsBefore);
  });

  it('F1 (behaviour 15): an accepted sandbox is applied canonicalised — lowercased tokens, never the mixed-case original', async () => {
    const { player } = await playerWithInteractive('Allow-Forms ALLOW-SCRIPTS');
    player.dispatch({ type: 'open-interactive' });
    expect(player.snapshot().state).toBe('interactive');
    expect(player.snapshot().interactiveSandbox).toBe('allow-forms allow-scripts');
    expect(player.snapshot().interactiveRefusal).toBeNull();
  });

  it('F2 (behaviour 12): a successful media retry clears the error — no error outlives its failure', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'media-error', reason: 'decode' });
    expect(player.snapshot().error).not.toBeNull();

    // The retry succeeds: playback resumes and the overlay is gone.
    await player.retry();
    expect(player.snapshot().state).toBe('buffering');
    expect(player.snapshot().error).toBeNull();
    player.dispatch({ type: 'playing' });
    expect(player.snapshot().state).toBe('playing');
    expect(player.snapshot().error).toBeNull();
  });

  it("F3 (behaviour 12): a superseded resolve lands in error carrying 'superseded', and retry() re-resolves onto the new presentation", async () => {
    const media = fakeMedia();
    const resolver = queuedResolver([
      { state: 'superseded', reason: 'superseded' },
      playable(),
    ]);
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver,
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('error');
    expect(player.snapshot().error?.reason).toBe('superseded');
    expect(player.snapshot().unplayableReason).toBe('superseded');
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);

    // retry() takes the resolve branch and lands on the new presentation.
    const settled = await player.retry();
    expect(settled.state).toBe('poster');
    expect(resolver.calls).toEqual([SCENARIO_ID, SCENARIO_ID]);
    expect(player.snapshot().error).toBeNull();
    expect(player.snapshot().unplayableReason).toBeNull();
  });

  it('F3 (behaviour 12): an invalid resolve lands in error carrying its InvalidReason, and retry() re-resolves onto the new presentation', async () => {
    const media = fakeMedia();
    const resolver = queuedResolver([
      { state: 'invalid', reason: 'hash-mismatch' },
      playable(),
    ]);
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver,
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('error');
    expect(player.snapshot().error?.reason).toBe('hash-mismatch');
    expect(player.snapshot().unplayableReason).toBe('hash-mismatch');

    const settled = await player.retry();
    expect(settled.state).toBe('poster');
    expect(resolver.calls).toEqual([SCENARIO_ID, SCENARIO_ID]);
    expect(player.snapshot().error).toBeNull();
  });

  it('F4 (behaviour 13): switching to a revoked scenario pauses the old media and lands on revoked — pendingSwitchTo cleared, scenario switched', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: revoked(),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const callsBefore = media.calls.length;
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    // The old media played until this instant; the swap lands on the named state.
    expect(media.calls.slice(callsBefore)).toContain('pause');
    expect(player.snapshot().state).toBe('revoked');
    expect(player.snapshot().unplayableReason).toBe('revoked');
    expect(player.snapshot().pendingSwitchTo).toBeNull();
    expect(player.snapshot().scenarioId).toBe(SWITCHED_SCENARIO_ID);
  });

  it('F4 (behaviour 13): switching to a footage-pending scenario pauses the old media and lands on pending — pendingSwitchTo cleared, scenario switched', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: footagePending,
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const callsBefore = media.calls.length;
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(media.calls.slice(callsBefore)).toContain('pause');
    expect(player.snapshot().state).toBe('pending');
    expect(player.snapshot().unplayableReason).toBe('footage-pending');
    expect(player.snapshot().pendingSwitchTo).toBeNull();
    expect(player.snapshot().scenarioId).toBe(SWITCHED_SCENARIO_ID);
  });

  it('F5 (behaviour 13): the picker works from every state — a switch from pending resolves onto the new scenario, with no media to pause', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('pending');
    const settled = await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(settled.state).toBe('poster');
    expect(player.snapshot().scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(player.snapshot().pendingSwitchTo).toBeNull();
    // No old media: the swap must not pause a null port.
    expect(media.calls).not.toContain('pause');
  });

  it('F5 (behaviour 13): the picker works from revoked too — a switch resolves onto the new scenario state', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: revoked(),
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('revoked');
    const settled = await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(settled.state).toBe('poster');
    expect(player.snapshot().scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(player.snapshot().pendingSwitchTo).toBeNull();
    expect(media.calls).not.toContain('pause');
  });

  it('F5 (behaviour 13): the picker works from a resolve-error too — a switch resolves onto the new scenario state', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: { state: 'invalid', reason: 'hash-mismatch' },
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('error');
    const settled = await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(settled.state).toBe('poster');
    expect(player.snapshot().scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(player.snapshot().pendingSwitchTo).toBeNull();
    expect(media.calls).not.toContain('pause');
  });

  it('F6 (D01): an in-flight guard — two concurrent start() calls resolve once and the second returns the snapshot unchanged', async () => {
    const media = fakeMedia();
    let invocations = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: async (scenarioId: string): Promise<DemoPresentation> => {
          invocations += 1;
          await gate;
          return playable({ scenarioId });
        },
      },
      media,
      reducedMotion: false,
    });
    const first = player.start();
    const second = player.start();
    // The second call in flight must not reset the state.
    expect(player.snapshot().state).toBe('resolve');
    release();
    const settled = await first;
    const unchanged = await second;
    expect(settled.state).toBe('poster');
    expect(unchanged.state).toBe('resolve');
    // The resolver ran exactly once: no race on applyPresentation.
    expect(invocations).toBe(1);
    expect(player.snapshot().state).toBe('poster');
  });

  it('F6 (D07): an in-flight guard on retry() — two concurrent retry() calls re-resolve once', async () => {
    const media = fakeMedia();
    let invocations = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: async (scenarioId: string): Promise<DemoPresentation> => {
          invocations += 1;
          if (invocations > 1) await gate;
          return invocations === 1
            ? { state: 'invalid', reason: 'hash-mismatch' }
            : playable({ scenarioId });
        },
      },
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('error');
    const first = player.retry();
    const second = player.retry();
    expect(player.snapshot().state).toBe('error');
    release();
    const settled = await first;
    expect(settled.state).toBe('poster');
    const unchanged = await second;
    expect(unchanged.state).toBe('error');
    // The start resolve plus exactly one retry resolve — never two.
    expect(invocations).toBe(2);
  });

  it('F7 (D06/D03): a chapter selected from the open transcript seeks the real media and leaves the sheet open; leave from playing and from buffering pauses and lands on paused', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 3 });

    // The transcript is open during playback; a chapter link seeks the real
    // media while the sheet stays open.
    player.dispatch({ type: 'open-transcript' });
    expect(player.snapshot().state).toBe('transcript');
    player.dispatch({ type: 'select-chapter', label: 'The run' });
    expect(media.calls).toContain('seekTo:30');
    expect(player.snapshot().state).toBe('transcript');
    expect(player.snapshot().positionSeconds).toBe(30);

    // Close, then leave from playing.
    player.dispatch({ type: 'close-transcript' });
    player.dispatch({ type: 'play' });
    const callsBeforeLeave = media.calls.length;
    player.dispatch({ type: 'leave' });
    expect(media.calls.slice(callsBeforeLeave)).toContain('pause');
    expect(player.snapshot().state).toBe('paused');

    // Leave from buffering.
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'waiting' });
    expect(player.snapshot().state).toBe('buffering');
    const callsBeforeBufferingLeave = media.calls.length;
    player.dispatch({ type: 'leave' });
    expect(media.calls.slice(callsBeforeBufferingLeave)).toContain('pause');
    expect(player.snapshot().state).toBe('paused');
  });

  it('F9 (D04): restart() clears the swapTransition — a screen never re-applies an animation for a swap that did not happen', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    player.dispatch({ type: 'poster-ready' });
    expect(player.snapshot().swapTransition).toBe('crossfade');
    player.restart();
    expect(player.snapshot().swapTransition).toBeNull();
  });

  it('D01 edge: with no mirror configured the machine resolves to footage-pending and never touches a media element', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      // The real W0-05a resolver, unconfigured: no fetch, no guess, no stand-in.
      resolver: createDemoResolver({}),
      media,
      reducedMotion: true,
    });
    await player.start();
    expect(player.snapshot().state).toBe('pending');
    expect(player.snapshot().unplayableReason).toBe('footage-pending');
    expect(player.snapshot().durationSeconds).toBeNull();
    expect(media.calls).toEqual([]);
  });
});

// W0-05b-r3 — Apollo's second review of PR #64 (2026-10-26 07:13Z), twelve
// findings. The tests for F4 and F5 pin the two owner-flagged decisions: a
// rejected resolve is the resolver's own fail-closed answer (`footage-pending`,
// the exact presentation `resolve()` returns whenever the package cannot be
// gotten), and a failed poster load must never wedge a swap (one screen event,
// `poster-error`, completes it without the crossfade).
describe('demo player state machine — W0-05b-r3 (Apollo\'s second review)', () => {
  it('r3 F1 (D01/D04): a start() whose resolve lands after a completed switchScenario applies nothing — the snapshot shows the switched scenario and its presentation', async () => {
    const media = fakeMedia();
    const stale = deferred<DemoPresentation>();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: (scenarioId: string): Promise<DemoPresentation> =>
          scenarioId === SCENARIO_ID
            ? stale.promise
            : Promise.resolve(playable({ scenarioId, renditions: [rendition(640, 360, 99)] })),
      },
      media,
      reducedMotion: false,
    });
    const started = player.start(); // the first scenario's answer hangs
    const switched = await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(switched.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(switched.state).toBe('poster');
    // The stale answer arrives late: footage-pending, which would move the
    // machine to pending and name the wrong scenario's fate if it applied.
    stale.resolve(footagePending);
    await started;
    const after = player.snapshot();
    expect(after.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(after.state).toBe('poster');
    expect(after.unplayableReason).toBeNull();
    expect(after.durationSeconds).toBe(99);
    expect(after.pendingSwitchTo).toBeNull();
  });

  it("r3 F1 (D07/D04): a retry() resolve that lands after a completed switchScenario is discarded the same way", async () => {
    const media = fakeMedia();
    const stale = deferred<DemoPresentation>();
    let calls = 0;
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: (scenarioId: string): Promise<DemoPresentation> => {
          calls += 1;
          if (scenarioId === SWITCHED_SCENARIO_ID) {
            return Promise.resolve(
              playable({ scenarioId, renditions: [rendition(640, 360, 99)] }),
            );
          }
          return calls === 1
            ? Promise.resolve({ state: 'invalid', reason: 'hash-mismatch' })
            : stale.promise;
        },
      },
      media,
      reducedMotion: false,
    });
    await player.start(); // invalid → error: the resolve branch of retry()
    expect(player.snapshot().state).toBe('error');
    const retried = player.retry(); // the re-resolve hangs
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    stale.resolve(footagePending);
    await retried;
    const after = player.snapshot();
    expect(after.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(after.state).toBe('poster');
    expect(after.unplayableReason).toBeNull();
    expect(after.durationSeconds).toBe(99);
  });

  it('r3 F1 (D01): the plain case — a start() with no race applies the presentation', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    const settled = await player.start();
    expect(settled.state).toBe('poster');
    expect(settled.scenarioId).toBe(SCENARIO_ID);
    expect(settled.durationSeconds).toBe(42);
    expect(settled.unplayableReason).toBeNull();
  });

  it('r3 F1 edge: a stale answer arriving after restart() is discarded — and a later start() still lands', async () => {
    const media = fakeMedia();
    const stale = deferred<DemoPresentation>();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: { resolve: () => stale.promise },
      media,
      reducedMotion: false,
    });
    const started = player.start();
    player.restart(); // restart lands while the answer is in flight
    stale.resolve(footagePending);
    await started;
    expect(player.snapshot().state).toBe('resolve');
    expect(player.snapshot().unplayableReason).toBeNull();
    // Nothing dangles: the machine resolves again on a later start().
    await player.start();
    expect(player.snapshot().state).toBe('pending');
    expect(player.snapshot().unplayableReason).toBe('footage-pending');
  });

  it("r3 F1 edge: stale answers arriving after a second switchScenario are discarded — the condemned switch's and a plain start's alike", async () => {
    const media = fakeMedia();
    const staleStart = deferred<DemoPresentation>();
    const staleSwitch = deferred<DemoPresentation>();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: (scenarioId: string): Promise<DemoPresentation> => {
          if (scenarioId === SCENARIO_ID) return staleStart.promise;
          if (scenarioId === SWITCHED_SCENARIO_ID) return staleSwitch.promise;
          return Promise.resolve(playable({ scenarioId, renditions: [rendition(640, 360, 77)] }));
        },
      },
      media,
      reducedMotion: false,
    });
    const plainStart = player.start(); // hangs (the first scenario)
    const firstSwitch = player.switchScenario(SWITCHED_SCENARIO_ID); // hangs
    const secondSwitch = await player.switchScenario('forge-01'); // lands
    expect(secondSwitch.scenarioId).toBe('forge-01');
    staleStart.resolve(footagePending);
    staleSwitch.resolve(footagePending);
    await plainStart;
    await firstSwitch;
    const after = player.snapshot();
    expect(after.scenarioId).toBe('forge-01');
    expect(after.state).toBe('poster');
    expect(after.unplayableReason).toBeNull();
    expect(after.durationSeconds).toBe(77);
    expect(after.pendingSwitchTo).toBeNull();
  });

  it('r3 F2 (behaviour 8): a second seek while already seeking does not clobber where the scrub returns to — two seeks from playing land back on playing, two from paused on paused', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();

    // Two seeks from playing, one seeked: playback continues.
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'seek', positionSeconds: 5 });
    player.dispatch({ type: 'seek', positionSeconds: 9 });
    expect(player.snapshot().state).toBe('seeking');
    player.dispatch({ type: 'seeked' });
    expect(player.snapshot().state).toBe('playing');

    // The mirror: two seeks from paused, one seeked: still paused.
    player.dispatch({ type: 'pause' });
    player.dispatch({ type: 'seek', positionSeconds: 5 });
    player.dispatch({ type: 'seek', positionSeconds: 9 });
    player.dispatch({ type: 'seeked' });
    expect(player.snapshot().state).toBe('paused');
  });

  it('r3 F3 (behaviour 13): switchScenario refuses a scenario id the board does not have — the snapshot is unchanged, the resolver is never called, no pending switch', async () => {
    const media = fakeMedia();
    const resolver = stubResolver({ [SCENARIO_ID]: playable() });
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver,
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const before = player.snapshot();

    // An id shaped like a scenario id but on no board: refused outright.
    const refused = await player.switchScenario('not-a-board-scenario');
    expect(refused).toEqual(before);
    expect(player.snapshot()).toEqual(before);
    expect(resolver.calls).toEqual([SCENARIO_ID]);
    expect(player.snapshot().pendingSwitchTo).toBeNull();

    // And an id not even shaped like one is refused by the same guard.
    const unshaped = await player.switchScenario('NOT-A-BOARD-SCENARIO');
    expect(unshaped).toEqual(before);
    expect(resolver.calls).toEqual([SCENARIO_ID]);
  });

  it("r3 F4 (D01): a rejecting resolver in start() is the resolver's own fail-closed answer — footage-pending lands as pending and no rejection reaches the UI", async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: (): Promise<DemoPresentation> =>
          Promise.reject(new Error('the mirror is unreachable')),
      },
      media,
      reducedMotion: false,
    });
    // The await is the proof: the promise resolves, it never rejects.
    const settled = await player.start();
    expect(settled.state).toBe('pending');
    expect(settled.unplayableReason).toBe('footage-pending');
    expect(settled.pendingSwitchTo).toBeNull();
  });

  it('r3 F4 (D07): a rejecting resolver in retry() fails closed the same way', async () => {
    const media = fakeMedia();
    let calls = 0;
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: (): Promise<DemoPresentation> => {
          calls += 1;
          return calls === 1
            ? Promise.resolve({ state: 'invalid', reason: 'hash-mismatch' })
            : Promise.reject(new Error('the mirror is unreachable'));
        },
      },
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('error');
    const settled = await player.retry();
    expect(settled.state).toBe('pending');
    expect(settled.unplayableReason).toBe('footage-pending');
    expect(settled.pendingSwitchTo).toBeNull();
  });

  it("r3 F4 (behaviour 13): a rejecting resolver in switchScenario() lands on the new scenario's pending state — the pick is honoured and nothing dangles", async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: (scenarioId: string): Promise<DemoPresentation> =>
          scenarioId === SCENARIO_ID
            ? Promise.resolve(playable())
            : Promise.reject(new Error('the mirror is unreachable')),
      },
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const settled = await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(settled.state).toBe('pending');
    expect(settled.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(settled.unplayableReason).toBe('footage-pending');
    expect(settled.pendingSwitchTo).toBeNull();
    // The old media played until this instant — a real swap, not a half one.
    expect(media.calls).toContain('pause');
    // Nothing dangles: an unsolicited poster-ready afterwards changes nothing.
    expect(player.dispatch({ type: 'poster-ready' })).toEqual(settled);
  });

  it('r3 F5 (behaviour 13): poster-error completes a pending swap anyway — the new scenario applies and the swap is presented without the crossfade', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const switched = await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(switched.pendingSwitchTo).toBe(SWITCHED_SCENARIO_ID);
    // The poster failed: no poster to fade through — the swap completes now.
    const settled = player.dispatch({ type: 'poster-error' });
    expect(settled.state).toBe('poster');
    expect(settled.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(settled.swapTransition).toBe('none');
    expect(settled.pendingSwitchTo).toBeNull();
    // After the swap completed, a poster-error is ignored.
    expect(player.dispatch({ type: 'poster-error' })).toEqual(settled);
  });

  it('r3 F5 (behaviour 13): an unsolicited poster-error with no pending swap changes nothing', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const before = player.snapshot();
    expect(player.dispatch({ type: 'poster-error' })).toEqual(before);
    expect(player.snapshot()).toEqual(before);
  });

  it("r3 F5 (behaviour 13): the happy path still crossfades — poster-ready completes the swap with the board's crossfade", async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    const settled = player.dispatch({ type: 'poster-ready' });
    expect(settled.state).toBe('poster');
    expect(settled.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(settled.swapTransition).toBe('crossfade');
    expect(settled.pendingSwitchTo).toBeNull();
  });

  it('r3 F5 (behaviour 9): poster-error under reduced motion behaves the same — the swap completes and there is no crossfade either way', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: true,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    const settled = player.dispatch({ type: 'poster-error' });
    expect(settled.state).toBe('poster');
    expect(settled.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(settled.swapTransition).toBe('none');
    expect(settled.pendingSwitchTo).toBeNull();
  });

  it('r3 F5 (behaviour 13): a poster-error before the answer lands is remembered — the swap completes without the crossfade when it does (never wedge)', async () => {
    const media = fakeMedia();
    const answer = deferred<DemoPresentation>();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: (scenarioId: string): Promise<DemoPresentation> =>
          scenarioId === SCENARIO_ID ? Promise.resolve(playable()) : answer.promise,
      },
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const switching = player.switchScenario(SWITCHED_SCENARIO_ID);
    // The screen knows its poster failed before the answer lands.
    expect(player.dispatch({ type: 'poster-error' }).pendingSwitchTo).toBe(
      SWITCHED_SCENARIO_ID,
    );
    answer.resolve(
      playable({ scenarioId: SWITCHED_SCENARIO_ID, renditions: [rendition(640, 360, 99)] }),
    );
    const settled = await switching;
    expect(settled.state).toBe('poster');
    expect(settled.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(settled.swapTransition).toBe('none');
    expect(settled.pendingSwitchTo).toBeNull();
    expect(settled.durationSeconds).toBe(99);
  });

  it('r3 F6 (behaviour 12): a single-rendition package offers exactly retry and transcript — lower-rendition is never offered when there is none', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable({ renditions: [rendition(1280, 720, 42)] }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'media-error', reason: 'network' });
    expect(player.snapshot().state).toBe('error');
    expect(player.snapshot().error?.offers).toEqual(['retry', 'transcript']);
  });

  it('r3 F7 (behaviour 12): a media-error whose reason is not a MediaErrorReason is ignored — the machine never invents one', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const before = player.snapshot();
    // A screen dispatch is a runtime boundary: this event is malformed as it
    // arrives, and the guard must refuse it without inventing a reason.
    const malformed: DemoPlayerEvent = JSON.parse(
      '{"type":"media-error","reason":"boom"}',
    );
    expect(player.dispatch(malformed)).toEqual(before);
    expect(player.snapshot().state).toBe('playing');
    expect(player.snapshot().error).toBeNull();
  });

  it("r3 F7 (behaviour 13): poster-ready before the switch's resolve completes is remembered — the swap lands when the answer does", async () => {
    const media = fakeMedia();
    const answer = deferred<DemoPresentation>();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: (scenarioId: string): Promise<DemoPresentation> =>
          scenarioId === SCENARIO_ID ? Promise.resolve(playable()) : answer.promise,
      },
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const switching = player.switchScenario(SWITCHED_SCENARIO_ID);
    // The screen's poster is ready before the resolve completes: the flag is
    // remembered and the swap completes when the answer lands.
    expect(player.dispatch({ type: 'poster-ready' }).pendingSwitchTo).toBe(
      SWITCHED_SCENARIO_ID,
    );
    answer.resolve(
      playable({ scenarioId: SWITCHED_SCENARIO_ID, renditions: [rendition(640, 360, 99)] }),
    );
    const settled = await switching;
    expect(settled.state).toBe('poster');
    expect(settled.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(settled.swapTransition).toBe('crossfade');
    expect(settled.pendingSwitchTo).toBeNull();
    expect(settled.durationSeconds).toBe(99);
  });

  it('r3 F8 (behaviour 12): lower-rendition issues no seekTo — the machine keeps the resume time and the screen loads the new source', async () => {
    const { player, media } = await playerInMediaError();
    const callsBefore = media.calls.length;
    player.dispatch({ type: 'lower-rendition' });
    expect(player.snapshot().renditionIndex).toBe(1);
    expect(player.snapshot().state).toBe('poster');
    expect(player.snapshot().positionSeconds).toBe(9);
    // Not one seekTo: an immediate seek would land on the old source.
    expect(media.calls.length).toBe(callsBefore);
  });

  it('r3 F8 (behaviour 12): the playing that follows a lower-rendition issues exactly one seekTo at the kept position', async () => {
    const { player, media } = await playerInMediaError();
    player.dispatch({ type: 'lower-rendition' });
    const callsBefore = media.calls.length;
    player.dispatch({ type: 'playing' });
    expect(media.calls.slice(callsBefore)).toEqual(['seekTo:9']);
  });

  it('r3 F8 (behaviour 12): a later playing does not re-seek — the resume flag is one-shot', async () => {
    const { player, media } = await playerInMediaError();
    player.dispatch({ type: 'lower-rendition' });
    player.dispatch({ type: 'playing' });
    const callsAfterResume = media.calls.length;
    player.dispatch({ type: 'playing' });
    expect(media.calls.length).toBe(callsAfterResume);
  });

  it('r3 F8 (behaviour 12): a new presentation clears a stale resume flag', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable({
          renditions: [rendition(1280, 720, 42), rendition(854, 480, 42)],
        }),
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 9 });
    player.dispatch({ type: 'media-error', reason: 'network' });
    player.dispatch({ type: 'lower-rendition' }); // the resume flag is set
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    player.dispatch({ type: 'poster-ready' }); // a new presentation lands
    const callsBefore = media.calls.length;
    player.dispatch({ type: 'playing' });
    // The flag was stale and is gone: no unrelated later playing re-seeks.
    expect(media.calls.length).toBe(callsBefore);
  });

  it('r3 F11 (behaviour 8): a scrub can reach the end and stop there — a seek to the exact duration seeks', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    // The rendition is 42 s; applySeek's bound is 0 <= t <= duration.
    player.dispatch({ type: 'seek', positionSeconds: 42 });
    expect(player.snapshot().state).toBe('seeking');
    expect(player.snapshot().positionSeconds).toBe(42);
    expect(media.calls).toContain('seekTo:42');
    player.dispatch({ type: 'seeked' });
    expect(player.snapshot().state).toBe('playing');
  });
});

// W0-05b-r4 — the last mile. Apollo's seven non-blocking findings on the r3
// head (2026-10-26 09:19Z) plus three findings from the 07:32:35Z review that
// the r3 round never saw and that are still live in the code. Red first:
// these tests are committed while the bugs still stand.
describe("demo player state machine — W0-05b-r4 (Apollo's last mile)", () => {
  it('r4 F1 (D07): a resolve error whose retry lands playable starts a new failure episode — the first media error after it carries no support reference id', async () => {
    const media = fakeMedia();
    const resolver = queuedResolver([
      { state: 'invalid', reason: 'hash-mismatch' },
      playable(),
    ]);
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver,
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('error');
    await player.retry();
    expect(player.snapshot().state).toBe('poster');
    player.dispatch({ type: 'play' });
    // The person's FIRST media failure: no support reference id. The resolve
    // failure behind them ended when the media became healthy again.
    player.dispatch({ type: 'media-error', reason: 'decode' });
    expect(player.snapshot().state).toBe('error');
    expect(player.snapshot().error?.reason).toBe('decode');
    expect(player.snapshot().error?.supportReferenceId).toBeNull();
  });

  it('r4 F1 (D07): two media failures in one episode still produce a support reference id — the reset does not swallow the repeated-failure rule', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable({ renditions: [rendition(1280, 720, 42), rendition(854, 480, 42)] }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 9 });
    player.dispatch({ type: 'media-error', reason: 'decode' });
    expect(player.snapshot().error?.supportReferenceId).toBeNull();
    await player.retry();
    player.dispatch({ type: 'media-error', reason: 'http-503' });
    expect(player.snapshot().error?.supportReferenceId).toMatch(/^sup-[0-9a-z]+-[0-9a-z]+$/);
  });

  it('r4 F1 (D07): a scenario swap starts a new episode as before — one media error after it carries no support reference id', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'media-error', reason: 'network' });
    expect(player.snapshot().error?.supportReferenceId).toBeNull();
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    player.dispatch({ type: 'poster-ready' });
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'media-error', reason: 'decode' });
    expect(player.snapshot().error?.supportReferenceId).toBeNull();
  });

  it('r4 F2 (D01): restart() from pending clears the stale swap transition and the error fields — pending restarts as pending', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: footagePending,
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(player.snapshot().state).toBe('pending');
    // The swap away from playing media left its transition behind.
    expect(player.snapshot().swapTransition).toBe('crossfade');
    const settled = player.restart();
    expect(settled.state).toBe('pending');
    expect(settled.unplayableReason).toBe('footage-pending');
    expect(settled.swapTransition).toBeNull();
    expect(settled.error).toBeNull();
  });

  it('r4 F2 (D01): restart() from revoked clears the stale swap transition and the error fields — revoked restarts as revoked', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: revoked(),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(player.snapshot().state).toBe('revoked');
    expect(player.snapshot().swapTransition).toBe('crossfade');
    const settled = player.restart();
    expect(settled.state).toBe('revoked');
    expect(settled.unplayableReason).toBe('revoked');
    expect(settled.swapTransition).toBeNull();
    expect(settled.error).toBeNull();
  });

  it('r4 F2 (D01): restart() from the transcript sheet over a named no-media state lands on that state — the cleared return target never wedges Close', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: revoked() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'open-transcript' });
    expect(player.snapshot().state).toBe('transcript');
    const settled = player.restart();
    // The named state stands (revoked restarts as revoked); the sheet lands
    // on it rather than lingering with its return target cleared.
    expect(settled.state).toBe('revoked');
    expect(settled.swapTransition).toBeNull();
    expect(settled.error).toBeNull();
    // Close is never left with nowhere to go.
    expect(player.dispatch({ type: 'close-transcript' }).state).toBe('revoked');
  });

  it('r4 F3: lower-rendition outside state error is a no-op — the state is unchanged and no media call fires', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable({ renditions: [rendition(1280, 720, 42), rendition(854, 480, 42)] }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'lower-rendition' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
    expect(player.snapshot().state).toBe('playing');
  });

  it('r4 F3: lower-rendition in error with no smaller rendition is a no-op — the state is unchanged and no media call fires', async () => {
    const { player, media } = await playerInMediaErrorSingle();
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'lower-rendition' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
    expect(player.snapshot().state).toBe('error');
  });

  it('r4 F3 (07:32 gap): lower-rendition when the rendition is already the smallest is a no-op — the state is unchanged and no media call fires', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable({ renditions: [rendition(1280, 720, 42), rendition(854, 480, 42)] }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'media-error', reason: 'network' });
    player.dispatch({ type: 'lower-rendition' }); // now on the smallest
    expect(player.snapshot().renditionIndex).toBe(1);
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'media-error', reason: 'network' });
    expect(player.snapshot().state).toBe('error');
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'lower-rendition' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
    expect(player.snapshot().renditionIndex).toBe(1);
  });

  it('r4 F3: open-interactive from error is a no-op — the state is unchanged and no media call fires', async () => {
    const { player, media } = await playerInMediaError();
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'open-interactive' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
    expect(player.snapshot().state).toBe('error');
  });

  it('r4 F3: open-interactive from transcript is a no-op — the state is unchanged and no media call fires', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'open-transcript' });
    expect(player.snapshot().state).toBe('transcript');
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'open-interactive' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
    expect(player.snapshot().state).toBe('transcript');
  });

  it('r4 F3: pause during seeking is a no-op — the state is unchanged and no media call fires', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'seek', positionSeconds: 5 });
    expect(player.snapshot().state).toBe('seeking');
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'pause' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
    expect(player.snapshot().state).toBe('seeking');
  });

  it('r4 F3: play during seeking is a no-op — the state is unchanged and no media call fires', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'seek', positionSeconds: 5 });
    expect(player.snapshot().state).toBe('seeking');
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'play' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
    expect(player.snapshot().state).toBe('seeking');
  });

  it('r4 F3: play during buffering is a no-op — the state is unchanged and no media call fires', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'waiting' });
    expect(player.snapshot().state).toBe('buffering');
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'play' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
    expect(player.snapshot().state).toBe('buffering');
  });

  it('r4 F3: pause during buffering is allowed by design — it pauses (pinned so no regression flips it either way)', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'waiting' });
    expect(player.snapshot().state).toBe('buffering');
    const callsBefore = media.calls.length;
    player.dispatch({ type: 'pause' });
    expect(player.snapshot().state).toBe('paused');
    expect(media.calls.slice(callsBefore)).toEqual(['pause']);
  });

  it('r4 F3 (07:32 gap): a timeupdate with a non-finite or negative position is rejected — the state is unchanged and no media call fires', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 5 });
    for (const positionSeconds of [Number.NaN, Number.POSITIVE_INFINITY, -1, -0.5]) {
      const before = player.snapshot();
      const callsBefore = media.calls.length;
      expect(player.dispatch({ type: 'timeupdate', positionSeconds })).toEqual(before);
      expect(media.calls.length).toBe(callsBefore);
    }
    expect(player.snapshot().positionSeconds).toBe(5);
    expect(player.snapshot().state).toBe('playing');
  });

  it('r4 F5 (D04): a swap with no old media presents none — switching from pending to a playable scenario declares no crossfade', async () => {
    // reducedMotion is unaffected: it already forces \'none\' either way.
    for (const reducedMotion of [false, true]) {
      const media = fakeMedia();
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({
          [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
        }),
        media,
        reducedMotion,
      });
      await player.start();
      expect(player.snapshot().state).toBe('pending');
      const settled = await player.switchScenario(SWITCHED_SCENARIO_ID);
      expect(settled.state).toBe('poster');
      expect(settled.swapTransition).toBe('none');
    }
  });

  it('r4 F5 (D04): a swap away from playing media still crossfades — through the new poster and onto a named no-poster state', async () => {
    // Through the new poster.
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(player.dispatch({ type: 'poster-ready' }).swapTransition).toBe('crossfade');

    // And onto a named no-poster state: the old media played until that instant.
    const otherMedia = fakeMedia();
    const other = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: footagePending,
      }),
      media: otherMedia,
      reducedMotion: false,
    });
    await other.start();
    other.dispatch({ type: 'play' });
    const settled = await other.switchScenario(SWITCHED_SCENARIO_ID);
    expect(settled.state).toBe('pending');
    expect(settled.swapTransition).toBe('crossfade');
  });

  it('r4 F6 (D02): a timeupdate past the end clamps to the real duration — positionSeconds never stands beyond it', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 99 });
    expect(player.snapshot().durationSeconds).toBe(42);
    expect(player.snapshot().positionSeconds).toBe(42);
  });

  it('r4 F6 (D02): a timeupdate with no known duration is accepted as it stands — only non-finite and negative are rejected', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: footagePending }),
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().durationSeconds).toBeNull();
    player.dispatch({ type: 'timeupdate', positionSeconds: 5 });
    expect(player.snapshot().positionSeconds).toBe(5);
  });

  it('r4 F9: isMediaErrorReason accepts every http-<integer> the MediaErrorReason type admits — http-0, http-007, http-1000, http-200 — and refuses non-integers', () => {
    // The typed array is the type side of the agreement; the guard is the
    // runtime side. F9: the two must not disagree.
    const typed: readonly MediaErrorReason[] = [
      'decode',
      'network',
      'http-0',
      'http-007',
      'http-1000',
      'http-200',
    ];
    for (const reason of typed) {
      expect(isMediaErrorReason(reason)).toBe(true);
    }
    // The type\'s non-integers are not status codes: refused, as before.
    expect(isMediaErrorReason('http-1.5')).toBe(false);
    // Never a reason: refused, as before.
    expect(isMediaErrorReason('boom')).toBe(false);
    expect(isMediaErrorReason(null)).toBe(false);
  });
});
