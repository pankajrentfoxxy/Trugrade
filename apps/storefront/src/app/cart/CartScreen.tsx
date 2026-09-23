'use client';

import * as React from 'react';
import { Button, ToastProvider, useToast } from '@trugrade/ui';
import { CartSkeleton } from './CartSkeleton';
import { GuestCart } from './GuestCart';
import { mergeGuestCart } from '../../lib/merge-guest-cart';
import { CheckoutGate } from './CheckoutGate';
import { Money } from '@trugrade/contracts';
import { setSessionLostHandler, type ApiFailure } from '../register/api';
import { getCart, removeCartLine, setCartLine, type CartLine, type CartView } from './api';
import { publishCartUpdate } from '../../lib/cart-state';
import { BoxIcon, ClockIcon, formatDispatch } from '../../lib/product-line-details';

/**
 * The cart, client side. See `page.tsx` for the archetype and the rules.
 *
 * It is a client component because every call it makes is authenticated and
 * every one of them can come back 401 — a signed-out visitor is a state this
 * screen renders, not an error — and because the availability figures are read
 * at the moment the screen opens rather than at the moment a page was cached.
 *
 * One cart per buyer. The session names it, so the screen never asks which cart
 * and never offers to make another: it reads the cart, and that is the cart.
 *
 * The look is the supplied cart design (`docs/reference` has the homepage; the
 * cart came as `cart-page.html`): white ground, one yellow, flat cards, lines
 * grouped by supply point, a summary rail on the right. Two things it adds to
 * that design and one it leaves out:
 *
 *   - A line can be SHORT (fewer available than asked). The design's demo data
 *     never is; here the row says how many of how many and offers the fix.
 *   - The cart is read-only while its checkout holds stock. The server refuses
 *     the change with a sentence, and the sentence is shown where the change
 *     was attempted.
 *   - The design prices freight from a pincode typed into the rail. There is no
 *     cart-level freight quote on the API, and pricing it in the browser would
 *     be business logic in Next.js, so the rail names freight and GST and says
 *     where they resolve rather than inventing a number.
 */

/* ==========================================================================
 * State
 * ======================================================================== */

type Screen =
  /** The first read is in flight. Nothing is known yet, so nothing is shown. */
  | { k: 'loading' }
  /** No session. Not a failure: a visitor with no account, and a path for them. */
  | { k: 'signed-out' }
  /** We could not read the cart. Our problem, said in the server's own words. */
  | { k: 'error'; message: string }
  | { k: 'ready' };

/** A refusal from one action, rendered above the lines it refers to. */
interface Notice {
  tone: 'fail' | 'info';
  text: string;
}

const rupees = (decimal: string): string => Money.parse(decimal).format();

const units = (n: number): string => `${n} unit${n === 1 ? '' : 's'}`;

const lines = (n: number): string => `${n} line${n === 1 ? '' : 's'}`;

const machines = (n: number): string => `${n} machine${n === 1 ? '' : 's'}`;

const points = (n: number): string => `${n} dispatch point${n === 1 ? '' : 's'}`;

const GRADE_CODE: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

/**
 * Why checkout is closed while a line is short.
 *
 * Not a preference: `CartService.view` sets `needsAttention`, and Phase 6's
 * checkout entry refuses on it before it takes any hold. A button that leads to
 * a refusal one screen later is worse than one that says now what has to change.
 */
const BLOCKED =
  'Some lines ask for more machines than are still available. Set those lines to what is left, or take them out, and checkout opens.';

