import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  Checkbox,
  DataBoard,
  EmptyState,
  GradeBadge,
  Input,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import { GRADES, type Grade } from '@trugrade/contracts';
import { Board, NotMeasured, PageHeader, Section, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, gradeLabel, onDate, postJson, rupees, type Page, type VendorListing } from './api';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
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

/**
 * The reprice form, below the board rather than as a `<tr colSpan={8}>`.
 *
 * `DataBoard` is the one table component and deliberately has no expansion slot:
 * a row that opens a two-field form spanning every column is a table pretending
 * to be a page. Nothing about what it posts, or when, has changed.
 */
function RepricePanel({
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
    <Section title="Reprice" subtitle="What you receive per machine, and why it is changing.">
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
        Machines already reserved against an order keep the price they were reserved at. A price far
        below the trailing 30-day median is flagged for a look, not blocked.
      </p>
      {error && (
        <p className="mt-3 text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}
    </Section>
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

  const toggle = React.useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  const columns = React.useMemo<ReadonlyArray<Column<VendorListing>>>(
    () => [
      {
        key: 'select',
        header: 'Select',
        headerHidden: true,
        cell: (l) => (
          <Checkbox
            label={<span className="sr-only">Select listing {l.id}</span>}
            checked={selected.has(l.id)}
            onChange={() => toggle(l.id)}
          />
        ),
      },
      {
        key: 'grade',
        header: 'Grade',
        cell: (l) => (
          <span className="flex flex-wrap items-center gap-2">
            <GradeBadge
              grade={l.grade as Grade}
              variant={l.gradeCorrectedFrom ? 'corrected' : 'verified'}
              previousGrade={(l.gradeCorrectedFrom as Grade | null) ?? undefined}
            />
            <StatusPill
              tone={STATUS_TONE[l.status] ?? 'neutral'}
              label={l.status.replaceAll('_', ' ')}
              className="whitespace-nowrap"
            />
            {l.underPriceReview && <StatusPill tone="warn" label="Under review" />}
          </span>
        ),
      },
      {
        key: 'units',
        header: 'Units',
        numeric: true,
        cell: (l) => `${l.qtyAvailable}/${l.qtyTotal}`,
      },
      {
        key: 'awaitingQc',
        header: 'Awaiting QC',
        numeric: true,
        cell: (l) => <span className="text-ink-2">{l.qtyAwaitingQc}</span>,
      },
      {
        key: 'failed',
        header: 'Failed',
        numeric: true,
        cell: (l) =>
          l.qtyQcFailed > 0 ? (
            // Rule 1 of the whole model, said where a vendor will see it: a
            // failed machine is absent from the storefront, not dimmed and not
            // out of stock. It is theirs again.
            <span className="text-ink-2" title="Never listed. These machines stay yours.">
              {l.qtyQcFailed}
            </span>
          ) : (
            <span className="font-sans text-body-sm text-ink-4">None</span>
          ),
      },
      {
        key: 'ask',
        header: 'Your ask',
        numeric: true,
        cell: (l) =>
          l.vendorAskPrice === null ? (
            <NotMeasured why="No price has been set on this listing" label="No price set" />
          ) : (
            rupees(l.vendorAskPrice)
          ),
      },
      {
        key: 'inspection',
        header: 'Inspection',
        cell: (l) =>
          l.expiresAt ? (
            <span className="text-ink-2">
              Valid to <span className="font-mono tnum">{onDate(l.expiresAt)}</span>
            </span>
          ) : (
            <NotMeasured why="This listing has not been inspected yet" label="Not inspected" />
          ),
      },
      {
        key: 'actions',
        header: 'Actions',
        headerHidden: true,
        cell: (l) => (
          <span className="flex justify-end gap-3">
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={repricing === l.id}
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
        ),
      },
    ],
    [selected, toggle, repricing],
  );

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
  const open = rows.find((r) => r.id === repricing);

  return (
    <div className="tg-stack">
      <PageHeader
        title="Your stock"
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings/new">
            List stock
          </Link>
        }
      >
        Your declared grade, our corrected grade where one exists, and the inspection clock.
      </PageHeader>

      <div className="flex flex-wrap items-end gap-4">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={[
            { value: '', label: 'Every status' },
            ...STATUSES.map((st) => ({ value: st, label: st.replaceAll('_', ' ').toLowerCase() })),
          ]}
        />
        <Select
          label="Grade"
          value={grade}
          onChange={(e) => setFilter('grade', e.target.value)}
          options={[
            { value: '', label: 'Every grade' },
            ...GRADES.map((g) => ({ value: g, label: gradeLabel(g) })),
          ]}
        />

        {selected.size > 0 && (
          <div className="flex items-center gap-3 pb-2">
            <span className="text-body-sm text-ink-2">{selected.size} selected</span>
            <Button
              size="sm"
              disabledReason={
                canPause ? '' : 'Nothing selected is live, so there is nothing to pause.'
              }
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
        <p className="text-body-sm text-fail" role="alert">
          {actionError}
        </p>
      )}

      <Board>
        <DataBoard
        caption={data ? `${rows.length} listings.` : 'Loading your listings.'}
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        loading={!data}
        skeletonRows={8}
        empty={
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
        }
        />
      </Board>

      {open && (
        <RepricePanel
          listing={open}
          onDone={() => {
            setRepricing(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
