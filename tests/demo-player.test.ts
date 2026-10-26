import { describe, expect, it } from 'vitest';
// W0-05b — the player state machine (behaviour 8 = JOURNEY D01–D08) with
// position preservation. Regression provenance: this file began as round
// r1's red suite, committed before `src/clients/demo/player.ts` existed;
// it guards those behaviours now.
//
// Every fixture here is a fake package (a hand-built DemoPresentation in the
// shapes W0-05a exports) and a fake media element (play/pause/seekTo spies) —
// no real media, no network, no timer. The one real call is the D01 test at
// the bottom, which runs the real W0-05a resolver with no mirror configured
// and proves the machine resolves to the locked footage-pending state.
import {
  createDemoPlayer,
  httpReason,
  isMediaErrorReason,
  type DemoMediaElement,
  type DemoPlayer,
  type DemoPlayerEvent,
  type MediaErrorReason,
} from '../src/clients/demo/player';
import { createDemoResolver, type DemoPresentation } from '../src/clients/demo/resolve';
import { parseDemoDeepLink } from '../src/clients/demo/deeplink';
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
    // r8 F7: a fresh copy per rendition — `readonly` is compile-time only,
    // and a shared mutable array handed to every rendition could be mutated
    // through one and seen by all. The fixture is the fix; no test needed.
    chapters: [...chapters],
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

/**
 * r10 F3: the type's http arm is built with `httpReason()` and nothing else —
 * a status this fixture cannot turn into a reason is a broken fixture, and
 * says so loudly.
 */