/** Both halves of the hand-off from `OfferGrid`, or neither. */
interface PendingAdd {
  listingId: string;
  qty: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What went wrong, in the server's words where it had any.
 *
 * `UNKNOWN` and `NETWORK` are the two failures with no domain message behind
 * them — a proxy 500, a dropped connection — and `call`'s fallback for those is
 * registration's ("Nothing you typed has been lost"), which is about a form and
 * says nothing true about a cart read. A refusal that describes the wrong screen
 * is worse than a plain one.
 */
const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'The cart service did not answer. That is our problem, not yours.'
    : failure.message;

/**
 * `?listing=&qty=` — the seam the supply-point board hands over on.
 *
 * A malformed pair is dropped rather than sent: the API's refusal for a bad
 * UUID says nothing a buyer can act on, and the cart they came to see is still
 * worth rendering.
 */
function readPending(params: URLSearchParams): PendingAdd | null {
  const listingId = params.get('listing');
  const qty = Number(params.get('qty'));
  if (!listingId || !UUID.test(listingId)) return null;
  if (!Number.isInteger(qty) || qty < 1) return null;
  return { listingId, qty };
}

/** The hand-off params have been consumed; leaving them would re-apply the add on every reload. */
function consumePending(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('listing') && !url.searchParams.has('qty')) return;
  url.searchParams.delete('listing');
  url.searchParams.delete('qty');
  window.history.replaceState(null, '', url.toString());
}

const shippable = (groups: readonly { lines: CartLine[] }[]): { can: number; asked: number } => {
  const all = groups.flatMap((g) => g.lines);
  return {
    can: all.reduce((n, l) => n + Math.min(l.qtyRequested, l.qtyAvailable), 0),
    asked: all.reduce((n, l) => n + l.qtyRequested, 0),
  };
};

/* ==========================================================================
 * The screen
 * ======================================================================== */

/**
 * The toast is the undo affordance on "Remove": a line taken out by a slipped
 * click comes back with one press, without a confirm dialog in front of every
 * deliberate one. The provider is mounted here because the storefront's root
 * layout has none — the portal shell has its own.
 */
export function CartScreen(): React.JSX.Element {
  return (
    <ToastProvider>
      <CartRecord />
    </ToastProvider>
  );
}

