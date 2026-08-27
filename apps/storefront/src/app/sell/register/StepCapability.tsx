'use client';

import * as React from 'react';
import { Button, Checkbox, Chip, FormSection, Input } from '@trugrade/ui';
import { YesNo } from '../../register/YesNo';
import { SOURCING_CHANNELS, SUPPLY_CATEGORIES } from '../../register/picklists';
import { validateCount } from '../../register/validation';

/**
 * Step 4 — Capability.
 *
 * Everything on this screen is routing data: it decides which stock enquiry
 * reaches which supplier, and it is the first screen in the vendor flow that is
 * about the *business* rather than about proving who they are.
 *
 * Three things here are load-bearing and are not ordinary form fields.
 *
 * **`can_dropship` is required and has no default.** Under the merchant-of-
 * record model the goods move from the vendor to the customer directly and
 * never touch us — we buy the serial at the moment somebody orders it and sell
 * it on our own invoice. A supplier who cannot dispatch direct is therefore a
 * materially different supplier: we would have to take their goods in, which is
 * a different cost base and a different legal posture. The column defaults to
 * `TRUE`, which is exactly why the screen refuses to: a checkbox nobody ticked
 * would assert the commercially convenient answer on their behalf. A "no" is a
 * real answer and does not fail the step — see `YesNo`.
 *
 * **The grade mix is a percentage split and it has to total 100.** A mix that
 * adds to 85 is not a rounding problem, it is fifteen per cent of somebody's
 * stock that nobody has described. Every row also prints its denominator: `20%
 * — 60 of 300 laptops a month`, never a bare `20%`.
 *
 * **The grades come from `GET /public/grades`.** A_PLUS / A / B is a policy
 * decision held in the catalogue, and a supplier being asked to split their
 * stock across a list this file invented is a form that goes stale the day a
 * grade is added.
 */

/* ==========================================================================
 * Draft shape — the column names of `vendor.vendor_capability`
 * ======================================================================== */

export interface CapabilityValues {
  categories: string[];
  brands: string[];
  otherBrands: string;
  /** `monthly_capacity_units`, an `INT NOT NULL`. Held as typed until it is checked. */
  monthlyCapacity: string;
  /** `typical_grade_mix`, grade code → percentage as typed. */
  gradeMix: Record<string, string>;
  priceBandMin: string;
  priceBandMax: string;
  sourcingChannels: string[];
  /** `can_provide_serials_upfront`. Null until answered — the column defaults true. */
  canProvideSerialsUpfront: boolean | null;
  hasInhouseTesting: boolean;
  hasInhouseRepair: boolean;
  leadTimeDays: string;
  /** `can_dropship`. Null until answered. Required. */
  canDropship: boolean | null;
}

const EMPTY: CapabilityValues = {
  categories: [],
  brands: [],
  otherBrands: '',
  monthlyCapacity: '',
  gradeMix: {},
  priceBandMin: '',
  priceBandMax: '',
  sourcingChannels: [],
  canProvideSerialsUpfront: null,
  hasInhouseTesting: false,
  hasInhouseRepair: false,
  leadTimeDays: '',
  canDropship: null,
};

/** `A_PLUS` → `A+`. The catalogue's code is what a draft stores. */
export const gradeLabel = (code: string): string => code.replace('_PLUS', '+').replace(/_/g, ' ');

