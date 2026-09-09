'use client';

import * as React from 'react';
import { Button, Checkbox, FormSection, Input } from '@trugrade/ui';
import { Select } from '../../../lib/controls';
import {
  AddressFields,
  emptyPostal,
  postalComplete,
  postalErrors,
  type PostalAddress,
} from '../../register/AddressFields';
import { CONSTITUTIONS, STAFF_BANDS, VENDOR_CATEGORIES } from '../../register/picklists';
import {
  normaliseWebsite,
  validateCompanyName,
  validateIncorporationDate,
} from '../../register/validation';

/**
 * Step 2 — Business.
 *
 * **Deliberately not `StepCompany`.** The buyer's step 2 and this one share four
 * fields and their validators, and diverge on everything that matters: a buyer
 * is asked what industry they are in and how many laptops they buy a year, a
 * supplier is asked for two postal addresses and what kind of supplier they are.
 * The five shared fields are five `Input`s calling the same three exported
 * validators — folding two structurally different forms into one component
 * behind a mode flag would cost more than it saves and would make every future
 * change to either of them a change to both.
 *
 * What *is* shared is pulled out properly: `AddressFields` is the postal
 * fieldset, `CONSTITUTIONS` is the database enum, and `validateCompanyName`,
 * `normaliseWebsite` and `validateIncorporationDate` are the rules themselves.
 *
 * Constitution is the load-bearing answer on this screen.
 * `onboarding_field_requirement` gates CIN, LLPIN and the incorporation date on
 * it, so what step 3 asks for is decided here.
 */

export interface VendorBusinessValues {
  legalName: string;
  tradeName: string;
  constitution: string;
  incorporationDate: string;
  category: string;
  website: string;
  staffBand: string;
  registered: PostalAddress;
  operating: PostalAddress;
  /** True while the operating address is a mirror of the registered one. */
  operatingSameAsRegistered: boolean;
}

const EMPTY: VendorBusinessValues = {
  legalName: '',
  tradeName: '',
  constitution: '',
  incorporationDate: '',
  category: '',
  website: '',
  staffBand: '',
  registered: emptyPostal(),
  operating: emptyPostal(),
  operatingSameAsRegistered: false,
};

/**
 * A proprietorship has no certificate of incorporation, so the date is asked for
 * only where one exists. The same list drives the seeded `forbidden_for` on
 * `incorporation_date`, and the two must agree — a field a person cannot have is
 * a field they will try to fill in.
 */
const UNINCORPORATED = ['PROPRIETORSHIP', 'PARTNERSHIP'];

export function readVendorBusinessDraft(
  answers: Record<string, unknown>,
  fallbackLegalName = '',
): VendorBusinessValues {
  const str = (key: string): string =>
    typeof answers[key] === 'string' ? (answers[key] as string) : '';
  const address = (key: string): PostalAddress => ({
    ...emptyPostal(),
    ...((answers[key] as Partial<PostalAddress> | undefined) ?? {}),
  });
  return {
    ...EMPTY,
    legalName: str('legalName') || fallbackLegalName,
    tradeName: str('tradeName'),
    constitution: str('constitution'),
    incorporationDate: str('incorporationDate'),
    category: str('category'),
    website: str('website'),
    staffBand: str('staffBand'),
    registered: address('registered'),
    operating: address('operating'),
    operatingSameAsRegistered: answers.operatingSameAsRegistered === true,
  };
}

const toDraft = (values: VendorBusinessValues): Record<string, unknown> => ({
  ...values,
  // Written out in full rather than as a flag alone: the reviewer, the e-way
  // bill and every later screen read an address, and none of them should have
  // to know that this one was copied from the one above it.
  operating: values.operatingSameAsRegistered ? values.registered : values.operating,
});

/** Every block that has to be answered, counted the way the step is marked done. */
const checksOf = (values: VendorBusinessValues): boolean[] => [
  validateCompanyName(values.legalName) === undefined,
  values.constitution.length > 0,
  values.category.length > 0,
  values.staffBand.length > 0,
  postalComplete(values.registered),
  values.operatingSameAsRegistered || postalComplete(values.operating),
];

