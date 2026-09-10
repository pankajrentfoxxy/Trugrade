'use client';

import * as React from 'react';
import { Button, Checkbox, Chip, FormSection, Input } from '@trugrade/ui';
import { Select } from '../../../lib/controls';
import { LEAD_TIME_HOURS, SOURCING_CHANNELS, SUPPLY_CATEGORIES } from '../../register/picklists';
import { blockNonDigitKey, typeDigitsOnly } from '../../register/validation';

/** Parenthetical note on the label row instead of a second line under the field. */
const labelNote = (text: string, note: string): React.ReactNode => (
  <>
    {text}{' '}
    <span className="text-label font-normal text-ink-3">({note})</span>
  </>
);

/**
 * Step 4 — Capability.
 *
 * Everything on this screen is routing data: it decides which stock enquiry
 * reaches which supplier, and it is the first screen in the vendor flow that is
 * about the *business* rather than about proving who they are.
 *
 * Two things here are load-bearing and are not ordinary form fields.
 *
 * **The grade mix is a percentage split and it has to total 100.** A mix that
 * adds to 85 is not a rounding problem, it is fifteen per cent of somebody's
 * stock that nobody has described. Every percentage carries its denominator:
 * `20% of 100%`, never a bare `20%`.
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
  /** `typical_grade_mix`, grade code → percentage as typed. */
  gradeMix: Record<string, string>;
  sourcingChannels: string[];
  /** `can_provide_serials_upfront`. Null until answered — the column defaults true. */
  canProvideSerialsUpfront: boolean | null;
  hasInhouseTesting: boolean;
  hasInhouseRepair: boolean;
  leadTimeDays: string;
}

const EMPTY: CapabilityValues = {
  categories: [],
  brands: [],
  otherBrands: '',
  gradeMix: {},
  sourcingChannels: [],
  canProvideSerialsUpfront: null,
  hasInhouseTesting: false,
  hasInhouseRepair: false,
  leadTimeDays: '',
};

/** `A_PLUS` → `A+`. The catalogue's code is what a draft stores. */
export const gradeLabel = (code: string): string => code.replace('_PLUS', '+').replace(/_/g, ' ');

export function readCapabilityDraft(answers: Record<string, unknown>): CapabilityValues {
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

  return {
    ...EMPTY,
    categories: list('categories').filter((code) => code !== 'WORKSTATION'),
    brands: list('brands'),
    otherBrands: str('otherBrands'),
    gradeMix: mix,
    sourcingChannels: list('sourcingChannels'),
    canProvideSerialsUpfront: bool('canProvideSerialsUpfront'),
    hasInhouseTesting: answers.hasInhouseTesting === true,
    hasInhouseRepair: answers.hasInhouseRepair === true,
    leadTimeDays: str('leadTimeDays'),
  };
}

const toDraft = (values: CapabilityValues): Record<string, unknown> => ({ ...values });

/* ==========================================================================
 * Derived numbers
 * ======================================================================== */

const asNumber = (value: string): number | null =>
  /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;

const LEAD_TIME_VALUES = new Set(LEAD_TIME_HOURS.map((o) => o.value).filter(Boolean));

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
  // A catalogue that did not answer cannot be a gate on their application.
  grades.length === 0 || gradeMixDone(values.gradeMix, grades),
  LEAD_TIME_VALUES.has(values.leadTimeDays),
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
  onSaveDraft: (values: Record<string, unknown>, completionPct: number) => void;
  onContinue: (
    values: Record<string, unknown>,
    completionPct: number,
  ) => Promise<Record<string, string> | null>;
  busy: boolean;
  onFieldFocus: (term: string) => void;
  blockingReason?: string | null;
  skipValidation?: boolean;
}

