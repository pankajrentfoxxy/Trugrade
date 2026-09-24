import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Breadcrumb,
  Button,
  EmptyState,
  GradeBadge,
  HubKpiRow,
  HubPageHeader,
  Input,
  LedgerRow,
  Panel,
  Skeleton,
  StatusPill,
} from '@trugrade/ui';
import { VENDOR_NET_PAYOUT, type Grade } from '@trugrade/contracts';
import { NotMeasured } from '../../lib/controls';
import { ListingMachineCard, machineTitle } from './ListingMachine';
import { payoutBlocker } from './wizard/draft';
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

const machines = (n: number): string => `${n} ${n === 1 ? 'machine' : 'machines'}`;

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
      <ul className="mt-3 flex flex-col divide-y divide-rule-2 rounded border border-rule-2">
        {locked.map((u) => (
          <li key={u.id} className="flex flex-wrap items-baseline justify-between gap-3 px-3 py-2">
            <code className="font-mono text-data tnum text-ink">{u.serialNumber}</code>
            <span className="font-mono text-body-sm tnum text-ink-2">
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

/**
 * The things a supplier should know before typing a number, in the mockup's
 * amber "Needs your attention" block. Rendered only when there is something to
 * say — an empty attention box teaches people to stop reading it.
 */
function Attention({
  listing,
  locked,
  total,
}: {
  listing: VendorListing;
  locked: number;
  total: number;
}): React.JSX.Element | null {
  const items: React.ReactNode[] = [];
  if (listing.vendorAskPrice === null) {
    items.push(
      <>
        <strong className="font-semibold text-ink">No payout is set on this listing.</strong> Buyers
        cannot order it until you set one below.
      </>,
    );
  }
  if (listing.underPriceReview) {
    items.push(
      <>
        <strong className="font-semibold text-ink">This listing is under price review.</strong>{' '}
        Nothing is off sale — the chip clears once someone has looked at it.
      </>,
    );
  }
  if (locked > 0) {
    items.push(
      <>
        <strong className="font-semibold text-ink">
          <span className="font-mono tnum">{locked}</span> of{' '}
          <span className="font-mono tnum">{total}</span> machines are committed to an order
        </strong>{' '}
        and keep the payout they were bought at. They are named by serial on the right.
      </>,
    );
  }
  if (items.length === 0) return null;
  return (
    <section
      className="hub-panel border-warn-line"
      aria-label="Needs your attention"
      data-testid="reprice-attention"
    >
      <div className="flex items-center gap-2 bg-warn-wash px-5 py-3 text-body-sm font-semibold text-warn">
        <span className="hub-sev hub-sev--warn !mr-0" aria-hidden="true" />
        Needs your attention
      </div>
      <ul className="divide-y divide-rule-2">
        {items.map((item, i) => (
          <li key={i} className="px-5 py-3 text-body-sm text-ink-2">
            {item}
          </li>
        ))}
      </ul>
    </section>
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
  const payoutIssue = payoutBlocker(amount);
  const inBand = payoutIssue === '';

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
    if (payoutIssue || !listing.data || movable.length === 0) {
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
  }, [amount, payoutIssue, listing.data, movable.length]);

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
    rows.length === 0
      ? 'There are no machines on this listing yet, so there is nothing to reprice. Add units to it first.'
      : movable.length === 0
      ? 'Every machine on this listing is committed to an order and keeps the payout it was bought at. There is nothing here to reprice.'
      : payoutIssue
        ? payoutIssue
        : reason.trim().length < 3
          ? 'Say why, in a few words at least — this goes on the record with your name.'
          : '';

  const typing = movable.length > 0 && amount.trim() !== '';

  return (
    <div className="hub-page">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Listings', href: '/vendor/listings' },
          { label: machineTitle(l), href: `/vendor/listings/${l.id}` },
          { label: 'Reprice' },
        ]}
      />

      <HubPageHeader
        title={`Reprice · ${machineTitle(l)}`}
        // Both halves counted off the SAME list. `listing.qty_total` is a
        // trigger-maintained counter and `rows` is the machines themselves; they
        // should agree, and reading one number from each source is precisely how
        // a screen ends up quoting two totals for one listing.
        subtitle={
          <>
            <span className="font-mono tnum">#{l.id.slice(0, 8)}</span>
            {l.sku ? (
              <>
                {' · '}
                <span className="font-mono tnum">{l.sku.skuCode}</span>
              </>
            ) : null}
            {' · '}
            Change what you receive · {machines(rows.length)} on this listing, {movable.length} of
            them repriceable.
          </>
        }
        actions={
          <>
            <GradeBadge grade={l.grade as Grade} />
            <StatusPill
              tone={l.underPriceReview ? 'warn' : 'neutral'}
              label={l.underPriceReview ? 'Under review' : l.status.replaceAll('_', ' ')}
            />
          </>
        }
      />

      <HubKpiRow
        cells={[
          {
            label: 'Payout now',
            value: l.vendorAskPrice === null ? null : rupees(l.vendorAskPrice),
            sub: 'per machine, what you receive',
          },
          {
            // Headed with its denominator: the percentage is a share of the
            // vendor's own ask, and the rupee figure is the API's sum over
            // `qty_total` — so that count is named, not "per machine".
            label: 'Commission',
            value:
              l.commissionPct != null && l.commissionAmount
                ? `${l.commissionPct}% · ${rupees(l.commissionAmount)}`
                : null,
            sub: `of your ask, across ${machines(l.qtyTotal)}`,
          },
          {
            label: 'Repriceable',
            value: String(movable.length),
            sub: `of ${machines(rows.length)} on this listing`,
          },
          {
            label: 'Committed',
            value: String(locked.length),
            sub: 'keep the payout they were bought at',
          },
        ]}
      />

      <Attention listing={l} locked={locked.length} total={rows.length} />

      <div className="hub-split">
        <div className="hub-split__main">
          <ListingMachineCard listing={l} />

          <Panel title="The new amount" className="mt-6">
            <div className="flex flex-col gap-5 px-5 py-5">
              <p className="max-w-prose text-body-sm text-ink-2">
                What you want in your account per machine, after everything. It replaces the
                current amount on every machine that is not already committed to an order.
              </p>
              <div className="grid gap-5 md:grid-cols-2">
                <Input
                  label="New net payout per machine"
                  mono
                  type="number"
                  min={VENDOR_NET_PAYOUT.min}
                  max={VENDOR_NET_PAYOUT.max}
                  step={0.01}
                  placeholder="42000"
                  hint={
                    l.vendorAskPrice === null
                      ? 'No amount is set on this listing yet.'
                      : `Currently ${rupees(l.vendorAskPrice)}.`
                  }
                  error={amount.trim() === '' ? undefined : payoutIssue || undefined}
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
            </div>
          </Panel>

          <div data-testid="reprice-preview">
            <Panel
              title="What you would receive"
              count={movable.length > 0 ? machines(movable.length) : undefined}
            >
              {!preview && rows.length === 0 && (
                <p className="px-5 py-4 text-body-sm text-ink-2">
                  There is nothing to preview: this listing has no machines on it yet.
                </p>
              )}
              {!preview && rows.length > 0 && movable.length === 0 && (
                <p className="px-5 py-4 text-body-sm text-ink-2">
                  There is nothing to preview: every machine here keeps the payout it was bought
                  at.
                </p>
              )}
              {!preview && movable.length > 0 && amount.trim() === '' && (
                <p className="px-5 py-4 text-body-sm text-ink-2">
                  Enter an amount and we will show what the {machines(movable.length)} would pay
                  you after deductions.
                </p>
              )}
              {!preview && typing && !inBand && (
                <p className="px-5 py-4 text-body-sm text-ink-2">
                  The preview needs an amount in range. {payoutIssue}
                </p>
              )}
              {!preview && typing && inBand && !error && (
                <div className="px-5 py-4">
                  <Skeleton lines={4} />
                </div>
              )}

              {preview && (
                <div className="hub-money !max-w-none">
                  <LedgerRow label="Per machine" value={rupees(preview.perUnitPayout)} />
                  <LedgerRow
                    label={
                      <>
                        <span className="font-mono tnum">{preview.units}</span> repriceable{' '}
                        {preview.units === 1 ? 'machine' : 'machines'}
                      </>
                    }
                    value={rupees(preview.grossPayout)}
                  />

                  {/* Itemised, always, including a zero. A charge revealed one
                      click in is drip pricing, which the CCPA Dark Patterns
                      Guidelines 2023 name by that word. */}
                  {preview.deductions.map((d) => (
                    <LedgerRow
                      key={d.code}
                      label={d.label}
                      value={<span className="text-ink-2">−{rupees(d.amount)}</span>}
                    />
                  ))}
                  {preview.deductions.length === 0 ? (
                    <p className="border-t border-rule-2 px-5 py-3 text-body-sm text-ink-2">
                      Nothing is deducted from this batch.
                    </p>
                  ) : (
                    <LedgerRow
                      label={
                        <>
                          Deducted in total
                          <span className="block text-label text-ink-4">
                            <span className="font-mono tnum">{preview.deductions.length}</span>{' '}
                            {preview.deductions.length === 1 ? 'charge' : 'charges'}, from{' '}
                            <span className="font-mono tnum">{rupees(preview.grossPayout)}</span>
                          </span>
                        </>
                      }
                      value={<span className="text-ink-2">−{rupees(preview.totalDeductions)}</span>}
                    />
                  )}

                  <LedgerRow
                    total
                    label="You would receive"
                    value={<span data-testid="reprice-net">{rupees(preview.netPayout)}</span>}
                  />

                  <LedgerRow
                    label={
                      <>
                        Our commission
                        {/* The denominator, and now it can be the rupee figure
                            itself: the percentage is a share of the vendor's own
                            ask, which is a number this screen already shows. It
                            used to be a share of the selling price — the one
                            number this screen may not show — so it could only be
                            named in words, and by saying what it was NOT. */}
                        <span className="block text-label text-ink-4">
                          of your{' '}
                          <span className="font-mono tnum">{rupees(preview.perUnitPayout)}</span>
                        </span>
                      </>
                    }
                    // Amber: a measured value, rule 1's second meaning.
                    value={
                      <span className="text-acc-ink" data-testid="reprice-commission">
                        {preview.commissionPct}%
                      </span>
                    }
                  />
                </div>
              )}
            </Panel>
          </div>

          {error && (
            <p className="mb-5 max-w-prose text-body-sm text-fail" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="primary"
              size="lg"
              loading={busy}
              disabledReason={blocker}
              onClick={() => void submit()}
            >
              {/* Not "Reprice 0 machines". A button that names the number it
                  would change should not offer to change none of them. */}
              {movable.length === 0 ? 'Nothing to reprice' : `Reprice ${machines(movable.length)}`}
            </Button>
            <Link className="hub-link text-body-sm" to="/vendor/listings">
              Cancel
            </Link>
          </div>
        </div>

        <aside className="hub-dock" aria-labelledby="reprice-dock-title">
          <h2 id="reprice-dock-title" className="hub-dock__title !mb-1">
            What will not change
          </h2>
          <p className="mb-4 text-body-sm text-ink-2">
            Said before the button, not discovered afterwards.
          </p>
          <LockedMachines locked={locked} />
          <p className="mt-5 border-t border-rule-2 pt-4 text-body-sm text-ink-2">
            A price far below the trailing 30-day median for this model is flagged for someone to
            look at. It is <strong className="font-semibold text-ink">not blocked</strong> and
            nothing comes off sale — the listing carries an &ldquo;under review&rdquo; chip until
            it has been seen.
          </p>
        </aside>
      </div>
    </div>
  );
}
