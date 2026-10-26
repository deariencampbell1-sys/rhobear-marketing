// W0-06: the sign-in state machine and method availability. No OAuth client,
// no provider secret, no network call, no screen — providers resolve through
// L2, and this module only models what the front door may honestly promise.
// Nothing is configured in this repo today, so every method reports
// unavailable and is hidden, and the copy says sign-in opens when the account
// service is connected. A disabled-but-promising provider button is drift.

import { isCanonicalReturnRoute, type Intent, type IntentKind } from './schema';
import type {
  ConsumeExclusivity,
  ConsumeResult,
  CreateIntentInput,
  CreateResult,
  IntentStore,
  LoadResult,
} from './store';

export const SIGNIN_PROVIDERS = Object.freeze(['apple', 'google', 'email'] as const);
export type SignInProviderId = (typeof SIGNIN_PROVIDERS)[number];

/**
 * Method availability comes from configuration and nothing else: `true` means
 * configured (L2 has the provider), absent or `false` means not configured.
 * The machine stays configurable and unconfigured in this repo.
 */
export type SignInProviderConfig = Partial<Record<SignInProviderId, boolean>>;

export function isMethodAvailable(config: SignInProviderConfig, id: SignInProviderId): boolean {
  return config[id] === true;
}

/**
 * Behaviour 11: the methods a screen may render. A method that is not
 * configured is hidden — it never appears as a disabled control promising a
 * future provider.
 */
export function visibleMethods(config: SignInProviderConfig): SignInProviderId[] {
  return SIGNIN_PROVIDERS.filter((id) => isMethodAvailable(config, id));
}

export const UNCONFIGURED_SIGNIN_COPY =
  'RHOBEAR sign-in opens when the account service is connected. Everything else here already works.';

/**
 * Behaviour 12: the sent copy is identical for a new email and an existing
 * email. The machine takes the address and nothing else — there is no input
 * by which account existence could change a word, and no "we couldn't find
 * that email" message exists anywhere in this module.
 */
const MAGIC_LINK_SENT_TEXT =
  'We sent a link to that address. Open it in this browser to continue where you left off.';

export function magicLinkSentCopy(email: string): string {
  void email; // deliberately unused: the copy must not depend on the address
  return MAGIC_LINK_SENT_TEXT;
}

/**
 * The board's states (behaviour 10) plus the two magic-link leaf states
 * behaviour 12 adds (`sent`, `used`) and `link-expired`, the W0-06 review r3
 * (finding 1) split of the magic-link expiry from the intent's `expired`.
 * The machine never invents a step the board does not have.
 */
export const SIGNIN_STATES = Object.freeze([
  'idle',
  'intent-loaded',
  'method-select',
  'provider-pending',
  'returning',
  'restoring',
  'restored-unverified',
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
  'sent',
  'used',
] as const);
export type SignInState = (typeof SIGNIN_STATES)[number];

/** The exclusivity a restore actually ran under, carried into the snapshot
 * (W0-06 review r2, finding 3): 'web-locks' — an exclusive cross-tab Web Lock
 * was held for the consume; 'in-process' — only this tab's queue serialised
 * it; 'none' — no restore has happened. A screen charging money must treat
 * 'in-process' on a checkout as unverified. */
export type RestoreGuarantee = 'web-locks' | 'in-process' | 'none';

/** W0-06 review r2 (finding 6): completeRestore reports which of the three
 * realities happened, instead of a bare boolean that cannot tell "just
 * restored" from "already done". */
export type CompleteRestoreResult = 'restored' | 'already-done' | 'not-restoring';

/** W0-06 review r2 (finding 6): restoreDestination reports the outcome too —
 * a wrong-state call is 'not-restoring', never a silently returned snapshot.
 * A call from the right state whose record has vanished (expired, absent,
 * invalid) also reports 'not-restoring': nothing was restored. */
export type RestoreDestinationResult =
  | { outcome: 'restored'; snapshot: SignInSnapshot }
  | { outcome: 'already-restored'; snapshot: SignInSnapshot }
  | { outcome: 'not-restoring'; snapshot: SignInSnapshot };

/** W0-06 review r4 (finding 4): the money path's re-confirmation before
 * charging, asserted at the call site. This machine cannot verify the
 * re-confirmation; the caller asserts it, and the required argument exists so
 * the assertion is visible at every call site. It is not a token and nothing
 * here verifies anything — L2 owns the re-confirmation itself. A missing or
 * false assertion is refused with 'not-restoring', exactly like a wrong
 * state. */
