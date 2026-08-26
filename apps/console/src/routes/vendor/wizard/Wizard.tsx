import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, EmptyState } from '@trugrade/ui';
import { API, postJson, rupees, type MoneyString, type VendorListing } from '../api';
import { useDraft, type WizardDraft } from './draft';
import { StepMachine } from './StepMachine';
import { StepCondition } from './StepCondition';
import { StepSerials } from './StepSerials';
import { StepPrice } from './StepPrice';

/**
 * The four-step listing wizard.
 *
 * Everything is held client-side until the last button, and that is not laziness
 * about persistence — it is the API's shape. `listing.unit_price` is NOT NULL
 * with `CHECK (> 0)`, so a draft row cannot exist before step 4 has a number,
 * and `POST /:id/units` needs a listing to attach to. So the order is: collect,
 * then create, then attach, then submit. `serials/validate` needs no listing,
 * which is what lets step 3 be live regardless.
 *
 * The draft survives a navigation away (`sessionStorage`, see `draft.ts`), which
 * is what makes the step-1 handoff to the SKU-request flow non-destructive.
 */

const STEPS = ['Pick the machine', 'Declare the condition', 'Serial numbers', 'Price'] as const;

interface SubmitDecisionRequired {
  outcome: 'DECISION_REQUIRED';
  unitCount: number;
  minUnitsPerVisit: number;
  shortBy: number;
  visitFee: MoneyString;
  options: readonly ('HOLD' | 'ACCEPT_FEE')[];
}
interface SubmitHeld {
  outcome: 'HELD';
  unitCount: number;
  minUnitsPerVisit: number;
  shortBy: number;
}
interface SubmitAccepted {
  outcome: 'SUBMITTED';
  listingId: string;
  unitCount: number;
  visitNumber: string;
  visitFee: MoneyString;
}
type SubmitResult = SubmitDecisionRequired | SubmitHeld | SubmitAccepted;

/** What stops the vendor moving on, said as the thing to do rather than the rule broken. */
function blockerFor(draft: WizardDraft): string {
  switch (draft.step) {
    case 1:
      return draft.sku ? '' : 'Choose a SKU first — every listing is against one we already carry.';
    case 2:
      return draft.pickupLocationId
        ? ''
        : 'Choose where we collect from. It decides when we can inspect.';
    case 3:
      return draft.serials.length > 0
        ? ''
        : 'Add at least one serial number. Every machine is listed individually.';
    case 4:
      return /^\d+(\.\d{1,2})?$/.test(draft.netPayoutRupees.trim()) &&
        Number(draft.netPayoutRupees) > 0
        ? ''
        : 'Enter the amount you want to receive per machine.';
  }
}

