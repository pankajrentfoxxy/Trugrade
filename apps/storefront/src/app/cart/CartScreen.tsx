'use client';

import * as React from 'react';
import {
  Button,
  EmptyState,
  SidePanel,
  StatusPill,
} from '@trugrade/ui';
import { CartSkeleton } from './CartSkeleton';
import { Money } from '@trugrade/contracts';
import type { ApiFailure } from '../register/api';
import {
  CART_NAME_MAX,
  createCart,
  listCarts,
  removeCartLine,
  setCartLine,
  viewCart,
  type CartLine,
  type CartSummary,
  type CartView,
} from './api';
import {
  publishCartUpdate,
  rememberActiveCart,
  resolveTargetCartId,
} from '../../lib/cart-state';
import {
  BoxIcon,
  ClockIcon,
  ProductLineIdentity,
  ProductLinePassRow,
  formatDispatch,
} from '../../lib/product-line-details';

/**
 * The cart, client side. See `page.tsx` for the archetype and the rules.
 *
 * It is a client component because every call it makes is authenticated and
 * every one of them can come back 401 — a signed-out visitor is a state this
 * screen renders, not an error — and because the availability figures are read
 * at the moment the screen opens rather than at the moment a page was cached.
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

/**
 * The name a cart gets when a buyer arrives from the comparison board with no
 * cart at all. It is the API's own default for the same reason it is the API's
 * default: a first cart should not make somebody name a thing before they can
 * use it, and it is renameable the moment a second requirement appears.
 */
