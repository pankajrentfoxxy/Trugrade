'use client';

import * as React from 'react';
import { Button, FormSection, Input, type WhyRailItem } from '@trugrade/ui';
import { Select } from '../../lib/controls';
import {
  CONTACT_ROLES,
  RECEIVING_DAYS,
  STATES,
  labelFor,
  stateName,
  stateNameForGstin,
} from './picklists';
import {
  billingStateMatchesGstin,
  isMobileBlank,
  MOBILE_PREFIX,
  toE164,
  typeMobile,
  validateCity,
  validateEmail,
  validateFullName,
  validateLine1,
  validateMobile,
  validatePincode,
  validateReceivingHours,
} from './validation';

/**
 * Step 4 — contacts and delivery.
 *
 * Three things here are the difference between a delivery that lands and one
 * that comes back on the truck, and all three are what a generic address form
 * drops.
 *
 * **A billing address per GSTIN, not one per company.** The registration decides
 * the place of supply, so a buyer registered in Haryana and Karnataka has two
 * billing addresses and two different tax treatments. The GSTINs are read out of
 * step 3's answers — they are never asked for twice — and the billing rows are
 * written into this step's own draft on arrival so a resume still knows them
 * after step 3's draft has been cleared.
 *
 * **Receiving hours are required.** A pallet of laptops at a closed dock at
 * 19:00 is a failed delivery, a return leg and a second dispatch fee, and the
 * assumption a form makes when it does not ask is "any weekday, any time".
 *
 * **The gate instruction is free text and it is kept.** "Gate 3, ask for the
 * security desk, no entry after 17:30" is a sentence nobody can express in a
 * structured field, and it is the sentence the rider actually needs.
 */

/* ==========================================================================
 * Why we ask — beyond the step's one-line `purpose_note`
 * ======================================================================== */

export const WHY_CONTACTS: readonly WhyRailItem[] = [
  {
    term: 'Receiving hours',
    explanation: (
      <>
        <p>
          A delivery that arrives at a closed dock is a failed delivery: the unit goes back to the
          supply point, and it goes out again on the next available slot.
        </p>
        <p className="mt-2">
          We use these hours to choose the delivery slot, not to limit when you can order. If they
          change, change them here — the next dispatch reads them fresh.
        </p>
      </>
    ),
  },
  {
    term: 'Billing address',
    explanation:
      'One per GST registration. The registration decides whether an invoice carries IGST or CGST plus SGST, so the address on it has to sit in the state that issued it.',
  },
];

/* ==========================================================================
 * Draft shape
 * ======================================================================== */

export interface Person {
  fullName: string;
  designation: string;
  email: string;
  mobile: string;
}

export interface BillingAddress {
  /** The registration this address bills. Empty only if step 3 is unreadable here. */
  gstin: string;
  line1: string;
  line2: string;
  city: string;
  /** The GST state code, e.g. "06". The label is rendered from `STATES`. */
  state: string;
  pincode: string;
}

export interface DeliveryAddress extends BillingAddress {
  /** Stable across a re-render and a resume. Not shown. */
  key: string;
  label: string;
  contactName: string;
  contactMobile: string;
  landmark: string;
  gateInstructions: string;
  days: string;
  opensAt: string;
  closesAt: string;
}

export interface ContactsValues {
  contacts: Record<string, Person>;
  billing: BillingAddress[];
  delivery: DeliveryAddress[];
}

const emptyPerson = (): Person => ({
  fullName: '',
  designation: '',
  email: '',
  mobile: MOBILE_PREFIX,
});

const emptyPostal = (gstin = ''): BillingAddress => ({
  gstin,
  line1: '',
  line2: '',
  city: '',
  state: gstin ? gstin.slice(0, 2) : '',
  pincode: '',
});

let keySeed = 0;
const nextKey = (): string => {
  keySeed += 1;
  return `d${keySeed}`;
};

const emptyDelivery = (): DeliveryAddress => ({
  ...emptyPostal(),
  key: nextKey(),
  label: '',
  contactName: '',
  contactMobile: MOBILE_PREFIX,
  landmark: '',
  gateInstructions: '',
  days: '',
  opensAt: '',
  closesAt: '',
});

