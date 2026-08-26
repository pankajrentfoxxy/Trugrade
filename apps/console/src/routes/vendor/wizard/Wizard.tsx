import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, EmptyState, StepRail, type Step } from '@trugrade/ui';
import { PageHeader } from '../../../lib/controls';
import { API, postJson, rupees, type MoneyString, type VendorListing } from '../api';
import { useDraft, type WizardDraft } from './draft';
import { StepMachine } from './StepMachine';
import { StepCondition } from './StepCondition';
import { StepSerials } from './StepSerials';
import { StepPrice } from './StepPrice';

/**
 * ARCHETYPE D — Flow. Step rail + one step + the reasons beside the fields.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
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

/** Whether anything has actually been entered, which is what "saved" means here. */
function draftStarted(draft: WizardDraft): boolean {
  return (
    draft.sku !== null || draft.serials.length > 0 || draft.netPayoutRupees.trim() !== ''
  );
}

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

  /**
   * The rail is the wizard's own state, told in the component's vocabulary.
   *
   * A step behind the current one is `complete` and clickable; the current one
   * is `current`; anything ahead is `upcoming` and is a `<span aria-disabled>`
   * rather than a disabled `<button>` — `Stepper` makes that choice for us,
   * which is the reason to use it rather than the hand-rolled `<ol>` of buttons
   * this replaced. Forwards stays refused, because step 4's payout preview is
   * meaningless without a SKU and a unit count.
   */
  const steps: Step[] = STEPS.map((label, i) => {
    const n = i + 1;
    return {
      key: label,
      label,
      status: n < draft.step ? 'complete' : n === draft.step ? 'current' : 'upcoming',
      ...(n < draft.step ? { href: `#step-${n}` } : {}),
    };
  });

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="order-2 lg:order-1">
        {/* Clicking a completed step is a jump inside one page, not a route, so
            the rail's hrefs are anchors and the handler does the move. */}
        <div
          onClick={(e) => {
            const anchor = (e.target as HTMLElement).closest('a[href^="#step-"]');
            if (!anchor) return;
            e.preventDefault();
            const n = Number(anchor.getAttribute('href')?.replace('#step-', ''));
            if (n >= 1 && n <= 4) patch({ step: n as WizardDraft['step'] });
          }}
        >
          {/* The draft is written to `sessionStorage` on every patch, so "saved"
              is a fact rather than a promise — but only once there is something
              in it. An empty draft gets the rail's own "nothing saved yet",
              which is the truth. */}
          <StepRail
            label="List stock"
            steps={steps}
            {...(draftStarted(draft) ? { savedAt: 'in this browser' } : {})}
          />
        </div>
      </div>

      <div className="order-1 lg:order-2">
        <PageHeader title="List stock">
          {/* The pivot of the whole model, said before the first field rather
              than after the last button: submitting requests an inspection. */}
          Finishing this does not put anything on sale. It requests an inspection at your site. Your
          machines go live only after they have been inspected and sealed.
        </PageHeader>

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
        <div className="tg-card mt-7 rounded-lg border border-warn">
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
    </div>
  );
}
