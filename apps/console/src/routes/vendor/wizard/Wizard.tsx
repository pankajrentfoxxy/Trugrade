import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, EmptyState, type Step } from '@trugrade/ui';
import { PageHeader } from '../../../lib/controls';
import { API, postJson, type SubmitResult, type VendorListing } from '../api';
import { payoutBlocker, qtyBlocker, qtyOf, useDraft, type WizardDraft } from './draft';
import { StepMachine } from './StepMachine';
import { StepCondition } from './StepCondition';
import { StepPrice } from './StepPrice';
import { WizardProgress } from './WizardChrome';

/**
 * ARCHETYPE D — Flow. Step rail + one step.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * The three-step listing wizard: the machine, its condition, and the price
 * with the quantity.
 *
 * **No serial numbers.** A listing is a declared quantity of one machine at
 * one grade. The serials are recorded by our technician at your site once a
 * buyer has ordered — so nothing here asks for them, and nothing is inspected
 * until then. Submit sends the listing to our ops team, who approve it onto the
 * storefront.
 *
 * Everything is held client-side until the last button: `listing.unit_price`
 * is NOT NULL, so a draft row cannot exist before step 3 has a number. The
 * order is collect, then create, then submit. The draft survives a navigation
 * away (`sessionStorage`, see `draft.ts`), which is what makes the step-1
 * handoff to the SKU-request flow non-destructive.
 */

const STEPS = ['Pick the machine', 'Declare the condition', 'Price and quantity'] as const;

/** Whether anything has actually been entered, which is what "saved" means here. */
function draftStarted(draft: WizardDraft): boolean {
  return (
    draft.sku !== null ||
    draft.catalogModel !== null ||
    draft.qtyText.trim() !== '' ||
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
        : 'Choose where we collect from. It decides where our technician goes.';
    case 3:
      return qtyBlocker(draft.qtyText) || payoutBlocker(draft.netPayoutRupees);
  }
}

/** Every field the create call needs — not just the current step. */
function submitBlocker(draft: WizardDraft): string {
  if (!draft.sku) return blockerFor({ ...draft, step: 1 });
  if (!draft.pickupLocationId) return blockerFor({ ...draft, step: 2 });
  return blockerFor({ ...draft, step: 3 });
}

export function ListingWizardRoute(): React.JSX.Element {
  const [draft, patch, clear] = useDraft();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SubmitResult | null>(null);
  /**
   * The listing the first `commit()` created, if it got that far.
   *
   * A submit that fails after the create must re-submit that listing rather
   * than build a second one; without this a retry left two drafts behind.
   */
  const [listingId, setListingId] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);
  const navigate = useNavigate();

  /** Create, then submit — stopping at the first failure. */
  async function commit(): Promise<void> {
    if (submitBlocker(draft) || !draft.sku || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const id = listingId ?? (await create());
      const outcome = await postJson<SubmitResult>(API.submit(id), {});
      setResult(outcome);
      clear();
      setListingId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** Create the listing with its declared quantity. Returns the id, and remembers it. */
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
      qtyTotal: qtyOf(draft),
      moq: draft.moq,
      dispatchSlaHours: draft.dispatchSlaHours,
    });
    setListingId(listing.id);
    return listing.id;
  }

  if (result?.outcome === 'SUBMITTED') {
    return (
      <EmptyState
        title="Sent for approval. Nothing is live yet."
        body={`${result.unitCount} ${result.unitCount === 1 ? 'machine' : 'machines'} declared. Our team reviews the listing and puts it on the storefront; you will see it as Live on your listings board. When a buyer orders, our technician comes to your site, inspects each machine and records its serial — you do nothing until then.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings">
            See your listings
          </Link>
        }
      />
    );
  }

  const blocker = blockerFor(draft);

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
            {draft.step === 3 && <StepPrice draft={draft} patch={patch} />}
          </div>

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

            {draft.step < 3 ? (
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
                disabled={busy}
                disabledReason={busy ? undefined : submitBlocker(draft)}
                onClick={() => void commit()}
              >
                Send for approval
              </Button>
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
