// W0-01: kit adapter — the one visual system for this site.
// Every screen imports primitives from here, never from src/kit/*.tsx directly
// and never with raw design values. When L3 publishes @rhobear/family-kit
// 1.0.0, the swap is: add the dependency, change the re-exports below to
// '@rhobear/family-kit/react', delete the local primitives + tokens.ts.
// See src/kit/README.md.
export { Button } from './buttons';
export type { ButtonProps, ButtonVariant } from './buttons';
export { InfoList, InfoRow, RadioList, SwitchRow, Chip } from './rows';
export type { RadioOption } from './rows';
export { Sheet, Progress, LiveRegion } from './overlays';
export { useMotion, motionSpecs, MOTION_NAMES } from './motion';
export type { MotionName, MotionSpec } from './motion';