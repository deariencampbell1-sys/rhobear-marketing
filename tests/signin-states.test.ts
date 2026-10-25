// W0-06 behaviours 10–15: the sign-in state machine, method availability from
// configuration, the magic-link states, denied/canceled/offline/conflict,
// restore-once and back navigation. Injected storage and injected clock only.
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_HOME_ROUTE,
  SIGNIN_PROVIDERS,
  SIGNIN_STATES,
  UNCONFIGURED_SIGNIN_COPY,
  createSignInMachine,
  isMethodAvailable,
  magicLinkSentCopy,
  visibleMethods,
  type SignInProviderConfig,
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
    const restoring = await machine.restoreDestination();
    expect(restoring.state).toBe('restoring');
    expect(machine.completeRestore()).toBe(true);
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
    machine.onMagicLinkEvent({ type: 'sent' });
    expect(machine.snapshot().state).toBe('sent');
    // The sent copy cannot know or say whether the address owns an account:
    // no enumeration, no "we couldn't find that email".
    expect(magicLinkSentCopy('new@example.com')).toBe(magicLinkSentCopy('longtime@example.com'));
    expect(machine.snapshot().copy).toBe(magicLinkSentCopy('person@example.com'));
    expect(magicLinkSentCopy('person@example.com')).not.toMatch(/couldn't find|no account|not registered|unknown address/i);
    // Cooldown carries the remaining seconds on the injected clock.
    machine.onMagicLinkEvent({ type: 'cooldown', until: clock.now() + 30_000 });
    expect(machine.snapshot().state).toBe('cooldown');
    expect(machine.remainingCooldownSeconds()).toBe(30);
    clock.advance(10_000);
    expect(machine.remainingCooldownSeconds()).toBe(20);
    // The remaining link states, each reachable and named.
    machine.onMagicLinkEvent({ type: 'expired' });
    expect(machine.snapshot().state).toBe('expired');
    machine.onMagicLinkEvent({ type: 'used' });
    expect(machine.snapshot().state).toBe('used');
    machine.onMagicLinkEvent({ type: 'wrong-browser' });
    expect(machine.snapshot().state).toBe('wrong-browser');
    machine.onMagicLinkEvent({ type: 'offline' });
    expect(machine.snapshot().state).toBe('offline');
    expect(machine.snapshot().intent).not.toBeNull();
    expect(machine.snapshot().claimedSuccess).toBe(false);
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
});