function mustHttpReason(status: number): MediaErrorReason {
  const reason = httpReason(status);
  if (reason === null) throw new Error(`fixture: httpReason(${status}) is null`);
  return reason;
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
    player.dispatch({ type: 'media-error', reason: mustHttpReason(503) });
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
    // Nothing dangles: an unsolicited poster-ready afterwards changes
    // nothing — r6 F5's field lifecycle aside: the swap transition is non-null
    // exactly in the snapshot returned by the call that performed the swap,
    // so this later dispatch's snapshot carries null where the swap's carried
    // the transition.
    expect(player.dispatch({ type: 'poster-ready' })).toEqual({
      ...settled,
      swapTransition: null,
    });
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
    // After the swap completed, a poster-error is ignored — r6 F5's field
    // lifecycle aside: the very next dispatch's snapshot carries a null swap
    // transition where the swap's own carried 'none'.
    expect(player.dispatch({ type: 'poster-error' })).toEqual({
      ...settled,
      swapTransition: null,
    });
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
// the r3 round never saw. These were the red tests for round r4's fix;
// they guard the regressions now.
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
    player.dispatch({ type: 'media-error', reason: mustHttpReason(503) });
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

  it('r4 F9 (narrowed by r6 F8): isMediaErrorReason accepts the canonical http-<status> members of the MediaErrorReason type — http-0, http-1000, http-200 — and refuses non-integers', () => {
    // The typed array is the type side of the agreement; the guard is the
    // runtime side. F9: the two must not disagree. r6 F8 narrowed the guard
    // to the canonical renderings and reversed the r4 pin on `http-007` —
    // it is a spelling the type does not canonically produce and is refused
    // (pinned in the r6 F8 test below). r10 F3: the http arm is built with
    // `httpReason()` now — the type's members are what that constructor
    // returns (the brand is compile-time only; the runtime strings are
    // unchanged) — and the constructor's accept table and the guard's are
    // pinned together in the r10 F3 tests below.
    const typed: readonly MediaErrorReason[] = [
      'decode',
      'network',
      mustHttpReason(0),
      mustHttpReason(1000),
      mustHttpReason(200),
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

// W0-05b-r5 — Apollo's review of the r4 head (2026-10-26 10:28:23Z): F1 (the
// restart-from-resolve-error snapshot that contradicted itself), F3 (the
// double resume seek after a lower-rendition switch) and F4 (open-interactive
// mutating the snapshot from a state the board does not open it from). These
// are the red tests for round r5's fix; they guard the regressions.
describe("demo player state machine — W0-05b-r5 (Apollo's review of the r4 head)", () => {
  it("r5 F1 (D01): restart() from a resolve-error keeps the error fields — the state stays 'error', the same reason stands, and the stale swap transition is cleared", async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        [SWITCHED_SCENARIO_ID]: { state: 'invalid', reason: 'hash-mismatch' },
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    const before = player.snapshot();
    // A resolve-error with no rendition: the state stays 'error' on restart,
    // and the swap away from playing media left its transition behind.
    expect(before.state).toBe('error');
    expect(before.error?.reason).toBe('hash-mismatch');
    expect(before.swapTransition).toBe('crossfade');

    const settled = player.restart();
    // The error fields describe the state that stays: they are intact — the
    // screen's error overlay renders on state === 'error' and must never be
    // blank. Only the stale swap transition is cleared.
    expect(settled.state).toBe('error');
    expect(settled.error).toEqual(before.error);
    expect(settled.unplayableReason).toBe('hash-mismatch');
    expect(settled.swapTransition).toBeNull();
    // The transcript return target is cleared with it: a Close after the
    // restart has nothing dangling and the snapshot stands unchanged.
    expect(player.dispatch({ type: 'close-transcript' })).toEqual(settled);
  });

  it('r5 F1 edge (D01): restart() from a media error with a rendition lands on poster and clears its error — the intact-error rule is only for a state that stays error', async () => {
    const { player, media } = await playerInMediaError();
    expect(player.snapshot().error?.reason).toBe('network');
    const settled = player.restart();
    expect(settled.state).toBe('poster');
    expect(settled.error).toBeNull();
    expect(settled.unplayableReason).toBeNull();
    expect(settled.positionSeconds).toBe(0);
    expect(media.calls).toContain('seekTo:0');
  });

  it('r5 F3 (behaviour 12): the retry after a lower-rendition switch seeks exactly once — its own seekTo is the resume, and a later playing never re-seeks', async () => {
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
    // The lower-rendition switch leaves the one-shot resume behind (F8) ...
    player.dispatch({ type: 'lower-rendition' });
    expect(player.snapshot().state).toBe('poster');
    // ... and the media fails again before it ever fired.
    player.dispatch({ type: 'media-error', reason: 'decode' });
    expect(player.snapshot().state).toBe('error');

    // The retry's immediate seekTo IS the resume: one seek and one play for
    // the whole resume, and the one-shot is consumed with it.
    const mark = media.calls.length;
    await player.retry();
    expect(player.snapshot().state).toBe('buffering');
    expect(media.calls.slice(mark)).toEqual(['seekTo:9', 'play']);
    // The playing that ends the wait seeks nothing more ...
    player.dispatch({ type: 'playing' });
    expect(player.snapshot().state).toBe('playing');
    expect(media.calls.slice(mark)).toEqual(['seekTo:9', 'play']);
    // ... and neither does any later playing: the one-shot fired exactly
    // once, whether it is consumed by retry() or by the event handler.
    player.dispatch({ type: 'playing' });
    expect(media.calls.slice(mark)).toEqual(['seekTo:9', 'play']);
  });

  // F4: from a state the board does not open an interactive from, whatever
  // the artifact carries, the snapshot is unchanged. These refuse shapes are
  // F1's sandbox refusals from an allowed state — where they still record
  // their reasons (behaviour 15 and the F1 casing tests above).
  const refusedInteractives: ReadonlyArray<{
    interactive: DemoInteractive | null;
    reason: string;
  }> = [
    { interactive: null, reason: 'absent' },
    {
      interactive: { url: `${mediaBase(SCENARIO_ID)}/artifact.html`, sandbox: '   ' },
      reason: 'sandbox-empty',
    },
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

  it('r5 F4 (D05): open-interactive from error is a true no-op — an absent artifact and every refused shape leave the snapshot deep-equal to before', async () => {
    for (const refusal of refusedInteractives) {
      const media = fakeMedia();
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({ [SCENARIO_ID]: playable({ interactive: refusal.interactive }) }),
        media,
        reducedMotion: false,
      });
      await player.start();
      player.dispatch({ type: 'play' });
      player.dispatch({ type: 'media-error', reason: 'network' });
      expect(player.snapshot().state).toBe('error');
      const before = player.snapshot();
      const callsBefore = media.calls.length;
      expect(player.dispatch({ type: 'open-interactive' })).toEqual(before);
      expect(media.calls.length).toBe(callsBefore);
    }
  });

  it('r5 F4 (D05): open-interactive from transcript is a true no-op — the same, whatever the artifact carries', async () => {
    for (const refusal of refusedInteractives) {
      const media = fakeMedia();
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({ [SCENARIO_ID]: playable({ interactive: refusal.interactive }) }),
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
    }
  });
});

// W0-05b-r6 — Apollo's review of the r5 head (2026-10-26 11:10:58Z): F1–F8.
// F1 (the merge blocker) pins the headline feature's integration point end
// to end — `config.positionSeconds` → the initial-position guard →
// `applyPresentation`'s `seekTo(positionSeconds)`. F2 and F4 carry the two
// owner-flagged decisions stated in the task: the transcript/interactive
// sheets are reachable from `buffering` and `seeking` with the `playing`
// rule (paused media, `paused` return — never into a transient state), and a
// media error cancels a pending switch (an error is the person's reality).
// F5 pins the swap transition's lifecycle; F3, F8 pin what was permitted or
// widened but never tested. These were the red tests for round r6's fix;
// they guard the regressions now.
describe("demo player state machine — W0-05b-r6 (Apollo's review of the r5 head)", () => {
  it("r6 F1 (D03/S1): a player constructed with a deep-link position lands the playable resolve at the person's place — media.seekTo(<position>) fires and positionSeconds is preserved", async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
      positionSeconds: 30,
    });
    const settled = await player.start();
    expect(settled.state).toBe('poster');
    expect(settled.scenarioId).toBe(SCENARIO_ID);
    // The headline feature's seek: the machine restores the place on the
    // real media element and the snapshot keeps it.
    expect(media.calls).toContain('seekTo:30');
    expect(settled.positionSeconds).toBe(30);
    expect(settled.durationSeconds).toBe(42);
    // The chapter at that place is derived from media time, as ever.
    expect(settled.currentChapter?.label).toBe('The run');

    // The initial-position guard refuses anything that is not a finite
    // non-negative position: no seek, no preserved place — zero.
    for (const positionSeconds of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const guardedMedia = fakeMedia();
      const guarded = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({ [SCENARIO_ID]: playable() }),
        media: guardedMedia,
        reducedMotion: false,
        positionSeconds,
      });
      const landed = await guarded.start();
      expect(landed.positionSeconds).toBe(0);
      expect(guardedMedia.calls).toEqual([]);
    }
  });

  it("r6 F1 (behaviour 18 edge): a deep-link position out of range for the real duration is reset to 0 — never clamped to the end (the 'never clamped' rule, pinned on the player side)", async () => {
    // The re-check happens when the package is real: the position is ignored
    // outside 0 <= t < duration — at the duration and beyond it alike. It is
    // never clamped to the end and never an error state.
    for (const positionSeconds of [42, 50]) {
      const media = fakeMedia();
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({ [SCENARIO_ID]: playable() }),
        media,
        reducedMotion: false,
        positionSeconds,
      });
      const settled = await player.start();
      expect(settled.state).toBe('poster');
      expect(settled.positionSeconds).toBe(0);
      expect(media.calls).not.toContain('seekTo:42');
      expect(media.calls).not.toContain('seekTo:50');
    }
  });

  it('r6 F1 (behaviour 18→D03): the deep-link position flows end to end through the real parse — parseDemoDeepLink output → config.positionSeconds → the seek', async () => {
    // Nothing is re-typed by hand: the parse's own output constructs the
    // player. The link opens at 30 s on a 42 s package.
    const parsed = parseDemoDeepLink({ pathname: '/engines/teams-01', hash: '#t=30' }, 42);
    expect(parsed.kind).toBe('player');
    const link = parsed.kind === 'player' ? parsed : { scenarioId: SCENARIO_ID, positionSeconds: 30 };
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: link.scenarioId,
      resolver: stubResolver({ [link.scenarioId]: playable({ scenarioId: link.scenarioId }) }),
      media,
      reducedMotion: false,
      positionSeconds: link.positionSeconds ?? undefined,
    });
    const settled = await player.start();
    expect(settled.state).toBe('poster');
    expect(settled.scenarioId).toBe('teams-01');
    expect(media.calls).toContain('seekTo:30');
    expect(settled.positionSeconds).toBe(30);

    // A fragment the parse ignores (out of range for the duration) reaches
    // the player with no position at all: zero, and nothing seeks.
    const ignored = parseDemoDeepLink({ pathname: '/engines/teams-01', hash: '#t=50' }, 42);
    expect(ignored).toEqual({ kind: 'player', scenarioId: 'teams-01', positionSeconds: null });
    const ignoredLink = ignored.kind === 'player' ? ignored : { scenarioId: SCENARIO_ID, positionSeconds: 50 };
    const ignoredMedia = fakeMedia();
    const ignoredPlayer = createDemoPlayer({
      scenarioId: ignoredLink.scenarioId,
      resolver: stubResolver({ [ignoredLink.scenarioId]: playable() }),
      media: ignoredMedia,
      reducedMotion: false,
      positionSeconds: ignoredLink.positionSeconds ?? undefined,
    });
    const ignoredSettled = await ignoredPlayer.start();
    expect(ignoredSettled.positionSeconds).toBe(0);
    expect(ignoredMedia.calls).toEqual([]);
  });

  it('r6 F1 (D03/S1): with keepPosition from a retry the kept place is re-checked against the real duration — preserved inside it (and sought), reset to 0 outside it', async () => {
    // Inside: while a resolve has failed there is no duration to check
    // against, so media time stands (r4 F6's rule) — the place is the
    // person's whatever the machine is showing. The retry's playable landing
    // re-checks the kept position against the real duration and seeks it.
    const insideMedia = fakeMedia();
    const inside = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: queuedResolver([{ state: 'invalid', reason: 'hash-mismatch' }, playable()]),
      media: insideMedia,
      reducedMotion: false,
    });
    await inside.start();
    expect(inside.snapshot().state).toBe('error');
    inside.dispatch({ type: 'timeupdate', positionSeconds: 30 });
    const settled = await inside.retry();
    expect(settled.state).toBe('poster');
    expect(insideMedia.calls).toContain('seekTo:30');
    expect(settled.positionSeconds).toBe(30);
    expect(settled.durationSeconds).toBe(42);

    // Outside the real duration the kept place is reset to 0 — the same
    // 'never clamped to the end' rule the deep link is held to.
    const outsideMedia = fakeMedia();
    const outside = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: queuedResolver([{ state: 'invalid', reason: 'hash-mismatch' }, playable()]),
      media: outsideMedia,
      reducedMotion: false,
    });
    await outside.start();
    outside.dispatch({ type: 'timeupdate', positionSeconds: 50 });
    const landed = await outside.retry();
    expect(landed.state).toBe('poster');
    expect(landed.positionSeconds).toBe(0);
    expect(outsideMedia.calls).not.toContain('seekTo:50');
  });

  it('r6 F2 (behaviour 8): open-transcript from buffering pauses the media and the sheet closes to paused — never back into the transient state', async () => {
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
    const mark = media.calls.length;
    const opened = player.dispatch({ type: 'open-transcript' });
    expect(opened.state).toBe('transcript');
    // The same rule as from playing: the media is paused.
    expect(media.calls.slice(mark)).toEqual(['pause']);
    // returnState resolves to paused: the person resumes with one tap and
    // never lands back in buffering.
    expect(player.dispatch({ type: 'close-transcript' }).state).toBe('paused');
  });

  it('r6 F2 (behaviour 8): open-transcript from seeking pauses the media and closes to paused; the in-flight seeked that lands while the sheet is open changes nothing', async () => {
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
    const mark = media.calls.length;
    const opened = player.dispatch({ type: 'open-transcript' });
    expect(opened.state).toBe('transcript');
    expect(media.calls.slice(mark)).toEqual(['pause']);
    // The in-flight seeked lands while the sheet is open: the sheet state is
    // not the machine's to move — nothing changes.
    const before = player.snapshot();
    expect(player.dispatch({ type: 'seeked' })).toEqual(before);
    expect(player.snapshot()).toEqual(before);
    expect(player.dispatch({ type: 'close-transcript' }).state).toBe('paused');
  });

  it('r6 F2 (D05): open-interactive from buffering pauses the media and the sheet closes to paused — not to buffering', async () => {
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
    const mark = media.calls.length;
    const opened = player.dispatch({ type: 'open-interactive' });
    expect(opened.state).toBe('interactive');
    expect(opened.interactiveSandbox).toBe('allow-scripts');
    expect(media.calls.slice(mark)).toEqual(['pause']);
    // The buffering-opened sheet returns to paused, never back to buffering.
    expect(player.dispatch({ type: 'close-interactive' }).state).toBe('paused');
  });

  it('r6 F2 (D05): open-interactive from seeking pauses the media and closes to paused; the in-flight seeked that lands while the sheet is open changes nothing', async () => {
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
    const mark = media.calls.length;
    const opened = player.dispatch({ type: 'open-interactive' });
    expect(opened.state).toBe('interactive');
    expect(media.calls.slice(mark)).toEqual(['pause']);
    const before = player.snapshot();
    expect(player.dispatch({ type: 'seeked' })).toEqual(before);
    expect(player.snapshot()).toEqual(before);
    expect(player.dispatch({ type: 'close-interactive' }).state).toBe('paused');
  });

  it('r6 F3 (D05): open-interactive from ended is permitted — close returns to ended and the media is untouched', async () => {
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
    expect(player.snapshot().positionSeconds).toBe(42);
    const mark = media.calls.length;
    const opened = player.dispatch({ type: 'open-interactive' });
    expect(opened.state).toBe('interactive');
    expect(opened.interactiveSandbox).toBe('allow-scripts');
    const closed = player.dispatch({ type: 'close-interactive' });
    expect(closed.state).toBe('ended');
    // The media is untouched through the whole round trip: ended stays ended,
    // nothing paused, nothing sought, nothing played.
    expect(closed.positionSeconds).toBe(42);
    expect(media.calls.slice(mark)).toEqual([]);
  });

  it('r6 F4 (behaviour 13): a media error on the old scenario cancels the pending switch — pendingSwitchTo goes null and a late poster-ready does not swap', async () => {
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
    // The switch's answer has landed and waits for the poster verdict.
    await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(player.snapshot().pendingSwitchTo).toBe(SWITCHED_SCENARIO_ID);

    // The old media fails: an error is the person's reality and cancels the
    // switch they may no longer expect. No half-state: the pending target is
    // null, and the cancellation is no swap — no transition of its own.
    const cancelled = player.dispatch({ type: 'media-error', reason: 'network' });
    expect(cancelled.state).toBe('error');
    expect(cancelled.scenarioId).toBe(SCENARIO_ID);
    expect(cancelled.positionSeconds).toBe(6);
    expect(cancelled.pendingSwitchTo).toBeNull();
    expect(cancelled.swapTransition).toBeNull();

    // A late poster-ready must not swap them to a scenario they may no
    // longer expect: the snapshot is unchanged.
    const before = player.snapshot();
    expect(player.dispatch({ type: 'poster-ready' })).toEqual(before);
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().pendingSwitchTo).toBeNull();
  });

  it('r6 F4 (behaviour 13): the cancelled switch leaves no half-state — its own answer landing later is stale and changes nothing', async () => {
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
    player.dispatch({ type: 'timeupdate', positionSeconds: 6 });
    const switching = player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(player.snapshot().pendingSwitchTo).toBe(SWITCHED_SCENARIO_ID);
    const cancelled = player.dispatch({ type: 'media-error', reason: 'decode' });
    expect(cancelled.state).toBe('error');
    expect(cancelled.pendingSwitchTo).toBeNull();
    expect(cancelled.swapTransition).toBeNull();

    // The switch's own answer lands after the cancellation: stale — the
    // world moved — and discarded. Nothing swaps, nothing dangles.
    answer.resolve(playable({ scenarioId: SWITCHED_SCENARIO_ID }));
    const after = await switching;
    expect(after).toEqual(cancelled);
    expect(player.snapshot().scenarioId).toBe(SCENARIO_ID);
    expect(player.snapshot().pendingSwitchTo).toBeNull();
  });

  it("r6 F4 (behaviour 13): a switch whose own resolve lands invalid or superseded completes into the error state with pendingSwitchTo null — the switch's own error is not cancelling itself", async () => {
    const deadAnswers: readonly DemoPresentation[] = [
      { state: 'invalid', reason: 'hash-mismatch' },
      { state: 'superseded', reason: 'superseded' },
    ];
    for (const dead of deadAnswers) {
      const media = fakeMedia();
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({
          [SCENARIO_ID]: playable(),
          [SWITCHED_SCENARIO_ID]: dead,
        }),
        media,
        reducedMotion: false,
      });
      await player.start();
      player.dispatch({ type: 'play' });
      const settled = await player.switchScenario(SWITCHED_SCENARIO_ID);
      // The swap completed — onto the answer's named error state. The error
      // the switch itself carried did not cancel the switch it belongs to.
      expect(settled.state).toBe('error');
      expect(settled.scenarioId).toBe(SWITCHED_SCENARIO_ID);
      expect(settled.pendingSwitchTo).toBeNull();
      expect(settled.error?.reason).toBe(dead.state === 'invalid' ? dead.reason : 'superseded');
      expect(settled.swapTransition).toBe('crossfade');
    }
  });

  it("r6 F5 (D04): the swap transition is non-null exactly in the snapshot returned by the call that performed the swap — the very next dispatch's snapshot carries null", async () => {
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
    const swapped = player.dispatch({ type: 'poster-ready' });
    expect(swapped.swapTransition).toBe('crossfade');
    // The very next dispatch carries null: a screen keying its animation off
    // this field never re-applies it on an unrelated render.
    const next = player.dispatch({ type: 'timeupdate', positionSeconds: 1 });
    expect(next.swapTransition).toBeNull();
  });

  it('r6 F5 (D04): every public call clears the swap transition on entry — start, retry, switchScenario and restart each return null after a swap', async () => {
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
    // One completed swap standing: its own dispatch carried the transition.
    const freshSwap = async (to: string): Promise<void> => {
      await player.switchScenario(to);
      const swapped = player.dispatch({ type: 'poster-ready' });
      expect(swapped.swapTransition).toBe('crossfade');
    };
    await freshSwap(SWITCHED_SCENARIO_ID);
    expect((await player.start()).swapTransition).toBeNull();
    await freshSwap(SCENARIO_ID);
    expect((await player.retry()).swapTransition).toBeNull();
    await freshSwap(SCENARIO_ID);
    expect(player.restart().swapTransition).toBeNull();
    await freshSwap(SWITCHED_SCENARIO_ID);
    const switched = await player.switchScenario(SCENARIO_ID);
    expect(switched.swapTransition).toBeNull();
  });

  it("r6 F5 (D04): the reduced-motion path still returns 'none' on the swap and null after", async () => {
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
    const swapped = player.dispatch({ type: 'poster-ready' });
    expect(swapped.swapTransition).toBe('none');
    expect(player.dispatch({ type: 'timeupdate', positionSeconds: 1 }).swapTransition).toBeNull();
  });

  it('r6 F8 (behaviour 12): isMediaErrorReason accepts exactly the canonical renderings for non-negative integers — http-0, http-200, http-1000 — and refuses http-+200, http--200, http-007 and http-', () => {
    for (const reason of ['decode', 'network', 'http-0', 'http-200', 'http-1000'] as const) {
      expect(isMediaErrorReason(reason)).toBe(true);
    }
    // Signed spellings, leading zeros and an empty number are spellings the
    // type does not canonically produce: never a reason.
    for (const reason of ['http-+200', 'http--200', 'http-007', 'http-', 'http-1.5', 'boom']) {
      expect(isMediaErrorReason(reason)).toBe(false);
    }
  });
});

