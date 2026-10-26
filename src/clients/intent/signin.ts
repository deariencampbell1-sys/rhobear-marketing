// W0-06: the sign-in state machine and method availability. No OAuth client,
// no provider secret, no network call, no screen — providers resolve through
// L2, and this module only models what the front door may honestly promise.
// Nothing is configured in this repo today, so every method reports
// unavailable and is hidden, and the copy says sign-in opens when the account
// service is connected. A disabled-but-promising provider button is drift.

import type { Intent } from './schema';
import type {
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
 * behaviour 12 adds (`sent`, `used`). The machine never invents a step the
 * board does not have.
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

/**
 * The only states a magic-link event may arrive from: while the machine is
 * still waiting on the provider, or inside the magic-link states themselves.
 * A late or duplicated provider event arriving at a finished state (done,
 * denied, conflict, expired, used, wrong-browser, offline, …) must not drag
 * the flow backwards — onMagicLinkEvent refuses it and reports false
 * (W0-06 review r1).
 */
const MAGIC_LINK_EVENT_SOURCES: readonly string[] = Object.freeze(['provider-pending', 'sent', 'cooldown']);

/** Provider-reported magic-link events; the machine owns no provider. */
export type MagicLinkEvent =
  | { type: 'sent' }
  | { type: 'cooldown'; until: number } // epoch ms, judged on the injected clock
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
  /** Where to send the person now; `/account` for no-intent, null when expired. */
  destination: string | null;
  intent: Intent | null;
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
  let cooldownUntil = 0;
  // W0-06 review r2 (finding 3): the exclusivity of the last restore, so the
  // screen can tell a cross-tab guarantee from a same-tab one.
  let restoreGuarantee: RestoreGuarantee = 'none';

  function snapshot(): SignInSnapshot {
    let destination: string | null;
    if (state === 'no-intent') {
      destination = ACCOUNT_HOME_ROUTE;
    } else if (state === 'expired') {
      // An expired intent is never restored: no destination at all.
      destination = null;
    } else {
      destination = intent ? intent.returnRoute : null;
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
    };
  }

  function requireIntent(): boolean {
    if (!intent) {
      state = 'no-intent';
      return false;
    }
    return true;
  }

  async function armIntent(input: CreateIntentInput): Promise<CreateResult> {
    const result = await store.create(input);
    if (result.ok) {
      intent = result.intent;
      state = 'intent-loaded';
      claimedSuccess = false;
      recovery = null;
      purchasesPreserved = null;
      copy = null;
      restoreGuarantee = 'none'; // nothing has been restored for a fresh intent
    } else {
      // The whole intent was rejected (bad route, bad product, …): there is
      // no fallback destination and nothing to restore later.
      state = 'idle';
      intent = null;
      copy = `That destination could not be saved (${result.problem}).`;
    }
    return result;
  }

  async function beginWithStoredIntent(): Promise<SignInSnapshot> {
    const loaded: LoadResult = await store.load();
    if (loaded.state === 'active') {
      intent = loaded.intent;
      state = 'intent-loaded';
      claimedSuccess = false;
      recovery = null;
      purchasesPreserved = null;
      restoreGuarantee = 'none';
    } else if (loaded.state === 'consumed') {
      // Restore-once: the route is reported again but nothing re-runs — a
      // consumed intent can never restart a checkout or a job.
      intent = loaded.intent;
      state = 'done';
    } else if (loaded.state === 'expired') {
      intent = null;
      state = 'expired';
      claimedSuccess = false;
    } else {
      // absent or invalid: the account home, never a redirect loop.
      intent = null;
      state = 'no-intent';
      claimedSuccess = false;
    }
    return snapshot();
  }

  function continueToMethodSelect(): boolean {
    if (!requireIntent()) return false;
    if (
      state === 'intent-loaded' ||
      state === 'denied' ||
      state === 'canceled' ||
      state === 'offline' ||
      state === 'provider-pending'
    ) {
      state = 'method-select';
      copy = null;
      return true;
    }
    return false;
  }

  function chooseMethod(id: SignInProviderId): boolean {
    if (state !== 'method-select' || !intent) return false;
    if (!isMethodAvailable(providers, id)) {
      // Behaviour 11: an unconfigured method cannot be chosen and is never
      // shown disabled with a promise.
      copy = UNCONFIGURED_SIGNIN_COPY;
      return false;
    }
    method = id;
    state = 'provider-pending';
    copy = null;
    return true;
  }

  function back(): boolean {
    if (state !== 'provider-pending' || !intent) return false;
    state = 'method-select'; // the intent is untouched
    return true;
  }

  function fromPending(to: SignInState, mutate?: () => void): boolean {
    if (state !== 'provider-pending' || !intent) return false;
    mutate?.();
    state = to;
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
    const result: ConsumeResult = await store.consume();
    if (result.outcome === 'consumed') {
      intent = result.intent;
      restoreGuarantee = result.exclusive;
      if (intent.kind === 'checkout' && result.exclusive === 'in-process') {
        // W0-06 review r2 (finding 3): the consume ran without an exclusive
        // cross-tab Web Lock, so single-use is only this tab's promise. A
        // checkout must not present itself as plainly restored: the screen
        // has to re-confirm through L2's money path before anything is
        // charged.
        state = 'restored-unverified';
      } else {
        // A checkout under web-locks, or any non-checkout kind on the weaker
        // guarantee: install, demo and account restores may complete on
        // 'in-process' because the worst case there is a repeated
        // navigation, not a repeated charge (W0-06 review r2, finding 3).
        state = 'restoring';
      }
      return { outcome: 'restored', snapshot: snapshot() };
    } else if (result.outcome === 'already-consumed') {
      // Someone already restored this intent (a second tab, a reload): report
      // the original route once more and never re-run the operation.
      state = 'done';
      return { outcome: 'already-restored', snapshot: snapshot() };
    } else if (result.outcome === 'expired') {
      intent = null;
      restoreGuarantee = 'none';
      state = 'expired';
      return { outcome: 'not-restoring', snapshot: snapshot() };
    } else {
      // absent or invalid: the account home. Nothing was restored.
      intent = null;
      restoreGuarantee = 'none';
      state = 'no-intent';
      return { outcome: 'not-restoring', snapshot: snapshot() };
    }
  }

  function completeRestore(): CompleteRestoreResult {
    if (state === 'restoring') {
      state = 'done';
      return 'restored';
    }
    if (state === 'done') return 'already-done'; // restoring → done happens once
    // 'restored-unverified' deliberately does NOT complete here: the screen
    // must re-confirm through L2's money path first (W0-06 review r2, finding 3).
    return 'not-restoring';
  }

  function requestMagicLink(email: string): boolean {
    if (state !== 'provider-pending' || method !== 'email' || !intent) return false;
    copy = magicLinkSentCopy(email);
    return true;
  }

  function onMagicLinkEvent(event: MagicLinkEvent): boolean {
    if (method !== 'email' || !intent) return false;
    // A late or duplicated event must never drag a finished state (done,
    // denied, conflict, …) back into sent/used/offline.
    if (!MAGIC_LINK_EVENT_SOURCES.includes(state)) return false;
    if (event.type === 'sent') {
      state = 'sent';
    } else if (event.type === 'cooldown') {
      state = 'cooldown';
      cooldownUntil = event.until;
    } else if (event.type === 'expired') {
      state = 'expired';
    } else if (event.type === 'used') {
      state = 'used';
    } else if (event.type === 'wrong-browser') {
      state = 'wrong-browser';
    } else {
      state = 'offline'; // the intent is kept; success is never claimed
    }
    return true;
  }

  function remainingCooldownSeconds(): number {
    if (state !== 'cooldown') return 0;
    return Math.max(0, Math.ceil((cooldownUntil - now()) / 1000));
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
    requestMagicLink,
    onMagicLinkEvent,
    remainingCooldownSeconds,
  };
}
