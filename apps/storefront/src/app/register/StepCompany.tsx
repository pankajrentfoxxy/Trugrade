'use client';

import * as React from 'react';
import { Button, FormSection, Input } from '@trugrade/ui';
import { Select } from '../../lib/controls';
import { ANNUAL_VOLUMES, CONSTITUTIONS, EMPLOYEE_BANDS, INDUSTRIES } from './picklists';
import { normaliseWebsite, validateCompanyName, validateYearEstablished } from './validation';

/**
 * Step 2 — Company.
 *
 * Everything typed here goes to `PUT /onboarding/steps/BUSINESS_PROFILE` on
 * blur, so leaving the tab open on a phone call costs nothing. The draft is a
 * draft: the endpoint validates shape only, and a half-filled form is its
 * normal state.
 *
 * Constitution matters more than it looks. `onboarding_step_definition` gates
 * whole steps on it and `onboarding_field_requirement` gates CIN, LLPIN and the
 * incorporation date, so this answer decides what step 3 will ask for.
 */

export interface CompanyValues {
  legalName: string;
  tradeName: string;
  constitution: string;
  industry: string;
  yearEstablished: string;
  employeeBand: string;
  website: string;
  annualVolume: string;
}

const EMPTY: CompanyValues = {
  legalName: '',
  tradeName: '',
  constitution: '',
  industry: '',
  yearEstablished: '',
  employeeBand: '',
  website: '',
  annualVolume: '',
};

/** The six that must be answered. Trade name and website are genuinely optional. */
const REQUIRED: ReadonlyArray<keyof CompanyValues> = [
  'legalName',
  'constitution',
  'industry',
  'yearEstablished',
  'employeeBand',
  'annualVolume',
];

export function readCompanyDraft(
  answers: Record<string, unknown>,
  fallbackLegalName = '',
): CompanyValues {
  const str = (key: string): string =>
    typeof answers[key] === 'string' ? (answers[key] as string) : '';
  return {
    ...EMPTY,
    legalName: str('legalName') || fallbackLegalName,
    tradeName: str('tradeName'),
    constitution: str('constitution'),
    industry: str('industry'),
    yearEstablished: str('yearEstablished'),
    employeeBand: str('employeeBand'),
    website: str('website'),
    annualVolume: str('annualVolume'),
  };
}

const answeredCount = (values: CompanyValues): number =>
  REQUIRED.filter((key) => values[key].trim().length > 0).length;

/** What `PUT /onboarding/steps/:code` stores as `completion_pct`. */
export const completionOf = (values: CompanyValues): number =>
  Math.round((answeredCount(values) / REQUIRED.length) * 100);

export interface StepCompanyProps {
  answers: Record<string, unknown>;
  /** Carried from step 1 so the applicant does not retype what they just typed. */
  fallbackLegalName?: string;
  onSaveDraft: (values: Record<string, unknown>, completionPct: number) => void;
  onContinue: (
    values: Record<string, unknown>,
    completionPct: number,
  ) => Promise<Record<string, string> | null>;
  busy: boolean;
  onFieldFocus: (term: string) => void;
  /** Verbatim from the reviewer when this step was sent back. */
  blockingReason?: string | null;
  skipValidation?: boolean;
}

