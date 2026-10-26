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
  type DemoMediaElement,
  type DemoPlayer,
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
