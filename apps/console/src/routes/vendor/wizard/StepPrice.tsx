import * as React from 'react';
import { Input, Skeleton } from '@trugrade/ui';
import { API, onDate, postJson, rupees, type PayoutPreview } from '../api';
import type { WizardDraft } from './draft';

/**
 * Step 4 — the price, stated as what the vendor receives.
 *
 * **The retail price is not on this screen and must never be added to it.**
 * PHASE_03 Task 3 step 4 is explicit — "your margin is not their business, and
 * showing it invites a negotiation you do not want to have per unit" — and it is
 * an exit criterion for the phase. Note what that rules out: not just a "retail
 * price" field, but `CommissionReadout` from `@trugrade/ui`, which renders a
 * "Listed at" row. That component is for admin screens.
 *
 * `commissionPct` IS shown, and it is the one deliberate inversion: our whole
 * charge as a percentage is algebraically invertible back to the selling price.
 * PHASE_03 requires it anyway, for a good reason — vendors think in percentages
 * and refusing them the vocabulary loses the conversation. What stays hidden is
 * the itemisation: the margin amount, the warranty reserve, the QC allocation
 * and the freight allowance are each a separate negotiation.
 *
 * The arithmetic is not done here. The preview is a server call because the
 * deductions depend on things the browser cannot know — the vendor's cumulative
 * purchases this financial year, their PAN state, standing penalties. A client
 * that guessed at any of those would promise a number we then did not pay.
 */
export function StepPrice({
  draft,
  patch,
}: {
  draft: WizardDraft;
  patch: (p: Partial<WizardDraft>) => void;
}): React.JSX.Element {
  const [preview, setPreview] = React.useState<PayoutPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const units = draft.serials.length;

  React.useEffect(() => {
    const amount = draft.netPayoutRupees.trim();
    // Mid-keystroke is not an error state. Anything that is not yet a clean
    // rupee amount simply has no preview.
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) === 0 || !draft.sku || units === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const p = await postJson<PayoutPreview>(API.payoutPreview, {
            skuId: draft.sku?.skuId,
            grade: draft.grade,
            vendorWarrantyMonths: draft.vendorWarrantyMonths,
            units,
            ask: { mode: 'NET_PAYOUT', vendorNetPayout: amount },
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
  }, [draft.netPayoutRupees, draft.sku, draft.grade, draft.vendorWarrantyMonths, units]);

  return (
    <div>
      <h2 className="text-h2 text-ink">What you want to receive</h2>
      <p className="mt-2 max-w-prose text-body-sm text-ink-2">
        Enter the amount you want in your account per machine, after everything. That number is
        what we hold you to — it does not move for freight, for a buyer discount, or if we correct
        the grade after inspection. It is fixed when the purchase order is raised.
      </p>

      <div className="mt-6 grid gap-7 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Input
            label="Net payout per machine"
            mono
            inputMode="decimal"
            hint={`For ${units} ${units === 1 ? 'machine' : 'machines'} in this listing.`}
            placeholder="42000"
            value={draft.netPayoutRupees}
            onChange={(e) => patch({ netPayoutRupees: e.target.value })}
          />
          <Input
            label="Minimum order quantity"
            type="number"
            min={1}
            value={String(draft.moq)}
            onChange={(e) => patch({ moq: Math.max(1, Number(e.target.value) || 1) })}
          />
          <Input
            label="Dispatch SLA, in hours"
            type="number"
            min={1}
            max={720}
            hint="How long after a purchase order you can have the machines ready."
            value={String(draft.dispatchSlaHours)}
            onChange={(e) =>
              patch({ dispatchSlaHours: Math.max(1, Math.min(720, Number(e.target.value) || 48)) })
            }
          />
        </div>

        <div className="rounded-lg border border-rule bg-sheet p-5" data-testid="payout-preview">
          {error && (
            <p className="text-body-sm text-fail" role="alert">
              {error}
            </p>
          )}

          {!error &&
            !preview &&
            (units === 0 ? (
              <p className="text-body-sm text-ink-2">
                Add serial numbers on the previous step and the batch total appears here.
              </p>
            ) : draft.netPayoutRupees.trim() === '' ? (
              <p className="text-body-sm text-ink-2">
                Enter the amount you want per machine and we will show the batch, the deductions
                and when it is paid.
              </p>
            ) : (
              <Skeleton lines={5} />
            ))}

          {preview && (
            <dl className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-ink-2">Per machine</dt>
                <dd className="font-mono text-data tnum text-ink">
                  {rupees(preview.perUnitPayout)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-rule-2 pt-3">
                <dt className="text-body-sm text-ink-2">
                  {preview.units} {preview.units === 1 ? 'machine' : 'machines'}
                </dt>
                <dd className="font-mono text-data tnum text-ink">
                  {rupees(preview.grossPayout)}
                </dd>
              </div>

              {/* Every deduction, itemised, always — including a zero. A charge
                  revealed one click in is drip pricing, which the CCPA Dark
                  Patterns Guidelines 2023 name by that word. */}
              {preview.deductions.map((d) => (
                <div key={d.code} className="flex items-baseline justify-between gap-4">
                  <dt className="max-w-prose text-body-sm text-ink-2">{d.label}</dt>
                  <dd className="font-mono text-data tnum text-ink-2">−{rupees(d.amount)}</dd>
                </div>
              ))}
              {preview.deductions.length === 0 && (
                <p className="text-body-sm text-ink-2">Nothing is deducted from this batch.</p>
              )}

              <div className="flex items-baseline justify-between gap-4 border-t border-rule pt-3">
                <dt className="text-body text-ink">You receive</dt>
                <dd className="font-mono text-h3 tnum text-ink" data-testid="net-payout">
                  {rupees(preview.netPayout)}
                </dd>
              </div>

              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-ink-2">Our commission</dt>
                <dd className="font-mono text-data tnum text-acc-ink" data-testid="commission-pct">
                  {preview.commissionPct}%
                </dd>
              </div>

              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-ink-2">Expected payout date</dt>
                <dd className="font-mono text-data tnum text-ink-2">
                  {preview.expectedPayoutDate
                    ? onDate(preview.expectedPayoutDate)
                    : 'Set by your payout cycle'}
                </dd>
              </div>
            </dl>
          )}

          {preview && (
            // The warranty incentive, made concrete. The vendor changed a number
            // on step 2 and this line moved; that is the whole argument for a
            // longer vendor term, and it is worth stating rather than implying.
            <p className="mt-5 border-t border-rule-2 pt-4 text-body-sm text-ink-2">
              You stand behind {preview.vendorWarrantyMonths}{' '}
              {preview.vendorWarrantyMonths === 1 ? 'month' : 'months'}. We sell the customer{' '}
              {preview.customerWarrantyMonths} and fund the difference. Offer more and we reserve
              less, which raises what you can be paid.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
