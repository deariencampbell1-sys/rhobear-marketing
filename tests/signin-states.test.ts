// W0-06 behaviours 10–15: the sign-in state machine, method availability from
// configuration, the magic-link states, denied/canceled/offline/conflict,
// restore-once and back navigation. Injected storage and injected clock only.
import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_HOME_ROUTE,
  SIGNIN_PROVIDERS,
  SIGNIN_STATES,
  UNCONFIGURED_SIGNIN_COPY,
  createSignInMachine,
  isMethodAvailable,
  magicLinkSentCopy,
  visibleMethods,
  type MagicLinkEvent,
  type SignInMachine,
  type SignInProviderConfig,
  type SignInState,
} from '../src/clients/intent/signin';
import {
  CONSUMED_RETENTION_MS,
  createIntentStore,
  memoryIntentStorage,
  type IntentStorage,
} from '../src/clients/intent/store';

const BASE = Date.parse('2026-10-25T12:00:00Z');

function fakeClock(start: number = BASE): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function setup(providers: SignInProviderConfig, storage: IntentStorage = memoryIntentStorage()) {
  const clock = fakeClock();
  const store = createIntentStore({ storage, now: clock.now });
  const machine = createSignInMachine({ store, now: clock.now, providers });
  return { machine, clock, store };
}

/** A passthrough exclusive lock manager: the Web Locks API is present, so a
 * consume obtains the real cross-tab guarantee. */
function stubWebLocks(): void {
  vi.stubGlobal('navigator', {
    locks: {
      request<R>(_name: string, _options: { mode: 'exclusive' | 'shared' }, body: () => Promise<R> | R): Promise<R> {
        return Promise.resolve(body());
      },
    },
  });
}

/** Two "tabs" over one backing map: independent adapters, shared bytes. */
function backedStorage(backing: Map<string, string>): IntentStorage {
  return {
    getItem: async (key) => backing.get(key) ?? null,
    setItem: async (key, value) => {
      backing.set(key, value);
    },
    removeItem: async (key) => {
      backing.delete(key);
    },
  };
}

