'use client';

import * as React from 'react';
import {
  Button,
  EmptyState,
  GradeBadge,
  Input,
  PriceBreakup,
  Skeleton,
  StatusPill,
  StepRail,
  WhyRail,
  type PriceLine,
  type Step,
  type WhyRailItem,
} from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import { Money, type Grade } from '@trugrade/contracts';
import type { ApiFailure } from '../register/api';
import { Countdown } from './Countdown';
import {
  abandonCheckout,
  confirmCheckout,
  quoteCheckout,
  startCheckout,
  type BreakUp,
  type CheckoutSession,
  type DeliverySite,
  type OrderConfirmation,
  type PaymentMode,
} from './api';

/**
 * Checkout, client side. See `page.tsx` for the archetype and the rules.
 *
 * It is a client component because every call it makes is authenticated, every
 * one of them can come back 401 — a signed-out visitor is a state this screen
 * renders, not an error — and because the hold is a live deadline that has to
 * tick.
 */

/* ==========================================================================
 * The six steps
 * ======================================================================== */

const STEPS = [
  { code: 'REVIEW', title: 'Review what is held' },
  { code: 'BILLING', title: 'GSTIN and billing' },
  { code: 'DELIVERY', title: 'Delivery site' },
  { code: 'REFERENCE', title: 'Your PO reference' },
  { code: 'PAYMENT', title: 'How you are paying' },
  { code: 'CONFIRM', title: 'Confirm' },
] as const;

type StepCode = (typeof STEPS)[number]['code'];

type Phase =
  | { k: 'loading' }
  /** No session. Not a failure: a visitor with no account, and a path for them. */
  | { k: 'signed-out' }
  /** The hold could not be taken, or the cart cannot be checked out. Said plainly. */
  | { k: 'refused'; message: string }
  /** Our problem, in the server's own words. */
  | { k: 'error'; message: string }
  | { k: 'ready' }
  /** The hold ran out while the buyer was here. Not a failure, a fact. */
  | { k: 'expired' }
  | { k: 'placed'; order: OrderConfirmation };

const rupees = (decimal: string): string => Money.parse(decimal).format();

const isGrade = (g: string): g is Grade => g === 'A_PLUS' || g === 'A' || g === 'B';

const machines = (n: number): string => `${n} machine${n === 1 ? '' : 's'}`;

/**
 * What went wrong, in the server's words where it had any.
 *
 * `UNKNOWN` and `NETWORK` are the two failures with no domain message behind
 * them, and `call`'s fallback for those describes a registration form. A refusal
 * that describes the wrong screen is worse than a plain one.
 */
const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'Checkout did not answer. That is our problem, not yours — nothing has been ordered and nothing has been charged.'
    : failure.message;

