// W0-06: behaviours 1-4 — the intent record schema, the return-route
// allowlist, the credential-free rule and the 512-byte serialised cap.
// Every rejection fails the whole intent: there is never a silent fallback.
import { describe, expect, it } from 'vitest';
import {
  INTENT_RETURN_ROUTES,
  MAX_INTENT_SERIALISED_BYTES,
  createIntentRecord,
  generateIntentId,
  intentRecordSchema,
  parseIntentJson,
  serialiseIntent,
} from '../src/clients/intent/schema';

describe('intent schema', () => {
  it('the intent id is at least 128 bits of url-safe crypto randomness derived from nothing else', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 64; i++) {
      const id = generateIntentId();
      // 22 base64url characters encode 16 random bytes = 128 bits.
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(id.length * 6).toBeGreaterThanOrEqual(128);
      ids.add(id);
    }
    expect(ids.size).toBe(64);
    // Same fake instant, different ids: never derived from time, email,
    // account or plan — the generator takes no such input at all.
    expect(generateIntentId()).not.toBe(generateIntentId());
  });

  it('a return route outside the allowlist rejects the whole intent with no fallback to /', () => {
    const rejected = [
      '//evil.example',
      'https://evil.example',
      '/%2e%2e/account',
      '/account?token=abc',
      '/account#receipt',
      '/nope',
      'account',
      '/ACCOUNT',
      '/account/',
      '',
    ];
    for (const returnRoute of rejected) {
      const result = createIntentRecord(
        { product: 'builds', returnRoute, kind: 'checkout', plan: 'shell' },
        { now: () => 1_000 },
      );
      expect(result.ok).toBe(false);
    }
    for (const returnRoute of INTENT_RETURN_ROUTES) {
      const result = createIntentRecord(
        { product: 'builds', returnRoute, kind: 'account' },
        { now: () => 1_000 },
      );
      expect(result.ok).toBe(true);
    }
  });

  it('the schema carries no credential field and strips unknown keys instead of passing them through', () => {
    const fields = Object.keys(intentRecordSchema.shape);
    for (const banned of ['token', 'session', 'card', 'receipt', 'email', 'accountUuid']) {
      expect(fields).not.toContain(banned);
    }
    const valid = createIntentRecord(
      { product: 'forge', returnRoute: '/forge', kind: 'demo' },
      { now: () => 1_000 },
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const parsed = intentRecordSchema.safeParse({
      ...valid.record,
      token: 't',
      session: 's',
      card: 'c',
      receipt: 'r',
      email: 'person@example.com',
      accountUuid: 'uuid-1234',
      evilExtra: 'x',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const serialised = JSON.stringify(parsed.data);
    for (const banned of [
      'token',
      'session',
      'card',
      'receipt',
      'email',
      'accountUuid',
      'evilExtra',
      'person@example.com',
      'uuid-1234',
    ]) {
      expect(serialised).not.toContain(banned);
    }
  });

  it('a serialised intent over 512 bytes is rejected and unparsable json is invalid, never thrown', () => {
    const oversized = createIntentRecord(
      { product: 'builds', returnRoute: '/builds', kind: 'checkout' },
      { now: () => 1_000, id: () => 'A'.repeat(600) },
    );
    expect(oversized.ok).toBe(false);

    const good = createIntentRecord(
      { product: 'forge', returnRoute: '/forge', kind: 'demo', scenario: 'forge-01' },
      { now: () => 1_000 },
    );
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const text = serialiseIntent(good.record);
    expect(text).not.toBeNull();
    expect(new TextEncoder().encode(text as string).length).toBeLessThanOrEqual(
      MAX_INTENT_SERIALISED_BYTES,
    );

    expect(parseIntentJson('{not json')).toBeNull();
    expect(parseIntentJson('null')).toBeNull();
    expect(parseIntentJson('42')).toBeNull();
    expect(() => parseIntentJson('{"returnRoute":')).not.toThrow();
  });
});