export const completionOf = (values: VendorBusinessValues): number => {
  const checks = checksOf(values);
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

export interface StepVendorBusinessProps {
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
  blockingReason?: string | null;
  skipValidation?: boolean;
}

export function StepVendorBusiness({
  answers,
  fallbackLegalName = '',
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
  skipValidation = false,
}: StepVendorBusinessProps): React.JSX.Element {
  const [values, setValues] = React.useState<VendorBusinessValues>(() =>
    readVendorBusinessDraft(answers, fallbackLegalName),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Read once and passed in, so the date rule can be tested at a year boundary.
  const today = React.useMemo(() => new Date(), []);

  const set = <K extends keyof VendorBusinessValues>(
    key: K,
    value: VendorBusinessValues[K],
  ): void => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors(({ [key as string]: _dropped, ...rest }) => rest);
  };

  const setAddress = (which: 'registered' | 'operating', patch: Partial<PostalAddress>): void => {
    setValues((v) => ({ ...v, [which]: { ...v[which], ...patch } }));
    setErrors((e) =>
      Object.fromEntries(Object.entries(e).filter(([key]) => !key.startsWith(`${which}.`))),
    );
  };

  /** Blur, not keystroke: one row per pause, not one per character. */
  const saveOnBlur = (): void => onSaveDraft(toDraft(values), completionOf(values));

  const dateApplies = !UNINCORPORATED.includes(values.constitution);

  const check = (candidate: VendorBusinessValues): Record<string, string> => {
    const found: Record<string, string> = {};
    const legal = validateCompanyName(candidate.legalName);
    if (legal) found.legalName = legal;
    if (!candidate.constitution)
      found.constitution = 'Choose the constitution — it decides which documents we ask for.';
    if (!candidate.category) found.category = 'Choose what best describes your business.';
    if (!candidate.staffBand) found.staffBand = 'Choose the headcount band.';
    if (dateApplies && candidate.constitution) {
      const date = validateIncorporationDate(candidate.incorporationDate, false, today);
      if (date) found.incorporationDate = date;
    }
    const site = normaliseWebsite(candidate.website);
    if (site.error) found.website = site.error;

    for (const [key, message] of Object.entries(postalErrors(candidate.registered)))
      found[`registered.${key}`] = message;
    if (!candidate.operatingSameAsRegistered)
      for (const [key, message] of Object.entries(postalErrors(candidate.operating)))
        found[`operating.${key}`] = message;

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
    const refusal = await onContinue(toDraft({ ...values, website: site.url ?? '' }), 100);
    if (refusal) setErrors(refusal);
  };

  const at =
    (prefix: string) =>
    (field: string): string | undefined =>
      errors[`${prefix}.${field}`];

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)} noValidate>
      {blockingReason && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {blockingReason}
        </p>
      )}

      <div className="flex flex-col gap-5">
        <Input
          label="Company legal name"
          required
          value={values.legalName}
          onFocus={() => onFieldFocus('Business')}
          onBlur={saveOnBlur}
          onChange={(e) => set('legalName', e.target.value)}
          error={errors.legalName}
        />
        <Input
          label="Trade name"
          value={values.tradeName}
          onFocus={() => onFieldFocus('Business')}
          onBlur={saveOnBlur}
          onChange={(e) => set('tradeName', e.target.value)}
          error={errors.tradeName}
        />
        <Select
          label="Constitution"
          required
          options={CONSTITUTIONS}
          value={values.constitution}
          onFocus={() => onFieldFocus('Business')}
          onBlur={saveOnBlur}
          onChange={(e) => set('constitution', e.target.value)}
          error={errors.constitution}
        />
        {dateApplies && (
          <Input
            label="Date of incorporation"
            type="date"
            value={values.incorporationDate}
            onFocus={() => onFieldFocus('Business')}
            onBlur={saveOnBlur}
            onChange={(e) => set('incorporationDate', e.target.value)}
            error={errors.incorporationDate}
          />
        )}
      </div>

      <div className="flex flex-col gap-5">
        <Select
          label="What best describes you"
          required
          options={VENDOR_CATEGORIES}
          value={values.category}
          onFocus={() => onFieldFocus('Business')}
          onBlur={saveOnBlur}
          onChange={(e) => set('category', e.target.value)}
          error={errors.category}
        />
        <Select
          label="People on the payroll"
          required
          options={STAFF_BANDS}
          value={values.staffBand}
          onFocus={() => onFieldFocus('Business')}
          onBlur={saveOnBlur}
          onChange={(e) => set('staffBand', e.target.value)}
          error={errors.staffBand}
        />
        <Input
          label="Website"
          inputMode="url"
          value={values.website}
          onFocus={() => onFieldFocus('Business')}
          onBlur={saveOnBlur}
          onChange={(e) => set('website', e.target.value)}
          error={errors.website}
        />
      </div>

      <FormSection title="Registered office">
        <AddressFields
          value={values.registered}
          errors={{
            line1: at('registered')('line1'),
            city: at('registered')('city'),
            state: at('registered')('state'),
            pincode: at('registered')('pincode'),
          }}
          onChange={(patch) => setAddress('registered', patch)}
          onBlur={saveOnBlur}
          onFocus={() => onFieldFocus('Registered office')}
        />
      </FormSection>

      <FormSection title="Operating address">
        <Checkbox
          label="Same as the registered office"
          consequence="We will use the registered office above as your operating address until you add a warehouse on step 5."
          checked={values.operatingSameAsRegistered}
          onChange={(same) => {
            set('operatingSameAsRegistered', same);
            // Written through immediately: a checkbox that changes what the
            // reviewer sees and is only saved on the next blur is a checkbox
            // that silently loses its answer when the tab is closed.
            onSaveDraft(
              toDraft({ ...values, operatingSameAsRegistered: same }),
              completionOf({ ...values, operatingSameAsRegistered: same }),
            );
          }}
        />
        {!values.operatingSameAsRegistered && (
          <AddressFields
            value={values.operating}
            errors={{
              line1: at('operating')('line1'),
              city: at('operating')('city'),
              state: at('operating')('state'),
              pincode: at('operating')('pincode'),
            }}
            onChange={(patch) => setAddress('operating', patch)}
            onBlur={saveOnBlur}
            onFocus={() => onFieldFocus('Operating address')}
          />
        )}
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
