import * as React from 'react';
import { Link } from 'react-router';
import { Chip, DataBoard, EmptyState, StatusPill, type Column } from '@trugrade/ui';
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

/**
 * Hours, in the product's own mono type, rounded the way a person says them.
 *
 * The API sends one decimal place because it sorts on the value; a reviewer
 * reads "6 h", not "6.0 h", and a column of them has to line up.
 */
function Hours({ value, tone }: { value: number; tone: 'ink' | 'warn' }): React.JSX.Element {
  return (
    <span className={tone === 'warn' ? 'font-mono tnum text-warn' : 'font-mono tnum text-ink'}>
      {Math.round(Math.abs(value))} h
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
 */
function SlaCell({ item }: { item: ReviewQueueItem }): React.JSX.Element {
  if (item.hoursRemaining === null) {
    // Not a dash, and not a tick. "No clock on this application" and "no time
    // left" must never look alike.
    return <span className="text-body-sm text-ink-4">No promise recorded</span>;
  }

  const promise =
    item.slaHours === null ? null : (
      <span className="text-ink-4">
        {' '}
        of <span className="font-mono tnum">{item.slaHours}</span>
      </span>
    );

  if (item.slaBreached) {
    return (
      <span className="text-body-sm text-ink-2">
        <Hours value={item.hoursRemaining} tone="warn" /> past{promise}
      </span>
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
function WaitingCell({ item }: { item: ReviewQueueItem }): React.JSX.Element {
  if (item.submittedAt === null) {
    return <span className="text-body-sm text-ink-4">Not submitted</span>;
  }
  return (
    <span className="font-mono tnum text-body-sm text-ink-2">
      {new Date(item.submittedAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })}
    </span>
  );
}

const COLUMNS: ReadonlyArray<Column<ReviewQueueItem>> = [
  {
    key: 'legalName',
    header: 'Business',
    cell: (item) => (
      <Link
        to={`/kyc/${item.orgId}`}
        className="text-ink underline decoration-rule underline-offset-4 hover:decoration-acc"
      >
        {item.legalName}
      </Link>
    ),
  },
  {
    key: 'orgType',
    header: 'Type',
    cell: (item) => <span className="text-ink-2">{item.orgType}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    // Amber is a primary action, a measured value or an ACTIVE state — and
    // only "under review" is one. Painting every workflow status amber is how
    // the accent stops meaning anything. **INFO_REQUESTED is neutral, not
    // warn**: waiting on the applicant is a normal place for an application to
    // be, and colouring it would put a caution against a business that has done
    // nothing wrong.
    cell: (item) => (
      <StatusPill
        tone={item.status === 'UNDER_REVIEW' ? 'info' : 'neutral'}
        label={item.status.replace(/_/g, ' ')}
      />
    ),
  },
  { key: 'submitted', header: 'Submitted', cell: (item) => <WaitingCell item={item} /> },
  { key: 'sla', header: 'Our promise', cell: (item) => <SlaCell item={item} /> },
];

/** The four cuts a reviewer actually takes. Anything finer is the board itself. */
const VIEWS = [
  { key: '', label: 'Everything' },
  { key: 'breached', label: 'Past our promise' },
  { key: 'vendor', label: 'Vendors' },
  { key: 'buyer', label: 'Buyers' },
] as const;

const matches = (view: string, i: ReviewQueueItem): boolean =>
  view === 'breached'
    ? i.slaBreached
    : view === 'vendor'
      ? i.orgType === 'VENDOR'
      : view === 'buyer'
        ? i.orgType === 'BUYER'
        : true;

export function ReviewQueueRoute(): React.JSX.Element {
  const { data: items, error } = useResource<ReviewQueueItem[]>(
    '/api/kyc/review-queue',
    'The review queue is unavailable',
  );
  // In the URL, not in state: a reviewer pastes "the breached ones" into chat.
  const [view, setView] = useUrlState('view');

  if (error) {
    return (
      <EmptyState
        title="The review queue did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  const all = items ?? [];
  const rows = all.filter((i) => matches(view, i));
  const breached = all.filter((i) => i.slaBreached).length;

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

      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Chip
            key={v.key || 'all'}
            label={v.label}
            count={items ? all.filter((i) => matches(v.key, i)).length : undefined}
            selected={view === v.key}
            onToggle={() => setView(v.key)}
          />
        ))}
      </div>

      <Board>
        <DataBoard
          caption={
            items
              ? `${rows.length} applications waiting for review, ordered by our own deadline, the ones we have already broken first.`
              : 'Loading the review queue.'
          }
          columns={COLUMNS}
          rows={rows}
          rowKey={(item) => item.orgId}
          loading={!items}
          skeletonRows={6}
          empty={
            <EmptyState
              title="Nothing matches this view"
              body="The queue is not empty — this filter is. Choose “Everything” to see all of it."
            />
          }
        />
      </Board>
    </div>
  );
}
