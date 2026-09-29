import * as React from 'react';
import { useSearchParams } from 'react-router';
import { Button, DataBoard, EmptyState, Pagination, cn, type Column } from '@trugrade/ui';
import { Board, NotMeasured, Textarea } from '../../lib/controls';
import { usePrincipal } from '../../lib/auth';
import { daysSince } from '../../lib/clock';
import { useResource } from '../../lib/useResource';
import { send } from '../qc/api';
import { humanise, OPS_API, rupees, type OpsListingBoard, type OpsListingRow } from './api';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions, with selection.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * The listing approval queue.
 *
 * A vendor declares a machine, a grade, a price and a quantity — no serials,
 * nothing inspected — and it lands here. Approving puts the declared quantity
 * on the storefront; rejecting sends it back with a reason the vendor reads on
 * their own board. The inspection happens later, per order, when a technician
 * is sent for exactly the machines a buyer has bought.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.lq-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as the other admin boards:
 *
 * - **The table is still `DataBoard`**, restyled through its wrapper class;
 *   below 960px its rows become the design's cards through per-column classes.
 * - **Every figure is the server's.** The header line, the Waiting badge, the
 *   flag count, the vendor list and the flag on a row all come back with the
 *   page. The one number computed here is the markup, which is arithmetic on
 *   two figures already on the row.
 * - **The flag is the pricing service's own guard, run early.** A row reads
 *   "Price looks too low" when Approve would refuse it (below the floor
 *   margin), when no margin rule prices it, or when the price-band check
 *   marked it far under the trailing median. The first two cannot be approved
 *   from here at all — there is no floor-override screen in this console yet —
 *   so the row offers "Review price", which says exactly that and offers the
 *   one decision that is possible: rejection with a reason.
 *
 * **Both prices sit on one row, and that is the point of this screen.** The
 * vendor's ask and our selling price are shown together nowhere a vendor or a
 * buyer can reach; here the person approving needs both to see the margin
 * they are approving.
 *
 * **Bulk approve is N approvals.** There is no bulk endpoint; the bar runs the
 * single one per selected row, in order, and reports how many went through.
 * Flagged rows cannot be selected, so a batch never silently skips one.
 */

