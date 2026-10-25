// W0-06: the sign-in state machine. Pure state: no screen, no styling, no
// OAuth. Provider methods come from configuration and nothing else — a
// method that is not configured is hidden, never shown disabled with a
// promise. Today no provider is configured in this repo, so every method is
// unavailable and the copy says sign-in opens when the account service is
// connected. The machine consumes the intent through the injected store's
// consume() exactly once, and magic-link copy depends only on the phase —
// a new email and an existing email read identically, so there is no
// account enumeration and never a "we couldn't find that email".
import type { IntentRecord } from './schema';
import type { IntentConsumeResult } from './store';

/** Provider methods, resolved by L2. The front door only names them. */
export type SignInMethod = 'google' | 'apple' | 'email';
export const ALL_SIGN_IN_METHODS: readonly SignInMethod[] = ['google', 'apple', 'email'];

export type MethodAvailability = {
  /** Configured methods — the only ones a screen may render. */
  visible: readonly SignInMethod[];
  /** Not configured — hidden outright, never rendered as a disabled button. */
  hidden: readonly SignInMethod[];
  allUnavailable: boolean;
};

export function methodAvailability(configured: readonly SignInMethod[]): MethodAvailability {
  const visible = ALL_SIGN_IN_METHODS.filter((method) => configured.includes(method));
  const hidden = ALL_SIGN_IN_METHODS.filter((method) => !configured.includes(method));
  return { visible, hidden, allUnavailable: visible.length === 0 };
}

/** Behaviour 11: the truthful copy when no method is configured. */
export const SIGNIN_NOT_CONFIGURED_COPY =
  'Sign-in opens when the RHOBEAR account service is connected. Nothing is locked away meanwhile.';

export type MagicLinkPhase = 'sent' | 'cooldown' | 'expired' | 'used' | 'wrong-browser' | 'offline';

// One copy per phase, identical for a new and an existing email.
const MAGIC_LINK_COPY: Record<MagicLinkPhase, string> = {
  sent: 'Check your email for the link. It works from the browser that asked for it, and it expires.',
  cooldown: 'A link is already on its way — wait a moment before asking for another.',
  expired: 'That link has expired. Ask for a new one — it only takes a moment.',
  used: 'That link was already used. Ask for a new one to continue.',
  'wrong-browser': 'That link was opened in a different browser. Ask for a new one and open it here.',
  offline: 'You look offline. The link cannot be checked until you are back online.',
};

export function magicLinkCopy(phase: MagicLinkPhase): string {
  return MAGIC_LINK_COPY[phase];
}

/** Behaviour 13: conflict stops the flow, keeps every purchase record, and
 * offers a verified link, Manage and support. It never grants and never
 * links by email string. */
export type ConflictOption =
  | { kind: 'verified-link' }
  | { kind: 'manage'; route: '/account' }
  | { kind: 'support'; route: '/support' };

export const CONFLICT_OPTIONS: readonly ConflictOption[] = [
  { kind: 'verified-link' },
  { kind: 'manage', route: '/account' },
  { kind: 'support', route: '/support' },
];

/** The locked account home for a visit with no active intent. */
export const ACCOUNT_HOME = '/account';

export type SignInStateName =
  | 'idle'
  | 'intent-loaded'
  | 'method-select'
  | 'provider-pending'
  | 'returning'
  | 'restoring'
  | 'done'
  | 'no-intent'
  | 'denied'
  | 'canceled'
  | 'expired'
  | 'cooldown'
  | 'wrong-browser'
  | 'offline'
  | 'conflict';

export type SignInState = {
  name: SignInStateName;
  intent: IntentRecord | null;
  method: SignInMethod | null;
  magicLinkPhase: MagicLinkPhase | null;
  cooldownRemainingSeconds: number | null;
  conflictOptions: readonly ConflictOption[] | null;
};

export type SignInEvent =
  | { type: 'intent-loaded'; intent: IntentRecord }
  | { type: 'no-intent' }
  | { type: 'methods-shown' }
  | { type: 'method-chosen'; method: SignInMethod }
  | { type: 'link-sent'; email: string }
  | { type: 'link-cooldown'; remainingSeconds: number }
  | { type: 'link-expired' }
  | { type: 'link-used' }
  | { type: 'wrong-browser' }
  | { type: 'offline' }
  | { type: 'denied' }
  | { type: 'canceled' }
  | { type: 'conflict' }
  | { type: 'provider-returned' }
  | { type: 'ack' }
  | { type: 'back' };

const IDLE: SignInState = {
  name: 'idle',
  intent: null,
  method: null,
  magicLinkPhase: null,
  cooldownRemainingSeconds: null,
  conflictOptions: null,
};

const RESUMABLE_BRANCHES: readonly SignInStateName[] = [
  'denied',
  'canceled',
  'expired',
  'cooldown',
  'wrong-browser',
  'offline',
];

