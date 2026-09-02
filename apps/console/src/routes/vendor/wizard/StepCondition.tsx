import * as React from 'react';
import { GradeBadge, Input, RepresentativeImage, Skeleton, cn } from '@trugrade/ui';
import { GRADES, type Grade } from '@trugrade/contracts';
import { Select } from '../../../lib/controls';
import { useResource } from '../../../lib/useResource';
import {
  API,
  gradeLabel,
  type GradeDefinition,
  type ResolvedGradeImages,
  type VendorFacility,
} from '../api';
import type { WizardDraft } from './draft';

/** Step 2 of ARCHETYPE D — `Wizard.tsx` owns the shape; this is its content. */

/**
 * The shared `Select` takes `{ value, label }`; these lists read better as
 * tuples. One adapter, rather than rewriting seven constants or forking the
 * control a third time.
 */
const opts = (
  pairs: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<{ value: string; label: string }> =>
  pairs.map(([value, label]) => ({ value, label }));

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

/**
 * The best a band can possibly measure. `null` for UNKNOWN, which is the point:
 * a band nobody has read cannot be compared to a floor, and treating it as 100
 * would clear every grade silently — a missing value rendering as a passing one,
 * which is the defect class this build keeps finding.
 */
const BATTERY_CEILING: Record<string, number | null> = {
  EXCELLENT_90_PLUS: 100,
  GOOD_80_89: 89,
  FAIR_70_79: 79,
  LOW_BELOW_70: 69,
  UNKNOWN: null,
};

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
  batteryBand,
  onChange,
}: {
  value: Grade;
  batteryBand: string;
  onChange: (g: Grade) => void;
}): React.JSX.Element {
  const { data, error } = useResource<GradeDefinition[]>(
    API.gradeDefinitions,
    'Grade definitions unavailable',
  );
  const byGrade = new Map((data ?? []).map((d) => [d.grade, d]));

  // The declared band cannot reach the chosen grade's floor. Not a block — the
  // vendor may have read the wrong band off a worn machine — but a correction
  // they can avoid now costs nothing, and one they discover after the visit
  // costs them a re-list and a point of grade accuracy.
  const chosen = byGrade.get(value);
  const ceiling = BATTERY_CEILING[batteryBand] ?? null;
  const shortfall =
    chosen && ceiling !== null && ceiling < chosen.minBatteryHealthPct ? chosen : null;

  return (
    <fieldset>
      <legend className="text-body-sm font-medium text-ink-2">Grade</legend>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {GRADES.map((g) => (
          <label
            key={g}
            className={cn(
              'flex cursor-pointer items-start gap-4 rounded border p-4 transition-colors',
              // Amber as an active state — the third legitimate use of the
              // accent, and the only one on this step.
              value === g ? 'border-acc bg-acc-wash' : 'border-rule bg-sheet hover:bg-sheet-2',
            )}
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
                <>
                  <span className="text-body-sm text-ink-2">
                    {byGrade.get(g)?.customerDescription ??
                      'No published definition for this grade yet.'}
                  </span>
                  {/* The words are what the vendor reads; these are what the
                      engine applies. A declaration anchored to adjectives is
                      the root of most grade disputes. */}
                  {byGrade.get(g) && (
                    <span className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                      <span>
                        Battery <span className="tnum text-ink-2">
                          {byGrade.get(g)?.minBatteryHealthPct}%
                        </span>{' '}
                        or better
                      </span>
                      <span>
                        Cosmetic <span className="tnum text-ink-2">
                          {byGrade.get(g)?.minCosmeticScore}
                        </span>{' '}
                        of 100
                      </span>
                      {byGrade.get(g)?.maxCycleCount === null ? (
                        <span className="text-ink-4">Cycles not capped</span>
                      ) : (
                        <span>
                          Cycles under{' '}
                          <span className="tnum text-ink-2">
                            {byGrade.get(g)?.maxCycleCount}
                          </span>
                        </span>
                      )}
                    </span>
                  )}
                </>
              )}
            </span>
          </label>
        ))}
      </div>

      {shortfall && (
        <p
          className="mt-4 max-w-prose rounded border border-warn p-4 text-body-sm text-warn"
          role="status"
        >
          Grade {gradeLabel(shortfall.grade)} needs battery health of{' '}
          <span className="font-mono tnum">{shortfall.minBatteryHealthPct}%</span> or better, and
          you have declared{' '}
          <span className="font-mono tnum">
            {BATTERY.find(([v]) => v === batteryBand)?.[1] ?? batteryBand}
          </span>{' '}
          — the top of that band is{' '}
          <span className="font-mono tnum">{BATTERY_CEILING[batteryBand]}%</span>. Nothing is
          blocked: you can still list it, and the inspection will correct the grade downwards when
          it measures the cell. Change the grade or the band if you read one of them wrong.
        </p>
      )}
    </fieldset>
  );
}

