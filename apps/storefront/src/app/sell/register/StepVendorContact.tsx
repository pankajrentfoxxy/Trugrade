'use client';

import * as React from 'react';
import { Select } from '../../../lib/controls';
import {
  StepAccount,
  type AccountCopy,
  type AccountValues,
} from '../../register/StepAccount';
import { MONTHLY_VOLUMES } from '../../register/picklists';

/**
 * Step 1 — Contact.
 *
 * **`StepAccount` renders the identity half; this file adds one field.** The
 * two OTP exchanges, the strength meter and the registration call are shared
 * with the buyer flow because they are the same act against the same endpoint,
 * and because a second copy of the OTP handling is the one that stops getting
 * fixed. What a supplier is asked that a buyer is not — how much they move a
 * month — lives here, in the slot `StepAccount` leaves for it. Brands are asked
 * on step 4; dispatch city comes from the facility step.
 */

const VENDOR_ACCOUNT_COPY: AccountCopy = {
  submitLabel: 'Create account and continue',
};

export interface ContactExtras {
  monthlyVolume: string;
}

const EMPTY: ContactExtras = { monthlyVolume: '' };

export function readContactExtras(answers: Record<string, unknown>): ContactExtras {
  const str = (key: string): string =>
    typeof answers[key] === 'string' ? (answers[key] as string) : '';
  return {
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
          monthlyVolume: extras.monthlyVolume,
        })
      }
      validateExtras={validateExtras}
      extras={
        <div className="flex flex-col gap-5">
          <Select
            label="Laptops you move in a month"
            required
            options={MONTHLY_VOLUMES}
            value={extras.monthlyVolume}
            onFocus={() => onFieldFocus('Contact')}
            onChange={(e) => set('monthlyVolume', e.target.value)}
            error={errors.monthlyVolume}
          />
        </div>
      }
    />
  );
}