describe('sign-in state machine', () => {
  it('sign-in walks idle through method-select, provider-pending, returning, restoring and done, with the branch states defined', async () => {
    const { machine } = setup({ google: true });
    expect(machine.snapshot().state).toBe('idle');
    const created = await machine.armIntent({
      product: 'forge',
      kind: 'checkout',
      returnRoute: '/plans',
      plan: 'shell',
      scenario: 'forge-01',
    });
    expect(created.ok).toBe(true);
    expect(machine.snapshot().state).toBe('intent-loaded');
    expect(machine.continueToMethodSelect()).toBe(true);
    expect(machine.snapshot().state).toBe('method-select');
    expect(machine.chooseMethod('google')).toBe(true);
    expect(machine.snapshot().state).toBe('provider-pending');
    expect(machine.sessionApproved()).toBe(true);
    expect(machine.snapshot().state).toBe('returning');
    stubWebLocks(); // the happy path below is the fully-guaranteed restore
    const restoring = await machine.restoreDestination();
    vi.unstubAllGlobals();
    expect(restoring.outcome).toBe('restored');
    expect(restoring.snapshot.state).toBe('restoring');
    expect(restoring.snapshot.restoreGuarantee).toBe('web-locks');
    expect(machine.completeRestore()).toBe('restored');
    expect(machine.snapshot().state).toBe('done');
    expect(machine.snapshot().returnRoute).toBe('/plans');
    // Every branch state the board names exists on the machine (the magic-link
    // states sent/used are behaviour 12's additions to the branch set).
    expect(SIGNIN_STATES).toEqual(
      expect.arrayContaining([
        'idle',
        'intent-loaded',
        'method-select',
        'provider-pending',
        'returning',
        'restoring',
        'done',
        'denied',
        'canceled',
        'expired',
        'cooldown',
        'wrong-browser',
        'offline',
        'conflict',
        'no-intent',
      ]),
    );
  });

  it('unconfigured methods are hidden, not shown disabled, and the copy names the account service', async () => {
    // Today no provider is configured in this repo: every method is
    // unavailable, and none of them renders as a disabled button promising a
    // future provider.
    const none: SignInProviderConfig = {};
    expect(visibleMethods(none)).toEqual([]);
    for (const id of SIGNIN_PROVIDERS) expect(isMethodAvailable(none, id)).toBe(false);
    // An explicitly false method is hidden exactly like an absent one.
    expect(visibleMethods({ google: true, email: false })).toEqual(['google']);
    expect(isMethodAvailable({ google: true, email: false }, 'email')).toBe(false);

    const { machine } = setup(none);
    await machine.armIntent({ product: 'builds', kind: 'checkout', returnRoute: '/get', plan: 'shell' });
    machine.continueToMethodSelect();
    expect(machine.chooseMethod('google')).toBe(false);
    expect(machine.chooseMethod('email')).toBe(false);
    expect(machine.snapshot().state).toBe('method-select');
    expect(machine.snapshot().copy).toBe(UNCONFIGURED_SIGNIN_COPY);
    expect(UNCONFIGURED_SIGNIN_COPY).toContain('account service is connected');
  });

  it('magic-link states match the board and the copy is identical for a new and an existing email', async () => {
    const { machine, clock } = setup({ email: true });
    await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    machine.continueToMethodSelect();
    expect(machine.chooseMethod('email')).toBe(true);
    expect(machine.requestMagicLink('person@example.com')).toBe(true);
    expect(machine.onMagicLinkEvent({ type: 'sent' })).toBe(true); // from provider-pending
    expect(machine.snapshot().state).toBe('sent');
    // The sent copy cannot know or say whether the address owns an account:
    // no enumeration, no "we couldn't find that email".
    expect(magicLinkSentCopy('new@example.com')).toBe(magicLinkSentCopy('longtime@example.com'));
    expect(machine.snapshot().copy).toBe(magicLinkSentCopy('person@example.com'));
    expect(magicLinkSentCopy('person@example.com')).not.toMatch(/couldn't find|no account|not registered|unknown address/i);
    // Cooldown from sent (an allowed source), remaining seconds on the clock.
    expect(machine.onMagicLinkEvent({ type: 'cooldown', until: clock.now() + 30_000 })).toBe(true);
    expect(machine.snapshot().state).toBe('cooldown');
    expect(machine.remainingCooldownSeconds()).toBe(30);
    clock.advance(10_000);
    expect(machine.remainingCooldownSeconds()).toBe(20);
    // Expired from cooldown (an allowed source).
    expect(machine.onMagicLinkEvent({ type: 'expired' })).toBe(true);
    expect(machine.snapshot().state).toBe('expired');
    expect(machine.snapshot().intent).not.toBeNull();
    expect(machine.snapshot().claimedSuccess).toBe(false);

    // used, wrong-browser and offline, each from an allowed source state.
    const leafFrom = async (event: MagicLinkEvent, expected: SignInState) => {
      const fresh = setup({ email: true });
      await fresh.machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
      fresh.machine.continueToMethodSelect();
      fresh.machine.chooseMethod('email');
      fresh.machine.requestMagicLink('person@example.com');
      expect(fresh.machine.onMagicLinkEvent(event), expected).toBe(true);
      expect(fresh.machine.snapshot().state).toBe(expected);
      expect(fresh.machine.snapshot().intent).not.toBeNull();
      expect(fresh.machine.snapshot().claimedSuccess).toBe(false);
    };
    await leafFrom({ type: 'used' }, 'used');
    await leafFrom({ type: 'wrong-browser' }, 'wrong-browser');
    await leafFrom({ type: 'offline' }, 'offline');
  });

  it('a late or duplicated magic-link event cannot drag a finished state backwards', async () => {
    const events: MagicLinkEvent[] = [
      { type: 'sent' },
      { type: 'used' },
      { type: 'expired' },
      { type: 'cooldown', until: BASE + 60_000 },
      { type: 'wrong-browser' },
      { type: 'offline' },
    ];

    // done: every event is ignored — the state stays done.
    const done = setup({ email: true });
    await done.machine.armIntent({ product: 'builds', kind: 'checkout', returnRoute: '/get' });
    done.machine.continueToMethodSelect();
    done.machine.chooseMethod('email');
    done.machine.sessionApproved();
    stubWebLocks(); // this walk ends in a fully-guaranteed restore
    await done.machine.restoreDestination();
    vi.unstubAllGlobals();
    done.machine.completeRestore();
    expect(done.machine.snapshot().state).toBe('done');
    for (const event of events) {
      expect(done.machine.onMagicLinkEvent(event), `done ignores ${event.type}`).toBe(false);
      expect(done.machine.snapshot().state, `done ignores ${event.type}`).toBe('done');
    }

    // denied: ignored, the state stays denied.
    const denied = setup({ email: true });
    await denied.machine.armIntent({ product: 'builds', kind: 'checkout', returnRoute: '/get' });
    denied.machine.continueToMethodSelect();
    denied.machine.chooseMethod('email');
    denied.machine.providerDenied();
    expect(denied.machine.snapshot().state).toBe('denied');
    for (const event of events) {
      expect(denied.machine.onMagicLinkEvent(event), `denied ignores ${event.type}`).toBe(false);
      expect(denied.machine.snapshot().state, `denied ignores ${event.type}`).toBe('denied');
    }

    // conflict: ignored, the state stays conflict.
    const conflict = setup({ email: true });
    await conflict.machine.armIntent({ product: 'builds', kind: 'checkout', returnRoute: '/get' });
    conflict.machine.continueToMethodSelect();
    conflict.machine.chooseMethod('email');
    conflict.machine.channelConflict();
    expect(conflict.machine.snapshot().state).toBe('conflict');
    for (const event of events) {
      expect(conflict.machine.onMagicLinkEvent(event), `conflict ignores ${event.type}`).toBe(false);
      expect(conflict.machine.snapshot().state, `conflict ignores ${event.type}`).toBe('conflict');
    }

    // The three allowed sources still accept events.
    const toPending = (m: SignInMachine): void => {
      m.continueToMethodSelect();
      m.chooseMethod('email');
      m.requestMagicLink('person@example.com');
    };
    const fromSource = async (walk: (m: SignInMachine) => void, event: MagicLinkEvent, expected: SignInState) => {
      const fresh = setup({ email: true });
      await fresh.machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
      walk(fresh.machine);
      expect(fresh.machine.onMagicLinkEvent(event), `${event.type} from an allowed source`).toBe(true);
      expect(fresh.machine.snapshot().state).toBe(expected);
    };
    await fromSource(toPending, { type: 'sent' }, 'sent'); // from provider-pending
    await fromSource(
      (m) => {
        toPending(m);
        m.onMagicLinkEvent({ type: 'sent' });
      },
      { type: 'used' },
      'used',
    ); // from sent
    await fromSource(
      (m) => {
        toPending(m);
        m.onMagicLinkEvent({ type: 'sent' });
        m.onMagicLinkEvent({ type: 'cooldown', until: BASE + 60_000 });
      },
      { type: 'expired' },
      'expired',
    ); // from cooldown
  });

  it('denied, canceled, offline and conflict keep the intent and never grant', async () => {
    const { machine } = setup({ google: true });
    await machine.armIntent({ product: 'builds', kind: 'checkout', returnRoute: '/get', plan: 'shell' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');

    // Provider denial: the branch is shown, then the person is back on
    // method-select with the intent intact.
    machine.providerDenied();
    expect(machine.snapshot().state).toBe('denied');
    expect(machine.snapshot().intent).not.toBeNull();
    expect(machine.snapshot().returnRoute).toBe('/get');
    machine.continueToMethodSelect();
    expect(machine.snapshot().state).toBe('method-select');
    expect(machine.snapshot().intent).not.toBeNull();

    // Cancelled at the provider: same shape.
    machine.chooseMethod('google');
    machine.providerCanceled();
    expect(machine.snapshot().state).toBe('canceled');
    expect(machine.snapshot().intent).not.toBeNull();
    machine.continueToMethodSelect();
    machine.chooseMethod('google');

    // Offline: the intent survives and success is never claimed.
    machine.providerOffline();
    expect(machine.snapshot().state).toBe('offline');
    expect(machine.snapshot().intent).not.toBeNull();
    expect(machine.snapshot().claimedSuccess).toBe(false);

    // A cross-channel conflict stops the flow, offers verified link / Manage /
    // support, and never grants, never links by email string.
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.channelConflict();
    expect(machine.snapshot().state).toBe('conflict');
    expect(machine.snapshot().recovery).toEqual(['verified-link', 'manage', 'support']);
    expect(machine.snapshot().purchasesPreserved).toBe(true);
    expect(machine.snapshot().granted).toBe(false);
    expect(machine.snapshot().linkedByEmail).toBe(false);
  });

  it('restoring reaches done once and a second return without an active intent goes to the account home', async () => {
    const clock = fakeClock();
    const storage = memoryIntentStorage();
    const store = createIntentStore({ storage, now: clock.now });
    const machine = createSignInMachine({ store, now: clock.now, providers: { email: true } });
    await machine.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines', scenario: 'search-01' });
    machine.continueToMethodSelect();
    machine.chooseMethod('email');
    machine.sessionApproved();
    await machine.restoreDestination();
    machine.completeRestore();
    expect(machine.snapshot().state).toBe('done');
    expect(machine.snapshot().returnRoute).toBe('/engines');
    // The intent is consumed: a direct consume can never win again.
    const proof = await store.consume();
    expect(proof.outcome).toBe('already-consumed');
    // A second return while the consumed record is still retained reports the
    // original route and does nothing else — no redirect loop, no re-run.
    const again = await machine.resume();
    expect(again.state).toBe('done');
    expect(again.returnRoute).toBe('/engines');
    // Once the consumed record is gone, a return has no active intent and goes
    // to the account home — never a redirect loop back into the consumed route.
    clock.advance(CONSUMED_RETENTION_MS);
    const fresh = createSignInMachine({ store, now: clock.now, providers: {} });
    const returned = await fresh.beginWithStoredIntent();
    expect(returned.state).toBe('no-intent');
    expect(returned.destination).toBe(ACCOUNT_HOME_ROUTE);
    expect(ACCOUNT_HOME_ROUTE).toBe('/account');
  });

  it('back navigation keeps the intent and an install intent survives a restart inside its TTL', async () => {
    const clock = fakeClock();
    const storage = memoryIntentStorage();
    const storeA = createIntentStore({ storage, now: clock.now });
    const machine = createSignInMachine({ store: storeA, now: clock.now, providers: { google: true } });
    await machine.armIntent({ product: 'builds', kind: 'install', returnRoute: '/get' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    expect(machine.back()).toBe(true);
    expect(machine.snapshot().state).toBe('method-select');
    expect(machine.snapshot().returnRoute).toBe('/get');
    expect(machine.snapshot().intent).not.toBeNull();

    // Leaving the site and returning (a new machine over the same storage)
    // inside the 24 h install TTL restores the intent.
    clock.advance(1_000);
    const storeB = createIntentStore({ storage, now: clock.now });
    const restarted = createSignInMachine({ store: storeB, now: clock.now, providers: {} });
    const restored = await restarted.beginWithStoredIntent();
    expect(restored.state).toBe('intent-loaded');
    expect(restored.returnRoute).toBe('/get');
    // One second after that, the same intent is still there and untouched —
    // load never consumed it.
    clock.advance(1_000);
    const stillThere = await restarted.beginWithStoredIntent();
    expect(stillThere.state).toBe('intent-loaded');
    expect(stillThere.returnRoute).toBe('/get');
  });

  it('a checkout restored on the weaker in-process guarantee reports restored-unverified, not a done checkout', async () => {
    // W0-06 review r2 (finding 3): no navigator.locks in this environment, so
    // single-use is only this tab's promise — the machine must not present a
    // checkout as restored without saying so.
    const { machine } = setup({ google: true });
    await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    const restored = await machine.restoreDestination();
    expect(restored.outcome).toBe('restored');
    expect(restored.snapshot.state).toBe('restored-unverified');
    expect(restored.snapshot.restoreGuarantee).toBe('in-process');
    // The screen must re-confirm with L2's money path before charging: the
    // machine refuses to complete the restore itself.
    expect(machine.completeRestore()).toBe('not-restoring');
    expect(machine.snapshot().state).toBe('restored-unverified');
  });

  it('with navigator.locks present a checkout restore completes normally and reports web-locks', async () => {
    stubWebLocks();
    try {
      const { machine } = setup({ google: true });
      await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
      machine.continueToMethodSelect();
      machine.chooseMethod('google');
      machine.sessionApproved();
      const restored = await machine.restoreDestination();
      expect(restored.outcome).toBe('restored');
      expect(restored.snapshot.state).toBe('restoring');
      expect(restored.snapshot.restoreGuarantee).toBe('web-locks');
      expect(machine.completeRestore()).toBe('restored');
      expect(machine.snapshot().state).toBe('done');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('an install restore may complete on the in-process guarantee: the worst case is a repeated navigation, not a repeated charge', async () => {
    // W0-06 review r2 (finding 3): install, demo and account restores complete
    // on the weaker guarantee on purpose.
    const { machine } = setup({ google: true });
    await machine.armIntent({ product: 'builds', kind: 'install', returnRoute: '/get' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    const restored = await machine.restoreDestination();
    expect(restored.outcome).toBe('restored');
    expect(restored.snapshot.state).toBe('restoring');
    expect(restored.snapshot.restoreGuarantee).toBe('in-process');
    expect(machine.completeRestore()).toBe('restored');
    expect(machine.snapshot().state).toBe('done');
  });

  it('without navigator.locks, two machines over one backing: exactly one restores, the other reports already-restored', async () => {
    const backing = new Map<string, string>();
    const clock = fakeClock();
    const machineA = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    await machineA.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    const machineB = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    expect((await machineB.beginWithStoredIntent()).state).toBe('intent-loaded');
    for (const m of [machineA, machineB]) {
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.sessionApproved();
    }
    const [ra, rb] = await Promise.all([machineA.restoreDestination(), machineB.restoreDestination()]);
    const restored = [ra, rb].filter((r) => r.outcome === 'restored');
    const losers = [ra, rb].filter((r) => r.outcome === 'already-restored');
    expect(restored, 'exactly one machine may restore').toHaveLength(1);
    expect(losers, 'the other reports already-restored, never a second run').toHaveLength(1);
    expect(losers[0].snapshot.state).toBe('done');
    expect(losers[0].snapshot.returnRoute).toBe('/reviews');
    expect(
      restored[0].snapshot.restoreGuarantee,
      'no web locks here: the weaker guarantee is reported honestly',
    ).toBe('in-process');
  });

  it('completeRestore reports restored, already-done or not-restoring — one arm per reality', async () => {
    // W0-06 review r2 (finding 6): a discriminated result, not a bare boolean
    // that cannot tell "just restored" from "already done".
    const { machine } = setup({ google: true });
    expect(machine.completeRestore(), 'nothing is being restored from idle').toBe('not-restoring');
    await machine.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    await machine.restoreDestination();
    expect(machine.completeRestore()).toBe('restored');
    expect(machine.completeRestore(), 'a second call stays done and says so').toBe('already-done');
    expect(machine.snapshot().state).toBe('done');
  });

  it('restoreDestination reports restored, already-restored or not-restoring instead of silently returning a snapshot', async () => {
    // W0-06 review r2 (finding 6): a wrong-state call is reported, not absorbed.
    const { machine } = setup({ google: true });
    const wrong = await machine.restoreDestination();
    expect(wrong.outcome).toBe('not-restoring');
    expect(wrong.snapshot.state).toBe('idle');

    await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    const restored = await machine.restoreDestination();
    expect(restored.outcome).toBe('restored');
    expect(restored.snapshot.state).toBe('restored-unverified'); // in-process + checkout
    expect(machine.completeRestore()).toBe('not-restoring'); // must be re-confirmed first

    // already-restored: the record was consumed elsewhere while this machine
    // was still in returning.
    const backing = new Map<string, string>();
    const clock = fakeClock();
    const m1 = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    await m1.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    m1.continueToMethodSelect();
    m1.chooseMethod('google');
    m1.sessionApproved();
    const m2 = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    expect((await m2.beginWithStoredIntent()).state).toBe('intent-loaded');
    m2.continueToMethodSelect();
    m2.chooseMethod('google');
    m2.sessionApproved();
    const consumedElsewhere = await m2.restoreDestination();
    expect(consumedElsewhere.outcome).toBe('restored');
    const already = await m1.restoreDestination();
    expect(already.outcome).toBe('already-restored');
    expect(already.snapshot.state).toBe('done');
    expect(already.snapshot.returnRoute).toBe('/reviews');
  });
});
