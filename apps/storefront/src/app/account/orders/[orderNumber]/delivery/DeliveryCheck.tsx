'use client';

import * as React from 'react';
import {
  EmptyState,
  RecordHeader,
  SealChip,
  SidePanel,
  Skeleton,
  StatusPill,
  type SealStatus,
  type StatusPillProps,
} from '@trugrade/ui';
import type { ApiFailure } from '../../../../register/api';
import {
  checkSeal,
  confirmReceipt,
  getDelivery,
  type DeliveryConsignment,
  type DeliveryMachine,
  type DeliveryView,
  type DeliveryWindow,
  type QcVerdict,
  type SealOutcome,
} from './api';

/**
 * The seal check. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated and can come back 401 —
 * a signed-out visitor is a state this screen renders, not a crash — and because
 * every action here re-renders the whole manifest from the response the server
 * sent, rather than patching a row and hoping the two agree.
 *
 * **Nothing on this screen decides a deadline.** `window.open`,
 * `window.hoursRemaining` and every `blockedReason` arrive already decided. This
 * file does no date arithmetic at all; there is no `Date.now()` in it, and there
 * is nothing for a wrong laptop clock to get wrong.
 */

/** The seal states the API can return, mapped onto the chip's vocabulary. */
const SEAL_STATES = new Set<SealStatus>([
  'APPLIED',
  'INTACT',
  'BROKEN',
  'MISSING',
  'REPLACED',
  'NOT_APPLIED',
]);

/**
 * PASS and FAIL are the two verdicts green and red exist for. `PASS_WITH_NOTE`
 * is a pass with something written on it, so `warn`, and the word carries the
 * meaning for anyone who cannot see the colour. `MISMATCH` is `fail`: the
 * machine is not the machine the line described, whatever else it scored.
 */
const VERDICT: Record<QcVerdict, { tone: StatusPillProps['tone']; label: string }> = {
  PASS: { tone: 'pass', label: 'Pass' },
  PASS_WITH_NOTE: { tone: 'warn', label: 'Pass with note' },
  MISMATCH: { tone: 'fail', label: 'Spec mismatch' },
  FAIL: { tone: 'fail', label: 'Fail' },
};

/** What each outcome button says, and what it does to the sentence beside it. */
const OUTCOMES: ReadonlyArray<{ value: SealOutcome; label: string; hint: string }> = [
  {
    value: 'INTACT',
    label: 'Seal is intact',
    hint: 'The code matches and the sticker is unbroken. This is the check that turns "sealed" into "verified".',
  },
  {
    value: 'BROKEN',
    label: 'Seal is broken',
    hint: 'Do not accept the machine. We open the return immediately — you do not have to call anybody.',
  },
  {
    value: 'MISSING',
    label: 'No seal on the machine',
    hint: 'Treated exactly as a broken one. Nobody can vouch for what is inside a machine with no seal.',
  },
];

type Phase =
  | { k: 'loading' }
  /** No session. Not a failure: a path exists and it comes back here. */
  | { k: 'signed-out' }
  /** No such order on this account. Deliberately the same screen either way. */
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; data: DeliveryView };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach this delivery just now. That is our problem, not yours — the machines and their seals are unaffected.'
    : failure.message;

const isChecked = (m: DeliveryMachine): boolean =>
  m.seal !== null && m.seal.status !== 'APPLIED' && m.seal.status !== 'NOT_APPLIED';

const isCompromised = (m: DeliveryMachine): boolean =>
  m.seal !== null && (m.seal.status === 'BROKEN' || m.seal.status === 'MISSING');

