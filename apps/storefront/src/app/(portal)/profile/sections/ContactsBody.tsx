'use client';

import * as React from 'react';
import { Checkbox, Input } from '@trugrade/ui';
import { completeStep, saveStep, type AccountHolderDetails } from '../../../register/api';
import { Select } from '../../../../lib/controls';
import { liveErrors } from '../../../register/live-errors';
import { PincodeLocalityFields } from '../../../register/PincodeLocalityFields';
import { CONTACT_ROLES, RECEIVING_DAYS, stateNameForGstin } from '../../../register/picklists';
import {
  completionOf,
  readContactsDraft,
  resolvedContact,
  toDraft,
  type BillingAddress,
  type ContactsValues,
  type DeliveryAddress,
  type Person,
} from '../../../register/StepContacts';
import {
  billingStateMatchesGstin,
  isMobileBlank,
  toE164,
  typeMobile,
  validateCity,
  validateEmail,
  validateFullName,
  validateLine1,
  validateMobile,
  validatePincode,
  validateReceivingHours,
} from '../../../register/validation';
import { stateName } from '../../../register/picklists';
import type { StepBodyProps } from './step-body';

/**
 * The Contacts and delivery card, one step per thing it asks for: the
 * procurement contact, the finance contact, the IT contact (optional), the
 * billing address for the registration, and the first delivery site.
 *
 * Every Continue writes the draft, so a card left after the finance contact
 * reopens at the finance contact with everything before it kept. Save on the
 * last step completes the step server-side. More delivery sites are added
 * from the Addresses screen once the first one exists.
 */

export interface ContactsBodyProps extends StepBodyProps {
  initial: Record<string, unknown>;
  /** The verified GSTIN, which the billing step is for. */
  gstins: readonly string[];
  statutory: Record<string, unknown> | undefined;
  accountHolder: AccountHolderDetails;
  blockingReason?: string | null;
}

type Sub =
  | { k: 'person'; role: (typeof CONTACT_ROLES)[number] }
  | { k: 'billing' }
  | { k: 'delivery' };

const SUBS: readonly Sub[] = [
  ...CONTACT_ROLES.map((role): Sub => ({ k: 'person', role })),
  { k: 'billing' },
  { k: 'delivery' },
];

const subTitle = (sub: Sub): string =>
  sub.k === 'person'
    ? `${sub.role.label} contact${sub.role.required ? '' : ' (optional)'}`
    : sub.k === 'billing'
      ? 'Billing address'
      : 'Delivery site';

/** What one step is unhappy about. Keys match the fields drawn for it. */
function checkSub(sub: Sub, v: ContactsValues, account: AccountHolderDetails): Record<string, string> {
  const found: Record<string, string> = {};
  if (sub.k === 'person') {
    const person = resolvedContact(v.contacts[sub.role.code]!, account);
    const started =
      person.fullName.trim() || person.email.trim() || !isMobileBlank(person.mobile);
    // An optional contact is either absent or complete.
    if (!sub.role.required && !started) return found;
    const name = validateFullName(person.fullName);
    if (name) found.fullName = name;
    const email = validateEmail(person.email);
    if (email) found.email = email;
    const mobile = validateMobile(person.mobile);
    if (mobile) found.mobile = mobile;
    return found;
  }
  if (sub.k === 'billing') {
    const address = v.billing[0];
    if (!address) return found;
    const line1 = validateLine1(address.line1);
    if (line1) found.line1 = line1;
    const city = validateCity(address.city);
    if (city) found.city = city;
    if (!address.state) found.state = 'Choose the state on the registration.';
    const pincode = validatePincode(address.pincode);
    if (pincode) found.pincode = pincode;
    if (address.gstin && address.state) {
      const mismatch = billingStateMatchesGstin(address.gstin, address.state, stateName);
      if (mismatch) found.state = mismatch;
    }
    return found;
  }
  const address = v.delivery[0];
  if (!address) return found;
  if (!address.label.trim()) found.label = 'Name this site — "Head office", "Gurugram warehouse".';
  const line1 = validateLine1(address.line1);
  if (line1) found.line1 = line1;
  const city = validateCity(address.city);
  if (city) found.city = city;
  if (!address.state) found.state = 'Choose the state.';
  const pincode = validatePincode(address.pincode);
  if (pincode) found.pincode = pincode;
  const name = validateFullName(address.contactName);
  if (name) found.contactName = 'Name the person who signs for the delivery.';
  const mobile = validateMobile(address.contactMobile);
  if (mobile) found.contactMobile = mobile;
  if (!address.days) found.days = 'Choose the days this site accepts goods.';
  const hours = validateReceivingHours(address.opensAt, address.closesAt);
  if (hours) found.hours = hours;
  return found;
}

