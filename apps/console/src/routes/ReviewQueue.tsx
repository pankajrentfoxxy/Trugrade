import * as React from 'react';
import { Link } from 'react-router';
import { Chip, DataBoard, EmptyState, StatusPill, type Column } from '@trugrade/ui';
import { Board, PageHeader } from '../lib/controls';
import { useUrlState } from '../lib/urlState';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
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
}

/**
 * The SLA column, which is the only reason this screen is ordered the way it is.
 *
 * A breach is FAIL, not WARN: WARN renders outlined and reads as "keep an eye on
 * it", which is exactly the wrong signal for a promise already broken.
 */
function SlaCell({ item }: { item: ReviewQueueItem }): React.JSX.Element {
  if (item.hoursRemaining === null) {
    // Not a dash. "No clock yet" and "no time left" must never look alike.
    return <span className="text-body-sm text-ink-4">Not submitted</span>;
  }
  if (item.slaBreached) {
    // A breached SLA is ours, not a verdict on the applicant. `warn` is outlined
    // and already the tone this cell uses at 8 hours left; red made an overdue
    // review look like a rejection.
    return <StatusPill tone="warn" label={`${Math.abs(item.hoursRemaining)}h overdue`} />;
  }
  const tone = item.hoursRemaining <= 8 ? 'warn' : 'neutral';
  return <StatusPill tone={tone} label={`${item.hoursRemaining}h left`} />;
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
  { key: 'orgType', header: 'Type', cell: (item) => <span className="text-ink-2">{item.orgType}</span> },
  {
    key: 'status',
    header: 'Status',
    // Amber is a primary action, a measured value or an ACTIVE state — and
    // only "under review" is one. Painting every workflow status amber is how
    // the accent stops meaning anything.
    cell: (item) => (
      <StatusPill
        tone={item.status === 'UNDER_REVIEW' ? 'info' : 'neutral'}
        label={item.status.replace(/_/g, ' ')}
      />
    ),
  },
  { key: 'sla', header: 'SLA', cell: (item) => <SlaCell item={item} /> },
];

/** The three cuts a reviewer actually takes. Anything finer is the board itself. */
const VIEWS = [
  { key: '', label: 'Everything' },
  { key: 'breached', label: 'Past the promise' },
  { key: 'vendor', label: 'Vendors' },
] as const;

export function ReviewQueueRoute(): React.JSX.Element {
  const [items, setItems] = React.useState<ReviewQueueItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // In the URL, not in state: a reviewer pastes "the breached ones" into chat.
  const [view, setView] = useUrlState('view');

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/kyc/review-queue', { credentials: 'include' });
        if (!res.ok) throw new Error(`Queue unavailable (${res.status})`);
        const data = (await res.json()) as ReviewQueueItem[];
        if (!cancelled) setItems(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <EmptyState
        title="The review queue did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  const all = items ?? [];
  const rows = all.filter((i) =>
    view === 'breached' ? i.slaBreached : view === 'vendor' ? i.orgType === 'VENDOR' : true,
  );

  if (items && items.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting for review"
        body="Every submitted application has been decided. New ones appear here the moment a vendor or buyer submits."
      />
    );
  }

  const breached = all.filter((i) => i.slaBreached).length;

  return (
    <div className="tg-stack">
      <PageHeader title="Review queue">
        {items
          ? `${all.length} waiting, oldest promise first${breached > 0 ? ` · ${breached} past the 48-hour promise` : ''}.`
          : 'Loading the applications waiting on a decision.'}
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Chip
            key={v.key || 'all'}
            label={v.label}
            count={
              items
                ? v.key === 'breached'
                  ? breached
                  : v.key === 'vendor'
                    ? all.filter((i) => i.orgType === 'VENDOR').length
                    : all.length
                : undefined
            }
            selected={view === v.key}
            onToggle={() => setView(v.key)}
          />
        ))}
      </div>

      <Board>
        <DataBoard
          caption={
            items
              ? `${rows.length} applications waiting for review, oldest promise first.`
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