/** `2026-08-31T14:05:00.000Z` → `31 Aug 2026, 2:05 pm`, on the IST calendar. */
const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const when = (iso: string): string => IST.format(new Date(iso));

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function DeliveryCheck({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  /** The server's refusal from the last action, rendered verbatim. */
  const [refusal, setRefusal] = React.useState<ApiFailure | null>(null);
  /** The result of the last check, so the screen can say what it recorded. */
  const [recorded, setRecorded] = React.useState<{
    serialNumber: string;
    status: string;
    returnNumber: string | null;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getDelivery(orderNumber);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', data: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else if (result.status === 404 || result.status === 422) setPhase({ k: 'missing' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [orderNumber]);

  const submitCheck = async (sealCode: string, outcome: SealOutcome): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    setRecorded(null);
    const result = await checkSeal(orderNumber, { sealCode, outcome });
    setBusy(false);
    if (!result.ok) {
      setRefusal(result);
      return;
    }
    setRecorded({
      serialNumber: result.data.serialNumber,
      status: result.data.status,
      returnNumber: result.data.returnNumber,
    });
    setPhase({ k: 'ready', data: result.data.delivery });
  };

  const sign = async (index: number): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    setRecorded(null);
    const result = await confirmReceipt(orderNumber, index);
    setBusy(false);
    if (result.ok) setPhase({ k: 'ready', data: result.data });
    else setRefusal(result);
  };

  if (phase.k === 'loading') return <LoadingRecord />;
  if (phase.k === 'signed-out') return <SignedOut orderNumber={orderNumber} />;
  if (phase.k === 'missing') return <Missing orderNumber={orderNumber} />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const data = phase.data;
  const arrived = data.consignments.filter((c) => c.deliveredAt !== null);
  const live = arrived.filter((c) => c.window?.open === true);
  /** Still checkable. What the amber control is for. */
  const unchecked = live.flatMap((c) => c.machines.filter((m) => !isChecked(m)));
  /**
   * Never checked, whether or not it still can be — and the two are kept apart
   * deliberately. A machine whose window closed with nobody having looked at its
   * seal is NOT a machine whose seal was found intact, and collapsing them would
   * put "Every seal checked" at the top of an order where nobody checked
   * anything. That is a missing value drawn as a passing one, on the one screen
   * whose entire subject is that distinction.
   */
  const neverChecked = arrived.flatMap((c) => c.machines.filter((m) => !isChecked(m)));
  const shut = arrived.length > 0 && live.length === 0;
  const compromised = data.consignments.flatMap((c) => c.machines.filter(isCompromised));
  const signable = data.consignments.filter(
    (c) => c.blockedReason === null && c.receiptConfirmedAt === null,
  );

  // ONE amber control on the screen, and which one depends on what is left to
  // do: while a seal is unchecked, checking it is the task; once nothing is
  // unchecked, signing for the delivery is. Both at once would be two primary
  // actions competing for the same eye.
  const primary: 'check' | 'sign' | 'none' =
    unchecked.length > 0 ? 'check' : signable.length > 0 ? 'sign' : 'none';

  // ...and ONE of them, even across three consignments. An order split across
  // three deliveries has three scan boxes and three sign buttons; painting every
  // one of them amber is three primary actions on one screen. The accent goes to
  // the delivery with work outstanding that comes first — where somebody working
  // down the page starts.
  const primaryDelivery =
    primary === 'check'
      ? live.find((c) => c.machines.some((m) => !isChecked(m)))?.index
      : primary === 'sign'
        ? signable[0]?.index
        : undefined;

  return (
    <>
      <RecordHeader
        title="Check the seals before you sign"
        subtitle={
          arrived.length === 0
            ? 'Nothing on this order has arrived yet, so there is nothing to check.'
            : 'Compare each code below against the sticker on the machine in front of you. A seal we applied and nobody has looked at is not a seal that has been checked.'
        }
        identifiers={[
          { label: 'Order', value: orderNumber, href: `/account/orders/${orderNumber}` },
          {
            label: 'Deliveries',
            value: `${arrived.length} of ${data.consignments.length} arrived`,
          },
          { label: 'Checked at', value: when(data.asOf) },
        ]}
        status={
          compromised.length > 0 ? (
            <StatusPill
              tone="fail"
              label={`${compromised.length} seal${compromised.length === 1 ? '' : 's'} we cannot vouch for`}
            />
          ) : arrived.length === 0 ? (
            <StatusPill tone="neutral" label="Not delivered yet" />
          ) : shut && neverChecked.length > 0 ? (
            // Neutral, and it says NEVER CHECKED rather than "every seal
            // checked". Nobody looked and now nobody can; that is a fact about
            // this order, and it is not a pass.
            <StatusPill
              tone="neutral"
              label={`${neverChecked.length} of ${arrived.flatMap((c) => c.machines).length} never checked`}
            />
          ) : unchecked.length > 0 ? (
            <StatusPill tone="neutral" label={`${unchecked.length} still to check`} />
          ) : neverChecked.length > 0 ? (
            <StatusPill tone="neutral" label={`${neverChecked.length} never checked`} />
          ) : (
            <StatusPill tone="pass" label="Every seal checked" />
          )
        }
        className="dvhead"
      />

      <div className="rec dvrec">
        <main className="evid">
          {refusal && <Refusal failure={refusal} />}
          {recorded && !refusal && <Recorded {...recorded} />}

          {data.consignments.length === 0 ? (
            <EmptyState
              title="No delivery is set up on this order yet"
              body="Machines are grouped into deliveries when the order is confirmed. Until then there is nothing to check."
            />
          ) : (
            data.consignments.map((c) => (
              <Consignment
                key={c.index}
                consignment={c}
                windowHours={data.windowHours}
                orderNumber={orderNumber}
                busy={busy}
                primary={primaryDelivery === c.index}
                onCheck={submitCheck}
              />
            ))
          )}
        </main>

        <SidePanel
          title="Signing for this delivery"
          description={
            compromised.length > 0
              ? 'A seal we cannot vouch for stops the handover. Take-back on those machines is ours and is not something you have to argue for — do not accept them.'
              : unchecked.length > 0
                ? 'Check every seal first. A machine we sealed and nobody has looked at since is not a machine that has been verified.'
                : signable.length > 0
                  ? 'Every seal on this delivery has been looked at and none of them is broken.'
                  : 'There is nothing waiting on you here.'
          }
          footnote={
            <>
              A broken seal is our problem, not yours. We collect the machine, we settle it, and we
              never ask you to contact whoever dispatched it — under our terms there is nobody else
              for you to chase.
            </>
          }
          className="dvside"
        >
          {data.consignments.map((c) =>
            c.receiptConfirmedAt !== null ? (
              <p key={c.index} className="dvsigned">
                <span className="l">Delivery {c.index} signed for</span>
                <span className="mono">{when(c.receiptConfirmedAt)}</span>
              </p>
            ) : c.blockedReason === null ? (
              <button
                key={c.index}
                type="button"
                className={primaryDelivery === c.index ? 'pill acc dvsign' : 'pill wire dvsign'}
                disabled={busy}
                onClick={() => void sign(c.index)}
              >
                {busy ? 'Recording…' : `Confirm receipt of delivery ${c.index}`}
              </button>
            ) : (
              <p key={c.index} className="dvcannot">
                <span className="l">Delivery {c.index}</span>
                <span className="d">{c.blockedReason}</span>
              </p>
            ),
          )}

          <a
            className="pill wire dvside-a"
            href={`/account/returns/new?order=${encodeURIComponent(orderNumber)}`}
          >
            Report a discrepancy
          </a>
          <a
            className="pill wire dvside-a"
            href={`/account/returns?order=${encodeURIComponent(orderNumber)}`}
          >
            Returns on this order
          </a>
        </SidePanel>
      </div>

      <p className="fnote off dvfoot">
        Every seal code above was applied by our technician at the supply point and photographed in
        place. Checking it at the door is what turns our claim about the machine into your own
        record of it — and it is the only check on this platform that does not need an account, a
        login or us.
      </p>
    </>
  );
}