export function ListingWizardRoute(): React.JSX.Element {
  const [draft, patch, clear] = useDraft();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SubmitResult | null>(null);
  const navigate = useNavigate();

  /**
   * Create, attach, submit — in that order, and stopping at the first failure.
   *
   * Not a transaction and it cannot be: three HTTP calls. What that leaves is a
   * created draft with no units if the second call fails, which is a recoverable
   * state the vendor can see in `/vendor/listings` and finish. A silent retry of
   * the first call would leave two drafts instead, which is not.
   */
  async function commit(choice?: 'HOLD' | 'ACCEPT_FEE'): Promise<void> {
    if (!draft.sku) return;
    setBusy(true);
    setError(null);
    try {
      const listing = await postJson<VendorListing>(API.listings, {
        skuId: draft.sku.skuId,
        pickupLocationId: draft.pickupLocationId,
        grade: draft.grade,
        conditionType: draft.conditionType,
        functionalStatus: draft.functionalStatus,
        batteryHealthBand: draft.batteryHealthBand,
        partsStatus: draft.partsStatus,
        partsReplaced: draft.partsReplaced,
        repairHistory: draft.repairHistory,
        dataWipeStatus: draft.dataWipeStatus,
        sellerWarranty: draft.sellerWarranty,
        oemWarrantyRemaining: draft.oemWarrantyRemaining,
        vendorWarrantyMonths: draft.vendorWarrantyMonths,
        vendorAskPrice: draft.netPayoutRupees.trim(),
        moq: draft.moq,
        dispatchSlaHours: draft.dispatchSlaHours,
      });

      await postJson(API.listingUnits(listing.id), { serials: draft.serials });

      const outcome = await postJson<SubmitResult>(API.submit(listing.id), { choice });
      setResult(outcome);
      if (outcome.outcome === 'SUBMITTED') clear();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result?.outcome === 'SUBMITTED') {
    return (
      <EmptyState
        title="Inspection requested. Nothing is live yet."
        body={`Visit ${result.visitNumber} covers ${result.unitCount} ${result.unitCount === 1 ? 'machine' : 'machines'}. We will confirm a slot, inspect at your site, and only then does anything appear to a buyer. Failed machines are never listed — they stay yours.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings">
            See your listings
          </Link>
        }
      />
    );
  }

  if (result?.outcome === 'HELD') {
    return (
      <EmptyState
        title="Held until you reach the minimum"
        body={`You have ${result.unitCount} machines and a visit needs ${result.minUnitsPerVisit}. Nothing has been submitted. Add ${result.shortBy} more and request the inspection, or come back and accept the visit fee.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings">
            See your listings
          </Link>
        }
      />
    );
  }

  const blocker = blockerFor(draft);

  return (
    <div>
      <h1 className="text-h1 text-ink">List stock</h1>

      {/* The pivot of the whole model, said before the first field rather than
          after the last button: submitting requests an inspection. */}
      <p className="mt-2 max-w-prose text-body-sm text-ink-2">
        Finishing this does not put anything on sale. It requests an inspection at your site. Your
        machines go live only after they have been inspected and sealed.
      </p>

      <ol className="mt-6 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((label, i) => {
          const n = (i + 1) as WizardDraft['step'];
          return (
            <li key={label}>
              <button
                type="button"
                // Backwards is always allowed; forwards is not, because step 4's
                // preview is meaningless without a SKU and a unit count.
                disabled={n > draft.step}
                onClick={() => patch({ step: n })}
                aria-current={draft.step === n ? 'step' : undefined}
                className={[
                  'rounded px-4 py-2 text-body-sm transition-colors disabled:opacity-45',
                  draft.step === n ? 'bg-acc-wash text-acc-ink' : 'text-ink-2 hover:bg-sheet-2',
                ].join(' ')}
              >
                <span className="font-mono text-label tnum">{n}</span> {label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-7">
        {draft.step === 1 && <StepMachine draft={draft} patch={patch} />}
        {draft.step === 2 && <StepCondition draft={draft} patch={patch} />}
        {draft.step === 3 && (
          <StepSerials
            serialText={draft.serialText}
            brandName={draft.sku?.brandName}
            onChange={(serialText, serials) => patch({ serialText, serials })}
          />
        )}
        {draft.step === 4 && <StepPrice draft={draft} patch={patch} />}
      </div>

      {result?.outcome === 'DECISION_REQUIRED' && (
        // Not a rejection. A vendor with eighteen machines who is silently
        // refused concludes the platform does not want them.
        <div className="mt-7 rounded-lg border border-warn p-5">
          <p className="text-body text-ink">
            {result.unitCount} machines is fewer than the {result.minUnitsPerVisit} a visit is
            worth.
          </p>
          <p className="mt-3 max-w-prose text-body-sm text-ink-2">
            Nothing has been submitted yet. Either hold these {result.unitCount} until you have{' '}
            {result.shortBy} more, or accept the visit fee of {rupees(result.visitFee)} and we come
            now.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" loading={busy} onClick={() => void commit('HOLD')}>
              Hold until I reach {result.minUnitsPerVisit}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void commit('ACCEPT_FEE')}>
              Accept {rupees(result.visitFee)} and inspect now
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-6 text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}

      <div className="mt-9 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
        <Button
          variant="ghost"
          disabled={draft.step === 1}
          onClick={() => patch({ step: (draft.step - 1) as WizardDraft['step'] })}
        >
          Back
        </Button>

        {draft.step < 4 ? (
          <Button
            variant="primary"
            disabledReason={blocker}
            onClick={() => patch({ step: (draft.step + 1) as WizardDraft['step'] })}
          >
            Continue
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={busy}
            disabledReason={blocker}
            onClick={() => void commit()}
          >
            Request the inspection
          </Button>
        )}

        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            clear();
            navigate('/vendor');
          }}
        >
          Discard this draft
        </Button>
      </div>
    </div>
  );
}
