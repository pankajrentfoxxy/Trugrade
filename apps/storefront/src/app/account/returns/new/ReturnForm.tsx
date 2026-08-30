'use client';

import * as React from 'react';
import { EmptyState, WhyRail, type WhyRailItem } from '@trugrade/ui';
import type { ApiFailure } from '../../../register/api';
import {
  EVIDENCE_MINIMUM,
  getReturnEligibility,
  raiseReturn,
  REASON_LABEL,
  RETURN_REASONS,
  type ReturnableMachine,
  type ReturnReason,
} from '../api';

/**
 * The return form. See `page.tsx` for the archetype and the rules.
 *
 * **The machines are checkboxes, not a free-text serial box.** A buyer who
 * mistypes one character would otherwise be told the machine is not on their
 * order, which is the most alarming thing this screen can say wrongly. The list
 * is what is actually returnable — delivered, inside the window, no return
 * already open — and everything that is not appears underneath with the reason.
 */

const WHY: readonly WhyRailItem[] = [
  {
    term: 'Which machines',
    explanation:
      'Each serial is inspected on its own when it comes back and settled on its own, so three machines returned together get three numbers. One of them can be upheld while another is not.',
  },
  {
    term: 'The window',
    explanation:
      'It runs from the moment the delivery reached you, per delivery, and we measure it on our own clock rather than your browser’s. When it closes the machine is still under warranty — a fault found later is a claim, and that costs you nothing either.',
  },
  {
    term: 'What is wrong',
    explanation:
      'The reason decides who bears the cost, so it is the field a return inspection is judged against. Picking the closest one is what gets a refund out in days rather than after an argument.',
  },
  {
    term: 'What happens next',
    explanation:
      'We collect the machine at our cost, inspect it against the report it was sold under, and refund or replace it. You never contact whoever dispatched it — under our terms there is nobody else for you to chase.',
  },
];

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; machines: ReturnableMachine[]; windowHours: number | null };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your machines just now. That is our problem, not yours — nothing you have typed is lost.'
    : failure.message;

const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const when = (iso: string): string => IST.format(new Date(iso));

const isReason = (v: string): v is ReturnReason =>
  (RETURN_REASONS as readonly string[]).includes(v);

