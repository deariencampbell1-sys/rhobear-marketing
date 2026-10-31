import { checkoutState } from '../data/legal';

/**
 * Test seam: `state` and `reason` default to `src/data/legal.ts`'s
 * `checkoutState`, so production usage `<CheckoutClosedNotice />` stays a pure
 * function of the module data and renders no markup unless the state is
 * exactly 'closed'.
 */
export function CheckoutClosedNotice({
  state = checkoutState.state,
  reason = checkoutState.reason,
}: {
  state?: string;
  reason?: string;
}): JSX.Element | null {
  if (state !== 'closed') return null;
  return <p>{reason}</p>;
}
