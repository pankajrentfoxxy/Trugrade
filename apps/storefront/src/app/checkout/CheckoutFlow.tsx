'use client';

import * as React from 'react';
import {
  Button,
  EmptyState,
  Input,
  PriceBreakup,
  Skeleton,
  StatusPill,
  StepRail,
  ToastProvider,
  WhyRail,
  useToast,
  type PriceLine,
  type Step,
  type WhyRailItem,
} from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import { Money } from '@trugrade/contracts';
import { setSessionLostHandler, type ApiFailure } from '../register/api';
import { HoldCard, useHold } from './Countdown';
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
 *
 * The screen is drawn in the supplied checkout design's language — Archivo,
 * the promo amber, 14–16px radii — on the product's own surfaces. Every class
 * below is `ck-*` and lives in `storefront.css`; the palette is the `.ck` block
 * there, which maps the design's cream onto `--sheet` / `--ink` so the page
 * flips with the theme like every other working surface.
 */

/* ==========================================================================
 * The five steps
 * ======================================================================== */

const STEPS = [
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

const machines = (n: number): string => `${n} machine${n === 1 ? '' : 's'}`;

const units = (n: number): string => `${n} unit${n === 1 ? '' : 's'}`;

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

/**
 * The toast is the "tax head just changed" note when a delivery site is
 * picked. The provider is mounted here because the storefront's root layout
 * has none — the portal shell has its own.
 */
export function CheckoutFlow(): React.JSX.Element {
  return (
    <ToastProvider>
      <Flow />
    </ToastProvider>
  );
}

function Flow(): React.JSX.Element {
  const toast = useToast();
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [session, setSession] = React.useState<CheckoutSession | null>(null);
  const [step, setStep] = React.useState<StepCode>('BILLING');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const [gstProfileId, setGst] = React.useState<string | null>(null);
  const [billingAddressId, setBilling] = React.useState<string | null>(null);
  const [deliveryAddressId, setDelivery] = React.useState<string | null>(null);
  const [paymentMode, setPaymentMode] = React.useState<PaymentMode | null>(null);
  const [poNumber, setPoNumber] = React.useState('');
  const [costCentre, setCostCentre] = React.useState('');
  /** The furthest step reached. Completed steps are clickable back to. */
  const [reached, setReached] = React.useState(0);

  const cartId = React.useRef<string | null>(null);

  const land = React.useCallback((next: CheckoutSession) => {
    setSession(next);
    setGst((v) => v ?? next.selection.gstProfileId);
    setBilling((v) => v ?? next.selection.billingAddressId);
    setDelivery((v) => v ?? next.selection.deliveryAddressId);
    setPaymentMode((v) => v ?? (next.selection.paymentMode as PaymentMode | null));
  }, []);

  const onExpired = React.useCallback(() => setPhase({ k: 'expired' }), []);
  const hold = useHold(
    phase.k === 'ready' && session ? session.holdExpiresAt : null,
    onExpired,
  );

  /* ---------------------------------------------------------------- boot */

  React.useEffect(() => {
    let live = true;
    const id = cartIdFromUrl();
    cartId.current = id;

    // Checkout is outside the portal shell, so nothing else registers the
    // session-lost handler — and without one, `call` never settles a dead
    // session's request and the skeleton stays on screen for good. Here, a
    // lost session is the signed-out state, which has its own path in.
    setSessionLostHandler(() => {
      if (live) setPhase({ k: 'signed-out' });
    });

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
    async (selection: Partial<Record<string, string>>): Promise<CheckoutSession | null> => {
      const id = cartId.current;
      if (!id) return null;
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
        return next.data;
      }
      if (next.status === 412) {
        setPhase({ k: 'expired' });
        return null;
      }
      setNotice(problem(next));
      return null;
    },
    [gstProfileId, billingAddressId, deliveryAddressId, paymentMode],
  );

  /* -------------------------------------------------------------- actions */

  const index = STEPS.findIndex((s) => s.code === step);

  const goTo = (i: number): void => {
    const target = STEPS[i];
    if (!target) return;
    setNotice(null);
    setFieldErrors({});
    setStep(target.code);
    setReached((r) => Math.max(r, i));
    window.scrollTo({ top: 0 });
  };

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

    goTo(index + 1);
  };

  const goBack = (): void => goTo(index - 1);

  /** A delivery site was picked: re-quote now, and say what it did to the tax. */
  const chooseSite = async (id: string): Promise<void> => {
    setDelivery(id);
    const next = await requote({ deliveryAddressId: id });
    if (!next?.breakUp || next.breakUp.grandTotal === null) return;
    toast({
      tone: 'info',
      title: next.breakUp.tax.interState
        ? 'Inter-state — one IGST line'
        : `Intra-state — split into CGST + ${next.breakUp.tax.stateTaxLabel}`,
      durationMs: 2600,
    });
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
      window.scrollTo({ top: 0 });
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
    window.location.href = '/cart';
  };

  /* --------------------------------------------------------------- render */

  if (phase.k === 'loading') return <CheckoutSkeleton />;
  if (phase.k === 'signed-out') return <Terminal><SignedOut /></Terminal>;
  if (phase.k === 'refused') return <Terminal><Refused message={phase.message} /></Terminal>;
  if (phase.k === 'error') return <Terminal><Failed message={phase.message} /></Terminal>;
  if (phase.k === 'expired') return <Terminal><Expired cartId={cartId.current} /></Terminal>;
  if (phase.k === 'placed') {
    return (
      <Terminal>
        <Placed
          order={phase.order}
          paidBy={session?.paymentModes.find((m) => m.mode === paymentMode)?.label ?? null}
          site={session?.deliverySites.find((d) => d.id === deliveryAddressId) ?? null}
          poNumber={poNumber.trim()}
        />
      </Terminal>
    );
  }
  if (!session) return <CheckoutSkeleton />;

  /**
   * A completed step shows what it established, so the confirm step is not the
   * first place a buyer can check that they picked the right GSTIN. The GSTIN is
   * shown in full because it is a business identifier the buyer typed and has to
   * verify; the delivery contact's mobile is not repeated here.
   */
  const summaries: Partial<Record<StepCode, React.ReactNode>> = {
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
    // Only a step already passed through can be jumped back to; the rail is
    // navigation, not a shortcut past the validation each step carries.
    onNavigate: i < index && i <= reached ? () => goTo(i) : undefined,
  }));

  const title = STEPS[index]!.title;

  return (
    <div className="ck">
      <div className="ck-wrap">
        {/* --- the step rail ---------------------------------------------- */}
        <div className="ck-steps-slot">
          <details className="ck-steps-mobile">
            <summary className="ck-steps-sum">
              <span className="ck-steps-sum-n tnum">{String(index + 1).padStart(2, '0')}</span>
              <span className="ck-steps-sum-t">{title}</span>
              <span className="ck-steps-sum-k">
                Step <span className="tnum">{index + 1}</span> of{' '}
                <span className="tnum">{STEPS.length}</span>
              </span>
              <span className="ck-steps-sum-all">All steps</span>
            </summary>
            <div className="ck-steps-mobile-body">
              <StepRail steps={rail} label="Checkout" className="checkoutrail ck-steps inline" />
            </div>
          </details>
          <div className="ck-steps-desktop">
            <StepRail steps={rail} label="Checkout" className="checkoutrail ck-steps" />
          </div>
        </div>

        {/* --- the one step ------------------------------------------------- */}
        <main className="ck-main" id="content">
          <p className="ck-kicker">
            Step{' '}
            <b>
              <span className="tnum">{index + 1}</span> of <span className="tnum">{STEPS.length}</span>
            </b>{' '}
            · <span className="tnum">{session.unitsHeld}</span> held
          </p>
          <h1 className="ck-h1">{title}</h1>

          {notice && (
            <p role="alert" className="ck-notice">
              {notice}
            </p>
          )}

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
              onSelect={(id) => void chooseSite(id)}
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
              costCentre={costCentre}
            />
          )}

          {/* --- the one primary action on the screen ------------------------ */}
          <div className="ck-nav">
            {index > 0 && (
              <Button variant="ghost" className="ck-back" onClick={goBack} disabled={busy !== null}>
                Back
              </Button>
            )}
            {step === 'CONFIRM' ? (
              <Button
                variant="primary"
                className="ck-next"
                loading={busy === 'confirm'}
                onClick={() => void place()}
                disabledReason={blockedReason ?? undefined}
              >
                {session.approval ? 'Send for approval' : 'Place this order'}
              </Button>
            ) : (
              <Button
                variant="primary"
                className="ck-next"
                loading={busy === 'quote'}
                onClick={() => void goNext()}
              >
                Continue
              </Button>
            )}
            <button type="button" className="ck-leave" onClick={() => void leave()}>
              Leave checkout and release the hold
            </button>
          </div>
          {/* `Button`'s `disabledReason` reaches a pointer as a `title` tooltip and
              nothing else — unreachable by touch and by keyboard, which is the
              exact failure the payment step refuses one line below. So the reason
              is said on the screen as well. */}
          {step === 'CONFIRM' && blockedReason && <p className="ck-blocked">{blockedReason}</p>}
        </main>

        {/* --- the hold, the money and the why rail -------------------------- */}
        <aside className="ck-rail">
          <HoldCard hold={hold} />
          <BreakUpPanel
            breakUp={session.breakUp}
            unitsHeld={session.unitsHeld}
            site={session.deliverySites.find((d) => d.id === deliveryAddressId) ?? null}
          />
          <WhyRail items={whyFor(step, session)} className="ck-why static max-h-none" />
        </aside>
      </div>
    </div>
  );
}

