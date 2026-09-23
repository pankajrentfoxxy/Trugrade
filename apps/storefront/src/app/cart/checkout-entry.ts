import { getSession } from '../register/api';
import { getOrderReadiness } from '../(portal)/api';

/**
 * Where a "go to checkout" click should land, with the server asked first.
 *
 * Shared by the cart's `CheckoutGate` and the product page's Buy now, so the
 * two doors into checkout apply one rule. Checkout needs an organisation we
 * can invoice and deliver to; the honest moment to say so is before the
 * twenty-minute stock hold starts, not on the confirm screen after it.
 *
 * It fails **open**. A signed-out visitor, a refused read, an unreachable
 * server: all go on to checkout, where the door that takes the money makes
 * the real decision. This is a courtesy, not a gate.
 */
export async function checkoutDestination(cartId: string): Promise<string> {
  const href = `/checkout?cart=${cartId}`;
  const session = await getSession();
  // No session: checkout's own door handles that, as it always has.
  if (!session.ok) return href;
  const readiness = await getOrderReadiness();
  // A seat refused the read cannot be judged here; the server judges it.
  if (!readiness.ok) return href;
  // Prepaid is the mode a cart goes to checkout on. Credit is chosen on the
  // payment step, and refused there with its own sentence if it is not open.
  if (!readiness.data.prepaid) return '/profile?reason=checkout';
  return href;
}
