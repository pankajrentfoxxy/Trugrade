import * as React from 'react';
import { Link, useParams } from 'react-router';
import { type Grade } from '@trugrade/contracts';
import {
  BatteryBar,
  DataBoard,
  EmptyState,
  GradeBadge,
  RecordHeader,
  ScoreRing,
  SealChip,
  SidePanel,
  Skeleton,
  StatusPill,
  type Column,
  type SealStatus,
} from '@trugrade/ui';
import { Board, Datum, NotMeasured, Section } from '../../lib/controls';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import {
  gradeLabel,
  humanise,
  onDate,
  onDateTime,
  RETURN_TONE,
  rupees,
  UNIT_API,
  UNIT_TONE,
  VERDICT_TONE,
  WARRANTY_TONE,
  type Unit360,
  type Unit360Movement,
  type Unit360Return,
} from './api';

/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * One machine's whole life — T35, `03_UX_SPEC.md` §3C.
 *
 * **This is the most dangerous screen in the product for anonymity, and the
 * defence is on the server.** A serial's life touches the supply point that sold
 * it to us and the buyer we sold it to, and the two must never learn of each
 * other. The response is built field by field from a hand-written allow-list in
 * `ConsoleController` — there is no `return unit` behind it — and the route is
 * refused outright to any principal whose org is not the platform's.
 *
 * **Two halves, two permissions.** `listing.any.read` opens the machine: what it
 * is, what we found when we opened it, where it has been, whether it came back.
 * The trade — buyer, price, purchase order, margin — needs `ordering.any.read`
 * as well, so a TECHNICIAN reading this screen sees the machine and is told in
 * words that the commercial side is not theirs. Nothing is blanked silently.
 *
 * **Read-only, and the screen says so rather than showing a dead button.** §3C
 * lists reallocate, withdraw and force-progress against a unit. Each is a
 * transaction across `listing`, `ordering` and `procurement` that no service in
 * this codebase performs, and `identity.audit_log` is append-only enforced by a
 * trigger, so nothing here offers to edit or delete a single recorded fact.
 *
 * **Nothing on this screen is coloured by outcome except the QC verdict.** A
 * grade is a position on a scale and stays neutral; a unit status, a seal, a
 * warranty and a stock movement are none of them verdicts. Green and red belong
 * to PASS and FAIL, and on this screen that is the inspection and nothing else.
 */

const MOVEMENT_COLUMNS: ReadonlyArray<Column<Unit360Movement>> = [
  {
    key: 'at',
    header: 'When',
    cell: (m) => <span className="whitespace-nowrap font-mono tnum text-ink-2">{onDateTime(m.at)}</span>,
  },
  {
    key: 'change',
    header: 'State',
    cell: (m) => (
      <span className="whitespace-nowrap text-ink">
        {m.fromStatus === null ? (
          <span className="text-ink-3">first recorded as </span>
        ) : (
          <>
            <span className="text-ink-3">{humanise(m.fromStatus)}</span>
            <span className="px-2 text-ink-4" aria-label="became">
              →
            </span>
          </>
        )}
        {humanise(m.toStatus)}
      </span>
    ),
  },
  {
    key: 'where',
    header: 'Where',
    cell: (m) =>
      m.toLocation === null ? (
        <NotMeasured why="This movement recorded no location" label="Not recorded" />
      ) : m.fromLocation === m.toLocation ? (
        <span className="text-ink-3">{humanise(m.toLocation)}, unchanged</span>
      ) : (
        <span className="text-ink-2">
          {m.fromLocation === null ? '' : `${humanise(m.fromLocation)} → `}
          {humanise(m.toLocation)}
        </span>
      ),
  },
  {
    key: 'reason',
    header: 'Why',
    cell: (m) =>
      m.reason ?? (
        <NotMeasured
          why="Whoever wrote this movement recorded no reason for it"
          label="No reason recorded"
        />
      ),
  },
  {
    key: 'actor',
    header: 'Who',
    cell: (m) =>
      // Never "System". A movement whose actor is a guess is worse than one that
      // admits no person was recorded against it.
      m.actorName ?? (
        <NotMeasured
          why="No signed-in person was recorded against this movement — it was written by a job, or the account behind it no longer exists"
          label="No person recorded"
        />
      ),
  },
];

