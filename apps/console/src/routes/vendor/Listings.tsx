import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, EmptyState, GradeBadge, Input, Skeleton, StatusPill } from '@trugrade/ui';
import { GRADES, type Grade } from '@trugrade/contracts';
import { useResource } from '../../lib/useResource';
import {
  API,
  gradeLabel,
  onDate,
  postJson,
  rupees,
  type Page,
  type VendorListing,
} from './api';

/**
 * Listing management.
 *
 * The columns are the vendor's own facts: their declared grade, our corrected
 * grade where one exists, unit counts, their ask, the inspection clock. **There
 * is no retail-price column.** `03_UX_SPEC.md` §3B.2 describes one as
 * "read-only, informational", and PHASE_03 Task 3 and the phase exit criteria
 * both say the opposite and win — the API's `VendorListingView` does not carry
 * the field at all, so there is nothing to render even if somebody wanted to.
 *
 * Filters live in the URL, not in state, because every dashboard tile is a link
 * to a filtered board and a filter that cannot be linked to is a filter the
 * dashboard cannot use.
 */

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'pass' | 'warn' | 'fail' | 'processing'> = {
  DRAFT: 'neutral',
  AWAITING_QC: 'processing',
  QC_IN_PROGRESS: 'processing',
  PENDING_APPROVAL: 'info',
  ACTIVE: 'pass',
  PARTIALLY_ACTIVE: 'warn',
  PAUSED: 'neutral',
  OUT_OF_STOCK: 'neutral',
  REJECTED: 'fail',
  SUSPENDED: 'fail',
  EXPIRED: 'warn',
  DELISTED: 'neutral',
};

const STATUSES = Object.keys(STATUS_TONE);

/** Pause and resume are the only bulk actions: everything else needs a reason per listing. */
const PAUSABLE = new Set(['ACTIVE', 'PARTIALLY_ACTIVE']);