export function ReturnForm({
  initialOrder,
  initialSerials,
  initialReason,
}: {
  initialOrder: string;
  initialSerials: readonly string[];
  initialReason: string;
}): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [chosen, setChosen] = React.useState<ReadonlySet<string>>(new Set(initialSerials));
  const [reason, setReason] = React.useState<ReturnReason | ''>(
    isReason(initialReason) ? initialReason : '',
  );
  const [description, setDescription] = React.useState('');
  const [active, setActive] = React.useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = React.useState(false);
  const [refusal, setRefusal] = React.useState<ApiFailure | null>(null);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getReturnEligibility(initialOrder || undefined);
      if (!live) return;
      if (result.ok) {
        setPhase({
          k: 'ready',
          machines: result.data.machines,
          windowHours: result.data.windowHours,
        });
      } else if (result.status === 401) setPhase({ k: 'signed-out' });
      else if (result.status === 404) setPhase({ k: 'missing' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [initialOrder]);

  if (phase.k === 'signed-out') return <SignedOut order={initialOrder} />;
  if (phase.k === 'missing') return <Missing order={initialOrder} />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const loading = phase.k === 'loading';
  const machines = phase.k === 'ready' ? phase.machines : [];
  const windowHours = phase.k === 'ready' ? phase.windowHours : null;
  const returnable = machines.filter((m) => m.blockedReason === null);
  const blocked = machines.filter((m) => m.blockedReason !== null);

  // The order every returnable machine belongs to. The endpoint takes one order,
  // because a return is raised against the delivery whose window is running.
  const orders = [...new Set(returnable.map((m) => m.orderNumber))];
  const selected = returnable.filter((m) => chosen.has(m.serialNumber));
  const orderOfSelection = selected[0]?.orderNumber ?? orders[0] ?? initialOrder;
  const mixed = new Set(selected.map((m) => m.orderNumber)).size > 1;

  const trimmed = description.trim();
  const minEvidence = reason === '' ? 0 : (EVIDENCE_MINIMUM[reason] ?? 0);
  const canSubmit =
    selected.length > 0 && !mixed && reason !== '' && trimmed.length >= 20 && !submitting;

  const toggle = (serial: string): void => {
    const next = new Set(chosen);
    if (next.has(serial)) next.delete(serial);
    else next.add(serial);
    setChosen(next);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setRefusal(null);
    const result = await raiseReturn({
      orderNumber: orderOfSelection,
      serialNumbers: selected.map((m) => m.serialNumber),
      reasonCode: reason,
      description: trimmed,
    });
    if (result.ok && result.data.returns[0]) {
      // A full navigation rather than a router push: the return record reads the
      // return back from the server, and arriving with a stale client cache is
      // how somebody sees "not found" for a return they just raised.
      window.location.href = `/account/returns/${encodeURIComponent(result.data.returns[0].returnNumber)}`;
      return;
    }
    setSubmitting(false);
    if (!result.ok) setRefusal(result);
  };

  return (
    <>
      <div className="wshead rnhead">
        <h1>Send a machine back</h1>
        <p>
          Inside the inspection window that opens when a delivery reaches you, any machine on it can
          come back to us. We collect it, we inspect it against the report it was sold under, and we
          refund or replace it — at our cost, on our own invoice.
        </p>
      </div>

      <div className="flow2">
        <form className="rnform" onSubmit={submit} noValidate>
          {refusal && <Refusal failure={refusal} />}

          <fieldset className="cfield">
            <legend>Which machines</legend>
            {loading ? (
              <p className="ink4">Reading your machines…</p>
            ) : returnable.length === 0 ? (
              <p className="cfnone">
                None of your <span className="mono">{machines.length}</span> machines can be sent
                back today. The reasons are listed below — each one has a different way forward, and
                none of them is a dead end.
              </p>
            ) : (
              <ul className="rnpick">
                {returnable.map((m) => (
                  <li key={m.serialNumber}>
                    <label className={chosen.has(m.serialNumber) ? 'rnmach on' : 'rnmach'}>
                      <input
                        type="checkbox"
                        checked={chosen.has(m.serialNumber)}
                        onChange={() => toggle(m.serialNumber)}
                        onFocus={() => setActive('Which machines')}
                      />
                      <span className="rnserial mono">{m.serialNumber}</span>
                      <span className="rntitle">
                        {m.title ?? (
                          <span className="notmeasured">Model no longer catalogued</span>
                        )}
                      </span>
                      <Window machine={m} windowHours={windowHours} />
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {mixed && (
              <p className="rnmixed" role="alert">
                Those machines are on two different orders, and a return is raised against one
                order&rsquo;s delivery. Raise one return for each order — the windows on them are
                different, and merging the two would report the wrong deadline on one of them.
              </p>
            )}

            {blocked.length > 0 && (
              // Open when NOTHING can be returned, because then the reasons are
              // the only content on the screen and the buyer's next step is
              // inside them. Collapsed on a form that can still be filled in,
              // where they are a footnote rather than the answer.
              <details className="cblocked" open={returnable.length === 0}>
                <summary>
                  <span className="mono">{blocked.length}</span>{' '}
                  {blocked.length === 1 ? 'machine cannot' : 'machines cannot'} be sent back — why
                </summary>
                <ul>
                  {blocked.map((m) => (
                    <li key={m.serialNumber}>
                      <span className="mono">{m.serialNumber}</span> {m.blockedReason}
                      {m.openReturn && (
                        <>
                          {' · '}
                          <a
                            href={`/account/returns/${encodeURIComponent(m.openReturn.returnNumber)}`}
                          >
                            open it
                          </a>
                        </>
                      )}
                      {m.openReturn === null && m.window !== null && !m.window.open && (
                        <>
                          {' · '}
                          <a href="/account/warranty">raise a warranty claim instead</a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </fieldset>

          <fieldset className="cfield">
            <legend>What is wrong</legend>
            <div
              className="careas"
              role="radiogroup"
              aria-label="Reason for the return"
              onFocus={() => setActive('What is wrong')}
            >
              {RETURN_REASONS.map((r) => (
                <label key={r} className={reason === r ? 'carea on' : 'carea'}>
                  <input
                    type="radio"
                    name="reasonCode"
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                  />
                  <span className="l">{REASON_LABEL[r].label}</span>
                  <span className="d">{REASON_LABEL[r].hint}</span>
                </label>
              ))}
            </div>
            {minEvidence > 0 && (
              <p className="rnevidence">
                {REASON_LABEL[reason as ReturnReason].label} needs{' '}
                <span className="mono">{minEvidence}</span>{' '}
                {minEvidence === 1 ? 'photograph' : 'photographs'}, and{' '}
                <b>uploading them here is not built yet</b>. Raise the return anyway — we will ask
                you for the pictures by email and the return is on record from now. We would rather
                have it recorded than hold your remedy up for a file picker.
              </p>
            )}
          </fieldset>

          <fieldset className="cfield">
            <legend>What it does</legend>
            <label className="csel">
              <span className="l">Describe the problem</span>
              <textarea
                rows={5}
                value={description}
                maxLength={4000}
                onChange={(e) => setDescription(e.target.value)}
                onFocus={() => setActive('What is wrong')}
                placeholder="The lid has a deep scratch across the whole width that is not in any of the inspection photographs."
              />
              <span className={trimmed.length > 0 && trimmed.length < 20 ? 'd short' : 'd'}>
                <span className="mono">{trimmed.length}</span> of at least{' '}
                <span className="mono">20</span> characters. The engineer who inspects the machine
                when it comes back reads this first.
              </span>
            </label>
          </fieldset>

          <div className="cactions">
            <button type="submit" className="pill acc" disabled={!canSubmit}>
              {submitting
                ? 'Raising the return…'
                : selected.length > 1
                  ? `Send back ${selected.length} machines`
                  : 'Send this machine back'}
            </button>
            <a
              className="pill wire"
              href={
                initialOrder
                  ? `/account/orders/${encodeURIComponent(initialOrder)}/units`
                  : '/account/returns'
              }
            >
              {initialOrder ? 'Back to the order' : 'Your returns'}
            </a>
          </div>
          <p className="fnote off">
            Rule 7(4) take-back is ours and cannot be passed on. Nothing on this form goes to
            whoever supplied the machine, and you will never be asked to contact them.
          </p>
        </form>

        <WhyRail items={WHY} title="Why we ask" activeTerm={active} className="claimwhy" />
      </div>
    </>
  );
}

/**
 * The window on one machine, as the server decided it.
 *
 * Amber on the hours because they are a **measured value** — one of the
 * accent's three meanings — and never because they are urgent. Nothing here is
 * red and nothing flashes.
 */
function Window({
  machine,
  windowHours,
}: {
  machine: ReturnableMachine;
  windowHours: number | null;
}): React.JSX.Element {
  if (machine.window === null || windowHours === null) {
    return (
      <span className="rnwin">
        <span className="notmeasured">Window not stated</span>
      </span>
    );
  }
  return (
    <span className="rnwin">
      <b className="mono">{machine.window.hoursRemaining}</b>{' '}
      <span className="denom">of {windowHours} hours left</span>
      <span className="d">Closes {when(machine.window.closesAt)}</span>
    </span>
  );
}

/**
 * The server's refusal, verbatim.
 *
 * `role="alert"` so it is announced the moment it appears. The message is never
 * summarised: it is the one that names the exact closing timestamp of a window
 * that shut while the form was open, or the return number already running on
 * that machine.
 */
function Refusal({ failure }: { failure: ApiFailure }): React.JSX.Element {
  return (
    <div className="cfrefusal" role="alert">
      <h2>We could not raise this return</h2>
      <p>{failure.message}</p>
      {Object.entries(failure.fields).map(([field, message]) => (
        <p key={field} className="f">
          {message}
        </p>
      ))}
    </div>
  );
}

/* ==========================================================================
 * States that are not the form
 * ======================================================================== */

function SignedOut({ order }: { order: string }): React.JSX.Element {
  const next = order ? `/account/returns/new?order=${order}` : '/account/returns/new';
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to send a machine back"
        body="A return belongs to the organisation that bought the machine. Signing in brings you straight back to this form."
        action={
          <a className="pill acc" href={`/sign-in?next=${encodeURIComponent(next)}`}>
            Sign in
          </a>
        }
      />
    </div>
  );
}

function Missing({ order }: { order: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="We have no order with that number on your account"
        body={
          <>
            Nothing on your organisation&rsquo;s account is numbered{' '}
            <span className="mono">{order}</span>. Check it against your confirmation, or start from
            the order itself.
          </>
        }
        action={
          <a className="pill acc" href="/account/orders">
            Your orders
          </a>
        }
      />
    </div>
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty err" role="alert">
        <h3>We could not load your machines</h3>
        <p>{message}</p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
