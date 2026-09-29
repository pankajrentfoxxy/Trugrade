import * as React from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState, Skeleton, cn } from '@trugrade/ui';
import { NotMeasured } from '../../lib/controls';
import { usePrincipal } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { AssignDialog } from '../ops/OrderRecord';
import { atTime, elapsed, initials, onDay, shortName, stageMeta, stageOf } from './OrderInspections';
import type { OrderInspectionSlot, OrderInspectionView } from './order-inspection-types';

/**
 * ARCHETYPE C — Record. Identity header + evidence panel + side panel.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * One order visit, at the supply point. Ops sends the technician from here —
 * a day, a slot, a name — and reads back what was recorded, when, and by
 * whom. No serial is typed here: the technician reads each one off the
 * sticker on the inspection form (`/qc/visits/:id/inspect`), where the serial
 * names the machine and the twelve-area report is recorded against it.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.iv-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as the queue it opens from:
 *
 * - **Every timestamp and name is the server's.** The three-step timeline is
 *   the visit's own `assignedAt` / `completedAt` / `verifiedAt` and the people
 *   on them; a step that has not happened is drawn as not happened.
 * - **The two serial checks are stated only for a recorded serial**, because
 *   they are what the server enforced when it accepted it: the nationwide
 *   unique index and the stolen-device list both had to pass for the row to
 *   exist. A machine with no serial says "Not recorded" — never a tick.
 * - **The design's two header actions are not here.** "Request a correction"
 *   and "Schedule a recheck" have no route that takes a visit: corrections are
 *   raised by an inspection report (this flow writes none) and rechecks are
 *   sampled by the audit job. Two buttons that lead nowhere would teach the
 *   reader the capability exists.
 */

const CheckIcon = ({ size = 12 }: { size?: number }): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l5 5 9-10" />
  </svg>
);
const CopyIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </svg>
);

/** `28 Sep, 11:07 am`. */
const onDayAt = (iso: string): string => `${onDay(iso).replace(/ \d{4}$/, '')}, ${atTime(iso)}`;

type StepState = 'done' | 'current' | 'next';

function steps(v: OrderInspectionView): Array<{ label: string; state: StepState; meta: React.ReactNode }> {
  const recorded = v.slots.filter((s) => s.inspectedAt !== null).length;
  const total = v.slots.length;
  const closed = v.status === 'COMPLETED' || v.status === 'CANCELLED';
  return [
    {
      label: 'Technician assigned',
      state: v.assignedAt ? 'done' : 'next',
      meta: v.assignedAt ? (
        <>
          <span className="mono">{onDayAt(v.assignedAt)}</span>
          {v.assignedByName ? ` · by ${v.assignedByName}` : ''}
        </>
      ) : (
        'Not yet'
      ),
    },
    {
      label: 'Serials recorded',
      state: v.completedAt ? 'done' : recorded > 0 || v.status === 'IN_PROGRESS' ? 'current' : 'next',
      meta: v.completedAt ? (
        <>
          <span className="mono">{atTime(v.completedAt)}</span>
          {v.technicianName ? ` · by ${v.technicianName}` : ''}
          {v.assignedAt ? ` · ${elapsed(v.assignedAt, v.completedAt)}` : ''}
        </>
      ) : closed ? (
        `${recorded} of ${total} before the visit closed`
      ) : (
        `${recorded} of ${total} so far`
      ),
    },
    {
      label: 'Verified by ops',
      state: v.verifiedAt ? 'done' : 'next',
      meta: v.verifiedAt ? (
        <>
          <span className="mono">{atTime(v.verifiedAt)}</span>
          {v.verifiedByName ? ` · by ${v.verifiedByName}` : ''}
        </>
      ) : v.completedAt ? (
        'Waiting for ops'
      ) : (
        'After every serial is recorded'
      ),
    },
  ];
}

