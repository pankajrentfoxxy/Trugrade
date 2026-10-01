import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { DataBoard, EmptyState, cn, type Column } from '@trugrade/ui';
import { daysSince } from '../lib/clock';
import { Board } from '../lib/controls';
import { useResource } from '../lib/useResource';
import { useUrlState } from '../lib/urlState';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * Ordered by SLA risk, not FIFO (03_UX_SPEC.md §3C.1). The server does the
 * ordering — `KycService.reviewQueue` sorts on `review_sla_due_at` — so a page
 * this board never renders (the second one, if it ever exists) is ordered the
 * same way.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup and colours verbatim
 * (`.review-queue-board`/`.rq-*` in `index.css`, `--admin-*` in
 * `globals.css`) — same arrangement as `CatalogTree.tsx` and `OrderBoard.tsx`.
 * **The table itself is still `DataBoard`** — `09_FRONTEND_LOCKED.md`'s
 * density rule is "one DataBoard component, three settings", and the mock's
 * own hand-rolled `<table>` would have been a second one. `.rq-card`/
 * `.rq-table` are its `className` props; every richer cell is a `Column.cell`
 * renderer inside the same board, and `c-biz`/`c-status`/`c-action` are each
 * column's own `className`, which is what lets the mock's mobile card layout
 * reach the right `<td>`s.
 *
 * ONE DELIBERATE REVERSAL from this file's own earlier history: T28's colour
 * sweep had moved the breach indicator off `--fail` red onto amber, reasoning
 * that a red mark against an applicant's name reads as a verdict on them for a
 * delay that is ours. This pass puts the supplied design's red (`--admin-bad`)
 * back, at the product owner's direction — the same red the catalog and
 * orders boards already take verbatim for their own marks. If that reasoning
 * should still hold here, swap `--admin-bad` for `--admin-warn` in the
 * `.rq-late__*` rules in `index.css`; nothing else in this file depends on it.
 *
 * The stat tiles and every count are computed from the same `items` this page
 * already fetches — none of the mock's own sample numbers (its "31 days", its
 * named businesses) are hardcoded here; `CLAUDE.md` reserves counters and
 * scores for what the API actually returned.
 *
 * **Typeface: IBM Plex Sans/Mono, loaded once in `OpsShell.tsx`.** The
 * supplied design set these rather than the product's own Lato. Every admin
 * screen shares one frame (`OpsShell`), so the override lives there instead
 * of being repeated per route — this file carries no font of its own.
 */

export interface ReviewQueueItem {
  orgId: string;
  legalName: string;
  orgType: string;
  status: string;
  submittedAt: string | null;
  slaDueAt: string | null;
  hoursRemaining: number | null;
  slaBreached: boolean;
  /**
   * The promise for this row, in hours. **Not a constant.** A vendor is owed 48
   * and a buyer 24, and this board used to state 48 over both.
   */
  slaHours: number | null;
}

/** "6 h" under a day; "3 days 7 h" beyond it — the same number, read the way
 * a reviewer would say it rather than as three-digit hours. */
function formatHours(hours: number): string {
  const whole = Math.round(Math.abs(hours));
  if (whole < 24) return `${whole} h`;
  const days = Math.floor(whole / 24);
  const rest = whole % 24;
  return rest === 0
    ? `${days} day${days === 1 ? '' : 's'}`
    : `${days} day${days === 1 ? '' : 's'} ${rest} h`;
}

/**
 * The SLA column, which is the only reason this screen is ordered the way it is.
 *
 * `worstHours` is this render's worst BREACHED hour figure across the whole
 * queue (not just the rows currently shown) — the bar reads "how bad relative
 * to the worst one right now", the same relative reading the mock's hand-set
 * bar widths were going for, just computed rather than per row.
 */