export function readCapabilityDraft(
  answers: Record<string, unknown>,
  /** Step 1's brands, used only when this step has never been saved. */
  brandsFromStepOne: readonly string[] = [],
  otherBrandsFromStepOne = '',
): CapabilityValues {
  const str = (key: string): string =>
    typeof answers[key] === 'string' ? (answers[key] as string) : '';
  const list = (key: string): string[] =>
    Array.isArray(answers[key]) ? (answers[key] as string[]) : [];
  const mix =
    answers.gradeMix && typeof answers.gradeMix === 'object'
      ? Object.fromEntries(
          Object.entries(answers.gradeMix as Record<string, unknown>).map(([g, v]) => [
            g,
            String(v ?? ''),
          ]),
        )
      : {};
  const bool = (key: string): boolean | null =>
    typeof answers[key] === 'boolean' ? (answers[key] as boolean) : null;
  const started = Object.keys(answers).length > 0;

  return {
    ...EMPTY,
    categories: list('categories'),
    // Carried, not invented: these are the applicant's own answer from step 1,
    // and the screen says where they came from. Once this step has a draft of
    // its own, that draft wins — including an empty one, which is a supplier
    // who deliberately removed a brand.
    brands: started ? list('brands') : [...brandsFromStepOne],
    otherBrands: started ? str('otherBrands') : otherBrandsFromStepOne,
    monthlyCapacity: str('monthlyCapacity'),
    gradeMix: mix,
    priceBandMin: str('priceBandMin'),
    priceBandMax: str('priceBandMax'),
    sourcingChannels: list('sourcingChannels'),
    canProvideSerialsUpfront: bool('canProvideSerialsUpfront'),
    hasInhouseTesting: answers.hasInhouseTesting === true,
    hasInhouseRepair: answers.hasInhouseRepair === true,
    leadTimeDays: str('leadTimeDays'),
    canDropship: bool('canDropship'),
  };
}

const toDraft = (values: CapabilityValues): Record<string, unknown> => ({ ...values });

/* ==========================================================================
 * Derived numbers
 * ======================================================================== */

const asNumber = (value: string): number | null =>
  /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;

const CAPACITY_RULE = {
  required: true,
  min: 1,
  max: 100000,
  unit: 'laptops',
  missing:
    'Tell us how many laptops a month you can actually supply. An honest number sizes the enquiries we send you — it is not a commitment.',
};

const LEAD_TIME_RULE = {
  required: true,
  min: 0,
  max: 60,
  unit: 'days',
  missing:
    'Tell us how many days from a purchase order to the machine leaving your dock. Zero is a real answer if you ship same day.',
};

/**
 * Summed over the grades the catalogue currently defines, not over every key in
 * the draft: a grade that was retired after a draft was saved would otherwise
 * keep contributing to a total nobody can see a row for.
 */
export const gradeMixTotal = (mix: Record<string, string>, grades: readonly string[]): number =>
  grades.reduce((sum, grade) => sum + (asNumber(mix[grade] ?? '') ?? 0), 0);

/** Answered at all, and adding to exactly 100. Both, or the split says nothing. */
const gradeMixDone = (mix: Record<string, string>, grades: readonly string[]): boolean =>
  grades.length > 0 &&
  grades.some((g) => (asNumber(mix[g] ?? '') ?? 0) > 0) &&
  gradeMixTotal(mix, grades) === 100;

const checksOf = (values: CapabilityValues, grades: readonly string[]): boolean[] => [
  values.categories.length > 0,
  validateCount(values.monthlyCapacity, CAPACITY_RULE) === undefined &&
    values.monthlyCapacity.trim().length > 0,
  // A catalogue that did not answer cannot be a gate on their application.
  grades.length === 0 || gradeMixDone(values.gradeMix, grades),
  values.sourcingChannels.length > 0,
  values.canProvideSerialsUpfront !== null,
  validateCount(values.leadTimeDays, LEAD_TIME_RULE) === undefined &&
    values.leadTimeDays.trim().length > 0,
  values.canDropship !== null,
];

