// W0-06: behaviours 10-15 — the sign-in state machine, method availability
// from configuration, the magic-link states (identical copy for a new and an
// existing email), denied/canceled/offline/conflict, restore-once, back
// navigation and install-intent survival across a restart. Injected storage
// and injected clock throughout; the machine never touches a provider.
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_HOME,
  CONFLICT_OPTIONS,
  SIGNIN_NOT_CONFIGURED_COPY,
  createSignInMachine,
  magicLinkCopy,
  methodAvailability,
  type SignInEvent,
} from '../src/clients/intent/signin';
import { CONSUMED_GRACE_MS, createIntentRecord, type IntentRecord } from '../src/clients/intent/schema';
import { createIntentStore, type IntentStorageAdapter } from '../src/clients/intent/store';

const HOUR = 60 * 60 * 1000;
const ENUMERATION = /couldn't|no such|does not exist|no account|not found/i;

function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  const adapter: IntentStorageAdapter = {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
  return { adapter, map };
}

function makeIntent(returnRoute: string, kind: 'checkout' | 'install' = 'checkout'): IntentRecord {
  const created = createIntentRecord(
    { product: 'builds', returnRoute, kind, plan: 'shell' },
    { now: () => 1_000 },
  );
  if (!created.ok) throw new Error('fixture intent rejected');
  return created.record;
}

function walkToProviderPending(
  machine: ReturnType<typeof createSignInMachine>,
  route = '/plans',
): void {
  machine.send({ type: 'intent-loaded', intent: makeIntent(route) });
  machine.send({ type: 'methods-shown' });
  machine.send({ type: 'method-chosen', method: 'google' });
}

