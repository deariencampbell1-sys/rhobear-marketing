// W0-06 review r5 (finding 6): the scenario allowlist as a LITERAL — its own
// home, so the runtime client never pulls the data layer into its bundle. The
// registry this list mirrors is the frozen engines registry in
// src/data/engines.ts (engineScenarios); that registry is the source of truth
// for the ids, and this module must never import it (or anything else from
// src/data): every front-door consumer of the intent client would otherwise
// pull the whole registry into its bundle for a short allowlist and inherit
// its init-time failure modes. The mirror cannot drift silently:
// tests/intent-schema.test.ts asserts both sets are equal, in both
// directions. A rename in the registry must be migrated deliberately — here,
// in the same change — never edited silently into someone's sign-in.

/** The only engine scenario ids an intent may carry. */
export const INTENT_SCENARIOS: readonly string[] = Object.freeze([
  'teams-01',
  'designs-01',
  'forge-01',
  'capturd-01',
  'vision-01',
  'search-01',
  'spaces-01',
]);