const TABS = [
  { key: 'PENDING_APPROVAL', label: 'Waiting', word: 'waiting' },
  { key: 'ACTIVE', label: 'Approved', word: 'approved' },
  { key: 'REJECTED', label: 'Rejected', word: 'rejected' },
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `25 Sep`, as the design writes it. */
const onDay = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/** `today`, `yesterday`, `3 days ago`. */
export function agoWord(iso: string): string {
  const d = daysSince(iso);
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Whole rupees, for a total: `₹8,66,930`. Row prices keep their paise. */
const inr0 = (value: string | number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    Number(value),
  );

/** `+18.0%`, or null when either price is missing. */
export function markup(ask: string | null, sell: string | null): string | null {
  if (!ask || !sell) return null;
  const a = Number(ask);
  const s = Number(sell);
  if (!(a > 0) || !Number.isFinite(s)) return null;
  const pct = ((s - a) / a) * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
}

const shortName = (legal: string): string =>
  legal.replace(/[\s,]+(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|llp|inc\.?)$/i, '').trim();

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const gradeClass = (grade: string): string =>
  grade === 'A+' ? 'lq-grade lq-grade--ap' : grade === 'A' ? 'lq-grade' : 'lq-grade lq-grade--b';

const flagText = (row: OpsListingRow): string | null =>
  row.priceFlag === null
    ? null
    : row.priceFlag.reason === 'unpriced'
      ? 'No margin rule prices this'
      : 'Price looks too low';

function boardQuery(params: URLSearchParams): string {
  const q = new URLSearchParams();
  q.set('status', params.get('status') || 'PENDING_APPROVAL');
  for (const key of ['q', 'vendor', 'sort', 'flagged', 'page'] as const) {
    const value = params.get(key);
    if (value) q.set(key, value);
  }
  q.set('per', '25');
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
const InfoIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2" {...svgProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.5v.01" />
  </svg>
);
const SearchIcon = (): React.JSX.Element => (
  <svg width="18" height="18" strokeWidth="2" {...svgProps}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
const CheckIcon = ({ size = 16 }: { size?: number }): React.JSX.Element => (
  <svg width={size} height={size} strokeWidth="2.8" {...svgProps}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);
const CrossIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2.4" {...svgProps}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const WarnIcon = (): React.JSX.Element => (
  <svg width="12" height="12" strokeWidth="2.6" {...svgProps}>
    <path d="M12 3l10 18H2z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
);
const SortUpIcon = (): React.JSX.Element => (
  <svg width="12" height="12" strokeWidth="2.5" {...svgProps}>
    <path d="M6 15l6-6 6 6" />
  </svg>
);
const SortDownIcon = (): React.JSX.Element => (
  <svg width="12" height="12" strokeWidth="2.5" {...svgProps}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/* ======================================================================== */

export function ListingApprovalsRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  // Board state lives in the URL: the queue defaults to what is waiting, and a
  // colleague can be sent "the flagged ones from this vendor" as a link.
  const status = params.get('status') || 'PENDING_APPROVAL';
  const q = params.get('q') ?? '';
  const vendor = params.get('vendor') ?? '';
  const sort = params.get('sort') || 'oldest';
  const flaggedOnly = params.get('flagged') === '1';
  const page = Number(params.get('page') ?? '1');
  const filtered = Boolean(q || vendor || flaggedOnly);

  const [typed, setTyped] = React.useState(q);
  React.useEffect(() => setTyped(q), [q]);

  const [reloadToken, setReloadToken] = React.useState(0);
  const { data, error } = useResource<OpsListingBoard>(
    `${OPS_API.listings}?${boardQuery(params)}`,
    'The listing queue is unavailable',
    reloadToken,
  );
  const principal = usePrincipal();
  const canDecide = principal?.permissions.includes('listing.any.write') ?? false;

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  /* ---- decisions ---- */
  const [rejecting, setRejecting] = React.useState<OpsListingRow[] | null>(null);
  const [reviewing, setReviewing] = React.useState<OpsListingRow | null>(null);
  const [busyIds, setBusyIds] = React.useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  async function approveMany(rows: OpsListingRow[]): Promise<void> {
    setBusyIds(new Set(rows.map((r) => r.listingId)));
    setFailure(null);
    setNotice(null);
    let machines = 0;
    const done: string[] = [];
    const refused: string[] = [];
    for (const row of rows) {
      try {
        const live = await send<OpsListingRow>(
          OPS_API.approveListing(row.listingId),
          'POST',
          {},
          'The listing could not be approved',
        );
        machines += live.qtyAvailable;
        done.push(live.title ?? 'a listing');
      } catch (e) {
        refused.push(`${row.title ?? 'A listing'}: ${(e as Error).message}`);
      }
    }
    if (done.length > 0) {
      setNotice(
        done.length === 1
          ? `${done[0]} is live: ${machines} ${plural(machines, 'machine', 'machines')} on sale.`
          : `${done.length} listings are live: ${machines} machines on sale.`,
      );
    }
    if (refused.length > 0) setFailure(refused.join(' '));
    setBusyIds(new Set());
    setSelected(new Set());
    setReloadToken((n) => n + 1);
  }

  /* ---- selection ---- */
  const rows = React.useMemo(() => data?.rows ?? [], [data]);
  const selectable = (l: OpsListingRow): boolean =>
    canDecide && l.status === 'PENDING_APPROVAL' && l.priceFlag === null;
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  // A page of rows the operator can no longer see is not a selection.
  React.useEffect(() => setSelected(new Set()), [status, q, vendor, sort, flaggedOnly, page]);
  const selectableRows = rows.filter(selectable);
  const selectedRows = rows.filter((l) => selected.has(l.listingId));
  const allOnPage = selectableRows.length > 0 && selectableRows.every((l) => selected.has(l.listingId));
  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedUnits = selectedRows.reduce((n, l) => n + l.qtyTotal, 0);
  const selectedValue = selectedRows.reduce((n, l) => n + l.qtyTotal * Number(l.sellingPrice ?? 0), 0);

  // Rebuilt each render: the cells close over selection and busy state, and
  // DataBoard does not memoise on column identity.
  const columns = ((): ReadonlyArray<Column<OpsListingRow>> => {
    const body: Column<OpsListingRow>[] = [
      {
        key: 'machine',
        header: 'Machine',
        className: 'c-machine',
        cell: (l) => (
          <div className="lq-machine">
            <span className="lq-name">
              {l.title ?? (
                <NotMeasured why="The SKU behind this listing has been withdrawn" label="Model withdrawn" />
              )}
              <span className={gradeClass(l.grade)} title="Grade">
                {l.grade}
              </span>
            </span>
            {l.specSummary && <span className="lq-spec">{l.specSummary}</span>}
          </div>
        ),
      },
      {
        key: 'vendor',
        header: 'Vendor',
        className: 'c-vendor',
        cell: (l) => (
          <>
            {l.vendorLegalName ? (
              <div className="lq-vendor" title={l.vendorLegalName}>
                {shortName(l.vendorLegalName)}
              </div>
            ) : (
              <NotMeasured why="The vendor on this listing could not be resolved" label="Vendor unresolved" />
            )}
            {l.pickupCity && <div className="lq-city">{l.pickupCity}</div>}
          </>
        ),
      },
      { key: 'units', header: 'Units', numeric: true, className: 'c-units', cell: (l) => l.qtyTotal },
      {
        key: 'ask',
        header: (
          <>
            Vendor asks<small>per unit</small>
          </>
        ),
        numeric: true,
        className: 'c-ask',
        cell: (l) => (
          <>
            {l.vendorAskPrice ? (
              <div className="lq-money">{rupees(l.vendorAskPrice)}</div>
            ) : (
              <NotMeasured why="No payout was recorded on this listing" label="No ask" />
            )}
            {flagText(l) && (
              <div className="lq-flag">
                <WarnIcon />
                {flagText(l)}
              </div>
            )}
          </>
        ),
      },
      {
        key: 'sell',
        header: (
          <>
            We sell at<small>per unit · markup</small>
          </>
        ),
        numeric: true,
        className: 'c-sell',
        cell: (l) => {
          const pct = markup(l.vendorAskPrice, l.sellingPrice);
          return l.sellingPrice ? (
            <>
              <div className="lq-money lq-money--sell">{rupees(l.sellingPrice)}</div>
              {pct && <div className="lq-small">{pct}</div>}
            </>
          ) : (
            <NotMeasured why="The margin rule has not priced this listing yet" label="Not priced" />
          );
        },
      },
      {
        key: 'submitted',
        header: 'Submitted',
        sortable: true,
        className: 'c-date',
        cell: (l) => (
          <>
            <div className="lq-date">{onDay(l.submittedAt)}</div>
            <div className="lq-small">{agoWord(l.submittedAt)}</div>
          </>
        ),
      },
      {
        key: 'decision',
        header: 'Decision',
        numeric: true,
        className: 'c-act',
        cell: (l) => <Decision l={l} />,
      },
    ];
    if (!canDecide || status !== 'PENDING_APPROVAL') return body;
    return [
      {
        key: 'select',
        header: (
          <input
            type="checkbox"
            checked={allOnPage}
            disabled={selectableRows.length === 0}
            onChange={() =>
              setSelected(allOnPage ? new Set() : new Set(selectableRows.map((l) => l.listingId)))
            }
            aria-label="Select all listings"
          />
        ),
        className: 'c-cb',
        cell: (l) =>
          selectable(l) ? (
            <input
              type="checkbox"
              checked={selected.has(l.listingId)}
              onChange={() => toggle(l.listingId)}
              aria-label={`Select ${l.title ?? 'listing'}`}
            />
          ) : (
            <input
              type="checkbox"
              disabled
              title="Review this one on its own"
              aria-label={`${l.title ?? 'This listing'} cannot be selected — review it on its own`}
            />
          ),
      },
      ...body,
    ];
  })();

  function Decision({ l }: { l: OpsListingRow }): React.JSX.Element {
    if (l.status !== 'PENDING_APPROVAL') {
      if (l.status === 'ACTIVE' || l.status === 'PARTIALLY_ACTIVE') {
        return (
          <span className="lq-small">
            Live · <span className="mono">{l.qtyAvailable}</span> on sale
          </span>
        );
      }
      if (l.status === 'REJECTED') {
        return <span className="lq-reason">{l.rejectionReason ?? 'Rejected without a recorded reason'}</span>;
      }
      return <span className="lq-small">{humanise(l.status)}</span>;
    }
    if (!canDecide) return <span className="lq-small">Waiting</span>;
    if (l.priceFlag) {
      return (
        <button type="button" className="lq-review" onClick={() => setReviewing(l)}>
          Review price
        </button>
      );
    }
    const busy = busyIds.has(l.listingId);
    return (
      <span className="lq-acts">
        <button
          type="button"
          className="lq-ibtn lq-ibtn--reject"
          aria-label={`Reject ${l.title ?? 'listing'}`}
          title="Reject"
          disabled={busy}
          onClick={() => setRejecting([l])}
        >
          <CrossIcon />
        </button>
        <button
          type="button"
          className="lq-ibtn lq-ibtn--approve"
          aria-label={`Approve ${l.title ?? 'listing'}`}
          title="Approve"
          disabled={busy}
          onClick={() => void approveMany([l])}
        >
          <CheckIcon />
        </button>
      </span>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="The listing queue did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  const waiting = data?.facets.status.find((f) => f.value === 'PENDING_APPROVAL')?.count ?? 0;
  const tab = TABS.find((t) => t.key === status);
  const from = data && data.total > 0 ? (data.page - 1) * data.per + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.per) : 0;
  const anyFlagged = rows.some((l) => l.priceFlag !== null && l.status === 'PENDING_APPROVAL');

  return (
    <div className="listing-approvals">
      <div className="lq-head">
        <div>
          <h1 className="lq-title">Listing approvals</h1>
          <p className="lq-sub">
            {data ? (
              <>
                <strong>
                  {data.total} {plural(data.total, 'listing', 'listings')}
                </strong>{' '}
                {tab?.word ?? humanise(status).toLowerCase()} · {data.totals.units}{' '}
                {plural(data.totals.units, 'unit', 'units')} · {inr0(data.totals.value)} at storefront
                prices
              </>
            ) : (
              'Loading the listing queue.'
            )}
          </p>
        </div>
        <div className="lq-seg" role="group" aria-label="Filter by status">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={status === t.key}
              onClick={() => setFilter('status', t.key)}
            >
              {t.label}
              {t.key === 'PENDING_APPROVAL' && data && <span className="n">{waiting}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="lq-rule">
        <InfoIcon />
        <span>
          Approving puts <strong>all declared units on sale</strong>. Machines are only inspected once a
          buyer orders them.
        </span>
      </div>

      <form
        className="lq-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter('q', typed.trim());
        }}
      >
        <label className="lq-search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search model, SKU or vendor"
            aria-label="Search listings"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => setFilter('q', typed.trim())}
          />
        </label>
        <label className="lq-select">
          Vendor
          <select value={vendor} onChange={(e) => setFilter('vendor', e.target.value)}>
            <option value="">All vendors</option>
            {(data?.facets.vendor ?? []).map((f) => (
              <option key={f.value} value={f.value}>
                {shortName(f.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="lq-select">
          Sort
          <select value={sort} onChange={(e) => setFilter('sort', e.target.value)}>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="units">Most units</option>
            <option value="value">Highest value</option>
          </select>
        </label>
        <button
          type="button"
          className="lq-toggle"
          aria-pressed={flaggedOnly}
          onClick={() => setFilter('flagged', flaggedOnly ? '' : '1')}
        >
          <span className="d" aria-hidden="true" />
          Price flags {data && <span className="mono">{data.flagged}</span>}
        </button>
      </form>

      {notice && (
        <p role="status" className="lq-note">
          {notice}
        </p>
      )}
      {failure && (
        <p role="alert" className="lq-note lq-note--bad">
          {failure}
        </p>
      )}

      <Board className="lq-card">
        {selectedRows.length > 0 && (
          <div className="lq-bulk" role="region" aria-label="Bulk actions">
            <strong>{selectedRows.length} selected</strong>
            <span className="meta">
              {selectedUnits} {plural(selectedUnits, 'unit', 'units')} · {inr0(selectedValue)} at
              storefront prices
            </span>
            <button type="button" className="clear" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="b"
              disabled={busyIds.size > 0}
              onClick={() => setRejecting(selectedRows)}
            >
              Reject {selectedRows.length}
            </button>
            <button
              type="button"
              className="b b--approve"
              disabled={busyIds.size > 0}
              onClick={() => void approveMany(selectedRows)}
            >
              <CheckIcon size={14} />
              {busyIds.size > 0 ? 'Approving…' : `Approve ${selectedRows.length}`}
            </button>
          </div>
        )}
        <DataBoard
          className="lq-table"
          caption={
            data
              ? `${data.total} ${plural(data.total, 'listing', 'listings')} ${tab?.word ?? ''}, ${
                  sort === 'newest'
                    ? 'newest first'
                    : sort === 'units'
                      ? 'most units first'
                      : sort === 'value'
                        ? 'highest value first'
                        : 'oldest first'
                }.`
              : 'Loading the listing queue.'
          }
          columns={columns}
          rows={rows}
          rowKey={(l) => l.listingId}
          rowClassName={(l) =>
            cn(
              selected.has(l.listingId) && 'is-selected',
              l.priceFlag !== null && l.status === 'PENDING_APPROVAL' && 'is-flagged',
            ) || undefined
          }
          sort={
            sort === 'newest'
              ? { key: 'submitted', direction: 'desc' }
              : sort === 'oldest'
                ? { key: 'submitted', direction: 'asc' }
                : undefined
          }
          onSort={() => setFilter('sort', sort === 'oldest' ? 'newest' : 'oldest')}
          loading={!data}
          skeletonRows={5}
          empty={
            <EmptyState
              title={
                filtered
                  ? 'Nothing matches this filter'
                  : status === 'PENDING_APPROVAL'
                    ? 'Nothing is waiting'
                    : 'No listings here'
              }
              body={
                filtered
                  ? 'Listings do exist in this status — this filter has none of them. The box matches anywhere inside a model name, SKU code or vendor name.'
                  : status === 'PENDING_APPROVAL'
                    ? 'Every listing a vendor has sent has been decided. A new one appears here the moment a vendor presses “Send for approval”.'
                    : 'No listing is in this status. Switch tabs to see the others.'
              }
              action={
                filtered ? (
                  <Button
                    variant="secondary"
                    onClick={() => setParams(new URLSearchParams({ status }), { replace: true })}
                  >
                    Clear the filter
                  </Button>
                ) : undefined
              }
            />
          }
        />
        <div className="lq-foot">
          <span>
            {data ? (
              <>
                Showing{' '}
                <strong>
                  {from}–{to}
                </strong>{' '}
                of <strong>{data.total}</strong>
                {anyFlagged && ' · flagged listings can’t be bulk-approved'}
              </>
            ) : (
              'Loading the listing queue.'
            )}
          </span>
          {data && data.pages > 1 ? (
            <Pagination
              className="lq-pages"
              page={page}
              pageCount={data.pages}
              onPage={(next) => setFilter('page', String(next))}
              label="Pages"
            />
          ) : null}
        </div>
      </Board>

      {/* The header's sort glyphs are the design's; DataBoard's own are hidden by the wrapper class. */}
      <span className="sr-only" aria-hidden="true">
        <SortUpIcon />
        <SortDownIcon />
      </span>

      {reviewing && (
        <ReviewPriceDialog
          row={reviewing}
          onClose={() => setReviewing(null)}
          onReject={(row) => {
            setReviewing(null);
            setRejecting([row]);
          }}
          onApprove={
            reviewing.priceFlag?.reason === 'below_band'
              ? (row) => {
                  setReviewing(null);
                  void approveMany([row]);
                }
              : undefined
          }
        />
      )}

      {rejecting && (
        <RejectDialog
          rows={rejecting}
          onClose={() => setRejecting(null)}
          onRejected={(count, machines) => {
            setRejecting(null);
            setNotice(
              count === 1
                ? `The listing was sent back to the vendor with your reason.`
                : `${count} listings (${machines} machines) were sent back to their vendors with your reason.`,
            );
            setSelected(new Set());
            setReloadToken((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/* ======================================================================== */

/**
 * What the flag means and what can be done about it, in the row's own figures.
 *
 * Below the floor or unpriced, the honest answer is that approval is not
 * available from this console — the floor override lives in the pricing
 * service and has no screen yet — so the dialog offers rejection and nothing
 * that would fail. A band flag is a warning, so approve stays on the table.
 */
function ReviewPriceDialog({
  row,
  onClose,
  onReject,
  onApprove,
}: {
  row: OpsListingRow;
  onClose: () => void;
  onReject: (row: OpsListingRow) => void;
  onApprove?: (row: OpsListingRow) => void;
}): React.JSX.Element {
  const flag = row.priceFlag;
  const pct = markup(row.vendorAskPrice, row.sellingPrice);
  const name = row.title ?? 'this listing';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-title"
      className="lq-dialog fixed inset-0 z-40 flex items-end justify-center bg-chrome/70 p-4 sm:items-center"
    >
      <div className="lq-dialog__box">
        <h2 id="review-title">Review the price on {name}</h2>
        <dl className="lq-facts">
          <div>
            <dt>Vendor asks</dt>
            <dd className="mono">{row.vendorAskPrice ? rupees(row.vendorAskPrice) : 'No ask'}</dd>
          </div>
          <div>
            <dt>We would sell at</dt>
            <dd className="mono">
              {row.sellingPrice ? rupees(row.sellingPrice) : 'Not priced'}
              {pct && <span className="lq-small"> {pct}</span>}
            </dd>
          </div>
          {flag?.floorPrice && (
            <div>
              <dt>Floor for this configuration</dt>
              <dd className="mono">{rupees(flag.floorPrice)}</dd>
            </div>
          )}
          {flag?.bandMedian && (
            <div>
              <dt>30-day median, this configuration and grade</dt>
              <dd className="mono">
                {rupees(flag.bandMedian)}
                {flag.bandRatio !== null && <span className="lq-small"> · ours is {flag.bandRatio}× that</span>}
              </dd>
            </div>
          )}
        </dl>
        <p>
          {flag?.reason === 'below_floor' &&
            `At this ask our margin rule prices ${name} below the floor for its configuration, so Approve would refuse it. The floor override has no screen in this console yet: send it back with a reason the vendor can act on, or leave it waiting.`}
          {flag?.reason === 'unpriced' &&
            `No margin rule prices this configuration, so ${name} cannot be approved until one does. Send it back with a reason, or leave it waiting until a rule covers it.`}
          {flag?.reason === 'below_band' &&
            `Our price for ${name} is far under what this configuration has sold for at this grade in the last 30 days. That does not block approval — check the ask is not a typo before you approve.`}
        </p>
        <div className="lq-dialog__acts">
          <Button variant="ghost" onClick={onClose}>
            Keep it waiting
          </Button>
          <Button variant="secondary" onClick={() => onReject(row)}>
            Reject with a reason
          </Button>
          {onApprove && (
            <Button variant="primary" onClick={() => onApprove(row)}>
              Approve anyway
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Rejecting needs a sentence the vendor can act on. Eight characters is not a
 * quality bar, it is a typo bar; the sentence is the point. One reason for the
 * whole selection: a batch rejected for different reasons is not one batch.
 */
function RejectDialog({
  rows,
  onClose,
  onRejected,
}: {
  rows: OpsListingRow[];
  onClose: () => void;
  onRejected: (count: number, machines: number) => void;
}): React.JSX.Element {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const tooShort = reason.trim().length < 8;
  const one = rows.length === 1 ? rows[0] : null;

  async function reject(): Promise<void> {
    setBusy(true);
    setError(null);
    let count = 0;
    let machines = 0;
    const refused: string[] = [];
    for (const row of rows) {
      try {
        const done = await send<OpsListingRow>(
          OPS_API.rejectListing(row.listingId),
          'POST',
          { reason: reason.trim() },
          'The listing could not be rejected',
        );
        count += 1;
        machines += done.qtyTotal;
      } catch (e) {
        refused.push(`${row.title ?? 'A listing'}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    if (refused.length > 0 && count === 0) {
      setError(refused.join(' '));
      return;
    }
    if (refused.length > 0) setError(refused.join(' '));
    onRejected(count, machines);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-title"
      className="lq-dialog fixed inset-0 z-40 flex items-end justify-center bg-chrome/70 p-4 sm:items-center"
    >
      <div className="lq-dialog__box">
        <h2 id="reject-title">
          Reject {one ? (one.title ?? 'this listing') : `${rows.length} listings`}
        </h2>
        <p>
          {one
            ? `${one.vendorLegalName ? shortName(one.vendorLegalName) : 'The vendor'} reads this on their listings board. Say what to change, not what rule broke.`
            : 'Each vendor reads this on their listings board. One reason goes to all of them — if they need different reasons, reject them one at a time.'}
        </p>
        <div className="mt-4">
          <Textarea
            label="Reason"
            required
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint="For example: “The ask is above what this configuration sells for at grade B. Resubmit at or under ₹38,000.”"
            error={reason.length > 0 && tooShort ? 'Write at least a short sentence.' : undefined}
          />
        </div>
        {error && (
          <p role="alert" className="lq-note lq-note--bad mt-3">
            {error}
          </p>
        )}
        <div className="lq-dialog__acts">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep {one ? 'it' : 'them'} waiting
          </Button>
          <Button
            variant="secondary"
            loading={busy}
            disabledReason={tooShort ? 'Write the reason first.' : undefined}
            onClick={() => void reject()}
          >
            Reject and send back
          </Button>
        </div>
      </div>
    </div>
  );
}
