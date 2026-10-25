// W0-01: motion adapter (L3 @rhobear/family-kit /motion drop-in).
// useMotion() exposes the kit's motion names only. Values below are adapter
// placeholders until 1.0.0; no duration or easing literal may live in a page —
// screens read specs from here. prefers-reduced-motion resolves to the kit's
// reduced behaviour: scale/sheen/translate removed, focus moves once, content
// appears immediately.
import * as React from 'react';

export const MOTION_NAMES = [
  'press',
  'appear',
  'disclose',
  'sheet',
  'toggle',
  'working',
  'push',
  'pop',
  'toast',
  'nudge',
  'quantity',
] as const;

export type MotionName = (typeof MOTION_NAMES)[number];

export interface MotionSpec {
  /** False when prefers-reduced-motion is set: apply no scale/translate. */
  reduced: boolean;
  duration: string;
  easing: string;
}

export function motionSpecs(reduced: boolean): Record<MotionName, MotionSpec> {
  const d = (duration: string, easing: string): MotionSpec =>
    reduced ? { reduced: true, duration: '0s', easing: 'linear' } : { reduced: false, duration, easing };
  return {
    press: d('120ms', 'ease-out'),
    appear: d('160ms', 'ease-out'),
    disclose: d('200ms', 'ease-out'),
    sheet: d('220ms', 'ease-out'),
    toggle: d('140ms', 'ease-out'),
    working: d('240ms', 'ease-in-out'),
    push: d('200ms', 'ease-out'),
    pop: d('180ms', 'ease-in'),
    toast: d('220ms', 'ease-out'),
    nudge: d('160ms', 'ease-out'),
    quantity: d('120ms', 'ease-out'),
  };
}

export function useMotion(): Record<MotionName, MotionSpec> {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return motionSpecs(reduced);
}