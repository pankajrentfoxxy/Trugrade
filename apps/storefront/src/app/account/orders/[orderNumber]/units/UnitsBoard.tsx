'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  BatteryBar,
  DataBoard,
  EmptyState,
  GradeBadge,
  QcChip,
  SealChip,
  StatusPill,
  type Column,
  type SealStatus,
  type SortDirection,
  type StatusPillProps,
} from '@trugrade/ui';
import { type Grade } from '@trugrade/contracts';
import type { ApiFailure } from '../../../../register/api';
import { getOrderUnits, type OrderUnits, type OrderedUnit, type QcVerdict } from './api';

/**
 * The per-serial QC board. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated and can come back 401 —
 * a signed-out visitor is a state this screen renders, not a crash — and because
 * the CSV is built from the rows already in the browser rather than from a
 * second endpoint that would have to re-derive them.
 *
 * The board's state is not client state: it arrives as `query` from the server,
 * which read it off the URL, and every control pushes the router. A buyer
 * sending a colleague "the machines on this order that need attention, worst
 * battery first" is a link, not a description.
 */

const isGrade = (g: string | null): g is Grade => g === 'A_PLUS' || g === 'A' || g === 'B';

/**
 * PASS and FAIL are the two verdicts green and red exist for, and this is one of
 * the few screens that genuinely has them. `PASS_WITH_NOTE` is a pass with
 * something written on it, so it is `warn` — amber, and the word "note" carries
 * the meaning for anyone who cannot see the colour. `MISMATCH` is `fail`: the
 * machine is not the machine the line described, whatever else it scored.
 */
const VERDICT: Record<QcVerdict, { tone: StatusPillProps['tone']; label: string }> = {
  PASS: { tone: 'pass', label: 'Pass' },
  PASS_WITH_NOTE: { tone: 'warn', label: 'Pass with note' },
  MISMATCH: { tone: 'fail', label: 'Spec mismatch' },
  FAIL: { tone: 'fail', label: 'Fail' },
};

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
 * A machine somebody has to look at before signing for it.
 *
 * Three unrelated things, and all three are the buyer's problem to know about:
 * the inspection did not come back a clean pass, the seal is not intact, or a
 * measurement is missing so we cannot make a claim about it either way.
 */
const needsAttention = (u: OrderedUnit): boolean =>
  u.verdict !== 'PASS' ||
  (u.seal !== null && u.seal.status !== 'APPLIED' && u.seal.status !== 'INTACT') ||
  u.seal === null ||
  u.batteryHealthPct === null ||
  u.qcScore === null ||
  u.inspectedOn === null;

/**
 * What each sortable column reads off a row. A `null` is a measurement that was
 * never taken, and `compare` below is the only thing that decides where those
 * go — deliberately not the comparators, because a comparator whose sign is
 * flipped for a descending sort flips its null handling with it.
 */
const SORT_VALUES = {
  serial: (u: OrderedUnit): string => u.serialNumber,
  battery: (u: OrderedUnit): number | null => u.batteryHealthPct,
  score: (u: OrderedUnit): number | null => u.qcScore,
  inspected: (u: OrderedUnit): number | null =>
    u.inspectedOn === null ? null : Number(u.inspectedOn.replace(/-/g, '')),
} as const;

type SortKey = keyof typeof SORT_VALUES;

const isSortKey = (v: string): v is SortKey => v in SORT_VALUES;

/**
 * **Nulls last in BOTH directions, and that is the whole reason this is a
 * function rather than a comparator with a sign applied to it.**
 *
 * A machine whose battery was never read is not the worst battery on the order
 * and it is not the best one either. Sorting it to either end answers a question
 * the data cannot answer — which is the same defect as drawing it as a bar, one
 * layer down. Reversing a nulls-last comparator produces nulls-first, so the
 * direction is applied to the comparison of two present values only.
 */