export const completionOf = (values: CapabilityValues, grades: readonly string[]): number => {
  const checks = checksOf(values, grades);
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

/* ==========================================================================
 * The step
 * ======================================================================== */

export interface StepCapabilityProps {
  answers: Record<string, unknown>;
  /** The catalogue's brands. Empty when `GET /public/brands` did not answer. */
  brands: readonly string[];
  /** The catalogue's grades, in its own order. Empty when it did not answer. */
  grades: readonly { grade: string; customerDescription: string }[];
  /** Step 1's answers, so the brands are not asked from scratch a second time. */
  brandsFromStepOne: readonly string[];
  otherBrandsFromStepOne: string;
  onSaveDraft: (values: Record<string, unknown>, completionPct: number) => void;
  onContinue: (
    values: Record<string, unknown>,
    completionPct: number,
  ) => Promise<Record<string, string> | null>;
  busy: boolean;
  onFieldFocus: (term: string) => void;
  blockingReason?: string | null;
}

export function StepCapability({
  answers,
  brands,
  grades,
  brandsFromStepOne,
  otherBrandsFromStepOne,
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
}: StepCapabilityProps): React.JSX.Element {
  const [values, setValues] = React.useState<CapabilityValues>(() =>
    readCapabilityDraft(answers, brandsFromStepOne, otherBrandsFromStepOne),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const gradeCodes = React.useMemo(() => grades.map((g) => g.grade), [grades]);

  const set = <K extends keyof CapabilityValues>(key: K, value: CapabilityValues[K]): void => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors(({ [key as string]: _dropped, ...rest }) => rest);
  };

  const persist = (next: CapabilityValues): void =>
    onSaveDraft(toDraft(next), completionOf(next, gradeCodes));

  /** Blur, not keystroke: one row per pause, not one per character. */
  const saveOnBlur = (): void => persist(values);

  /**
   * A control with no blur of its own — a chip, a checkbox, a radio — writes
   * through the moment it changes. A toggle that is only saved on the *next*
   * field's blur is a toggle that silently loses its answer when the tab closes,
   * and on this step that toggle is `can_dropship`.
   */
  const setAndSave = <K extends keyof CapabilityValues>(
    key: K,
    value: CapabilityValues[K],
  ): void => {
    const next = { ...values, [key]: value };
    setValues(next);
    setErrors(({ [key as string]: _dropped, ...rest }) => rest);
    persist(next);
  };

  const toggleIn = (key: 'categories' | 'brands' | 'sourcingChannels', code: string): void =>
    setAndSave(
      key,
      values[key].includes(code) ? values[key].filter((c) => c !== code) : [...values[key], code],
    );

  const setGrade = (grade: string, pct: string): void => {
    setValues((v) => ({ ...v, gradeMix: { ...v.gradeMix, [grade]: pct } }));
    setErrors(({ gradeMix: _dropped, ...rest }) => rest);
  };

  /* ------------------------------------------------------------ validation */

  const check = (v: CapabilityValues): Record<string, string> => {
    const found: Record<string, string> = {};

    if (v.categories.length === 0)
      found.categories =
        'Pick at least one category. This is what decides which stock enquiries reach you.';

    const capacity = validateCount(v.monthlyCapacity, CAPACITY_RULE);
    if (capacity) found.monthlyCapacity = capacity;

    if (gradeCodes.length > 0) {
      const total = gradeMixTotal(v.gradeMix, gradeCodes);
      const bad = gradeCodes.find((g) => {
        const raw = (v.gradeMix[g] ?? '').trim();
        return raw.length > 0 && asNumber(raw) === null;
      });
      if (bad)
        found.gradeMix = `Enter ${gradeLabel(bad)} as a whole percentage — 20, not 20.5 or "a fifth".`;
      else if (total === 0)
        found.gradeMix =
          'Split your stock across the grades. If everything you sell is one grade, put 100 against it.';
      else if (total !== 100)
        found.gradeMix =
          total < 100
            ? `The split adds up to ${total}% of 100%. ${100 - total}% of your stock is not described — adjust the rows until they total 100%.`
            : `The split adds up to ${total}% of 100%, which is ${total - 100}% more stock than you have. Adjust the rows until they total 100%.`;
    }

    const min = v.priceBandMin.trim();
    const max = v.priceBandMax.trim();
    for (const [key, raw] of [
      ['priceBandMin', min],
      ['priceBandMax', max],
    ] as const) {
      if (raw.length > 0 && !/^\d+$/.test(raw))
        found[key] = 'Enter whole rupees — 18000, with no comma and no paise.';
    }
    if (!found.priceBandMin && !found.priceBandMax) {
      if (min.length > 0 && max.length === 0)
        found.priceBandMax = 'Give the top of the band too, so the pair means something.';
      if (max.length > 0 && min.length === 0)
        found.priceBandMin = 'Give the bottom of the band too, so the pair means something.';
      if (min.length > 0 && max.length > 0 && Number(min) >= Number(max))
        found.priceBandMax = 'The top of the band has to be more than the bottom.';
    }

    if (v.sourcingChannels.length === 0)
      found.sourcingChannels =
        'Tell us where your stock comes from — at least one. A buy-back lot and an auction lot carry different paperwork, and we underwrite them differently.';

    if (v.canProvideSerialsUpfront === null)
      found.canProvideSerialsUpfront =
        'Answer this either way. We sell a named machine by its serial, so whether you can give us serials before dispatch changes how your stock is listed.';

    const leadTime = validateCount(v.leadTimeDays, LEAD_TIME_RULE);
    if (leadTime) found.leadTimeDays = leadTime;

    if (v.canDropship === null)
      found.canDropship =
        'Answer this one either way. A “no” is a real answer and does not stop your application — it changes how we work with you, so we need it before a reviewer sees this.';

    return found;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found = check(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const refusal = await onContinue(toDraft(values), 100);
    if (refusal) setErrors(refusal);
  };

  /* ----------------------------------------------------------------- view */

  const capacity = asNumber(values.monthlyCapacity);
  const mixTotal = gradeMixTotal(values.gradeMix, gradeCodes);
  const namedBrands = values.brands.length + (values.otherBrands.trim().length > 0 ? 1 : 0);

  /**
   * `20%` of `300` reads `20% — 60 of 300 laptops a month`, never a bare
   * percentage. A share nobody has given reads "Not provided", never a dash
   * beside a number that would look like a zero.
   */
  const shareOf = (grade: string): React.ReactNode => {
    const raw = (values.gradeMix[grade] ?? '').trim();
    if (raw === '') return <span className="text-ink-4">Not provided.</span>;
    const value = asNumber(raw);
    if (value === null || capacity === null)
      return (
        <>
          <span className="font-mono tnum text-ink">{raw}%</span> —{' '}
          <span className="text-ink-4">
            units not known until you give a monthly capacity above.
          </span>
        </>
      );
    return (
      <>
        <span className="font-mono tnum text-ink">{value}%</span> —{' '}
        <span className="font-mono tnum text-ink">{Math.round((capacity * value) / 100)}</span> of{' '}
        <span className="font-mono tnum text-ink">{capacity}</span> laptops a month.
      </>
    );
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)} noValidate>
      {blockingReason && (
        <p
          role="alert"
          className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail"
        >
          {blockingReason}
        </p>
      )}

      {/* ------------------------------------------------------- categories */}
      <FormSection
        title="What you supply"
        description="Pick every category you regularly hold. It is a routing hint, not a restriction — you can list anything you actually have."
        status={
          <>
            <span className="tnum">{values.categories.length}</span> of{' '}
            <span className="tnum">{SUPPLY_CATEGORIES.length}</span> categories
          </>
        }
      >
        <div
          role="group"
          aria-label="Categories you supply"
          aria-describedby={errors.categories ? 'categories-error' : undefined}
          className="flex flex-col gap-2"
          onFocus={() => onFieldFocus('Capability')}
        >
          {SUPPLY_CATEGORIES.map((category) => (
            <div key={category.code} className="flex flex-wrap items-baseline gap-3">
              <Chip
                label={category.label}
                selected={values.categories.includes(category.code)}
                onToggle={() => toggleIn('categories', category.code)}
              />
              <span className="text-body-sm text-ink-3">{category.note}</span>
            </div>
          ))}
        </div>
        {errors.categories && (
          <p id="categories-error" role="alert" className="text-body-sm text-fail">
            {errors.categories}
          </p>
        )}
      </FormSection>

      {/* ----------------------------------------------------------- brands */}
      <FormSection
        title="Brands you deal in"
        description="Carried over from what you told us on step 1. Change it here if it is not right — this is the copy that routes enquiries."
        status={
          <>
            <span className="tnum">{namedBrands}</span> {namedBrands === 1 ? 'brand' : 'brands'}{' '}
            named
          </>
        }
      >
        {brands.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Brands you deal in"
            onFocus={() => onFieldFocus('Capability')}
          >
            {brands.map((brand) => (
              <Chip
                key={brand}
                label={brand}
                selected={values.brands.includes(brand)}
                onToggle={() => toggleIn('brands', brand)}
              />
            ))}
          </div>
        ) : (
          // Never fabricate data on a screen: with no answer from the catalogue
          // there are no brands to offer, and the free-text box below is the
          // whole of this question rather than a list somebody typed here once.
          <p className="text-body-sm text-ink-4">
            We could not load the brand list just now. Type the brands you deal in below and we will
            match them up.
          </p>
        )}
        <Input
          label="Any other brands"
          hint="Optional. Comma-separated — anything not in the list above."
          value={values.otherBrands}
          onFocus={() => onFieldFocus('Capability')}
          onBlur={saveOnBlur}
          onChange={(e) => set('otherBrands', e.target.value)}
        />
      </FormSection>

      {/* --------------------------------------------------- volume and mix */}
      <FormSection
        title="How much, and of what quality"
        description="The capacity sizes the enquiries we send you. The grade mix is what a buyer sees before they ever see a specific machine."
      >
        <Input
          label="Laptops you can supply in a month"
          mono
          inputMode="numeric"
          required
          hint="Your real, sustainable number. It sizes enquiries; it commits you to nothing."
          value={values.monthlyCapacity}
          onFocus={() => onFieldFocus('Monthly capacity')}
          onBlur={saveOnBlur}
          onChange={(e) => set('monthlyCapacity', e.target.value)}
          error={errors.monthlyCapacity}
        />

        <div
          role="group"
          aria-label="Typical grade mix"
          aria-describedby="grade-mix-total"
          className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-4"
        >
          <p className="text-body-sm text-ink-2">
            Roughly how your stock splits across our grades. It has to total{' '}
            <span className="font-mono tnum">100%</span>.
          </p>
          {grades.length === 0 ? (
            // The grade list is a policy decision held in the catalogue. With no
            // answer from it there is nothing honest to split stock across, so
            // the question is stood down rather than asked against a guess.
            <p className="text-body-sm text-ink-4">
              We could not load the grade definitions just now, so we are not asking you to split
              your stock yet. Your reviewer will pick this up.
            </p>
          ) : (
            grades.map((grade) => (
              <div key={grade.grade} className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-start">
                <Input
                  // Grades are neutral: A+, A and B are all sellable, and
                  // nothing here is coloured by which one it is.
                  label={`Grade ${gradeLabel(grade.grade)}`}
                  mono
                  inputMode="numeric"
                  maxLength={3}
                  value={values.gradeMix[grade.grade] ?? ''}
                  onFocus={() => onFieldFocus('Grade mix')}
                  onBlur={saveOnBlur}
                  onChange={(e) => setGrade(grade.grade, e.target.value)}
                />
                <p className="text-body-sm text-ink-2 sm:pt-8">
                  {shareOf(grade.grade)}{' '}
                  <span className="text-ink-3">{grade.customerDescription}</span>
                </p>
              </div>
            ))
          )}
          {grades.length > 0 && (
            <p id="grade-mix-total" className="text-body-sm text-ink-2">
              Total <span className="font-mono tnum text-ink">{mixTotal}%</span> of{' '}
              <span className="font-mono tnum text-ink">100%</span>
              {capacity !== null && (
                <>
                  {' '}
                  —{' '}
                  <span className="font-mono tnum text-ink">
                    {Math.round((capacity * mixTotal) / 100)}
                  </span>{' '}
                  of <span className="font-mono tnum text-ink">{capacity}</span> laptops a month
                </>
              )}
              .
            </p>
          )}
          {errors.gradeMix && (
            <p role="alert" className="text-body-sm text-fail">
              {errors.gradeMix}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Typical price, lowest"
            mono
            inputMode="numeric"
            hint="Optional. Whole rupees per machine, as you would sell it to us."
            value={values.priceBandMin}
            onFocus={() => onFieldFocus('Capability')}
            onBlur={saveOnBlur}
            onChange={(e) => set('priceBandMin', e.target.value)}
            error={errors.priceBandMin}
          />
          <Input
            label="Typical price, highest"
            mono
            inputMode="numeric"
            hint="Optional. The top of the band, not your best-ever sale."
            value={values.priceBandMax}
            onFocus={() => onFieldFocus('Capability')}
            onBlur={saveOnBlur}
            onChange={(e) => set('priceBandMax', e.target.value)}
            error={errors.priceBandMax}
          />
        </div>
        {values.priceBandMin.trim() === '' && values.priceBandMax.trim() === '' && (
          <p className="text-body-sm text-ink-4">Price band not provided.</p>
        )}
      </FormSection>

      {/* --------------------------------------------------------- sourcing */}
      <FormSection
        title="Where your stock comes from"
        description="Tick every channel you actually use. A corporate buy-back arrives with an asset register and a wipe obligation; an auction lot arrives with neither, and we underwrite the two differently."
        status={
          <>
            <span className="tnum">{values.sourcingChannels.length}</span> of{' '}
            <span className="tnum">{SOURCING_CHANNELS.length}</span> ticked
          </>
        }
      >
        <div
          role="group"
          aria-label="Sourcing channels"
          aria-describedby={errors.sourcingChannels ? 'sourcing-error' : undefined}
          className="flex flex-col gap-3"
          onFocus={() => onFieldFocus('Capability')}
        >
          {SOURCING_CHANNELS.map((channel) => (
            <Checkbox
              key={channel.code}
              label={channel.label}
              consequence={channel.note}
              checked={values.sourcingChannels.includes(channel.code)}
              onChange={() => toggleIn('sourcingChannels', channel.code)}
            />
          ))}
        </div>
        {errors.sourcingChannels && (
          <p id="sourcing-error" role="alert" className="text-body-sm text-fail">
            {errors.sourcingChannels}
          </p>
        )}
      </FormSection>

      {/* -------------------------------------------------------- what you do */}
      <FormSection
        title="What you do to a machine before it ships"
        description="None of these is required to sell with us. What they change is how much of our own QC a unit needs and how fast it can be listed."
      >
        <Checkbox
          label="We test in-house"
          consequence="Battery, keyboard, display and ports checked before the machine is offered. Our own QC still runs — this decides how much of it."
          checked={values.hasInhouseTesting}
          onChange={(v) => setAndSave('hasInhouseTesting', v)}
        />
        <Checkbox
          label="We repair in-house"
          consequence="Screens, keyboards and batteries replaced on site rather than sent out. It is what lets us route a repairable unit back to you instead of grading it down."
          checked={values.hasInhouseRepair}
          onChange={(v) => setAndSave('hasInhouseRepair', v)}
        />

        <YesNo
          legend="Can you give us serial numbers before the machine ships?"
          name="serials-upfront"
          required
          value={values.canProvideSerialsUpfront}
          onChange={(v) => setAndSave('canProvideSerialsUpfront', v)}
          onFocus={() => onFieldFocus('Serial numbers')}
          description="We sell a named machine, by its serial, with its own inspection report. The serial is what a buyer scans on arrival."
          yesLabel="Yes — we can send serials with the offer"
          noLabel="No — serials only at dispatch"
          yesConsequence="Your stock can be listed unit by unit, with a passport page and a certificate per machine."
          noConsequence="Your stock is listed as a pool and the serial is attached at dispatch. It sells, but a buyer cannot inspect the exact machine before ordering it."
          error={errors.canProvideSerialsUpfront}
        />

        <Input
          label="Lead time, in days"
          mono
          inputMode="numeric"
          required
          hint="From our purchase order to the machine leaving your dock. It becomes the dispatch promise on your listings."
          value={values.leadTimeDays}
          onFocus={() => onFieldFocus('Capability')}
          onBlur={saveOnBlur}
          onChange={(e) => set('leadTimeDays', e.target.value)}
          error={errors.leadTimeDays}
        />
      </FormSection>

      {/* -------------------------------------------------------- dropship */}
      <FormSection
        title="Dispatching direct to the customer"
        description="We are the seller on the invoice, but we never hold the goods: when a customer orders, we buy that machine from you and it travels from your dock to theirs. This one answer decides whether that works."
      >
        <YesNo
          legend="Can you dispatch directly to our customer?"
          name="can-dropship"
          required
          value={values.canDropship}
          onChange={(v) => setAndSave('canDropship', v)}
          onFocus={() => onFieldFocus('Dispatching direct')}
          yesLabel="Yes — we pack and hand over to the carrier"
          noLabel="No — we cannot dispatch to a third party"
          yesConsequence="Standard. You get the purchase order, the pick list and the customer's delivery address in our packaging; the e-way bill is raised from your dispatch address."
          noConsequence="That is a real answer and it does not stop your application. It does mean we would have to take your goods in before selling them, which is a different arrangement — an account manager will go through it with you before you are approved."
          error={errors.canDropship}
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
        <Button type="submit" variant="primary" loading={busy}>
          Save and continue
        </Button>
        <Button type="button" variant="ghost" onClick={saveOnBlur}>
          Save and finish later
        </Button>
      </div>
    </form>
  );
}