export function createSignInMachine(
  config: { consumeIntent?: () => Promise<IntentConsumeResult> } = {},
) {
  const consumeIntent = config.consumeIntent;
  let current: SignInState = IDLE;

  function send(event: SignInEvent): SignInState {
    const s = current;
    switch (event.type) {
      case 'intent-loaded':
        if (s.name === 'idle' || s.name === 'no-intent') {
          current = { ...IDLE, name: 'intent-loaded', intent: event.intent };
        }
        break;
      case 'no-intent':
        if (s.name === 'idle' || s.name === 'returning' || s.name === 'restoring') {
          current = { ...IDLE, name: 'no-intent' };
        }
        break;
      case 'methods-shown':
        if (s.name === 'intent-loaded') current = { ...s, name: 'method-select' };
        break;
      case 'method-chosen':
        if (s.name === 'method-select') {
          current = {
            ...s,
            name: 'provider-pending',
            method: event.method,
            magicLinkPhase: null,
            cooldownRemainingSeconds: null,
          };
        }
        break;
      case 'link-sent':
        // The email is deliberately not stored: the state never learns
        // whether the account exists, so the copy cannot enumerate.
        if (s.name === 'method-select' || s.name === 'provider-pending' || s.name === 'cooldown') {
          current = { ...s, name: 'provider-pending', magicLinkPhase: 'sent', cooldownRemainingSeconds: null };
        }
        break;
      case 'link-cooldown':
        if (s.name === 'provider-pending' || s.name === 'cooldown') {
          current = { ...s, name: 'cooldown', magicLinkPhase: 'cooldown', cooldownRemainingSeconds: event.remainingSeconds };
        }
        break;
      case 'link-expired':
        if (s.name === 'provider-pending' || s.name === 'cooldown') {
          current = { ...s, name: 'expired', magicLinkPhase: 'expired', cooldownRemainingSeconds: null };
        }
        break;
      case 'link-used':
        if (s.name === 'provider-pending') current = { ...s, magicLinkPhase: 'used' };
        break;
      case 'wrong-browser':
        if (s.name === 'provider-pending') {
          current = { ...s, name: 'wrong-browser', magicLinkPhase: 'wrong-browser' };
        }
        break;
      case 'offline':
        if (s.name === 'provider-pending' || s.name === 'cooldown') {
          current = { ...s, name: 'offline', magicLinkPhase: 'offline' };
        }
        break;
      case 'denied':
        if (s.name === 'provider-pending') current = { ...s, name: 'denied' };
        break;
      case 'canceled':
        if (s.name === 'provider-pending') current = { ...s, name: 'canceled' };
        break;
      case 'conflict':
        if (s.name === 'method-select' || s.name === 'provider-pending') {
          current = { ...s, name: 'conflict', conflictOptions: CONFLICT_OPTIONS };
        }
        break;
      case 'provider-returned':
        if (s.name === 'provider-pending') current = { ...s, name: 'returning' };
        break;
      case 'ack':
        if (RESUMABLE_BRANCHES.includes(s.name)) {
          // denied/canceled/expired/offline/cooldown/wrong-browser all return
          // to method-select with the intent intact.
          current = { ...s, name: 'method-select', magicLinkPhase: null, cooldownRemainingSeconds: null };
        }
        // conflict is terminal — the flow is stopped; ack never resumes it.
        break;
      case 'back':
        if (s.name === 'provider-pending' || RESUMABLE_BRANCHES.includes(s.name)) {
          current = { ...s, name: 'method-select', method: null, magicLinkPhase: null, cooldownRemainingSeconds: null };
        }
        break;
    }
    return current;
  }

  // Behaviour 14: restoring → done happens once, only from `returning`.
  // After done the machine reports the original returnRoute; with no active
  // intent it lands on no-intent (the account home), never a redirect loop.
  async function restore(): Promise<SignInState> {
    if (!consumeIntent || current.name !== 'returning') return current;
    current = { ...current, name: 'restoring' };
    const result = await consumeIntent();
    if (result.outcome === 'consumed' || result.outcome === 'already-consumed') {
      current = { ...current, name: 'done', intent: result.record ?? current.intent };
    } else if (result.outcome === 'expired') {
      // Expired: the destination is not restored.
      current = { ...current, name: 'expired', magicLinkPhase: null };
    } else {
      // absent or invalid: the account home, not a loop back into the route.
      current = { ...current, name: 'no-intent', intent: null };
    }
    return current;
  }

  function destination(): string | null {
    if (current.name === 'done') return current.intent?.returnRoute ?? ACCOUNT_HOME;
    if (current.name === 'no-intent') return ACCOUNT_HOME;
    return null;
  }

  return {
    get state(): SignInState {
      return current;
    },
    send,
    restore,
    destination,
  };
}
