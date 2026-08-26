import * as React from 'react';
import { GradeBadge, Input, Skeleton } from '@trugrade/ui';
import { GRADES, type Grade } from '@trugrade/contracts';
import { useResource } from '../../../lib/useResource';
import { API, gradeLabel, type GradeDefinition, type VendorFacility } from '../api';
import type { WizardDraft } from './draft';

/**
 * A labelled `<select>`.
 *
 * `@trugrade/ui` has `Input` but no select, and this screen has seven of them.
 * A native `<select>` already carries the keyboard behaviour, the mobile picker
 * and the ARIA a custom listbox would have to reimplement — there is nothing
 * here worth building a component library entry for.
 */
function Select({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (v: string) => void;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body-sm font-medium text-ink-2">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-11 rounded border border-rule bg-sheet px-4 text-body-sm text-ink"
      >
        {options.map(([v, l]) => (
          // `v || l`: the "choose one" placeholder has an empty value, and React
          // reads an empty-string key as no key at all.
          <option key={v || l} value={v}>
            {l}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${id}-hint`} className="text-body-sm text-ink-2">
          {hint}
        </p>
      )}
    </div>
  );
}

const CONDITION = [
  ['LIKE_NEW', 'Like new'],
  ['UNBOXED', 'Unboxed'],
  ['REFURBISHED', 'Refurbished'],
  ['USED_TESTED', 'Used, tested'],
] as const;

/** NON_FUNCTIONAL is absent on purpose — `chk_sellable` refuses it at the database. */
const FUNCTIONAL = [
  ['FULLY_FUNCTIONAL', 'Everything works'],
  ['MINOR_ISSUE', 'A minor issue, described'],
  ['LIMITED', 'Limited — some function is degraded'],
] as const;

const BATTERY = [
  ['EXCELLENT_90_PLUS', '90% or better'],
  ['GOOD_80_89', '80–89%'],
  ['FAIR_70_79', '70–79%'],
  ['LOW_BELOW_70', 'Below 70%'],
  ['UNKNOWN', 'Not measured'],
] as const;

const PARTS = [
  ['ALL_ORIGINAL', 'All original'],
  ['OEM_REPLACED', 'Replaced with OEM parts'],
  ['COMPATIBLE_REPLACED', 'Replaced with compatible parts'],
  ['MIXED', 'Mixed'],
] as const;

const REPAIR = [
  ['NONE', 'Never opened'],
  ['MINOR', 'Minor repair'],
  ['MAJOR', 'Major repair'],
] as const;

const WIPE = [
  ['VERIFIED_WIPED', 'Wiped and verified'],
  ['CERTIFICATE_AVAILABLE', 'Wiped, certificate available'],
  ['NOT_APPLICABLE', 'Not applicable'],
] as const;

const SELLER_WARRANTY = [
  ['NONE', 'None'],
  ['D7', '7 days'],
  ['D30', '30 days'],
  ['M3', '3 months'],
  ['M6', '6 months'],
  ['M12', '12 months'],
] as const;

const OEM_WARRANTY = [
  ['NONE', 'None left'],
  ['LT_3M', 'Under 3 months'],
  ['M3_6', '3–6 months'],
  ['M6_12', '6–12 months'],
  ['M12_PLUS', 'Over 12 months'],
] as const;

/**
 * The grade definitions, in the platform's own words.
 *
 * PHASE_03 Task 3 step 2: show `catalog.grade_definition.customer_description`
 * inline "so the vendor grades against the same definition the QC engine will
 * use". Two vocabularies for one grade is the root of most grade disputes, and
 * this is the cheap end of fixing it.
 */
function GradePicker({
  value,
  onChange,
}: {
  value: Grade;
  onChange: (g: Grade) => void;
}): React.JSX.Element {
  const { data, error } = useResource<GradeDefinition[]>(
    API.gradeDefinitions,
    'Grade definitions unavailable',
  );
  const byGrade = new Map((data ?? []).map((d) => [d.grade, d.customerDescription]));

  return (
    <fieldset>
      <legend className="text-body-sm font-medium text-ink-2">Grade</legend>
      <div className="mt-3 flex flex-col gap-3">
        {GRADES.map((g) => (
          <label
            key={g}
            className={[
              'flex cursor-pointer items-start gap-4 rounded border p-4',
              value === g ? 'border-acc bg-acc-wash' : 'border-rule bg-sheet',
            ].join(' ')}
          >
            <input
              type="radio"
              name="grade"
              value={g}
              checked={value === g}
              onChange={() => onChange(g)}
              className="mt-1"
            />
            <span className="flex flex-col gap-2">
              <GradeBadge grade={g} variant="declared" />
              {error ? (
                <span className="text-body-sm text-ink-2">
                  We could not load the definition for Grade {gradeLabel(g)}. Grade from the
                  photographs in the grading policy rather than from memory.
                </span>
              ) : !data ? (
                <Skeleton lines={2} />
              ) : (
                <span className="text-body-sm text-ink-2">
                  {byGrade.get(g) ?? 'No published definition for this grade yet.'}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StepCondition({
  draft,
  patch,
}: {
  draft: WizardDraft;
  patch: (p: Partial<WizardDraft>) => void;
}): React.JSX.Element {
  const facilities = useResource<VendorFacility[]>(API.facilities, 'Pickup locations unavailable');

  return (
    <div>
      <h2 className="text-h2 text-ink">Declare the condition</h2>

      {/* The three sentences PHASE_03 Task 3 step 2 requires on this screen, in
          plain words and above the fields rather than under them. Disclosure at
          declaration time is worth more than an appeals process later. */}
      <div className="mt-4 max-w-prose rounded-lg border border-rule bg-sheet-2 p-5">
        <p className="text-body text-ink">We will check this.</p>
        <p className="mt-3 text-body-sm text-ink-2">
          Every machine you list is inspected before it is sold. You are declaring what you believe
          the condition to be, not deciding it. If our inspection finds a lower grade than you
          declared, we issue a <strong>grade correction</strong>: the unit is re-listed at the
          corrected grade, you are told what we measured and shown the photographs, and you can
          accept, reprice, withdraw the unit or dispute it. Repeated corrections lower your
          grade-accuracy score, which affects your tier, your payout speed and how much of your
          stock we sample.
        </p>
      </div>

      <div className="mt-6 grid gap-7 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <GradePicker value={draft.grade} onChange={(grade) => patch({ grade })} />
        </div>

        <div className="flex flex-col gap-5">
          <Select
            label="Condition"
            value={draft.conditionType}
            options={CONDITION}
            onChange={(conditionType) => patch({ conditionType })}
          />
          <Select
            label="Functional status"
            value={draft.functionalStatus}
            options={FUNCTIONAL}
            onChange={(functionalStatus) => patch({ functionalStatus })}
          />
          <Select
            label="Battery health"
            hint="A band, not a number — the inspection measures the number."
            value={draft.batteryHealthBand}
            options={BATTERY}
            onChange={(batteryHealthBand) => patch({ batteryHealthBand })}
          />
          <Select
            label="Parts"
            value={draft.partsStatus}
            options={PARTS}
            onChange={(partsStatus) => patch({ partsStatus })}
          />
          <Input
            label="Which parts were replaced"
            hint="Comma separated. Leave blank if all original."
            value={draft.partsReplaced.join(', ')}
            onChange={(e) =>
              patch({
                partsReplaced: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 20),
              })
            }
          />
          <Select
            label="Repair history"
            value={draft.repairHistory}
            options={REPAIR}
            onChange={(repairHistory) => patch({ repairHistory })}
          />
          <Select
            label="Data wipe"
            value={draft.dataWipeStatus}
            options={WIPE}
            onChange={(dataWipeStatus) => patch({ dataWipeStatus })}
          />
        </div>
      </div>

      <h3 className="mt-9 text-h3 text-ink">The warranty you will stand behind</h3>

      {/* Both warranty sentences Task 3 step 2 names. The second one is the
          incentive, so it says where the vendor will see the effect. */}
      <p className="mt-3 max-w-prose text-body-sm text-ink-2">
        We sell the customer a <strong>longer total term than you offer</strong> and fund the
        difference ourselves — so what the buyer sees is not what you are committing to here. A{' '}
        <strong>longer term from you earns you a better price</strong>, because it costs us less to
        top up. Change the months below and watch the payout move on step 4.
      </p>

      <div className="mt-5 grid max-w-3xl gap-5 md:grid-cols-2">
        <Input
          label="Your warranty, in months"
          type="number"
          min={0}
          max={24}
          hint="0 to 24. This is a commercial commitment we can recover against, not a note."
          value={String(draft.vendorWarrantyMonths)}
          onChange={(e) =>
            patch({
              vendorWarrantyMonths: Math.max(0, Math.min(24, Number(e.target.value) || 0)),
            })
          }
        />
        <Select
          label="Manufacturer warranty remaining"
          value={draft.oemWarrantyRemaining}
          options={OEM_WARRANTY}
          onChange={(oemWarrantyRemaining) => patch({ oemWarrantyRemaining })}
        />
        <Select
          label="Returns window you offer"
          value={draft.sellerWarranty}
          options={SELLER_WARRANTY}
          onChange={(sellerWarranty) => patch({ sellerWarranty })}
        />
        <Select
          label="Where we collect from"
          hint="Drives the inspection visit and the pickup window."
          value={draft.pickupLocationId}
          options={[
            ['', facilities.error ? 'Could not load your locations' : 'Choose a location'],
            ...(facilities.data ?? []).map(
              (f) => [f.addressId, `${f.label} · ${f.city} ${f.pincode}`] as const,
            ),
          ]}
          onChange={(pickupLocationId) => patch({ pickupLocationId })}
        />
      </div>
    </div>
  );
}