export function StepCapability({
  answers,
  brands,
  grades,
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
  skipValidation = false,
}: StepCapabilityProps): React.JSX.Element {
  const [values, setValues] = React.useState<CapabilityValues>(() => readCapabilityDraft(answers));
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
   * and on this step that toggle is a brand chip or a sourcing checkbox.
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
    setValues((v) => ({ ...v, gradeMix: { ...v.gradeMix, [grade]: typeDigitsOnly(pct) } }));
    setErrors(({ gradeMix: _dropped, ...rest }) => rest);
  };

  /* ------------------------------------------------------------ validation */

  const check = (v: CapabilityValues): Record<string, string> => {
    const found: Record<string, string> = {};

    const namedBrands = v.brands.length + (v.otherBrands.trim().length > 0 ? 1 : 0);
    if (namedBrands === 0)
      found.brands =
        'Tell us at least one brand you deal in — pick from the list, or type the others in the box below.';

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

    if (!LEAD_TIME_VALUES.has(v.leadTimeDays))
      found.leadTimeDays =
        'Choose how many hours from our purchase order to the machine leaving your dock.';

    return found;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found = skipValidation ? {} : check(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const refusal = await onContinue(toDraft(values), 100);
    if (refusal) setErrors(refusal);
  };

  /* ----------------------------------------------------------------- view */

  const mixTotal = gradeMixTotal(values.gradeMix, gradeCodes);
  const namedBrands = values.brands.length + (values.otherBrands.trim().length > 0 ? 1 : 0);

  /**
   * A share nobody has given reads "Not provided", never a dash beside a number
   * that would look like a zero.
   */
  const shareOf = (grade: string): React.ReactNode => {
    const raw = (values.gradeMix[grade] ?? '').trim();
    if (raw === '') return <span className="text-ink-4">Not provided.</span>;
    const value = asNumber(raw);
    if (value === null)
      return <span className="font-mono tnum text-ink">{raw}%</span>;
    return (
      <>
        <span className="font-mono tnum text-ink">{value}%</span> of{' '}
        <span className="font-mono tnum text-ink">100%</span>
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
        title="(optional) What you supply"
        status={
          <span className="normal-case tracking-normal text-acc-ink">
            <span className="tnum">{values.categories.length}</span> of{' '}
            <span className="tnum">{SUPPLY_CATEGORIES.length}</span> selected
          </span>
        }
      >
        <ol
          role="group"
          aria-label="Categories you supply"
          aria-describedby={errors.categories ? 'categories-error' : undefined}
          className="flex list-none flex-col gap-3 p-0"
          onFocus={() => onFieldFocus('Capability')}
        >
          {SUPPLY_CATEGORIES.map((category) => (
            <li key={category.code}>
              <Checkbox
                label={labelNote(category.label, category.note)}
                checked={values.categories.includes(category.code)}
                onChange={() => toggleIn('categories', category.code)}
              />
            </li>
          ))}
        </ol>
        {errors.categories && (
          <p id="categories-error" role="alert" className="text-body-sm text-fail">
            {errors.categories}
          </p>
        )}
      </FormSection>

      {/* ----------------------------------------------------------- brands */}
      <FormSection
        title="Brands you deal in"
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
            aria-describedby={errors.brands ? 'brands-error' : undefined}
            onFocus={() => onFieldFocus('Capability')}
          >
            <Chip
              label="All"
              selected={brands.length > 0 && brands.every((b) => values.brands.includes(b))}
              onToggle={() =>
                setAndSave(
                  'brands',
                  brands.every((b) => values.brands.includes(b)) ? [] : [...brands],
                )
              }
            />
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
        {errors.brands && (
          <p id="brands-error" role="alert" className="text-body-sm text-fail">
            {errors.brands}
          </p>
        )}
        <Input
          label={labelNote(
            'Any other brands (optional)',
            'Comma-separated — anything not in the list above.',
          )}
          value={values.otherBrands}
          onFocus={() => onFieldFocus('Capability')}
          onBlur={saveOnBlur}
          onChange={(e) => {
            set('otherBrands', e.target.value);
            setErrors(({ brands: _dropped, ...rest }) => rest);
          }}
        />
      </FormSection>

      {/* --------------------------------------------------- volume and mix */}
      <FormSection title="Typical grade mix">
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
            grades.map((grade) => {
              const inputId = `grade-mix-${grade.grade}`;
              return (
                <div
                  key={grade.grade}
                  className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-2"
                >
                  <label
                    htmlFor={inputId}
                    className="text-body-sm font-medium text-ink-2 sm:col-start-1 sm:row-start-1"
                  >
                    Grade {gradeLabel(grade.grade)}
                  </label>
                  <input
                    id={inputId}
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    autoComplete="off"
                    value={values.gradeMix[grade.grade] ?? ''}
                    onFocus={() => onFieldFocus('Grade mix')}
                    onBlur={saveOnBlur}
                    onKeyDown={blockNonDigitKey}
                    onChange={(e) => setGrade(grade.grade, e.target.value)}
                    className="h-11 w-full rounded border border-rule bg-sheet px-4 font-mono text-body-sm tnum text-ink placeholder:text-ink-3 transition-colors sm:col-start-1 sm:row-start-2"
                  />
                  <p className="text-label leading-relaxed text-ink-3 sm:col-start-2 sm:row-start-2 sm:self-center">
                    {shareOf(grade.grade)}{' '}
                    <span className="text-ink-4">{grade.customerDescription}</span>
                  </p>
                </div>
              );
            })
          )}
          {grades.length > 0 && (
            <p id="grade-mix-total" className="text-body-sm text-ink-2">
              Total <span className="font-mono tnum text-ink">{mixTotal}%</span> of{' '}
              <span className="font-mono tnum text-ink">100%</span>.
            </p>
          )}
          {errors.gradeMix && (
            <p role="alert" className="text-body-sm text-fail">
              {errors.gradeMix}
            </p>
          )}
        </div>
      </FormSection>

      {/* --------------------------------------------------------- sourcing */}
      <FormSection
        title="(optional) Where your stock comes from"
        status={
          <span className="normal-case tracking-normal text-acc-ink">
            <span className="tnum">{values.sourcingChannels.length}</span> of{' '}
            <span className="tnum">{SOURCING_CHANNELS.length}</span> selected
          </span>
        }
      >
        <ol
          role="group"
          aria-label="Sourcing channels"
          aria-describedby={errors.sourcingChannels ? 'sourcing-error' : undefined}
          className="flex list-none flex-col gap-3 p-0"
          onFocus={() => onFieldFocus('Capability')}
        >
          {SOURCING_CHANNELS.map((channel) => (
            <li key={channel.code}>
              <Checkbox
                label={labelNote(channel.label, channel.note)}
                checked={values.sourcingChannels.includes(channel.code)}
                onChange={() => toggleIn('sourcingChannels', channel.code)}
              />
            </li>
          ))}
        </ol>
        {errors.sourcingChannels && (
          <p id="sourcing-error" role="alert" className="text-body-sm text-fail">
            {errors.sourcingChannels}
          </p>
        )}
      </FormSection>

      {/* ----------------------------------------------------------- dispatch */}
      <FormSection title="Dispatch">
        <Select
          label="Lead time"
          required
          options={LEAD_TIME_HOURS}
          value={values.leadTimeDays}
          onFocus={() => onFieldFocus('Capability')}
          onBlur={saveOnBlur}
          onChange={(e) => setAndSave('leadTimeDays', e.target.value)}
          error={errors.leadTimeDays}
        />
      </FormSection>

      <div className="flow-actions flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
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
