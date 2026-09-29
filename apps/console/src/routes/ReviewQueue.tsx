import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, DataBoard, EmptyState, Input, KpiRow, cn, type Column } from '@trugrade/ui';
import { daysSince } from '../lib/clock';
import { Board, PageHeader } from '../lib/controls';
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
 * REDESIGNED against a supplied mock (a KPI strip, a segmented type filter, an
 * independent "only overdue" toggle, a search box, richer row cells with an
 * avatar and a status note, and a proportional bar on how overdue a row is).
 * **The table itself is still `DataBoard`** — `09_FRONTEND_LOCKED.md`'s
 * density rule is "one DataBoard component, three settings", and the mock's
 * own hand-rolled `<table>` would have been a second one. Every richer cell
 * below is a `Column.cell` renderer inside the same board.
 *
 * **One thing from the mock was not carried over on purpose: the red
 * "overdue" colour.** T28's colour sweep already ran on this exact screen and
 * deliberately moved a breach off `--fail` onto `--warn`, on the number rather
 * than a chip — see the comment on `SlaCell` below for why a red mark against
 * an applicant's name reads as a verdict on THEM for a delay that is ours.
 * Reintroducing red here would undo that fix. The bar, the bold weight and the
 * "N days M h late" phrasing are kept; the colour is `--warn` throughout.
 *
 * The stat tiles and every count are computed from the same `items` this page
 * already fetches — none of the mock's own sample numbers (its "31 days",
 * its named business) are hardcoded here; `CLAUDE.md` reserves counters and
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

/** Below this many hours left, a row is worth looking at before the others. */
const WARN_AT_HOURS = 12;

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
 * Hours, in the product's own mono type, rounded the way a person says them.
 *
 * The API sends one decimal place because it sorts on the value; a reviewer
 * reads "6 h", not "6.0 h", and a column of them has to line up.
 */
function Hours({ value, tone }: { value: number; tone: 'ink' | 'warn' }): React.JSX.Element {
  return (
    <span className={cn('font-mono tnum', tone === 'warn' ? 'text-warn' : 'text-ink')}>
      {formatHours(value)}
    </span>
  );
}

/**
 * The SLA column, which is the only reason this screen is ordered the way it is.
 *
 * **A breach is ours, and the colour says so.** `--fail` means FAIL, and a red
 * chip against an applicant's name because *we* were slow reads as a rejection
 * — T28's colour sweep found exactly that here. Nobody has been judged.
 *
 * **And the amber is on the number, not on a chip.** The first pass put a warn
 * `StatusPill` on every breached row, which on a real queue is fifteen outlined
 * amber chips down one column — a decorative wash, and the moment amber becomes
 * one of those it stops meaning anything. `09_FRONTEND_LOCKED.md` allows amber
 * for exactly three things and one of them is *a measured value*: the hours are
 * the measured value, so the hours carry the colour and the sentence carries
 * the meaning.
 *
 * The promise is named on every row rather than in the page header, because the
 * two org types are not owed the same thing and a header can only say one
 * number. Where the org type carries no promise at all, the clause is dropped
 * rather than defaulted — the same rule `QueueItem.slaHours` follows.
 *
 * `worstHours` is this render's worst BREACHED hour figure across the whole
 * queue (not just the rows currently shown) — the bar reads "how bad relative
 * to the worst one right now", the same relative reading the mock's bar widths
 * were going for, just computed rather than hand-set per row.
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
    return <span className="text-body-sm text-ink-4">No promise recorded</span>;
  }

  const promise =
    item.slaHours === null ? null : (
      <span className="text-ink-4">
        {' '}
        of <span className="font-mono tnum">{item.slaHours} h</span>
      </span>
    );

  if (item.slaBreached) {
    const pct =
      worstHours > 0
        ? Math.max(6, Math.round((Math.abs(item.hoursRemaining) / worstHours) * 100))
        : 100;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-body-sm font-semibold text-ink-2">
          <Hours value={item.hoursRemaining} tone="warn" /> late
        </span>
        <span
          className="h-1 w-[140px] overflow-hidden rounded-full bg-warn-track"
          aria-hidden="true"
        >
          <span className="block h-full rounded-full bg-warn" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-label text-ink-3">Promised within{promise}</span>
      </div>
    );
  }

  return (
    <span className="text-body-sm text-ink-2">
      <Hours
        value={item.hoursRemaining}
        tone={item.hoursRemaining <= WARN_AT_HOURS ? 'warn' : 'ink'}
      />{' '}
      left{promise}
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
    return <span className="text-body-sm text-ink-4">Not submitted</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono tnum text-body-sm text-ink-2">
        {new Date(item.submittedAt).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}
      </span>
      <span className="text-label text-ink-3">{daysAgo(item.submittedAt)}</span>
    </div>
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
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-rule bg-sheet-2 font-mono text-label text-ink-2"
        aria-hidden="true"
      >
        {initials(item.legalName)}
      </span>
      <span className="min-w-0">
        <Link
          to={`/kyc/${item.orgId}`}
          className="block truncate text-body-sm font-semibold text-ink underline decoration-rule underline-offset-4 hover:decoration-acc"
        >
          {item.legalName}
        </Link>
        <span className="text-label text-ink-3">
          {item.orgType === 'VENDOR' ? 'Vendor' : item.orgType === 'BUYER' ? 'Buyer' : item.orgType}
        </span>
      </span>
    </div>
  );
}

/**
 * The status pill, drawn to match the supplied design's exact two colours
 * rather than the shared `StatusPill`'s tone set, which doesn't offer this
 * light-blue/light-amber pairing. `--kyc-ready-*`/`--kyc-waiting-*` are this
 * screen's own tokens (`globals.css`), matching the mock's `--info`/`--warn`
 * tint-and-ink pairing hex for hex.
 *
 * `UNDER_REVIEW` isn't in the mock — it has no waiting-on-someone-else
 * meaning, so it keeps the product's own accent instead as an active state,
 * one of the three things that colour is for on this surface.
 */
