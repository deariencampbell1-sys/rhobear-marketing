// W0-05a barrel: the demo package surface. `schema.ts` owns what a
// rhobear.demo-package.v1 is and validates the scenario registry;
// `resolve.ts` owns fetch, verification and publication-state rules. The
// player, the deep link and captions are W0-05b's and build on the types
// exported here — DemoPackage, DemoPresentation, ScenarioRegistryRow —
// without editing these files.
// W0-05b: `player.ts` owns the player state machine (D01–D08) with position
// preservation, `deeplink.ts` owns the /engines/<scenarioId> deep link and its
// t= fragment, `captions.ts` owns the WebVTT presence and parse rules. They
// consume the types above without editing them.
export * from './schema';
export * from './resolve';
export * from './player';
export * from './deeplink';
export * from './captions';