/** Whether a field of the current step already holds something. */
function filledIn(sub: Sub, v: ContactsValues, account: AccountHolderDetails, key: string): boolean {
  if (sub.k === 'person') {
    const person = resolvedContact(v.contacts[sub.role.code]!, account);
    if (key === 'mobile') return !isMobileBlank(person.mobile);
    return Boolean(String(person[key as keyof Person] ?? '').trim());
  }
  const address = sub.k === 'billing' ? v.billing[0] : v.delivery[0];
  if (!address) return false;
  if (key === 'hours') {
    const d = address as DeliveryAddress;
    return Boolean(d.opensAt || d.closesAt);
  }
  return Boolean(String((address as unknown as Record<string, unknown>)[key] ?? '').trim());
}

export function ContactsBody({
  initial,
  gstins,
  statutory,
  accountHolder,
  blockingReason,
  registerSubmit,
  onBusy,
  onFrame,
  onSaved,
}: ContactsBodyProps): React.JSX.Element {
  const [index, setIndex] = React.useState(0);
  const [values, setValues] = React.useState<ContactsValues>(() =>
    readContactsDraft(initial, gstins, statutory),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | undefined>();
  const sub = SUBS[index]!;
  const last = index === SUBS.length - 1;

  React.useEffect(() => {
    onFrame({
      index: index + 1,
      count: SUBS.length,
      back: index > 0 ? () => setIndex(index - 1) : undefined,
      primaryLabel: last ? 'Save' : 'Continue',
    });
  }, [index, last, onFrame]);

  const update = (next: ContactsValues): void => {
    setValues(next);
    setErrors(liveErrors(checkSub(sub, next, accountHolder), (key) => filledIn(sub, next, accountHolder, key)));
  };

  const setPerson = (patch: Partial<Person>): void => {
    if (sub.k !== 'person') return;
    const role = sub.role.code;
    update({
      ...values,
      contacts: { ...values.contacts, [role]: { ...values.contacts[role]!, ...patch } },
    });
  };
  const setBilling = (patch: Partial<BillingAddress>): void =>
    update({ ...values, billing: values.billing.map((b, i) => (i === 0 ? { ...b, ...patch } : b)) });
  const setDelivery = (patch: Partial<DeliveryAddress>): void =>
    update({ ...values, delivery: values.delivery.map((d, i) => (i === 0 ? { ...d, ...patch } : d)) });

  /** Mobiles are stored as +91XXXXXXXXXX; settle what was typed on the way out. */
  const settled = (v: ContactsValues): ContactsValues => ({
    ...v,
    contacts: Object.fromEntries(
      Object.entries(v.contacts).map(([role, p]) => [
        role,
        { ...p, mobile: isMobileBlank(p.mobile) ? p.mobile : toE164(p.mobile) || p.mobile },
      ]),
    ),
    delivery: v.delivery.map((d) => ({
      ...d,
      contactMobile: toE164(d.contactMobile) || d.contactMobile,
    })),
  });

  const submit = async (): Promise<void> => {
    const found = checkSub(sub, values, accountHolder);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setError(undefined);
    onBusy(true);
    const draft = settled(values);
    const saved = await saveStep(
      'CONTACTS_ADDRESSES',
      toDraft(draft, accountHolder),
      completionOf(draft, accountHolder),
    );
    if (!saved.ok) {
      onBusy(false);
      setError(Object.values(saved.fields)[0] ?? saved.message);
      return;
    }
    if (!last) {
      onBusy(false);
      setValues(draft);
      setErrors({});
      setIndex(index + 1);
      return;
    }
    const completed = await completeStep('CONTACTS_ADDRESSES');
    onBusy(false);
    if (!completed.ok) {
      setError(completed.message);
      return;
    }
    onSaved();
  };

  const submitRef = React.useRef(submit);
  submitRef.current = submit;
  React.useEffect(() => {
    registerSubmit(() => void submitRef.current());
  }, [registerSubmit]);

  const noop = (): void => undefined;

  let fields: React.ReactNode;
  if (sub.k === 'person') {
    const stored = values.contacts[sub.role.code]!;
    const person = resolvedContact(stored, accountHolder);
    const usesAccount = stored.useAccountDetails === true;
    fields = (
      <>
        <Checkbox
          label="Use my account details"
          checked={usesAccount}
          onChange={(on) =>
            setPerson(
              on
                ? {
                    useAccountDetails: true,
                    fullName: accountHolder.fullName,
                    email: accountHolder.email,
                    mobile: typeMobile(accountHolder.mobile),
                  }
                : { useAccountDetails: false },
            )
          }
        />
        <Input
          label="Name"
          required={sub.role.required}
          value={person.fullName}
          readOnly={usesAccount}
          onChange={(e) => setPerson({ fullName: e.target.value, useAccountDetails: false })}
          error={errors.fullName}
        />
        <Input
          label="Designation"
          value={person.designation}
          onChange={(e) => setPerson({ designation: e.target.value })}
        />
        <Input
          label="Email"
          type="email"
          required={sub.role.required}
          value={person.email}
          readOnly={usesAccount}
          onChange={(e) => setPerson({ email: e.target.value, useAccountDetails: false })}
          error={errors.email}
        />
        <Input
          label="Mobile"
          mono
          type="tel"
          inputMode="numeric"
          maxLength={14}
          required={sub.role.required}
          value={person.mobile}
          readOnly={usesAccount}
          onChange={(e) => setPerson({ mobile: typeMobile(e.target.value), useAccountDetails: false })}
          error={errors.mobile}
        />
      </>
    );
  } else if (sub.k === 'billing') {
    const address = values.billing[0] ?? { gstin: '', line1: '', line2: '', city: '', state: '', pincode: '' };
    const issuedIn = address.gstin ? stateNameForGstin(address.gstin) : undefined;
    fields = (
      <>
        {address.gstin ? (
          <p className="text-body-sm text-ink-2">
            <span className="font-mono text-data tnum text-ink">{address.gstin}</span>
            {issuedIn ? <span> · registered in {issuedIn}</span> : null}
          </p>
        ) : null}
        <Input
          label="Building and street"
          required
          value={address.line1}
          onChange={(e) => setBilling({ line1: e.target.value })}
          error={errors.line1}
        />
        <Input
          label="Floor, unit or area"
          value={address.line2}
          onChange={(e) => setBilling({ line2: e.target.value })}
        />
        <PincodeLocalityFields
          value={{ pincode: address.pincode, city: address.city, state: address.state }}
          onChange={(patch) => setBilling(patch)}
          errors={{ pincode: errors.pincode, city: errors.city, state: errors.state }}
          onFocus={noop}
          onBlur={noop}
        />
      </>
    );
  } else {
    const address = values.delivery[0]!;
    fields = (
      <>
        <Input
          label="Name this site"
          required
          placeholder="Head office, Gurugram warehouse"
          value={address.label}
          onChange={(e) => setDelivery({ label: e.target.value })}
          error={errors.label}
        />
        <Input
          label="Building and street"
          required
          value={address.line1}
          onChange={(e) => setDelivery({ line1: e.target.value })}
          error={errors.line1}
        />
        <Input
          label="Floor, unit or area"
          value={address.line2}
          onChange={(e) => setDelivery({ line2: e.target.value })}
        />
        <PincodeLocalityFields
          value={{ pincode: address.pincode, city: address.city, state: address.state }}
          onChange={(patch) => setDelivery(patch)}
          errors={{ pincode: errors.pincode, city: errors.city, state: errors.state }}
          onFocus={noop}
          onBlur={noop}
        />
        <Input
          label="Who signs for the delivery"
          required
          value={address.contactName}
          onChange={(e) => setDelivery({ contactName: e.target.value })}
          error={errors.contactName}
        />
        <Input
          label="Their mobile"
          mono
          type="tel"
          inputMode="numeric"
          maxLength={14}
          required
          value={address.contactMobile}
          onChange={(e) => setDelivery({ contactMobile: typeMobile(e.target.value) })}
          error={errors.contactMobile}
        />
        <Input
          label="Landmark"
          value={address.landmark}
          onChange={(e) => setDelivery({ landmark: e.target.value })}
        />
        <Input
          label="Gate instructions"
          value={address.gateInstructions}
          onChange={(e) => setDelivery({ gateInstructions: e.target.value })}
        />
        <Select
          label="Receiving days"
          required
          options={RECEIVING_DAYS}
          value={address.days}
          onChange={(e) => setDelivery({ days: e.target.value })}
          error={errors.days}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Opens at"
            type="time"
            mono
            required
            value={address.opensAt}
            onChange={(e) => setDelivery({ opensAt: e.target.value })}
          />
          <Input
            label="Closes at"
            type="time"
            mono
            required
            value={address.closesAt}
            onChange={(e) => setDelivery({ closesAt: e.target.value })}
            error={errors.hours}
          />
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4" key={index}>
      {blockingReason && index === 0 ? (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {blockingReason}
        </p>
      ) : null}
      <h3 className="text-h3 text-ink">{subTitle(sub)}</h3>
      {fields}
      {error ? (
        <p role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