/* ==========================================================================
 * One consignment
 * ======================================================================== */

function Consignment({
  consignment,
  windowHours,
  orderNumber,
  busy,
  primary,
  onCheck,
}: {
  consignment: DeliveryConsignment;
  windowHours: number | null;
  orderNumber: string;
  busy: boolean;
  primary: boolean;
  onCheck: (sealCode: string, outcome: SealOutcome) => Promise<void>;
}): React.JSX.Element {
  const [code, setCode] = React.useState('');
  const c = consignment;
  const open = c.window?.open === true;
  const unchecked = c.machines.filter((m) => !isChecked(m));

  return (
    <section className="dvcons" aria-labelledby={`dvc${c.index}`}>
      <header className="dvconshead">
        <h2 id={`dvc${c.index}`}>{c.label}</h2>
        <Window window={c.window} windowHours={windowHours} deliveredAt={c.deliveredAt} />
      </header>

      {c.deliveredAt === null ? (
        <p className="dvnote">
          This delivery has not arrived yet. The 48-hour inspection window starts when it does — not
          when the order was placed and not when it left the supply point.
        </p>
      ) : c.receiptConfirmedAt !== null ? (
        // Signed for. The check is over, and leaving an empty scan box on a
        // finished delivery is a control that invites work nobody has to do.
        <p className="dvnote">
          You signed for this delivery on <span className="mono">{when(c.receiptConfirmedAt)}</span>
          . If something turns up now, it is still inside the inspection window —{' '}
          <a href={`/account/returns/new?order=${encodeURIComponent(orderNumber)}`}>
            report a discrepancy
          </a>{' '}
          and we will collect the machine.
        </p>
      ) : open ? (
        <ScanBox
          code={code}
          setCode={setCode}
          busy={busy}
          primary={primary && unchecked.length > 0}
          onCheck={onCheck}
        />
      ) : (
        <p className="dvnote">
          {/* Neutral, and with the way forward beside it. An expired window is
              not a failure and must not be drawn as one — the machine is still
              under warranty and a fault found today still costs nothing. */}
          The inspection window on this delivery has closed, so the seal check at the door is over.
          The machines are still under warranty: if one of them has a fault, raise a{' '}
          <a href="/account/warranty">warranty claim</a> and we handle it at our cost.
        </p>
      )}

      <ul className="dvmachines">
        {c.machines.length === 0 && (
          <li className="dvempty">
            <span className="notmeasured">No machine is assigned to this delivery yet.</span>
          </li>
        )}
        {c.machines.map((m) => (
          <Machine
            key={m.serialNumber}
            machine={m}
            orderNumber={orderNumber}
            canUse={open}
            arrived={c.deliveredAt !== null}
            onUseCode={setCode}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The window, as the server decided it.
 *
 * Amber on the hours because they are a **measured value**, which is one of the
 * accent's three permitted meanings — not because they are urgent. There is no
 * red here at any point and nothing flashes: §3A.4 requires this to read as
 * information rather than pressure, and a countdown that manufactures urgency is
 * the dark pattern this product refuses.
 *
 * A window we cannot state is said out loud rather than drawn as 48 hours.
 */
function Window({
  window: w,
  windowHours,
  deliveredAt,
}: {
  window: DeliveryWindow | null;
  windowHours: number | null;
  deliveredAt: string | null;
}): React.JSX.Element {
  if (deliveredAt === null) {
    return <span className="dvwin off">Not delivered yet</span>;
  }
  if (w === null || windowHours === null) {
    return (
      <span className="dvwin off">
        <span className="notmeasured">We cannot state the inspection window right now</span>
      </span>
    );
  }
  if (!w.open) {
    return (
      <span className="dvwin closed">
        <span className="l">Inspection window closed</span>
        <span className="mono">{when(w.closesAt)}</span>
      </span>
    );
  }
  return (
    <span className="dvwin live">
      <span className="l">Inspection window</span>
      <span className="v">
        <b className="mono">{w.hoursRemaining}</b>{' '}
        <span className="denom">of {windowHours} hours left</span>
      </span>
      <span className="d">
        Delivered {when(deliveredAt)} · closes {when(w.closesAt)}
      </span>
    </span>
  );
}

/* ==========================================================================
 * The scan box — one control, three outcomes
 * ======================================================================== */

function ScanBox({
  code,
  setCode,
  busy,
  primary,
  onCheck,
}: {
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  primary: boolean;
  onCheck: (sealCode: string, outcome: SealOutcome) => Promise<void>;
}): React.JSX.Element {
  const trimmed = code.trim().toUpperCase();
  const [outcome, setOutcome] = React.useState<SealOutcome>('INTACT');
  const chosen = OUTCOMES.find((o) => o.value === outcome)!;

  return (
    <form
      className="dvscan"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed !== '' && !busy) void onCheck(trimmed, outcome);
      }}
      noValidate
    >
      <label className="dvcode">
        <span className="l">Seal code on the machine</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="TG-26HR-0004821"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          aria-describedby="dvcodehint"
        />
        <span className="d" id="dvcodehint">
          Read it off the sticker on the lid, or scan it. Case does not matter.
        </span>
      </label>

      <fieldset className="dvout">
        <legend>What did you find?</legend>
        <div className="dvouts" role="radiogroup" aria-label="What did you find">
          {OUTCOMES.map((o) => (
            <label key={o.value} className={outcome === o.value ? 'dvopt on' : 'dvopt'}>
              <input
                type="radio"
                name="outcome"
                value={o.value}
                checked={outcome === o.value}
                onChange={() => setOutcome(o.value)}
              />
              <span className="l">{o.label}</span>
            </label>
          ))}
        </div>
        <p className="dvhint">{chosen.hint}</p>
      </fieldset>

      <button
        type="submit"
        className={primary ? 'pill acc dvgo' : 'pill wire dvgo'}
        disabled={busy || trimmed === ''}
      >
        {busy ? 'Recording…' : 'Record what you found'}
      </button>
    </form>
  );
}

/* ==========================================================================
 * One machine on the manifest
 * ======================================================================== */

function Machine({
  machine: m,
  orderNumber,
  canUse,
  arrived,
  onUseCode,
}: {
  machine: DeliveryMachine;
  orderNumber: string;
  canUse: boolean;
  arrived: boolean;
  onUseCode: (code: string) => void;
}): React.JSX.Element {
  const checked = isChecked(m);
  const compromised = isCompromised(m);
  const flagHref =
    `/account/returns/new?order=${encodeURIComponent(orderNumber)}` +
    `&units=${encodeURIComponent(m.serialNumber)}` +
    (m.verdict === 'MISMATCH' ? '&reason=SPEC_MISMATCH' : '');

  return (
    <li className={compromised ? 'dvmach bad' : checked ? 'dvmach ok' : 'dvmach'}>
      <div className="dvid">
        <a className="mono dvserial" href={m.passportPath}>
          {m.serialNumber}
        </a>
        <span className="dvtitle">
          {m.title ?? <span className="notmeasured">Model no longer catalogued</span>}
        </span>
        {m.specSummary && <span className="dvspec">{m.specSummary}</span>}
      </div>

      <div className="dvseal">
        {m.seal === null || !SEAL_STATES.has(m.seal.status as SealStatus) ? (
          // A machine with no seal on record is not a machine that passed. It is
          // never drawn as one, and it blocks the handover on its own.
          <span className="notmeasured">No seal recorded</span>
        ) : (
          <SealChip sealCode={m.seal.code} status={m.seal.status as SealStatus} />
        )}
        {m.seal && canUse && !checked && (
          <button type="button" className="dvuse" onClick={() => onUseCode(m.seal!.code)}>
            Check this one
            <span className="sr-only"> — put {m.seal.code} in the box above</span>
          </button>
        )}
      </div>

      <div className="dvverdict">
        {m.verdict === null ? (
          <span className="notmeasured">Not inspected</span>
        ) : (
          <StatusPill tone={VERDICT[m.verdict].tone} label={VERDICT[m.verdict].label} />
        )}
        {(m.verdict === 'MISMATCH' || m.verdict === 'FAIL') && (
          // T21 could state the verdict and go no further. This is the action it
          // was missing: the buyer can act on it here, at the door, in one link.
          <a className="dvflag" href={flagHref}>
            Flag this machine
          </a>
        )}
      </div>

      {/* Suppressed until the machine has actually arrived. "Compare the code on
          the lid" is true of a laptop still at the supply point and useless to
          somebody reading it — the delivery above already says why. */}
      {arrived && (
        <p className="dvwhy">
          {m.blockedReason === null ? (
            <span className="dvclear">Checked, and the seal was unbroken. Ready to accept.</span>
          ) : (
            <span className={compromised ? 'dvstop' : 'dvtodo'}>{m.blockedReason}</span>
          )}
        </p>
      )}
    </li>
  );
}

/* ==========================================================================
 * What the last action did, and what it refused
 * ======================================================================== */

/**
 * The server's refusal, verbatim, announced the moment it appears.
 *
 * **The one that matters most is not a validation message.** A code that is not
 * on this delivery gets §3A.3's own sentence — *"Seal 88-041992 is not on this
 * delivery. Do not accept this machine."* — and it is rendered exactly as the
 * server wrote it. Summarising it, or styling it as a form error beside the
 * input, would turn an instruction to refuse a machine into a typo notice.
 */
function Refusal({ failure }: { failure: ApiFailure }): React.JSX.Element {
  return (
    <div className="dvalert" role="alert">
      <h2>{failure.message}</h2>
      {Object.entries(failure.fields).map(([field, message]) => (
        <p key={field}>{message}</p>
      ))}
    </div>
  );
}

/** What was just recorded, so the buyer knows the tap landed. */
function Recorded({
  serialNumber,
  status,
  returnNumber,
}: {
  serialNumber: string;
  status: string;
  returnNumber: string | null;
}): React.JSX.Element {
  const bad = status === 'BROKEN' || status === 'MISSING';
  return (
    <div className={bad ? 'dvdone bad' : 'dvdone'} role="status">
      <h2>
        {bad ? 'Do not accept ' : 'Checked '}
        <span className="mono">{serialNumber}</span>
      </h2>
      <p>
        {bad
          ? 'The seal is recorded as one we cannot vouch for, and that machine is now off sale everywhere on the platform.'
          : 'The seal was verified as unbroken by you, and that is now on the machine’s permanent record.'}
      </p>
      {returnNumber && (
        <p className="dvret">
          We have opened return <span className="mono">{returnNumber}</span> for you —{' '}
          <a href={`/account/returns/${encodeURIComponent(returnNumber)}`}>track it here</a>. You do
          not need to call anybody.
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * States that are not the record
 * ======================================================================== */

function LoadingRecord(): React.JSX.Element {
  return (
    <>
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="rec dvrec">
        <main className="evid">
          <Skeleton className="h-72 w-full rounded-lg" />
        </main>
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    </>
  );
}

function SignedOut({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to check these seals"
        body="A delivery belongs to the organisation that ordered it, so we need to know who is asking. Signing in brings you straight back here."
        action={
          <a
            className="pill acc"
            href={`/sign-in?next=${encodeURIComponent(`/account/orders/${orderNumber}/delivery`)}`}
          >
            Sign in
          </a>
        }
      />
    </div>
  );
}

/**
 * No such order **on this account**.
 *
 * Deliberately the same screen for an order that does not exist and one that
 * belongs to another organisation — the API answers 404 for both, because order
 * numbers are sequential and a screen that distinguished them would let anyone
 * with an account count our orders.
 */
function Missing({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="We have no order with that number on your account"
        body={
          <>
            Nothing on your organisation&rsquo;s account is numbered{' '}
            <span className="mono">{orderNumber}</span>. Check it against your confirmation — ours
            look like <span className="mono">TT-26-00004</span>.
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
        <h3>We could not load this delivery</h3>
        <p>{message}</p>
        <p>
          The machines and their seals are unaffected — this is a screen that could not load, not a
          record that changed. If a machine is in front of you and you cannot check it here, do not
          sign for it.
        </p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
