import { checkoutState } from '../data/legal';

export function CheckoutClosedNotice(): JSX.Element | null {
  if (checkoutState.state !== 'closed') return null;
  return <p>{checkoutState.reason}</p>;
}
