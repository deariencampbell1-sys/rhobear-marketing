// W0-06 behaviours 1–4: the intent record, the return-route allowlist, the
// credential-free rule and the 512-byte cap. Hand-written validation in the
// house style of src/clients/money/schema.ts — no zod anywhere.
import { describe, expect, it } from 'vitest';
import { engineScenarios } from '../src/data/engines';
import {
  CANONICAL_RETURN_ROUTES,
  INTENT_KEYS,
  INTENT_MAX_CHARS,
  createIntentId,
  isCanonicalReturnRoute,
  isKnownScenario,
  parseIntent,
} from '../src/clients/intent/schema';

function goodRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'q83N-vxK2mPp0QeR5sT8uAw',
    product: 'forge',
    scenario: 'forge-01',
    plan: 'shell',
    returnRoute: '/plans',
    kind: 'checkout',
    createdAt: '2026-10-25T12:00:00.000Z',
    expiresAt: '2026-10-25T13:00:00.000Z',
    ...overrides,
  };
}

describe('intent schema', () => {
  it('an intent id is random, URL-safe and never derived from time, email, account or plan', () => {
    const a = createIntentId();
    const b = createIntentId();
    // Two ids in the same millisecond with the same everything else differ:
    // the id is crypto.getRandomValues entropy, not a clock or a context.
    expect(a).not.toBe(b);
    // 22 unpadded base64url characters is 132 bits of entropy (≥ 128), and the
    // charset is URL-safe with no padding, slash or plus.
    expect(a).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    // The generator takes no input at all — there is no time, email, account
    // UUID or plan to derive an id from.
    expect(createIntentId.length).toBe(0);
  });

  it('a return route outside the allowlist rejects the whole intent with no fallback', () => {
    // Every canonical route is accepted, and only those.
    for (const route of CANONICAL_RETURN_ROUTES) {
      expect(isCanonicalReturnRoute(route), route).toBe(true);
      const parsed = parseIntent(goodRecord({ returnRoute: route }));
      expect(parsed.ok, route).toBe(true);
      if (parsed.ok) expect(parsed.intent.returnRoute).toBe(route);
    }
    // Absolute URLs, protocol strings, encoded traversal and query strings
    // carrying tokens are all rejected outright — the whole intent fails, and
    // nothing silently falls back to '/'.
    const rejected = [
      '//evil.example',
      'https://evil.example',
      '/%2e%2e/account',
      '/account?token=secret-token',
      '/account#token=secret-token',
      '/plans/../account',
      '/plans/',
      '/PLANS',
      'made-up-route',
      '',
    ];
    for (const route of rejected) {
      expect(isCanonicalReturnRoute(route), route).toBe(false);
      const parsed = parseIntent(goodRecord({ returnRoute: route }));
      expect(parsed, route).toEqual({ ok: false, problem: 'bad-return-route' });
    }
  });

  it('no field carries a credential and unknown keys are stripped', () => {
    // The declared field set has no token, session, card, receipt, email or
    // account UUID field.
    expect([...INTENT_KEYS].sort()).toEqual([
      'consumedAt',
      'createdAt',
      'expiresAt',
      'id',
      'kind',
      'plan',
      'product',
      'returnRoute',
      'scenario',
    ]);
    // A hostile record carrying credentials parses, but every credential is
    // dropped: the parsed object is rebuilt field by field from an allowlist,
    // never spread from the raw input.
    const parsed = parseIntent(
      goodRecord({
        token: 'tok_secret',
        sessionId: 'sess_1',
        cardNumber: '4111111111111111',
        receiptId: 'receipt_1',
        email: 'person@example.com',
        accountUuid: 'd0a1b2c3-0000-4000-8000-000000000000',
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const text = JSON.stringify(parsed.intent);
      for (const forbidden of ['token', 'session', 'card', 'receipt', 'email', 'accountUuid']) {
        expect(text.includes(forbidden), forbidden).toBe(false);
      }
      for (const key of Object.keys(parsed.intent)) {
        expect((INTENT_KEYS as readonly string[]).includes(key), key).toBe(true);
      }
    }
  });

  it('a serialised intent over 512 bytes is rejected, not stored or passed through', () => {
    expect(INTENT_MAX_CHARS).toBe(512);
    // A worst-case legitimate record (longest plan, a scenario, a consumed
    // stamp) still serialises under the cap.
    const worst = parseIntent(
      goodRecord({
        id: 'A'.repeat(43),
        plan: 'shell-plus',
        scenario: 'designs-01',
        kind: 'checkout',
        consumedAt: '2026-10-25T12:30:00.000Z',
      }),
    );
    expect(worst.ok).toBe(true);
    if (worst.ok) {
      expect(JSON.stringify(worst.intent).length).toBeLessThanOrEqual(INTENT_MAX_CHARS);
    }
    // And a record that would not fit — here an over-long id that is otherwise
    // URL-safe — is refused with an explicit problem instead of being accepted.
    const oversized = parseIntent(goodRecord({ id: 'A'.repeat(600) }));
    expect(oversized).toEqual({ ok: false, problem: 'too-large' });
  });

  it('renaming a scenario id in engines.ts breaks this test, not a stored intent', () => {
    // The scenario allowlist is derived live from the frozen engines registry
    // (one source of truth) — which makes a rename silent at runtime: every
    // stored intent carrying the old id becomes bad-scenario → invalid and
    // the person loses their place. This list is pinned BY NAME so the break
    // lands here, with a named message, before it lands on anyone.
    const pinned = ['capturd-01', 'designs-01', 'forge-01', 'search-01', 'spaces-01', 'teams-01', 'vision-01'];
    const live = engineScenarios.map((s) => s.scenarioId).sort();
    expect(
      live,
      'a scenario id changed in src/data/engines.ts: stored intents carrying the old id would all fail as bad-scenario → invalid and the person loses their place — migrate deliberately, then re-pin this list',
    ).toEqual(pinned);
    // The derived allowlist admits exactly the registry's ids, and nothing else.
    for (const id of pinned) {
      expect(isKnownScenario(id), id).toBe(true);
      expect(parseIntent(goodRecord({ scenario: id })).ok, id).toBe(true);
    }
    expect(isKnownScenario('gone-01')).toBe(false);
  });

  it('the cap is measured in UTF-16 code units and a record that expires before it was created is refused', () => {
    // The unit is the UTF-16 code unit (JSON.stringify().length); the
    // constant's name says which unit is enforced.
    expect(INTENT_MAX_CHARS).toBe(512);
    const baseRecord = goodRecord();
    const baseLength = JSON.stringify(baseRecord).length;
    const baseIdLength = (baseRecord.id as string).length;
    const fitsExactly = baseIdLength + (INTENT_MAX_CHARS - baseLength);
    expect(parseIntent(goodRecord({ id: 'A'.repeat(fitsExactly) })).ok).toBe(true);
    expect(parseIntent(goodRecord({ id: 'A'.repeat(fitsExactly + 1) }))).toEqual({ ok: false, problem: 'too-large' });

    // expiresAt must be strictly after createdAt: a record expired before it
    // existed is refused, not silently accepted.
    expect(
      parseIntent(goodRecord({ createdAt: '2026-10-25T13:00:00.000Z', expiresAt: '2026-10-25T13:00:00.000Z' })),
    ).toEqual({ ok: false, problem: 'bad-expires-at' });
    expect(
      parseIntent(goodRecord({ createdAt: '2026-10-25T13:00:00.000Z', expiresAt: '2026-10-25T12:00:00.000Z' })),
    ).toEqual({ ok: false, problem: 'bad-expires-at' });
    expect(parseIntent(goodRecord()).ok).toBe(true);
  });
});
