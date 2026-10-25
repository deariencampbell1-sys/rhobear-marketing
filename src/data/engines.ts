// W0-02b: the Engines destination and its scenario registry. Engines are one
// destination: mini apps inside Builds plus @ MCPs for other harnesses, each
// proved by a real-speed public recording. There are exactly seven. No engine
// or scenario is described here: a scenario cannot be described in public
// until its approved demo exists.

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
    'Engines are mini apps inside Builds plus @ MCPs for other harnesses. Every one is shown here by a real-speed recording of the product doing the work — never a mock, never a stock clip.',
  evidenceState: 'awaiting-approved-demos',
  source: { doc: 'lanes/L9-front-door/INTENT.md', section: '3. Products — Engines' },
} as const;

const enginesSource = {
  doc: 'lanes/L9-front-door/INTENT.md',
  section: '3. Products — Engines',
} as const;

export const engines = [
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

export type EngineId = (typeof engines)[number]['id'];

// Null prototype: an unknown id must never resolve through Object.prototype.
const enginesByIdUnfrozen = Object.create(null) as Record<EngineId, EngineRow>;
for (const engine of engines) {
  enginesByIdUnfrozen[engine.id] = engine;
}

export const enginesById: Readonly<Record<EngineId, EngineRow>> =
  Object.freeze(enginesByIdUnfrozen);

export const engineScenarios: readonly {
  scenarioId: string;
  engineId: string;
  publicationState: 'footage-pending';
  source: { doc: string; section: string };
}[] = engines.flatMap((engine) =>
  engine.scenarioIds.map((scenarioId) => ({
    scenarioId,
    engineId: engine.id,
    publicationState: 'footage-pending' as const,
    source: enginesSource,
  })),
);
