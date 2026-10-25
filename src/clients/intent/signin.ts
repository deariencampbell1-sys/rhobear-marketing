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
  /** Consume the intent exactly once and move to restoring. */
  restoreDestination(): Promise<SignInSnapshot>;
  /** restoring → done; calling it again never restores twice. */
  completeRestore(): boolean;
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

  async function restoreDestination(): Promise<SignInSnapshot> {
    if (state !== 'returning' || !intent) return snapshot();
    const result: ConsumeResult = await store.consume();
    if (result.outcome === 'consumed') {
      intent = result.intent;
      state = 'restoring';
    } else if (result.outcome === 'already-consumed') {
      // Someone already restored this intent (a second tab, a reload): report
      // the original route once more and never re-run the operation.
      state = 'done';
    } else if (result.outcome === 'expired') {
      intent = null;
      state = 'expired';
    } else {
      // absent or invalid: the account home.
      intent = null;
      state = 'no-intent';
    }
    return snapshot();
  }

  function completeRestore(): boolean {
    if (state === 'restoring') {
      state = 'done';
      return true;
    }
    // restoring → done happens once; a second call stays done.
    return state === 'done';
  }

  function requestMagicLink(email: string): boolean {
    if (state !== 'provider-pending' || method !== 'email' || !intent) return false;
    copy = magicLinkSentCopy(email);
    return true;
  }

  function onMagicLinkEvent(event: MagicLinkEvent): boolean {
    if (method !== 'email' || !intent) return false;
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