/** `?cart=` is where the cart hands over. Board state stays in the URL. */
function cartIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('cart');
}

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function CheckoutFlow(): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [session, setSession] = React.useState<CheckoutSession | null>(null);
  const [step, setStep] = React.useState<StepCode>('REVIEW');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const [gstProfileId, setGst] = React.useState<string | null>(null);
  const [billingAddressId, setBilling] = React.useState<string | null>(null);
  const [deliveryAddressId, setDelivery] = React.useState<string | null>(null);
  const [paymentMode, setPaymentMode] = React.useState<PaymentMode | null>(null);
  const [poNumber, setPoNumber] = React.useState('');
  const [costCentre, setCostCentre] = React.useState('');

  const cartId = React.useRef<string | null>(null);

  const land = React.useCallback((next: CheckoutSession) => {
    setSession(next);
    setGst((v) => v ?? next.selection.gstProfileId);
    setBilling((v) => v ?? next.selection.billingAddressId);
    setDelivery((v) => v ?? next.selection.deliveryAddressId);
    setPaymentMode((v) => v ?? (next.selection.paymentMode as PaymentMode | null));
  }, []);

  /* ---------------------------------------------------------------- boot */

  React.useEffect(() => {
    let live = true;
    const id = cartIdFromUrl();
    cartId.current = id;

    if (!id) {
      setPhase({
        k: 'refused',
        message:
          'This page needs to know which cart you are checking out. Open your cart and choose “Continue to checkout”.',
      });
      return;
    }

    void (async () => {
      const started = await startCheckout(id);
      if (!live) return;
      if (started.ok) {
        land(started.data);
        setPhase({ k: 'ready' });
        return;
      }
      if (started.status === 401) setPhase({ k: 'signed-out' });
      // 412 and 422 are things the buyer can act on — an unverified account, an
      // empty cart, a supply point that stopped selling. They are not our fault
      // and they are not a crash, so they get their own state and their own
      // words rather than "something went wrong".
      else if (started.status === 412 || started.status === 422 || started.status === 409)
        setPhase({ k: 'refused', message: problem(started) });
      else setPhase({ k: 'error', message: problem(started) });
    })();

    return () => {
      live = false;
    };
  }, [land]);

  /* ------------------------------------------------------------- re-quote */

  /**
   * Every step that changes the money re-quotes before the buyer moves on, so
   * the split and the total on the confirm step are the ones this selection
   * produces — not the ones the previous selection did.
   */
  const requote = React.useCallback(
    async (selection: Partial<Record<string, string>>): Promise<boolean> => {
      const id = cartId.current;
      if (!id) return false;
      setBusy('quote');
      const next = await quoteCheckout(id, {
        gstProfileId: gstProfileId ?? undefined,
        billingAddressId: billingAddressId ?? undefined,
        deliveryAddressId: deliveryAddressId ?? undefined,
        paymentMode: paymentMode ?? undefined,
        ...selection,
      });
      setBusy(null);
      if (next.ok) {
        setSession(next.data);
        return true;
      }
      if (next.status === 412) {
        setPhase({ k: 'expired' });
        return false;
      }
      setNotice(problem(next));
      return false;
    },
    [gstProfileId, billingAddressId, deliveryAddressId, paymentMode],
  );

  const onExpired = React.useCallback(() => setPhase({ k: 'expired' }), []);

  /* -------------------------------------------------------------- actions */

  const index = STEPS.findIndex((s) => s.code === step);

  const goNext = async (): Promise<void> => {
    setNotice(null);
    setFieldErrors({});

    if (step === 'BILLING') {
      if (!gstProfileId) {
        setFieldErrors({ gstProfileId: 'Choose the GSTIN this order should be billed to.' });
        return;
      }
      if (!billingAddressId) {
        setFieldErrors({ billingAddressId: 'Choose the address to bill this order to.' });
        return;
      }
      if (!(await requote({ gstProfileId, billingAddressId }))) return;
    }
    if (step === 'DELIVERY') {
      if (!deliveryAddressId) {
        setFieldErrors({ deliveryAddressId: 'Choose where these machines should be delivered.' });
        return;
      }
      if (!(await requote({ deliveryAddressId }))) return;
    }
    if (step === 'REFERENCE' && session?.poRequired && poNumber.trim().length === 0) {
      setFieldErrors({
        buyerPoNumber:
          'Your organisation requires a PO reference on every order. Enter the one your procurement system issued.',
      });
      return;
    }
    if (step === 'PAYMENT') {
      if (!paymentMode) {
        setFieldErrors({ paymentMode: 'Choose how you are paying for this order.' });
        return;
      }
      if (!(await requote({ paymentMode }))) return;
    }

    const next = STEPS[index + 1];
    if (next) setStep(next.code);
  };

  const goBack = (): void => {
    setNotice(null);
    setFieldErrors({});
    const previous = STEPS[index - 1];
    if (previous) setStep(previous.code);
  };

  /**
   * Why the order cannot be placed, in the buyer's words, or null.
   *
   * `Button` only puts `disabledReason` in a `title`, and `aria-disabled`
   * leaves the click handler live, so this is both the sentence the screen
   * prints and the guard `place()` checks. One reason, one place.
   */
  const blockedReason =
    session && session.breakUp?.grandTotal == null
      ? 'Delivery to that site cannot be priced, so there is no total to agree to. Go back and choose another site.'
      : null;

  const place = async (): Promise<void> => {
    const id = cartId.current;
    if (blockedReason) return;
    if (!id || !gstProfileId || !billingAddressId || !deliveryAddressId || !paymentMode) return;
    setNotice(null);
    setFieldErrors({});
    setBusy('confirm');
    const placed = await confirmCheckout(id, {
      gstProfileId,
      billingAddressId,
      deliveryAddressId,
      paymentMode,
      buyerPoNumber: poNumber.trim() || undefined,
      costCentre: costCentre.trim() || undefined,
    });
    setBusy(null);

    if (placed.ok) {
      setPhase({ k: 'placed', order: placed.data });
      // The order is now a resource with a URL, and that URL is the
      // confirmation screen (T17). Handing over rather than rendering a second
      // copy of it here means one screen tells a buyer what they bought — and it
      // is one they can bookmark, reload and send to their finance team, which a
      // component holding a function's return value never could be.
      window.location.assign(`/orders/${placed.data.orderNumber}`);
      return;
    }
    if (placed.status === 401) {
      setPhase({ k: 'signed-out' });
      return;
    }
    if (placed.fields) setFieldErrors(placed.fields);
    // A lost race, a supply point that went away, a lane that cannot be priced:
    // all of them are shown here, above the button, in the server's own words.
    setNotice(problem(placed));
  };

  const leave = async (): Promise<void> => {
    const id = cartId.current;
    if (id) await abandonCheckout(id);
    window.location.href = `/cart?cart=${id ?? ''}`;
  };

  /* --------------------------------------------------------------- render */

  if (phase.k === 'loading') return <CheckoutSkeleton />;
  if (phase.k === 'signed-out') return <SignedOut />;
  if (phase.k === 'refused') return <Refused message={phase.message} />;
  if (phase.k === 'error') return <Failed message={phase.message} />;
  if (phase.k === 'expired') return <Expired cartId={cartId.current} />;
  if (phase.k === 'placed') return <Placed order={phase.order} />;
  if (!session) return <CheckoutSkeleton />;

  /**
   * A completed step shows what it established, so the confirm step is not the
   * first place a buyer can check that they picked the right GSTIN. The GSTIN is
   * shown in full because it is a business identifier the buyer typed and has to
   * verify; the delivery contact's mobile is not repeated here.
   */
  const summaries: Partial<Record<StepCode, React.ReactNode>> = {
    REVIEW: `${machines(session.unitsHeld)} held`,
    BILLING: session.gstProfiles.find((g) => g.id === gstProfileId)?.gstin,
    DELIVERY: (() => {
      const site = session.deliverySites.find((d) => d.id === deliveryAddressId);
      return site ? `${site.city} ${site.pincode}` : undefined;
    })(),
    REFERENCE: poNumber.trim() || 'No PO reference',
    PAYMENT: session.paymentModes.find((m) => m.mode === paymentMode)?.label,
  };

  const rail: Step[] = STEPS.map((s, i) => ({
    key: s.code,
    label: s.title,
    status: i < index ? 'complete' : i === index ? 'current' : 'upcoming',
    summary: i < index ? summaries[s.code] : undefined,
  }));

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      {/* --- the step rail ------------------------------------------------ */}
      <div className="lg:contents">
        <details className="rounded-lg border border-rule bg-sheet lg:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 text-body-sm font-medium text-ink">
            {STEPS[index]!.title}
            <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Step <span className="tnum">{index + 1}</span> of{' '}
              <span className="tnum">{STEPS.length}</span>
            </span>
            <span className="ml-auto text-body-sm text-acc-ink">All steps</span>
          </summary>
          <div className="border-t border-rule-2 p-4">
            <StepRail steps={rail} label="Checkout" className="checkoutrail static max-h-none" />
            <HoldNote />
          </div>
        </details>
        <div className="flex flex-col gap-3 max-lg:hidden">
          <StepRail steps={rail} label="Checkout" className="checkoutrail" />
          <HoldNote />
        </div>
      </div>

      {/* --- the one step ------------------------------------------------- */}
      <main className="flex flex-col gap-5 lg:max-w-[74ch]">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Step <span className="tnum">{index + 1}</span> of{' '}
              <span className="tnum">{STEPS.length}</span>
            </span>
            <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              <span className="tnum">{session.unitsHeld}</span> held
            </span>
          </div>
          <h1 className="text-h1 text-ink">{STEPS[index]!.title}</h1>
          <p className="max-w-[64ch] text-body-sm text-ink-2">
            One order and one invoice, from {BRAND.legalEntity} We buy these exact machines on your
            behalf and they ship to you.
          </p>
        </header>

        {notice && (
          <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
            {notice}
          </p>
        )}

        {step === 'REVIEW' && <ReviewStep session={session} />}
        {step === 'BILLING' && (
          <BillingStep
            session={session}
            gstProfileId={gstProfileId}
            billingAddressId={billingAddressId}
            errors={fieldErrors}
            onGst={setGst}
            onBilling={setBilling}
          />
        )}
        {step === 'DELIVERY' && (
          <DeliveryStep
            session={session}
            deliveryAddressId={deliveryAddressId}
            errors={fieldErrors}
            onSelect={(id) => {
              setDelivery(id);
              void requote({ deliveryAddressId: id });
            }}
          />
        )}
        {step === 'REFERENCE' && (
          <ReferenceStep
            session={session}
            poNumber={poNumber}
            costCentre={costCentre}
            errors={fieldErrors}
            onPo={setPoNumber}
            onCostCentre={setCostCentre}
          />
        )}
        {step === 'PAYMENT' && (
          <PaymentStep
            session={session}
            paymentMode={paymentMode}
            errors={fieldErrors}
            onSelect={setPaymentMode}
          />
        )}
        {step === 'CONFIRM' && (
          <ConfirmStep
            session={session}
            gstProfileId={gstProfileId}
            deliveryAddressId={deliveryAddressId}
            paymentMode={paymentMode}
            poNumber={poNumber}
          />
        )}

        {/* --- the one primary action on the screen ------------------------ */}
        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
          {index > 0 && (
            <Button variant="ghost" onClick={goBack} disabled={busy !== null}>
              Back
            </Button>
          )}
          {step === 'CONFIRM' ? (
            <Button
              variant="primary"
              loading={busy === 'confirm'}
              onClick={() => void place()}
              disabledReason={blockedReason ?? undefined}
            >
              {session.approval ? 'Send for approval' : 'Place this order'}
            </Button>
          ) : (
            <Button variant="primary" loading={busy === 'quote'} onClick={() => void goNext()}>
              Continue
            </Button>
          )}
          <button
            type="button"
            className="text-body-sm text-ink-3 underline underline-offset-2 hover:text-ink"
            onClick={() => void leave()}
          >
            Leave checkout and release the hold
          </button>
        </div>
        {/* `Button`'s `disabledReason` reaches a pointer as a `title` tooltip and
            nothing else — unreachable by touch and by keyboard, which is the
            exact failure the payment step refuses one line below. So the reason
            is said on the screen as well. */}
        {step === 'CONFIRM' && blockedReason && (
          <p className="text-body-sm text-ink-3">{blockedReason}</p>
        )}
      </main>

      {/* --- the why rail, the countdown and the money -------------------- */}
      <aside className="flex flex-col gap-4 max-xl:static lg:col-span-2 xl:col-span-1">
        <Countdown expiresAt={session.holdExpiresAt} onExpired={onExpired} />
        <BreakUpPanel breakUp={session.breakUp} />
        <WhyRail items={whyFor(step, session)} className="static max-h-none" />
      </aside>
    </div>
  );
}