// W0-05b-r7 — Apollo's review of the r6 head (2026-10-26 12:24:28Z): F1–F3.
// F1 is a D07 contradiction — the lower-rendition resume never closed the
// failure episode, so a later failure handed out a support reference id even
// though playback had resumed. F3 pins three branches nothing asserted. These
// were the red tests for round r7's fix (F1 red-first; F3 tests-only); they
// guard the regressions now.
describe("demo player state machine — W0-05b-r7 (Apollo's review of the r6 head)", () => {
  it('r7 F1 (D07): the lower-rendition resume closes the failure episode — lower-rendition → play → playing → media-error carries no support reference id (the M1 scenario)', async () => {
    const { player } = await playerInMediaError();
    // The person takes the lower rendition (the machine lands on `poster`),
    // plays (the `play` dispatch sets `playing` directly), and the media
    // plays. The `playing` event is the media saying it plays — D07's
    // "playback ever resumed" fact — so it ends the episode whatever state
    // the machine is in; this resume never touches `buffering`, which is
    // exactly how the episode used to leak.
    player.dispatch({ type: 'lower-rendition' });
    expect(player.snapshot().state).toBe('poster');
    player.dispatch({ type: 'play' });
    expect(player.snapshot().state).toBe('playing');
    player.dispatch({ type: 'playing' });

    // A later failure is their FIRST again: playback resumed in between, so
    // D07 forbids a support reference id here. The scenario and the place
    // stand, as ever.
    player.dispatch({ type: 'media-error', reason: 'decode' });
    const snapshot = player.snapshot();
    expect(snapshot.state).toBe('error');
    expect(snapshot.error?.reason).toBe('decode');
    expect(snapshot.error?.supportReferenceId).toBeNull();
    expect(snapshot.scenarioId).toBe(SCENARIO_ID);
    expect(snapshot.positionSeconds).toBe(9);
  });

  it('r7 F1 (D07): two media errors with no playing between them still produce the support reference id — the repeated-failure rule is intact', async () => {
    const { player } = await playerInMediaError();
    // No `playing` in between: the episode never ended, so the second
    // failure is a repeated failure and D07's support reference id stands.
    player.dispatch({ type: 'media-error', reason: 'decode' });
    const snapshot = player.snapshot();
    expect(snapshot.state).toBe('error');
    expect(snapshot.error?.reason).toBe('decode');
    expect(snapshot.error?.supportReferenceId).toMatch(/^sup-[0-9a-z]+-[0-9a-z]+$/);
    expect(snapshot.scenarioId).toBe(SCENARIO_ID);
    expect(snapshot.positionSeconds).toBe(9);
  });

  it('r7 F1 (D07): a playing during buffering behaves as before — buffering → playing and the failure episode is over', async () => {
    const { player } = await playerInMediaError();
    await player.retry();
    expect(player.snapshot().state).toBe('buffering');
    // The old rule's own case: the state moves buffering → playing, and the
    // episode is over — exactly what it did before this round.
    player.dispatch({ type: 'playing' });
    expect(player.snapshot().state).toBe('playing');
    player.dispatch({ type: 'media-error', reason: mustHttpReason(503) });
    const snapshot = player.snapshot();
    expect(snapshot.state).toBe('error');
    expect(snapshot.error?.reason).toBe('http-503');
    expect(snapshot.error?.supportReferenceId).toBeNull();
  });

  it('r7 F3 (behaviour 10): the current chapter is null before the first chapter — a position preceding every startSeconds names no chapter', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable({
          renditions: [
            rendition(1280, 720, 42, [
              { label: 'Preparation', startSeconds: 5 },
              { label: 'The run', startSeconds: 30 },
            ]),
          ],
        }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    // Before every chapter's startSeconds there is no current chapter — the
    // machine names nothing rather than inventing a chapter zero.
    expect(player.snapshot().positionSeconds).toBe(0);
    expect(player.snapshot().currentChapter).toBeNull();
    // The first chapter claims its own start exactly, and the null is not
    // sticky: it is derived from media time on every read.
    player.dispatch({ type: 'timeupdate', positionSeconds: 5 });
    expect(player.snapshot().currentChapter?.label).toBe('Preparation');
    player.dispatch({ type: 'timeupdate', positionSeconds: 4.999 });
    expect(player.snapshot().currentChapter).toBeNull();
  });

  it("r7 F3 (behaviour 8): open-transcript from error closes back to error with the error fields intact — a state keeps its fields (r5 F1's rule)", async () => {
    const { player } = await playerInMediaError();
    // A repeated failure, so the error carries a support reference id too —
    // every field must survive the round trip.
    player.dispatch({ type: 'media-error', reason: 'decode' });
    expect(player.snapshot().error?.supportReferenceId).not.toBeNull();
    const before = player.snapshot();

    const opened = player.dispatch({ type: 'open-transcript' });
    expect(opened.state).toBe('transcript');
    const closed = player.dispatch({ type: 'close-transcript' });
    expect(closed.state).toBe('error');
    // The error fields describe the state that stands and are intact —
    // reason, support reference id, offers, and the preserved place.
    expect(closed.error).toEqual(before.error);
    expect(closed.unplayableReason).toBe(before.unplayableReason);
    expect(closed.scenarioId).toBe(SCENARIO_ID);
    expect(closed.positionSeconds).toBe(9);

    // The other named return targets the sheet opens from hold as well:
    // ended back to ended, paused back to paused.
    const endedMedia = fakeMedia();
    const ended = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media: endedMedia,
      reducedMotion: false,
    });
    await ended.start();
    ended.dispatch({ type: 'play' });
    ended.dispatch({ type: 'ended' });
    expect(ended.snapshot().state).toBe('ended');
    ended.dispatch({ type: 'open-transcript' });
    expect(ended.dispatch({ type: 'close-transcript' }).state).toBe('ended');

    ended.dispatch({ type: 'play' });
    ended.dispatch({ type: 'pause' });
    expect(ended.snapshot().state).toBe('paused');
    ended.dispatch({ type: 'open-transcript' });
    expect(ended.dispatch({ type: 'close-transcript' }).state).toBe('paused');
  });
});

