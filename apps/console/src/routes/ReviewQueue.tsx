import * as React from 'react';
import { Link } from 'react-router';
import { EmptyState, Skeleton, StatusPill } from '@trugrade/ui';

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
    return <span className="text-body-sm text-ink-3">Not submitted</span>;
  }
  if (item.slaBreached) {
    return <StatusPill tone="fail" label={`${Math.abs(item.hoursRemaining)}h overdue`} />;
  }
  const tone = item.hoursRemaining <= 8 ? 'warn' : 'neutral';
  return <StatusPill tone={tone} label={`${item.hoursRemaining}h left`} />;
}

export function ReviewQueueRoute(): React.JSX.Element {
  const [items, setItems] = React.useState<ReviewQueueItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
  if (!items) return <Skeleton lines={6} />;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting for review"
        body="Every submitted application has been decided. New ones appear here the moment a vendor or buyer submits."
      />
    );
  }

  return (
    <div>
      <h1 className="text-h1 text-ink">Review queue</h1>
      <p className="mt-2 text-body-sm text-ink-2">{items.length} waiting, oldest promise first.</p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-rule text-left">
              {['Business', 'Type', 'Status', 'SLA'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2 font-mono text-label uppercase tracking-[0.13em] text-ink-2"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.orgId} className="border-b border-rule-2 hover:bg-sheet-2">
                <td className="px-3 py-3">
                  <Link
                    to={`/kyc/${item.orgId}`}
                    className="text-ink underline decoration-rule underline-offset-4 hover:decoration-acc"
                  >
                    {item.legalName}
                  </Link>
                </td>
                <td className="px-3 py-3 text-ink-2">{item.orgType}</td>
                <td className="px-3 py-3">
                  <StatusPill tone="info" label={item.status.replace(/_/g, ' ')} />
                </td>
                <td className="px-3 py-3">
                  <SlaCell item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