/**
 * What the rail would otherwise say, made true.
 *
 * `StepRail`'s save state is registration's, and it promises a draft this flow
 * never writes. Checkout holds machines for twenty minutes and saves nothing;
 * a buyer who closes the tab loses the hold, not a form. Saying so is the whole
 * reason the component's own sentence is hidden rather than left to read
 * plausibly and wrongly.
 */
function HoldNote(): React.JSX.Element {
  return (
    <p className="text-label text-ink-3">
      Nothing here is saved as a draft. The machines are held for{' '}
      <span className="font-mono tnum">20</span> minutes from the moment you started, and closing
      this tab releases them.
    </p>
  );
}

/* ==========================================================================
 * Step 1 — review
 * ======================================================================== */

function ReviewStep({ session }: { session: CheckoutSession }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-5" aria-label="What is held for you">
      <p className="text-body-sm text-ink-2">
        These are the exact machines held for you — by serial number, not by model. Nobody else can
        buy them while the hold runs.
      </p>
      {session.lines.map((line) => (
        <article key={line.offerId} className="rounded-lg border border-rule bg-sheet p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-h3 text-ink">{line.title}</h2>
              <p className="font-mono text-label text-ink-3">{line.specSummary}</p>
            </div>
            <p className="font-mono text-data tnum text-ink">
              {rupees(line.lineTotal)}
              <span className="block text-label font-normal text-ink-4">
                <span className="tnum">{line.qty}</span> × {rupees(line.unitPrice)}
              </span>
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {isGrade(line.grade) ? (
              <GradeBadge grade={line.grade} />
            ) : (
              <span className="font-mono text-label text-ink-4">Grade not recorded</span>
            )}
            <span className="font-mono text-label text-ink-3">{line.dispatchPoint}</span>
          </div>
          <dl className="mt-3 border-t border-rule-2 pt-3">
            <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Serial numbers held <span className="tnum">({line.serials.length})</span>
            </dt>
            <dd className="mt-2 flex flex-wrap gap-2">
              {line.serials.map((serial) => (
                <a
                  key={serial}
                  href={`/unit/${serial}`}
                  className="rounded border border-rule bg-sheet-2 px-2 py-1 font-mono text-label tnum text-ink-2 hover:text-ink"
                >
                  {serial}
                </a>
              ))}
            </dd>
          </dl>
        </article>
      ))}
    </section>
  );
}