/** The frame around every state that is not a step. */
function Terminal({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="ck">
      <main className="ck-terminal" id="content">
        {children}
      </main>
    </div>
  );
}

/* ==========================================================================
 * The option card — one radio, drawn as the design draws it
 * ======================================================================== */

/**
 * A real `<input type="radio">` under a drawn card: the input carries the
 * keyboard and screen-reader behaviour, the card carries the look. The ring is
 * the card's `::before`; the input itself is visually hidden, never `display:
 * none`, so it stays in the tab order.
 */
function Option({
  name,
  value,
  checked,
  disabled = false,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={`ck-opt${checked ? ' on' : ''}${disabled ? ' off' : ''}`}>
      <input
        type="radio"
        className="ck-opt-in"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      {children}
    </label>
  );
}

/* ==========================================================================
 * Step 1 — GSTIN and billing
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
        className="ck-empty"
        title="No GSTIN on your account yet"
        body="We invoice a registered business, so we need the GSTIN this order should be billed to. Add one in Account → Tax details and come straight back — the hold is still running."
        action={
          <a className="ck-btn" href="/profile">
            Add a GSTIN
          </a>
        }
      />
    );
  }

  return (
    <section className="ck-step" aria-label="GSTIN and billing">
      <p className="ck-lede">
        This sets the entity on the invoice and the input credit you claim. It does <b>not</b> set
        IGST vs CGST + SGST — the delivery site does that, next.
      </p>

      <fieldset className="ck-opts">
        <legend className="sr-only">Bill this order to</legend>
        {session.gstProfiles.map((profile) => (
          <Option
            key={profile.id}
            name="gstProfileId"
            value={profile.id}
            checked={profile.id === gstProfileId}
            onSelect={() => onGst(profile.id)}
          >
            <span className="ck-mono">{profile.gstin}</span>
            <b>{profile.legalName}</b>
            <small>
              {profile.registrationType.charAt(0) + profile.registrationType.slice(1).toLowerCase()}
              {profile.isPrimary ? ' · Primary' : ''}
            </small>
          </Option>
        ))}
      </fieldset>
      {errors.gstProfileId && (
        <p role="alert" className="ck-err">
          {errors.gstProfileId}
        </p>
      )}

      <p className="ck-flbl">Billing address</p>
      <fieldset className="ck-opts">
        <legend className="sr-only">Billing address</legend>
        {session.billingAddresses.map((address) => (
          <SiteOption
            key={address.id}
            name="billingAddressId"
            site={address}
            checked={address.id === billingAddressId}
            onSelect={onBilling}
            detail={false}
          />
        ))}
      </fieldset>
      {errors.billingAddressId && (
        <p role="alert" className="ck-err">
          {errors.billingAddressId}
        </p>
      )}
    </section>
  );
}

/* ==========================================================================
 * Step 2 — delivery site
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
        className="ck-empty"
        title="No delivery site on your account yet"
        body="Add the site these machines should be delivered to, with the person who will receive them. A B2B delivery that arrives at a closed loading dock is a failed delivery, so the contact and the gate note matter."
        action={
          <a className="ck-btn" href="/addresses">
            Add a delivery site
          </a>
        }
      />
    );
  }

  return (
    <section className="ck-step" aria-label="Delivery site">
      <fieldset className="ck-opts">
        <legend className="sr-only">Choose a delivery site</legend>
        {session.deliverySites.map((site) => (
          <SiteOption
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
        <p role="alert" className="ck-err">
          {errors.deliveryAddressId}
        </p>
      )}
      {chosen && <ReceivingDetails site={chosen} />}
    </section>
  );
}

function SiteOption({
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
    <Option name={name} value={site.id} checked={checked} onSelect={() => onSelect(site.id)}>
      <b>{site.label ?? site.city}</b>
      {site.isDefault && <span className="ck-tag">Default</span>}
      <small>
        {site.line1}
        {site.line2 ? `, ${site.line2}` : ''}, {site.city}, {site.state}{' '}
        <span className="tnum">{site.pincode}</span>
      </small>
      {detail && (
        <small className="ck-mono ck-opt-contact">
          {site.contactName} · <span className="tnum">{site.contactMobile}</span>
        </small>
      )}
    </Option>
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
    <div className="ck-recv">
      <h3>Receiving at {site.label ?? site.city}</h3>
      <dl className="ck-facts">
        <Fact label="Contact" value={site.contactName} />
        <Fact label="Mobile" value={site.contactMobile} />
        <Fact label="Landmark" value={site.landmark} />
        <Fact label="Gate & dock" value={site.gateInstructions} />
        <Fact label="Receiving hours" value={site.receivingHours} />
      </dl>
      <p className="ck-recv-note">
        Missing details can be added in Account → Addresses. Receiving hours are not something we
        hold yet, so the carrier calls the contact above before arriving.
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }): React.JSX.Element {
  return (
    <div className="ck-fact">
      <dt>{label}</dt>
      <dd className={value === null ? 'dim' : 'tnum'}>{value ?? 'Not recorded'}</dd>
    </div>
  );
}

/* ==========================================================================
 * Step 3 — the buyer's own PO reference
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
    <section className="ck-step ck-ref" aria-label="Your purchase-order reference">
      {/* `Input`, not a hand-rolled field: it owns the label/hint/error wiring,
          the focus ring and the mono branch, and a second copy of those in an
          app is how the two drift. `mono` because a PO reference is an
          identifier that gets read back digit by digit against an invoice. */}
      <Input
        id="po"
        label={
          session.poRequired ? (
            'PO reference'
          ) : (
            <>
              PO reference <small>(optional)</small>
            </>
          )
        }
        mono
        required={session.poRequired}
        value={poNumber}
        maxLength={40}
        placeholder="PO/2026/00417"
        error={errors.buyerPoNumber}
        className="ck-field"
        autoComplete="off"
        onChange={(e) => onPo(e.target.value)}
      />

      <Input
        id="cc"
        label={
          <>
            Cost centre <small>(optional)</small>
          </>
        }
        value={costCentre}
        maxLength={60}
        placeholder="IT — Delhi office"
        className="ck-field"
        autoComplete="off"
        onChange={(e) => onCostCentre(e.target.value)}
      />
    </section>
  );
}

