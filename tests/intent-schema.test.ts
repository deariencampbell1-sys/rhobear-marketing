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
  isRfc3339,
  parseIntent,
  type IntentProblem,
} from '../src/clients/intent/schema';
import { INTENT_SCENARIOS } from '../src/clients/intent/scenarios';
import { INTENT_STORAGE_KEY, createIntentStore } from '../src/clients/intent/store';

/** The raw intent-client sources, read exactly as the bundler sees them: the
 * source-level boundary assertions need the text, not the module. */
const intentClientSources = import.meta.glob('../src/clients/intent/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

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

  it('a serialised intent over 512 UTF-16 code units is rejected, not stored or passed through', () => {
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
    // The scenario allowlist is a literal list (its own home,
    // src/clients/intent/scenarios.ts — W0-06 review r5, finding 6) kept
    // equal to the frozen engines registry by test — which makes a rename
    // silent at runtime unless it is migrated deliberately: every stored
    // intent carrying the old id becomes bad-scenario → invalid and the
    // person loses their place. This list is pinned BY NAME so the break
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

  it('every parseIntent guard is pinned: a valid envelope with one corrupted field is invalid, one case per problem code', async () => {
    // parseIntent is the only gate between devtools (or any same-origin
    // script) and a stored record, so every rejection branch must have a
    // failing case: a regression in any single guard turns something red
    // with a named code (W0-06 review r2, finding 1).
    const cases: readonly { problem: IntentProblem; corrupt?: Record<string, unknown>; raw?: unknown }[] = [
      // The seven branches no earlier test exercised.
      { problem: 'bad-id', corrupt: { id: 'too-short' } },
      { problem: 'bad-product', corrupt: { product: 'not-a-product' } },
      { problem: 'bad-plan', corrupt: { plan: 'not-a-plan' } },
      { problem: 'bad-kind', corrupt: { kind: 'not-a-kind' } },
      { problem: 'bad-scenario', corrupt: { scenario: 'not-a-scenario' } },
      { problem: 'bad-created-at', corrupt: { createdAt: 'not-a-date' } },
      { problem: 'bad-consumed-at', corrupt: { consumedAt: 'not-a-date' } },
      // W0-06 review r3 (finding 4): consumedAt is range-checked — a stamp
      // before createdAt or after expiresAt is bad-consumed-at, or a future
      // stamp pins a consumed record in the consumed state forever.
      { problem: 'bad-consumed-at', corrupt: { consumedAt: '2026-10-25T11:59:59.999Z' } }, // before createdAt
      { problem: 'bad-consumed-at', corrupt: { consumedAt: '2026-10-25T13:00:00.001Z' } }, // after expiresAt
      // The four branches the earlier tests already exercised, in the same table.
      { problem: 'bad-return-route', corrupt: { returnRoute: '/not-canonical' } },
      { problem: 'bad-expires-at', corrupt: { expiresAt: '2026-10-25T11:00:00.000Z' } }, // before createdAt
      { problem: 'too-large', corrupt: { id: 'A'.repeat(600) } }, // still URL-safe, so too-large fires, not bad-id
      { problem: 'not-an-object', raw: 'just a string' },
    ];
    // One case per problem code, all eleven, none missing — bad-consumed-at
    // is pinned three ways (shape, before createdAt, after expiresAt).
    const allProblems: IntentProblem[] = [
      'not-an-object',
      'bad-id',
      'bad-product',
      'bad-plan',
      'bad-scenario',
      'bad-return-route',
      'bad-kind',
      'bad-created-at',
      'bad-expires-at',
      'bad-consumed-at',
      'too-large',
    ];
    expect([...new Set(cases.map((c) => c.problem))].sort()).toEqual([...allProblems].sort());
    for (const { problem, corrupt, raw } of cases) {
      const candidate = raw !== undefined ? raw : { ...goodRecord(), ...corrupt };
      expect(parseIntent(candidate), problem).toEqual({ ok: false, problem });
      // The same corruption through the store: a seeded valid envelope with
      // one field rewritten by "devtools" must load as invalid, never active.
      const envelope = JSON.stringify({ v: 1, i: candidate });
      const store = createIntentStore({
        storage: {
          getItem: (key) => (key === INTENT_STORAGE_KEY ? envelope : null),
          setItem: () => undefined,
          removeItem: () => undefined,
        },
        now: () => Date.parse('2026-10-25T12:00:00Z'),
      });
      expect(await store.load(), `${problem} loads as invalid through the store`).toEqual({ state: 'invalid' });
    }
  });

  it('a consumed record with a future consumedAt is dropped by retention, not kept forever', async () => {
    // W0-06 review r3 (finding 4): a consumedAt in the future made
    // now() - Date.parse(consumedAt) negative, so retention never fired and a
    // consumed record was retained indefinitely. The range check refuses a
    // stamp outside [createdAt, expiresAt] at parse (the guard-table cases
    // above); where a stamp does parse, the retention window is bounded and
    // reachable on an injected clock.
    const makeStore = (consumedAt: string, now: () => number) => {
      const backing = new Map<string, string>([
        [INTENT_STORAGE_KEY, JSON.stringify({ v: 1, i: goodRecord({ consumedAt }) })],
      ]);
      const store = createIntentStore({
        storage: {
          getItem: (key) => backing.get(key) ?? null,
          setItem: (key, value) => {
            backing.set(key, value);
          },
          removeItem: (key) => {
            backing.delete(key);
          },
        },
        now,
      });
      return { backing, store };
    };
    let t = Date.parse('2026-10-25T12:00:00.000Z');
    const clock = (): number => t;

    // The unbounded case: a stamp after expiresAt can never sit in the
    // consumed state at all — it is refused at parse, so nothing keeps it.
    const beyond = makeStore('2026-10-25T13:30:00.000Z', clock);
    expect((await beyond.store.load()).state, 'a future consumedAt must not keep the record as consumed').not.toBe(
      'consumed',
    );
    // The bounded case: a stamp in the clock's future but inside
    // [createdAt, expiresAt] reaches retention on the injected clock —
    // dropped at five minutes past its stamp, not kept forever.
    const skew = makeStore('2026-10-25T12:59:00.000Z', clock);
    expect((await skew.store.load()).state).toBe('consumed');
    t = Date.parse('2026-10-25T13:04:00.000Z'); // consumedAt + CONSUMED_RETENTION_MS
    expect(await skew.store.load()).toEqual({ state: 'absent' });
    expect(skew.backing.has(INTENT_STORAGE_KEY), 'dropped by retention').toBe(false);
  });

  it('the scenario allowlist is a literal list that the registry still matches', () => {
    // W0-06 review r5 (finding 6): the runtime client must not import the
    // engines registry at module load — every front-door consumer of the
    // intent client pulled src/data/engines.ts into its bundle for a short
    // allowlist and inherited its init-time failure modes. The list is a
    // literal in src/clients/intent/scenarios.ts and the drift guard lives
    // HERE, where the registry may be imported. Both directions are named: a
    // rename in the registry must be migrated deliberately — in scenarios.ts,
    // in the same change — never edited silently into someone's sign-in.
    const registryIds = engineScenarios.map((s) => s.scenarioId);
    for (const id of INTENT_SCENARIOS) {
      expect(
        registryIds,
        `scenarios.ts names ${id} but the registry does not — a rename in the registry must be migrated deliberately`,
      ).toContain(id);
    }
    for (const id of registryIds) {
      expect(
        INTENT_SCENARIOS,
        `the registry names ${id} but scenarios.ts does not — a rename in the registry must be migrated deliberately`,
      ).toContain(id);
    }
    expect(new Set(INTENT_SCENARIOS).size, 'no duplicate id').toBe(INTENT_SCENARIOS.length);

    // The boundary is source-level: the runtime client keeps its own literal
    // and never imports the data module — neither the schema nor the list.
    const registryImport = /(?:from\s+|import\s*\(\s*|import\s+)['"][^'"]*data\/engines['"]/;
    expect(
      intentClientSources['../src/clients/intent/schema.ts'],
      'schema.ts must not import the data module at all',
    ).not.toMatch(registryImport);
    expect(
      intentClientSources['../src/clients/intent/scenarios.ts'],
      'scenarios.ts is a literal list — it names the registry as its source but never imports it',
    ).not.toMatch(registryImport);
  });

  it('isRfc3339 accepts a well-formed instant in a low year and still refuses an impossible date', () => {
    // W0-06 review r5 (finding 7): Date.UTC(year, …) maps a year below 100 to
    // 1900 + year, so a well-formed early instant was refused. The calendar
    // probe is built with new Date(0) and setUTCFullYear, which takes the
    // year literally.
    expect(isRfc3339('0042-03-15T10:30:00Z')).toBe(true);
    expect(isRfc3339('0000-01-01T00:00:00Z')).toBe(true);
    expect(isRfc3339('0099-12-31T23:59:59+00:00')).toBe(true);
    // Impossible dates are refused in low years too.
    expect(isRfc3339('0042-02-30T00:00:00Z'), '30 February does not exist in year 42 either').toBe(false);
    expect(isRfc3339('0042-13-01T00:00:00Z')).toBe(false);
  });

  it("the parsed record's keys are exactly INTENT_KEYS", () => {
    // W0-06 review r5 (finding 8): parseIntent rebuilt the record field by
    // field and never read INTENT_KEYS — the constant was documentation and
    // the two could drift with no compile error. The rebuild is now DRIVEN by
    // the constant (each key mapped from the validated values): the accepted
    // record's keys are exactly INTENT_KEYS, and a key outside it is refused
    // entry — it never reaches the record.
    const full = parseIntent(goodRecord({ consumedAt: '2026-10-25T12:30:00.000Z' }));
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(Object.keys(full.intent), 'the accepted record key set is the constant').toEqual([
        ...INTENT_KEYS,
      ]);
      expect(full.intent.consumedAt).toBe('2026-10-25T12:30:00.000Z');
    }
    // A record with no optional fields carries exactly the declared keys too.
    const minimal = parseIntent({
      id: 'q83N-vxK2mPp0QeR5sT8uAw',
      product: 'builds',
      returnRoute: '/builds',
      kind: 'install',
      createdAt: '2026-10-25T12:00:00.000Z',
      expiresAt: '2026-10-26T12:00:00.000Z',
    });
    expect(minimal.ok).toBe(true);
    if (minimal.ok) {
      expect(Object.keys(minimal.intent), 'no key outside the constant, and none missing').toEqual([
        ...INTENT_KEYS,
      ]);
    }
    // A record with an extra key: the extra key is refused entry — the parsed
    // record's keys are exactly the constant, never one more.
    const extra = parseIntent(goodRecord({ token: 'tok_secret', plan: 'shell' }));
    expect(extra.ok).toBe(true);
    if (extra.ok) {
      expect(Object.keys(extra.intent), 'the extra key is refused entry').toEqual([...INTENT_KEYS]);
    }
  });
});