function CartRecord(): React.JSX.Element {
  const toast = useToast();
  const [screen, setScreen] = React.useState<Screen>({ k: 'loading' });
  const [cart, setCart] = React.useState<CartView | null>(null);
  const [checkedAt, setCheckedAt] = React.useState<Date | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  /** Which control is mid-request. One at a time: the cart is a shared total. */
  const [busy, setBusy] = React.useState<string | null>(null);

  /** A cart view has just been read. Record when, because the screen says when. */
  const landed = React.useCallback((view: CartView) => {
    setCart(view);
    setCheckedAt(new Date());
    publishCartUpdate({ lineCount: view.itemCount });
  }, []);

  const refuse = React.useCallback((failure: ApiFailure): void => {
    setNotice({ tone: 'fail', text: problem(failure) });
  }, []);

  /* ---------------------------------------------------------------- boot */

  React.useEffect(() => {
    let live = true;

    // The cart is outside the portal shell, so nothing else registers the
    // session-lost handler — and without one, `call` never settles a dead
    // session's request and the skeleton stays on screen for good. Here, a lost
    // session is the signed-out state, which has its own path in.
    setSessionLostHandler(() => {
      if (live) setScreen({ k: 'signed-out' });
    });

    void (async () => {
      const params = new URLSearchParams(window.location.search);

      // Signing in is the other door into a session, and this screen is where
      // "Sign in to check out" lands. Anything picked while signed out becomes
      // real here, re-priced by the server, BEFORE the cart is read — so the
      // read below already counts it.
      await mergeGuestCart();
      if (!live) return;

      const pending = readPending(params);

      // The add replaces the quantity rather than accumulating it, so a reload
      // of this URL re-states the same line instead of doubling it.
      const view = pending ? await setCartLine(pending.listingId, pending.qty) : await getCart();
      if (!live) return;

      if (view.ok) {
        landed(view.data);
      } else if (view.status === 401) {
        // 401 is the signed-out visitor, and it is the only status this screen
        // treats as a state rather than a fault.
        setScreen({ k: 'signed-out' });
        return;
      } else if (pending) {
        // The cart itself is still readable and still worth showing; it is the
        // one line that did not go in.
        refuse(view);
        const fallback = await getCart();
        if (!live) return;
        if (fallback.ok) landed(fallback.data);
        else {
          setScreen(
            fallback.status === 401
              ? { k: 'signed-out' }
              : { k: 'error', message: problem(fallback) },
          );
          return;
        }
      } else {
        setScreen({ k: 'error', message: problem(view) });
        return;
      }

      consumePending();
      setScreen({ k: 'ready' });
    })();

    return () => {
      live = false;
      setSessionLostHandler(null);
    };
  }, [landed, refuse]);

  /* ------------------------------------------------------------- actions */

  const recheck = async (): Promise<void> => {
    setBusy('recheck');
    const view = await getCart();
    setBusy(null);
    if (view.ok) {
      landed(view.data);
      toast({
        tone: 'info',
        title: view.data.needsAttention
          ? 'Availability re-checked — some lines are short'
          : 'Availability re-checked — all lines still in stock',
        durationMs: 2400,
      });
    } else refuse(view);
  };

  const setQty = async (line: CartLine, qty: number): Promise<void> => {
    setBusy(line.itemId);
    setNotice(null);
    const view = await setCartLine(line.offerId, qty);
    setBusy(null);
    if (view.ok) landed(view.data);
    else refuse(view);
  };

  const remove = async (line: CartLine): Promise<void> => {
    setBusy(line.itemId);
    setNotice(null);
    const view = await removeCartLine(line.itemId);
    setBusy(null);
    if (!view.ok) {
      refuse(view);
      return;
    }
    landed(view.data);
    toast({
      tone: 'info',
      title: `Removed ${line.title}`,
      durationMs: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          // Putting it back is the same call an add is: the quantity replaces.
          void (async () => {
            setBusy(line.itemId);
            const back = await setCartLine(line.offerId, line.qtyRequested);
            setBusy(null);
            if (back.ok) landed(back.data);
            else refuse(back);
          })();
        },
      },
    });
  };

  /* -------------------------------------------------------------- render */

  if (screen.k === 'loading') return <CartSkeleton />;
  // The basket they built while signed out. `GuestCart` falls back to the
  // same "sign in to keep a cart" empty state when there is nothing in it.
  if (screen.k === 'signed-out') return <GuestCart />;
  if (screen.k === 'error') return <Failed message={screen.message} />;

  const groups = cart?.dispatchGroups ?? [];
  const ship = shippable(groups);

  return (
    <>
      {notice && (
        <p className={notice.tone === 'fail' ? 'cartnotice fail' : 'cartnotice'} role="alert">
          {notice.text}
        </p>
      )}

      <div className="cartlayout">
        <main className="cartlayout-lead">
          <h1 className="ct-title">
            Your cart
            {cart && cart.itemCount > 0 && (
              <span>
                {' '}
                · {machines(ship.can)} · {points(groups.length)}
              </span>
            )}
          </h1>

          {cart && cart.itemCount === 0 && (
            <div className="cempty">
              <b>Your cart is empty.</b>
              <p>
                Nothing has been added yet. Open a model, choose the supply point you want it
                from, and it lands here.
              </p>
              <a className="pill acc mini" href="/search">
                Browse laptops
              </a>
            </div>
          )}

          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="grp">
              <div className="grp-h">
                <b>{group.label}</b>
                <small>{lines(group.lines.length)} dispatching from here</small>
              </div>
              <div className="grp-card">
                {group.lines.map((line) => (
                  <CartLineRow
                    key={line.itemId}
                    line={line}
                    busy={busy}
                    onSetQty={setQty}
                    onRemove={remove}
                  />
                ))}
              </div>
            </section>
          ))}
        </main>

        <div className="cartlayout-side">
          <CartOrderPanel
            groups={groups}
            cart={cart}
            checkedAt={checkedAt}
            busy={busy}
            onRecheck={() => void recheck()}
          />
        </div>
      </div>
    </>
  );
}

/* ==========================================================================
 * The summary rail
 * ======================================================================== */

