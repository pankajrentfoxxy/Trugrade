'use client';

import * as React from 'react';
import {
  Button,
  DataBoard,
  EmptyState,
  GradeBadge,
  RecordHeader,
  SidePanel,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import { CartSkeleton } from './CartSkeleton';
import { Money, type Grade } from '@trugrade/contracts';
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

const isGrade = (g: string): g is Grade => g === 'A_PLUS' || g === 'A' || g === 'B';

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
      let targetId = open.some((c) => c.id === asked) ? asked : (open[0]?.id ?? null);
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
      <RecordHeader
        title={cart ? cart.name : 'Your carts'}
        subtitle={
          cart && cart.itemCount > 0 ? (
            <>
              One order and one invoice, from {BRAND.legalEntity} These machines leave from{' '}
              <b className="mono">{groups.length}</b> dispatch{' '}
              {groups.length === 1 ? 'point' : 'points'}, so they can arrive on different days.
            </>
          ) : (
            <>Kept on your account, so it is here on your next visit and on your other devices.</>
          )
        }
        identifiers={
          cart
            ? [
                { label: 'Lines', value: String(cart.itemCount) },
                { label: 'Goods value', value: rupees(cart.goodsTotal) },
              ]
            : undefined
        }
        status={
          cart?.needsAttention ? (
            <StatusPill
              tone="warn"
              label={`${shortLines.length} ${shortLines.length === 1 ? 'line' : 'lines'} to look at`}
            />
          ) : undefined
        }
      />

      {/* --- THE NAMED CARTS ------------------------------------------------
          A procurement head sourcing three departments keeps three. The active
          one is amber because it is an active state, and it is in the URL so a
          second tab opens the same one. */}
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
              onClick={() => void select(c.id)}
            >
              {c.name}
              <span className="c mono">
                {c.lineCount} {c.lineCount === 1 ? 'line' : 'lines'}
              </span>
            </button>
          );
        })}
        {naming ? (
          <form className="cartname" onSubmit={(e) => void create(e)}>
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
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button type="submit" variant="secondary" size="sm" loading={busy === 'create'}>
              Create
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setNaming(false);
                setNameError(null);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(true)}>
            New cart
          </Button>
        )}
      </div>
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

      {carts.length === 0 ? (
        <EmptyState
          title="You have no carts yet"
          body="Pick a supply point on any model and it starts one. A cart is a shortlist you can name, keep and come back to — nothing in it is ordered until you say so."
          action={
            <a className="pill acc" href="/search">
              Browse inspected laptops
            </a>
          }
        />
      ) : (
        <div className="rec">
          <main className="evid">
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
                  <div className="tickrule" aria-hidden="true">
                    {Array.from({ length: 31 }, (_, i) => (
                      <i key={i} />
                    ))}
                  </div>
                </div>
                <div className="tbl cartlines">
                  <DataBoard
                    caption={`${group.lines.length} ${
                      group.lines.length === 1 ? 'line' : 'lines'
                    } dispatching from ${group.label}`}
                    rows={group.lines}
                    rowKey={(l) => l.itemId}
                    columns={columns(busy, setQty, remove)}
                  />
                </div>
              </section>
            ))}
          </main>

          <div className="sidep">
            <SidePanel
              title="This order"
              description="Every charge on this order is named here. Nothing is added later."
              footnote={
                <>
                  <b>Nothing in a cart is reserved.</b> Stock is held for 20 minutes when you start
                  checkout, and the hold and its countdown are shown there. Until then these
                  machines stay on sale to everyone, which is why the counts above are re-read
                  every time you open this page.
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
                Goods value is our price for what can ship today, before tax and delivery. Those
                two need the delivery address, and both are shown in full — head by head — on the
                next screen before you confirm anything. There is no third charge.
              </p>

              {/* The one amber control on this screen — and it is absent rather
                  than greyed on an empty cart, because there the primary action
                  is "browse", which the panel is not the place for. */}
              {cart && cart.itemCount > 0 && !cart.needsAttention && (
                <a className="pill acc cartgo" href={`/checkout?cart=${cart.id}`}>
                  Continue to checkout
                </a>
              )}
              {cart && cart.needsAttention && (
                <>
                  <Button variant="primary" block disabledReason={BLOCKED}>
                    Continue to checkout
                  </Button>
                  {/* The reason is on the screen, not only in a tooltip: a
                      `title` is unreachable by touch and by keyboard. */}
                  <p className="fnote" role="status">
                    {BLOCKED}
                  </p>
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
                <button
                  type="button"
                  className="ulink"
                  disabled={busy !== null}
                  onClick={() => void recheck()}
                >
                  {busy === 'recheck' ? 'Checking…' : 'Check again'}
                </button>
              </p>
            </SidePanel>
          </div>
        </div>
      )}
    </>
  );
}

