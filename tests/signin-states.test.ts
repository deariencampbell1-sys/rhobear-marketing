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
  type SignInSnapshot,
  type SignInState,
} from '../src/clients/intent/signin';
import { parseIntent, type Intent } from '../src/clients/intent/schema';
import {
  CHECKOUT_TTL_MS,
  CONSUMED_RETENTION_MS,
  DAY_TTL_MS,
  INTENT_STORAGE_KEY,
  createIntentStore,
  memoryIntentStorage,
  type IntentStorage,
  type IntentStore,
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
        'link-expired',
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
    expect(machine.snapshot().destination).toBe('/reviews'); // the live intent's returnRoute
    // The sent copy cannot know or say whether the address owns an account:
    // no enumeration, no "we couldn't find that email".
    expect(magicLinkSentCopy('new@example.com')).toBe(magicLinkSentCopy('longtime@example.com'));
    expect(machine.snapshot().copy).toBe(magicLinkSentCopy('person@example.com'));
    expect(magicLinkSentCopy('person@example.com')).not.toMatch(/couldn't find|no account|not registered|unknown address/i);
    // Cooldown from sent (an allowed source), remaining seconds on the clock.
    expect(machine.onMagicLinkEvent({ type: 'cooldown', until: clock.now() + 30_000 })).toBe(true);
    expect(machine.snapshot().state).toBe('cooldown');
    expect(machine.snapshot().destination).toBe('/reviews');
    expect(machine.remainingCooldownSeconds()).toBe(30);
    clock.advance(10_000);
    expect(machine.remainingCooldownSeconds()).toBe(20);
    // Expired from cooldown (an allowed source) — the LINK expired while the
    // intent is still live, so this is `link-expired` and the destination
    // survives (W0-06 review r3, finding 1).
    expect(machine.onMagicLinkEvent({ type: 'expired' })).toBe(true);
    expect(machine.snapshot().state).toBe('link-expired');
    expect(machine.snapshot().destination).toBe('/reviews');
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
      expect(fresh.machine.snapshot().destination).toBe('/reviews');
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
      // A magic link expiring after a successful restore: the event is
      // ignored, the destination stays (W0-06 review r3, edge case).
      expect(done.machine.snapshot().destination, `done keeps the destination on ${event.type}`).toBe('/get');
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
      'link-expired',
    ); // from cooldown — the link expired, the intent did not (finding 1)
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

  it('a magic-link expiry keeps the destination and offers a new link: link-expired, destination is the returnRoute', async () => {
    // W0-06 review r3 (finding 1): a magic link that expires while the intent
    // is still live is `link-expired` — NOT `expired`. The destination this
    // client exists to keep is kept, and the person can send a new link and
    // carry on from the same place.
    const { machine } = setup({ email: true });
    const created = await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    expect(created.ok).toBe(true);
    machine.continueToMethodSelect();
    machine.chooseMethod('email');
    machine.requestMagicLink('person@example.com');
    expect(machine.onMagicLinkEvent({ type: 'sent' })).toBe(true);
    expect(machine.onMagicLinkEvent({ type: 'expired' })).toBe(true);

    const linkExpired = machine.snapshot();
    expect(linkExpired.state).toBe('link-expired');
    expect(linkExpired.destination).toBe('/reviews'); // the intent's returnRoute, unchanged
    expect(linkExpired.destination).toBe(linkExpired.intent?.returnRoute);
    expect(linkExpired.intent).not.toBeNull();

    // Idempotent: a second expiry event changes nothing and duplicates no copy.
    const copyAfterFirst = linkExpired.copy;
    expect(machine.onMagicLinkEvent({ type: 'expired' })).toBe(true);
    expect(machine.snapshot().state).toBe('link-expired');
    expect(machine.snapshot().copy).toBe(copyAfterFirst);
    expect(machine.snapshot().destination).toBe('/reviews');

    // The way back: method-select with the intent intact, and a new link.
    expect(machine.continueToMethodSelect()).toBe(true);
    expect(machine.snapshot().state).toBe('method-select');
    expect(machine.snapshot().intent).not.toBeNull();
    expect(machine.snapshot().destination).toBe('/reviews');
    expect(machine.chooseMethod('email')).toBe(true);
    expect(machine.requestMagicLink('person@example.com'), 'a new link can be sent').toBe(true);
  });

  it('an intent expiry is terminal and offers no destination: expired, destination null, method-select refused', async () => {
    // W0-06 review r3 (finding 1): `expired` is the INTENT's TTL passing (or
    // load() reporting it) and nothing else. There is nothing left to
    // restore, so the state is terminal: no destination and no way back to
    // method-select. This arm is the opposite of the link-expiry test, so the
    // two expiries can never be re-merged silently.
    const { machine, clock } = setup({ google: true });
    await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    clock.advance(CHECKOUT_TTL_MS + 1);
    const begun = await machine.beginWithStoredIntent();
    expect(begun.state).toBe('expired');
    expect(begun.destination).toBeNull();
    expect(begun.intent).toBeNull();
    // Terminal: a refused call changes nothing.
    expect(machine.continueToMethodSelect()).toBe(false);
    expect(machine.snapshot().state).toBe('expired');
    expect(machine.snapshot().destination).toBeNull();

    // The same expiry through the consume path: the intent expired before it
    // could be restored — again no destination, again terminal.
    const fresh = setup({ google: true });
    await fresh.machine.armIntent({ product: 'builds', kind: 'install', returnRoute: '/get' });
    fresh.machine.continueToMethodSelect();
    fresh.machine.chooseMethod('google');
    fresh.machine.sessionApproved();
    fresh.clock.advance(DAY_TTL_MS + 1);
    const expired = await fresh.machine.restoreDestination();
    expect(expired.outcome).toBe('not-restoring');
    expect(expired.snapshot.state).toBe('expired');
    expect(expired.snapshot.destination).toBeNull();
    expect(fresh.machine.continueToMethodSelect()).toBe(false);
    expect(fresh.machine.snapshot().state).toBe('expired');
  });

  it('an empty or whitespace returnRoute never reaches destination', async () => {
    // The allowlist refuses an empty or whitespace return route outright, so
    // it can never reach snapshot().destination.
    const { machine } = setup({ google: true });
    for (const returnRoute of ['', '   ', '\t\n']) {
      const created = await machine.armIntent({ product: 'builds', kind: 'checkout', returnRoute });
      expect(created).toEqual({ ok: false, problem: 'bad-return-route' });
      expect(machine.snapshot().destination).toBeNull();
      expect(machine.snapshot().intent).toBeNull();
    }
  });

  it('confirmRestore completes a restored-unverified checkout and refuses from every other state', async () => {
    // W0-06 review r3 (finding 2): restored-unverified used to be a dead end
    // — no method could ever finish it. confirmRestore() is that method: the
    // money path re-confirms through L2 and then calls it. It does not
    // charge, does not call the network and does not consume anything.
    const { machine } = setup({ google: true });
    await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    await machine.restoreDestination();
    expect(machine.snapshot().state).toBe('restored-unverified');
    const intentBefore = machine.snapshot().intent;

    // Positive arm: the one accepted state — with the money path's explicit
    // assertion (W0-06 review r4, finding 4).
    const confirmed = machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-1' });
    expect(confirmed).not.toBe('not-restoring');
    expect(confirmed).toMatchObject({ state: 'done', destination: '/plans' });
    expect(machine.snapshot().state).toBe('done');
    expect(machine.snapshot().intent, 'confirmRestore consumes nothing').toEqual(intentBefore);
    // Edge: on restored-unverified with a true assertion, then again — the
    // second call reports 'not-restoring'.
    expect(machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-1' })).toBe('not-restoring');

    // Negative arms: idle, done and restoring — refused, nothing changes.
    const idle = setup({ google: true });
    expect(idle.machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-1' })).toBe('not-restoring');
    expect(idle.machine.snapshot().state).toBe('idle');

    const done = setup({ google: true });
    await done.machine.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
    done.machine.continueToMethodSelect();
    done.machine.chooseMethod('google');
    done.machine.sessionApproved();
    await done.machine.restoreDestination();
    done.machine.completeRestore();
    expect(done.machine.snapshot().state).toBe('done');
    expect(done.machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-1' })).toBe('not-restoring');
    expect(done.machine.snapshot().state).toBe('done');

    const restoring = setup({ google: true });
    await restoring.machine.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
    restoring.machine.continueToMethodSelect();
    restoring.machine.chooseMethod('google');
    restoring.machine.sessionApproved();
    await restoring.machine.restoreDestination();
    expect(restoring.machine.snapshot().state).toBe('restoring');
    expect(restoring.machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-1' })).toBe('not-restoring');
    expect(restoring.machine.snapshot().state).toBe('restoring');
  });

  it('a checkout on the in-process guarantee reaches done only through confirmRestore', async () => {
    // W0-06 review r3 (finding 2): completeRestore() still refuses
    // restored-unverified — the money path must re-confirm first — but the
    // flow is no longer a dead end.
    const { machine } = setup({ google: true });
    await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    const restored = await machine.restoreDestination();
    expect(restored.snapshot.state).toBe('restored-unverified');
    expect(machine.completeRestore()).toBe('not-restoring');
    expect(machine.snapshot().state).toBe('restored-unverified');
    // Only confirmRestore() — after L2's own re-confirmation — reaches done.
    expect(machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-1' })).toMatchObject({ state: 'done' });
    expect(machine.snapshot().state).toBe('done');
    expect(machine.completeRestore()).toBe('already-done');
  });

  it("an already-consumed restore reports a consumed-stamped intent and this restore's guarantee, not the last one", async () => {
    // W0-06 review r3 (finding 5): the already-consumed path used to leave
    // intent untouched (consumedAt undefined for the screen) and carried the
    // previous restore's guarantee onto done.
    const backing = new Map<string, string>();
    const clock = fakeClock();
    // The machine's first restore runs under a real web lock.
    stubWebLocks();
    const machine = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    const first = await machine.restoreDestination();
    expect(first.outcome).toBe('restored');
    expect(machine.snapshot().restoreGuarantee).toBe('web-locks'); // the LAST restore's guarantee
    expect(machine.completeRestore()).toBe('restored');
    vi.unstubAllGlobals();

    // The machine is reused for a second intent that another tab consumes
    // first — and this time there is no Web Locks API at all.
    await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    const rival = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    expect((await rival.beginWithStoredIntent()).state).toBe('intent-loaded');
    rival.continueToMethodSelect();
    rival.chooseMethod('google');
    rival.sessionApproved();
    expect((await rival.restoreDestination()).outcome).toBe('restored');

    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    const already = await machine.restoreDestination();
    expect(already.outcome).toBe('already-restored');
    expect(already.snapshot.state).toBe('done');
    expect(already.snapshot.intent?.consumedAt, 'a consumed-stamped intent, never undefined').toBeTruthy();
    expect(already.snapshot.restoreGuarantee, "this restore's guarantee, not the last one's").toBe('in-process');
    // The already-done report keeps both: a second call must not rewrite them.
    expect(machine.completeRestore()).toBe('already-done');
    const done = machine.snapshot();
    expect(done.intent?.consumedAt).toBeTruthy();
    expect(done.restoreGuarantee).toBe('in-process');
  });

  it("a machine reused across returns shows this return's state only: every beginWithStoredIntent branch resets the transient fields", async () => {
    // W0-06 review r3 (finding 6): only the `active` branch used to reset, so
    // a machine reused across returns could show a prior return's
    // claimedSuccess, restoreGuarantee, recovery or purchasesPreserved.
    // Every branch — active, consumed, expired, invalid, absent — resets all
    // six snapshot-visible transient fields back to their start values
    // (W0-06 review r4, finding 2): copy and method too, not just four.
    const assertStartValues = (s: SignInSnapshot) => {
      expect(s.claimedSuccess).toBe(false);
      expect(s.restoreGuarantee).toBe('none');
      expect(s.recovery).toBeNull();
      expect(s.purchasesPreserved).toBeNull();
      expect(s.copy).toBeNull();
      expect(s.method).toBeNull();
    };

    /** Dirty claimedSuccess and the guarantee: approve, then restore to done. */
    const walkRestored = async (m: SignInMachine) => {
      await m.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.sessionApproved();
      expect((await m.restoreDestination()).outcome).toBe('restored');
      m.completeRestore();
    };
    /** Dirty claimedSuccess only (no consume). */
    const walkApproved = async (m: SignInMachine) => {
      await m.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.sessionApproved();
    };
    /** Dirty recovery and purchasesPreserved. */
    const walkConflict = async (m: SignInMachine) => {
      await m.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.channelConflict();
    };
    /** Dirty copy and method: choose email and request a magic link. */
    const walkMagicLink = async (m: SignInMachine) => {
      await m.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
      m.continueToMethodSelect();
      m.chooseMethod('email');
      m.requestMagicLink('person@example.com');
      expect(m.snapshot().copy, 'precondition: copy is dirty').not.toBeNull();
      expect(m.snapshot().method, 'precondition: method is dirty').toBe('email');
    };

    type Walk = (m: SignInMachine) => Promise<void>;
    type Force = (
      store: IntentStore,
      clock: { advance: (ms: number) => void },
      backing: Map<string, string>,
    ) => Promise<void>;
    const branches: readonly { name: string; walks: readonly Walk[]; force: Force; state: SignInState }[] = [
      {
        name: 'active',
        walks: [walkApproved, walkConflict, walkMagicLink],
        force: async () => undefined,
        state: 'intent-loaded',
      },
      {
        name: 'consumed',
        walks: [walkRestored, walkApproved, walkConflict, walkMagicLink],
        force: async (store) => {
          await store.consume();
        },
        state: 'done',
      },
      {
        name: 'expired',
        walks: [walkApproved, walkConflict, walkMagicLink],
        force: async (_store, clock) => {
          clock.advance(DAY_TTL_MS + 1);
        },
        state: 'expired',
      },
      {
        name: 'invalid',
        walks: [walkApproved, walkConflict, walkMagicLink],
        force: async (_store, _clock, backing) => {
          backing.set(INTENT_STORAGE_KEY, '{oops');
        },
        state: 'no-intent',
      },
      {
        name: 'absent',
        walks: [walkRestored, walkApproved, walkConflict, walkMagicLink],
        force: async (store) => {
          await store.clear();
        },
        state: 'no-intent',
      },
    ];

    for (const branch of branches) {
      for (const walk of branch.walks) {
        const backing = new Map<string, string>();
        const clock = fakeClock();
        const store = createIntentStore({ storage: backedStorage(backing), now: clock.now });
        const machine = createSignInMachine({ store, now: clock.now, providers: { google: true, email: true } });
        await walk(machine);
        await branch.force(store, clock, backing);
        const begun = await machine.beginWithStoredIntent();
        expect(begun.state, `${branch.name} branch`).toBe(branch.state);
        assertStartValues(begun);
        // The machine itself reports the same, not just the returned snapshot.
        assertStartValues(machine.snapshot());
      }
    }
  });

  it("a dirty machine that gets a rejected intent reports no success: every transient field is cleared on armIntent's failure branch", async () => {
    // W0-06 review r4 (finding 1): the failure branch used to set state, intent
    // and copy and nothing else — claimedSuccess, recovery, purchasesPreserved,
    // restoreGuarantee, method and the cooldown survived, so a machine that had
    // claimed a session could report { state: 'idle', claimedSuccess: true }.
    // One resetTransient() owns all seven fields; this test dirties them and
    // asserts all seven after the rejection, so the reset list and the
    // assertion list cannot drift apart again.
    const rejection = { ok: false, problem: 'bad-return-route' } as const;
    const failureCopy = 'That destination could not be saved (bad-return-route).';

    /** Every transient field, at its reset value, after a rejected intent. */
    const assertAllSevenCleared = (m: SignInMachine, label: string) => {
      const s = m.snapshot();
      expect(s.state, label).toBe('idle');
      expect(s.intent, label).toBeNull();
      expect(s.claimedSuccess, label).toBe(false);
      expect(s.recovery, label).toBeNull();
      expect(s.purchasesPreserved, label).toBeNull();
      expect(s.restoreGuarantee, label).toBe('none');
      expect(s.method, label).toBeNull();
      // copy is cleared too and replaced by THIS return's failure copy — the
      // stale magic-link message never survives the rejection.
      expect(s.copy, label).toBe(failureCopy);
      // cooldownUntil is machine-private; both of its readers report the
      // reset: no countdown and no leftover cooldown claiming readiness.
      expect(m.remainingCooldownSeconds(), label).toBe(0);
      expect(m.readyToResend(), label).toBe(false);
    };

    type Walk = (m: SignInMachine, clock: { advance: (ms: number) => void }) => Promise<void>;
    /** Dirty claimedSuccess and method (sessionApproved). */
    const walkApproved: Walk = async (m) => {
      await m.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.sessionApproved();
      expect(m.snapshot().claimedSuccess, 'precondition: claimedSuccess is dirty').toBe(true);
    };
    /** Dirty recovery and purchasesPreserved (channelConflict). */
    const walkConflict: Walk = async (m) => {
      await m.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.channelConflict();
      expect(m.snapshot().recovery, 'precondition: recovery is dirty').not.toBeNull();
    };
    /** Dirty copy, method and a cooldown deadline that has already passed. */
    const walkCooldown: Walk = async (m, clock) => {
      await m.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
      m.continueToMethodSelect();
      m.chooseMethod('email');
      m.requestMagicLink('person@example.com');
      expect(m.onMagicLinkEvent({ type: 'cooldown', until: BASE + 30_000 })).toBe(true);
      clock.advance(30_000); // the deadline is now in the past — and dirty
      expect(m.readyToResend(), 'precondition: a stale cooldown deadline is dirty').toBe(true);
    };
    /** Dirty restoreGuarantee and claimedSuccess (a restore ran). */
    const walkRestored: Walk = async (m) => {
      await m.armIntent({ product: 'engines', kind: 'demo', returnRoute: '/engines' });
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.sessionApproved();
      expect((await m.restoreDestination()).outcome).toBe('restored');
      expect(m.snapshot().restoreGuarantee, 'precondition: the guarantee is dirty').not.toBe('none');
    };

    const walks: readonly (readonly [string, Walk])[] = [
      ['sessionApproved dirties claimedSuccess', walkApproved],
      ['channelConflict dirties recovery and purchasesPreserved', walkConflict],
      ['a cooldown dirties copy, method and the cooldown deadline', walkCooldown],
      ['a restore dirties restoreGuarantee', walkRestored],
    ];
    for (const [name, walk] of walks) {
      const { machine, clock } = setup({ google: true, email: true });
      await walk(machine, clock);
      expect(
        await machine.armIntent({ product: 'builds', kind: 'checkout', returnRoute: '/not-canonical' }),
        name,
      ).toEqual(rejection);
      assertAllSevenCleared(machine, name);

      // Edge: armIntent() failing twice in a row — the second snapshot is
      // identical to the first.
      const first = machine.snapshot();
      expect(
        await machine.armIntent({ product: 'builds', kind: 'checkout', returnRoute: '/not-canonical' }),
        name,
      ).toEqual(rejection);
      expect(machine.snapshot(), name).toEqual(first);
    }
  });

  it('a used link and a wrong-browser link both offer a new one: continueToMethodSelect returns to method-select with the intent intact', async () => {
    // W0-06 review r4 (finding 3): `used` and `wrong-browser` are live-intent
    // states — the intent is unconsumed in each — and neither had an outbound
    // transition: the only exit was a page reload.
    const arm = async (event: MagicLinkEvent, expected: SignInState) => {
      const { machine } = setup({ email: true });
      await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
      machine.continueToMethodSelect();
      machine.chooseMethod('email');
      machine.requestMagicLink('person@example.com');
      expect(machine.onMagicLinkEvent(event), expected).toBe(true);
      expect(machine.snapshot().state, expected).toBe(expected);
      // A new link is offered: method-select with the intent intact.
      expect(machine.continueToMethodSelect(), expected).toBe(true);
      const s = machine.snapshot();
      expect(s.state, expected).toBe('method-select');
      expect(s.intent, expected).not.toBeNull();
      expect(s.destination, expected).toBe('/reviews');
      expect(visibleMethods({ email: true }), expected).toEqual(['email']);
      // and a new link can actually be requested from here
      expect(machine.chooseMethod('email'), expected).toBe(true);
      expect(machine.requestMagicLink('person@example.com'), expected).toBe(true);
    };
    await arm({ type: 'used' }, 'used');
    await arm({ type: 'wrong-browser' }, 'wrong-browser');
  });

  it('confirmRestore requires an explicit money-path assertion: a missing or false one changes nothing', async () => {
    // W0-06 review r4 (finding 4): the "L2 must re-confirm before charging"
    // contract used to be a comment over `void options`. It is typed now:
    // confirmRestore(assertion: { moneyPathConfirmed: true, confirmationId })
    // — this machine cannot verify the re-confirmation; the caller asserts it,
    // and the required argument exists so the assertion is visible at every
    // call site (the opaque id is finding 9's handle: this machine carries the
    // id, it cannot verify it; L2 issues it and L2 verifies it). A missing or
    // false assertion is refused exactly like a wrong state: 'not-restoring',
    // nothing changed.
    type Assertion = { readonly moneyPathConfirmed: true; readonly confirmationId: string };
    const toUnverified = async (m: SignInMachine) => {
      await m.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.sessionApproved();
      await m.restoreDestination();
      expect(m.snapshot().state).toBe('restored-unverified');
    };

    const missing = setup({ google: true });
    await toUnverified(missing.machine);
    expect(missing.machine.confirmRestore(undefined as unknown as Assertion)).toBe('not-restoring');
    expect(missing.machine.snapshot().state, 'a missing assertion changes nothing').toBe('restored-unverified');

    const falsy = setup({ google: true });
    await toUnverified(falsy.machine);
    expect(
      falsy.machine.confirmRestore({ moneyPathConfirmed: false } as unknown as Assertion),
      'a false assertion changes nothing',
    ).toBe('not-restoring');
    expect(falsy.machine.snapshot().state).toBe('restored-unverified');

    // Edge: on restored-unverified with a true assertion, then again —
    // 'not-restoring'.
    const once = setup({ google: true });
    await toUnverified(once.machine);
    expect(once.machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-1' })).toMatchObject({ state: 'done' });
    expect(once.machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-1' })).toBe('not-restoring');
  });

  it("an already-consumed stamp never exceeds expiresAt, so the snapshot's record still validates", async () => {
    // W0-06 review r4 (finding 6): the already-consumed path fabricates a
    // consumedAt from now(), which can land past the record's own expiresAt —
    // a snapshot whose record parseIntent would refuse. The stamp is clamped
    // to expiresAt.
    const backing = new Map<string, string>();
    const clock = fakeClock();
    const rival = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    await rival.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    const loser = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    expect((await loser.beginWithStoredIntent()).state).toBe('intent-loaded');
    for (const m of [rival, loser]) {
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.sessionApproved();
    }
    // The rival consumes just before the checkout intent's TTL ends...
    clock.advance(CHECKOUT_TTL_MS - 1_000);
    expect((await rival.restoreDestination()).outcome).toBe('restored');
    // ...and the loser reports already-consumed after expiresAt has passed,
    // still inside the consumed retention window.
    clock.advance(2_000);
    const already = await loser.restoreDestination();
    expect(already.outcome).toBe('already-restored');
    const record = already.snapshot.intent;
    expect(record, 'the snapshot still carries the record').not.toBeNull();
    const stamp = Date.parse(record?.consumedAt ?? '');
    const expiresAt = Date.parse(record?.expiresAt ?? '');
    expect(stamp, 'the fabricated stamp never exceeds expiresAt').not.toBeGreaterThan(expiresAt);
    expect(parseIntent(record), "the snapshot's record still validates").toMatchObject({ ok: true });
  });

  it('a malformed cooldown until is refused and changes nothing', async () => {
    // W0-06 review r4 (finding 9): a NaN or Infinity `until` used to propagate
    // NaN seconds to the screen, and a `until` at or below zero left the
    // machine stuck in `cooldown`. A malformed `until` is refused outright.
    const { machine } = setup({ email: true });
    await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    machine.continueToMethodSelect();
    machine.chooseMethod('email');
    machine.requestMagicLink('person@example.com');
    expect(machine.onMagicLinkEvent({ type: 'sent' })).toBe(true);
    const before = machine.snapshot();
    for (const until of [NaN, Infinity, -Infinity, 0, -1]) {
      expect(machine.onMagicLinkEvent({ type: 'cooldown', until }), String(until)).toBe(false);
      expect(machine.snapshot(), String(until)).toEqual(before); // changes nothing
    }
    expect(machine.remainingCooldownSeconds()).toBe(0);
  });

  it('a finished cooldown reports ready-to-resend, not a permanent zero', async () => {
    // W0-06 review r4 (finding 9): at zero seconds the state used to stay
    // `cooldown` forever and a screen could not tell "resend allowed" from
    // "still counting". remainingCooldownSeconds() still reports the distinct
    // 0, and readyToResend() — the named predicate — now exposes that the
    // cooldown is over: the zero is never the only report.
    const { machine, clock } = setup({ email: true });
    await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    machine.continueToMethodSelect();
    machine.chooseMethod('email');
    machine.requestMagicLink('person@example.com');
    expect(machine.onMagicLinkEvent({ type: 'sent' })).toBe(true);
    expect(machine.onMagicLinkEvent({ type: 'cooldown', until: clock.now() + 30_000 })).toBe(true);
    // Still counting: not ready to resend.
    expect(machine.remainingCooldownSeconds()).toBe(30);
    expect(machine.readyToResend()).toBe(false);
    clock.advance(30_000);
    // Finished: ready-to-resend is reported — not a bare permanent zero.
    expect(machine.remainingCooldownSeconds()).toBe(0);
    expect(machine.readyToResend(), 'a finished cooldown reports ready-to-resend').toBe(true);

    // Edge: a cooldown whose valid `until` has already passed when the next
    // event arrives — the event lands, and a fresh cooldown counts again.
    expect(machine.onMagicLinkEvent({ type: 'cooldown', until: clock.now() + 20_000 })).toBe(true);
    expect(machine.remainingCooldownSeconds()).toBe(20);
    expect(machine.readyToResend()).toBe(false);
    clock.advance(20_000);
    expect(machine.readyToResend()).toBe(true);
    // The next event lands the same way from the finished cooldown, and the
    // run-out deadline is still what readiness reports.
    expect(machine.onMagicLinkEvent({ type: 'sent' })).toBe(true);
    expect(machine.snapshot().state).toBe('sent');
    expect(machine.readyToResend()).toBe(true);
  });

  it('a checkout that loses the consume race is held to the same gate: already-consumed on the in-process guarantee is restored-unverified, not done', async () => {
    // W0-06 review r5 (finding 1): tab B loses the consume race and lands in
    // `done` with no L2 re-confirmation — while the winner of the identical
    // race is held in restored-unverified. The gate routes by the RESULT, not
    // by the branch: a checkout consume under the weaker in-process
    // guarantee lands in restored-unverified in BOTH branches.
    const backing = new Map<string, string>();
    const clock = fakeClock();
    const winner = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    await winner.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    const loser = createSignInMachine({
      store: createIntentStore({ storage: backedStorage(backing), now: clock.now }),
      now: clock.now,
      providers: { google: true },
    });
    expect((await loser.beginWithStoredIntent()).state).toBe('intent-loaded');
    for (const m of [winner, loser]) {
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.sessionApproved();
    }
    const won = await winner.restoreDestination();
    expect(won.outcome).toBe('restored');
    expect(won.snapshot.state, 'the winner is held to the gate').toBe('restored-unverified');

    const lost = await loser.restoreDestination();
    expect(lost.outcome).toBe('already-restored');
    expect(lost.snapshot.restoreGuarantee, 'the race ran without cross-tab locks').toBe('in-process');
    expect(lost.snapshot.state, 'the loser is held to the SAME gate').toBe('restored-unverified');
    // Done is reached only through the gate — never on a checkout without a
    // confirmation.
    expect(loser.completeRestore(), 'the gate holds the loser too').toBe('not-restoring');
    expect(loser.snapshot().state, 'never done on a checkout without a confirmation').toBe('restored-unverified');
    expect(loser.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-1' })).toMatchObject({
      state: 'done',
    });
  });

  it('two concurrent restores: the loser changes nothing after the await, and done is reached only through the gate', async () => {
    // W0-06 review r5 (finding 1, part b): two concurrent restoreDestination()
    // calls both pass `state !== 'returning'` because the guard runs BEFORE
    // the await — and the store answers one consumed and one already-consumed
    // by design. The result that arrives for a restore that is no longer the
    // current one must change nothing.
    const { machine } = setup({ google: true });
    await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    const [first, second] = await Promise.all([machine.restoreDestination(), machine.restoreDestination()]);
    const outcomes = [first.outcome, second.outcome];
    expect(outcomes.filter((o) => o === 'not-restoring'), 'the loser changes nothing').toHaveLength(1);
    expect(
      outcomes.filter((o) => o === 'restored' || o === 'already-restored'),
      'exactly one result is applied',
    ).toHaveLength(1);
    // Whatever the store answered — consumed or already-consumed — the one
    // applied result goes through the checkout gate.
    expect(machine.snapshot().state, 'the gate holds both branches').toBe('restored-unverified');
    expect(machine.snapshot().restoreGuarantee, 'the applied restore reports its own guarantee').toBe('in-process');
    expect(machine.completeRestore()).toBe('not-restoring');
    expect(machine.snapshot().state, 'never done on a checkout without a confirmation').toBe('restored-unverified');
    expect(machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirm-2' })).toMatchObject({
      state: 'done',
    });
  });

  it('a restore whose result arrives after the person pressed back: nothing changes', async () => {
    // W0-06 review r5 (finding 1): the in-flight token is monotonic — a
    // result that arrives for a restore that is no longer the current one
    // changes nothing. The person pressed back while the consume was still
    // held; state, intent and restoreGuarantee are left as they were.
    const real = createIntentStore({ storage: memoryIntentStorage(), now: () => BASE });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: IntentStore = {
      ...real,
      consume: async () => {
        await gate;
        return real.consume();
      },
    };
    const machine = createSignInMachine({ store: slow, now: () => BASE, providers: { google: true } });
    await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    const inFlight = machine.restoreDestination(); // the consume is held at the gate

    // The person backs out of the flow and comes back...
    await machine.resume();
    expect(machine.snapshot().state).toBe('intent-loaded');
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    expect(machine.back(), 'the person pressed back').toBe(true);
    expect(machine.snapshot().state).toBe('method-select');

    // ...and the restore's result finally arrives. It is no longer the
    // current one: it changes nothing.
    release();
    const late = await inFlight;
    expect(late.outcome).toBe('not-restoring');
    expect(machine.snapshot().state, 'nothing changed').toBe('method-select');
    expect(machine.snapshot().intent?.consumedAt, 'nothing changed').toBeUndefined();
    expect(machine.snapshot().restoreGuarantee, 'nothing changed').toBe('none');
    expect(machine.snapshot().destination).toBe('/plans');
  });

  it('a person who mistyped their address can go back and choose again: sent and a finished cooldown both reach method-select with the intent intact, and a running cooldown does not', async () => {
    // W0-06 review r5 (finding 2): sent and cooldown were dead ends — no call
    // did anything from either. A mistyped address needs a way back to the
    // method choice: from `sent` always, from `cooldown` once the cooldown is
    // over. The intent is kept in every case.
    const { machine, clock } = setup({ email: true });
    await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    machine.continueToMethodSelect();
    machine.chooseMethod('email');
    machine.requestMagicLink('person@example.com');
    expect(machine.onMagicLinkEvent({ type: 'sent' })).toBe(true);
    expect(machine.snapshot().state).toBe('sent');

    // From `sent`, straight back to the method choice — the intent intact.
    expect(machine.continueToMethodSelect(), 'sent reaches method-select').toBe(true);
    expect(machine.snapshot().state).toBe('method-select');
    expect(machine.snapshot().intent, 'the intent is intact').not.toBeNull();
    expect(machine.snapshot().destination).toBe('/reviews');

    // A running cooldown refuses; a finished one lets the person choose again.
    machine.chooseMethod('email');
    machine.requestMagicLink('person@example.com');
    expect(machine.onMagicLinkEvent({ type: 'cooldown', until: clock.now() + 30_000 })).toBe(true);
    expect(machine.snapshot().state).toBe('cooldown');
    expect(machine.continueToMethodSelect(), 'a running cooldown does not').toBe(false);
    expect(machine.snapshot().state, 'the refusal changes nothing').toBe('cooldown');
    clock.advance(30_000); // the cooldown expires exactly at its deadline
    expect(machine.continueToMethodSelect(), 'a finished cooldown reaches method-select').toBe(true);
    expect(machine.snapshot().state).toBe('method-select');
    expect(machine.snapshot().intent, 'the intent is intact').not.toBeNull();
    expect(machine.snapshot().destination).toBe('/reviews');
  });

  it("the cooldown's seconds and its readiness come from one deadline: a sent event inside the window never reports zero", async () => {
    // W0-06 review r5 (finding 3): the seconds were computed only while the
    // state is `cooldown`, but a sent event moves out of `cooldown` with the
    // deadline still in the future — the screen read "0 seconds" while
    // readyToResend() was false. Both reports derive from cooldownUntil
    // alone, so the two can never disagree.
    const { machine, clock } = setup({ email: true });
    await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    machine.continueToMethodSelect();
    machine.chooseMethod('email');
    machine.requestMagicLink('person@example.com');
    expect(machine.onMagicLinkEvent({ type: 'cooldown', until: clock.now() + 30_000 })).toBe(true);
    expect(machine.remainingCooldownSeconds()).toBe(30);
    expect(machine.readyToResend()).toBe(false);

    // A sent event inside the window moves the state but never the deadline.
    expect(machine.onMagicLinkEvent({ type: 'sent' })).toBe(true);
    expect(machine.snapshot().state).toBe('sent');
    expect(machine.remainingCooldownSeconds(), 'the window is still running').toBe(30);
    expect(machine.readyToResend(), 'and the two can never disagree').toBe(false);
    clock.advance(30_000);
    expect(machine.remainingCooldownSeconds()).toBe(0);
    expect(machine.readyToResend(), 'one deadline: both say the cooldown is over').toBe(true);

    // A cooldown that expires exactly at now() is over the moment it lands.
    expect(machine.onMagicLinkEvent({ type: 'cooldown', until: clock.now() })).toBe(true);
    expect(machine.remainingCooldownSeconds()).toBe(0);
    expect(machine.readyToResend(), 'exactly at the deadline it is over').toBe(true);

    // The deadline is cleared when its purpose is spent: a new link goes out
    // and no stale countdown outlives it.
    expect(machine.continueToMethodSelect()).toBe(true); // the cooldown is over
    machine.chooseMethod('email');
    expect(machine.requestMagicLink('person@example.com')).toBe(true);
    expect(machine.remainingCooldownSeconds(), 'a cleared deadline reports no countdown').toBe(0);
    expect(machine.readyToResend(), 'and no readiness either').toBe(false);
  });

  it('a link-sent copy never survives its state: back, denied, canceled, offline and returning each carry their own copy', async () => {
    // W0-06 review r5 (finding 4): requestMagicLink() sets the "we sent a
    // link" copy and every transition out of provider-pending carried it
    // along — method-select, denied, canceled, offline and returning all
    // rendered a link-sent message over a state where no link is in flight.
    // One transition helper now sets the per-state copy at the moment a state
    // is entered and clears it otherwise.
    const linkSent = async (transition: (m: SignInMachine) => boolean, expected: SignInState) => {
      const { machine } = setup({ email: true });
      await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
      machine.continueToMethodSelect();
      machine.chooseMethod('email');
      expect(machine.requestMagicLink('person@example.com')).toBe(true);
      expect(machine.snapshot().copy, 'the sent copy is really there').toBe(
        magicLinkSentCopy('person@example.com'),
      );
      expect(transition(machine), expected).toBe(true);
      expect(machine.snapshot().state).toBe(expected);
      expect(machine.snapshot().copy, `${expected} carries its own copy, never the link-sent words`).toBeNull();
      expect(machine.snapshot().intent, 'the intent is kept').not.toBeNull();
    };
    await linkSent((m) => m.back(), 'method-select');
    await linkSent((m) => m.providerDenied(), 'denied');
    await linkSent((m) => m.providerCanceled(), 'canceled');
    await linkSent((m) => m.providerOffline(), 'offline');
    await linkSent((m) => m.sessionApproved(), 'returning');
  });

  it('a mutated snapshot cannot redirect: the intent is frozen and destination is re-checked against the allowlist', async () => {
    // W0-06 review r5 (finding 5): snapshot().intent was the machine's live
    // object and destination was intent.returnRoute with no check — a
    // consumer mutating returnRoute rewrote the open-redirect allowlist's own
    // output. The intent is frozen and destination is re-asserted through the
    // canonical-route check before it is reported.
    const { machine } = setup({ google: true });
    await machine.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    const snap = machine.snapshot();
    expect(Object.isFrozen(snap.intent), 'the intent is frozen').toBe(true);
    // A mutation attempt is refused outright — the machine's own state cannot
    // be rewritten through the snapshot.
    expect(() => {
      (snap.intent as Intent).returnRoute = 'https://evil.example';
    }).toThrow(TypeError);
    // The mutated COPY is the only thing changed: the machine is unchanged.
    const mutated = { ...(snap.intent as Intent), returnRoute: 'https://evil.example' };
    expect(mutated.returnRoute).toBe('https://evil.example');
    expect(machine.snapshot().intent?.returnRoute, 'the machine is unchanged').toBe('/plans');

    // The mutation attempt lands after parseIntent but before the restore:
    // the walk carries the person to the canonical route, not the string.
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    expect((await machine.restoreDestination()).snapshot.destination).toBe('/plans');

    // Even a hostile store that forces a bad route through cannot make the
    // machine report it as a destination: a route that fails the canonical
    // check reports null, never the mutated string.
    const backing = new Map<string, string>();
    const clock = fakeClock();
    const real = createIntentStore({ storage: backedStorage(backing), now: clock.now });
    const hostile: IntentStore = {
      ...real,
      consume: async () => ({
        outcome: 'consumed' as const,
        intent: {
          ...(snap.intent as Intent),
          consumedAt: new Date(clock.now()).toISOString(),
          returnRoute: 'https://evil.example',
        },
        durable: true,
        exclusive: 'in-process' as const,
      }),
    };
    const attacked = createSignInMachine({ store: hostile, now: clock.now, providers: { google: true } });
    await attacked.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
    attacked.continueToMethodSelect();
    attacked.chooseMethod('google');
    attacked.sessionApproved();
    const forced = await attacked.restoreDestination();
    expect(forced.snapshot.destination, 'never the mutated string').not.toBe('https://evil.example');
    expect(forced.snapshot.destination, 'a route that fails the check reports null').toBeNull();
  });

  it('confirmRestore carries the money-path confirmation id onto the done snapshot and refuses an empty one', async () => {
    // W0-06 review r5 (finding 9): { moneyPathConfirmed: true } is a literal
    // anyone can mint, so the call also carries an opaque handle. This
    // machine carries the id, it cannot verify it; L2 issues it and L2
    // verifies it.
    const toUnverified = async (m: SignInMachine) => {
      await m.armIntent({ product: 'forge', kind: 'checkout', returnRoute: '/plans', plan: 'shell' });
      m.continueToMethodSelect();
      m.chooseMethod('google');
      m.sessionApproved();
      await m.restoreDestination();
      expect(m.snapshot().state).toBe('restored-unverified');
      expect(m.snapshot().moneyPathConfirmationId, 'no id before the money path confirms').toBeNull();
    };

    const confirmed = setup({ google: true });
    await toUnverified(confirmed.machine);
    const done = confirmed.machine.confirmRestore({
      moneyPathConfirmed: true,
      confirmationId: 'l2-confirmation-42',
    });
    expect(done).toMatchObject({ state: 'done' });
    expect(
      confirmed.machine.snapshot().moneyPathConfirmationId,
      'the id travels to the done snapshot',
    ).toBe('l2-confirmation-42');
    // The same id twice: the second call is 'not-restoring' — the machine is
    // done and cannot be confirmed again.
    expect(
      confirmed.machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: 'l2-confirmation-42' }),
    ).toBe('not-restoring');
    expect(confirmed.machine.snapshot().moneyPathConfirmationId, 'the second call changes nothing').toBe(
      'l2-confirmation-42',
    );

    // An empty id is refused exactly like a wrong state: nothing changes.
    const empty = setup({ google: true });
    await toUnverified(empty.machine);
    expect(empty.machine.confirmRestore({ moneyPathConfirmed: true, confirmationId: '' })).toBe(
      'not-restoring',
    );
    expect(empty.machine.snapshot().state, 'an empty id changes nothing').toBe('restored-unverified');
    expect(empty.machine.snapshot().moneyPathConfirmationId).toBeNull();
  });

  it('the already-consumed restore stamps the store\'s returnRoute, not the stale loaded copy: the stored record\'s route wins', async () => {
    // W0-06-r8 finding 2: the already-consumed branch reported the machine's
    // local intent.returnRoute and ignored result.returnRoute. When the
    // stored record diverged from the loaded copy between load and consume,
    // the returned destination was stale. The store's record is the one that
    // was actually consumed, so its route wins — the stamped intent and the
    // destination both come from result.returnRoute, and the divergence is
    // resolved explicitly and safely (never a throw).
    const clock = fakeClock();
    const real = createIntentStore({ storage: memoryIntentStorage(), now: clock.now });
    const diverging: IntentStore = {
      ...real,
      consume: async () => ({
        outcome: 'already-consumed',
        returnRoute: '/engines', // the STORED record's route — diverged from the loaded copy
        durable: true,
        exclusive: 'in-process',
      }),
    };
    const machine = createSignInMachine({ store: diverging, now: clock.now, providers: { google: true } });
    await machine.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    machine.continueToMethodSelect();
    machine.chooseMethod('google');
    machine.sessionApproved();
    const restored = await machine.restoreDestination();
    expect(restored.outcome).toBe('already-restored');
    // The two disagree: the stored record's route wins on every surface.
    expect(restored.snapshot.returnRoute, "the store's route wins, not the stale loaded copy").toBe('/engines');
    expect(restored.snapshot.destination, "the store's route wins, not the stale loaded copy").toBe('/engines');
    expect(restored.snapshot.intent?.returnRoute, 'the consumed stamp carries the store\'s route').toBe('/engines');
    expect(restored.snapshot.intent?.consumedAt, 'still consumed-stamped').toBeTruthy();
    expect(machine.snapshot().state).toBe('done');

    // The failure mode of a divergence that cannot be trusted is explicit and
    // safe: a route outside the allowlist is never a destination (the r5
    // re-check), and nothing throws.
    const hostile: IntentStore = {
      ...real,
      consume: async () => ({
        outcome: 'already-consumed',
        returnRoute: 'javascript:evil',
        durable: true,
        exclusive: 'in-process',
      }),
    };
    const guarded = createSignInMachine({ store: hostile, now: clock.now, providers: { google: true } });
    await guarded.armIntent({ product: 'reviews', kind: 'demo', returnRoute: '/reviews' });
    guarded.continueToMethodSelect();
    guarded.chooseMethod('google');
    guarded.sessionApproved();
    await expect(guarded.restoreDestination()).resolves.toMatchObject({ outcome: 'already-restored' });
    expect(guarded.snapshot().destination, 'a route outside the allowlist is never a destination').toBeNull();
  });
});