export function OrderInspectionRoute(): React.JSX.Element {
  const { visitId = '' } = useParams();
  const principal = usePrincipal();
  const canInspect = principal?.permissions.includes('qc.visit.execute') ?? false;
  const canAssign = principal?.permissions.includes('qc.visit.schedule') ?? false;
  const [assigning, setAssigning] = React.useState(false);
  const canOpenOrders = principal?.permissions.includes('ordering.any.read') ?? false;
  const canOpenPos = principal?.permissions.includes('procurement.po.read_any') ?? false;
  const [reloadToken, setReloadToken] = React.useState(0);
  const { data, error } = useResource<OrderInspectionView>(
    `/api/qc/order-inspections/${encodeURIComponent(visitId)}`,
    'That visit could not be opened',
    reloadToken,
  );

  if (error) {
    return (
      <EmptyState
        title="That visit did not load"
        body={
          <>
            {error}.{' '}
            <Link className="text-acc-ink underline underline-offset-4" to="/qc/orders">
              Back to the inspection queue
            </Link>
            .
          </>
        }
      />
    );
  }
  if (!data) {
    return (
      <div className="inspection-visit">
        <div className="iv-head">
          <div>
            <h1 className="iv-title">Inspection</h1>
            <p className="iv-sub">Loading the visit.</p>
          </div>
        </div>
        <div className="iv-card" aria-busy="true">
          <div className="iv-card__head">
            <Skeleton lines={1} />
          </div>
          <div style={{ padding: '16px 22px' }}>
            <Skeleton lines={6} />
          </div>
        </div>
      </div>
    );
  }

  const closed = data.status === 'COMPLETED' || data.status === 'CANCELLED';
  const total = data.slots.length;
  const recorded = data.slots.filter((s) => s.inspectedAt !== null).length;
  const verified = data.slots.filter((s) => s.verifiedAt !== null).length;
  const remaining = total - recorded;
  const allVerified = total > 0 && verified === total;
  const stage = stageOf(data);
  const pill = stageMeta(stage);
  const timeline = steps(data);

  const orderRef = canOpenOrders ? (
    <Link className="mono" to={`/orders/${data.orderNumber}`}>
      {data.orderNumber}
    </Link>
  ) : (
    <span className="mono">{data.orderNumber}</span>
  );

  return (
    <div className="inspection-visit">
      <div>
        <nav className="iv-crumb" aria-label="Breadcrumb">
          <Link to="/qc/orders">Order inspections</Link>
          <span aria-hidden="true">/</span>
          <span className="mono">{data.visitNumber}</span>
        </nav>
        <div className="iv-head">
          <div>
            <div className="iv-title-row">
              <h1 className="iv-title">
                Inspection <span className="mono">{data.visitNumber}</span>
              </h1>
              <span className={cn('iv-pill', pill.pill.replace('oi-pill', 'iv-pill'))}>{pill.label}</span>
            </div>
            <p className="iv-sub">
              For order {orderRef} ·{' '}
              <strong>
                {recorded} of {total}
              </strong>{' '}
              machines recorded{allVerified ? ' and verified' : ''} ·{' '}
              {data.status === 'CANCELLED'
                ? 'visit cancelled'
                : closed
                  ? allVerified
                    ? 'visit closed'
                    : 'waiting for verification'
                  : remaining > 0
                    ? `${remaining} still to record`
                    : 'waiting for verification'}
            </p>
          </div>
        </div>
      </div>

      <ol className="iv-steps" aria-label="Visit timeline">
        {timeline.map((s) => (
          <li key={s.label} className={cn('iv-step', `is-${s.state}`)}>
            <div className="iv-step__track">
              <span className="iv-step__dot" aria-hidden="true">
                {s.state === 'done' && <CheckIcon />}
              </span>
              <span className="iv-step__line" />
            </div>
            <span className="iv-step__label">
              {s.label}
              <span className="sr-only">
                {s.state === 'done' ? ' — done' : s.state === 'current' ? ' — in progress' : ' — not yet'}
              </span>
            </span>
            <span className="iv-step__meta">{s.meta}</span>
          </li>
        ))}
      </ol>

      <div className="iv-grid">
        <section className="iv-card" aria-labelledby="iv-m-h">
          <div className="iv-card__head">
            <h2 id="iv-m-h">{closed ? 'Machines recorded' : 'Machines to record'}</h2>
            <span className="meta">
              {recorded} of {total}
              {recorded === total && total > 0
                ? ' · all serials passed checks'
                : closed
                  ? ' recorded'
                  : ' · serials are recorded on the inspection form'}
            </span>
            {canInspect && !closed && remaining > 0 && <Link to={`/qc/visits/${data.visitId}/inspect`}>Record an inspection</Link>}
          </div>
          {data.slots.map((slot, i) => (
            <MachineRow key={slot.slotId} index={i + 1} slot={slot} />
          ))}
          {total === 0 && (
            <p className="iv-empty">
              <NotMeasured
                why="No machine on the order falls under this consignment"
                label="No machines on this visit"
              />
            </p>
          )}
        </section>

        <aside className="iv-col">
          <section className="iv-card iv-side" aria-labelledby="iv-v-h">
            <h2 id="iv-v-h">Visit</h2>
            <div className="iv-person">
              {data.technicianName ? (
                <>
                  <span className="iv-avatar" aria-hidden="true">
                    {initials(data.technicianName)}
                  </span>
                  <div>
                    <div className="iv-person__name">{data.technicianName}</div>
                    <div className="iv-person__role">Technician</div>
                  </div>
                </>
              ) : (
                <NotMeasured why="No technician has been assigned to this visit" label="No technician assigned" />
              )}
            </div>
            {canAssign && !closed && (
              <div className="iv-assign">
                <button type="button" className="iv-btn" onClick={() => setAssigning(true)}>
                  {data.technicianName ? 'Reassign' : 'Assign technician'}
                </button>
                <AssignDialog
                  open={assigning}
                  onClose={() => setAssigning(false)}
                  orderNumber={data.orderNumber}
                  current={data.technicianName}
                  onAssigned={() => {
                    setAssigning(false);
                    setReloadToken((n) => n + 1);
                  }}
                />
              </div>
            )}
            <dl className="iv-kv">
              <div>
                <dt>Scheduled</dt>
                <dd>
                  {data.scheduledDate ? (
                    <span className="mono">{onDay(`${data.scheduledDate}T00:00:00Z`)}</span>
                  ) : (
                    <NotMeasured why="No day has been booked for this visit" label="No day booked" />
                  )}
                </dd>
              </div>
              <div>
                <dt>Supply point</dt>
                <dd>
                  {data.vendorLegalName ? (
                    <span title={data.vendorLegalName}>{shortName(data.vendorLegalName)}</span>
                  ) : (
                    <NotMeasured why="The supply point could not be resolved" label="Unresolved" />
                  )}
                </dd>
              </div>
              <div>
                <dt>Order</dt>
                <dd>{orderRef}</dd>
              </div>
              <div>
                <dt>Purchase order</dt>
                <dd>
                  {data.purchaseOrderNumber ? (
                    canOpenPos ? (
                      <Link className="mono" to={`/procurement/pos?q=${encodeURIComponent(data.purchaseOrderNumber)}`}>
                        {data.purchaseOrderNumber}
                      </Link>
                    ) : (
                      <span className="mono">{data.purchaseOrderNumber}</span>
                    )
                  ) : (
                    // Never a dash: on a verified visit it means we are about
                    // to ship machines we have no record of buying.
                    <NotMeasured
                      why="No purchase order has been raised to this supply point for this order"
                      label="None raised"
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Machines</dt>
                <dd className="mono">{total}</dd>
              </div>
            </dl>
            {data.site && (
              <address className="iv-addr">
                {data.site.line1}
                <br />
                {data.site.city} <span className="mono">{data.site.pincode}</span>
              </address>
            )}
          </section>

          <section className="iv-card iv-side" aria-labelledby="iv-r-h">
            <h2 id="iv-r-h">Serial checks</h2>
            <ul className="iv-rules">
              <li>
                <CheckIcon size={14} />
                <span>
                  <strong>Unique.</strong> A serial can be live in only one place on the platform.
                </span>
              </li>
              <li>
                <CheckIcon size={14} />
                <span>
                  <strong>Not stolen.</strong> Checked against the stolen-device list.
                </span>
              </li>
              <li className="fine">
                If either check fails, the serial is refused and the reason is shown to the technician.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ======================================================================== */

function MachineRow({ index, slot }: { index: number; slot: OrderInspectionSlot }): React.JSX.Element {
  return (
    <div className="iv-mach">
      <span className="iv-mach__n" aria-hidden="true">
        {index}
      </span>
      <div>
        <div className="iv-mach__name">
          {slot.title ?? (
            <NotMeasured why="The SKU behind this line has been withdrawn" label="Model withdrawn" />
          )}
          <span className="iv-grade" title="Grade sold at">
            {slot.grade}
          </span>
        </div>
        {slot.specSummary && <div className="iv-mach__spec">{slot.specSummary}</div>}
      </div>

      {slot.serialNumber ? (
        <div className="iv-serial">
          <span className="iv-serial__label">Serial</span>
          <span className="iv-serial__row">
            <span className="iv-serial__value">{slot.serialNumber}</span>
            <CopyButton serial={slot.serialNumber} />
          </span>
          {/* Both checks are what the server enforced to accept this serial. */}
          <span className="iv-checks">
            <span>
              <CheckIcon />
              Unique
            </span>
            <span>
              <CheckIcon />
              Not on stolen list
            </span>
          </span>
        </div>
      ) : (
        <div className="iv-serial">
          <span className="iv-serial__label">Serial</span>
          <NotMeasured why="This machine has not been recorded yet" label="Not recorded" />
        </div>
      )}

      <div className="iv-state">
        {slot.verifiedAt ? (
          <span className="iv-pill iv-pill--ok iv-pill--sm">Verified</span>
        ) : slot.inspectedAt ? (
          <span className="iv-pill iv-pill--info iv-pill--sm">Recorded</span>
        ) : (
          <span className="iv-pill iv-pill--neutral iv-pill--sm">Not recorded</span>
        )}
        {slot.inspectedAt && (
          <span className="iv-state__time">
            Recorded <span className="mono">{atTime(slot.inspectedAt)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function CopyButton({ serial }: { serial: string }): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <>
      <button
        type="button"
        className="iv-copy"
        aria-label={`Copy serial ${serial}`}
        title="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(serial).then(() => setCopied(true));
        }}
      >
        <CopyIcon />
      </button>
      <span role="status" className={copied ? 'iv-copied' : 'sr-only'}>
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}
