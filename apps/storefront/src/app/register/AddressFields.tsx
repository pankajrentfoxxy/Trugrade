'use client';

import * as React from 'react';
import { Input } from '@trugrade/ui';
import { Select } from '../../lib/controls';
import { STATES } from './picklists';
import { validateCity, validateLine1, validatePincode } from './validation';

/**
 * The five fields every Indian postal address on this platform is made of.
 *
 * Registration asks for an address on four different screens — a vendor's
 * registered office and operating address here, a buyer's billing address per
 * GSTIN, a delivery site per dock — and the *only* thing that differs between
 * them is what sits around these five. Pulling them into one component is what
 * keeps the PIN-code rule, the state list and the two withdrawn state codes
 * behaving the same way on all of them.
 *
 * `StepContacts` still inlines its own two copies of this markup, which is
 * where the shape came from. Reported rather than refactored inside this task:
 * that step is finished and screenshot-verified, and reshaping its DOM would
 * mean re-verifying it for no behaviour change.
 */

export interface PostalAddress {
  line1: string;
  line2: string;
  city: string;
  /** The GST state code, e.g. "06". The label is rendered from `STATES`. */
  state: string;
  pincode: string;
}

export const emptyPostal = (): PostalAddress => ({
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
});

/** All four required fields answered. `line2` is genuinely optional. */
export const postalComplete = (a: PostalAddress): boolean =>
  validateLine1(a.line1) === undefined &&
  validateCity(a.city) === undefined &&
  a.state.length > 0 &&
  validatePincode(a.pincode) === undefined;

/**
 * Every problem with the address, keyed by field, so a caller can prefix the
 * keys and hold several addresses' errors in one flat map.
 */
export function postalErrors(a: PostalAddress): Record<string, string> {
  const found: Record<string, string> = {};
  const line1 = validateLine1(a.line1);
  if (line1) found.line1 = line1;
  const city = validateCity(a.city);
  if (city) found.city = city;
  if (!a.state) found.state = 'Choose the state this address is in.';
  const pincode = validatePincode(a.pincode);
  if (pincode) found.pincode = pincode;
  return found;
}

export interface AddressFieldsProps {
  value: PostalAddress;
  onChange: (patch: Partial<PostalAddress>) => void;
  /** Prefixed by the caller, so one map can hold several addresses. */
  errors: Record<string, string | undefined>;
  onBlur: () => void;
  onFocus: () => void;
  /** Everything is read-only when the caller mirrors another address into this. */
  readOnly?: boolean;
  line1Label?: string;
}

export function AddressFields({
  value,
  onChange,
  errors,
  onBlur,
  onFocus,
  readOnly,
  line1Label = 'Building and street',
}: AddressFieldsProps): React.JSX.Element {
  return (
    <>
      <Input
        label={line1Label}
        required
        readOnly={readOnly}
        value={value.line1}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => onChange({ line1: e.target.value })}
        error={errors.line1}
      />
      <Input
        label={
          <>
            Area or landmark{' '}
            <span className="text-label font-normal text-ink-3">(optional)</span>
          </>
        }
        readOnly={readOnly}
        value={value.line2}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => onChange({ line2: e.target.value })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="City"
          required
          readOnly={readOnly}
          value={value.city}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => onChange({ city: e.target.value })}
          error={errors.city}
        />
        <Input
          label="PIN code"
          mono
          inputMode="numeric"
          maxLength={6}
          required
          readOnly={readOnly}
          value={value.pincode}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => onChange({ pincode: e.target.value })}
          error={errors.pincode}
        />
      </div>
      <Select
        label="State"
        required
        disabled={readOnly}
        options={STATES}
        value={value.state}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => onChange({ state: e.target.value })}
        error={errors.state}
      />
    </>
  );
}
