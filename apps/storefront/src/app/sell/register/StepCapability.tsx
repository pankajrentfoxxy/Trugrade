'use client';

import * as React from 'react';
import { Button, Checkbox, Chip, FormSection, Input } from '@trugrade/ui';
import { Select } from '../../../lib/controls';
import { LEAD_TIME_HOURS, SOURCING_CHANNELS, SUPPLY_CATEGORIES } from '../../register/picklists';

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
 * **The grades are a tick, not a split.** They decide which grades the listing
 * wizard will offer this vendor later. At least one has to be ticked — a
 * supplier who lists nothing is not a supplier we can route an enquiry to.
 *
 * **The grades come from `GET /public/grades`.** A_PLUS / A / B is a policy
 * decision held in the catalogue, and a supplier being asked to tick a list
 * this file invented is a form that goes stale the day a grade is added.
 */

/* ==========================================================================
 * Draft shape — the column names of `vendor.vendor_capability`
 * ======================================================================== */

export interface CapabilityValues {
  categories: string[];
  brands: string[];
  otherBrands: string;
  /** Grade codes this vendor supplies. Written to `typical_grade_mix` as presence. */
  grades: string[];
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
  grades: [],
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
  const listed = list('grades');
  const mix =
    answers.gradeMix && typeof answers.gradeMix === 'object' && !Array.isArray(answers.gradeMix)
      ? Object.entries(answers.gradeMix as Record<string, unknown>)
          .filter(([, v]) => Number(v) > 0)
          .map(([g]) => g)
      : [];
  const bool = (key: string): boolean | null =>
    typeof answers[key] === 'boolean' ? (answers[key] as boolean) : null;

  return {
    ...EMPTY,
    categories: list('categories').filter((code) => code !== 'WORKSTATION'),
    brands: list('brands'),
    otherBrands: str('otherBrands'),
    grades: listed.length > 0 ? listed : mix,
    sourcingChannels: list('sourcingChannels'),
    canProvideSerialsUpfront: bool('canProvideSerialsUpfront'),
    hasInhouseTesting: answers.hasInhouseTesting === true,
    hasInhouseRepair: answers.hasInhouseRepair === true,
    leadTimeDays: str('leadTimeDays'),
  };
}

const toDraft = (values: CapabilityValues): Record<string, unknown> => ({
  ...values,
  // Older promotion still reads `gradeMix`. Presence (`1`) is the new shape.
  gradeMix: Object.fromEntries(values.grades.map((g) => [g, 1])),
});

/* ==========================================================================
 * Derived numbers
 * ======================================================================== */

const LEAD_TIME_VALUES = new Set(LEAD_TIME_HOURS.map((o) => o.value).filter(Boolean));

const gradesDone = (values: CapabilityValues, catalogue: readonly string[]): boolean =>
  catalogue.length === 0 || values.grades.some((g) => catalogue.includes(g));

const checksOf = (values: CapabilityValues, grades: readonly string[]): boolean[] => [
  // A catalogue that did not answer cannot be a gate on their application.
  gradesDone(values, grades),
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

  const toggleIn = (
    key: 'categories' | 'brands' | 'sourcingChannels' | 'grades',
    code: string,
  ): void =>
    setAndSave(
      key,
      values[key].includes(code) ? values[key].filter((c) => c !== code) : [...values[key], code],
    );

  /* ------------------------------------------------------------ validation */

  const check = (v: CapabilityValues): Record<string, string> => {
    const found: Record<string, string> = {};

    const namedBrands = v.brands.length + (v.otherBrands.trim().length > 0 ? 1 : 0);
    if (namedBrands === 0)
      found.brands =
        'Tell us at least one brand you deal in — pick from the list, or type the others in the box below.';

    if (gradeCodes.length > 0 && !v.grades.some((g) => gradeCodes.includes(g)))
      found.grades = 'Tick at least one grade you supply. The listing wizard will only offer these.';

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

  const namedBrands = values.brands.length + (values.otherBrands.trim().length > 0 ? 1 : 0);

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

      {/* ----------------------------------------------------------- grades */}
      <FormSection
        title="Grades you supply"
        status={
          grades.length > 0 ? (
            <span className="normal-case tracking-normal text-acc-ink">
              <span className="tnum">{values.grades.filter((g) => gradeCodes.includes(g)).length}</span>{' '}
              of <span className="tnum">{grades.length}</span> selected
            </span>
          ) : undefined
        }
      >
        {grades.length === 0 ? (
          // The grade list is a policy decision held in the catalogue. With no
          // answer from it there is nothing honest to tick, so the question is
          // stood down rather than asked against a guess.
          <p className="text-body-sm text-ink-4">
            We could not load the grade definitions just now, so we are not asking you to pick
            grades yet. Your reviewer will pick this up.
          </p>
        ) : (
          <ol
            role="group"
            aria-label="Grades you supply"
            aria-describedby={errors.grades ? 'grades-error' : undefined}
            className="flex list-none flex-col gap-3 p-0"
            onFocus={() => onFieldFocus('Grades you supply')}
          >
            {grades.map((grade) => (
              <li key={grade.grade}>
                <Checkbox
                  label={labelNote(`Grade ${gradeLabel(grade.grade)}`, grade.customerDescription)}
                  checked={values.grades.includes(grade.grade)}
                  onChange={() => toggleIn('grades', grade.grade)}
                />
              </li>
            ))}
          </ol>
        )}
        {errors.grades && (
          <p id="grades-error" role="alert" className="text-body-sm text-fail">
            {errors.grades}
          </p>
        )}
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
