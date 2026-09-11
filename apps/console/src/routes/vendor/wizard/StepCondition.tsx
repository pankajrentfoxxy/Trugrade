import * as React from 'react';
import { GradeBadge, Input, Modal, RepresentativeImage, Skeleton, cn } from '@trugrade/ui';
import { GRADES, type Grade } from '@trugrade/contracts';
import { Select } from '../../../lib/controls';
import { useResource } from '../../../lib/useResource';
import {
  API,
  gradeLabel,
  type GradeDefinition,
  type ResolvedGradeImages,
  type VendorFacility,
  type VendorOfferedGrades,
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
  const offered = useResource<VendorOfferedGrades>(
    API.offeredGrades,
    'Offered grades unavailable',
  );
  const byGrade = new Map((data ?? []).map((d) => [d.grade, d]));

  /**
   * Only the grades they ticked at registration. A malformed or missing
   * payload falls back to every platform grade so a demo org, or a capability
   * step completed before this question existed, can still list.
   */
  const visible: Grade[] = React.useMemo(() => {
    const raw = offered.data;
    if (!raw || !Array.isArray(raw.offeredGrades)) return [...GRADES];
    const picked = raw.offeredGrades.filter((g): g is Grade =>
      (GRADES as readonly string[]).includes(g),
    );
    return picked.length > 0 ? picked : [...GRADES];
  }, [offered.data]);

  React.useEffect(() => {
    if (visible.includes(value)) return;
    const next = visible[0];
    if (next) onChange(next);
  }, [visible, value, onChange]);

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
      <legend className="text-label font-medium text-ink-2">Grade</legend>
      <div className="mt-3 flex flex-wrap justify-center gap-3">
        {visible.map((g) => (
          <label
            key={g}
            className={cn(
              'flex w-[15.5rem] cursor-pointer flex-col items-center gap-2 rounded border p-3 text-center transition-colors',
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
              className="sr-only"
            />
            <GradeBadge grade={g} variant="declared" className="px-2 py-0.5 text-label" />
            {error ? (
              <span className="text-label text-ink-2">
                We could not load the definition for Grade {gradeLabel(g)}. Grade from the
                photographs in the grading policy rather than from memory.
              </span>
            ) : !data ? (
              <Skeleton lines={2} />
            ) : (
              <>
                <span className="text-label leading-snug text-ink-2">
                  {byGrade.get(g)?.customerDescription ??
                    'No published definition for this grade yet.'}
                </span>
                {byGrade.get(g) && (
                  <span className="flex flex-col gap-0.5 font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                    <span>
                      Battery{' '}
                      <span className="tnum text-ink-2">
                        {byGrade.get(g)?.minBatteryHealthPct}%
                      </span>{' '}
                      or better
                    </span>
                    <span>
                      Cosmetic{' '}
                      <span className="tnum text-ink-2">{byGrade.get(g)?.minCosmeticScore}</span> of
                      100
                    </span>
                    {byGrade.get(g)?.maxCycleCount === null ? (
                      <span className="text-ink-4">Cycles not capped</span>
                    ) : (
                      <span>
                        Cycles under{' '}
                        <span className="tnum text-ink-2">{byGrade.get(g)?.maxCycleCount}</span>
                      </span>
                    )}
                  </span>
                )}
              </>
            )}
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

function GradeReference({ skuId, grade }: { skuId: string; grade: Grade }): React.JSX.Element | null {
  const { data } = useResource<{ images: ResolvedGradeImages | null }>(
    API.skuImages(skuId, grade),
    'Reference photographs unavailable',
  );
  const [openId, setOpenId] = React.useState<string | null>(null);
  const resolved = data?.images ?? null;
  const images =
    resolved && resolved.match !== 'PLACEHOLDER' ? resolved.images : [];
  const open = images.find((image) => image.id === openId) ?? null;

  if (images.length === 0 || !resolved) return null;

  return (
    <>
      <div className="mt-4 flex flex-nowrap justify-center gap-2 px-2">
        {images.map((image) => (
          <button
            key={image.id}
            type="button"
            onClick={() => setOpenId(image.id)}
            aria-label="View photograph"
            className="min-w-0 max-w-[7rem] flex-1 basis-0 cursor-zoom-in rounded-md text-left"
          >
            <RepresentativeImage
              className="pointer-events-none w-full [&_figcaption]:sr-only [&_img]:aspect-[3/2] [&_img]:object-cover"
              src={image.url}
              alt={image.altText}
              grade={grade}
              match={resolved.match}
            />
          </button>
        ))}
      </div>
      <Modal
        open={open !== null}
        onClose={() => setOpenId(null)}
        title="Photograph"
        size="lg"
        className="[&_h2]:sr-only"
      >
        {open ? (
          <img
            src={open.url}
            alt=""
            className="w-full rounded-lg border border-rule bg-sheet object-contain"
          />
        ) : null}
      </Modal>
    </>
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
      <GradePicker
        value={draft.grade}
        batteryBand={draft.batteryHealthBand}
        onChange={(grade) => patch({ grade })}
      />

      {draft.sku && <GradeReference skuId={draft.sku.skuId} grade={draft.grade} />}

      <div className="wizard-form-card">
        <h3>Tell us more about the condition</h3>

        <div className="grid gap-x-7 gap-y-5 md:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Select
              label="Condition"
              hint="Overall condition type — like new, refurbished, or used."
              value={draft.conditionType}
              options={opts(CONDITION)}
              onChange={(e) => patch({ conditionType: e.target.value })}
            />
            <Select
              label="Functional status"
              hint="Does everything work as expected?"
              value={draft.functionalStatus}
              options={opts(FUNCTIONAL)}
              onChange={(e) => patch({ functionalStatus: e.target.value })}
            />
            <Select
              label="Repair history"
              hint="Any previous repairs or replacements?"
              value={draft.repairHistory}
              options={opts(REPAIR)}
              onChange={(e) => patch({ repairHistory: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-5">
            <Select
              label="Parts"
              hint="Are all parts original and intact?"
              value={draft.partsStatus}
              options={opts(PARTS)}
              onChange={(e) => patch({ partsStatus: e.target.value })}
            />
            <Select
              label="Battery health"
              hint="A band, not a number — the inspection measures the number."
              value={draft.batteryHealthBand}
              options={opts(BATTERY)}
              onChange={(e) => patch({ batteryHealthBand: e.target.value })}
            />
            <Select
              label="Data wipe"
              hint="Has the device been securely wiped?"
              value={draft.dataWipeStatus}
              options={opts(WIPE)}
              onChange={(e) => patch({ dataWipeStatus: e.target.value })}
            />
          </div>
        </div>

        <hr className="wizard-form-divider" />

        <div className="grid gap-x-7 gap-y-5 md:grid-cols-2">
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

        <hr className="wizard-form-divider" />

        <h4>The warranty you will stand behind</h4>

        {/* Both warranty sentences Task 3 step 2 names. The second one is the
            incentive, so it says where the vendor will see the effect. */}
        <p className="mb-5 max-w-prose text-body-sm text-ink-2">
          We sell the customer a <strong>longer total term than you offer</strong> and fund the
          difference ourselves — so what the buyer sees is not what you are committing to here. A{' '}
          <strong>longer term from you earns you a better price</strong>, because it costs us less to
          top up. Change the months below and watch the payout move on step 4.
        </p>

        <div className="grid gap-x-7 gap-y-5 md:grid-cols-2">
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
            hint="OEM warranty still in effect, if any."
            value={draft.oemWarrantyRemaining}
            options={opts(OEM_WARRANTY)}
            onChange={(e) => patch({ oemWarrantyRemaining: e.target.value })}
          />
          <Select
            label="Returns window you offer"
            hint="How long a buyer can return under your policy."
            value={draft.sellerWarranty}
            options={opts(SELLER_WARRANTY)}
            onChange={(e) => patch({ sellerWarranty: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