const RETURN_COLUMNS: ReadonlyArray<Column<Unit360Return>> = [
  {
    key: 'number',
    header: 'Return',
    cell: (r) => (
      <span className="whitespace-nowrap font-mono tnum tracking-[0.06em] text-ink">
        {r.returnNumber}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'State',
    cell: (r) => (
      <StatusPill
        tone={RETURN_TONE[r.status] ?? 'neutral'}
        label={humanise(r.status)}
        className="whitespace-nowrap"
      />
    ),
  },
  { key: 'reason', header: 'Reason given', cell: (r) => humanise(r.reasonCode) },
  {
    key: 'raised',
    header: 'Raised',
    cell: (r) => <span className="whitespace-nowrap font-mono tnum text-ink-2">{onDate(r.raisedAt)}</span>,
  },
  {
    // Verdict and liability in one cell, not two columns. They are one finding —
    // "the complaint holds and it is the supply point's" — and splitting them
    // pushed a six-column table past the evidence column at 1440, which is a
    // sideways scroll for something that fits.
    key: 'verdict',
    header: 'Our re-inspection',
    cell: (r) =>
      r.qcVerdict === null ? (
        <NotMeasured
          why="This machine has not been re-inspected since it came back, so nothing here says whether the complaint holds, or whose fault it is"
          label="Not re-inspected"
        />
      ) : (
        <span className="flex flex-col gap-1">
          <StatusPill
            tone={VERDICT_TONE[r.qcVerdict] ?? 'neutral'}
            label={humanise(r.qcVerdict)}
            className="whitespace-nowrap"
          />
          <span className="text-body-sm text-ink-3">
            {r.liableParty === null ? 'Liability not decided' : `${humanise(r.liableParty)} liable`}
          </span>
        </span>
      ),
  },
];

export function Unit360Route(): React.JSX.Element {
  const { serial = '' } = useParams();
  const { principal } = useAuth();
  const canOpenOrders = principal?.permissions.includes('ordering.any.read') ?? false;
  const { data, error } = useResource<Unit360>(
    UNIT_API.unit(serial),
    'That machine could not be opened',
  );

  if (error) {
    return (
      <EmptyState
        title="That machine did not load"
        body={
          <>
            {error}. Nothing has been changed. A serial that is not on this platform reads the same
            way — press <kbd className="font-mono text-data">Ctrl</kbd> +{' '}
            <kbd className="font-mono text-data">K</kbd> and search for it to be sure.
          </>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="tg-stack">
        <Skeleton lines={3} />
        <div className="tg-card rounded-lg border border-rule bg-sheet">
          <Skeleton lines={6} />
        </div>
      </div>
    );
  }

  const declaredDiffers = data.gradeActual !== null && data.gradeActual !== data.gradeDeclared;

  return (
    <div className="tg-stack">
      <RecordHeader
        title={data.serialNumber}
        subtitle={
          data.machine ? (
            <>
              {data.machine.title} · <span className="text-ink-3">{data.machine.spec}</span>
            </>
          ) : (
            'The catalog entry behind this machine has been withdrawn, so its model and specification cannot be stated.'
          )
        }
        status={
          <StatusPill
            tone={UNIT_TONE[data.status] ?? 'neutral'}
            label={humanise(data.status)}
          />
        }
        identifiers={[
          {
            label: 'Inspected grade',
            value:
              data.gradeActual === null ? (
                <NotMeasured
                  why="No technician has graded this machine. The vendor's declared grade is not a substitute for one"
                  label="Not inspected"
                />
              ) : (
                <GradeBadge
                  grade={data.gradeActual as Grade}
                  {...(declaredDiffers
                    ? { variant: 'corrected' as const, previousGrade: data.gradeDeclared as Grade }
                    : {})}
                />
              ),
          },
          {
            label: 'Seal',
            value: data.seal ? (
              // APPLIED is not INTACT: sealed is not checked, and only a seal
              // somebody has looked at since is green.
              <SealChip sealCode={data.seal.sealCode} status={data.seal.status as SealStatus} />
            ) : (
              <NotMeasured
                why="No tamper seal has ever been applied to this machine"
                label="Not sealed"
              />
            ),
          },
          {
            label: 'Supply point',
            value: data.supplyPointLegalName ?? (
              <NotMeasured
                why="The organisation this machine came from could not be resolved"
                label="Unresolved"
              />
            ),
          },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* `min-w-0` is load-bearing and its absence is invisible until 600px.
            A grid item's default `min-width` is `auto`, so this column refuses
            to shrink below the min-content of its widest child — the movement
            table's `min-width` — and the PAGE then scrolls sideways under a
            footer that stops at the viewport edge. 09_FRONTEND_LOCKED: wide
            content scrolls inside its own container, the body never does. */}
        <div className="min-w-0">
          {/* ------------------------------------------------------------- */}
          <Section
            title="What we found when we opened it"
            subtitle={
              data.qc
                ? 'Measured by a technician holding the machine. Every number below came from the QC tool or from a scored area — none of it is the vendor’s declaration.'
                : undefined
            }
            aside={
              data.qc?.verdict ? (
                <StatusPill
                  // The one verdict on this screen, and therefore the one place
                  // green and red are correct.
                  tone={VERDICT_TONE[data.qc.verdict] ?? 'neutral'}
                  label={humanise(data.qc.verdict)}
                />
              ) : undefined
            }
          >
            {data.qc ? (
              <>
                {!data.qc.isCurrent && (
                  <p className="mb-4 rounded border border-warn px-4 py-3 text-body-sm text-warn">
                    A later inspection has superseded this report. What you are reading is the
                    grade this machine carried at the time, not the grade it carries now.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-6">
                  <ScoreRing value={data.qc.score} label="Inspection score" />
                  <div className="flex min-w-[220px] flex-col gap-3">
                    {data.qc.batteryHealthPct === null ? (
                      <NotMeasured
                        why="The QC tool reported no battery reading for this machine"
                        label="Battery not measured"
                      />
                    ) : (
                      <BatteryBar
                        healthPct={Number(data.qc.batteryHealthPct)}
                        {...(data.qc.cycleCount === null ? {} : { cycleCount: data.qc.cycleCount })}
                      />
                    )}
                    {/* ponytail: no `QcChip` here. It prints the same number as
                        the ring beside it, and 09_FRONTEND_LOCKED rule 1 spends
                        amber on a measured value ONCE — two amber renderings of
                        one score is the colour marking nothing, which is what
                        T37, T38 and T39 each had to undo. The chip belongs on a
                        product card, where there is no ring. */}
                  </div>
                </div>

                <dl className="mt-5 grid gap-x-8 sm:grid-cols-2">
                  <Datum label="Inspected on">
                    {data.qc.inspectedAt ? (
                      onDateTime(data.qc.inspectedAt)
                    ) : (
                      <NotMeasured
                        why="This report was started and never completed"
                        label="Never completed"
                      />
                    )}
                  </Datum>
                  <Datum label="Inspection valid until">
                    {data.qc.validUntil ? (
                      <span className="font-mono tnum">{onDate(data.qc.validUntil)}</span>
                    ) : (
                      <NotMeasured
                        why="No expiry was recorded on this inspection"
                        label="Not set"
                      />
                    )}
                  </Datum>
                  <Datum label="Technician">
                    {/* Pseudonymous by design — §3A.1. A technician is
                        identified by their code, never by name, on any screen a
                        report can reach. */}
                    {data.qc.technicianCode ?? (
                      <NotMeasured
                        why="The technician on this report could not be resolved"
                        label="Unresolved"
                      />
                    )}
                  </Datum>
                  <Datum label="Grade the tool proposed">
                    {data.qc.gradeProposed === null ? (
                      <NotMeasured
                        why="This report records no proposed grade"
                        label="Not proposed"
                      />
                    ) : (
                      gradeLabel(data.qc.gradeProposed)
                    )}
                  </Datum>
                  <Datum label="Charge cycles">
                    {data.qc.cycleCount === null ? (
                      <NotMeasured
                        why="The QC tool reported no cycle count. Zero cycles and no reading are different facts"
                        label="Not reported"
                      />
                    ) : (
                      <span className="font-mono tnum">{data.qc.cycleCount}</span>
                    )}
                  </Datum>
                  <Datum label="Hours powered on">
                    {data.qc.powerOnHours === null ? (
                      <NotMeasured
                        why="The drive's SMART data carried no power-on hours"
                        label="Not reported"
                      />
                    ) : (
                      <span className="font-mono tnum">{data.qc.powerOnHours}</span>
                    )}
                  </Datum>
                  <Datum label="Processor detected">
                    {data.qc.cpu ?? (
                      <NotMeasured
                        why="The QC tool recorded no processor for this machine"
                        label="Not detected"
                      />
                    )}
                  </Datum>
                  <Datum label="Memory detected">
                    {data.qc.ramGb === null ? (
                      <NotMeasured
                        why="The QC tool recorded no memory reading"
                        label="Not detected"
                      />
                    ) : (
                      <span className="font-mono tnum">
                        {data.qc.ramGb} GB
                        {/* The tool's reading against the catalog's claim. A
                            divergence is exactly why we open the machine, so it
                            is stated rather than quietly overwritten. */}
                        {data.machine && !data.machine.spec.includes(`${data.qc.ramGb} GB`) && (
                          <span className="ml-2 font-sans text-body-sm text-warn">
                            the catalog entry says otherwise
                          </span>
                        )}
                      </span>
                    )}
                  </Datum>
                </dl>
              </>
            ) : (
              <EmptyState
                title="This machine has never been inspected"
                body={
                  <>
                    {data.qcUnavailable}{' '}
                    <span className="text-ink-4">
                      Its declared grade is {gradeLabel(data.gradeDeclared)}, which is what the
                      supply point said about it and not what anybody has checked.
                    </span>
                  </>
                }
              />
            )}
          </Section>

          {/* ------------------------------------------------------------- */}
          <Section
            title="The trade"
            subtitle={
              data.commercial
                ? 'What the buyer paid us, what we agreed to pay the supply point, and the difference. This screen and the order record are the only two in the product that show both.'
                : undefined
            }
          >
            {data.commercial ? (
              <>
                <dl className="grid gap-x-8 sm:grid-cols-2">
                  <Datum label="Order">
                    <span className="flex flex-wrap items-center gap-2">
                      {canOpenOrders ? (
                        <Link
                          className="whitespace-nowrap font-mono tnum text-ink underline underline-offset-4 hover:text-acc-ink"
                          to={`/orders/${data.commercial.orderNumber}`}
                        >
                          {data.commercial.orderNumber}
                        </Link>
                      ) : (
                        <span className="whitespace-nowrap font-mono tnum text-ink">
                          {data.commercial.orderNumber}
                        </span>
                      )}
                      <StatusPill
                        tone="neutral"
                        label={humanise(data.commercial.orderStatus)}
                        className="whitespace-nowrap"
                      />
                    </span>
                  </Datum>
                  <Datum label="Buyer">
                    {data.commercial.buyerLegalName ?? (
                      <NotMeasured
                        why="The organisation on that order could not be resolved"
                        label="Unresolved"
                      />
                    )}
                  </Datum>
                  <Datum label="Placed">{onDate(data.commercial.placedAt)}</Datum>
                  <Datum label="State of this line">
                    {humanise(data.commercial.lineStatus)}
                  </Datum>
                </dl>

                <div className="mt-5 rounded border border-rule bg-sheet-2 p-4">
                  <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
                    <div className="flex flex-col gap-1">
                      <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                        Sold for
                      </dt>
                      <dd className="font-mono tnum text-body text-ink">
                        {rupees(data.commercial.soldFor)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                        We pay
                      </dt>
                      <dd className="font-mono tnum text-body text-ink">
                        {data.commercial.paid === null ? (
                          <NotMeasured
                            why="No purchase-order line covers this serial"
                            label="Not recorded"
                          />
                        ) : (
                          rupees(data.commercial.paid)
                        )}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                        Margin on this machine
                      </dt>
                      {data.commercial.margin === null ? (
                        // Never a zero and never a dash. `--ink-4`, with the
                        // reason, because a blank in a money column reads as a
                        // measured nothing.
                        <dd className="max-w-prose text-body-sm text-ink-4">
                          {data.commercial.poUnavailable}
                        </dd>
                      ) : (
                        // The one amber measured value on this screen — rule 1's
                        // second meaning, spent once.
                        <dd className="font-mono tnum text-h3 text-acc-ink">
                          {rupees(data.commercial.margin)}
                        </dd>
                      )}
                    </div>
                  </dl>
                </div>

                <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
                  <Datum label="Purchase order">
                    {data.commercial.poNumber === null ? (
                      <NotMeasured
                        why="No purchase order was raised for this machine, so what we agreed to pay for it is not recorded anywhere"
                        label="None raised"
                      />
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="whitespace-nowrap font-mono tnum text-ink">
                          {data.commercial.poNumber}
                        </span>
                        {data.commercial.poStatus && (
                          <StatusPill
                            tone="neutral"
                            label={humanise(data.commercial.poStatus)}
                            className="whitespace-nowrap"
                          />
                        )}
                      </span>
                    )}
                  </Datum>
                  <Datum label="Valuation">
                    {data.valuationMethod === 'MARGIN'
                      ? 'Margin scheme — Rule 32(5), no input tax credit'
                      : 'Regular — input tax credit available to the buyer'}
                  </Datum>
                </dl>
              </>
            ) : (
              <EmptyState
                title={
                  canOpenOrders
                    ? 'This machine has never been sold'
                    : 'The commercial side is not yours to see'
                }
                body={data.commercialUnavailable ?? undefined}
              />
            )}
          </Section>

          {/* ------------------------------------------------------------- */}
          <Section
            title="Everywhere it has been"
            subtitle="Every recorded change of state or location, newest first. This is the closest thing this product has to a custody trail for one serial."
          >
            <Board tableMinWidth={760}>
              <DataBoard
                caption={`${data.movements.length} recorded ${data.movements.length === 1 ? 'movement' : 'movements'} for this machine, newest first.`}
                columns={MOVEMENT_COLUMNS}
                rows={data.movements}
                rowKey={(m) => `${m.at}-${m.toStatus}`}
                empty={
                  <EmptyState
                    title="No movement was ever recorded"
                    body="A machine gets a movement row each time its state or its location changes. None here means nothing has moved it since it was created — not that its history was lost."
                  />
                }
              />
            </Board>
          </Section>

          {/* ------------------------------------------------------------- */}
          <Section
            title="After the sale"
            subtitle="Cover, and anything that came back."
          >
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <Datum label="Warranty">
                {data.warranty ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      tone={WARRANTY_TONE[data.warranty.status] ?? 'neutral'}
                      label={humanise(data.warranty.status)}
                      className="whitespace-nowrap"
                    />
                    <span className="font-mono tnum text-ink-2">
                      {onDate(data.warranty.startDate)} – {onDate(data.warranty.endDate)}
                    </span>
                  </span>
                ) : (
                  <NotMeasured
                    why="No warranty has been opened on this machine. Cover starts at delivery, so a machine that has not been delivered has none"
                    label="No cover opened"
                  />
                )}
              </Datum>
              <Datum label="Who carries the cover">
                {data.warranty ? (
                  <span className="text-ink-2">
                    <span className="font-mono tnum text-ink">
                      {data.warranty.vendorBackedMonths}
                    </span>{' '}
                    of{' '}
                    <span className="font-mono tnum">{data.warranty.totalMonths}</span> months on
                    the supply point,{' '}
                    <span className="font-mono tnum text-ink">
                      {data.warranty.platformBackedMonths}
                    </span>{' '}
                    on us
                  </span>
                ) : (
                  <NotMeasured why="There is no warranty to apportion" label="Not applicable" />
                )}
              </Datum>
            </dl>

            <div className="mt-4">
              {data.returns.length > 0 ? (
                <Board tableMinWidth={560}>
                  <DataBoard
                    caption={`${data.returns.length} ${data.returns.length === 1 ? 'return' : 'returns'} raised against this machine.`}
                    columns={RETURN_COLUMNS}
                    rows={data.returns}
                    rowKey={(r) => r.returnNumber}
                  />
                </Board>
              ) : (
                <p className="text-body-sm text-ink-3">
                  No return has been raised against this machine.
                </p>
              )}
            </div>
          </Section>

          {/* ------------------------------------------------------------- */}
          <Section
            title="The audit log"
            subtitle="What identity.audit_log — the platform’s append-only evidence table — records about this serial."
          >
            {data.auditEntries > 0 ? (
              <p className="text-body-sm text-ink-2">
                <span className="font-mono tnum text-ink">{data.auditEntries}</span> audit{' '}
                {data.auditEntries === 1 ? 'entry names' : 'entries name'} this machine. Open them
                on{' '}
                <Link className="text-ink underline underline-offset-4 hover:text-acc-ink" to="/audit-log">
                  the audit-log viewer
                </Link>
                .
              </p>
            ) : (
              <EmptyState
                title="No audit entry names this machine"
                body={
                  <>
                    That is a gap in the product and not a clean history.{' '}
                    <span className="font-mono tnum">audit_log</span> records who signed in, who
                    reviewed an application and who downloaded an invoice — nothing in a machine’s
                    life writes to it, so <strong className="text-ink">every</strong> serial on this
                    platform reads exactly like this one. What a serial’s life is actually evidenced
                    by is the movement table above.
                  </>
                }
              />
            )}
          </Section>
        </div>

        {/* --------------------------------------------------------------- */}
        <SidePanel
          title="This machine"
          description="A record screen, and read-only. Everything on it is a fact, not a control."
          footnote={
            <>
              §3C also asks for reallocate-a-unit, withdraw and force-progress against a serial.
              None of the three is built: each is a transaction across three schemas that no service
              in this product performs, and a button that looks like it works and does not is worse
              than its absence. The audit log is append-only, enforced by a database trigger —
              nothing anywhere in this console offers to edit or delete one of its rows.
            </>
          }
        >
          <dl className="flex flex-col">
            <Datum label="Declared by the supply point">
              {gradeLabel(data.gradeDeclared)}
              {declaredDiffers && (
                <span className="ml-2 font-sans text-body-sm text-warn">
                  we graded it {gradeLabel(data.gradeActual ?? '')}
                </span>
              )}
            </Datum>
            <Datum label="Sellable right now">
              {data.isSellable ? (
                'Yes'
              ) : (
                // Not a fail. A machine already sold is not sellable and nothing
                // is wrong with it.
                <span className="text-ink-2">
                  No — {humanise(data.status).toLowerCase()}
                </span>
              )}
            </Datum>
            <Datum label="Where it physically is">{humanise(data.location)}</Datum>
            <Datum label="Supply point shown to buyers">
              {data.supplyPointCode ? (
                <span className="font-mono tnum">Supply Point {data.supplyPointCode}</span>
              ) : (
                <NotMeasured
                  why="No supply-point code is set on this machine, so a buyer-facing screen has no label to print for it"
                  label="Not set"
                />
              )}
            </Datum>
            <Datum label="Input tax credit">
              {data.itcEligible ? 'Available to the buyer' : 'Nil on this machine'}
            </Datum>
            <Datum label="First recorded">{onDate(data.createdAt)}</Datum>
          </dl>

          <p className="mt-4 text-body-sm text-ink-3">
            A+, A and B are all sellable, so the grade badge carries no verdict. The only verdict on
            this screen is the QC one, which is the only thing here that was a test.
          </p>
        </SidePanel>
      </div>
    </div>
  );
}