export type MoneyPathAssertion = {
  readonly moneyPathConfirmed: true;
  /** The opaque id L2 issued alongside its re-confirmation. This machine
   * carries the id, it cannot verify it; L2 issues it and L2 verifies it. An
   * empty or absent id is refused exactly like a wrong state (W0-06 review r5,
   * finding 9). */
  readonly confirmationId: string;
};

/** W0-06 review r3 (finding 2): confirmRestore answers with the done
 * snapshot, or the literal 'not-restoring' from any other state — a wrong
 * state changes nothing. */
export type ConfirmRestoreResult = SignInSnapshot | 'not-restoring';

/**
 * The only states a magic-link event may arrive from: while the machine is
 * still waiting on the provider, or inside the magic-link states themselves.
 * A late or duplicated provider event arriving at a finished state (done,
 * denied, conflict, expired, used, wrong-browser, offline, …) must not drag
 * the flow backwards — onMagicLinkEvent refuses it and reports false
 * (W0-06 review r1).
 */
/** W0-06 review r5 (finding 10): typed as the states themselves, so a typo in
 * the list is a compile error — not a silently unreachable source state. */
const MAGIC_LINK_EVENT_SOURCES: readonly SignInState[] = Object.freeze(['provider-pending', 'sent', 'cooldown']);

/** Provider-reported magic-link events; the machine owns no provider. */
export type MagicLinkEvent =
  | { type: 'sent' }
  | { type: 'cooldown'; until: number } // epoch ms on the injected clock; finite and positive, refused otherwise
  | { type: 'expired' }
  | { type: 'used' }
  | { type: 'wrong-browser' } // the link was opened in a different browser
  | { type: 'offline' };

/** Behaviour 13: what a conflict offers — and nothing else, ever. */
export type RecoveryOption = 'verified-link' | 'manage' | 'support';

/** The account home is where a person with no active intent lands. */
export const ACCOUNT_HOME_ROUTE = '/account';

export type SignInSnapshot = {
  state: SignInState;
  /** The original return route, or null when no intent exists. */
  returnRoute: string | null;
  /** Where to send the person now: `/account` for no-intent, null when the
   * intent expired, the return route when only the magic link did. */
  destination: string | null;
  /** The machine's intent — frozen at every install point (W0-06 review r5,
   * finding 5), so a consumer cannot rewrite the machine's state through it. */
  intent: Readonly<Intent> | null;
  method: SignInProviderId | null;
  /** True only after a provider-reported approval; offline never sets it. */
  claimedSuccess: boolean;
  /** Set on conflict: every purchase record is kept. */
  purchasesPreserved: boolean | null;
  /** Always false here: granting is L2's act, never this machine's. */
  granted: boolean;
  /** Always false here: equal email strings never link accounts. */
  linkedByEmail: boolean;
  recovery: readonly RecoveryOption[] | null;
  copy: string | null;
  /** W0-06 review r2 (finding 3): the exclusivity the last restore actually
   * ran under. A caller cannot tell a cross-tab single-use guarantee from a
   * same-tab one without this. */
  restoreGuarantee: RestoreGuarantee;
  /** The money-path confirmation id carried into `done`, or null. This
   * machine carries the id, it cannot verify it; L2 issues it and L2 verifies
   * it (W0-06 review r5, finding 9). */
  moneyPathConfirmationId: string | null;
};