// W0-05b-r8 — Apollo's review of the r7 head (2026-10-26 13:17:35Z).
// F1 is six named transitions/guards with no test — tests-only, one row each,
// pinning behaviour the machine already has. F3 (the lower-rendition re-check
// against the new rendition's duration), F4 (the support reference id
// sequence) and F6 (snapshot() copies) were red-first: these were the red
// tests for round r8's fix; they guard the regressions now. F7's shared
// chapter fixture is fixed in `rendition()` above (fixture-only — the fixture
// is the fix).
describe("demo player state machine — W0-05b-r8 (Apollo's review of the r7 head)", () => {
  it('r8 F1.1 (D05): open-interactive from poster opens the sheet — the guard admits poster — and does not touch the media', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('poster');
    const callsBefore = media.calls.length;
    const opened = player.dispatch({ type: 'open-interactive' });
    expect(opened.state).toBe('interactive');
    expect(media.calls.length).toBe(callsBefore);
  });

  it('r8 F1.2 (D06): open-transcript from poster opens the sheet — the guard admits poster — and does not touch the media', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('poster');
    const callsBefore = media.calls.length;
    const opened = player.dispatch({ type: 'open-transcript' });
    expect(opened.state).toBe('transcript');
    expect(media.calls.length).toBe(callsBefore);
  });

  it('r8 F1.3 (D07): media-error while pending and while revoked is a deep-equal no-op — no error overlay invented, unplayableReason untouched', async () => {
    for (const presentation of [footagePending, revoked()] as const) {
      const media = fakeMedia();
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({ [SCENARIO_ID]: presentation }),
        media,
        reducedMotion: false,
      });
      await player.start();
      expect(['pending', 'revoked']).toContain(player.snapshot().state);
      const before = player.snapshot();
      expect(player.dispatch({ type: 'media-error', reason: 'network' })).toEqual(before);
    }
  });

  it('r8 F1.4 (D03/S1): return with no active rendition is a deep-equal no-op — on pending and on revoked the media port is never touched', async () => {
    for (const presentation of [footagePending, revoked()] as const) {
      const media = fakeMedia();
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({ [SCENARIO_ID]: presentation }),
        media,
        reducedMotion: false,
      });
      await player.start();
      expect(['pending', 'revoked']).toContain(player.snapshot().state);
      const before = player.snapshot();
      expect(player.dispatch({ type: 'return' })).toEqual(before);
    }
  });

  it('r8 F1.5 (D03): ended from paused is a no-op — no media call, the state stays paused', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'pause' });
    expect(player.snapshot().state).toBe('paused');
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'ended' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
  });

  it('r8 F1.6 (behaviour 8): waiting from paused is a no-op — no media call, the state stays paused', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'pause' });
    expect(player.snapshot().state).toBe('paused');
    const before = player.snapshot();
    const callsBefore = media.calls.length;
    expect(player.dispatch({ type: 'waiting' })).toEqual(before);
    expect(media.calls.length).toBe(callsBefore);
  });

  it("r8 F3 (behaviour 12): lower-rendition re-checks the kept place against the NEW rendition's duration — a shorter lower rendition resets the place to 0 and the resume seek is seekTo(0)", async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable({
          renditions: [rendition(1280, 720, 42), rendition(854, 480, 5)],
        }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 9 });
    player.dispatch({ type: 'media-error', reason: 'network' });
    expect(player.snapshot().state).toBe('error');

    player.dispatch({ type: 'lower-rendition' });
    const after = player.snapshot();
    expect(after.state).toBe('poster');
    expect(after.renditionIndex).toBe(1);
    // The snapshot reported positionSeconds 9 on a rendition of 5 s — the
    // resume seekTo(9) would have run past the end of the new source. The
    // kept place is re-checked against the new rendition's real duration and
    // reset outside it — never clamped to its end.
    expect(after.positionSeconds).toBe(0);
    expect(after.durationSeconds).toBe(5);
    // And the one-shot resume seeks to the reset place.
    const mark = media.calls.length;
    player.dispatch({ type: 'playing' });
    expect(media.calls.slice(mark)).toEqual(['seekTo:0']);
  });

  it('r8 F3 edge (behaviour 12): a lower rendition with no known duration keeps the place — a null duration is no bound to re-check against (the rule\'s first arm)', async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable({
          renditions: [
            rendition(1280, 720, 42),
            { ...rendition(854, 480, 42), durationSeconds: null as unknown as number },
          ],
        }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 9 });
    player.dispatch({ type: 'media-error', reason: 'network' });

    player.dispatch({ type: 'lower-rendition' });
    const after = player.snapshot();
    expect(after.renditionIndex).toBe(1);
    // The place stands: with no duration there is no bound to check it
    // against — exactly like a timeupdate with no known duration (r4 F6).
    expect(after.positionSeconds).toBe(9);
    expect(after.durationSeconds).toBeNull();
    const mark = media.calls.length;
    player.dispatch({ type: 'playing' });
    expect(media.calls.slice(mark)).toEqual(['seekTo:9']);
  });

  it('r8 F4 (D07): two failure episodes in the same millisecond hand out different support reference ids — the sequence is module-level and monotonic, and the id is stable within an episode', async () => {
    // Both episodes live in the same millisecond on the stubbed clock.
    const clock = () => 1_000;
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
      now: clock,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 9 });

    // Episode one: two failures with no playback in between (D07).
    player.dispatch({ type: 'media-error', reason: 'decode' });
    player.dispatch({ type: 'media-error', reason: 'network' });
    const first = player.snapshot().error?.supportReferenceId;
    expect(first).toMatch(/^sup-[0-9a-z]+-[0-9a-z]+$/);
    // Stable for the whole episode: one reference per failure episode.
    player.dispatch({ type: 'media-error', reason: mustHttpReason(503) });
    expect(player.snapshot().error?.supportReferenceId).toBe(first);

    // Playback resumes — the episode is over (r7 F1) — and a second episode
    // fails twice in the SAME millisecond. The id is the one value support
    // correlates a report with a failure: the two must differ.
    player.dispatch({ type: 'playing' });
    player.dispatch({ type: 'media-error', reason: 'decode' });
    player.dispatch({ type: 'media-error', reason: 'network' });
    const second = player.snapshot().error?.supportReferenceId;
    expect(second).toMatch(/^sup-[0-9a-z]+-[0-9a-z]+$/);
    expect(second).not.toBe(first);
  });

  it('r8 F6 (D07/D04): snapshot() hands out copies — mutating the returned error or chapter between two reads never changes the next snapshot', async () => {
    const { player } = await playerInMediaError();
    // A repeated failure, so the error carries a support reference id too.
    player.dispatch({ type: 'media-error', reason: 'decode' });
    const first = player.snapshot();
    const expectedId = first.error?.supportReferenceId ?? '';
    const expectedOffers = [...(first.error?.offers ?? [])];
    const expectedLabel = first.currentChapter?.label ?? '';
    const expectedStart = first.currentChapter?.startSeconds ?? -1;
    expect(expectedId).not.toBe('');
    expect(expectedLabel).toBe('Preparation');

    // A screen mutating what it was handed corrupts nothing.
    first.error!.supportReferenceId = 'corrupted';
    (first.error!.offers as unknown as string[]).push('corrupted');
    first.currentChapter!.label = 'Corrupted';
    first.currentChapter!.startSeconds = -1;

    const second = player.snapshot();
    expect(second.error?.supportReferenceId).toBe(expectedId);
    expect(second.error?.offers).toEqual(expectedOffers);
    expect(second.currentChapter?.label).toBe(expectedLabel);
    expect(second.currentChapter?.startSeconds).toBe(expectedStart);
  });
});