function RepriceRow({
  listing,
  onDone,
}: {
  listing: VendorListing;
  onDone: () => void;
}): React.JSX.Element {
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const valid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  return (
    <tr className="border-t border-rule-2 bg-sheet-2">
      <td colSpan={8} className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-52">
            <Input
              label="New net payout per machine"
              mono
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="w-72">
            <Input
              label="Why"
              hint="Goes on the price history, with your name."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            loading={busy}
            disabledReason={
              !valid
                ? 'Enter the amount you want to receive per machine.'
                : reason.trim().length < 3
                  ? 'Say why, in a few words at least — this goes on the record.'
                  : ''
            }
            onClick={() => {
              setBusy(true);
              setError(null);
              void postJson(API.reprice(listing.id), {
                vendorNetPayout: amount.trim(),
                reason: reason.trim(),
              })
                .then(onDone)
                .catch((e: Error) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Reprice
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
        {/* The one thing a vendor is always surprised by. Said before the click. */}
        <p className="mt-3 max-w-prose text-body-sm text-ink-2">
          Machines already reserved against an order keep the price they were reserved at. A price
          far below the trailing 30-day median is flagged for a look, not blocked.
        </p>
        {error && (
          <p className="mt-3 text-body-sm text-fail" role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

export function VendorListingsRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const grade = params.get('grade') ?? '';

  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [repricing, setRepricing] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const query = new URLSearchParams({ page: '1', pageSize: '50' });
  if (status) query.set('status', status);
  if (grade) query.set('grade', grade);
  // The key is in the URL so a successful mutation re-runs the GET. `useResource`
  // keys off the url string, which is exactly the cache invalidation needed here.
  query.set('_', String(reloadKey));

  const { data, error } = useResource<Page<VendorListing>>(
    `${API.listings}?${query.toString()}`,
    'Your listings are unavailable',
  );

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setSelected(new Set());
  }

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(action: 'PAUSE' | 'RESUME'): Promise<void> {
    setActionError(null);
    try {
      await postJson(API.bulkStatus, { listingIds: [...selected], action });
      setSelected(new Set());
      setReloadKey((k) => k + 1);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  if (error) {
    return (
      <EmptyState
        title="Your listings did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  const rows = data?.rows ?? [];
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const canPause = selectedRows.some((r) => PAUSABLE.has(r.status));
  const canResume = selectedRows.some((r) => r.status === 'PAUSED');

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-h1 text-ink">Your stock</h1>
        <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings/new">
          List stock
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-body-sm font-medium text-ink-2">Status</span>
          <select
            value={status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="h-11 rounded border border-rule bg-sheet px-4 text-body-sm text-ink"
          >
            <option value="">Every status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-body-sm font-medium text-ink-2">Grade</span>
          <select
            value={grade}
            onChange={(e) => setFilter('grade', e.target.value)}
            className="h-11 rounded border border-rule bg-sheet px-4 text-body-sm text-ink"
          >
            <option value="">Every grade</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {gradeLabel(g)}
              </option>
            ))}
          </select>
        </label>

        {selected.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-body-sm text-ink-2">{selected.size} selected</span>
            <Button
              size="sm"
              disabledReason={canPause ? '' : 'Nothing selected is live, so there is nothing to pause.'}
              onClick={() => void bulk('PAUSE')}
            >
              Pause
            </Button>
            <Button
              size="sm"
              disabledReason={canResume ? '' : 'Nothing selected is paused.'}
              onClick={() => void bulk('RESUME')}
            >
              Resume
            </Button>
          </div>
        )}
      </div>

      {actionError && (
        <p className="mt-4 text-body-sm text-fail" role="alert">
          {actionError}
        </p>
      )}

      {!data ? (
        <div className="mt-6">
          <Skeleton lines={8} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={status || grade ? 'Nothing matches this filter' : 'No stock listed yet'}
            body={
              status || grade
                ? 'Your stock is not empty — this filter is. Clear it to see everything.'
                : 'A listing starts with a machine from our catalog and ends with an inspection at your site. Fifty machines takes about ten minutes.'
            }
            action={
              status || grade ? (
                <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                  Clear the filter
                </Button>
              ) : (
                <Link
                  className="text-acc-ink underline underline-offset-4"
                  to="/vendor/listings/new"
                >
                  List your first stock
                </Link>
              )
            }
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-rule">
          <table className="w-full text-body-sm">
            <thead className="bg-sheet-2">
              <tr>
                {['', 'Grade', 'Units', 'Awaiting QC', 'Failed', 'Your ask', 'Inspection', ''].map(
                  (h, i) => (
                    <th
                      key={h || i}
                      className="p-3 text-left font-mono text-label uppercase tracking-[0.13em] text-ink-2"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <React.Fragment key={l.id}>
                  <tr className="border-t border-rule-2">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggle(l.id)}
                        aria-label={`Select listing ${l.id}`}
                      />
                    </td>
                    <td className="p-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <GradeBadge
                          grade={l.grade as Grade}
                          variant={l.gradeCorrectedFrom ? 'corrected' : 'verified'}
                          previousGrade={(l.gradeCorrectedFrom as Grade | null) ?? undefined}
                        />
                        <StatusPill
                          tone={STATUS_TONE[l.status] ?? 'neutral'}
                          label={l.status.replaceAll('_', ' ')}
                        />
                        {l.underPriceReview && <StatusPill tone="warn" label="Under review" />}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-data tnum text-ink">
                      {l.qtyAvailable}/{l.qtyTotal}
                    </td>
                    <td className="p-3 font-mono text-data tnum text-ink-2">{l.qtyAwaitingQc}</td>
                    <td className="p-3 font-mono text-data tnum text-ink-2">
                      {l.qtyQcFailed > 0 ? (
                        // Rule 1 of the whole model, said where a vendor will see
                        // it: a failed machine is absent from the storefront, not
                        // dimmed and not out of stock. It is theirs again.
                        <span title="Never listed. These machines stay yours.">
                          {l.qtyQcFailed}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-3 font-mono text-data tnum text-ink">
                      {rupees(l.vendorAskPrice)}
                    </td>
                    <td className="p-3 text-ink-2">
                      {l.expiresAt ? `Valid to ${onDate(l.expiresAt)}` : '—'}
                    </td>
                    <td className="p-3">
                      <span className="flex justify-end gap-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRepricing(repricing === l.id ? null : l.id)}
                        >
                          Reprice
                        </Button>
                        <Link
                          className="text-acc-ink underline underline-offset-4"
                          to={`/vendor/listings/${l.id}`}
                        >
                          Units
                        </Link>
                      </span>
                    </td>
                  </tr>
                  {repricing === l.id && (
                    <RepriceRow
                      listing={l}
                      onDone={() => {
                        setRepricing(null);
                        setReloadKey((k) => k + 1);
                      }}
                    />
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