export type SignInMachine = {
  snapshot(): SignInSnapshot;
  /** CTA side: create the intent from an allowlisted input. */
  armIntent(input: CreateIntentInput): Promise<CreateResult>;
  /** Return side: load whatever intent survived and take the right branch. */
  beginWithStoredIntent(): Promise<SignInSnapshot>;
  /** Alias for the second return: same logic, restore-once semantics. */
  resume(): Promise<SignInSnapshot>;
  continueToMethodSelect(): boolean;
  chooseMethod(id: SignInProviderId): boolean;
  /** Back navigation from provider-pending: the intent is untouched. */
  back(): boolean;
  providerDenied(): boolean;
  providerCanceled(): boolean;
  providerOffline(): boolean;
  channelConflict(): boolean;
  /** The provider reported an approved session; session proof is L2's. */
  sessionApproved(): boolean;
  /** Consume the intent exactly once and move to restoring. Reports which
   * of the three realities happened (W0-06 review r2, finding 6). */
  restoreDestination(): Promise<RestoreDestinationResult>;
  /** restoring → done; the result says whether it restored, was already
   * done, or was called from a state where nothing is being restored. */
  completeRestore(): CompleteRestoreResult;
  /** restored-unverified → done, called by the money path AFTER its own
   * re-confirmation through L2 (W0-06 review r3, finding 2). The assertion is
   * required and explicit (W0-06 review r4, finding 4): this machine cannot
   * verify the re-confirmation; the caller asserts it, and the required
   * argument exists so the assertion is visible at every call site. The call
   * also carries L2's opaque confirmation id (W0-06 review r5, finding 9):
   * this machine carries the id, it cannot verify it; L2 issues it and L2
   * verifies it. A missing or false assertion, an empty id — like every
   * other state — reports 'not-restoring' and is left untouched. */
  confirmRestore(assertion: MoneyPathAssertion): ConfirmRestoreResult;
  /** W0-06 review r4 (finding 9): the named predicate that exposes what a
   * bare zero cannot — true exactly when a cooldown deadline exists and has
   * passed: the cooldown is over and a new link may be requested.
   * remainingCooldownSeconds() reports a distinct 0 both when no cooldown is
   * running and when one has finished; this predicate is the distinction, so
   * a screen never reads a permanent zero as "still counting". */
  readyToResend(): boolean;
  requestMagicLink(email: string): boolean;
  onMagicLinkEvent(event: MagicLinkEvent): boolean;
  remainingCooldownSeconds(): number;
};

export type SignInMachineDeps = {
  store: IntentStore;
  now?: () => number;
  providers: SignInProviderConfig;
};