function SlaCell({
  item,
  worstHours,
}: {
  item: ReviewQueueItem;
  worstHours: number;
}): React.JSX.Element {
  if (item.hoursRemaining === null) {
    // Not a dash, and not a tick. "No clock on this application" and "no time
    // left" must never look alike.
    return <span className="rq-none">No promise recorded</span>;
  }

  const promise = item.slaHours === null ? null : <>{item.slaHours} h</>;

  if (item.slaBreached) {
    const pct =
      worstHours > 0
        ? Math.max(6, Math.round((Math.abs(item.hoursRemaining) / worstHours) * 100))
        : 100;
    return (
      <div className="rq-late">
        <span className="rq-late__main">{formatHours(item.hoursRemaining)} late</span>
        <span className="rq-late__bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="rq-late__sub">
          {promise ? <>Promised within {promise}</> : 'No promise recorded'}
          {item.slaDueAt
            ? ` · due ${new Date(item.slaDueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
            : ''}
        </span>
      </div>
    );
  }

  return (
    <span className="rq-left">
      <span className="mono">{formatHours(item.hoursRemaining)}</span> left
      {promise ? (
        <>
          {' '}
          of <span className="mono">{promise}</span>
        </>
      ) : null}
    </span>
  );
}

/** How long they have been waiting on us, which is the other half of the SLA. */
function daysAgo(iso: string): string {
  const days = daysSince(iso);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function WaitingCell({ item }: { item: ReviewQueueItem }): React.JSX.Element {
  if (item.submittedAt === null) {
    return <span className="rq-none">Not submitted</span>;
  }
  return (
    <>
      <div className="rq-date">
        {new Date(item.submittedAt).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}
      </div>
      <div className="rq-ago">{daysAgo(item.submittedAt)}</div>
    </>
  );
}

/** First letters of up to two words of the legal name — "Ambattur Recommerce" → "AR". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function BusinessCell({ item }: { item: ReviewQueueItem }): React.JSX.Element {
  const vendor = item.orgType === 'VENDOR';
  return (
    <div className="rq-biz">
      <span
        className={cn('rq-avatar', vendor ? 'rq-avatar--vendor' : 'rq-avatar--buyer')}
        aria-hidden="true"
      >
        {initials(item.legalName)}
      </span>
      <div>
        <Link to={`/kyc/${item.orgId}`} className="rq-biz__name">
          {item.legalName}
        </Link>
        <div className={cn('rq-biz__type', vendor ? 'rq-biz__type--vendor' : 'rq-biz__type--buyer')}>
          {item.orgType === 'VENDOR' ? 'Vendor' : item.orgType === 'BUYER' ? 'Buyer' : item.orgType}
        </div>
      </div>
    </div>
  );
}

/**
 * The status pill. `UNDER_REVIEW` isn't in the mock — it has no
 * waiting-on-someone-else meaning, so it keeps the product's own accent
 * instead as an active state, one of the three things that colour is for on
 * this surface.
 */
type PillVariant = 'ready' | 'waiting' | 'active' | 'neutral';

const STATUS_META: Readonly<Record<string, { label: string; variant: PillVariant; note: string }>> =
  {
    KYC_SUBMITTED: { label: 'KYC submitted', variant: 'ready', note: 'Ready for review' },
    UNDER_REVIEW: { label: 'Under review', variant: 'active', note: 'Being reviewed' },
    INFO_REQUESTED: {
      label: 'Info requested',
      variant: 'waiting',
      note: 'Waiting on their reply',
    },
  };

function StatusCell({ item }: { item: ReviewQueueItem }): React.JSX.Element {
  const meta = STATUS_META[item.status];
  const variant = meta?.variant ?? 'neutral';
  return (
    <>
      <span className={cn('rq-pill', `rq-pill--${variant}`)}>
        <span className="dot" aria-hidden="true" />
        {meta?.label ?? item.status.replace(/_/g, ' ')}
      </span>
      {meta ? <div className="rq-status-note">{meta.note}</div> : null}
    </>
  );
}

function ActionCell({ item }: { item: ReviewQueueItem }): React.JSX.Element {
  const navigate = useNavigate();
  const reviewable = item.status !== 'INFO_REQUESTED';
  return (
    <button
      type="button"
      className={cn('rq-btn', reviewable && 'rq-btn--primary')}
      onClick={() => navigate(`/kyc/${item.orgId}`)}
    >
      {reviewable ? 'Review KYC' : 'View'}
    </button>
  );
}

/** The two independent facets a reviewer actually cuts by — the mock's own
 * segmented type filter and separate overdue toggle, rather than one
 * single-select list. A reviewer can ask for "vendors, only overdue" at once. */
const TYPES = [
  { key: '', label: 'All' },
  { key: 'vendor', label: 'Vendors' },
  { key: 'buyer', label: 'Buyers' },
] as const;

const matchesType = (type: string, i: ReviewQueueItem): boolean =>
  type === 'vendor' ? i.orgType === 'VENDOR' : type === 'buyer' ? i.orgType === 'BUYER' : true;

export function ReviewQueueRoute(): React.JSX.Element {
  const { data: items, error } = useResource<ReviewQueueItem[]>(
    '/api/kyc/review-queue',
    'The review queue is unavailable',
  );
  // In the URL, not in state: a reviewer pastes "the overdue vendors" into chat.
  const [type, setType] = useUrlState('type');
  const [onlyOverdue, setOnlyOverdue] = useUrlState('overdue');
  const [q, setQ] = useUrlState('q');

  if (error) {
    return (
      <EmptyState
        title="The review queue did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  const all = items ?? [];
  const breached = all.filter((i) => i.slaBreached).length;
  const worstHours = Math.max(
    0,
    ...all
      .filter((i) => i.slaBreached && i.hoursRemaining !== null)
      .map((i) => Math.abs(i.hoursRemaining!)),
  );

  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((i) => matchesType(type, i))
    .filter((i) => (onlyOverdue === 'true' ? i.slaBreached : true))
    .filter((i) => (needle ? i.legalName.toLowerCase().includes(needle) : true));

  const submitted = all.filter(
    (i): i is ReviewQueueItem & { submittedAt: string } => i.submittedAt !== null,
  );
  const oldest =
    submitted.length > 0
      ? submitted.reduce((a, b) => (new Date(a.submittedAt) < new Date(b.submittedAt) ? a : b))
      : null;
  const longestWaitDays = oldest ? daysSince(oldest.submittedAt) : null;

  // Stated from what the data actually shows for each org type, never a
  // hardcoded "48 for vendors, 24 for buyers".
  const vendorSla = all.find((i) => i.orgType === 'VENDOR' && i.slaHours !== null)?.slaHours;
  const buyerSla = all.find((i) => i.orgType === 'BUYER' && i.slaHours !== null)?.slaHours;

  const columns: ReadonlyArray<Column<ReviewQueueItem>> = [
    { key: 'legalName', header: 'Business', className: 'c-biz', cell: (item) => <BusinessCell item={item} /> },
    { key: 'status', header: 'Status', className: 'c-status', cell: (item) => <StatusCell item={item} /> },
    { key: 'submitted', header: 'Submitted', className: 'c-sub', cell: (item) => <WaitingCell item={item} /> },
    {
      key: 'sla',
      header: 'Overdue by',
      className: 'c-late',
      cell: (item) => <SlaCell item={item} worstHours={worstHours} />,
    },
    {
      key: 'action',
      header: '',
      headerHidden: true,
      className: 'c-action num',
      cell: (item) => <ActionCell item={item} />,
    },
  ];

  if (items && items.length === 0) {
    return (
      <div className="review-queue-board">
        <div>
          <h1 className="rq-title">Review queue</h1>
          <p className="rq-sub">KYC checks for new vendors and buyers. The most overdue are at the top.</p>
        </div>
        <EmptyState
          title="Queue clear"
          body="Every submitted application has been decided. New ones appear here the moment a vendor or buyer submits, and the clock starts then."
        />
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  return (
    <div className="review-queue-board">
      <div>
        <h1 className="rq-title">Review queue</h1>
        <p className="rq-sub">
          {items
            ? 'KYC checks for new vendors and buyers. The most overdue are at the top.'
            : 'Loading the applications waiting on a decision.'}
        </p>
      </div>

      {items ? (
        <div className="rq-stats">
          <div className="rq-stat">
            <span className="rq-stat__label">Waiting for review</span>
            <span className="rq-stat__value">
              {all.length}
              <small>{all.length === 1 ? 'business' : 'businesses'}</small>
            </span>
            <span className="rq-stat__meta">
              {all.filter((i) => i.orgType === 'VENDOR').length} vendors ·{' '}
              {all.filter((i) => i.orgType === 'BUYER').length} buyers
            </span>
          </div>
          <div className={cn('rq-stat', breached > 0 && 'rq-stat--late')}>
            <span className="rq-stat__label">Past our promise</span>
            <span className="rq-stat__value">
              {breached}
              <small>of {all.length}</small>
            </span>
            {vendorSla !== undefined && buyerSla !== undefined ? (
              <span className="rq-stat__meta">
                We promise {vendorSla} h for vendors, {buyerSla} h for buyers
              </span>
            ) : null}
          </div>
          <div className="rq-stat">
            <span className="rq-stat__label">Longest wait</span>
            {longestWaitDays !== null ? (
              <>
                <span className="rq-stat__value">
                  {longestWaitDays}
                  <small>{longestWaitDays === 1 ? 'day' : 'days'}</small>
                </span>
                {oldest ? (
                  <span className="rq-stat__meta">
                    {oldest.legalName}, since{' '}
                    {new Date(oldest.submittedAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="rq-stat__value" style={{ color: 'var(--admin-faint)' }}>
                Not measured
              </span>
            )}
          </div>
        </div>
      ) : null}

      <div className="rq-toolbar">
        <div className="rq-seg" role="group" aria-label="Business type">
          {TYPES.map((t) => {
            const pressed = type === t.key;
            const count = all.filter((i) => matchesType(t.key, i)).length;
            return (
              <button
                key={t.key || 'all'}
                type="button"
                aria-pressed={pressed}
                onClick={() => setType(t.key)}
              >
                {t.label} <span>{count}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="rq-toggle"
          aria-pressed={onlyOverdue === 'true'}
          onClick={() => setOnlyOverdue(onlyOverdue === 'true' ? '' : 'true')}
        >
          <span className="dot" aria-hidden="true" />
          Only overdue <span className="mono">{breached}</span>
        </button>
        <span className="rq-spacer" />
        <label className="rq-search">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Search business name"
            aria-label="Search business name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      <Board className="rq-card">
        <DataBoard
          className="rq-table"
          caption={
            items
              ? `${rows.length} of ${all.length} applications, ordered by our own deadline, the ones we have already broken first.`
              : 'Loading the review queue.'
          }
          columns={columns}
          rows={rows}
          rowKey={(item) => item.orgId}
          loading={!items}
          skeletonRows={6}
          empty={
            <EmptyState
              title="Nothing matches this view"
              body="The queue is not empty — this filter is. Clear a filter to see the rest of it."
            />
          }
        />
        {items && rows.length > 0 ? (
          <div className="rq-foot">
            <span>
              Showing <strong>{rows.length}</strong> of <strong>{all.length}</strong> · sorted by
              deadline, most overdue first
            </span>
            <span>Times shown as of today, {today}</span>
          </div>
        ) : null}
      </Board>
    </div>
  );
}
