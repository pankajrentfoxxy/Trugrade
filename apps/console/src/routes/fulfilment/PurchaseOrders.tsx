import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, DataBoard, Drawer, EmptyState, Pagination, cn, type Column } from '@trugrade/ui';
import { Board, NotMeasured } from '../../lib/controls';
import { apiFetch, usePrincipal } from '../../lib/auth';
import { daysSince } from '../../lib/clock';
import { useResource } from '../../lib/useResource';
import { ChainStrip } from '../../boards/ChainStrip';
import { FULFILMENT_API, day, inr, type DispatchResult } from './api';

/**
 * ARCHETYPE B — Board. Pipeline tiles + filter rail + data table + row actions.
 * DENSITY: compact (admin), with the design's own Roomy toggle in the URL.
 *
 * Every purchase order we have raised, across every supply point — `03_UX_SPEC.md`
 * §3C.4, on `/api/ops/purchase-orders`.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.po-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as `/orders`:
 *
 * - **The table is still `DataBoard`**, restyled through its wrapper class.
 * - **Every figure is read, not typed.** The three tiles are the server's
 *   `stages`, counted over the whole board; the attention strip is its
 *   `attention` block; the header line is its `summary`. The "7+ days" and
 *   "14+ days" in the copy are the server's `thresholds`, quoted rather than
 *   retyped, so the number in the sentence is the number the count was made with.
 * - **The design's section tabs are the shell's.** The ops shell already draws
 *   Purchase orders · Shipments · Pickups · Riders · Carriers · NDR above every
 *   fulfilment screen, so the page does not draw them a second time.
 *
 * **Two controls the design draws are not here, and one it does not draw is.**
 * "Remind vendors" needs a notification path to a supply point and there is
 * none, so the button would be dead; it is absent. The search box says it
 * matches a vendor's name, and the server matches PO number, order number and
 * serial — the placeholder says what is true. And the design's checkboxes select
 * for nothing; here they select for Dispatch, the one write this board has, and
 * they appear only for a seat that holds `procurement.po.dispatch`.
 *
 * **The design's red and amber.** A purchase order nobody has acknowledged in a
 * week, or acknowledged and not dispatched in two, is drawn in the design's
 * `--admin-bad` and `--admin-warn`. Those are facts about a supply point's
 * responsiveness, not a verdict on a machine — PASS/FAIL stay reserved.
 */

interface PoRow {
  poId: string;
  poNumber: string;
  status: string;
  vendorOrgId: string;
  vendorLegalName: string | null;
  orderNumber: string | null;
  raisedAt: string;
  lines: number;
  totalNet: string;
  tdsAmount: string;
  termsDays: number;
  acknowledgedAt: string | null;
  matchedSerials: string[];
}

interface PoStage {
  status: string;
  count: number;
  value: string;
  late: number;
  lateValue: string;
}

interface PoAttention {
  unacknowledged: {
    count: number;
    value: string;
    oldest: { poNumber: string; vendorLegalName: string | null; raisedAt: string } | null;
  };
  undispatched: { count: number; value: string; vendors: string[] };
}

interface PoFacet {
  value: string;
  label: string;
  count: number;
}

/**
 * The envelope. `summary`, `stages`, `attention` and `thresholds` are optional
 * on the client side only because the surface sweep renders every fulfilment
 * board against the generic envelope; the server always sends them.
 */
export interface PoBoard {
  rows: PoRow[];
  total: number;
  grandTotal: number;
  page: number;
  per: number;
  pages: number;
  facets: { status?: PoFacet[]; vendor?: PoFacet[] };
  totals?: { value: string; tds: string; machines: number };
  searchedFor?: string[] | null;
  summary?: { pos: number; vendors: number; payable: string };
  stages?: PoStage[];
  attention?: PoAttention;
  thresholds?: { ackDays: number; dispatchDays: number };
}

const ENDPOINT = '/api/ops/purchase-orders';
const PER = 50;

