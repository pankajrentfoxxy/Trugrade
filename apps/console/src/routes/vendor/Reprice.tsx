import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Breadcrumb,
  Button,
  EmptyState,
  GradeBadge,
  Input,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
  TickRule,
} from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { NotMeasured } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import {
  API,
  postJson,
  rupees,
  type PayoutPreview,
  type VendorListing,
  type VendorUnit,
} from './api';

/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * Change what a listing pays the vendor.
 *
 * **This screen shows no retail price and must never grow one.** The vendor sets
 * what they receive; what we sell it for is not on their side of the
 * conversation (PHASE_03 Task 3 step 4, and a phase exit criterion). The live
 * figure here is the same `payout-preview` the wizard's step 4 calls, so the
 * number quoted before a reprice and the number quoted before a listing are the
 * same server computation and cannot drift apart.
 *
 * ## Why the locked machines are on screen before the button
 *
 * `unit.purchase_price` is immutable once set — `trg_lock_purchase_price`
 * enforces it at the database, because that column is what a purchase order
 * agreed to pay for a specific serial and a marketplace that can retrospectively
 * change what it owes is not one anybody sells through twice. The reprice
 * handler therefore updates `WHERE purchase_price IS NULL` and quietly leaves
 * the rest.
 *
 * "Quietly" is the problem this screen exists to fix. A vendor who reprices
 * forty machines and finds nine of them still on the old payout, with nothing
 * having said so, concludes the reprice half-failed. So the serials that will
 * not move are named here, by serial, before the click — and if none of them
 * can move the form is refused with the reason rather than posting a request the
 * API will correctly reject.
 */

/** Only these two are worth a preview; the rest have no repriceable units. */
function repriceable(units: readonly VendorUnit[]): readonly VendorUnit[] {
  return units.filter((u) => !u.payoutLocked);
}