// W0-05b-r9 — Apollo's review of the r8 head (2026-10-26 15:11:39Z): one
// contract fix and three soundness fixes, all red-first. F2 breaks the locked
// "nothing is ever thrown into the UI" contract on hand-built presentations
// (TypeError out of dispatch()); F3 leaves a scrubbing clip's audio running
// across a navigate; F4 never checks the answer's own identity, only its
// freshness; F5 can strand the machine in `resolve` with a dropped start().
// F1 (the captions URL guard's third disguise) lives in the captions tests.
describe("demo player state machine — W0-05b-r9 (Apollo's review of the r8 head)", () => {
  it("r9 F2 case 1 (D05): a hand-built presentation with interactive: undefined records the 'absent' refusal and dispatch() returns — no TypeError ever reaches the caller", async () => {
    const media = fakeMedia();
    // A JSON-decoded or hand-built presentation that omits the key: the field
    // is `undefined`, not `null`, and `interactive.sandbox` then dereferenced
    // undefined — a TypeError thrown out of dispatch(), the exact class the
    // guard exists for and a violation of the locked never-throw contract.
    const handBuilt = {
      ...playable({ interactive: null }),
      media: {
        renditions: [rendition(1280, 720, 42)],
        posterUrl: `${mediaBase(SCENARIO_ID)}/poster.png`,
        interactive: undefined,
      },
    } as unknown as DemoPresentation;
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: handBuilt }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const callsBefore = media.calls.length;
    const returned = player.dispatch({ type: 'open-interactive' });
    // The video path is used, the EXISTING 'absent' refusal is recorded (no
    // new value in the frozen vocabulary), and the dispatch RETURNS.
    expect(returned.state).toBe('playing');
    expect(returned.interactiveRefusal).toBe('absent');
    expect(returned.interactiveSandbox).toBeNull();
    expect(media.calls.length).toBe(callsBefore);
  });

  it("r9 F2 case 2 (D05): a sandbox that is missing or not a string records the 'absent' refusal too — the guard reads the shape before it dereferences, never sandbox.trim() on undefined", async () => {
    for (const sandbox of [undefined, 42, null]) {
      const media = fakeMedia();
      const handBuilt = {
        ...playable({ interactive: null }),
        media: {
          renditions: [rendition(1280, 720, 42)],
          posterUrl: `${mediaBase(SCENARIO_ID)}/poster.png`,
          interactive: { url: `${mediaBase(SCENARIO_ID)}/artifact.html`, sandbox },
        },
      } as unknown as DemoPresentation;
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({ [SCENARIO_ID]: handBuilt }),
        media,
        reducedMotion: false,
      });
      await player.start();
      player.dispatch({ type: 'play' });
      const callsBefore = media.calls.length;
      const returned = player.dispatch({ type: 'open-interactive' });
      expect(returned.state).toBe('playing');
      expect(returned.interactiveRefusal).toBe('absent');
      expect(returned.interactiveSandbox).toBeNull();
      expect(media.calls.length).toBe(callsBefore);
    }
  });

  it('r9 F2 case 3 (behaviour 8): renditions: undefined degrades to the empty shape — no duration, no throw — and the legitimate renditions: [] behaves exactly as it always has', async () => {
    for (const renditions of [undefined, []]) {
      const media = fakeMedia();
      const handBuilt = {
        ...playable({ interactive: null }),
        media: {
          renditions,
          posterUrl: `${mediaBase(SCENARIO_ID)}/poster.png`,
          interactive: null,
        },
      } as unknown as DemoPresentation;
      const player = createDemoPlayer({
        scenarioId: SCENARIO_ID,
        resolver: stubResolver({ [SCENARIO_ID]: handBuilt }),
        media,
        reducedMotion: false,
      });
      const settled = await player.start();
      // The empty shape, whatever put it there: the poster with no
      // rendition, exactly the no-renditions behaviour the schema's
      // `empty-renditions` problem already names. The shape guard must not
      // swallow the legitimate `[]` case — both land the same.
      expect(settled.state).toBe('poster');
      expect(settled.durationSeconds).toBeNull();
      expect(settled.currentChapter).toBeNull();
      // A media error concerns media that exists — none is invented — and
      // every dispatch RETURNS: the machine degrades, it does not throw.
      const returned = player.dispatch({ type: 'media-error', reason: 'network' });
      expect(returned.state).toBe('poster');
      expect(returned.error).toBeNull();
      expect(player.dispatch({ type: 'select-chapter', label: 'The run' }).state).toBe('poster');
      expect(player.dispatch({ type: 'open-interactive' })).toMatchObject({
        state: 'poster',
        interactiveRefusal: 'absent',
      });
    }
  });

  it('r9 F2 case 4 (behaviour 10): chapters: undefined degrades to the empty shape — no current chapter, select-chapter never throws and seeks nothing', async () => {
    const media = fakeMedia();
    const handBuilt = {
      ...playable({ interactive: null }),
      media: {
        renditions: [
          {
            url: `${mediaBase(SCENARIO_ID)}/clip-1280.mp4`,
            mime: 'video/mp4',
            width: 1280,
            height: 720,
            durationSeconds: 42,
            chapters: undefined,
          },
        ],
        posterUrl: `${mediaBase(SCENARIO_ID)}/poster.png`,
        interactive: null,
      },
    } as unknown as DemoPresentation;
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: handBuilt }),
      media,
      reducedMotion: false,
    });
    const settled = await player.start();
    expect(settled.state).toBe('poster');
    expect(settled.durationSeconds).toBe(42);
    expect(settled.currentChapter).toBeNull();
    // A chapter selection on the shape never throws and seeks nothing —
    // the machine treats a non-array `chapters` as empty.
    const callsBefore = media.calls.length;
    const returned = player.dispatch({ type: 'select-chapter', label: 'The run' });
    expect(returned.currentChapter).toBeNull();
    expect(media.calls.length).toBe(callsBefore);
    // Media time still runs and stays chapterless.
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'timeupdate', positionSeconds: 35 });
    expect(player.snapshot().currentChapter).toBeNull();
    expect(player.snapshot().positionSeconds).toBe(35);
  });

  it('r9 F3 (behaviour 8/S1): leave while seeking pauses the media and lands on paused — the late seeked keeps paused and never restores playing over a paused element', async () => {
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
    player.dispatch({ type: 'seek', positionSeconds: 20 });
    expect(player.snapshot().state).toBe('seeking');

    // Scrub-then-navigate: the clip's audio must not keep playing on an
    // unrelated screen — leave pauses the media from `seeking` too.
    const callsBefore = media.calls.length;
    const left = player.dispatch({ type: 'leave' });
    expect(media.calls.slice(callsBefore)).toContain('pause');
    expect(left.state).toBe('paused');

    // The in-flight seeked lands late: it must keep `paused`, never restore
    // `playing` over a paused element.
    const beforeSeeked = player.snapshot();
    const seeked = player.dispatch({ type: 'seeked' });
    expect(seeked.state).toBe('paused');
    expect(seeked).toEqual(beforeSeeked);

    // Coming back keeps the place (S1) and never autoplays.
    const playsBefore = media.calls.filter((call) => call === 'play').length;
    player.dispatch({ type: 'return' });
    expect(player.snapshot().state).toBe('paused');
    expect(player.snapshot().positionSeconds).toBe(20);
    expect(media.calls).toContain('seekTo:20');
    expect(media.calls.filter((call) => call === 'play').length).toBe(playsBefore);
  });

  it("r9 F4 (D01): a start() answer whose own scenarioId is not the one asked for fails closed — the footage-pending answer lands pending, never the wrong scenario's poster; the matching case is unchanged", async () => {
    const media = fakeMedia();
    // A resolver/cache bug returning B's presentation under A's id must not
    // be presented as A.
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable({ scenarioId: SWITCHED_SCENARIO_ID }) }),
      media,
      reducedMotion: false,
    });
    const settled = await player.start();
    expect(settled.state).toBe('pending');
    expect(settled.unplayableReason).toBe('footage-pending');
    expect(settled.scenarioId).toBe(SCENARIO_ID);
    expect(settled.durationSeconds).toBeNull();
    expect(media.calls).toEqual([]);

    // The matching case is unchanged: the answer's identity holds and it
    // applies exactly as before.
    const matching = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media: fakeMedia(),
      reducedMotion: false,
    });
    const applied = await matching.start();
    expect(applied.state).toBe('poster');
    expect(applied.durationSeconds).toBe(42);
  });

  it('r9 F4 (D07): a retry() answer with a mismatched identity fails closed the same way', async () => {
    const media = fakeMedia();
    const resolver = queuedResolver([
      { state: 'invalid', reason: 'hash-mismatch' },
      // The queued answer names a DIFFERENT scenario than the one asked for.
      playable({ scenarioId: SWITCHED_SCENARIO_ID }),
    ]);
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver,
      media,
      reducedMotion: false,
    });
    await player.start();
    expect(player.snapshot().state).toBe('error');
    const settled = await player.retry();
    expect(settled.state).toBe('pending');
    expect(settled.unplayableReason).toBe('footage-pending');
    expect(settled.durationSeconds).toBeNull();
    expect(settled.scenarioId).toBe(SCENARIO_ID);
    expect(resolver.calls).toEqual([SCENARIO_ID, SCENARIO_ID]);
  });

  it("r9 F4 (behaviour 13): a switchScenario() answer with a mismatched identity fails closed — pending under the picked scenario, the wrong presentation never swaps in", async () => {
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({
        [SCENARIO_ID]: playable(),
        // The answer to the SWITCH names the OLD scenario.
        [SWITCHED_SCENARIO_ID]: playable({ scenarioId: SCENARIO_ID }),
      }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    const settled = await player.switchScenario(SWITCHED_SCENARIO_ID);
    expect(settled.state).toBe('pending');
    expect(settled.unplayableReason).toBe('footage-pending');
    expect(settled.scenarioId).toBe(SWITCHED_SCENARIO_ID);
    expect(settled.durationSeconds).toBeNull();
    expect(settled.pendingSwitchTo).toBeNull();
  });

  it('r9 F5 (D01): a start() dropped by the in-flight guard is never a strand — restart() mid-flight, the second start() turned away, the stale answer lands and the machine refills the slot with exactly one fresh resolve()', async () => {
    const media = fakeMedia();
    let calls = 0;
    const first = deferred<DemoPresentation>();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: {
        resolve: async (scenarioId: string): Promise<DemoPresentation> => {
          calls += 1;
          return calls === 1 ? first.promise : playable({ scenarioId });
        },
      },
      media,
      reducedMotion: false,
    });
    const started = player.start(); // start() #1 hangs in flight
    player.restart(); // the restart moves the world — #1 is condemned
    const dropped = await player.start(); // start() #2: turned away by the in-flight guard
    expect(dropped.state).toBe('resolve');
    first.resolve(footagePending); // #1's answer lands stale and is discarded

    // The discarded slot is refilled by exactly one fresh resolve() — the
    // machine applies a fresh answer and is not stranded in `resolve` even
    // though the screen's mount effect will not call start() again. The
    // stale footage-pending is never applied under the refilled call.
    const settled = await started;
    expect(calls).toBe(2); // single-flight still holds: never two racing
    expect(settled.state).toBe('poster');
    expect(settled.scenarioId).toBe(SCENARIO_ID);
    expect(settled.unplayableReason).toBeNull();
    expect(player.snapshot().state).toBe('poster');
  });
});

