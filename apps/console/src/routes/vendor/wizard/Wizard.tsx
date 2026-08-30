import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, EmptyState, StepRail, WhyRail, type Step, type WhyRailItem } from '@trugrade/ui';
import { PageHeader } from '../../../lib/controls';
import { API, postJson, rupees, type MoneyString, type VendorListing } from '../api';
import { useDraft, type WizardDraft } from './draft';
import { StepMachine } from './StepMachine';
import { StepCondition } from './StepCondition';
import { StepSerials } from './StepSerials';
import { StepPrice } from './StepPrice';

/**
 * ARCHETYPE D — Flow. Step rail + one step + a "why we ask" rail.
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

/**
 * The third column of archetype D, one list per step.
 *
 * It was missing: the wizard declared archetype D and shipped two columns of it,
 * with the reasons buried as prose between the fields where a vendor who already
 * knows the answer has to read past them. `WhyRail` was already in
 * `@trugrade/ui`, built for vendor registration and used by nothing.
 *
 * Everything here is a *consequence*, never a definition. "We ask for the serial
 * so we can identify the machine" is a sentence that teaches nobody anything;
 * "a serial already live on the platform is refused, and the check is ours to
 * run because a browser cannot see another vendor's stock" is why the field
 * behaves the way it does.
 */
const WHY: Record<1 | 2 | 3 | 4, readonly WhyRailItem[]> = {
  1: [
    {
      term: 'Search the catalog',
      explanation:
        'Every listing sits on a SKU we already carry. That is what lets a buyer put your machine beside four other vendors’ on the same specification — and it is why you cannot type your own title.',
    },
    {
      term: 'The declared specification',
      explanation:
        'This is what the technician inspects against. Listing on the wrong SKU is not a cosmetic mistake: the inspection compares the machine to this row and fails it.',
    },
    {
      term: 'No SKU matches',
      explanation:
        'Request one. Everything you have entered stays in this tab, and you come straight back to it.',
    },
  ],
  2: [
    {
      term: 'Grade',
      explanation:
        'You are declaring what you believe the condition to be, not deciding it. A lower measured grade is a correction you can accept, reprice, withdraw or dispute — not a rejection.',
    },
    {
      term: 'Battery health',
      explanation:
        'A band, because you are reading a label or a tool. The inspection measures the number, and each grade has a floor it must clear.',
    },
    {
      term: 'Your warranty, in months',
      explanation:
        'A commercial commitment we can recover against. It is also the one field on this step that moves your money: offer longer and we reserve less, which raises what you can be paid on step 4.',
    },
    {
      term: 'Where we collect from',
      explanation:
        'The facility decides which technician can visit and when. A closed day cannot be booked, so the address here sets the inspection date more than anything else you enter.',
    },
  ],
  3: [
    {
      term: 'Serial numbers',
      explanation:
        'One row per machine, because a buyer buys a specific serial with a specific seal on it. Batch quantities are not what we sell.',
    },
    {
      term: 'The checks we run',
      explanation:
        'Format, duplicates inside your own paste, duplicates against every live listing on the platform, and the stolen-serial register. The last two are ours to run — a browser cannot see another vendor’s stock.',
    },
    {
      term: 'An unrecognised shape',
      explanation:
        'Warns and never blocks. Worn and reprinted labels are real machines, and a wizard that refuses them is one the warehouse works around.',
    },
  ],
  4: [
    {
      term: 'Net payout per machine',
      explanation:
        'What lands in your account, after everything. It does not move for freight, for a buyer discount, or if we correct the grade after inspection. It is fixed when the purchase order is raised.',
    },
    {
      term: 'The deductions',
      explanation:
        'Computed on the server, because they depend on your purchases so far this financial year, your PAN state and any standing penalties. A number the browser guessed at would be a promise we then did not pay.',
    },
    {
      term: 'Our commission',
      explanation:
        'Our whole charge as a share of what the buyer pays — not a share of your payout. The retail price is not on this screen and the breakdown of our charge is not yours to carry.',
    },
    {
      term: 'Dispatch SLA',
      explanation:
        'How long after a purchase order you can have the machines sealed and ready. Missing it is a penalty, so it is a promise rather than a preference.',
    },
  ],
};

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
    if (!draft.sku) return;
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
    <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_280px]">
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
          // Suppressed, not disabled, while the batch-size question is open.
          // The two buttons in that panel ARE the submit, and leaving a third
          // amber button under them puts two primary actions on one screen and
          // makes the wrong one look like the way forward.
          !decisionOpen && (
            <Button
              variant="primary"
              loading={busy}
              disabledReason={blocker}
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

      {/* Below the step on anything under 1280px rather than squeezed beside it:
          at 280px the explanations are three words a line, and a rail nobody can
          read is worse than one that has moved. */}
      <div className="order-3 lg:col-span-2 xl:col-span-1">
        <WhyRail items={WHY[draft.step]} />
      </div>
    </div>
  );
}
