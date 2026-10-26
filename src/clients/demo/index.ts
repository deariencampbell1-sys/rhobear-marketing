// W0-05a barrel: the demo package surface. `schema.ts` owns what a
// rhobear.demo-package.v1 is and validates the scenario registry;
// `resolve.ts` owns fetch, verification and publication-state rules. The
// player, the deep link and captions are W0-05b's and build on the types
// exported here — DemoPackage, DemoPresentation, ScenarioRegistryRow —
// without editing these files.
export * from './schema';
export * from './resolve';