/**
 * Read the draft, seeding the billing rows from step 3 the first time.
 *
 * `savedGstins` is what step 3 typed. Once this step has a draft of its own the
 * saved rows win, because they carry the address that was entered against each
 * registration — and because a COMPLETE step 3 no longer returns its answers.
 */
export function readContactsDraft(
  answers: Record<string, unknown>,
  savedGstins: readonly string[],
): ContactsValues {
  const savedContacts = (answers.contacts ?? {}) as Record<string, Partial<Person>>;
  const contacts: Record<string, Person> = {};
  for (const role of CONTACT_ROLES) {
    const saved = savedContacts[role.code] ?? {};
    contacts[role.code] = {
      ...emptyPerson(),
      ...saved,
      mobile: typeMobile(typeof saved.mobile === 'string' ? saved.mobile : ''),
    };
  }

  const savedBilling = Array.isArray(answers.billing)
    ? (answers.billing as Partial<BillingAddress>[])
    : [];
  const billing =
    savedBilling.length > 0
      ? savedBilling.map((b) => ({ ...emptyPostal(b.gstin ?? ''), ...b }))
      : // No draft yet: one row per registration, in the order step 3 gave them.
        (savedGstins.length > 0 ? savedGstins : ['']).map((g) => emptyPostal(g));

  const savedDelivery = Array.isArray(answers.delivery)
    ? (answers.delivery as Partial<DeliveryAddress>[])
    : [];
  const delivery =
    savedDelivery.length > 0
      ? savedDelivery.map((d) => ({
          ...emptyDelivery(),
          ...d,
          key: nextKey(),
          contactMobile: typeMobile(typeof d.contactMobile === 'string' ? d.contactMobile : ''),
        }))
      : [emptyDelivery()];

  return { contacts, billing, delivery };
}

/** Only what the API should keep. The React key is regenerated on read. */
const toDraft = (values: ContactsValues): Record<string, unknown> => ({
  contacts: values.contacts,
  billing: values.billing,
  delivery: values.delivery.map(({ key: _key, ...rest }) => rest),
});

const personDone = (p: Person): boolean =>
  validateFullName(p.fullName) === undefined &&
  validateEmail(p.email) === undefined &&
  validateMobile(p.mobile) === undefined;

const postalDone = (a: BillingAddress): boolean =>
  validateLine1(a.line1) === undefined &&
  validateCity(a.city) === undefined &&
  a.state.length > 0 &&
  validatePincode(a.pincode) === undefined;

const deliveryDone = (a: DeliveryAddress): boolean =>
  postalDone(a) &&
  a.label.trim().length > 0 &&
  validateFullName(a.contactName) === undefined &&
  validateMobile(a.contactMobile) === undefined &&
  a.days.length > 0 &&
  validateReceivingHours(a.opensAt, a.closesAt) === undefined;

/** Every block that has to be answered, counted the way the step is marked done. */
const checksOf = (values: ContactsValues): boolean[] => [
  ...CONTACT_ROLES.filter((r) => r.required).map((r) => personDone(values.contacts[r.code]!)),
  ...values.billing.map(postalDone),
  values.delivery.some(deliveryDone),
];