/* ==========================================================================
 * Step 4 — payment mode
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
    <section className="ck-step" aria-label="How you are paying">
      <fieldset className="ck-opts">
        <legend className="sr-only">Choose a payment method</legend>
        {session.paymentModes.map((option) => (
          <Option
            key={option.mode}
            name="paymentMode"
            value={option.mode}
            checked={option.mode === paymentMode}
            disabled={!option.allowed}
            onSelect={() => onSelect(option.mode)}
          >
            <b>{option.label}</b>
            {/* A control that is off says why, on the screen — not in a title
                attribute, which is unreachable by touch and by keyboard. */}
            {option.reason && <small>{option.reason}</small>}
          </Option>
        ))}
      </fieldset>
      {errors.paymentMode && (
        <p role="alert" className="ck-err">
          {errors.paymentMode}
        </p>
      )}
    </section>
  );
}

/* ==========================================================================
 * Step 5 — confirm
 * ======================================================================== */

function ConfirmStep({
  session,
  gstProfileId,
  deliveryAddressId,
  paymentMode,
  poNumber,
  costCentre,
}: {
  session: CheckoutSession;
  gstProfileId: string | null;
  deliveryAddressId: string | null;
  paymentMode: PaymentMode | null;
  poNumber: string;
  costCentre: string;
}): React.JSX.Element {
  const gst = session.gstProfiles.find((g) => g.id === gstProfileId) ?? null;
  const site = session.deliverySites.find((s) => s.id === deliveryAddressId) ?? null;
  const mode = session.paymentModes.find((m) => m.mode === paymentMode) ?? null;
  const tax = session.breakUp?.tax;
  /** No total means no priced lane, which means nothing was actually split. */
  const priced = session.breakUp?.grandTotal != null;
  const po = poNumber.trim();
  const cc = costCentre.trim();

  return (
    <section className="ck-step" aria-label="Confirm">
      {session.approval && (
        <div className="ck-approval">
          <StatusPill tone="warn" label="Needs approval" />
          <p className="ck-approval-why">{session.approval.reason}</p>
          <p className="ck-approval-what">
            Placing it sends it to <b>{session.approval.approverName}</b>. These exact machines stay
            held for you while they decide, nothing is charged, and no supplier is committed until
            they approve. If nobody answers within <span className="tnum">24</span> hours the hold
            releases and the machines go back on sale.
          </p>
        </div>
      )}

      <div className="ck-agree">
        <h3>What you are agreeing to</h3>
        <dl className="ck-facts right">
          <Fact label="Machines" value={machines(session.unitsHeld)} />
          <Fact label="Billed to" value={gst ? `${gst.legalName} · ${gst.gstin}` : null} />
          <Fact
            label="Delivered to"
            value={site ? `${site.label ?? site.city}, ${site.pincode}` : null}
          />
          {/* An optional field left blank is not a value we failed to record.
              "Not recorded" is the sentence for receiving hours — a thing we
              should hold and do not — and using it here would read as a gap. */}
          <Fact
            label="Your PO reference"
            value={po ? (cc ? `${po} · ${cc}` : po) : 'None — your organisation does not require one'}
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
        <div className="ck-agree ck-unresolved">
          <h3>The tax split is not resolved yet</h3>
          <p>
            The place of supply is {tax.placeOfSupplyState} (
            <span className="tnum">{tax.placeOfSupplyStateCode}</span>) against our
            registration in state <span className="tnum">{tax.ourStateCode}</span>, so this
            would be{' '}
            {tax.ourStateCode === tax.placeOfSupplyStateCode
              ? 'CGST and SGST'
              : 'IGST'}{' '}
            — but we cannot deliver there, so there is no taxable value to split and no total to
            agree to. Choose a site we can reach and the resolved split appears here.
          </p>
          <p className="dim">Not resolved</p>
        </div>
      )}

      <p className="ck-seller">
        <b>{BRAND.legalEntity}</b> is the seller: we buy these exact serials on your behalf — one
        invoice, one seller.{' '}
        {priced ? (
          <>
            Placing the order is agreement to{' '}
            <b className="tnum">{rupees(session.breakUp!.grandTotal!)}</b>; nothing is added
            afterwards.
          </>
        ) : (
          'There is no total to agree to until we can price delivery, so this order cannot be placed as it stands.'
        )}
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
function BreakUpPanel({
  breakUp,
  unitsHeld,
  site,
}: {
  breakUp: BreakUp | null;
  unitsHeld: number;
  site: DeliverySite | null;
}): React.JSX.Element {
  if (!breakUp) {
    return (
      <div className="ck-costs">
        <h3>What this costs</h3>
        <p className="ck-costs-wait">
          Freight and the GST split need a delivery site. Choose one and the whole break-up — goods,
          freight, tax by head and the total — appears here. There is no third charge.
        </p>
      </div>
    );
  }

  if (breakUp.freight === null || breakUp.grandTotal === null) {
    return (
      <div className="ck-costs unpriced" role="status">
        <h3>We cannot price delivery to that site</h3>
        <dl className="ck-costs-rows">
          <div>
            <dt>Goods</dt>
            <dd className="tnum">{rupees(breakUp.goods)}</dd>
          </div>
          <div>
            <dt>Freight</dt>
            {/* Never a zero standing in for "we could not price it": that is a
                price misrepresentation under CP e-Comm r.6(5). */}
            <dd className="dim">Not priced</dd>
          </div>
        </dl>
        <p className="ck-tax-note">{breakUp.freightUnpricedReason}</p>
      </div>
    );
  }

  const lines: PriceLine[] = [
    { label: 'Machines', amount: Money.parse(breakUp.goods), note: units(unitsHeld) },
    {
      label: 'Freight',
      amount: Money.parse(breakUp.freight),
      note: site ? `to ${site.pincode}` : 'to your delivery pincode',
    },
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
    <div className="ck-costs">
      <h3>What this costs</h3>
      <PriceBreakup
        className="ck-pb"
        lines={lines}
        valuationMethod="REGULAR"
        taxNote={
          <>
            Delivering to <b>{breakUp.tax.placeOfSupplyState}</b> —{' '}
            {breakUp.tax.interState
              ? 'inter-state, so the whole tax is IGST.'
              : `Intra-state supply, so it splits into CGST and ${breakUp.tax.stateTaxLabel}.`}{' '}
            Every charge on this order is here. Nothing is added at the end.
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
    case 'BILLING':
      return [
        {
          term: 'The GSTIN sets the invoice entity',
          explanation:
            'and the input credit you claim — free to change now, expensive after an invoice exists. It does not set the tax head; delivery does (next step).',
        },
      ];
    case 'DELIVERY':
      return [
        {
          term: 'Place of supply, s.10(1)(a)',
          explanation:
            'The delivery state splits the tax — our state gives CGST + SGST, anywhere else IGST. The gate note goes to the driver: a pallet at a closed dock is a failed delivery and a second freight charge.',
        },
      ];
    case 'REFERENCE':
      return [
        {
          term: session.poRequired ? 'Required by your organisation' : 'Optional',
          explanation: session.poRequired
            ? 'Your PO reference prints on our invoice so your finance team can match it against your own purchase order. The cost centre carries into order history.'
            : 'Your PO reference prints on our invoice so your finance team can match it — many corporates won’t process one without it. The cost centre carries into order history.',
        },
      ];
    case 'PAYMENT':
      return [
        {
          term: 'Methods follow your buying policy',
          explanation:
            'A junior buyer can often pay now but not draw on the company credit line — the reason is on each one that’s off.',
        },
      ];
    case 'CONFIRM':
      return [
        {
          term: 'One seller, one invoice',
          explanation: session.approval
            ? `${BRAND.legalEntity} buys these exact serials on your behalf. Placing the order sends it to your approver — the machines stay held, nothing is charged, and no supplier is committed until they say yes.`
            : `${BRAND.legalEntity} buys these exact serials on your behalf. Placing the order is agreement to the total on the right — nothing is added after.`,
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
    <div className="ck">
      <div className="ck-wrap" aria-busy="true">
        <Skeleton className="ck-skel-steps rounded-2xl" />
        <div className="ck-main">
          <Skeleton className="h-3 w-32 rounded" />
          <Skeleton className="mt-3 h-8 w-2/3 rounded" />
          <Skeleton className="mt-5 h-24 w-full rounded-2xl" />
          <Skeleton className="mt-3 h-24 w-full rounded-2xl" />
          <Skeleton className="mt-3 h-24 w-full rounded-2xl" />
        </div>
        <div className="ck-rail">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      </div>
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
      className="ck-empty"
      title="Sign in to check out"
      body="An order belongs to your organisation, so we need to know who is placing it. Signing in brings you straight back here with your cart intact — nothing has been held yet."
      action={
        <a className="ck-btn" href={`/sign-in?next=${encodeURIComponent(next)}`}>
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
      className="ck-empty"
      title="Checkout cannot start yet"
      body={message}
      action={
        <a className="ck-btn" href="/cart">
          Back to your cart
        </a>
      }
    />
  );
}

function Expired({ cartId }: { cartId: string | null }): React.JSX.Element {
  return (
    <EmptyState
      className="ck-empty"
      title="The hold ran out"
      body="Those machines have gone back on sale, and nothing has been ordered or charged. Your cart is untouched — start checkout again and we will hold whatever is still there."
      action={
        <a className="ck-btn" href={`/checkout?cart=${cartId ?? ''}`}>
          Start checkout again
        </a>
      }
    />
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="ck-empty err" role="alert">
      <h3>We could not open checkout</h3>
      <p>{message}</p>
      <p>Nothing has been ordered, nothing has been charged, and your cart is unchanged.</p>
      <p className="ck-empty-act">
        <button type="button" className="ck-btn" onClick={() => window.location.reload()}>
          Try again
        </button>
      </p>
    </div>
  );
}

/**
 * The order exists at `/orders/{orderNumber}` (T17). This screen is the
 * thank-you terminal — one headline, the order number, and a path to the record.
 * The full break-up and serial list live on the order screen only; repeating them
 * here is two places for the same figures to disagree.
 */
function Placed({
  order,
  paidBy,
  site,
  poNumber,
}: {
  order: OrderConfirmation;
  paidBy: string | null;
  site: DeliverySite | null;
  poNumber: string;
}): React.JSX.Element {
  const awaiting = order.status === 'AWAITING_APPROVAL';
  const count = order.units || order.serials.length;

  return (
    <div className="ck-done" role="status" aria-live="polite">
      <div className="ck-done-badge" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m4.5 12.5 5 5L19.5 7" />
        </svg>
      </div>
      <StatusPill
        tone={awaiting ? 'warn' : 'info'}
        label={awaiting ? 'Awaiting approval' : 'Order placed'}
      />
      <h1 className="ck-h1">
        {awaiting ? 'Sent for approval. The machines stay held.' : 'Order placed. The machines are yours.'}
      </h1>
      <p className="ck-lede">
        Order <span className="ck-order-id tnum">{order.orderNumber}</span> ·{' '}
        <span className="tnum">{rupees(order.grandTotal)}</span> · {machines(count)}
        {paidBy ? <> · {paidBy}</> : null}
      </p>
      <p className="ck-lede">
        {awaiting
          ? `${BRAND.name} has your request. Nothing is charged until your approver signs off, and stock stays held while they decide.`
          : `Your order is with ${BRAND.legalEntity} — we now raise the purchase orders, the machines are picked, and dispatch follows${site ? ` to ${site.label ?? site.city}` : ''}. Serial numbers are named when a machine is attached to this order, and your GST invoice ${poNumber ? `carries your reference ${poNumber}` : 'follows'}.`}
      </p>
      <div className="ck-nav">
        <a className="ck-btn" href={`/orders/${order.orderNumber}`}>
          View your order
        </a>
        <a className="ck-leave" href="/">
          Back to marketplace
        </a>
      </div>
    </div>
  );
}
