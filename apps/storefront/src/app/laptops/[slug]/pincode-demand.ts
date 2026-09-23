/**
 * "Pincode first" — the one signal between the buttons and the box.
 *
 * Add to cart, Buy now and every row's Add on the board all need a landed
 * price before a line goes in the cart, and the pincode is what lands it.
 * Rather than each button reaching into the form's state, a click without a
 * pincode raises this event; `PincodeForm` listens, says why it needs the
 * pincode, scrolls itself into view, takes focus and shakes once. A DOM event
 * rather than a context because the board lives inside `packages/ui` and the
 * form is the page's own — they share a document, not a React tree.
 */

export const PINCODE_DEMAND_EVENT = 'trugrade:pincode-demand';

/** What the box says when a button sent the buyer here. */
export const PINCODE_DEMAND_MESSAGE =
  'Add your delivery pincode first. We land the price to your site before anything goes in the cart.';

export function demandPincode(): void {
  window.dispatchEvent(new CustomEvent(PINCODE_DEMAND_EVENT));
}

/** Bring the pincode box to the middle of the screen and put the cursor in it. */
export function scrollToPincode(): void {
  const box = document.getElementById('pin');
  if (!box) return;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  box.focus({ preventScroll: true });
}
