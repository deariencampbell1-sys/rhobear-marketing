// W0-02b: the Engines destination and its scenario registry. Engines are one
// destination: mini apps inside Builds plus @ MCPs for other harnesses, each
// proved by a real-speed public recording. There are exactly seven. No engine
// or scenario is described here: a scenario cannot be described in public
// until its approved demo exists.
//
// W1-08-r1 (F8): this module also owns the one derivation from a scenario row
// to a DemoPresentation, so no route fabricates a proof state or reason.
// W1-08-r1 (F11): it owns the pinned label inventory the Engines surface
// renders from, so the anti-invention oracle reads the same strings as the
// page instead of a hand-typed copy.
import type { DemoPresentation } from '../clients/demo';

export type EngineRow = {
  id: string; // public id, lowercase
  publicName: string;
  runsIn: readonly ('builds-mini-app' | 'mcp')[]; // both, unless noted
  mcpHandle: string; // '@' + id
  descriptionState: 'pending-approved-demo';
  scenarioIds: readonly string[]; // at least one per engine
  source: { doc: string; section: string };
};

export const enginesDestination = {
  id: 'engines',
  publicName: 'Engines',
  oneLiner: 'See the engine do real work.',
  whatItIs:
    'Engines are mini apps inside Builds plus @ MCPs for other harnesses. Every one will be shown here by a real-speed recording of the product doing the work — never a mock, never a stock clip.',
  evidenceState: 'awaiting-approved-demos',
  source: { doc: 'lanes/L9-front-door/INTENT.md', section: '3. What each product really is — and what the front door may say' },
} as const;

Object.freeze(enginesDestination.source);
Object.freeze(enginesDestination);

const enginesSource = {
  doc: 'lanes/L9-front-door/INTENT.md',
  section: '3. What each product really is — and what the front door may say',
} as const;
Object.freeze(enginesSource);

const enginesUnfrozen = [
  {
    id: 'teams',
    publicName: 'Teams',
    runsIn: ['builds-mini-app', 'mcp'],
    mcpHandle: '@teams',
    descriptionState: 'pending-approved-demo',
    scenarioIds: ['teams-01'],
    source: enginesSource,
  },
  {
    id: 'designs',
    publicName: 'Designs',
    runsIn: ['builds-mini-app', 'mcp'],
    mcpHandle: '@designs',
    descriptionState: 'pending-approved-demo',
    scenarioIds: ['designs-01'],
    source: enginesSource,
  },
  {
    id: 'forge',
    publicName: 'Forge renders',
    runsIn: ['builds-mini-app', 'mcp'],
    mcpHandle: '@forge',
    descriptionState: 'pending-approved-demo',
    scenarioIds: ['forge-01'],
    source: enginesSource,
  },
  {
    id: 'capturd',
    publicName: "Captur'd",
    runsIn: ['builds-mini-app', 'mcp'],
    mcpHandle: '@capturd',
    descriptionState: 'pending-approved-demo',
    scenarioIds: ['capturd-01'],
    source: enginesSource,
  },
  {
    id: 'vision',
    publicName: 'Vision',
    runsIn: ['builds-mini-app', 'mcp'],
    mcpHandle: '@vision',
    descriptionState: 'pending-approved-demo',
    scenarioIds: ['vision-01'],
    source: enginesSource,
  },
  {
    id: 'search',
    publicName: 'Search',
    runsIn: ['builds-mini-app', 'mcp'],
    mcpHandle: '@search',
    descriptionState: 'pending-approved-demo',
    scenarioIds: ['search-01'],
    source: enginesSource,
  },
  {
    id: 'spaces',
    publicName: 'Spaces',
    runsIn: ['builds-mini-app', 'mcp'],
    mcpHandle: '@spaces',
    descriptionState: 'pending-approved-demo',
    scenarioIds: ['spaces-01'],
    source: enginesSource,
  },
] as const satisfies readonly EngineRow[];

for (const engine of enginesUnfrozen) {
  Object.freeze(engine.scenarioIds);
  Object.freeze(engine.runsIn);
  Object.freeze(engine);
}

export const engines = Object.freeze(enginesUnfrozen);

export type EngineId = (typeof engines)[number]['id'];

// Null prototype: an unknown id must never resolve through Object.prototype.
const enginesByIdUnfrozen = Object.create(null) as Record<EngineId, EngineRow>;
for (const engine of engines) {
  enginesByIdUnfrozen[engine.id] = engine;
}

