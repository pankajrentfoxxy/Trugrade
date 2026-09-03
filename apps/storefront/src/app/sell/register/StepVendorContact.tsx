'use client';

import * as React from 'react';
import { FormSection, Input } from '@trugrade/ui';
import { Select } from '../../../lib/controls';
import {
  StepAccount,
  type AccountCopy,
  type AccountValues,
} from '../../register/StepAccount';
import { MONTHLY_VOLUMES } from '../../register/picklists';
import { validateCity } from '../../register/validation';

/**
 * Step 1 — Contact.
 *
 * **`StepAccount` renders the identity half; this file adds two fields.** The
 * two OTP exchanges, the strength meter and the registration call are shared
 * with the buyer flow because they are the same act against the same endpoint,
 * and because a second copy of the OTP handling is the one that stops getting
 * fixed. What a supplier is asked that a buyer is not — the city they operate
 * out of and how much they move a month — lives here, in the slot `StepAccount`
 * leaves for it. Brands are asked on step 4.
 */

const VENDOR_ACCOUNT_COPY: AccountCopy = {
  identityDescription:
    'The person who registers is the account owner and signs the vendor agreement. They can add colleagues once you are approved.',
  companyNameLabel: 'Company name',
  companyNameHint:
    'The name you trade under is fine here. The registered legal name is asked for on the next step.',
  reachDescription:
    'Both are verified now: a purchase order, a pick-up window and a payout advice all go to these, and a wrong number means a machine nobody comes to collect.',
  submitLabel: 'Create account and continue',
};

export interface ContactExtras {
  city: string;
  monthlyVolume: string;
}

const EMPTY: ContactExtras = { city: '', monthlyVolume: '' };

export function readContactExtras(answers: Record<string, unknown>): ContactExtras {
  const str = (key: string): string =>
    typeof answers[key] === 'string' ? (answers[key] as string) : '';
  return {
    city: str('city'),
    monthlyVolume: str('monthlyVolume'),
  };
}

export interface StepVendorContactProps {
  answers: Record<string, unknown>;
  registered: boolean;
  busy: boolean;
  onContinue: (
    values: AccountValues,
    extras: Record<string, unknown>,
  ) => Promise<Record<string, string> | null>;
  onFieldFocus: (term: string) => void;
  skipValidation?: boolean;
}

export function StepVendorContact({
  answers,
  registered,
  busy,
  onContinue,
  onFieldFocus,
  skipValidation = false,
}: StepVendorContactProps): React.JSX.Element {
  const [extras, setExtras] = React.useState<ContactExtras>(() =>
    Object.keys(answers).length > 0 ? readContactExtras(answers) : EMPTY,
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const set = <K extends keyof ContactExtras>(key: K, value: ContactExtras[K]): void => {
    setExtras((v) => ({ ...v, [key]: value }));
    setErrors(({ [key as string]: _dropped, ...rest }) => rest);
  };

  const validateExtras = (): boolean => {
    const found: Record<string, string> = {};
    const city = validateCity(extras.city);
    if (city) found.city = city;
    if (!extras.monthlyVolume)
      found.monthlyVolume = 'Choose the band that is closest. Nothing is committed by answering it.';
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  return (
    <StepAccount
      answers={answers}
      registered={registered}
      busy={busy}
      copy={VENDOR_ACCOUNT_COPY}
      onFieldFocus={onFieldFocus}
      skipValidation={skipValidation}
      onContinue={(values) =>
        onContinue(values, {
          city: extras.city,
          monthlyVolume: extras.monthlyVolume,
        })
      }
      validateExtras={validateExtras}
      extras={
        <FormSection
          title="What you supply"
          description="A rough answer is enough. It decides which stock enquiries reach you and who from our team calls you first — nothing here is a commitment."
        >
          <Input
            label="City you operate from"
            hint="Where the machines actually are. The full address is asked for on the next step."
            required
            value={extras.city}
            onFocus={() => onFieldFocus('Contact')}
            onChange={(e) => set('city', e.target.value)}
            error={errors.city}
          />
          <Select
            label="Laptops you move in a month"
            required
            options={MONTHLY_VOLUMES}
            value={extras.monthlyVolume}
            onFocus={() => onFieldFocus('Contact')}
            onChange={(e) => set('monthlyVolume', e.target.value)}
            error={errors.monthlyVolume}
          />
        </FormSection>
      }
    />
  );
}
