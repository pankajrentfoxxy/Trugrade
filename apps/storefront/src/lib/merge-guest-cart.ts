'use client';

import { setCartLine, type CartView } from '../app/cart/api';
import { clearGuestCart, readGuestCart } from './guest-cart';

/**
 * Moves a signed-out basket into the buyer's real cart, once they have one.
 *
 * It lives here rather than in either caller because there are two doors into a
 * session — the product page, where the hook notices a session it did not have
 * a moment ago, and `/cart`, which is where the "sign in to check out" button
 * lands them. A copy in each is how the two come to disagree about when the
 * local basket is safe to delete.
 *
 * **Every line is re-priced by the server.** The snapshot a guest line carries
 * is a record of what was on screen, not a quote: GST alone differs by whether
 * the buyer's org is in our state or another. So the merge sends nothing but
 * the offer and the quantity, and lets `setCartLine` price it.
 *
 * **The local copy is cleared once, at the end.** A failure half way through
 * leaves it intact, so the next attempt still has everything rather than the
 * remainder of a half-finished move.
 */
export async function mergeGuestCart(
  onView?: (view: CartView) => void,
): Promise<{ moved: number; failed: number } | null> {
  const pending = readGuestCart();
  if (pending.length === 0) return null;

  let moved = 0;
  let failed = 0;
  for (const line of pending) {
    // There is one cart and the session names it, so the add is the whole
    // move: no cart to find first, none to create.
    const result = await setCartLine(line.listingId, line.qty);
    if (result.ok) {
      moved += 1;
      onView?.(result.data);
    } else {
      // A line that will not go in is a line whose stock has gone, or whose
      // price the server refuses. Counted, not silently dropped.
      failed += 1;
    }
  }

  // Only clear when nothing was left behind, so a buyer never loses a pick to
  // a transient refusal.
  if (failed === 0) clearGuestCart();
  return { moved, failed };
}