type PillVariant = 'ready' | 'waiting' | 'active' | 'neutral';

const PILL_CLASS: Readonly<Record<PillVariant, string>> = {
  ready: 'bg-[var(--kyc-ready-tint)] text-[var(--kyc-ready-ink)]',
  waiting: 'bg-[var(--kyc-waiting-tint)] text-[var(--kyc-waiting-ink)]',
  active: 'bg-acc-wash text-acc-ink',
  neutral: 'border border-rule bg-sheet-2 text-ink-2',
};

function Pill({ variant, label }: { variant: PillVariant; label: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[7px] whitespace-nowrap rounded-full px-[11px] py-[4px] text-[13px] font-semibold',
        PILL_CLASS[variant],
      )}
    >
      <span className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * What each reviewable status means and what a reviewer does next.
 *
 * `INFO_REQUESTED` reads as "waiting" (amber), never as a caution against the
 * applicant — waiting on their own reply is a normal place for an
 * application to sit, the same reasoning `SlaCell` above states for the
 * breach colour, just carried by the mock's own amber pill rather than a
 * neutral one.
 */
const STATUS_META: Readonly<Record<string, { label: string; variant: PillVariant; note: string }>> =
  {
    KYC_SUBMITTED: { label: 'KYC submitted', variant: 'ready', note: 'Ready for review' },
    UNDER_REVIEW: { label: 'Under review', variant: 'active', note: 'Being reviewed' },
    INFO_REQUESTED: { label: 'Info requested', variant: 'waiting', note: 'Waiting on their reply' },
  };

function StatusCell({ item }: { item: ReviewQueueItem }): React.JSX.Element {
  const meta = STATUS_META[item.status];
  return (
    <div className="flex flex-col gap-1">
      <Pill
        variant={meta?.variant ?? 'neutral'}
        label={meta?.label ?? item.status.replace(/_/g, ' ')}
      />
      {meta ? <span className="text-label text-ink-3">{meta.note}</span> : null}
    </div>
  );
}

function ActionCell({ item }: { item: ReviewQueueItem }): React.JSX.Element {
  const navigate = useNavigate();
  const reviewable = item.status !== 'INFO_REQUESTED';
  return (
    <Button
      size="sm"
      variant={reviewable ? 'primary' : 'secondary'}
      onClick={() => navigate(`/kyc/${item.orgId}`)}
    >
      {reviewable ? 'Review KYC' : 'View'}
    </Button>
  );
}