export const completionOf = (values: ContactsValues): number => {
  const checks = checksOf(values);
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

/* ==========================================================================
 * The step
 * ======================================================================== */

export interface StepContactsProps {
  answers: Record<string, unknown>;
  /** From step 3's saved answers. Never asked for again. */
  gstins: readonly string[];
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

export function StepContacts({
  answers,
  gstins,
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
  skipValidation = false,
}: StepContactsProps): React.JSX.Element {
  const [values, setValues] = React.useState<ContactsValues>(() =>
    readContactsDraft(answers, gstins),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  /**
   * Write the seeded billing rows once, on arrival.
   *
   * Without this, an applicant who lands here and closes the tab before their
   * first blur comes back to a step that has forgotten which registrations it
   * was billing — step 3 is COMPLETE by then, and a completed step's draft has
   * been cleared server-side.
   */
  // The ref holds the save so the effect can depend on nothing and still call
  // the current one. Arrival only — a draft per keystroke is what `onBlur`
  // exists to avoid.
  const arrival = React.useRef({ needed: !Array.isArray(answers.billing), save: (): void => {} });
  arrival.current.save = (): void => onSaveDraft(toDraft(values), completionOf(values));

  React.useEffect(() => {
    if (arrival.current.needed) arrival.current.save();
  }, []);

  const clearError = (key: string): void =>
    setErrors(({ [key]: _dropped, ...rest }) => rest);

  const persist = (next: ContactsValues): void => onSaveDraft(toDraft(next), completionOf(next));
  const saveOnBlur = (): void => persist(values);

  /**
   * A mobile settles into `+91XXXXXXXXXX` when the field is left, not when the
   * step is submitted. The draft is what the review screen reads back and what a
   * reviewer sees, and two forms of the same number in two places is the thing
   * `normaliseMobile` exists to prevent. The settled value is saved in the same
   * breath, rather than left for the next blur to notice.
   *
   * A number that is not one yet is left exactly as typed, so the field never
   * eats a half-finished entry.
   */
  const settled = (typed: string): string => toE164(typed) || typed;

  const setPerson = (role: string, patch: Partial<Person>): void =>
    setValues((v) => ({
      ...v,
      contacts: { ...v.contacts, [role]: { ...v.contacts[role]!, ...patch } },
    }));

  const setBilling = (index: number, patch: Partial<BillingAddress>): void =>
    setValues((v) => ({
      ...v,
      billing: v.billing.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    }));

  const setDelivery = (key: string, patch: Partial<DeliveryAddress>): void =>
    setValues((v) => ({
      ...v,
      delivery: v.delivery.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    }));

  const addDelivery = (): void =>
    setValues((v) => ({ ...v, delivery: [...v.delivery, emptyDelivery()] }));

  const removeDelivery = (key: string): void =>
    setValues((v) => {
      const rest = v.delivery.filter((d) => d.key !== key);
      const next = { ...v, delivery: rest.length > 0 ? rest : [emptyDelivery()] };
      persist(next);
      return next;
    });

  /* ------------------------------------------------------------ validation */

  const check = (v: ContactsValues): Record<string, string> => {
    const found: Record<string, string> = {};

    for (const role of CONTACT_ROLES) {
      const person = v.contacts[role.code]!;
      const touched =
        person.fullName.trim() || person.email.trim() || !isMobileBlank(person.mobile);
      // An optional contact is either absent or complete. Half of one is a
      // number nobody answers and an escalation that goes nowhere.
      if (!role.required && !touched) continue;
      const name = validateFullName(person.fullName);
      if (name) found[`${role.code}.fullName`] = name;
      const email = validateEmail(person.email);
      if (email) found[`${role.code}.email`] = email;
      const mobile = validateMobile(person.mobile);
      if (mobile) found[`${role.code}.mobile`] = mobile;
    }

    v.billing.forEach((address, index) => {
      const at = (field: string): string => `billing.${index}.${field}`;
      const line1 = validateLine1(address.line1);
      if (line1) found[at('line1')] = line1;
      const city = validateCity(address.city);
      if (city) found[at('city')] = city;
      if (!address.state) found[at('state')] = 'Choose the state on the registration.';
      const pincode = validatePincode(address.pincode);
      if (pincode) found[at('pincode')] = pincode;
      if (address.gstin && address.state) {
        const mismatch = billingStateMatchesGstin(address.gstin, address.state, stateName);
        if (mismatch) found[at('state')] = mismatch;
      }
    });

    v.delivery.forEach((address) => {
      const at = (field: string): string => `delivery.${address.key}.${field}`;
      if (!address.label.trim())
        found[at('label')] = 'Name this address — "Head office", "Gurugram warehouse".';
      const line1 = validateLine1(address.line1);
      if (line1) found[at('line1')] = line1;
      const city = validateCity(address.city);
      if (city) found[at('city')] = city;
      if (!address.state) found[at('state')] = 'Choose the state.';
      const pincode = validatePincode(address.pincode);
      if (pincode) found[at('pincode')] = pincode;
      const name = validateFullName(address.contactName);
      if (name) found[at('contactName')] = 'Name the person who signs for the delivery.';
      const mobile = validateMobile(address.contactMobile);
      if (mobile) found[at('contactMobile')] = mobile;
      if (!address.days) found[at('days')] = 'Choose the days this address accepts goods.';
      const hours = validateReceivingHours(address.opensAt, address.closesAt);
      if (hours) found[at('hours')] = hours;
    });

    return found;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found = skipValidation ? {} : check(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    // Normalised on the way out, so what is stored is what the server stores.
    const normalised: ContactsValues = {
      ...values,
      contacts: Object.fromEntries(
        Object.entries(values.contacts).map(([role, p]) => [
          role,
          { ...p, mobile: isMobileBlank(p.mobile) ? '' : toE164(p.mobile) },
        ]),
      ),
      delivery: values.delivery.map((d) => ({
        ...d,
        contactMobile: isMobileBlank(d.contactMobile) ? '' : toE164(d.contactMobile),
      })),
    };
    const refusal = await onContinue(toDraft(normalised), 100);
    if (refusal) setErrors(refusal);
  };

  const requiredContacts = CONTACT_ROLES.filter((r) => r.required);
  const contactsDone = requiredContacts.filter((r) => personDone(values.contacts[r.code]!)).length;

  /* ----------------------------------------------------------------- view */

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)} noValidate>
      {blockingReason && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {blockingReason}
        </p>
      )}

      {/* --------------------------------------------------------- contacts */}
      <FormSection
        title="Who we deal with"
        description="Three different people, usually. An order confirmation to the wrong one is an order nobody approves."
        status={
          <>
            <span className="tnum">{contactsDone}</span> of{' '}
            <span className="tnum">{requiredContacts.length}</span> required contacts
          </>
        }
      >
        {CONTACT_ROLES.map((role) => {
          const person = values.contacts[role.code]!;
          return (
            <fieldset
              key={role.code}
              data-testid={`contact-${role.code}`}
              className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-4"
            >
              <legend className="px-1 text-body-sm font-medium text-ink">
                {role.label}
                {!role.required && <span className="text-ink-3"> — optional</span>}
              </legend>
              <p className="text-body-sm text-ink-2">{role.purpose}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={`${role.label} contact name`}
                  required={role.required}
                  autoComplete="off"
                  value={person.fullName}
                  onFocus={() => onFieldFocus('Contacts and delivery')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setPerson(role.code, { fullName: e.target.value });
                    clearError(`${role.code}.fullName`);
                  }}
                  error={errors[`${role.code}.fullName`]}
                />
                <Input
                  label={`${role.label} designation`}
                  hint="Optional. What it says on their signature block."
                  value={person.designation}
                  onFocus={() => onFieldFocus('Contacts and delivery')}
                  onBlur={saveOnBlur}
                  onChange={(e) => setPerson(role.code, { designation: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={`${role.label} email`}
                  inputMode="email"
                  required={role.required}
                  value={person.email}
                  onFocus={() => onFieldFocus('Contacts and delivery')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setPerson(role.code, { email: e.target.value });
                    clearError(`${role.code}.email`);
                  }}
                  error={errors[`${role.code}.email`]}
                />
                <Input
                  label={`${role.label} mobile`}
                  mono
                  inputMode="tel"
                  required={role.required}
                  hint="Ten digits, or +91 followed by ten."
                  value={person.mobile}
                  onFocus={() => onFieldFocus('Contacts and delivery')}
                  onBlur={() => {
                    const mobile = settled(person.mobile);
                    const next = {
                      ...values,
                      contacts: { ...values.contacts, [role.code]: { ...person, mobile } },
                    };
                    setValues(next);
                    persist(next);
                  }}
                  onChange={(e) => {
                    setPerson(role.code, { mobile: typeMobile(e.target.value) });
                    clearError(`${role.code}.mobile`);
                  }}
                  error={errors[`${role.code}.mobile`]}
                />
              </div>
            </fieldset>
          );
        })}
      </FormSection>

      {/* ---------------------------------------------------------- billing */}
      <FormSection
        title="Billing address"
        description="One per GST registration. This is the address printed on the tax invoice for that registration."
        status={
          <>
            <span className="tnum">{values.billing.length}</span>{' '}
            {values.billing.length === 1 ? 'registration' : 'registrations'}
          </>
        }
      >
        {values.billing.map((address, index) => {
          const at = (field: string): string | undefined => errors[`billing.${index}.${field}`];
          const issuedIn = address.gstin
            ? stateNameForGstin(address.gstin)
            : undefined;
          return (
            <div
              key={address.gstin || `billing-${index}`}
              data-testid="billing-address"
              className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-4"
            >
              {address.gstin ? (
                <p className="flex flex-wrap items-baseline gap-2 text-body-sm text-ink-2">
                  <span className="font-mono text-data tnum text-ink">{address.gstin}</span>
                  {issuedIn ? (
                    <span>registered in {issuedIn}</span>
                  ) : (
                    <span className="text-ink-4">state not recognised</span>
                  )}
                </p>
              ) : (
                <p className="text-body-sm text-ink-2">
                  We could not read your GST registrations back on this device, so we are asking for
                  one billing address. Your reviewer matches it to your registrations.
                </p>
              )}
              <Input
                label="Building and street"
                required
                value={address.line1}
                onFocus={() => onFieldFocus('Billing address')}
                onBlur={saveOnBlur}
                onChange={(e) => {
                  setBilling(index, { line1: e.target.value });
                  clearError(`billing.${index}.line1`);
                }}
                error={at('line1')}
              />
              <Input
                label="Area or landmark"
                hint="Optional."
                value={address.line2}
                onFocus={() => onFieldFocus('Billing address')}
                onBlur={saveOnBlur}
                onChange={(e) => setBilling(index, { line2: e.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="City"
                  required
                  value={address.city}
                  onFocus={() => onFieldFocus('Billing address')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setBilling(index, { city: e.target.value });
                    clearError(`billing.${index}.city`);
                  }}
                  error={at('city')}
                />
                <Input
                  label="PIN code"
                  mono
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={address.pincode}
                  onFocus={() => onFieldFocus('Billing address')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setBilling(index, { pincode: e.target.value });
                    clearError(`billing.${index}.pincode`);
                  }}
                  error={at('pincode')}
                />
              </div>
              <Select
                label="State"
                required
                options={STATES}
                value={address.state}
                onFocus={() => onFieldFocus('Billing address')}
                onBlur={saveOnBlur}
                onChange={(e) => {
                  setBilling(index, { state: e.target.value });
                  clearError(`billing.${index}.state`);
                }}
                error={at('state')}
              />
            </div>
          );
        })}
      </FormSection>

      {/* --------------------------------------------------------- delivery */}
      <FormSection
        title="Where we deliver"
        description="Add every site that receives machines. You choose between them at checkout."
        status={
          <>
            <span className="tnum">{values.delivery.filter(deliveryDone).length}</span> of{' '}
            <span className="tnum">{values.delivery.length}</span> complete
          </>
        }
      >
        {values.delivery.map((address, index) => {
          const at = (field: string): string | undefined =>
            errors[`delivery.${address.key}.${field}`];
          return (
            <div
              key={address.key}
              data-testid="delivery-address"
              className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                  Address <span className="tnum">{index + 1}</span>
                </span>
                {values.delivery.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeDelivery(address.key)}
                  >
                    Remove
                  </Button>
                )}
              </div>

              <Input
                label="Name this address"
                hint='What your team calls it — "Head office", "Gurugram warehouse".'
                required
                value={address.label}
                onFocus={() => onFieldFocus('Contacts and delivery')}
                onBlur={saveOnBlur}
                onChange={(e) => {
                  setDelivery(address.key, { label: e.target.value });
                  clearError(`delivery.${address.key}.label`);
                }}
                error={at('label')}
              />
              <Input
                label="Building and street"
                required
                value={address.line1}
                onFocus={() => onFieldFocus('Contacts and delivery')}
                onBlur={saveOnBlur}
                onChange={(e) => {
                  setDelivery(address.key, { line1: e.target.value });
                  clearError(`delivery.${address.key}.line1`);
                }}
                error={at('line1')}
              />
              <Input
                label="Floor, unit or block"
                hint="Optional."
                value={address.line2}
                onFocus={() => onFieldFocus('Contacts and delivery')}
                onBlur={saveOnBlur}
                onChange={(e) => setDelivery(address.key, { line2: e.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="City"
                  required
                  value={address.city}
                  onFocus={() => onFieldFocus('Contacts and delivery')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setDelivery(address.key, { city: e.target.value });
                    clearError(`delivery.${address.key}.city`);
                  }}
                  error={at('city')}
                />
                <Input
                  label="PIN code"
                  mono
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={address.pincode}
                  onFocus={() => onFieldFocus('Contacts and delivery')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setDelivery(address.key, { pincode: e.target.value });
                    clearError(`delivery.${address.key}.pincode`);
                  }}
                  error={at('pincode')}
                />
              </div>
              <Select
                label="State"
                required
                options={STATES}
                value={address.state}
                onFocus={() => onFieldFocus('Contacts and delivery')}
                onBlur={saveOnBlur}
                onChange={(e) => {
                  setDelivery(address.key, { state: e.target.value });
                  clearError(`delivery.${address.key}.state`);
                }}
                error={at('state')}
              />
              <Input
                label="Landmark"
                hint="Optional, and worth more than the PIN code to a rider who has not been before."
                value={address.landmark}
                onFocus={() => onFieldFocus('Contacts and delivery')}
                onBlur={saveOnBlur}
                onChange={(e) => setDelivery(address.key, { landmark: e.target.value })}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Who signs for it"
                  required
                  value={address.contactName}
                  onFocus={() => onFieldFocus('Contacts and delivery')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setDelivery(address.key, { contactName: e.target.value });
                    clearError(`delivery.${address.key}.contactName`);
                  }}
                  error={at('contactName')}
                />
                <Input
                  label="Their mobile"
                  mono
                  inputMode="tel"
                  required
                  value={address.contactMobile}
                  onFocus={() => onFieldFocus('Contacts and delivery')}
                  onBlur={() => {
                    const contactMobile = settled(address.contactMobile);
                    const next = {
                      ...values,
                      delivery: values.delivery.map((d) =>
                        d.key === address.key ? { ...d, contactMobile } : d,
                      ),
                    };
                    setValues(next);
                    persist(next);
                  }}
                  onChange={(e) => {
                    setDelivery(address.key, { contactMobile: typeMobile(e.target.value) });
                    clearError(`delivery.${address.key}.contactMobile`);
                  }}
                  error={at('contactMobile')}
                />
              </div>

              <Input
                label="Gate instructions"
                hint='Optional. "Gate 3, ask for the security desk. No entry after 17:30."'
                value={address.gateInstructions}
                onFocus={() => onFieldFocus('Contacts and delivery')}
                onBlur={saveOnBlur}
                onChange={(e) => setDelivery(address.key, { gateInstructions: e.target.value })}
              />

              <Select
                label="Receiving days"
                required
                options={RECEIVING_DAYS}
                value={address.days}
                onFocus={() => onFieldFocus('Receiving hours')}
                onBlur={saveOnBlur}
                onChange={(e) => {
                  setDelivery(address.key, { days: e.target.value });
                  clearError(`delivery.${address.key}.days`);
                }}
                error={at('days')}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Opens at"
                  type="time"
                  mono
                  required
                  value={address.opensAt}
                  onFocus={() => onFieldFocus('Receiving hours')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setDelivery(address.key, { opensAt: e.target.value });
                    clearError(`delivery.${address.key}.hours`);
                  }}
                />
                <Input
                  label="Closes at"
                  type="time"
                  mono
                  required
                  value={address.closesAt}
                  onFocus={() => onFieldFocus('Receiving hours')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setDelivery(address.key, { closesAt: e.target.value });
                    clearError(`delivery.${address.key}.hours`);
                  }}
                />
              </div>
              {at('hours') && (
                <p role="alert" className="text-body-sm text-fail">
                  {at('hours')}
                </p>
              )}
              {address.days && address.opensAt && address.closesAt && !at('hours') && (
                <p className="text-body-sm text-ink-2">
                  We will deliver{' '}
                  <span className="text-ink">{labelFor(RECEIVING_DAYS, address.days)}</span>,{' '}
                  <span className="font-mono text-data tnum text-ink">
                    {address.opensAt}&ndash;{address.closesAt}
                  </span>
                  .
                </p>
              )}
            </div>
          );
        })}

        <div>
          <Button type="button" variant="ghost" onClick={addDelivery}>
            Add another delivery address
          </Button>
        </div>
      </FormSection>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
        <Button type="submit" variant="primary" loading={busy}>
          Save and continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSaveDraft(toDraft(values), completionOf(values))}
        >
          Save and finish later
        </Button>
      </div>
    </form>
  );
}
