/**
 * The cart a signed-out visitor is allowed to have.
 *
 * **Why it lives in the browser.** A server cart row is owned — `ordering.cart`
 * is keyed on `(buyer_org_id, user_id, name)` and every read goes through the
 * repository's org scope. There is no owner for a visitor who has not signed
 * in, and inventing one would mean making that column nullable and teaching the
 * org scope to accept "no org" — a hole in the control that keeps one buyer's
 * data away from another's. So until they sign in, the picks are theirs and
 * they are kept on their machine.
 *
 * **Why it carries a snapshot and not just ids.** `/cart` has to name what is
 * in it, and every endpoint that could resolve a listing id into a title and a
 * price is an authenticated buyer route. The details are already on screen at
 * the moment of the click, so they are written down then.
 *
 * **The snapshot is therefore a record of what was shown, not a quote.** A
 * price is only real once the server has priced the line against the buyer's
 * own org — inter-state or intra-state GST alone changes it. Everything that
 * renders these lines has to say so, and the merge below re-prices every line
 * against the server the moment there is a session to price it for.
 */

const KEY = 'tg-guest-cart';

/** What was on screen when the line was added. Display only — never a total. */
export interface GuestCartLine {
  /** The offer. A listing id identifies an offer, never its source. */
  listingId: string;
  qty: number;
  title: string;
  specSummary: string;
  grade: string;
  /** As displayed at the time of the click, for re-pricing at sign-in. */
  unitPrice: string;
  /** `Supply Point W · Noida` — the city, and nothing finer. */
  supplyPoint: string;
  dispatch: string;
  /** ISO 8601, so a stale basket can say how stale. */
  addedAt: string;
}

/** Everything the hook needs to write a line, minus the parts it fills in. */
export type GuestCartSnapshot = Omit<GuestCartLine, 'qty' | 'addedAt'>;

/**
 * Storage can throw — a private window, blocked site data, a full quota — and
 * a cart that throws on read is worse than one that comes back empty.
 */
function safeRead(): GuestCartLine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is GuestCartLine =>
        typeof l === 'object' &&
        l !== null &&
        typeof (l as GuestCartLine).listingId === 'string' &&
        Number.isFinite((l as GuestCartLine).qty),
    );
  } catch {
    return [];
  }
}

function safeWrite(lines: readonly GuestCartLine[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Nothing to do and nothing to tell the buyer: the line is still in memory
    // for this page, and the screen reflects that.
  }
  // The header count and the dock listen for this rather than polling.
  window.dispatchEvent(new CustomEvent('tg-guest-cart-change'));
}

export function readGuestCart(): GuestCartLine[] {
  return safeRead();
}

export function guestCartCount(): number {
  return safeRead().reduce((n, l) => n + l.qty, 0);
}

/** Adds, or raises the quantity if that offer is already in the basket. */
export function addGuestLine(snapshot: GuestCartSnapshot, qty: number): GuestCartLine[] {
  const lines = safeRead();
  const existing = lines.find((l) => l.listingId === snapshot.listingId);
  if (existing) {
    existing.qty += qty;
    // The newest price wins: it is the one the buyer was just looking at.
    Object.assign(existing, snapshot, { qty: existing.qty });
  } else {
    lines.push({ ...snapshot, qty, addedAt: new Date().toISOString() });
  }
  safeWrite(lines);
  return lines;
}

/** A quantity below one removes the line — the same rule the server cart uses. */
export function setGuestQty(listingId: string, qty: number): GuestCartLine[] {
  const lines = safeRead().flatMap((l) =>
    l.listingId === listingId ? (qty < 1 ? [] : [{ ...l, qty }]) : [l],
  );
  safeWrite(lines);
  return lines;
}

export function clearGuestCart(): void {
  safeWrite([]);
}