function CartOrderPanel({
  groups,
  cart,
  checkedAt,
  busy,
  onRecheck,
}: {
  groups: CartView['dispatchGroups'];
  cart: CartView | null;
  checkedAt: Date | null;
  busy: string | null;
  onRecheck: () => void;
}): React.JSX.Element {
  const ship = shippable(groups);
  return (
    <aside className="sum" aria-labelledby="sum-title">
      <h2 id="sum-title">This order</h2>
      {/* GST and freight are not rows here: both need the delivery address,
          and a row that can only say "at checkout" names a charge without
          giving it. The note under the total says where they are shown. */}
      <p className="sum-sub">Goods value now. GST and freight are shown in full at checkout.</p>

      <ul className="sum-rows">
        <li>
          <span>Machines ship now</span>
          <b>
            {ship.can} of {ship.asked}
          </b>
        </li>
        <li>
          <span>Dispatch points</span>
          <b>{groups.length}</b>
        </li>
        <li className="total">
          <span>Goods value</span>
          <b>
            {cart ? rupees(cart.goodsTotal) : '—'}
            <small>before GST &amp; freight</small>
          </b>
        </li>
      </ul>

      <p className="sum-note">
        Goods value is our price for what can ship today, before tax and delivery. Those two need
        the delivery address, and both are shown in full on the next screen before you confirm
        anything. There is no third charge.
      </p>

      {cart && cart.itemCount > 0 && !cart.needsAttention && <CheckoutGate cartId={cart.id} />}
      {cart && cart.needsAttention && (
        <>
          <Button variant="primary" block className="cartgo" disabledReason={BLOCKED}>
            Continue to checkout
          </Button>
          <p className="sum-note blocked" role="status">
            {BLOCKED}
          </p>
        </>
      )}
      <a className="pill wire cartmore" href="/search">
        Browse more laptops
      </a>

      <p className="avail-line">
        {checkedAt ? (
          <>
            Availability checked at{' '}
            <b>
              {checkedAt.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </b>
          </>
        ) : (
          'Availability not checked yet'
        )}
        <button type="button" disabled={busy !== null} onClick={onRecheck}>
          {busy === 'recheck' ? 'Checking…' : 'Check again'}
        </button>
      </p>

      <p className="hold-note">
        <b>Nothing in a cart is reserved.</b> Stock is held for <b>20 minutes</b> when you start
        checkout — until then these machines stay on sale to everyone, which is why the counts above
        are re-read every time you open this page.
      </p>
    </aside>
  );
}

/* ==========================================================================
 * One line — photo slot, machine, price, quantity, line total, remove
 * ======================================================================== */

/**
 * The design puts the unit's QC photograph here. The cart payload carries no
 * image (and a listing image must go through `RepresentativeImage` with its
 * caption), so the slot holds a neutral laptop glyph rather than a grey box that
 * reads as a broken photograph.
 */
function LaptopGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 44" fill="none" aria-hidden="true">
      <rect x="9" y="4" width="46" height="30" rx="3" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="8" width="38" height="22" rx="1.5" fill="currentColor" opacity=".18" />
      <path d="M3 38h58" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function CartLineRow({
  line,
  busy,
  onSetQty,
  onRemove,
}: {
  line: CartLine;
  busy: string | null;
  onSetQty: (line: CartLine, qty: number) => Promise<void>;
  onRemove: (line: CartLine) => Promise<void>;
}): React.JSX.Element {
  const short = line.qtyAvailable < line.qtyRequested;
  const gone = line.qtyAvailable === 0;
  const shippableQty = Math.min(line.qtyRequested, line.qtyAvailable);
  const mine = busy === line.itemId;

  return (
    <article className={short ? 'ci cartline-card short' : 'ci cartline-card'} aria-busy={mine || undefined}>
      <div className="ci-img" aria-hidden="true">
        <LaptopGlyph />
      </div>

      <div className="ci-body">
        <h3 className="ci-name">{line.title}</h3>
        <div className="ci-meta">
          <span className={line.grade === 'A_PLUS' ? 'gr' : 'gr gA'}>
            Grade {GRADE_CODE[line.grade] ?? line.grade}
          </span>
          <span className="ci-spec">{line.specSummary}</span>
        </div>
        <div className="ci-tags">
          <span>
            <ClockIcon />
            {formatDispatch(line.dispatch)}
          </span>
          <span className={line.qtyAvailable <= 2 ? 'low' : undefined}>
            <BoxIcon />
            {units(line.qtyAvailable)} available
          </span>
        </div>
        {(short || line.priceChangedSinceAdded) && (
          <div className="ci-note">
            {short && <span className="ci-short">{line.availability}</span>}
            {short && !gone && (
              <button
                type="button"
                className="ci-fix"
                disabled={busy !== null}
                onClick={() => void onSetQty(line, line.qtyAvailable)}
              >
                Set this line to {units(line.qtyAvailable)}
              </button>
            )}
            {gone && (
              <span>
                These went to another buyer. Take the line out and the rest of the order is
                unaffected.
              </span>
            )}
            {line.priceChangedSinceAdded && (
              <span>
                Our price for this machine has moved since you added it. The figure on the right is
                the one you would pay.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="ci-buy">
        <span className="ci-each">
          Each, before tax <b>{rupees(line.unitPrice)}</b>
        </span>
        <QtyCell line={line} busy={busy} onApply={onSetQty} />
        <span className="ci-total">
          {rupees(line.lineTotal)}
          <small>
            {shippableQty} × {rupees(line.unitPrice)}
          </small>
        </span>
      </div>

      <button
        type="button"
        className="ci-x"
        disabled={busy !== null}
        onClick={() => void onRemove(line)}
        aria-label={`Remove ${line.title} from this cart`}
        title="Remove from this cart"
      >
        {mine ? (
          <span className="ci-spin" aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        )}
      </button>
    </article>
  );
}

/* ==========================================================================
 * Quantity
 * ======================================================================== */

/**
 * Quantity, as a number the buyer steps or types.
 *
 * The stepper buttons apply at once — one press, one request — while a typed
 * value waits for Update: a control that is always live invites a click that
 * does nothing, and a debounced auto-save on a quantity field fires a request
 * per keystroke on the way from 1 to 12.
 */
function QtyCell({
  line,
  busy,
  onApply,
}: {
  line: CartLine;
  busy: string | null;
  onApply: (line: CartLine, qty: number) => Promise<void>;
}): React.JSX.Element {
  const [value, setValue] = React.useState(String(line.qtyRequested));
  React.useEffect(() => setValue(String(line.qtyRequested)), [line.qtyRequested]);

  /** When nothing is left, the buyer may only reduce what they already asked for. */
  const maxQty = line.qtyAvailable > 0 ? line.qtyAvailable : line.qtyRequested;

  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= maxQty;
  const dirty = valid && parsed !== line.qtyRequested;
  const resolved =
    Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, maxQty) : line.qtyRequested;
  const disabled = busy !== null;
  const atMax = resolved >= maxQty;

  function applyQty(next: number): void {
    const clamped = Math.max(1, Math.min(maxQty, next));
    setValue(String(clamped));
    if (clamped !== line.qtyRequested) void onApply(line, clamped);
  }

  return (
    <form
      className="qtycell"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void onApply(line, Math.min(parsed, maxQty));
      }}
    >
      <label className="sr-only" htmlFor={`qty-${line.itemId}`}>
        Quantity of {line.title}
      </label>
      <span className="qty">
        <button
          type="button"
          aria-label={`Decrease quantity of ${line.title}`}
          disabled={disabled || resolved <= 1}
          onClick={() => applyQty(resolved - 1)}
        >
          −
        </button>
        <input
          id={`qty-${line.itemId}`}
          type="number"
          min={1}
          max={maxQty}
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          aria-label={
            atMax
              ? `Cannot add more — only ${units(line.qtyAvailable)} available`
              : `Increase quantity of ${line.title}`
          }
          disabled={disabled || atMax}
          onClick={() => applyQty(resolved + 1)}
        >
          +
        </button>
      </span>
      {dirty && (
        <button type="submit" className="mini" disabled={busy === line.itemId}>
          {busy === line.itemId ? 'Saving…' : 'Update'}
        </button>
      )}
    </form>
  );
}

/* ==========================================================================
 * The state that is not a cart
 * ======================================================================== */

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="cempty err" role="alert">
      <b>We could not read your cart</b>
      <p>{message}</p>
      <p>
        Nothing has been ordered and nothing has been lost — your cart is stored on your account,
        not in this page.
      </p>
      <button type="button" className="pill acc mini" onClick={() => window.location.reload()}>
        Try again
      </button>
    </div>
  );
}