function LockedMachines({ locked }: { locked: readonly VendorUnit[] }): React.JSX.Element {
  if (locked.length === 0) {
    return (
      <p className="text-body-sm text-ink-2">
        Nothing on this listing is committed to an order yet, so the new amount applies to every
        machine on it.
      </p>
    );
  }
  return (
    <div>
      <p className="text-body-sm text-ink-2">
        <span className="font-mono tnum text-ink">{locked.length}</span> of these machines keep the
        payout they were bought at. A purchase order has already named the serial and what we owe
        for it is settled — that is true whichever way the new amount moves.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {locked.map((u) => (
          <li key={u.id} className="flex flex-wrap items-baseline justify-between gap-3">
            <code className="font-mono text-data tnum text-ink-2">{u.serialNumber}</code>
            <span className="font-mono text-label uppercase tracking-[0.13em] tnum text-ink-3">
              {u.vendorAskPrice === null ? (
                <NotMeasured why="No payout was recorded against this machine" label="No payout" />
              ) : (
                rupees(u.vendorAskPrice)
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RepriceRoute(): React.JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const listing = useResource<VendorListing>(
    id ? API.listing(id) : '',
    'This listing did not load',
  );
  const units = useResource<VendorUnit[]>(
    id ? API.listingUnits(id) : '',
    'The machines on this listing did not load',
  );

  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PayoutPreview | null>(null);

  const rows = units.data ?? [];
  const movable = repriceable(rows);
  const locked = rows.filter((u) => u.payoutLocked);
  const clean = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  /**
   * The live preview, debounced, and deliberately a server call.
   *
   * The deductions depend on the vendor's cumulative purchases this financial
   * year, their PAN state and any standing penalties — none of which a browser
   * can know. A client that guessed at them would promise a number we then did
   * not pay, which is the whole failure this screen is trying to prevent.
   */
  React.useEffect(() => {
    const value = amount.trim();
    if (!clean || !listing.data || movable.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const p = await postJson<PayoutPreview>(API.payoutPreview, {
            skuId: listing.data?.skuId,
            grade: listing.data?.grade,
            vendorWarrantyMonths: listing.data?.vendorWarrantyMonths,
            units: movable.length,
            ask: { mode: 'NET_PAYOUT', vendorNetPayout: value },
          });
          if (!cancelled) {
            setPreview(p);
            setError(null);
          }
        } catch (e) {
          if (!cancelled) {
            setPreview(null);
            setError((e as Error).message);
          }
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `movable.length` rather than the array: a re-fetch that returns the same
    // machines must not refire the preview.
  }, [amount, clean, listing.data, movable.length]);

  if (listing.error || units.error) {
    return (
      <EmptyState
        title="This listing did not load"
        body={`${listing.error ?? units.error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!listing.data || !units.data) return <Skeleton lines={10} />;

  const l = listing.data;

  async function submit(): Promise<void> {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(API.reprice(id), {
        vendorNetPayout: amount.trim(),
        reason: reason.trim(),
      });
      navigate('/vendor/listings');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** What stops the button, said as the thing to do rather than the rule broken. */
  const blocker =
    movable.length === 0
      ? 'Every machine on this listing is committed to an order and keeps the payout it was bought at. There is nothing here to reprice.'
      : !clean
        ? 'Enter the amount you want to receive per machine.'
        : reason.trim().length < 3
          ? 'Say why, in a few words at least — this goes on the record with your name.'
          : '';

  return (
    <div className="tg-stack">
      <Breadcrumb
        items={[
          { label: 'Your stock', href: '/vendor/listings' },
          { label: 'Units', href: `/vendor/listings/${l.id}` },
          { label: 'Reprice' },
        ]}
      />

      <RecordHeader
        title="Change what you receive"
        // Both halves counted off the SAME list. `listing.qty_total` is a
        // trigger-maintained counter and `rows` is the machines themselves; they
        // should agree, and reading one number from each source is precisely how
        // a screen ends up quoting two totals for one listing.
        subtitle={`${rows.length} ${rows.length === 1 ? 'machine' : 'machines'} on this listing, ${movable.length} of them repriceable.`}
        status={
          <StatusPill
            tone={l.underPriceReview ? 'warn' : 'neutral'}
            label={l.underPriceReview ? 'Under review' : l.status.replaceAll('_', ' ')}
          />
        }
        secondaryActions={<GradeBadge grade={l.grade as Grade} />}
        identifiers={[
          {
            label: 'Payout now',
            value: l.vendorAskPrice === null ? 'Not set' : rupees(l.vendorAskPrice),
          },
          { label: 'Committed', value: String(locked.length) },
        ]}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <h2 className="text-h3 text-ink">The new amount</h2>
          <TickRule />
          <p className="mt-2 max-w-prose text-body-sm text-ink-2">
            What you want in your account per machine, after everything. It replaces the current
            amount on every machine that is not already committed to an order.
          </p>

          <div className="mt-5 flex max-w-xl flex-col gap-5">
            <Input
              label="New net payout per machine"
              mono
              inputMode="decimal"
              placeholder="42000"
              hint={
                l.vendorAskPrice === null
                  ? 'No amount is set on this listing yet.'
                  : `Currently ${rupees(l.vendorAskPrice)}.`
              }
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              label="Why"
              hint="Goes on the price history, with your name and the time."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div
            className="tg-card mt-6 max-w-xl rounded-lg border border-rule bg-sheet"
            data-testid="reprice-preview"
          >
            {!preview && movable.length === 0 && (
              <p className="text-body-sm text-ink-2">
                There is nothing to preview: every machine here keeps the payout it was bought at.
              </p>
            )}
            {!preview && movable.length > 0 && amount.trim() === '' && (
              <p className="text-body-sm text-ink-2">
                Enter an amount and we will show what the {movable.length}{' '}
                {movable.length === 1 ? 'machine' : 'machines'} would pay you after deductions.
              </p>
            )}
            {!preview && movable.length > 0 && amount.trim() !== '' && !error && (
              <Skeleton lines={4} />
            )}

            {preview && (
              <dl className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-body-sm text-ink-2">Per machine</dt>
                  <dd className="whitespace-nowrap font-mono text-data tnum text-ink">
                    {rupees(preview.perUnitPayout)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-rule-2 pt-3">
                  <dt className="text-body-sm text-ink-2">
                    <span className="font-mono tnum">{preview.units}</span> repriceable{' '}
                    {preview.units === 1 ? 'machine' : 'machines'}
                  </dt>
                  <dd className="whitespace-nowrap font-mono text-data tnum text-ink">
                    {rupees(preview.grossPayout)}
                  </dd>
                </div>

                {/* Itemised, always, including a zero. A charge revealed one
                    click in is drip pricing, which the CCPA Dark Patterns
                    Guidelines 2023 name by that word. */}
                {preview.deductions.map((d) => (
                  <div key={d.code} className="flex items-baseline justify-between gap-4">
                    <dt className="max-w-prose text-body-sm text-ink-2">{d.label}</dt>
                    <dd className="whitespace-nowrap font-mono text-data tnum text-ink-2">
                      −{rupees(d.amount)}
                    </dd>
                  </div>
                ))}
                {preview.deductions.length === 0 ? (
                  <p className="text-body-sm text-ink-2">Nothing is deducted from this batch.</p>
                ) : (
                  <div className="flex items-baseline justify-between gap-4 border-t border-rule-2 pt-3">
                    <dt className="text-body-sm text-ink-2">
                      Deducted in total
                      <span className="block text-label text-ink-4">
                        <span className="font-mono tnum">{preview.deductions.length}</span>{' '}
                        {preview.deductions.length === 1 ? 'charge' : 'charges'}, from{' '}
                        <span className="font-mono tnum">{rupees(preview.grossPayout)}</span>
                      </span>
                    </dt>
                    <dd className="whitespace-nowrap font-mono text-data tnum text-ink-2">
                      −{rupees(preview.totalDeductions)}
                    </dd>
                  </div>
                )}

                <div className="flex items-baseline justify-between gap-4 border-t border-rule pt-3">
                  <dt className="text-body text-ink">You would receive</dt>
                  <dd
                    className="whitespace-nowrap font-mono text-h3 tnum text-ink"
                    data-testid="reprice-net"
                  >
                    {rupees(preview.netPayout)}
                  </dd>
                </div>

                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-body-sm text-ink-2">
                    Our commission
                    {/* The denominator, in words. It cannot be a rupee figure:
                        the rupee denominator IS the selling price, and that is
                        the one number this screen may not show. */}
                    <span className="block text-label text-ink-4">
                      of the selling price, not of your{' '}
                      <span className="font-mono tnum">{rupees(preview.perUnitPayout)}</span>
                    </span>
                  </dt>
                  {/* Amber: a measured value, rule 1's second meaning. */}
                  <dd
                    className="font-mono text-data tnum text-acc-ink"
                    data-testid="reprice-commission"
                  >
                    {preview.commissionPct}%
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {error && (
            <p className="mt-5 max-w-xl text-body-sm text-fail" role="alert">
              {error}
            </p>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
            <Button
              variant="primary"
              loading={busy}
              disabledReason={blocker}
              onClick={() => void submit()}
            >
              {/* Not "Reprice 0 machines". A button that names the number it
                  would change should not offer to change none of them. */}
              {movable.length === 0
                ? 'Nothing to reprice'
                : `Reprice ${movable.length} ${movable.length === 1 ? 'machine' : 'machines'}`}
            </Button>
            <Link
              className="text-body-sm text-ink-2 underline underline-offset-4"
              to="/vendor/listings"
            >
              Cancel
            </Link>
          </div>
        </div>

        <SidePanel
          title="What will not change"
          description="Said before the button, not discovered afterwards."
          footnote={
            <>
              A price far below the trailing 30-day median for this model is flagged for someone to
              look at. It is <strong>not blocked</strong> and nothing comes off sale — the listing
              carries an &ldquo;under review&rdquo; chip until it has been seen.
            </>
          }
        >
          <LockedMachines locked={locked} />
        </SidePanel>
      </div>
    </div>
  );
}