const FIRST_CART_NAME = 'Cart';

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

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function CartScreen(): React.JSX.Element {
  const [screen, setScreen] = React.useState<Screen>({ k: 'loading' });
  const [carts, setCarts] = React.useState<CartSummary[]>([]);
  const [cart, setCart] = React.useState<CartView | null>(null);
  const [checkedAt, setCheckedAt] = React.useState<Date | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  /** Which control is mid-request. One at a time: the cart is a shared total. */
  const [busy, setBusy] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState('');
  const [naming, setNaming] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);

  /** A cart view has just been read. Record when, because the screen says when. */
  const landed = React.useCallback((view: CartView) => {
    setCart(view);
    setCheckedAt(new Date());
    rememberActiveCart(view.id);
    publishCartUpdate({ cartId: view.id, lineCount: view.itemCount });
    setCarts((prev) =>
      prev.map((c) =>
        c.id === view.id ? { ...c, name: view.name, lineCount: view.itemCount } : c,
      ),
    );
  }, []);

  const refuse = React.useCallback((failure: ApiFailure): void => {
    setNotice({ tone: 'fail', text: problem(failure) });
  }, []);

  /* ---------------------------------------------------------------- boot */

  React.useEffect(() => {
    let live = true;

    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const list = await listCarts();
      if (!live) return;

      // 401 is the signed-out visitor, and it is the only status this screen
      // treats as a state rather than a fault.
      if (!list.ok) {
        setScreen(
          list.status === 401 ? { k: 'signed-out' } : { k: 'error', message: problem(list) },
        );
        return;
      }

      let open = list.data;
      const asked = params.get('cart');
      let targetId = resolveTargetCartId(open, asked);
      const pending = readPending(params);

      if (pending && targetId === null) {
        const made = await createCart(FIRST_CART_NAME);
        if (!live) return;
        if (!made.ok) {
          setScreen({ k: 'error', message: problem(made) });
          return;
        }
        open = [made.data, ...open];
        targetId = made.data.id;
      }

      setCarts(open);

      if (targetId !== null) {
        // The add replaces the quantity rather than accumulating it, so a
        // reload of this URL re-states the same line instead of doubling it.
        const view = pending
          ? await setCartLine(targetId, pending.listingId, pending.qty)
          : await viewCart(targetId);
        if (!live) return;
        if (view.ok) landed(view.data);
        else if (pending) {
          // The cart itself is still readable and still worth showing; it is
          // the one line that did not go in.
          refuse(view);
          const fallback = await viewCart(targetId);
          if (live && fallback.ok) landed(fallback.data);
        } else {
          setScreen({ k: 'error', message: problem(view) });
          return;
        }
        rememberCart(targetId);
      }

      setScreen({ k: 'ready' });
    })();

    return () => {
      live = false;
    };
  }, [landed, refuse]);

  /* ------------------------------------------------------------- actions */

  const select = async (id: string): Promise<void> => {
    setBusy(`cart:${id}`);
    setNotice(null);
    const view = await viewCart(id);
    setBusy(null);
    if (view.ok) {
      landed(view.data);
      rememberCart(id);
    } else refuse(view);
  };

  const recheck = async (): Promise<void> => {
    if (!cart) return;
    setBusy('recheck');
    const view = await viewCart(cart.id);
    setBusy(null);
    if (view.ok) landed(view.data);
    else refuse(view);
  };

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0) {
      setNameError('Give the cart a name — “Delhi office refresh”, or the ticket number.');
      return;
    }
    if (name.length > CART_NAME_MAX) {
      setNameError(`That is ${name.length} characters. A cart name can be up to ${CART_NAME_MAX}.`);
      return;
    }
    setNameError(null);
    setBusy('create');
    const made = await createCart(name);
    setBusy(null);
    if (!made.ok) {
      // The duplicate-name conflict names the cart it clashed with, so it is
      // shown against the field that caused it rather than as a page-level
      // failure the buyer has to map back to what they typed.
      setNameError(problem(made));
      return;
    }
    setCarts((prev) => [made.data, ...prev]);
    setNewName('');
    setNaming(false);
    await select(made.data.id);
  };

  const setQty = async (line: CartLine, qty: number): Promise<void> => {
    if (!cart) return;
    setBusy(line.itemId);
    setNotice(null);
    const view = await setCartLine(cart.id, line.offerId, qty);
    setBusy(null);
    if (view.ok) landed(view.data);
    else refuse(view);
  };

  const remove = async (line: CartLine): Promise<void> => {
    if (!cart) return;
    setBusy(line.itemId);
    setNotice(null);
    const view = await removeCartLine(cart.id, line.itemId);
    setBusy(null);
    if (view.ok) landed(view.data);
    else refuse(view);
  };

  /* -------------------------------------------------------------- render */

  if (screen.k === 'loading') return <Loading />;
  if (screen.k === 'signed-out') return <SignedOut />;
  if (screen.k === 'error') return <Failed message={screen.message} />;

  const groups = cart?.dispatchGroups ?? [];
  const shortLines = groups.flatMap((g) => g.lines).filter((l) => l.qtyAvailable < l.qtyRequested);

  return (
    <>
      {cart?.needsAttention && (
        <p className="cartwarn">
          <StatusPill
            tone="warn"
            label={`${shortLines.length} ${shortLines.length === 1 ? 'line' : 'lines'} to look at`}
          />
        </p>
      )}

      {carts.length === 0 ? (
        <>
          <CartSwitcher
            carts={carts}
            cart={cart}
            busy={busy}
            naming={naming}
            newName={newName}
            nameError={nameError}
            onNewName={setNewName}
            onNaming={setNaming}
            onNameError={setNameError}
            onCreate={(e) => void create(e)}
            onSelect={(id) => void select(id)}
          />
          {nameError && (
            <p className="ferr" id="cartnameerr" role="alert">
              {nameError}
            </p>
          )}
          {notice && (
            <p className={notice.tone === 'fail' ? 'cartnotice fail' : 'cartnotice'} role="alert">
              {notice.text}
            </p>
          )}
          <EmptyState
            title="You have no carts yet"
            body="Pick a supply point on any model and it starts one. A cart is a shortlist you can name, keep and come back to — nothing in it is ordered until you say so."
            action={
              <a className="pill acc" href="/search">
                Browse inspected laptops
              </a>
            }
          />
        </>
      ) : (
        <div className="cartlayout">
          <div className="cartlayout-lead">
            <CartSwitcher
              carts={carts}
              cart={cart}
              busy={busy}
              naming={naming}
              newName={newName}
              nameError={nameError}
              onNewName={setNewName}
              onNaming={setNaming}
              onNameError={setNameError}
              onCreate={(e) => void create(e)}
              onSelect={(id) => void select(id)}
            />
            {nameError && (
              <p className="ferr" id="cartnameerr" role="alert">
                {nameError}
              </p>
            )}
            {notice && (
              <p className={notice.tone === 'fail' ? 'cartnotice fail' : 'cartnotice'} role="alert">
                {notice.text}
              </p>
            )}

            <main className="evid cartlayout-lines">
              {cart && cart.itemCount === 0 && (
                <EmptyState
                  title={`“${cart.name}” is empty`}
                  body="Nothing has been added to this cart. Open a model, choose the supply point you want it from, and it lands here."
                  action={
                    <a className="pill acc" href="/search">
                      Browse inspected laptops
                    </a>
                  }
                />
              )}

              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <div className="sh">
                    <div className="shrow">
                      <h2>{group.label}</h2>
                      <span className="sub">
                        {group.lines.length === 1 ? 'One line' : `${group.lines.length} lines`}{' '}
                        dispatching from here
                      </span>
                    </div>
                  </div>
                  <div className="tbl cartlines">
                    <CartLineList
                      caption={`${group.lines.length} ${
                        group.lines.length === 1 ? 'line' : 'lines'
                      } dispatching from ${group.label}`}
                      lines={group.lines}
                      busy={busy}
                      onSetQty={setQty}
                      onRemove={remove}
                    />
                  </div>
                </section>
              ))}
            </main>
          </div>

          <aside className="sidep cartlayout-side">
            <CartOrderPanel
              groups={groups}
              cart={cart}
              checkedAt={checkedAt}
              busy={busy}
              onRecheck={() => void recheck()}
            />
          </aside>
        </div>
      )}
    </>
  );
}