function compare(a: OrderedUnit, b: OrderedUnit, key: SortKey, direction: SortDirection): number {
  const av = SORT_VALUES[key](a);
  const bv = SORT_VALUES[key](b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  const base = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
  return direction === 'desc' ? -base : base;
}

type Phase =
  | { k: 'loading' }
  /** No session. Not a failure: a path exists and it comes back here. */
  | { k: 'signed-out' }
  /** No such order on this account. Deliberately the same screen either way. */
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; data: OrderUnits };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach the machines on this order just now. That is our problem, not yours — the order itself is unaffected.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function UnitsBoard({
  orderNumber,
  query,
}: {
  orderNumber: string;
  query: string;
}): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const params = React.useMemo(() => new URLSearchParams(query), [query]);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getOrderUnits(orderNumber);
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

  const base = `/account/orders/${encodeURIComponent(orderNumber)}/units`;

  /**
   * Write through to the URL. `push`, not `replace`: a sort is somewhere the
   * buyer navigated to, and back must undo it.
   */
  const commit = React.useCallback(
    (next: URLSearchParams): void => {
      const qs = next.toString();
      // `typedRoutes` cannot prove a string built at runtime is a real route.
      // The cast is on the ONE line that builds it.
      router.push((qs ? `${base}?${qs}` : base) as Route, { scroll: false });
    },
    [router, base],
  );

  const setValue = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    commit(next);
  };

  if (phase.k === 'signed-out') return <SignedOut orderNumber={orderNumber} />;
  if (phase.k === 'missing') return <Missing orderNumber={orderNumber} />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const data = phase.k === 'ready' ? phase.data : null;
  const all = data?.units ?? [];
  const attentionOnly = params.get('show') === 'attention';
  const sortParam = params.get('sort') ?? 'serial';
  const sortKey: SortKey = isSortKey(sortParam) ? sortParam : 'serial';
  const direction: SortDirection = params.get('dir') === 'desc' ? 'desc' : 'asc';

  const flagged = all.filter(needsAttention);
  const rows = [...(attentionOnly ? flagged : all)].sort((a, b) =>
    compare(a, b, sortKey, direction),
  );

  const onSort = (key: string): void => {
    if (!isSortKey(key)) return;
    const next = new URLSearchParams(params);
    next.set('sort', key);
    next.set('dir', sortKey === key && direction === 'asc' ? 'desc' : 'asc');
    commit(next);
  };

  return (
    <>
      <div className="wshead ubhead">
        <h1>
          Machines on order <span className="mono">{orderNumber}</span>
        </h1>
        <p>
          Every machine on this order by serial number, with what our inspection found. This is the
          record to put in your asset register — the serial on the case, the seal code on the lid
          and the measurements behind them are all here.
        </p>
      </div>

      <Summary units={all} flagged={flagged.length} loading={data === null} />

      <div className="rbar ubbar">
        <span className="cnt">
          {data === null ? (
            <span className="ink4">Reading the inspections…</span>
          ) : (
            <>
              <b className="mono">{rows.length}</b> of <b className="mono">{all.length}</b>{' '}
              {all.length === 1 ? 'machine' : 'machines'}
              {attentionOnly && ' need a look'}
            </>
          )}
        </span>

        <div className="ubfilters" role="group" aria-label="Filter these machines">
          <button
            type="button"
            className={attentionOnly ? 'chipf' : 'chipf on'}
            aria-pressed={!attentionOnly}
            onClick={() => setValue('show', '')}
          >
            All machines
          </button>
          <button
            type="button"
            className={attentionOnly ? 'chipf on' : 'chipf'}
            aria-pressed={attentionOnly}
            onClick={() => setValue('show', 'attention')}
            // Disabled only when it is NOT the current filter: a chip that is
            // both active and disabled reads as broken, and a buyer who arrived
            // on this link needs the way back to it to stay live.
            disabled={data !== null && flagged.length === 0 && !attentionOnly}
          >
            Needs a look <span className="mono">{data === null ? '—' : flagged.length}</span>
          </button>
        </div>

        <ExportButton orderNumber={orderNumber} units={rows} disabled={data === null} />
      </div>

      <div className="tbl ubtable">
        <DataBoard
          caption={
            data === null
              ? 'Reading the inspections on this order.'
              : `${rows.length} of ${all.length} machines on order ${orderNumber}, sorted by ${SORT_CAPTION[sortKey]}, ${direction === 'asc' ? 'lowest first' : 'highest first'}.`
          }
          columns={COLUMNS}
          rows={rows}
          rowKey={(u) => u.serialNumber}
          sort={{ key: sortKey, direction }}
          onSort={onSort}
          loading={data === null}
          skeletonRows={6}
          empty={
            attentionOnly ? (
              <EmptyState
                title="Nothing on this order needs a second look"
                body={
                  <>
                    Every machine came back a clean pass with its seal intact and every measurement
                    recorded. <span className="mono">{all.length}</span> of{' '}
                    <span className="mono">{all.length}</span>.
                  </>
                }
                action={
                  <button type="button" className="pill wire" onClick={() => setValue('show', '')}>
                    Show all machines
                  </button>
                }
              />
            ) : (
              <EmptyState
                title="No machines are assigned to this order yet"
                body="Machines are assigned by serial number when your order is confirmed. Until then there is nothing to inspect or export — no serial has been set aside for you."
              />
            )
          }
        />
      </div>

      <p className="fnote off ubfoot">
        Every figure above was measured by us on the machine carrying that serial. None of it is
        copied from a description somebody else wrote. Where we did not measure something we say so;
        a blank is never a pass. Open a serial to see the full passport — the twelve inspection
        areas, the photographs and the wipe certificate.
      </p>
    </>
  );
}

