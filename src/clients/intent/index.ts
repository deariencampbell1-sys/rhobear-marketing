// W0-06: the intent surface barrel — re-exports only. A screen gets the
// schema (record + allowlists), the store (create/save/load/consume/clear
// over an injectable adapter) and the sign-in state machine. No OAuth
// client lives here: providers stay configurable and unconfigured.
export * from './schema';
export * from './store';
export * from './signin';