/* ==========================================================================
 * Step 2 — GSTIN and billing
 * ======================================================================== */

function BillingStep({
  session,
  gstProfileId,
  billingAddressId,
  errors,
  onGst,
  onBilling,
}: {
  session: CheckoutSession;
  gstProfileId: string | null;
  billingAddressId: string | null;
  errors: Record<string, string>;
  onGst: (id: string) => void;
  onBilling: (id: string) => void;
}): React.JSX.Element {
  if (session.gstProfiles.length === 0) {
    return (
      <EmptyState
        title="No GSTIN on your account yet"
        body="We invoice a registered business, so we need the GSTIN this order should be billed to. Add one in Account → Tax details and come straight back — the hold is still running."
        action={
          <a className="pill acc" href="/account/tax">
            Add a GSTIN
          </a>
        }
      />
    );
  }

  return (
    <section className="flex flex-col gap-5" aria-label="GSTIN and billing">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-h3 text-ink">Bill this order to</legend>
        <p className="text-body-sm text-ink-2">
          This decides the entity on the invoice and the input credit you can claim. It does{' '}
          <b>not</b> decide whether the tax is IGST or CGST + SGST — that follows where the machines
          are delivered, which is the next step.
        </p>
        {session.gstProfiles.map((profile) => (
          <label
            key={profile.id}
            className={
              profile.id === gstProfileId
                ? 'flex cursor-pointer gap-3 rounded border border-acc bg-sheet-2 p-4'
                : 'flex cursor-pointer gap-3 rounded border border-rule bg-sheet p-4'
            }
          >
            <input
              type="radio"
              name="gstProfileId"
              className="mt-1"
              value={profile.id}
              checked={profile.id === gstProfileId}
              onChange={() => onGst(profile.id)}
            />
            <span className="flex flex-col gap-1">
              <span className="font-mono text-data tnum text-ink">{profile.gstin}</span>
              <span className="text-body-sm text-ink-2">{profile.legalName}</span>
              <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                {profile.registrationType}
                {profile.isPrimary ? ' · primary' : ''}
              </span>
            </span>
          </label>
        ))}
        {errors.gstProfileId && (
          <p role="alert" className="text-body-sm text-fail">
            {errors.gstProfileId}
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-h3 text-ink">Billing address</legend>
        {session.billingAddresses.map((address) => (
          <SiteRadio
            key={address.id}
            name="billingAddressId"
            site={address}
            checked={address.id === billingAddressId}
            onSelect={onBilling}
            detail={false}
          />
        ))}
        {errors.billingAddressId && (
          <p role="alert" className="text-body-sm text-fail">
            {errors.billingAddressId}
          </p>
        )}
      </fieldset>
    </section>
  );
}

/* ==========================================================================
 * Step 3 — delivery site
 * ======================================================================== */

function DeliveryStep({
  session,
  deliveryAddressId,
  errors,
  onSelect,
}: {
  session: CheckoutSession;
  deliveryAddressId: string | null;
  errors: Record<string, string>;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const chosen = session.deliverySites.find((s) => s.id === deliveryAddressId) ?? null;

  if (session.deliverySites.length === 0) {
    return (
      <EmptyState
        title="No delivery site on your account yet"
        body="Add the site these machines should be delivered to, with the person who will receive them. A B2B delivery that arrives at a closed loading dock is a failed delivery, so the contact and the gate note matter."
        action={
          <a className="pill acc" href="/account/addresses">
            Add a delivery site
          </a>
        }
      />
    );
  }

  return (
    <section className="flex flex-col gap-5" aria-label="Delivery site">
      <p className="text-body-sm text-ink-2">
        Where the machines are delivered decides the tax split — the place of supply under s.10(1)(a)
        is where the movement terminates, not where you are registered. The split is shown on the
        right the moment you choose.
      </p>
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Choose a delivery site</legend>
        {session.deliverySites.map((site) => (
          <SiteRadio
            key={site.id}
            name="deliveryAddressId"
            site={site}
            checked={site.id === deliveryAddressId}
            onSelect={onSelect}
            detail
          />
        ))}
      </fieldset>
      {errors.deliveryAddressId && (
        <p role="alert" className="text-body-sm text-fail">
          {errors.deliveryAddressId}
        </p>
      )}
      {chosen && <ReceivingDetails site={chosen} />}
    </section>
  );
}

function SiteRadio({
  name,
  site,
  checked,
  onSelect,
  detail,
}: {
  name: string;
  site: DeliverySite;
  checked: boolean;
  onSelect: (id: string) => void;
  detail: boolean;
}): React.JSX.Element {
  return (
    <label
      className={
        checked
          ? 'flex cursor-pointer gap-3 rounded border border-acc bg-sheet-2 p-4'
          : 'flex cursor-pointer gap-3 rounded border border-rule bg-sheet p-4'
      }
    >
      <input
        type="radio"
        name={name}
        className="mt-1"
        value={site.id}
        checked={checked}
        onChange={() => onSelect(site.id)}
      />
      <span className="flex flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="text-body-sm font-medium text-ink">{site.label ?? site.city}</span>
          {site.isDefault && <StatusPill tone="neutral" label="Default" />}
        </span>
        <span className="text-body-sm text-ink-2">
          {site.line1}
          {site.line2 ? `, ${site.line2}` : ''}, {site.city}, {site.state}{' '}
          <span className="font-mono tnum">{site.pincode}</span>
        </span>
        {detail && (
          <span className="text-label text-ink-3">
            {site.contactName} · <span className="font-mono tnum">{site.contactMobile}</span>
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * What the driver needs, and — just as importantly — what we do not know.
 *
 * A missing value never renders as a passing one. There is no receiving-hours
 * column on `identity.org_address`, so this says "Not recorded" in `--ink-4`
 * rather than showing a plausible window nobody entered. A delivery attempted
 * against invented hours is a failed delivery, and `delivery_attempt.outcome`
 * has a code for exactly that.
 */
function ReceivingDetails({ site }: { site: DeliverySite }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-rule bg-sheet p-4">
      <h3 className="text-h3 text-ink">Receiving at {site.label ?? site.city}</h3>
      <dl className="mt-3 flex flex-col gap-2">
        <Fact label="Contact" value={site.contactName} />
        <Fact label="Mobile" value={site.contactMobile} mono />
        <Fact label="Landmark" value={site.landmark} />
        <Fact label="Gate and dock" value={site.gateInstructions} />
        <Fact label="Receiving hours" value={site.receivingHours} />
      </dl>
      <p className="mt-3 text-label text-ink-3">
        Anything missing here can be added in Account → Addresses. Receiving hours are not something
        we hold yet, so the carrier will call the contact above before arriving.
      </p>
    </div>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-body-sm text-ink-3">{label}</dt>
      <dd
        className={
          value === null
            ? 'text-body-sm text-ink-4'
            : mono
              ? 'font-mono text-data tnum text-ink'
              : 'text-body-sm text-ink'
        }
      >
        {value ?? 'Not recorded'}
      </dd>
    </div>
  );
}

/* ==========================================================================
 * Step 4 — the buyer's own PO reference
 * ======================================================================== */

function ReferenceStep({
  session,
  poNumber,
  costCentre,
  errors,
  onPo,
  onCostCentre,
}: {
  session: CheckoutSession;
  poNumber: string;
  costCentre: string;
  errors: Record<string, string>;
  onPo: (v: string) => void;
  onCostCentre: (v: string) => void;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-5" aria-label="Your purchase-order reference">
      <p className="text-body-sm text-ink-2">
        This is <b>your</b> reference, from your own procurement system. It prints on our invoice, so
        your finance team can match it. It is not a purchase order we raise.
      </p>
      {/* `Input`, not a hand-rolled field: it owns the label/hint/error wiring,
          the focus ring and the mono branch, and a second copy of those in an
          app is how the two drift. `mono` because a PO reference is an
          identifier that gets read back digit by digit against an invoice. */}
      <Input
        id="po"
        label="PO reference"
        mono
        required={session.poRequired}
        value={poNumber}
        maxLength={40}
        placeholder="PO/2026/00417"
        hint={
          session.poRequired
            ? 'Your organisation requires one on every order. Up to 40 characters, because it has to fit on the invoice.'
            : 'Optional for your organisation. Up to 40 characters, because it has to fit on the invoice.'
        }
        error={errors.buyerPoNumber}
        onChange={(e) => onPo(e.target.value)}
      />

      <Input
        id="cc"
        label="Cost centre"
        value={costCentre}
        maxLength={60}
        placeholder="IT — Delhi office"
        hint="Optional. Carried to the invoice so a rollout across departments can be split afterwards."
        onChange={(e) => onCostCentre(e.target.value)}
      />
    </section>
  );
}

/* ==========================================================================
 * Step 5 — payment mode
 * ======================================================================== */

function PaymentStep({
  session,
  paymentMode,
  errors,
  onSelect,
}: {
  session: CheckoutSession;
  paymentMode: PaymentMode | null;
  errors: Record<string, string>;
  onSelect: (mode: PaymentMode) => void;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-5" aria-label="How you are paying">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Choose a payment method</legend>
        {session.paymentModes.map((option) => (
          <label
            key={option.mode}
            className={
              !option.allowed
                ? 'flex gap-3 rounded border border-rule-2 bg-sheet-2 p-4 opacity-80'
                : option.mode === paymentMode
                  ? 'flex cursor-pointer gap-3 rounded border border-acc bg-sheet-2 p-4'
                  : 'flex cursor-pointer gap-3 rounded border border-rule bg-sheet p-4'
            }
          >
            <input
              type="radio"
              name="paymentMode"
              className="mt-1"
              value={option.mode}
              disabled={!option.allowed}
              checked={option.mode === paymentMode}
              onChange={() => onSelect(option.mode)}
            />
            <span className="flex flex-col gap-1">
              <span className="text-body-sm font-medium text-ink">{option.label}</span>
              {/* A control that is off says why, on the screen — not in a title
                  attribute, which is unreachable by touch and by keyboard. */}
              {option.reason && <span className="text-body-sm text-ink-3">{option.reason}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      {errors.paymentMode && (
        <p role="alert" className="text-body-sm text-fail">
          {errors.paymentMode}
        </p>
      )}
    </section>
  );
}

/* ==========================================================================
 * Step 6 — confirm
 * ======================================================================== */

function ConfirmStep({
  session,
  gstProfileId,
  deliveryAddressId,
  paymentMode,
  poNumber,
}: {
  session: CheckoutSession;
  gstProfileId: string | null;
  deliveryAddressId: string | null;
  paymentMode: PaymentMode | null;
  poNumber: string;
}): React.JSX.Element {
  const gst = session.gstProfiles.find((g) => g.id === gstProfileId) ?? null;
  const site = session.deliverySites.find((s) => s.id === deliveryAddressId) ?? null;
  const mode = session.paymentModes.find((m) => m.mode === paymentMode) ?? null;
  const tax = session.breakUp?.tax;
  /** No total means no priced lane, which means nothing was actually split. */
  const priced = session.breakUp?.grandTotal != null;

  return (
    <section className="flex flex-col gap-5" aria-label="Confirm">
      {session.approval && (
        <div className="rounded-lg border border-rule bg-sheet-2 p-4">
          <StatusPill tone="warn" label="Needs approval" />
          <p className="mt-2 text-body-sm text-ink">{session.approval.reason}</p>
          <p className="mt-2 text-body-sm text-ink-2">
            Placing it sends it to <b>{session.approval.approverName}</b>. These exact machines stay
            held for you while they decide, nothing is charged, and no supplier is committed until
            they approve. If nobody answers within{' '}
            <span className="font-mono tnum">24</span> hours the hold releases and the machines go
            back on sale.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-rule bg-sheet p-4">
        <h2 className="text-h3 text-ink">What you are agreeing to</h2>
        <dl className="mt-3 flex flex-col gap-2">
          <Fact label="Machines" value={machines(session.unitsHeld)} />
          <Fact label="Billed to" value={gst ? `${gst.legalName} · ${gst.gstin}` : null} />
          <Fact
            label="Delivered to"
            value={site ? `${site.label ?? site.city}, ${site.city} ${site.pincode}` : null}
          />
          {/* An optional field left blank is not a value we failed to record.
              "Not recorded" is the sentence for receiving hours — a thing we
              should hold and do not — and using it here would read as a gap. */}
          <Fact
            label="Your PO reference"
            value={poNumber.trim() || 'None — your organisation does not require one'}
          />
          <Fact label="Paying by" value={mode?.label ?? null} />
        </dl>
      </div>

      {/* A split we could not resolve is never drawn as one that came out at
          zero. With no priced lane there is no taxable value, and rendering
          "CGST ₹0.00 · SGST ₹0.00" would be both a missing value shown as a
          settled one AND the wrong pair of heads: 06 against 29 is inter-state
          and could only ever be IGST. */}
      {tax && !priced && (
        <div className="rounded-lg border border-rule bg-sheet p-4">
          <h2 className="text-h3 text-ink">The tax split is not resolved yet</h2>
          <p className="mt-2 text-body-sm text-ink-2">
            The place of supply is {tax.placeOfSupplyState} (
            <span className="font-mono tnum">{tax.placeOfSupplyStateCode}</span>) against our
            registration in state <span className="font-mono tnum">{tax.ourStateCode}</span>, so this
            would be{' '}
            {tax.ourStateCode === tax.placeOfSupplyStateCode
              ? 'CGST and SGST'
              : 'IGST'}{' '}
            — but we cannot deliver there, so there is no taxable value to split and no total to
            agree to. Choose a site we can reach and the resolved split appears here.
          </p>
          <p className="mt-3 text-body-sm text-ink-4">Not resolved</p>
        </div>
      )}

      {tax && priced && (
        <div className="rounded-lg border border-rule bg-sheet p-4">
          <h2 className="text-h3 text-ink">The tax split on this order</h2>
          <p className="mt-2 text-body-sm text-ink-2">
            Resolved from our registration in state{' '}
            <span className="font-mono tnum">{tax.ourStateCode}</span> against the place of supply,{' '}
            {tax.placeOfSupplyState} (<span className="font-mono tnum">{tax.placeOfSupplyStateCode}</span>
            ). Check it before you confirm — after this there is an invoice.
          </p>
          <p className="mt-3 font-mono text-data text-ink">
            {tax.interState ? (
              <>
                IGST at <span className="tnum">{tax.ratePct}%</span> —{' '}
                <span className="tnum">{rupees(tax.igst)}</span>
              </>
            ) : (
              <>
                CGST at <span className="tnum">{tax.ratePct / 2}%</span> —{' '}
                <span className="tnum">{rupees(tax.cgst)}</span>
                {' · '}
                {tax.stateTaxLabel} at <span className="tnum">{tax.ratePct / 2}%</span> —{' '}
                <span className="tnum">{rupees(tax.sgst)}</span>
              </>
            )}
          </p>
          <p className="mt-2 text-label text-ink-3">{tax.basis}</p>
        </div>
      )}

      <p className="text-body-sm text-ink-2">
        {BRAND.legalEntity} is the seller on this order. We buy these exact serial numbers on your
        behalf and invoice you for them; there is one invoice and one seller.{' '}
        {priced
          ? 'Placing the order is your agreement to the total on the right — nothing is added to it afterwards.'
          : 'There is no total to agree to until we can price delivery, so this order cannot be placed as it stands.'}
      </p>
    </section>
  );
}

/* ==========================================================================
 * The money, in full, on every step
 * ======================================================================== */

/**
 * The whole break-up, on screen from the first step to the last.
 *
 * Not progressive: goods, freight and each GST head are visible together, and
 * `PriceBreakup` computes the total from the lines so the figure cannot disagree
 * with what is above it. Revealing a charge only at the end is drip pricing,
 * which the CCPA Dark Patterns Guidelines 2023 name outright.
 */
function BreakUpPanel({ breakUp }: { breakUp: BreakUp | null }): React.JSX.Element {
  if (!breakUp) {
    return (
      <div className="rounded-lg border border-rule bg-sheet-2 p-4">
        <h2 className="text-h3 text-ink">What this costs</h2>
        <p className="mt-2 text-body-sm text-ink-2">
          Freight and the GST split need a delivery site. Choose one and the whole break-up —
          goods, freight, tax by head and the total — appears here. There is no third charge.
        </p>
      </div>
    );
  }

  if (breakUp.freight === null || breakUp.grandTotal === null) {
    return (
      <div className="rounded-lg border border-fail bg-sheet-2 p-4" role="status">
        <h2 className="text-h3 text-ink">We cannot price delivery to that site</h2>
        <dl className="mt-2 flex items-baseline justify-between gap-4">
          <dt className="text-body-sm text-ink-2">Goods</dt>
          <dd className="font-mono text-data tnum text-ink-2">{rupees(breakUp.goods)}</dd>
        </dl>
        <dl className="mt-1 flex items-baseline justify-between gap-4">
          <dt className="text-body-sm text-ink-2">Freight</dt>
          {/* Never a zero standing in for "we could not price it": that is a
              price misrepresentation under CP e-Comm r.6(5). */}
          <dd className="text-body-sm text-ink-4">Not priced</dd>
        </dl>
        <p className="mt-3 text-body-sm text-ink-2">{breakUp.freightUnpricedReason}</p>
      </div>
    );
  }

  const lines: PriceLine[] = [
    { label: 'Machines', amount: Money.parse(breakUp.goods) },
    { label: 'Freight', amount: Money.parse(breakUp.freight), note: 'to your delivery pincode' },
  ];
  if (breakUp.tax.interState) {
    lines.push({
      label: `IGST ${breakUp.tax.ratePct}%`,
      amount: Money.parse(breakUp.tax.igst),
    });
  } else {
    lines.push({
      label: `CGST ${breakUp.tax.ratePct / 2}%`,
      amount: Money.parse(breakUp.tax.cgst),
    });
    lines.push({
      label: `${breakUp.tax.stateTaxLabel} ${breakUp.tax.ratePct / 2}%`,
      amount: Money.parse(breakUp.tax.sgst),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-h3 text-ink">What this costs</h2>
      <PriceBreakup
        lines={lines}
        valuationMethod="REGULAR"
        taxNote={
          <>
            Every charge on this order is here. Nothing is added at the end.{' '}
            {breakUp.tax.interState
              ? 'Inter-state supply, so the whole tax is IGST.'
              : `Intra-state supply, so it splits into CGST and ${breakUp.tax.stateTaxLabel}.`}
          </>
        }
      />
    </div>
  );
}

/* ==========================================================================
 * The why rail
 * ======================================================================== */

function whyFor(step: StepCode, session: CheckoutSession): WhyRailItem[] {
  switch (step) {
    case 'REVIEW':
      return [
        {
          term: 'Why serial numbers',
          explanation: 'Every machine here has been opened, tested and graded, and these are the exact ones held for you. Not "an A-grade of this model" — these ones. Each serial links to its own inspection report.',
        },
        {
          term: 'Why a hold at all',
          explanation: 'Nothing in a cart is reserved. From the moment you started checkout these machines are off sale to everyone else, for twenty minutes, so the price and the stock you are looking at cannot move underneath you.',
        },
      ];
    case 'BILLING':
      return [
        {
          term: 'Why the GSTIN matters',
          explanation: 'It decides the legal entity on the invoice and the input tax credit you can claim. A wrong one is expensive to correct after an invoice exists and free to change now.',
        },
        {
          term: 'It does not decide the tax head',
          explanation: 'IGST versus CGST + SGST follows where the goods are delivered — s.10(1)(a) puts the place of supply where the movement terminates — not where you are registered.',
        },
      ];
    case 'DELIVERY':
      return [
        {
          term: 'Place of supply',
          explanation: 'The delivery state is what splits the tax. Choosing a site in our own state gives CGST + SGST; anywhere else gives IGST. The resolved split is on this screen before you confirm.',
        },
        {
          term: 'Gate and dock notes',
          explanation: 'A pallet that arrives at a closed loading dock is a failed delivery and a second freight charge. The contact and the gate note go to the driver.',
        },
      ];
    case 'REFERENCE':
      return [
        {
          term: 'Your PO reference',
          explanation: session.poRequired
            ? 'Your organisation has set this as required. It prints on our invoice so your finance team can match it against your own purchase order.'
            : 'Optional here. It prints on our invoice, and many Indian corporates will not process one without it.',
        },
        {
          term: 'Cost centre',
          explanation: 'Carried through to the invoice and your order history, so a rollout across three departments can be split afterwards.',
        },
      ];
    case 'PAYMENT':
      return [
        {
          term: 'Why some are off',
          explanation: 'Payment methods come from your organisation and from your own buying policy. A junior buyer can often pay now but not draw on the company credit line — the reason is on each one.',
        },
      ];
    case 'CONFIRM':
      return [
        {
          term: 'Who you are buying from',
          explanation: `${BRAND.legalEntity} is the seller. We buy these serial numbers on your behalf and invoice you. One seller, one invoice, whatever number of warehouses they leave from.`,
        },
        {
          term: 'What happens next',
          explanation: session.approval
            ? 'It goes to your approver. The machines stay held, nothing is charged, and no supplier is committed until they say yes.'
            : 'The serial numbers become yours, we raise the purchase orders, and the machines are picked and dispatched.',
        },
      ];
    default:
      return [];
  }
}

/* ==========================================================================
 * The states that are not a step
 * ======================================================================== */

export function CheckoutSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      <Skeleton className="h-64 w-full rounded-lg" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-2/3 rounded" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
      <Skeleton className="h-56 w-full rounded-lg" />
    </div>
  );
}

function SignedOut(): React.JSX.Element {
  const next =
    typeof window === 'undefined'
      ? '/checkout'
      : `${window.location.pathname}${window.location.search}`;
  return (
    <EmptyState
      title="Sign in to check out"
      body="An order belongs to your organisation, so we need to know who is placing it. Signing in brings you straight back here with your cart intact — nothing has been held yet."
      action={
        <a className="pill acc" href={`/sign-in?next=${encodeURIComponent(next)}`}>
          Sign in
        </a>
      }
    />
  );
}

/** Something the buyer can act on. Not our failure, and not a crash. */
function Refused({ message }: { message: string }): React.JSX.Element {
  return (
    <EmptyState
      title="Checkout cannot start yet"
      body={message}
      action={
        <a className="pill acc" href="/cart">
          Back to your cart
        </a>
      }
    />
  );
}

function Expired({ cartId }: { cartId: string | null }): React.JSX.Element {
  return (
    <EmptyState
      title="The hold ran out"
      body="Those machines have gone back on sale, and nothing has been ordered or charged. Your cart is untouched — start checkout again and we will hold whatever is still there."
      action={
        <a className="pill acc" href={`/checkout?cart=${cartId ?? ''}`}>
          Start checkout again
        </a>
      }
    />
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="empty err" role="alert">
      <h3>We could not open checkout</h3>
      <p>{message}</p>
      <p>Nothing has been ordered, nothing has been charged, and your cart is unchanged.</p>
      <p className="retry">
        <button type="button" className="pill acc" onClick={() => window.location.reload()}>
          Try again
        </button>
      </p>
    </div>
  );
}

/**
 * The order exists, and its own screen is `/orders/{orderNumber}` (T17).
 *
 * `place()` navigates there the moment the transaction commits, so this is only
 * ever on screen for the instant the browser takes to follow — and it is what a
 * buyer sees if that navigation is blocked or slow, which is why it carries the
 * order number and a link rather than a spinner. There is deliberately no second
 * rendering of the serials and the money here: two screens describing one order
 * is two places for them to disagree.
 */
function Placed({ order }: { order: OrderConfirmation }): React.JSX.Element {
  return (
    <div className="flex max-w-[74ch] flex-col gap-4" role="status">
      <StatusPill
        tone={order.status === 'AWAITING_APPROVAL' ? 'warn' : 'neutral'}
        label={order.status === 'AWAITING_APPROVAL' ? 'Awaiting approval' : 'Order placed'}
      />
      <h1 className="text-h1 text-ink">
        Order <span className="font-mono tnum">{order.orderNumber}</span>
      </h1>
      <p className="text-body-sm text-ink-2">Opening your order…</p>
      <p>
        <a className="pill acc" href={`/orders/${order.orderNumber}`}>
          Open order {order.orderNumber}
        </a>
      </p>
    </div>
  );
}