/** The four cuts a reviewer actually takes, now two independent facets rather
 * than one single-select list — a reviewer can ask for "vendors, only
 * overdue" at once, which the mock's own two separate controls intend. */
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
  // hardcoded "48 for vendors, 24 for buyers" — that exact hardcoding is the
  // bug `ReviewQueueItem.slaHours`'s own doc comment already warns against.
  const vendorSla = all.find((i) => i.orgType === 'VENDOR' && i.slaHours !== null)?.slaHours;
  const buyerSla = all.find((i) => i.orgType === 'BUYER' && i.slaHours !== null)?.slaHours;
  const promiseHint =
    vendorSla !== undefined && buyerSla !== undefined
      ? `We promise ${vendorSla} h for vendors, ${buyerSla} h for buyers`
      : undefined;

  const columns: ReadonlyArray<Column<ReviewQueueItem>> = [
    { key: 'legalName', header: 'Business', cell: (item) => <BusinessCell item={item} /> },
    { key: 'status', header: 'Status', cell: (item) => <StatusCell item={item} /> },
    { key: 'submitted', header: 'Submitted', cell: (item) => <WaitingCell item={item} /> },
    {
      key: 'sla',
      header: 'Overdue by',
      cell: (item) => <SlaCell item={item} worstHours={worstHours} />,
    },
    { key: 'action', header: '', cell: (item) => <ActionCell item={item} /> },
  ];

  if (items && items.length === 0) {
    return (
      <div className="tg-stack">
        <PageHeader title="Review queue">
          Applications waiting on a decision, ordered by our own deadline.
        </PageHeader>
        <EmptyState
          title="Queue clear"
          body="Every submitted application has been decided. New ones appear here the moment a vendor or buyer submits, and the clock starts then."
        />
      </div>
    );
  }

  return (
    <div className="tg-stack">
      <PageHeader title="Review queue">
        {items ? (
          <>
            <span className="font-mono tnum text-ink">{all.length}</span> waiting, ordered by our
            own deadline — the ones we have already broken first.{' '}
            {breached > 0 ? (
              <>
                {/* Ours, in our own words. "Breaching applications" would read as a
                    fact about the applicants; they submitted and waited. */}
                We are past our own promise on{' '}
                <span className="font-mono tnum text-ink">{breached}</span> of them.
              </>
            ) : (
              'Every one of them is still inside the promise we made.'
            )}
          </>
        ) : (
          'Loading the applications waiting on a decision.'
        )}
      </PageHeader>

      {items ? (
        <KpiRow
          label="Review queue at a glance"
          items={[
            {
              key: 'waiting',
              label: 'Waiting for review',
              value: all.length,
              unit: 'businesses',
              hint: `${all.filter((i) => i.orgType === 'VENDOR').length} vendors · ${all.filter((i) => i.orgType === 'BUYER').length} buyers`,
            },
            {
              key: 'breached',
              label: 'Past our promise',
              value: breached,
              unit: `of ${all.length}`,
              hint: promiseHint,
            },
            {
              key: 'longest',
              label: 'Longest wait',
              value: longestWaitDays,
              unit: longestWaitDays !== null ? (longestWaitDays === 1 ? 'day' : 'days') : undefined,
              hint: oldest
                ? `${oldest.legalName}, since ${new Date(oldest.submittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
                : undefined,
            },
          ]}
        />
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Input
          className="min-w-[240px] flex-1"
          label="Search"
          type="search"
          placeholder="Business name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div
          className="inline-flex gap-0.5 rounded-lg bg-sheet-3 p-[3px]"
          role="group"
          aria-label="Business type"
        >
          {TYPES.map((t) => {
            const pressed = type === t.key;
            const count = all.filter((i) => matchesType(t.key, i)).length;
            return (
              <button
                key={t.key || 'all'}
                type="button"
                aria-pressed={pressed}
                onClick={() => setType(t.key)}
                className={cn(
                  'flex h-10 items-center gap-2 rounded px-3 text-body-sm font-semibold',
                  pressed ? 'bg-sheet text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
                )}
              >
                {t.label}
                <span className="font-mono text-label text-ink-3">{count}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-pressed={onlyOverdue === 'true'}
          onClick={() => setOnlyOverdue(onlyOverdue === 'true' ? '' : 'true')}
          className={cn(
            'flex h-10 items-center gap-2 rounded-lg border px-3 text-body-sm font-semibold',
            onlyOverdue === 'true'
              ? 'border-warn-line bg-warn-wash text-warn'
              : 'border-rule bg-sheet text-ink-2 hover:text-ink',
          )}
        >
          <span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" />
          Only overdue
          <span className="font-mono text-label">{breached}</span>
        </button>
      </div>

      <Board>
        <DataBoard
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
      </Board>
    </div>
  );
}
