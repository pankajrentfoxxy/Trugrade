'use client';

import * as React from 'react';
import { EmptyState } from '@trugrade/ui';
import { Money } from '@trugrade/contracts';
import {
  readGuestCart,
  setGuestQty,
  clearGuestCart,
  type GuestCartLine,
} from '../../lib/guest-cart';

/**
 * The cart a signed-out visitor is looking at.
 *
 * Everything here is read from their own browser — see `lib/guest-cart.ts` for
 * why it is not a server cart. Two things follow from that and both are said on
 * the screen rather than left for checkout to reveal:
 *
 *   - **The prices are what was on screen when they picked**, not a quote. GST
 *     depends on which state the buyer's org is registered in, and there is no
 *     org yet. The server re-prices every line at sign-in.
 *   - **Nothing is held.** The signed-in cart already says this; for a basket
 *     that is not even on the server it is more true, not less.
 *
 * There is no checkout button. Checkout needs an organisation we can invoice,
 * so the one action is to sign in — which is also the moment the basket becomes
 * a real cart.
 */
export function GuestCart({ onEmptied }: { onEmptied?: () => void }): React.JSX.Element {
  const [lines, setLines] = React.useState<readonly GuestCartLine[]>([]);

  React.useEffect(() => {
    setLines(readGuestCart());
  }, []);

  const signInHref = `/sign-in?next=${encodeURIComponent('/cart')}`;

  const setQty = (listingId: string, qty: number): void => {
    const next = setGuestQty(listingId, qty);
    setLines(next);
    if (next.length === 0) onEmptied?.();
  };

  if (lines.length === 0) {
    return (
      <EmptyState
        className="ct-empty"
        title="Sign in to keep a cart"
        body="A cart belongs to your account, so it is on every device you use and your colleagues each keep their own. Signing in brings you straight back here with what you picked."
        action={
          <a className="pill acc" href={signInHref}>
            Sign in
          </a>
        }
      />
    );
  }

  // Summed from the snapshots, which is why it is labelled as an estimate
  // everywhere it appears. `Money` rather than floats: this is still rupees.
  const goods = Money.sum(lines.map((l) => Money.parse(l.unitPrice).times(l.qty)));
  const units = lines.reduce((n, l) => n + l.qty, 0);

  return (
    <div className="gcart">
      <div className="gcart-head">
        <h1>Your picks</h1>
        <p>
          Kept in this browser until you sign in. <b>{units}</b> unit
          {units === 1 ? '' : 's'} from <b>{lines.length}</b> supply point
          {lines.length === 1 ? '' : 's'}.
        </p>
      </div>

      <ul className="gcart-lines">
        {lines.map((line) => (
          <li key={line.listingId} className="gcart-line">
            <div className="gcart-line-main">
              <b>{line.title}</b>
              <span className="gcart-spec mono">{line.specSummary}</span>
              <span className="gcart-src">
                {line.supplyPoint} · {line.dispatch}
              </span>
            </div>
            <div className="gcart-line-qty">
              <button
                type="button"
                aria-label={`Decrease quantity for ${line.supplyPoint}`}
                onClick={() => setQty(line.listingId, line.qty - 1)}
              >
                −
              </button>
              <output className="mono">{line.qty}</output>
              <button
                type="button"
                aria-label={`Increase quantity for ${line.supplyPoint}`}
                onClick={() => setQty(line.listingId, line.qty + 1)}
              >
                +
              </button>
            </div>
            <div className="gcart-line-money">
              <span className="mono">{Money.parse(line.unitPrice).times(line.qty).format()}</span>
              <small className="mono">{Money.parse(line.unitPrice).format()} each</small>
            </div>
            <button
              type="button"
              className="gcart-remove"
              onClick={() => setQty(line.listingId, 0)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="gcart-foot">
        <div className="gcart-total">
          <span>Estimated goods value</span>
          <b className="mono">{goods.format()}</b>
        </div>
        <p className="gcart-note">
          These are the prices you were shown when you picked each machine. We confirm every one
          against your organisation when you sign in — the GST split alone depends on which state
          you are registered in — and freight follows your delivery pincode at checkout. Nothing
          here is reserved.
        </p>
        <div className="gcart-actions">
          <a className="pvbtn pvbtn-cart" href={signInHref}>
            Sign in to check out
          </a>
          <button
            type="button"
            className="gcart-clear"
            onClick={() => {
              clearGuestCart();
              setLines([]);
              onEmptied?.();
            }}
          >
            Clear picks
          </button>
        </div>
      </div>
    </div>
  );
}