/** The pipeline, for tile order. A status it does not know sorts last. */
const PIPELINE = [
  'RAISED',
  'ACKNOWLEDGED',
  'DISPATCH_READY',
  'DISPATCHED',
  'RECEIVED',
  'INVOICED',
  'MATCHED',
  'PAYABLE',
  'PAID',
  'CANCELLED',
  'DISPUTED',
];
const pipelineIndex = (status: string): number => {
  const i = PIPELINE.indexOf(status);
  return i === -1 ? PIPELINE.length : i;
};

/** The design's stage vocabulary, and whose move it is at each one. */
const STAGE_META: Readonly<Record<string, { label: string; who: string; dot: string; pill: string }>> =
  {
    RAISED: { label: 'Raised', who: 'waiting on vendor', dot: 'd--rs', pill: 's-rs' },
    ACKNOWLEDGED: { label: 'Acknowledged', who: 'waiting to dispatch', dot: 'd--ak', pill: 's-ak' },
    DISPATCH_READY: { label: 'Packed', who: 'ours to dispatch', dot: 'd--pk', pill: 's-pk' },
    DISPATCHED: { label: 'Dispatched', who: 'on the way', dot: 'd--dp', pill: 's-dp' },
    RECEIVED: { label: 'Received', who: 'done', dot: 'd--ok', pill: 's-ok' },
    INVOICED: { label: 'Invoiced', who: 'with finance', dot: 'd--ok', pill: 's-ok' },
    MATCHED: { label: 'Matched', who: 'with finance', dot: 'd--ok', pill: 's-ok' },
    PAYABLE: { label: 'Payable', who: 'with finance', dot: 'd--ok', pill: 's-ok' },
    PAID: { label: 'Paid', who: 'done', dot: 'd--ok', pill: 's-ok' },
    CANCELLED: { label: 'Cancelled', who: 'closed', dot: 'd--bad', pill: 's-bad' },
    DISPUTED: { label: 'Disputed', who: 'with finance', dot: 'd--bad', pill: 's-bad' },
  };

