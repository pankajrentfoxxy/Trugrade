'use client';

import * as React from 'react';
import { Chip, FormSection, Input } from '@trugrade/ui';
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
 * **`StepAccount` renders the identity half; this file adds four fields.** The
 * two OTP exchanges, the strength meter and the registration call are shared
 * with the buyer flow because they are the same act against the same endpoint,
 * and because a second copy of the OTP handling is the one that stops getting
 * fixed. What a supplier is asked that a buyer is not — the city they operate
 * out of, how much they move a month, and which brands they actually deal in —
 * lives here, in the slot `StepAccount` leaves for it.
 *
 * The brand list is the catalogue's own, from `GET /public/brands`. It is not a
 * constant: offering a vendor a hard-coded list of brands is how the form ends
 * up a release behind the catalogue, and the free-text box beside it is there
 * because a supplier's stock is not limited to what we already sell.
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
  brands: string[];
  otherBrands: string;
}

const EMPTY: ContactExtras = { city: '', monthlyVolume: '', brands: [], otherBrands: '' };

export function readContactExtras(answers: Record<string, unknown>): ContactExtras {
  const str = (key: string): string =>
    typeof answers[key] === 'string' ? (answers[key] as string) : '';
  return {
    city: str('city'),
    monthlyVolume: str('monthlyVolume'),
    brands: Array.isArray(answers.brands) ? (answers.brands as string[]) : [],
    otherBrands: str('otherBrands'),
  };
}

export interface StepVendorContactProps {
  answers: Record<string, unknown>;
  registered: boolean;
  busy: boolean;
  /** The catalogue's brands. Empty when the API did not answer — see below. */
  brands: readonly string[];
  onContinue: (
    values: AccountValues,
    extras: Record<string, unknown>,
  ) => Promise<Record<string, string> | null>;
  onFieldFocus: (term: string) => void;
}

export function StepVendorContact({
  answers,
  registered,
  busy,
  brands,
  onContinue,
  onFieldFocus,
}: StepVendorContactProps): React.JSX.Element {
  const [extras, setExtras] = React.useState<ContactExtras>(() =>
    Object.keys(answers).length > 0 ? readContactExtras(answers) : EMPTY,
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const set = <K extends keyof ContactExtras>(key: K, value: ContactExtras[K]): void => {
    setExtras((v) => ({ ...v, [key]: value }));
    setErrors(({ [key as string]: _dropped, ...rest }) => rest);
  };

  const toggleBrand = (brand: string): void => {
    setErrors(({ brands: _dropped, ...rest }) => rest);
    setExtras((v) => ({
      ...v,
      brands: v.brands.includes(brand)
        ? v.brands.filter((b) => b !== brand)
        : [...v.brands, brand],
    }));
  };

  const namedBrands = extras.brands.length + (extras.otherBrands.trim().length > 0 ? 1 : 0);

  const validateExtras = (): boolean => {
    const found: Record<string, string> = {};
    const city = validateCity(extras.city);
    if (city) found.city = city;
    if (!extras.monthlyVolume)
      found.monthlyVolume = 'Choose the band that is closest. Nothing is committed by answering it.';
    if (namedBrands === 0)
      found.brands =
        'Tell us at least one brand you deal in — pick from the list, or type the others in the box below.';
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
      onContinue={(values) =>
        onContinue(values, {
          city: extras.city,
          monthlyVolume: extras.monthlyVolume,
          brands: extras.brands,
          otherBrands: extras.otherBrands,
        })
      }
      validateExtras={validateExtras}
      extras={
        <>
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

          <FormSection
            title="Brands you deal in"
            description="Pick every brand you regularly hold. You can change this later — it is a routing hint, not a restriction on what you may list."
            status={
              <>
                <span className="tnum">{namedBrands}</span>{' '}
                {namedBrands === 1 ? 'brand' : 'brands'} named
              </>
            }
          >
            {brands.length > 0 ? (
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Brands you deal in"
                aria-describedby={errors.brands ? 'brands-error' : undefined}
                onFocus={() => onFieldFocus('Contact')}
              >
                {brands.map((brand) => (
                  <Chip
                    key={brand}
                    label={brand}
                    selected={extras.brands.includes(brand)}
                    onToggle={() => toggleBrand(brand)}
                  />
                ))}
              </div>
            ) : (
              // Never fabricate data on a screen: with no answer from the
              // catalogue there are no brands to offer, and the free-text box
              // below is the whole of this question rather than a fallback list
              // somebody typed here once.
              <p className="text-body-sm text-ink-4">
                We could not load the brand list just now. Type the brands you deal in below and we
                will match them up.
              </p>
            )}
            {errors.brands && (
              <p id="brands-error" role="alert" className="text-body-sm text-fail">
                {errors.brands}
              </p>
            )}
            <Input
              label="Any other brands"
              hint="Optional. Comma-separated — anything not in the list above."
              value={extras.otherBrands}
              onFocus={() => onFieldFocus('Contact')}
              onChange={(e) => set('otherBrands', e.target.value)}
            />
          </FormSection>
        </>
      }
    />
  );
}