/* ==========================================================================
 * The line table
 * ======================================================================== */

const shippable = (groups: readonly { lines: CartLine[] }[]): string => {
  const lines = groups.flatMap((g) => g.lines);
  const can = lines.reduce((n, l) => n + Math.min(l.qtyRequested, l.qtyAvailable), 0);
  const asked = lines.reduce((n, l) => n + l.qtyRequested, 0);
  // Always with its denominator, including when they match: "20" alone is a
  // number the reader has to go and check against what they asked for.
  return `${can} of ${asked}`;
};

function columns(
  busy: string | null,
  setQty: (line: CartLine, qty: number) => Promise<void>,
  remove: (line: CartLine) => Promise<void>,
): Column<CartLine>[] {
  return [
    {
      key: 'model',
      header: 'Machine',
      cell: (l) => (
        <span className="lmodel">
          <b>{l.title}</b>
          <span className="mono">{l.specSummary}</span>
          <span className="lgrade">
            {isGrade(l.grade) ? (
              <GradeBadge grade={l.grade} />
            ) : (
              /* A line whose offer has gone carries no grade. "Not recorded"
                 rather than an empty chip that reads as a grade of nothing. */
              <span className="notmeasured mono">Grade not recorded</span>
            )}
            <span className="lmeta mono">{l.dispatch}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'availability',
      header: 'Still available',
      cell: (l) => {
        const short = l.qtyAvailable < l.qtyRequested;
        return (
          <span className="lavail">
            {/* The server's own sentence. A count with no denominator — "3
                available" — is the version a buyer misreads as three of three. */}
            <span className={short ? 'avail short' : 'avail'}>{l.availability}</span>
            {short && l.qtyAvailable > 0 && (
              <button
                type="button"
                className="ulink"
                disabled={busy !== null}
                onClick={() => void setQty(l, l.qtyAvailable)}
              >
                Set this line to {units(l.qtyAvailable)}
              </button>
            )}
            {l.qtyAvailable === 0 && (
              <span className="lmeta">
                These went to another buyer. Take the line out and the rest of the order is
                unaffected.
              </span>
            )}
            {l.priceChangedSinceAdded && (
              <span className="lmeta">
                Our price for this machine has moved since you added it. The figure on the right is
                the one you would pay.
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'qty',
      header: 'Quantity',
      numeric: true,
      cell: (l) => <QtyCell line={l} busy={busy} onApply={setQty} />,
    },
    {
      key: 'unit',
      header: 'Our price, each',
      numeric: true,
      cell: (l) => <span className="money">{rupees(l.unitPrice)}</span>,
    },
    {
      key: 'total',
      header: 'Line, before tax',
      numeric: true,
      cell: (l) => (
        <span className="money">
          {rupees(l.lineTotal)}
          <small>
            {/* Priced on what can ship, so the arithmetic on screen has to be
                the arithmetic that produced it. */}
            {Math.min(l.qtyRequested, l.qtyAvailable)} × {rupees(l.unitPrice)}
          </small>
        </span>
      ),
    },
    {
      key: 'remove',
      header: 'Remove',
      headerHidden: true,
      cell: (l) => (
        <Button
          variant="ghost"
          size="sm"
          loading={busy === l.itemId}
          onClick={() => void remove(l)}
          aria-label={`Remove ${l.title} from this cart`}
        >
          Remove
        </Button>
      ),
    },
  ];
}

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

  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1;
  const dirty = valid && parsed !== line.qtyRequested;

  return (
    <form
      className="qtycell"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void onApply(line, parsed);
      }}
    >
      <label className="sr-only" htmlFor={`qty-${line.itemId}`}>
        Quantity of {line.title}
      </label>
      <input
        id={`qty-${line.itemId}`}
        className="mono"
        type="number"
        min={1}
        inputMode="numeric"
        value={value}
        disabled={busy !== null}
        onChange={(e) => setValue(e.target.value)}
      />
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
  const url = new URL(window.location.href);
  url.searchParams.set('cart', id);
  // The hand-off params have been consumed by now; leaving them would re-apply
  // the same add on every reload.
  url.searchParams.delete('listing');
  url.searchParams.delete('qty');
  window.history.replaceState(null, '', url.toString());
}