const humanise = (value: string): string => {
  const words = value.replace(/[._]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const stageMeta = (status: string): { label: string; who: string; dot: string; pill: string } =>
  STAGE_META[status] ?? { label: humanise(status), who: '', dot: 'd--rs', pill: 's-rs' };

/**
 * The legal name without its legal suffix, for a 260px column. The full name
 * stays in the cell's `title`, exactly as the design carries it.
 */
const shortName = (legal: string): string =>
  legal.replace(/[\s,]+(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|llp|inc\.?)$/i, '').trim();

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const ago = (days: number, verb: string): string =>
  days === 0 ? `${verb} today` : days === 1 ? `${verb} yesterday` : `${verb} ${days} days ago`;

/**
 * The line under a status pill: how long this order has been waiting on whoever
 * it is waiting on, and in the design's colour once it has waited too long.
 * Nothing for a stage that is not waiting on anyone.
 */
function ageNote(
  r: PoRow,
  thresholds: { ackDays: number; dispatchDays: number },
): { tone: 'bad' | 'warn' | 'ok'; text: string } | null {
  if (r.status === 'RAISED') {
    const d = daysSince(r.raisedAt);
    return d >= thresholds.ackDays
      ? { tone: 'bad', text: `No reply for ${d} days` }
      : { tone: 'ok', text: ago(d, 'Raised') };
  }
  if (r.status === 'ACKNOWLEDGED' && r.acknowledgedAt) {
    const d = daysSince(r.acknowledgedAt);
    return d >= thresholds.dispatchDays
      ? { tone: 'warn', text: `Not dispatched for ${d} days` }
      : { tone: 'ok', text: ago(d, 'Acknowledged') };
  }
  return null;
}

/** The server's sort vocabulary, from the URL's column + direction. */
function serverSort(sort: string, dir: string): string {
  if (sort === 'net') return dir === 'asc' ? 'value_asc' : 'value';
  if (sort === 'raised' && dir === 'asc') return 'oldest';
  return 'recent';
}

function boardQuery(params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const key of ['q', 'status', 'vendor', 'late', 'page'] as const) {
    const value = params.get(key);
    if (value) q.set(key, value);
  }
  q.set('sort', serverSort(params.get('sort') ?? '', params.get('dir') ?? ''));
  q.set('per', String(PER));
  return q.toString();
}

/* ---- icons, as the design draws them ---------------------------------- */

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const SearchIcon = (): React.JSX.Element => (
  <svg width="18" height="18" strokeWidth="2" {...svgProps}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
const ChevronIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2.2" {...svgProps}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/* ---- the pipeline tiles ------------------------------------------------ */

function StageTiles({
  stages,
  thresholds,
  active,
  onPick,
}: {
  stages: PoStage[];
  thresholds: { ackDays: number; dispatchDays: number };
  active: string;
  onPick: (status: string) => void;
}): React.JSX.Element | null {
  const ordered = [...stages].sort((a, b) => pipelineIndex(a.status) - pipelineIndex(b.status));
  if (ordered.length === 0) return null;

  const flag = (s: PoStage): { tone: 'bad' | 'warn' | 'ok'; text: string } | null => {
    switch (s.status) {
      case 'RAISED':
        return s.late > 0
          ? { tone: 'bad', text: `${s.late} not acknowledged after ${thresholds.ackDays}+ days` }
          : { tone: 'ok', text: `None waiting over ${thresholds.ackDays} days` };
      case 'ACKNOWLEDGED':
        return s.late > 0
          ? { tone: 'warn', text: `${s.late} not dispatched after ${thresholds.dispatchDays}+ days` }
          : { tone: 'ok', text: `None waiting over ${thresholds.dispatchDays} days` };
      case 'DISPATCHED':
        return { tone: 'ok', text: 'Track under Shipments' };
      case 'DISPATCH_READY':
        return { tone: 'ok', text: 'Dispatch from this board' };
      default:
        return null;
    }
  };

  return (
    <div className="po-pipe" role="group" aria-label="Filter by stage">
      {ordered.map((s) => {
        const meta = stageMeta(s.status);
        const f = flag(s);
        return (
          <button
            key={s.status}
            type="button"
            className="po-stage"
            aria-pressed={active === s.status}
            onClick={() => onPick(active === s.status ? '' : s.status)}
          >
            <span className="po-stage__top">
              <span className={cn('d', meta.dot)} aria-hidden="true" />
              {meta.label}
              {meta.who && <span className="who">{meta.who}</span>}
            </span>
            <span className="po-stage__row">
              <span className="po-stage__count">{s.count}</span>
              <span className="po-stage__money">{inr(s.value)}</span>
            </span>
            {f && <span className={cn('po-stage__flag', `po-stage__flag--${f.tone}`)}>{f.text}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---- the attention strip ---------------------------------------------- */

function Attention({
  attention,
  thresholds,
  late,
}: {
  attention: PoAttention;
  thresholds: { ackDays: number; dispatchDays: number };
  late: string;
}): React.JSX.Element | null {
  const items: React.ReactNode[] = [];
  const un = attention.unacknowledged;
  const nd = attention.undispatched;

  if (un.count > 0) {
    const window = thresholds.ackDays === 7 ? 'in over a week' : `for over ${thresholds.ackDays} days`;
    items.push(
      <div className="po-attn__item" key="unack">
        <span className="sev sev--bad" aria-hidden="true" />
        <span className="txt">
          <strong>
            {un.count} {plural(un.count, 'PO has', 'POs have')} not been acknowledged {window}
          </strong>{' '}
          ({inr(un.value)}).
          {un.oldest && (
            <>
              {' '}
              The oldest, <span className="mono">{un.oldest.poNumber}</span> to{' '}
              {un.oldest.vendorLegalName ? shortName(un.oldest.vendorLegalName) : 'a supply point no longer on the platform'}, was raised{' '}
              {daysSince(un.oldest.raisedAt)} days ago.
            </>
          )}
        </span>
        <span className="acts">
          <Link
            to="/procurement/pos?late=ack"
            className="po-btn"
            aria-current={late === 'ack' ? 'true' : undefined}
          >
            {late === 'ack' ? 'Showing them' : 'Show them'}
          </Link>
        </span>
      </div>,
    );
  }

  if (nd.count > 0) {
    const window =
      thresholds.dispatchDays === 14 ? '2+ weeks ago' : `${thresholds.dispatchDays}+ days ago`;
    // Short names, as the design writes them in a sentence; the legal suffix
    // would also end the sentence with two full stops.
    const vendors = nd.vendors.map(shortName);
    const where =
      vendors.length === 1
        ? `All are with ${vendors[0]}.`
        : vendors.length > 1
          ? `Across ${vendors.length} supply points: ${vendors.slice(0, -1).join(', ')} and ${
              vendors[vendors.length - 1]
            }.`
          : '';
    items.push(
      <div className="po-attn__item" key="undispatched">
        <span className="sev sev--warn" aria-hidden="true" />
        <span className="txt">
          <strong>
            {nd.count} {plural(nd.count, 'PO', 'POs')} acknowledged {window}{' '}
            {plural(nd.count, 'is', 'are')} still not dispatched
          </strong>{' '}
          ({inr(nd.value)}). {where}
        </span>
        <span className="acts">
          <Link
            to="/procurement/pos?late=dispatch"
            className="po-btn"
            aria-current={late === 'dispatch' ? 'true' : undefined}
          >
            {late === 'dispatch' ? 'Showing them' : 'Show them'}
          </Link>
        </span>
      </div>,
    );
  }

  // Nothing stuck is nothing to draw.
  if (items.length === 0) return null;
  return (
    <section className="po-attn" aria-label="Needs attention">
      {items}
    </section>
  );
}

/* ======================================================================== */

export default function PurchaseOrders(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const vendor = params.get('vendor') ?? '';
  const late = params.get('late') ?? '';
  const sort = params.get('sort') ?? '';
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Number(params.get('page') ?? '1');
  const roomy = params.get('density') === 'roomy';
  const filtered = Boolean(q || status || vendor || late);

  const [typed, setTyped] = React.useState(q);
  React.useEffect(() => setTyped(q), [q]);

  const [reloadToken, setReloadToken] = React.useState(0);
  const { data, error } = useResource<PoBoard>(
    `${ENDPOINT}?${boardQuery(params)}`,
    'The purchase-order board is unavailable',
    reloadToken,
  );

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change returns to page 1: a kept page number on a smaller
    // result set lands on an empty board that looks like a broken filter.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const principal = usePrincipal();
  const canDispatch = principal?.permissions.includes('procurement.po.dispatch') ?? false;
  const canOpenOrders = principal?.permissions.includes('ordering.any.read') ?? false;

  // The tiles, the attention strip and the header line describe the WHOLE
  // board, so they are the same on every page and under every filter. They are
  // kept across a refetch rather than blanked with the rows: a tile that
  // vanishes for 200ms each time it is pressed cannot be pressed twice.
  const [overview, setOverview] = React.useState<Pick<
    PoBoard,
    'summary' | 'stages' | 'attention' | 'thresholds'
  > | null>(null);
  React.useEffect(() => {
    if (data?.stages) {
      setOverview({
        summary: data.summary,
        stages: data.stages,
        attention: data.attention,
        thresholds: data.thresholds,
      });
    }
  }, [data]);

  const thresholds = overview?.thresholds ?? { ackDays: 7, dispatchDays: 14 };
  const rows = data?.rows ?? [];

  /* ---- selection, for the one write this board has ---- */
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<string | null>(null);
  // A page of rows the operator can no longer see is not a selection.
  React.useEffect(() => setSelected(new Set()), [status, vendor, late, q, page]);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.poNumber));
  const toggle = (key: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function dispatchSelected(): Promise<void> {
    if (selected.size === 0) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await apiFetch(FULFILMENT_API.dispatchBulk, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ poNumbers: [...selected] }),
      });
      if (!res.ok) {
        const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? 'The dispatch was refused.');
      }
      const out: { results?: DispatchResult[]; byCarrier?: Record<string, number> } =
        await res.json();
      const results = out.results ?? [];
      const ok = results.filter((r) => r.awb && !r.error).length;
      const failed = results.filter((r) => r.error).length;
      // Grouped by carrier: "47 dispatched" tells an operator nothing they can
      // act on; "BlueDart 31 · Porter 16" tells them which manifest to expect.
      const detail = Object.entries(out.byCarrier ?? {})
        .map(([carrier, n]) => `${carrier} ${n}`)
        .join(' · ');
      setOutcome(`Dispatch: ${ok} booked${failed ? `, ${failed} refused` : ''}${detail ? ` · ${detail}` : ''}`);
      setSelected(new Set());
      setReloadToken((n) => n + 1);
    } catch (e) {
      setOutcome((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ---- the record drawer ---- */
  const [open, setOpen] = React.useState<PoRow | null>(null);

  const columns = React.useMemo<ReadonlyArray<Column<PoRow>>>(() => {
    const body: Column<PoRow>[] = [
      {
        key: 'po',
        header: 'PO',
        cell: (r) => (
          <>
            <button type="button" className="po-id" onClick={() => setOpen(r)}>
              {r.poNumber}
            </button>
            <div className="po-for">
              {r.orderNumber ? (
                <>
                  for{' '}
                  {canOpenOrders ? (
                    <Link to={`/orders/${r.orderNumber}`}>{r.orderNumber}</Link>
                  ) : (
                    <span className="mono">{r.orderNumber}</span>
                  )}
                </>
              ) : (
                <NotMeasured
                  why="The order this purchase order was raised for could not be resolved"
                  label="Order unresolved"
                />
              )}
            </div>
            {r.matchedSerials.length > 0 && (
              // Why this row is in the result: a serial search landing on a
              // board with no serial column otherwise reads as a mistake.
              <div className="po-for">
                matched on <span className="mono">{r.matchedSerials.join(', ')}</span>
              </div>
            )}
          </>
        ),
      },
      {
        key: 'vendor',
        header: 'Supply point',
        cell: (r) =>
          r.vendorLegalName ? (
            <div className="po-vendor" title={r.vendorLegalName}>
              {shortName(r.vendorLegalName)}
            </div>
          ) : (
            <NotMeasured
              why="The supply point on this purchase order is no longer on the platform"
              label="Supply point unresolved"
            />
          ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (r) => {
          const meta = stageMeta(r.status);
          const note = ageNote(r, thresholds);
          return (
            <>
              <span className={cn('po-pill', meta.pill)}>{meta.label}</span>
              {note && <div className={cn('po-age', `po-age--${note.tone}`)}>{note.text}</div>}
            </>
          );
        },
      },
      { key: 'lines', header: 'Lines', numeric: true, cell: (r) => r.lines },
      {
        key: 'net',
        header: 'Net payable',
        numeric: true,
        sortable: true,
        cell: (r) => <span className="po-net">{inr(r.totalNet)}</span>,
      },
      {
        key: 'raised',
        header: 'Raised',
        sortable: true,
        cell: (r) => <span className="po-date">{day(r.raisedAt)}</span>,
      },
      {
        key: 'ack',
        header: 'Acknowledged',
        cell: (r) =>
          r.acknowledgedAt ? (
            <span className="po-date">{day(r.acknowledgedAt)}</span>
          ) : (
            <span className="po-none">Not yet</span>
          ),
      },
      {
        key: 'open',
        header: 'Open',
        headerHidden: true,
        numeric: true,
        cell: (r) => (
          <button
            type="button"
            className="po-open"
            aria-label={`Open ${r.poNumber}`}
            onClick={() => setOpen(r)}
          >
            <ChevronIcon />
          </button>
        ),
      },
    ];
    if (!canDispatch) return body;
    return [
      {
        key: 'select',
        header: (
          <input
            type="checkbox"
            checked={allOnPage}
            onChange={() =>
              setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.poNumber)))
            }
            aria-label="Select all purchase orders"
          />
        ),
        headerHidden: false,
        cell: (r) => (
          <input
            type="checkbox"
            checked={selected.has(r.poNumber)}
            onChange={() => toggle(r.poNumber)}
            aria-label={`Select ${r.poNumber}`}
          />
        ),
      },
      ...body,
    ];
  }, [canDispatch, canOpenOrders, thresholds, rows, selected, allOnPage]);

  if (error) {
    return (
      <EmptyState
        title="The purchase-order board did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  const from = data && data.total > 0 ? (data.page - 1) * data.per + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.per) : 0;
  const vendorFacet = data?.facets.vendor ?? [];
  const orderPhrase =
    sort === 'net'
      ? dir === 'asc'
        ? 'lowest value first'
        : 'highest value first'
      : sort === 'raised' && dir === 'asc'
        ? 'oldest first'
        : 'newest first';
  const tds = data?.totals ? Number(data.totals.tds) : null;

  return (
    <div className={cn('po-board', roomy && 'po--roomy')}>
      <div className="po-head">
        <h1 className="po-title">Purchase orders</h1>
        <p className="po-sub">
          {overview?.summary ? (
            <>
              <strong>
                {overview.summary.pos} {plural(overview.summary.pos, 'PO', 'POs')}
              </strong>{' '}
              to {overview.summary.vendors} {plural(overview.summary.vendors, 'supply point', 'supply points')}{' '}
              · <strong>{inr(overview.summary.payable)}</strong> payable in total
            </>
          ) : data ? (
            'Every purchase order we have raised, across every supply point.'
          ) : (
            'Loading purchase orders.'
          )}
        </p>
      </div>

      {overview?.stages && (
        <StageTiles
          stages={overview.stages}
          thresholds={thresholds}
          active={status}
          onPick={(s) => setFilter('status', s)}
        />
      )}

      {overview?.attention && <Attention attention={overview.attention} thresholds={thresholds} late={late} />}

      <form
        className="po-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter('q', typed.trim());
        }}
      >
        <label className="po-search">
          <SearchIcon />
          <input
            type="search"
            placeholder="PO number, order number or serial"
            aria-label="Search purchase orders"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => setFilter('q', typed.trim())}
          />
        </label>
        <label className="po-select">
          Supply point
          <select value={vendor} onChange={(e) => setFilter('vendor', e.target.value)}>
            <option value="">All ({vendorFacet.length})</option>
            {vendorFacet.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label} ({f.count})
              </option>
            ))}
          </select>
        </label>
        <div className="po-seg" role="group" aria-label="Row density">
          <button
            type="button"
            aria-pressed={!roomy}
            onClick={() => setFilter('density', '')}
          >
            Compact
          </button>
          <button
            type="button"
            aria-pressed={roomy}
            onClick={() => setFilter('density', 'roomy')}
          >
            Roomy
          </button>
        </div>
      </form>

      {late && (
        <p className="po-hint">
          Showing only{' '}
          {late === 'ack'
            ? `purchase orders raised over ${thresholds.ackDays} days ago and not acknowledged`
            : `purchase orders acknowledged over ${thresholds.dispatchDays} days ago and not dispatched`}
          .{' '}
          <button type="button" className="po-link" onClick={() => setFilter('late', '')}>
            Show all
          </button>
        </p>
      )}
      {data?.searchedFor && (
        <p className="po-hint">Compared against {data.searchedFor.join(', ')}.</p>
      )}

      {canDispatch && selected.size > 0 && (
        <div className="po-bulk" role="region" aria-label="Selected purchase orders">
          <span className="mono">
            {selected.size} selected
          </span>
          <button
            type="button"
            className="po-btn po-btn--primary"
            disabled={busy}
            onClick={() => void dispatchSelected()}
          >
            {busy ? 'Booking…' : 'Dispatch'}
          </button>
          <button type="button" className="po-btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      {outcome && (
        <p role="status" className="po-hint">
          {outcome}
        </p>
      )}

      <Board className="po-card">
        <DataBoard
          className="po-table"
          caption={
            data
              ? `${data.total} ${plural(data.total, 'purchase order', 'purchase orders')} match, ${orderPhrase}.`
              : 'Loading the purchase-order board.'
          }
          columns={columns}
          rows={rows}
          rowKey={(r) => r.poNumber}
          loading={!data}
          skeletonRows={8}
          sort={sort ? { key: sort, direction: dir } : undefined}
          onSort={(key) => {
            const next = new URLSearchParams(params);
            next.set('sort', key);
            next.set('dir', sort === key && dir === 'desc' ? 'asc' : 'desc');
            next.delete('page');
            setParams(next, { replace: true });
          }}
          empty={
            <EmptyState
              title={filtered ? 'Nothing matches this filter' : 'No purchase orders yet'}
              body={
                filtered
                  ? 'Purchase orders do exist — this filter has none of them. The box matches anywhere inside a PO number, order number or serial.'
                  : 'A purchase order is raised the moment a buyer approves an order — we buy the serial we just sold. Nothing has gone wrong.'
              }
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                    Clear the filter
                  </Button>
                ) : undefined
              }
            />
          }
        />
        <div className="po-foot">
          <span>
            {data ? (
              <>
                Showing{' '}
                <strong>
                  {from}–{to}
                </strong>{' '}
                of <strong>{data.total}</strong> {plural(data.total, 'purchase order', 'purchase orders')}{' '}
                · {orderPhrase}
              </>
            ) : (
              'Loading the purchase-order board.'
            )}
          </span>
          {data && data.pages > 1 ? (
            <Pagination
              className="po-pages"
              page={page}
              pageCount={data.pages}
              onPage={(next) => setFilter('page', String(next))}
              label="Pages"
            />
          ) : tds !== null && data && data.total > 0 ? (
            <span>
              {tds === 0
                ? 'TDS is ₹0 on every PO shown. Open a PO to see it.'
                : `TDS totals ${inr(tds)} across the POs shown. Open a PO to see its rate.`}
            </span>
          ) : null}
        </div>
      </Board>

      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        size="xl"
        title={<span className="mono">{open?.poNumber ?? 'Purchase order'}</span>}
        subtitle={
          open && (
            <span className="flex items-center gap-3">
              <span className={cn('po-pill', stageMeta(open.status).pill)}>
                {stageMeta(open.status).label}
              </span>
              <span>{open.vendorLegalName ?? 'Supply point unresolved'}</span>
            </span>
          )
        }
      >
        {open && (
          <div className="flex flex-col gap-5">
            <ChainStrip orderNumber={open.orderNumber} />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="Lines" value={String(open.lines)} />
              <Fact label="Net payable" value={inr(open.totalNet)} />
              <Fact label="TDS" value={inr(open.tdsAmount)} />
              <Fact label="Terms" value={`${open.termsDays} days`} />
              <Fact label="Raised" value={day(open.raisedAt)} />
              <Fact label="Acknowledged" value={open.acknowledgedAt ? day(open.acknowledgedAt) : 'Not yet'} />
            </dl>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mono tnum text-body-sm text-ink">{value}</dd>
    </div>
  );
}