export function createSignInMachine(deps: SignInMachineDeps): SignInMachine {
  const store = deps.store;
  const now = deps.now ?? (() => Date.now());
  const providers = deps.providers;

  let state: SignInState = 'idle';
  let intent: Intent | null = null;
  let method: SignInProviderId | null = null;
  let claimedSuccess = false;
  let recovery: readonly RecoveryOption[] | null = null;
  let purchasesPreserved: boolean | null = null;
  let copy: string | null = null;
  // W0-06 review r4 (finding 1): nullable so resetTransient() can clear it —
  // null means "no cooldown deadline exists", never a zero that could be
  // mistaken for a countdown.
  let cooldownUntil: number | null = null;
  // W0-06 review r2 (finding 3): the exclusivity of the last restore, so the
  // screen can tell a cross-tab guarantee from a same-tab one.
  let restoreGuarantee: RestoreGuarantee = 'none';
  // W0-06 review r5 (finding 9): the money-path confirmation id carried into
  // `done`, or null.
  let moneyPathConfirmationId: string | null = null;
  // W0-06 review r5 (finding 1): the monotonic in-flight restore token —
  // incremented when a restore starts and whenever the flow moves on,
  // captured before the await and compared after it.
  let restoreToken = 0;

  /** W0-06 review r5 (finding 4): the ONE writer of `state` and `copy`. Every
   * state change goes through it: it sets the state's own copy at the moment
   * the state is entered and clears the copy otherwise, so no state can carry
   * another state's words. No path may set `copy` without going through here. */
  function enterState(to: SignInState, stateCopy: string | null = null): void {
    state = to;
    copy = stateCopy;
  }

  function snapshot(): SignInSnapshot {
    let destination: string | null;
    if (state === 'no-intent') {
      destination = ACCOUNT_HOME_ROUTE;
    } else if (state === 'expired') {
      // An expired INTENT is never restored: no destination at all.
      destination = null;
    } else {
      // Every other state keeps the intent's return route — including
      // `link-expired`, where the magic link died but the intent is still
      // live (W0-06 review r3, finding 1). W0-06 review r5 (finding 5): the
      // route is re-asserted through the canonical-route check before it is
      // reported — a route that fails the check reports null, never a mutated
      // or hostile string. The allowlist's own output is the only thing that
      // can ever be a destination.
      destination = intent && isCanonicalReturnRoute(intent.returnRoute) ? intent.returnRoute : null;
    }
    return {
      state,
      returnRoute: intent ? intent.returnRoute : null,
      destination,
      intent,
      method,
      claimedSuccess,
      purchasesPreserved,
      granted: false,
      linkedByEmail: false,
      recovery,
      copy,
      restoreGuarantee,
      moneyPathConfirmationId,
    };
  }

  /** W0-06 review r4 (finding 1): the ONE reset for every transient field the
   * machine owns — claimedSuccess, recovery, purchasesPreserved,
   * restoreGuarantee, copy, method and cooldownUntil. It runs at the top of
   * beginWithStoredIntent() and on both branches of armIntent() (every path
   * back to `idle` is one of those branches). Nothing else may set these
   * fields to their defaults: one function, so the next branch cannot forget. */
  function resetTransient(): void {
    claimedSuccess = false;
    recovery = null;
    purchasesPreserved = null;
    restoreGuarantee = 'none';
    moneyPathConfirmationId = null;
    method = null;
    cooldownUntil = null;
    enterState(state); // the one copy writer: re-entering with no copy clears it
    // W0-06 review r5 (finding 1): a fresh flow is a new one — a consume
    // result still in flight is stale from here on and changes nothing.
    restoreToken += 1;
  }

  /** W0-06 review r4 (finding 6): a fabricated consumed stamp never exceeds
   * the record's own expiresAt — a stamp past it would make the snapshot's
   * record fail parseIntent's consumedAt range check and refuse to re-save. */
  function stampConsumed(record: Readonly<Intent>): Intent {
    return Object.freeze({
      ...record,
      consumedAt: new Date(Math.min(now(), Date.parse(record.expiresAt))).toISOString(),
    });
  }

  /** W0-06 review r5 (finding 1): the ONE checkout money gate, used by BOTH
   * consume branches. A checkout whose consume result reports the weaker
   * in-process exclusivity lands in `restored-unverified` — never in a
   * terminal done state — whether the store answered `consumed` or
   * `already-consumed`: the loser of the consume race is held to the same L2
   * re-confirmation as its winner. Everything else lands in the branch's own
   * unconfirmed state — `restoring` for a fresh consume (a checkout under a
   * real cross-tab lock, or an install, demo or account restore, where the
   * worst case is a repeated navigation, not a repeated charge) and `done`
   * for a restore that finds the intent already consumed. */
  function stateAfterConsume(
    kind: IntentKind | undefined,
    exclusive: ConsumeExclusivity,
    unconfirmed: SignInState,
  ): SignInState {
    return kind === 'checkout' && exclusive === 'in-process' ? 'restored-unverified' : unconfirmed;
  }

  function requireIntent(): boolean {
    if (!intent) {
      enterState('no-intent');
      return false;
    }
    return true;
  }

  async function armIntent(input: CreateIntentInput): Promise<CreateResult> {
    const result = await store.create(input);
    if (result.ok) {
      // W0-06 review r4 (finding 1): resetTransient() on BOTH branches — a
      // fresh intent starts with nothing claimed, nothing restored and no
      // leftover copy, method or cooldown from the walk before it.
      resetTransient();
      intent = result.intent;
      enterState('intent-loaded');
    } else {
      // The whole intent was rejected (bad route, bad product, …): there is
      // no fallback destination and nothing to restore later. resetTransient()
      // runs here too (W0-06 review r4, finding 1) — a machine that had
      // claimed a session or hit a conflict must not report that history over
      // a rejected intent — and the only copy left is this return's failure
      // copy.
      resetTransient();
      intent = null;
      enterState('idle', `That destination could not be saved (${result.problem}).`);
    }
    return result;
  }

  async function beginWithStoredIntent(): Promise<SignInSnapshot> {
    // W0-06 review r3 (finding 6) and review r4 (findings 1 and 2): EVERY
    // branch resets the transient fields, not just `active` — a machine
    // reused across returns must show this return's state only, and
    // resetTransient() clears all of them (copy and method included) at the
    // top, before any branch. On the consumed branch this reset is also the
    // honest guarantee: no restore ran here, so no lock existed (finding 5).
    resetTransient();
    const loaded: LoadResult = await store.load();
    if (loaded.state === 'active') {
      intent = loaded.intent;
      enterState('intent-loaded');
    } else if (loaded.state === 'consumed') {
      // Restore-once: the route is reported again but nothing re-runs — a
      // consumed intent can never restart a checkout or a job. The loaded
      // record is already consumed-stamped (W0-06 review r3, finding 5).
      intent = loaded.intent;
      enterState('done');
    } else if (loaded.state === 'expired') {
      intent = null;
      enterState('expired');
    } else {
      // absent or invalid: the account home, never a redirect loop.
      intent = null;
      enterState('no-intent');
    }
    return snapshot();
  }

  function continueToMethodSelect(): boolean {
    // W0-06 review r3 (finding 1): an expired INTENT is terminal — there is
    // nothing left to restore, and the refusal must not drag the state off
    // `expired` either.
    if (state === 'expired') return false;
    if (!requireIntent()) return false;
    if (
      state === 'intent-loaded' ||
      state === 'denied' ||
      state === 'canceled' ||
      state === 'offline' ||
      state === 'provider-pending' ||
      // W0-06 review r3 (finding 1): the link expired but the intent did not
      // — send a new link and keep the place.
      state === 'link-expired' ||
      // W0-06 review r4 (finding 3): a used link and a wrong-browser link are
      // live-intent states — the intent is unconsumed in each — so both offer
      // a new one instead of dead-ending until a page reload.
      state === 'used' ||
      state === 'wrong-browser' ||
      // W0-06 review r5 (finding 2): sent and cooldown are not dead ends — a
      // person who mistyped their address goes back and chooses again. From
      // `cooldown` only once the cooldown is over (readyToResend()).
      state === 'sent' ||
      (state === 'cooldown' && readyToResend())
    ) {
      enterState('method-select'); // the intent is kept
      return true;
    }
    return false;
  }

  function chooseMethod(id: SignInProviderId): boolean {
    if (state !== 'method-select' || !intent) return false;
    if (!isMethodAvailable(providers, id)) {
      // Behaviour 11: an unconfigured method cannot be chosen and is never
      // shown disabled with a promise.
      enterState('method-select', UNCONFIGURED_SIGNIN_COPY);
      return false;
    }
    method = id;
    enterState('provider-pending');
    return true;
  }

  function back(): boolean {
    if (state !== 'provider-pending' || !intent) return false;
    // W0-06 review r5 (finding 1): a back press is a new flow too — a consume
    // result still in flight is stale from here on and changes nothing.
    restoreToken += 1;
    enterState('method-select'); // the intent is untouched
    return true;
  }

  function fromPending(to: SignInState, mutate?: () => void): boolean {
    if (state !== 'provider-pending' || !intent) return false;
    mutate?.();
    enterState(to); // the entered state's own copy — anything else is cleared
    return true;
  }

  function providerDenied(): boolean {
    // denied → method-select with the intent intact (the branch is shown
    // first; continueToMethodSelect carries the person back).
    return fromPending('denied');
  }

  function providerCanceled(): boolean {
    return fromPending('canceled');
  }

  function providerOffline(): boolean {
    // Keeps the intent and never claims success — claimedSuccess stays false.
    return fromPending('offline');
  }

  function channelConflict(): boolean {
    // Behaviour 13: stop the flow, keep every purchase record, offer verified
    // link / Manage / support. Never grants, never links by email string.
    return fromPending('conflict', () => {
      recovery = ['verified-link', 'manage', 'support'];
      purchasesPreserved = true;
    });
  }

  function sessionApproved(): boolean {
    return fromPending('returning', () => {
      claimedSuccess = true;
    });
  }

  async function restoreDestination(): Promise<RestoreDestinationResult> {
    if (state !== 'returning' || !intent) {
      // W0-06 review r2 (finding 6): a wrong-state call is reported, not
      // silently absorbed — the screen sees not-restoring.
      return { outcome: 'not-restoring', snapshot: snapshot() };
    }
    // W0-06 review r5 (finding 1): a monotonic in-flight token, incremented
    // when a restore starts and captured before the await. It is compared
    // after the await: a result that arrives for a restore that is no longer
    // the current one (a second restore started, the flow re-entered, the
    // person pressed back) changes NOTHING — state, intent and
    // restoreGuarantee are left as the in-flight call left them.
    const token = (restoreToken += 1);
    const result: ConsumeResult = await store.consume();
    if (token !== restoreToken) {
      return { outcome: 'not-restoring', snapshot: snapshot() };
    }
    if (result.outcome === 'consumed') {
      intent = Object.freeze(result.intent);
      restoreGuarantee = result.exclusive;
      // W0-06 review r2 (finding 3) and review r5 (finding 1): without an
      // exclusive cross-tab Web Lock, single-use is only this tab's promise —
      // a checkout must not present itself as plainly restored: the screen
      // has to re-confirm through L2's money path before anything is charged.
      // The gate routes by the RESULT through the shared helper — the same
      // one the already-consumed branch uses, so the two cannot diverge again.
      enterState(stateAfterConsume(result.intent.kind, result.exclusive, 'restoring'));
      return { outcome: 'restored', snapshot: snapshot() };
    } else if (result.outcome === 'already-consumed') {
      // Someone already restored this intent (a second tab, a reload): report
      // the original route once more and never re-run the operation.
      // W0-06 review r3 (finding 5): the snapshot carries a consumed-stamped
      // intent — the store's already-consumed outcome reports the route, not
      // the original stamp, so the record is stamped at the moment of
      // observation and a screen never reads intent.consumedAt as undefined —
      // and the guarantee of THIS restore attempt (the exclusivity the
      // consume call actually ran under), never the last restore's.
      if (intent) {
        // W0-06-r8 finding 2: the stamp comes from result.returnRoute — the
        // STORE's record is the one that was actually consumed, and the two
        // routes must agree on this path. When the stored record diverged
        // from the loaded copy between load and consume, the store's route
        // wins, explicitly: the stale copy never sends the person back to a
        // destination that record did not carry. The failure mode is safe:
        // snapshot() still re-checks the destination against the allowlist
        // (a hostile route reports destination: null), and nothing here
        // throws.
        intent = stampConsumed({ ...intent, returnRoute: result.returnRoute }); // W0-06 review r4 (finding 6)
      }
      restoreGuarantee = result.exclusive;
      // W0-06 review r5 (finding 1): the loser of the consume race is held to
      // the SAME checkout gate as its winner — routed by the result through
      // the shared helper, never straight to done.
      enterState(stateAfterConsume(intent?.kind, result.exclusive, 'done'));
      return { outcome: 'already-restored', snapshot: snapshot() };
    } else if (result.outcome === 'expired') {
      intent = null;
      restoreGuarantee = 'none';
      enterState('expired');
      return { outcome: 'not-restoring', snapshot: snapshot() };
    } else {
      // absent or invalid: the account home. Nothing was restored.
      intent = null;
      restoreGuarantee = 'none';
      enterState('no-intent');
      return { outcome: 'not-restoring', snapshot: snapshot() };
    }
  }

  function completeRestore(): CompleteRestoreResult {
    if (state === 'restoring') {
      enterState('done');
      return 'restored';
    }
    if (state === 'done') {
      // W0-06 review r3 (finding 5): a done machine always reports a
      // consumed-stamped intent, and restoreGuarantee stays exactly what the
      // restore that reached done recorded — from the actual existence of a
      // lock. A second call must not rewrite that history.
      if (intent && intent.consumedAt === undefined) {
        intent = stampConsumed(intent); // W0-06 review r4 (finding 6)
      }
      return 'already-done'; // restoring → done happens once
    }
    // 'restored-unverified' deliberately does NOT complete here: the screen
    // must re-confirm through L2's money path first, then call
    // confirmRestore() (W0-06 review r2, finding 3; review r3, finding 2).
    return 'not-restoring';
  }

  /** W0-06 review r3 (finding 2): the one method that finishes a checkout
   * restored on the weaker in-process guarantee — the dead end the review
   * found. The money path calls it AFTER its own re-confirmation through L2.
   * It does not charge, does not call the network and does not consume
   * anything. Accepted only from 'restored-unverified' with the explicit
   * money-path assertion; a missing or false assertion — like every other
   * state — reports 'not-restoring' and changes nothing. */
  function confirmRestore(assertion: MoneyPathAssertion): ConfirmRestoreResult {
    // W0-06 review r4 (finding 4): this machine cannot verify the
    // re-confirmation; the caller asserts it, and the required argument
    // exists so the assertion is visible at every call site. It is not a
    // token and nothing here verifies anything — L2 owns the re-confirmation.
    if (!assertion || assertion.moneyPathConfirmed !== true) return 'not-restoring';
    // W0-06 review r5 (finding 9): the call also carries L2's opaque
    // confirmation id. This machine carries the id, it cannot verify it; L2
    // issues it and L2 verifies it. An empty or absent id is refused exactly
    // like a wrong state.
    if (typeof assertion.confirmationId !== 'string' || assertion.confirmationId.length === 0) {
      return 'not-restoring';
    }
    if (state !== 'restored-unverified') return 'not-restoring';
    moneyPathConfirmationId = assertion.confirmationId;
    enterState('done');
    return snapshot();
  }

  function requestMagicLink(email: string): boolean {
    if (state !== 'provider-pending' || method !== 'email' || !intent) return false;
    // W0-06 review r5 (findings 3 and 4): the link-sent copy is set through
    // the one transition helper as provider-pending's own copy, and the
    // cooldown deadline is cleared — a new link going out is the transition
    // that ends the cooldown, and no stale countdown may outlive it.
    cooldownUntil = null;
    enterState('provider-pending', magicLinkSentCopy(email));
    return true;
  }

  function onMagicLinkEvent(event: MagicLinkEvent): boolean {
    if (method !== 'email' || !intent) return false;
    if (event.type === 'expired' && state === 'link-expired') {
      // Idempotent (W0-06 review r3, edge case): a second expiry event
      // changes nothing and duplicates no copy.
      return true;
    }
    // A late or duplicated event must never drag a finished state (done,
    // denied, conflict, …) back into sent/used/offline.
    if (!MAGIC_LINK_EVENT_SOURCES.includes(state)) return false;
    if (event.type === 'cooldown' && (!Number.isFinite(event.until) || event.until <= 0)) {
      // W0-06 review r4 (finding 9): a NaN or Infinity `until` would propagate
      // NaN seconds to the screen, and a non-positive one could never count
      // down. A malformed `until` is refused and changes nothing.
      return false;
    }
    if (event.type === 'sent') {
      // The `sent` state owns the link-sent copy (W0-06 review r5, finding 4):
      // it is set here, at entry, and never survives into another state.
      enterState('sent', MAGIC_LINK_SENT_TEXT);
    } else if (event.type === 'cooldown') {
      cooldownUntil = event.until;
      enterState('cooldown');
    } else if (event.type === 'expired') {
      // The LINK expired while the intent is still live: `link-expired` keeps
      // the destination and offers a new link (W0-06 review r3, finding 1).
      // Only the intent's own TTL passing is `expired`.
      enterState('link-expired');
    } else if (event.type === 'used') {
      enterState('used');
    } else if (event.type === 'wrong-browser') {
      enterState('wrong-browser');
    } else {
      enterState('offline'); // the intent is kept; success is never claimed
    }
    return true;
  }

  /** W0-06 review r4 (finding 9): a distinct, finite 0 — never NaN, because a
   * malformed `until` is refused at the door. The 0 alone cannot say whether
   * no cooldown is running or one has finished; readyToResend() is the named
   * predicate that does. */
  function remainingCooldownSeconds(): number {
    // W0-06 review r5 (finding 3): derived from cooldownUntil alone — the one
    // deadline, judged regardless of state — so it can never disagree with
    // readyToResend(). A sent event inside the window never reports zero.
    if (cooldownUntil === null) return 0;
    return Math.max(0, Math.ceil((cooldownUntil - now()) / 1000));
  }

  /** W0-06 review r4 (finding 9): the named predicate that exposes what a
   * bare zero cannot — true exactly when a cooldown deadline exists and has
   * passed: the cooldown is over and a new link may be requested. It is false
   * while one still counts down and while no deadline exists (a machine that
   * never cooled down, or one resetTransient() has cleared — which is what
   * makes a stale deadline from a previous walk impossible to misread). The
   * deadline is judged regardless of the current state, so a cooldown the
   * flow has since moved past still reports as run out. */
  function readyToResend(): boolean {
    return cooldownUntil !== null && cooldownUntil <= now();
  }

  return {
    snapshot,
    armIntent,
    beginWithStoredIntent,
    resume: beginWithStoredIntent,
    continueToMethodSelect,
    chooseMethod,
    back,
    providerDenied,
    providerCanceled,
    providerOffline,
    channelConflict,
    sessionApproved,
    restoreDestination,
    completeRestore,
    confirmRestore,
    requestMagicLink,
    onMagicLinkEvent,
    remainingCooldownSeconds,
    readyToResend,
  };
}