/* ==========================================================================
 * Cart switcher and order panel
 * ======================================================================== */

function CartSwitcher({
  carts,
  cart,
  busy,
  naming,
  newName,
  nameError,
  onNewName,
  onNaming,
  onNameError,
  onCreate,
  onSelect,
}: {
  carts: CartSummary[];
  cart: CartView | null;
  busy: string | null;
  naming: boolean;
  newName: string;
  nameError: string | null;
  onNewName: (value: string) => void;
  onNaming: (value: boolean) => void;
  onNameError: (value: string | null) => void;
  onCreate: (event: React.FormEvent) => void;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="carttop">
      <div className="gsel cartsw" role="group" aria-label="Your carts">
        {carts.map((c) => {
          const on = c.id === cart?.id;
          return (
            <button
              key={c.id}
              type="button"
              className={on ? 'chipf on' : 'chipf'}
              aria-current={on ? 'true' : undefined}
              disabled={busy !== null}
              onClick={() => onSelect(c.id)}
            >
              {c.name}
              <span className="c mono" aria-hidden="true">
                ·
              </span>
              <span className="c mono">
                {c.lineCount} {c.lineCount === 1 ? 'line' : 'lines'}
              </span>
            </button>
          );
        })}
        {naming ? (
          <form className="cartname" onSubmit={onCreate}>
            <label className="sr-only" htmlFor="cartname">
              Name for the new cart
            </label>
            <input
              id="cartname"
              autoFocus
              value={newName}
              maxLength={CART_NAME_MAX + 1}
              placeholder="Delhi office refresh"
              aria-describedby={nameError ? 'cartnameerr' : undefined}
              aria-invalid={nameError ? true : undefined}
              onChange={(e) => onNewName(e.target.value)}
            />
            <Button type="submit" variant="secondary" size="sm" loading={busy === 'create'}>
              Create
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onNaming(false);
                onNameError(null);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <button
            type="button"
            className="chipf cartnew"
            disabled={busy !== null}
            onClick={() => onNaming(true)}
          >
            New cart
          </button>
        )}
      </div>
    </div>
  );
}

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
  return (
    <SidePanel
      title="This order"
      description="Every charge on this order is named here. Nothing is added later."
      footnote={
        <>
          <b>Nothing in a cart is reserved.</b> Stock is held for 20 minutes when you start checkout,
          and the hold and its countdown are shown there. Until then these machines stay on sale to
          everyone, which is why the counts above are re-read every time you open this page.
        </>
      }
    >
      <dl className="facts">
        <div>
          <dt>Machines that can ship now</dt>
          <dd className="mono">{shippable(groups)}</dd>
        </div>
        <div>
          <dt>Dispatch points</dt>
          <dd className="mono">{groups.length}</dd>
        </div>
        <div>
          <dt>Goods value</dt>
          <dd className="mono">{cart ? rupees(cart.goodsTotal) : '—'}</dd>
        </div>
        <div>
          <dt>
            Freight <span className="denom">per lane, by weight</span>
          </dt>
          <dd className="notmeasured">Priced to your pincode</dd>
        </div>
        <div>
          <dt>
            GST <span className="denom">18%, IGST or CGST + SGST</span>
          </dt>
          <dd className="notmeasured">Split shown at checkout</dd>
        </div>
      </dl>

      <p className="fnote">
        Goods value is our price for what can ship today, before tax and delivery. Those two need the
        delivery address, and both are shown in full — head by head — on the next screen before you
        confirm anything. There is no third charge.
      </p>

      {cart && cart.itemCount > 0 && !cart.needsAttention && (
        <>
          <a className="pill acc cartgo" href={`/checkout?cart=${cart.id}`}>
            Continue to checkout
          </a>
          <a className="pill wire cartmore" href="/search">
            Browse more laptops
          </a>
        </>
      )}
      {cart && cart.needsAttention && (
        <>
          <Button variant="primary" block disabledReason={BLOCKED}>
            Continue to checkout
          </Button>
          <p className="fnote" role="status">
            {BLOCKED}
          </p>
          <a className="pill wire cartmore" href="/search">
            Browse more laptops
          </a>
        </>
      )}

      <p className="fnote checked">
        {checkedAt ? (
          <>
            Availability checked at{' '}
            <span className="mono">
              {checkedAt.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </span>
          </>
        ) : (
          'Availability not checked yet'
        )}{' '}
        <button type="button" className="ulink" disabled={busy !== null} onClick={onRecheck}>
          {busy === 'recheck' ? 'Checking…' : 'Check again'}
        </button>
      </p>
    </SidePanel>
  );
}