const SORT_CAPTION: Record<SortKey, string> = {
  serial: 'serial number',
  battery: 'battery health',
  score: 'inspection score',
  inspected: 'inspection date',
};

/* ==========================================================================
 * The columns
 * ======================================================================== */

const COLUMNS: readonly Column<OrderedUnit>[] = [
  {
    key: 'serial',
    header: 'Serial',
    sortable: true,
    cell: (u) => (
      <div className="ubid">
        {/* The serial is the link. A buyer checking one machine wants the
            passport for that machine, not the model page. */}
        <a className="mono ubserial" href={u.passportPath}>
          {u.serialNumber}
        </a>
        <span className="ubtitle">
          {u.title ?? <span className="notmeasured">Model no longer catalogued</span>}
        </span>
        {u.specSummary && <span className="ubspec">{u.specSummary}</span>}
      </div>
    ),
  },
  {
    key: 'verdict',
    header: 'Inspection',
    cell: (u) =>
      u.verdict === null ? (
        <span className="notmeasured">Not inspected</span>
      ) : (
        <StatusPill tone={VERDICT[u.verdict].tone} label={VERDICT[u.verdict].label} />
      ),
  },
  {
    key: 'grade',
    header: 'Grade',
    cell: (u) => (
      <div className="ubgrade">
        {/* Two grades, and the badge draws both when they differ: the line was
            priced at one and the inspection concluded another. Collapsing them
            to a single chip is how a downgrade disappears from the one record
            the buyer keeps. On an honest order they agree and only one shows. */}
        {isGrade(u.gradeActual) ? (
          isGrade(u.gradeOrdered) && u.gradeOrdered !== u.gradeActual ? (
            <GradeBadge grade={u.gradeActual} variant="corrected" previousGrade={u.gradeOrdered} />
          ) : (
            <GradeBadge grade={u.gradeActual} />
          )
        ) : (
          <span className="notmeasured">Not graded</span>
        )}
        {isGrade(u.gradeActual) && u.gradeActual !== u.gradeOrdered && (
          <span className="ubregrade">
            Re-graded from <span className="mono">{gradeLabel(u.gradeOrdered)}</span> on inspection
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'battery',
    header: 'Battery',
    numeric: true,
    sortable: true,
    cell: (u) =>
      // The defect this screen is most exposed to. A null battery is NOT a zero
      // bar, not a dash and not an empty cell — all three read as a measurement
      // on a page of measurements.
      u.batteryHealthPct === null ? (
        <span className="notmeasured">Not measured</span>
      ) : (
        <BatteryBar healthPct={u.batteryHealthPct} className="ubbatt" />
      ),
  },
  {
    key: 'score',
    header: 'Score',
    numeric: true,
    sortable: true,
    cell: (u) =>
      u.qcScore === null ? (
        <span className="notmeasured">Not scored</span>
      ) : (
        <QcChip score={u.qcScore} />
      ),
  },
  {
    key: 'seal',
    header: 'Seal',
    cell: (u) =>
      u.seal === null || !SEAL_STATES.has(u.seal.status as SealStatus) ? (
        <span className="notmeasured">No seal recorded</span>
      ) : (
        <SealChip sealCode={u.seal.code} status={u.seal.status as SealStatus} />
      ),
  },
  {
    key: 'inspected',
    header: 'Inspected',
    numeric: true,
    sortable: true,
    cell: (u) =>
      u.inspectedOn === null ? (
        <span className="notmeasured">Not inspected</span>
      ) : (
        <span className="mono">{u.inspectedOn}</span>
      ),
  },
  {
    key: 'passport',
    header: 'Passport',
    headerHidden: true,
    cell: (u) => (
      <a className="ubpassport" href={u.passportPath}>
        Passport
        <span className="sr-only"> for {u.serialNumber}</span>
      </a>
    ),
  },
];

const gradeLabel = (grade: string): string => grade.replace('_PLUS', '+');

/* ==========================================================================
 * The figures above the table — every one with its denominator
 * ======================================================================== */

function Summary({
  units,
  flagged,
  loading,
}: {
  units: readonly OrderedUnit[];
  flagged: number;
  loading: boolean;
}): React.JSX.Element {
  const total = units.length;
  const inspected = units.filter((u) => u.verdict !== null).length;
  const clean = units.filter((u) => u.verdict === 'PASS').length;
  const batteries = units.map((u) => u.batteryHealthPct).filter((b): b is number => b !== null);
  const sealsIntact = units.filter(
    (u) => u.seal !== null && (u.seal.status === 'APPLIED' || u.seal.status === 'INTACT'),
  ).length;

  return (
    <dl className="ubkpi">
      <Figure label="Machines" value={loading ? null : String(total)} denominator="on this order" />
      <Figure
        label="Clean pass"
        value={loading ? null : String(clean)}
        // Never a bare percentage. The denominator is the whole claim: "98%"
        // over four machines and over four hundred are different statements.
        denominator={loading ? '' : `of ${inspected} inspected`}
      />
      <Figure
        label="Average battery"
        value={
          loading
            ? null
            : batteries.length === 0
              ? null
              : `${Math.round(batteries.reduce((a, b) => a + b, 0) / batteries.length)}%`
        }
        denominator={
          loading
            ? ''
            : batteries.length === total
              ? `measured on all ${total}`
              : `measured on ${batteries.length} of ${total}`
        }
        missing={!loading && batteries.length === 0 ? 'No battery was measured' : undefined}
      />
      <Figure
        label="Seals intact"
        value={loading ? null : String(sealsIntact)}
        denominator={loading ? '' : `of ${total}`}
      />
      <Figure
        label="Needs a look"
        value={loading ? null : String(flagged)}
        denominator={loading ? '' : `of ${total}`}
      />
    </dl>
  );
}

function Figure({
  label,
  value,
  denominator,
  missing,
}: {
  label: string;
  value: string | null;
  denominator: string;
  missing?: string;
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {missing !== undefined ? (
          <span className="notmeasured">{missing}</span>
        ) : value === null ? (
          <span className="notmeasured">—</span>
        ) : (
          <span className="mono ubfig">{value}</span>
        )}
        {denominator && value !== null && missing === undefined && (
          <span className="denom"> {denominator}</span>
        )}
      </dd>
    </div>
  );
}

/* ==========================================================================
 * The export — the asset register, as a file
 * ======================================================================== */

/**
 * The columns of the CSV, in order.
 *
 * `03_UX_SPEC.md` §3A.3 says this export "matches the invoice exactly". It
 * matches the **order lines** — serial, model, grade and unit price are read
 * from the same rows the invoice will be built from. It does not yet match a
 * rendered invoice, because there is no invoice: generation is T22 and the
 * `payment` module has no internals. Claiming the tie now would be claiming a
 * document exists.
 */
const CSV_COLUMNS: ReadonlyArray<readonly [string, (u: OrderedUnit) => string]> = [
  ['Serial number', (u) => u.serialNumber],
  ['Model', (u) => u.title ?? ''],
  ['Specification', (u) => u.specSummary ?? ''],
  ['Grade ordered', (u) => gradeLabel(u.gradeOrdered)],
  ['Grade inspected', (u) => (u.gradeActual ? gradeLabel(u.gradeActual) : 'Not graded')],
  ['Unit price (INR)', (u) => u.unitPrice],
  ['Inspection verdict', (u) => (u.verdict ? VERDICT[u.verdict].label : 'Not inspected')],
  ['Inspection score', (u) => (u.qcScore === null ? 'Not scored' : String(u.qcScore))],
  // The word, not a blank. A spreadsheet with an empty battery column gets a
  // zero the moment somebody averages it.
  [
    'Battery health (%)',
    (u) => (u.batteryHealthPct === null ? 'Not measured' : String(u.batteryHealthPct)),
  ],
  ['Inspected on', (u) => u.inspectedOn ?? 'Not inspected'],
  ['Seal code', (u) => u.seal?.code ?? 'No seal recorded'],
  ['Seal status', (u) => u.seal?.status ?? 'No seal recorded'],
];

/** RFC 4180: quote everything, double the quotes inside. */
const cell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

function toCsv(units: readonly OrderedUnit[]): string {
  const header = CSV_COLUMNS.map(([name]) => cell(name)).join(',');
  const body = units.map((u) => CSV_COLUMNS.map(([, read]) => cell(read(u))).join(','));
  // CRLF, because this file is opened in Excel on a Windows desktop far more
  // often than anywhere else, and \n alone puts the whole register on one row.
  return [header, ...body].join('\r\n');
}

function ExportButton({
  orderNumber,
  units,
  disabled,
}: {
  orderNumber: string;
  units: readonly OrderedUnit[];
  disabled: boolean;
}): React.JSX.Element {
  const download = (): void => {
    // A BOM, so Excel reads it as UTF-8 rather than the system codepage. Without
    // it a model name with a non-ASCII character arrives mangled.
    const blob = new Blob([`\uFEFF${toCsv(units)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${orderNumber}-machines.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      className="pill acc ubexport"
      onClick={download}
      disabled={disabled || units.length === 0}
    >
      Export {units.length > 0 && <span className="mono">{units.length}</span>} for your asset
      register
    </button>
  );
}

/* ==========================================================================
 * States that are not the board
 * ======================================================================== */

function SignedOut({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see these machines"
        body="An order belongs to the organisation that placed it, so we need to know who is asking. Signing in brings you straight back to this list."
        action={
          <a
            className="pill acc"
            href={`/sign-in?next=${encodeURIComponent(`/account/orders/${orderNumber}/units`)}`}
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
 * belongs to another organisation — the API answers 404 for both. Order numbers
 * are sequential, so a screen that distinguished them would let anyone with an
 * account count our orders.
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
            look like <span className="mono">TT-26-00004</span> — or ask whoever placed it to share
            it from their account.
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
        <h3>We could not read the inspections on this order</h3>
        <p>{message}</p>
        <p>
          The machines and their results are unaffected — this is a screen that could not load, not
          a record that changed.
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