describe('sign-in states', () => {
  it('the machine walks the locked states from idle to done exactly once', async () => {
    let consumeCalls = 0;
    let machine: ReturnType<typeof createSignInMachine>;
    machine = createSignInMachine({
      consumeIntent: async () => {
        expect(machine.state.name).toBe('restoring');
        consumeCalls += 1;
        return { outcome: 'consumed', route: '/plans', record: makeIntent('/plans'), durable: true };
      },
    });
    expect(machine.state.name).toBe('idle');
    machine.send({ type: 'intent-loaded', intent: makeIntent('/plans') });
    expect(machine.state.name).toBe('intent-loaded');
    machine.send({ type: 'methods-shown' });
    expect(machine.state.name).toBe('method-select');
    machine.send({ type: 'method-chosen', method: 'google' });
    expect(machine.state.name).toBe('provider-pending');
    machine.send({ type: 'provider-returned' });
    expect(machine.state.name).toBe('returning');
    const done = await machine.restore();
    expect(done.name).toBe('done');
    expect(machine.destination()).toBe('/plans');
    expect(machine.state.intent?.returnRoute).toBe('/plans');
    expect(consumeCalls).toBe(1);
  });

  it('a method that is not configured is hidden, never shown disabled, and the copy says sign-in opens when the account service is connected', () => {
    const none = methodAvailability([]);
    expect(none.visible).toEqual([]);
    expect(none.hidden).toEqual(['google', 'apple', 'email']);
    expect(none.allUnavailable).toBe(true);
    expect(SIGNIN_NOT_CONFIGURED_COPY).toMatch(/account service/i);

    const emailOnly = methodAvailability(['email']);
    expect(emailOnly.visible).toEqual(['email']);
    expect(emailOnly.hidden).toEqual(['google', 'apple']); // hidden, not disabled
    expect(emailOnly.allUnavailable).toBe(false);
    // A hidden method can never leak into the visible list as a promise.
    for (const method of emailOnly.hidden) {
      expect(emailOnly.visible).not.toContain(method);
    }
  });

  it('magic link copy is identical for a new and an existing email, with cooldown carrying the remaining seconds', () => {
    const buildEmailMachine = (email: string) => {
      const machine = createSignInMachine();
      machine.send({ type: 'intent-loaded', intent: makeIntent('/plans') });
      machine.send({ type: 'methods-shown' });
      machine.send({ type: 'method-chosen', method: 'email' });
      const sent = machine.send({ type: 'link-sent', email });
      return { machine, sent };
    };

    const newPerson = buildEmailMachine('new.person@example.com');
    const returningPerson = buildEmailMachine('returning.person@example.com');
    expect(newPerson.sent.name).toBe('provider-pending');
    expect(newPerson.sent.magicLinkPhase).toBe('sent');
    // The copy depends only on the phase — never on whether the account
    // exists, which the machine cannot even represent.
    expect(magicLinkCopy('sent')).toBe(magicLinkCopy(returningPerson.sent.magicLinkPhase as 'sent'));
    expect(magicLinkCopy('sent')).not.toMatch(ENUMERATION);
    // The email itself is never stored in the machine state.
    expect(JSON.stringify(newPerson.machine.state)).not.toContain('new.person@example.com');
    expect(JSON.stringify(returningPerson.machine.state)).not.toContain('returning.person@example.com');

    const machine = newPerson.machine;
    const cooldown = machine.send({ type: 'link-cooldown', remainingSeconds: 45 });
    expect(cooldown.name).toBe('cooldown');
    expect(cooldown.cooldownRemainingSeconds).toBe(45);
    expect(magicLinkCopy('cooldown')).not.toMatch(ENUMERATION);
    expect(magicLinkCopy('cooldown').length).toBeGreaterThan(0);

    const resent = machine.send({ type: 'link-sent', email: 'new.person@example.com' });
    expect(resent.name).toBe('provider-pending');
    expect(resent.magicLinkPhase).toBe('sent');
    const used = machine.send({ type: 'link-used' });
    expect(used.magicLinkPhase).toBe('used');
    const expired = machine.send({ type: 'link-expired' });
    expect(expired.name).toBe('expired');

    const wrongBrowser = createSignInMachine();
    walkToProviderPending(wrongBrowser);
    expect(wrongBrowser.send({ type: 'wrong-browser' }).name).toBe('wrong-browser');

    const offline = createSignInMachine();
    walkToProviderPending(offline);
    expect(offline.send({ type: 'offline' }).name).toBe('offline');
  });

  it('denied and canceled return to method select with the intent intact; conflict stops the flow, keeps purchases and offers verified link manage and support; offline keeps the intent and never claims success', () => {
    let consumeCalls = 0;
    const spy = async () => {
      consumeCalls += 1;
      return { outcome: 'consumed' as const, route: '/plans', record: null, durable: true };
    };

    const denied = createSignInMachine({ consumeIntent: spy });
    walkToProviderPending(denied);
    expect(denied.send({ type: 'denied' }).name).toBe('denied');
    const backToMethods = denied.send({ type: 'ack' });
    expect(backToMethods.name).toBe('method-select');
    expect(backToMethods.intent?.returnRoute).toBe('/plans');

    const canceled = createSignInMachine({ consumeIntent: spy });
    walkToProviderPending(canceled);
    expect(canceled.send({ type: 'canceled' }).name).toBe('canceled');
    expect(canceled.send({ type: 'ack' }).intent?.returnRoute).toBe('/plans');

    const conflict = createSignInMachine({ consumeIntent: spy });
    walkToProviderPending(conflict);
    const stopped = conflict.send({ type: 'conflict' });
    expect(stopped.name).toBe('conflict');
    expect(stopped.conflictOptions?.map((option) => option.kind)).toEqual([
      'verified-link',
      'manage',
      'support',
    ]);
    expect(CONFLICT_OPTIONS.map((option) => ('route' in option ? option.route : null))).toEqual([
      null,
      '/account',
      '/support',
    ]);
    // Conflict stops the flow: no grant, no consume, purchase records kept.
    expect(consumeCalls).toBe(0);
    expect(conflict.destination()).toBeNull();
    expect(conflict.send({ type: 'ack' }).name).toBe('conflict');

    const offline = createSignInMachine({ consumeIntent: spy });
    walkToProviderPending(offline);
    const offlineState = offline.send({ type: 'offline' });
    expect(offlineState.name).toBe('offline');
    expect(offlineState.intent?.returnRoute).toBe('/plans');
    expect(offline.destination()).toBeNull(); // never claims success
    expect(offline.send({ type: 'ack' }).name).toBe('method-select');
    expect(consumeCalls).toBe(0);
  });

  it('restoring to done happens once; a second return with no active intent lands on the account home, never a redirect loop', async () => {
    const clock = fakeClock();
    const { adapter } = memoryStorage();
    const store = createIntentStore({ storage: adapter, now: clock.now });
    const saved = await store.save({ product: 'builds', returnRoute: '/plans', kind: 'checkout', plan: 'shell' });
    expect(saved.ok).toBe(true);

    let consumeCalls = 0;
    const countingConsume = async () => {
      consumeCalls += 1;
      return store.consume();
    };
    const first = createSignInMachine({ consumeIntent: countingConsume });
    first.send({ type: 'intent-loaded', intent: saved.ok ? saved.record : makeIntent('/plans') });
    first.send({ type: 'methods-shown' });
    first.send({ type: 'method-chosen', method: 'google' });
    first.send({ type: 'provider-returned' });
    const done = await first.restore();
    expect(done.name).toBe('done');
    expect(first.destination()).toBe('/plans');
    expect(consumeCalls).toBe(1);

    // Restoring again is a no-op: done happens once.
    const again = await first.restore();
    expect(again.name).toBe('done');
    expect(first.destination()).toBe('/plans');
    expect(consumeCalls).toBe(1);

    // A second return after the restore window: the consumed record is gone,
    // so the account home is the destination — never the consumed route.
    clock.advance(CONSUMED_GRACE_MS + HOUR);
    const second = createSignInMachine({ consumeIntent: countingConsume });
    second.send({ type: 'no-intent' });
    expect(second.state.name).toBe('no-intent');
    expect(second.destination()).toBe(ACCOUNT_HOME);
    expect(second.destination()).not.toBe('/plans');

    // And restore() over an absent store also lands on the account home.
    const empty = createSignInMachine({ consumeIntent: countingConsume });
    empty.send({ type: 'intent-loaded', intent: makeIntent('/plans') });
    empty.send({ type: 'methods-shown' });
    empty.send({ type: 'method-chosen', method: 'google' });
    empty.send({ type: 'provider-returned' });
    const noIntent = await empty.restore();
    expect(noIntent.name).toBe('no-intent');
    expect(empty.destination()).toBe(ACCOUNT_HOME);
  });

  it('back from provider-pending keeps the intent; an install intent survives leaving the site inside its 24h ttl', async () => {
    const machine = createSignInMachine();
    machine.send({ type: 'intent-loaded', intent: makeIntent('/builds') });
    machine.send({ type: 'methods-shown' });
    machine.send({ type: 'method-chosen', method: 'google' });
    expect(machine.state.name).toBe('provider-pending');
    const back = machine.send({ type: 'back' });
    expect(back.name).toBe('method-select');
    expect(back.intent?.returnRoute).toBe('/builds'); // intent intact

    const clock = fakeClock();
    const { adapter } = memoryStorage();
    const firstVisit = createIntentStore({ storage: adapter, now: clock.now });
    await firstVisit.save({ product: 'engines', returnRoute: '/engines', kind: 'install' });

    clock.advance(1_000); // leave the site, come back one second later
    const returning = createIntentStore({ storage: adapter, now: clock.now });
    // Still active just inside the 24h TTL (one millisecond before expiry).
    clock.advance(24 * HOUR - 1_001);
    const insideTtl = await returning.load();
    expect(insideTtl.state).toBe('active');
    clock.advance(-(24 * HOUR - 1_000)); // back to one second after the restart
    const loaded = await returning.load();
    expect(loaded.state).toBe('active');
    const intent = loaded.record as IntentRecord;
    const machine2 = createSignInMachine({ consumeIntent: () => returning.consume() });
    let event: SignInEvent = { type: 'intent-loaded', intent };
    machine2.send(event);
    machine2.send({ type: 'methods-shown' });
    machine2.send({ type: 'method-chosen', method: 'google' });
    machine2.send({ type: 'provider-returned' });
    const done = await machine2.restore();
    expect(done.name).toBe('done');
    expect(machine2.destination()).toBe('/engines');
    // After the restore window the consumed record is gone — no loop back.
    clock.advance(CONSUMED_GRACE_MS + HOUR);
    expect((await returning.load()).state).toBe('absent');
  });
});