export const enginesById: Readonly<Record<EngineId, EngineRow>> =
  Object.freeze(enginesByIdUnfrozen);

/**
 * F8 (W1-08-r1): the registry's publication-state union, in one place. The
 * runtime inventory and the type are the same list, so the sentinel suite
 * iterates exactly the states the derivation below must cover. W3 owns
 * widening it; until then the registry carries the locked pending proof only.
 */
export const SCENARIO_PUBLICATION_STATES = Object.freeze(['footage-pending'] as const);

export type ScenarioPublicationState = (typeof SCENARIO_PUBLICATION_STATES)[number];

/**
 * F8 (W1-08-r1): the locked pending proof — the one answer for a scenario
 * whose registry row is not an approved recording. Shared, so the index and
 * the scenario derivation cannot disagree.
 */
export const pendingProofPresentation: DemoPresentation = Object.freeze({
  state: 'footage-pending',
  reason: 'footage-pending',
});

/** F8: the fail-closed proof for a scenario id the registry does not name. */
export const unknownScenarioPresentation: DemoPresentation = Object.freeze({
  state: 'invalid',
  reason: 'unknown-scenario',
});

/** F8: the fail-closed proof for a registry row this build cannot render. */
export const unsupportedStatePresentation: DemoPresentation = Object.freeze({
  state: 'invalid',
  reason: 'bad-publication-state',
});

/**
 * F8 (W1-08-r1): the one derivation from a registry scenario row to the
 * presentation the route may render. The switch is exhaustive over the real
 * publication union — `satisfies never` makes a widened union a compile error
 * until the new state has its own case — and the default fails closed for a
 * value cast past the type system, so nothing renders as pending that the row
 * did not say was pending.
 */
export function scenarioPresentation(scenario: {
  scenarioId: string;
  publicationState: ScenarioPublicationState;
}): DemoPresentation {
  switch (scenario.publicationState) {
    case 'footage-pending':
      return pendingProofPresentation;
    default:
      scenario.publicationState satisfies never;
      return unsupportedStatePresentation;
  }
}

/**
 * F11 (W1-08-r1): the run-location labels, keyed by the `runsIn` tokens the
 * registry carries. The Engines index renders this object and the
 * anti-invention oracle reads the same object, so the two cannot drift.
 */
export const runLabels: Readonly<Record<EngineRow['runsIn'][number], string>> = Object.freeze({
  'builds-mini-app': 'Builds mini app',
  mcp: '@ MCP',
});

/**
 * F11 (W1-08-r1): the engines surface's pinned label inventory — the one copy
 * of every label and sentence the W1-02-r1 brief mandates verbatim for the
 * Engines, proof-state and scenario shells. src/routes/engines.tsx renders
 * from this object and the anti-invention oracle reads the same object, so a
 * label cannot be added to the page without failing the oracle, and the oracle
 * cannot drift from the page at green time. Data facts (engine names, MCP
 * handles, the destination body) stay in the registry above and are added to
 * the oracle separately.
 */
export const engineLabels = Object.freeze({
  // Proof states, verbatim from the brief's ProofBlock precedence table.
  pendingTitle: 'Recording in review',
  pendingBody:
    'The real recording, captions and transcript appear after approval. No mock or stock clip is shown.',
  revokedTitle: 'Recording revoked',
  revokedBody: 'This proof has been revoked.',
  supersededTitle: 'Recording superseded',
  supersededBody: 'This proof is historical and is not current proof.',
  invalidTitle: 'Proof unavailable',
  captions: 'Captions',
  transcript: 'Transcript',
  support: 'Support',
  // Actions, sections and the permitted Plans link.
  openProofShell: 'Open proof shell',
  backToEngines: 'Back to Engines',
  liveSamples: 'Live samples',
  trySample: 'Try a sample',
  samplesPending: 'Samples open when the engine service and quota are live.',
  plans: 'Plans',
});

const engineScenariosUnfrozen: {
  scenarioId: string;
  engineId: EngineId;
  publicationState: ScenarioPublicationState;
  source: { doc: string; section: string };
}[] = engines.flatMap((engine) =>
  engine.scenarioIds.map((scenarioId) => ({
    scenarioId,
    engineId: engine.id,
    publicationState: 'footage-pending' as const,
    source: enginesSource,
  })),
);

for (const scenario of engineScenariosUnfrozen) {
  Object.freeze(scenario);
}

export const engineScenarios: readonly (typeof engineScenariosUnfrozen)[number][] =
  Object.freeze(engineScenariosUnfrozen);
