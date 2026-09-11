import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, EmptyState, type Step } from '@trugrade/ui';
import { PageHeader } from '../../../lib/controls';
import { API, postJson, rupees, type MoneyString, type VendorListing } from '../api';
import { payoutBlocker, useDraft, type WizardDraft } from './draft';
import { StepMachine } from './StepMachine';
import { StepCondition } from './StepCondition';
import { StepSerials } from './StepSerials';
import { StepPrice } from './StepPrice';
import { WizardProgress } from './WizardChrome';

/**
 * ARCHETYPE D — Flow. Step rail + one step.
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
    draft.sku !== null ||
    draft.catalogModel !== null ||
    draft.serials.length > 0 ||
    draft.netPayoutRupees.trim() !== ''
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
      return payoutBlocker(draft.netPayoutRupees);
  }
}

/** Every field the create call needs — not just the current step. */
function submitBlocker(draft: WizardDraft): string {
  if (!draft.sku) return blockerFor({ ...draft, step: 1 });
  if (!draft.pickupLocationId) return blockerFor({ ...draft, step: 2 });
  if (draft.serials.length === 0) return blockerFor({ ...draft, step: 3 });
  return blockerFor({ ...draft, step: 4 });
}

export function ListingWizardRoute(): React.JSX.Element {
  const [draft, patch, clear] = useDraft();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SubmitResult | null>(null);
  /**
   * The listing the first `commit()` created, if it got that far.
   *
   * DECISION_REQUIRED and HELD both come back from `POST /:id/submit` *after*
   * the listing and its units exist — nothing is rolled back, because the vendor
   * is being asked a question rather than refused. Answering it therefore has to
   * re-submit that listing, not build a second one: without this the accept-fee
   * button ran create → attach → submit again, the attach failed on serials the
   * vendor's own draft was already holding, and they were left with two drafts,
   * an error naming their own machines as duplicates, and no inspection.
   */
  const [listingId, setListingId] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);
  const navigate = useNavigate();

  /**
   * Create, attach, submit — in that order, and stopping at the first failure.
   *
   * Not a transaction and it cannot be: three HTTP calls. What that leaves is a
   * created draft with no units if the second call fails, which is a recoverable
   * state the vendor can see in `/vendor/listings` and finish. A silent retry of
   * the first call would leave two drafts instead, which is not — and `listingId`
   * is what stops a second press from doing exactly that.
   */
  async function commit(choice?: 'HOLD' | 'ACCEPT_FEE'): Promise<void> {
    if (submitBlocker(draft) || !draft.sku || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const id = listingId ?? (await create());
      const outcome = await postJson<SubmitResult>(API.submit(id), { choice });
      setResult(outcome);
      if (outcome.outcome === 'SUBMITTED') {
        clear();
        setListingId(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** Create the listing and attach the serials. Returns the id, and remembers it. */
  async function create(): Promise<string> {
    if (!draft.sku) throw new Error('Choose a SKU first.');
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
    setListingId(listing.id);
    return listing.id;
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
        body={`You have ${result.unitCount} machines and a visit needs ${result.minUnitsPerVisit}. No inspection has been requested and nothing is on sale, but the listing is saved with your machines on it. Add ${result.shortBy} more and request the inspection, or come back and accept the visit fee.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings">
            See your listings
          </Link>
        }
      />
    );
  }

  const blocker = blockerFor(draft);
  const decisionOpen = result?.outcome === 'DECISION_REQUIRED';

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
    <div className="min-w-0">
      <div>
        <PageHeader title="List stock" />

        <div className="mt-7">
          <WizardProgress
            steps={steps}
            onStepClick={(n) => patch({ step: n as WizardDraft['step'] })}
          />
          {draftStarted(draft) ? (
            <p className="mt-3 text-body-sm text-ink-3">Draft saved in this browser.</p>
          ) : null}

          <div className="mt-6">
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
          {/*
            Nothing has been submitted yet. Either hold these until you have more,
            or accept the visit fee and we come now.
          */}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" loading={busy} onClick={() => void commit('HOLD')}>
              Hold until I reach {result.minUnitsPerVisit}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void commit('ACCEPT_FEE')}>
              Inspect now
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
          // Suppressed, not disabled, while the batch-size question is open.
          // The two buttons in that panel ARE the submit, and leaving a third
          // amber button under them puts two primary actions on one screen and
          // makes the wrong one look like the way forward.
          !decisionOpen && (
            <Button
              variant="primary"
              loading={busy}
              disabled={busy}
              disabledReason={busy ? undefined : submitBlocker(draft)}
              onClick={() => void commit()}
            >
              Request the inspection
            </Button>
          )
        )}

        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            clear();
            setListingId(null);
            navigate('/vendor');
          }}
        >
          Discard this draft
        </Button>
      </div>
        </div>
      </div>
    </div>
  );
}