/**
 * What a buyer will actually be shown for the grade the vendor is choosing.
 *
 * The grading policy was words and numbers and nothing else, and the one moment
 * a vendor needs the photographs is the moment they are declaring a grade
 * against them. The library exists — 608 catalogued frames — and until now there
 * was no vendor-reachable view of it at all: the only screen was the console's
 * coverage grid, guarded by `catalog.condition_image.write`, which no vendor
 * role holds and which carries object keys and every competitor's models.
 *
 * So this reads the same `@Public()` SKU route the product page reads, through
 * the same resolver, and renders through `RepresentativeImage` — the component
 * that bakes in the caption. The vendor is therefore looking at the literal
 * frames a buyer will see beside their machine, which is the only version of
 * this panel worth having: a separate "grading guide" is a second set of
 * photographs to keep in step with the first.
 */
function GradeReference({ skuId, grade }: { skuId: string; grade: Grade }): React.JSX.Element {
  const { data, error } = useResource<{ images: ResolvedGradeImages | null }>(
    API.skuImages(skuId, grade),
    'Reference photographs unavailable',
  );

  const resolved = data?.images ?? null;

  return (
    <section className="mt-6">
      <h3 className="text-h3 text-ink">What a buyer sees at Grade {gradeLabel(grade)}</h3>
      {error ? (
        <p className="mt-3 max-w-prose text-body-sm text-ink-2">
          {error}. Grade from the written definitions above rather than from memory — nothing about
          your declaration depends on these photographs loading.
        </p>
      ) : !data ? (
        <Skeleton lines={3} />
      ) : resolved === null || resolved.images.length === 0 ? (
        <p className="mt-3 max-w-prose text-body-sm text-ink-2">
          We have not photographed Grade {gradeLabel(grade)} for this machine yet, so a buyer sees a
          labelled placeholder rather than a photograph. Your declaration is unaffected; the
          inspection still measures the machine.
        </p>
      ) : (
        <>
          <p className="mt-3 max-w-prose text-body-sm text-ink-2">
            {/* The match level matters to the person declaring: a SERIES-anchored
                set is a different model, so "worse than this and it is a B" is a
                looser comparison than it looks. Said in words, not inferred. */}
            {resolved.match === 'SKU'
              ? 'These are our photographs of this exact configuration at this grade.'
              : resolved.match === 'MODEL'
                ? 'These are our photographs of this model at this grade — another machine, not yours.'
                : 'These are our photographs of this range at this grade — a different model in the same family.'}{' '}
            Your machine should look no worse than this. Its own photographs are taken at the
            inspection and go on its unit passport.
          </p>
          <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {resolved.images.map((image) => (
              <RepresentativeImage
                key={image.id}
                src={image.url}
                alt={image.altText}
                grade={grade}
                match={resolved.match}
              />
            ))}
          </div>
        </>
      )}
    </section>
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

      <div className="mt-6">
        <GradePicker
          value={draft.grade}
          batteryBand={draft.batteryHealthBand}
          onChange={(grade) => patch({ grade })}
        />
      </div>

      {draft.sku && <GradeReference skuId={draft.sku.skuId} grade={draft.grade} />}

      <div className="mt-7 grid gap-x-7 gap-y-5 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Select
            label="Condition"
            value={draft.conditionType}
            options={opts(CONDITION)}
            onChange={(e) => patch({ conditionType: e.target.value })}
          />
          <Select
            label="Functional status"
            value={draft.functionalStatus}
            options={opts(FUNCTIONAL)}
            onChange={(e) => patch({ functionalStatus: e.target.value })}
          />
          <Select
            label="Battery health"
            hint="A band, not a number — the inspection measures the number."
            value={draft.batteryHealthBand}
            options={opts(BATTERY)}
            onChange={(e) => patch({ batteryHealthBand: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-5">
          <Select
            label="Parts"
            value={draft.partsStatus}
            options={opts(PARTS)}
            onChange={(e) => patch({ partsStatus: e.target.value })}
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
            options={opts(REPAIR)}
            onChange={(e) => patch({ repairHistory: e.target.value })}
          />
          <Select
            label="Data wipe"
            value={draft.dataWipeStatus}
            options={opts(WIPE)}
            onChange={(e) => patch({ dataWipeStatus: e.target.value })}
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
          options={opts(OEM_WARRANTY)}
          onChange={(e) => patch({ oemWarrantyRemaining: e.target.value })}
        />
        <Select
          label="Returns window you offer"
          value={draft.sellerWarranty}
          options={opts(SELLER_WARRANTY)}
          onChange={(e) => patch({ sellerWarranty: e.target.value })}
        />
        <Select
          label="Where we collect from"
          hint="Drives the inspection visit and the pickup window."
          value={draft.pickupLocationId}
          options={[
            {
              value: '',
              label: facilities.error ? 'Could not load your locations' : 'Choose a location',
            },
            ...(facilities.data ?? []).map((f) => ({
              value: f.addressId,
              label: `${f.label} · ${f.city} ${f.pincode}`,
            })),
          ]}
          onChange={(e) => patch({ pickupLocationId: e.target.value })}
        />
      </div>
    </div>
  );
}