// W0-05b-r10 — Apollo's review of the r9 head (2026-10-26 16:48:29Z). F2 is
// ANSWERED (the sandbox policy is the locked W0-05a schema's — see the round
// comment) with the cheap hardening it asked for beside it: the
// `allow-same-origin` refusal covering decorated spellings, and the
// verbatim-application contract pinned. F3 is the http reason constructor.
// These were the red tests for round r10's fix (the F2 spelling table and the
// F3 tests; F5/F6/F8/F1 live in tests/demo-deeplink.test.ts).
describe("demo player state machine — W0-05b-r10 (Apollo's review of the r9 head)", () => {
  it('r10 F2 (D05): the allow-same-origin refusal covers the case-normalised and whitespace-padded spellings — no decoration of the refused token survives', async () => {
    for (const sandbox of [
      '  ALLOW-SAME-ORIGIN  ',
      '\tallow-same-origin\n',
      'allow-scripts   ALLOW-SAME-ORIGIN   allow-forms',
      'allow-forms \u0000allow-same-origin',
    ]) {
      const { player, media } = await playerWithInteractive(sandbox);
      const callsBefore = media.calls.length;
      player.dispatch({ type: 'open-interactive' });
      expect(player.snapshot().state).toBe('playing');
      expect(player.snapshot().interactiveRefusal).toBe('sandbox-allows-same-origin');
      expect(player.snapshot().interactiveSandbox).toBeNull();
      expect(media.calls.length).toBe(callsBefore);
    }
  });

  it("r10 F2 (D05): the verbatim-application contract holds — every token the schema allows survives to the sandbox string unchanged (the sandbox policy is the schema's, applied verbatim)", async () => {
    // `allow-modals`, `allow-popups-to-escape-sandbox` and
    // `allow-top-navigation` are on the schema's sandbox allow-list by the
    // board's design (`schema.ts`'s SANDBOX_TOKENS, "the known iframe sandbox
    // tokens minus `allow-same-origin`"). A player-side refusal of them would
    // make a schema-valid package render wrongly — the player applies the
    // validated list verbatim, and this test pins that contract.
    const sandbox = 'allow-modals allow-popups-to-escape-sandbox allow-top-navigation';
    const { player } = await playerWithInteractive(sandbox);
    player.dispatch({ type: 'open-interactive' });
    const snapshot = player.snapshot();
    expect(snapshot.state).toBe('interactive');
    expect(snapshot.interactiveRefusal).toBeNull();
    expect(snapshot.interactiveSandbox).toBe(sandbox);
  });

  it('r10 F3 (behaviour 12): httpReason(200) produces a reason the guard accepts — dispatched, the machine errors with the canonical rendering http-200', async () => {
    const reason = httpReason(200);
    expect(reason).toBe('http-200');
    if (reason === null) throw new Error('httpReason(200) must not be null');
    expect(isMediaErrorReason(reason)).toBe(true);
    const media = fakeMedia();
    const player = createDemoPlayer({
      scenarioId: SCENARIO_ID,
      resolver: stubResolver({ [SCENARIO_ID]: playable() }),
      media,
      reducedMotion: false,
    });
    await player.start();
    player.dispatch({ type: 'play' });
    player.dispatch({ type: 'media-error', reason });
    expect(player.snapshot().state).toBe('error');
    expect(player.snapshot().error?.reason).toBe('http-200');
  });

  it('r10 F3 (behaviour 12): httpReason refuses the non-canonical statuses — 1.5, -1 and NaN all return null', () => {
    expect(httpReason(1.5)).toBeNull();
    expect(httpReason(-1)).toBeNull();
    expect(httpReason(Number.NaN)).toBeNull();
  });

  it("r10 F3 (behaviour 12): the constructor's accept table and the guard's accept table agree — both sides of every value in the pinned table", () => {
    // Accepted side: the constructor renders the reason and the guard accepts
    // the rendering. 0 is in the table (the guard accepts `http-0`, so the
    // constructor must agree), and so are the largest integers whose decimal
    // rendering is canonical.
    for (const [status, rendering] of [
      [0, 'http-0'],
      [200, 'http-200'],
      [1000, 'http-1000'],
      [Number.MAX_SAFE_INTEGER, `http-${Number.MAX_SAFE_INTEGER}`],
      [2 ** 53, 'http-9007199254740992'],
    ] as const) {
      const reason = httpReason(status);
      expect(reason).toBe(rendering);
      expect(isMediaErrorReason(rendering)).toBe(true);
    }
    // Refused side: the constructor returns null and the guard refuses the
    // spelling the template would have produced for the same value.
    for (const [status, spelling] of [
      [1.5, 'http-1.5'],
      [-1, 'http--1'],
      [Number.NaN, 'http-NaN'],
      [Number.POSITIVE_INFINITY, 'http-Infinity'],
      [1e21, 'http-1e+21'],
    ] as const) {
      expect(httpReason(status)).toBeNull();
      expect(isMediaErrorReason(spelling)).toBe(false);
    }
  });
});