export function StepCompany({
  answers,
  fallbackLegalName = '',
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
  skipValidation = false,
}: StepCompanyProps): React.JSX.Element {
  const [values, setValues] = React.useState<CompanyValues>(() =>
    readCompanyDraft(answers, fallbackLegalName),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // The year the rule compares against is read once, here, and passed in — the
  // validator itself takes it as an argument so it can be tested at a boundary.
  const currentYear = React.useMemo(() => new Date().getFullYear(), []);

  const set = <K extends keyof CompanyValues>(key: K, value: CompanyValues[K]): void => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors(({ [key as string]: _dropped, ...rest }) => rest);
  };

  /** Blur, not keystroke: one row per pause, not one per character. */
  const saveOnBlur = (): void => onSaveDraft({ ...values }, completionOf(values));

  const check = (candidate: CompanyValues): Record<string, string> => {
    const found: Record<string, string> = {};
    const legal = validateCompanyName(candidate.legalName);
    if (legal) found.legalName = legal;
    if (!candidate.constitution)
      found.constitution = 'Choose the constitution — it decides which documents we ask for.';
    if (!candidate.industry) found.industry = 'Choose the closest industry.';
    if (!candidate.employeeBand) found.employeeBand = 'Choose the headcount band.';
    if (!candidate.annualVolume) found.annualVolume = 'Choose how many laptops you buy in a year.';
    if (!candidate.yearEstablished.trim())
      found.yearEstablished = 'Enter the year the business was established.';
    const year = validateYearEstablished(candidate.yearEstablished, currentYear);
    if (year) found.yearEstablished = year;
    const site = normaliseWebsite(candidate.website);
    if (site.error) found.website = site.error;
    return found;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found = skipValidation ? {} : check(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const site = normaliseWebsite(values.website);
    const refusal = await onContinue({ ...values, website: site.url ?? '' }, 100);
    if (refusal) setErrors(refusal);
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

      <FormSection
        title="The legal entity"
        description="This is the name and constitution we will invoice, so it has to match your GST certificate."
        status={
          <>
            <span className="tnum">{answeredCount(values)}</span> of{' '}
            <span className="tnum">{REQUIRED.length}</span> required answers
          </>
        }
      >
        <Input
          label="Legal name"
          hint="As registered. Include Pvt Ltd, LLP or the equivalent."
          required
          value={values.legalName}
          onFocus={() => onFieldFocus('Company')}
          onBlur={saveOnBlur}
          onChange={(e) => set('legalName', e.target.value)}
          error={errors.legalName}
        />
        <Input
          label="Trade name"
          hint="Optional. The name you actually go by, if it differs."
          value={values.tradeName}
          onFocus={() => onFieldFocus('Company')}
          onBlur={saveOnBlur}
          onChange={(e) => set('tradeName', e.target.value)}
          error={errors.tradeName}
        />
        <Select
          label="Constitution"
          hint="A private limited company is asked for a CIN; a proprietorship never is."
          required
          options={CONSTITUTIONS}
          value={values.constitution}
          onFocus={() => onFieldFocus('Company')}
          onBlur={saveOnBlur}
          onChange={(e) => set('constitution', e.target.value)}
          error={errors.constitution}
        />
      </FormSection>

      <FormSection
        title="The business"
        description="Used to size your credit application and to route you to the right account manager."
      >
        <Select
          label="Industry"
          required
          options={INDUSTRIES}
          value={values.industry}
          onFocus={() => onFieldFocus('Company')}
          onBlur={saveOnBlur}
          onChange={(e) => set('industry', e.target.value)}
          error={errors.industry}
        />
        <Input
          label="Year established"
          hint="Four digits, and it cannot be in the future."
          mono
          inputMode="numeric"
          maxLength={4}
          required
          value={values.yearEstablished}
          onFocus={() => onFieldFocus('Company')}
          onBlur={saveOnBlur}
          onChange={(e) => set('yearEstablished', e.target.value)}
          error={errors.yearEstablished}
        />
        <Select
          label="Employees"
          required
          options={EMPLOYEE_BANDS}
          value={values.employeeBand}
          onFocus={() => onFieldFocus('Company')}
          onBlur={saveOnBlur}
          onChange={(e) => set('employeeBand', e.target.value)}
          error={errors.employeeBand}
        />
        <Select
          label="Laptops bought in a year"
          hint="A range is fine. Nothing is committed by answering it."
          required
          options={ANNUAL_VOLUMES}
          value={values.annualVolume}
          onFocus={() => onFieldFocus('Company')}
          onBlur={saveOnBlur}
          onChange={(e) => set('annualVolume', e.target.value)}
          error={errors.annualVolume}
        />
        <Input
          label="Website"
          hint="Optional. acme.co.in is fine — you do not need to type https://."
          inputMode="url"
          value={values.website}
          onFocus={() => onFieldFocus('Company')}
          onBlur={saveOnBlur}
          onChange={(e) => set('website', e.target.value)}
          error={errors.website}
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
        <Button type="submit" variant="primary" loading={busy}>
          Save and continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSaveDraft({ ...values }, completionOf(values))}
        >
          Save and finish later
        </Button>
      </div>
    </form>
  );
}