/* ==========================================================================
 * Cart line cards — no horizontal scroll beside the actions panel.
 * ======================================================================== */

function CartLineList({
  caption,
  lines,
  busy,
  onSetQty,
  onRemove,
}: {
  caption: string;
  lines: readonly CartLine[];
  busy: string | null;
  onSetQty: (line: CartLine, qty: number) => Promise<void>;
  onRemove: (line: CartLine) => Promise<void>;
}): React.JSX.Element {
  return (
    <div>
      <div role="status" aria-live="polite" className="sr-only">
        {caption}
      </div>
      <ul className="cartline-cards">
        {lines.map((line) => (
          <li key={line.itemId}>
            <CartLineCard
              line={line}
              busy={busy}
              onSetQty={onSetQty}
              onRemove={onRemove}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CartLineCard({
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
  const shippableQty = Math.min(line.qtyRequested, line.qtyAvailable);

  return (
    <article className="cartline-card">
      <div className="cartline-body">
        <div className="cartline-main">
          <ProductLineIdentity
            title={line.title}
            grade={line.grade}
            specSummary={line.specSummary}
            pass={
              <>
                <ProductLinePassRow icon={<ClockIcon />}>
                  {formatDispatch(line.dispatch)}
                </ProductLinePassRow>
                <ProductLinePassRow icon={<BoxIcon />}>
                  <span className="mono">{units(line.qtyAvailable)} available</span>
                </ProductLinePassRow>
              </>
            }
          />
          {(short || line.qtyAvailable === 0 || line.priceChangedSinceAdded) && (
            <div className="lavail cartline-avail">
              <span className={short ? 'avail short' : 'avail'}>{line.availability}</span>
              {short && line.qtyAvailable > 0 && (
                <button
                  type="button"
                  className="ulink"
                  disabled={busy !== null}
                  onClick={() => void onSetQty(line, line.qtyAvailable)}
                >
                  Set this line to {units(line.qtyAvailable)}
                </button>
              )}
              {line.qtyAvailable === 0 && (
                <span className="lmeta">
                  These went to another buyer. Take the line out and the rest of the order is
                  unaffected.
                </span>
              )}
              {line.priceChangedSinceAdded && (
                <span className="lmeta">
                  Our price for this machine has moved since you added it. The figure on the right is
                  the one you would pay.
                </span>
              )}
            </div>
          )}
        </div>
        <aside className="cartline-aside">
          <div className="cartline-unit money">
            <span className="cartline-field-label">Our price, each</span>
            <span className="mono">{rupees(line.unitPrice)}</span>
          </div>
          <div className="cartline-qty-block">
            <span className="cartline-field-label">Quantity</span>
            <QtyCell line={line} busy={busy} onApply={onSetQty} />
          </div>
          <div className="cartline-price money">
            <span className="mono">{rupees(line.lineTotal)}</span>
            <small>
              {shippableQty} × {rupees(line.unitPrice)}
            </small>
            <small>Line, before tax</small>
          </div>
        </aside>
      </div>

      <div className="cartline-foot">
        <Button
          variant="ghost"
          size="sm"
          loading={busy === line.itemId}
          onClick={() => void onRemove(line)}
          aria-label={`Remove ${line.title} from this cart`}
        >
          Remove
        </Button>
      </div>
    </article>
  );
}

/* ==========================================================================
 * Quantity and totals
 * ======================================================================== */

const shippable = (groups: readonly { lines: CartLine[] }[]): string => {
  const lines = groups.flatMap((g) => g.lines);
  const can = lines.reduce((n, l) => n + Math.min(l.qtyRequested, l.qtyAvailable), 0);
  const asked = lines.reduce((n, l) => n + l.qtyRequested, 0);
  return `${can} of ${asked}`;
};

/**
 * Quantity, as a number the buyer types.
 *
 * The Update button appears only once the value differs from what is in the
 * cart: a control that is always live invites a click that does nothing, and a
 * debounced auto-save on a quantity field fires a request per keystroke on the
 * way from 1 to 12.
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
  const resolved = Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, maxQty) : line.qtyRequested;
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
      <span className="qtystepper">
        <button
          type="button"
          className="qtystep"
          aria-label={`Decrease quantity of ${line.title}`}
          disabled={disabled || resolved <= 1}
          onClick={() => applyQty(resolved - 1)}
        >
          −
        </button>
        <input
          id={`qty-${line.itemId}`}
          className="mono"
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
          className="qtystep"
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
        <Button type="submit" variant="secondary" size="sm" loading={busy === line.itemId}>
          Update
        </Button>
      )}
    </form>
  );
}

/* ==========================================================================
 * The states that are not a cart
 * ======================================================================== */

/** The same skeleton `loading.tsx` shows, so the page does not change shape. */
const Loading = CartSkeleton;

function SignedOut(): React.JSX.Element {
  const next =
    typeof window === 'undefined'
      ? '/cart'
      : `${window.location.pathname}${window.location.search}`;
  return (
    <EmptyState
      title="Sign in to keep a cart"
      body="A cart belongs to your account, so it is on every device you use and your colleagues each keep their own. Signing in brings you straight back here with what you picked."
      action={
        <a className="pill acc" href={`/sign-in?next=${encodeURIComponent(next)}`}>
          Sign in
        </a>
      }
    />
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="empty err" role="alert">
      <h3>We could not read your cart</h3>
      <p>{message}</p>
      <p>
        Nothing has been ordered and nothing has been lost — your cart is stored on your account,
        not in this page.
      </p>
      <p className="retry">
        <button type="button" className="pill acc" onClick={() => window.location.reload()}>
          Try again
        </button>
      </p>
    </div>
  );
}

/** `?cart=` so a second tab, and a reload, open the cart that was being read. */
function rememberCart(id: string): void {
  rememberActiveCart(id);
  const url = new URL(window.location.href);
  url.searchParams.set('cart', id);
  // The hand-off params have been consumed by now; leaving them would re-apply
  // the same add on every reload.
  url.searchParams.delete('listing');
  url.searchParams.delete('qty');
  window.history.replaceState(null, '', url.toString());
}
