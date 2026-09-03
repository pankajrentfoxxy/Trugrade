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
import { YesNo } from '../../register/YesNo';
import {
  FACILITY_TYPES,
  LANGUAGES,
  VEHICLE_ACCESS,
  VENDOR_CONTACT_ROLES,
  WEEK_DAYS,
  stateName,
} from '../../register/picklists';
import {
  isMobileBlank,
  MOBILE_PREFIX,
  toE164,
  typeMobile,
  validateCount,
  validateEmail,
  validateFullName,
  validateMobile,
  validateReceivingHours,
  validateWhatsapp,
} from '../../register/validation';

/**
 * Step 5 — Facility and contacts.
 *
 * **The dispatch address is the reason this step exists in the shape it does.**
 * `vendor_facility.dispatch_address_id` is nullable and falls back to the
 * facility's own address, and that fallback is the expensive kind of default: it
 * becomes **Dispatch From on every e-way bill** the vendor's goods ever travel
 * under. The registered address and the loading dock are frequently different
 * buildings — an office in a tower on MG Road and a shed in Sector 37 — and a
 * consignment whose e-way bill starts at the wrong one is a consignment that can
 * be detained, with a penalty against the *invoice value*. Correcting it after
 * the fact means a fresh e-way bill per consignment.
 *
 * So the screen does not default. It asks, per facility, with no answer
 * pre-selected, and then prints back the address it will actually put on the
 * document. A supplier who says "same" has said it; a supplier who has not
 * answered sees that they have not.
 *
 * **A day the warehouse is shut is an answer, not a blank.** `facility_hours`
 * has an `is_closed` column for exactly that, and a form that treats Sunday as
 * un-filled-in is a form that keeps asking. Every day must be either closed or
 * given a window, and a window that closes before it opens is refused with the
 * reason rather than silently stored.
 *
 * **`org_address.contact_name` is not asked per facility.** The column is NOT
 * NULL, and the person it wants is the warehouse contact below — asking for
 * them twice on one screen is how two answers to one question end up in the
 * database. The promotion writes the WAREHOUSE contact, or the operations
 * contact when no warehouse contact was given.
 */

/* ==========================================================================
 * Draft shape — the column names of `vendor.vendor_facility` and `org_contact`
 * ======================================================================== */

export interface DayHours {
  closed: boolean;
  opensAt: string;
  closesAt: string;
}

export interface Holiday {
  date: string;
  reason: string;
}

export interface Facility {
  /** Stable across a re-render and a resume. Stripped from the draft. */
  key: string;
  label: string;
  facilityType: string;
  address: PostalAddress;
  /** Null until answered. `true` writes `dispatch_address_id` NULL — see above. */
  dispatchSameAsFacility: boolean | null;
  dispatchAddress: PostalAddress;
  storageCapacityUnits: string;
  hasLoadingDock: boolean;
  vehicleAccess: string;
  liftAvailable: boolean;
  testingStations: string;
  specialInstructions: string;
  /** `facility_hours`, keyed by `day_of_week` as a string — JSON has no int keys. */
  hours: Record<string, DayHours>;
  holidays: Holiday[];
}

export interface VendorContact {
  fullName: string;
  designation: string;
  email: string;
  mobile: string;
  whatsapp: string;
  language: string;
}

export interface FacilityValues {
  facilities: Facility[];
  contacts: Record<string, VendorContact>;
}

const emptyContact = (): VendorContact => ({
  fullName: '',
  designation: '',
  email: '',
  mobile: MOBILE_PREFIX,
  whatsapp: MOBILE_PREFIX,
  language: '',
});

const emptyHours = (): Record<string, DayHours> =>
  Object.fromEntries(
    WEEK_DAYS.map((d) => [String(d.day), { closed: false, opensAt: '', closesAt: '' }]),
  );

let keySeed = 0;
const nextKey = (): string => {
  keySeed += 1;
  return `f${keySeed}`;
};

const emptyFacility = (): Facility => ({
  key: nextKey(),
  label: '',
  facilityType: '',
  address: emptyPostal(),
  dispatchSameAsFacility: null,
  dispatchAddress: emptyPostal(),
  storageCapacityUnits: '',
  hasLoadingDock: false,
  vehicleAccess: '',
  liftAvailable: false,
  testingStations: '',
  specialInstructions: '',
  hours: emptyHours(),
  holidays: [],
});

export function readFacilityDraft(answers: Record<string, unknown>): FacilityValues {
  const savedFacilities = Array.isArray(answers.facilities)
    ? (answers.facilities as Partial<Facility>[])
    : [];
  const facilities =
    savedFacilities.length > 0
      ? savedFacilities.map((f) => ({
          ...emptyFacility(),
          ...f,
          key: nextKey(),
          address: { ...emptyPostal(), ...(f.address ?? {}) },
          dispatchAddress: { ...emptyPostal(), ...(f.dispatchAddress ?? {}) },
          hours: { ...emptyHours(), ...(f.hours ?? {}) },
          holidays: Array.isArray(f.holidays) ? f.holidays : [],
        }))
      : [emptyFacility()];

  const savedContacts = (answers.contacts ?? {}) as Record<string, Partial<VendorContact>>;
  const contacts: Record<string, VendorContact> = {};
  for (const role of VENDOR_CONTACT_ROLES) {
    const saved = savedContacts[role.code] ?? {};
    contacts[role.code] = {
      ...emptyContact(),
      ...saved,
      mobile: typeMobile(typeof saved.mobile === 'string' ? saved.mobile : ''),
      whatsapp: typeMobile(typeof saved.whatsapp === 'string' ? saved.whatsapp : ''),
    };
  }

  return { facilities, contacts };
}

/** Only what the API should keep. The React key is regenerated on read. */
const toDraft = (values: FacilityValues): Record<string, unknown> => ({
  facilities: values.facilities.map(({ key: _key, ...rest }) => rest),
  contacts: values.contacts,
});

/* ==========================================================================
 * Completeness
 * ======================================================================== */

const CAPACITY_RULE = {
  required: false,
  min: 0,
  max: 100000,
  unit: 'laptops',
  missing: '',
};

const STATIONS_RULE = {
  required: false,
  min: 0,
  max: 500,
  unit: 'stations',
  missing: '',
};

const dayAnswered = (hours: DayHours): boolean =>
  hours.closed || validateReceivingHours(hours.opensAt, hours.closesAt) === undefined;

const hoursAnswered = (facility: Facility): boolean =>
  WEEK_DAYS.every((d) =>
    dayAnswered(facility.hours[String(d.day)] ?? { closed: false, opensAt: '', closesAt: '' }),
  );

export const facilityDone = (facility: Facility): boolean =>
  facility.label.trim().length > 0 &&
  facility.facilityType.length > 0 &&
  postalComplete(facility.address) &&
  facility.vehicleAccess.length > 0 &&
  facility.dispatchSameAsFacility !== null &&
  (facility.dispatchSameAsFacility || postalComplete(facility.dispatchAddress)) &&
  hoursAnswered(facility);

const contactDone = (c: VendorContact): boolean =>
  validateFullName(c.fullName) === undefined &&
  validateEmail(c.email) === undefined &&
  validateMobile(c.mobile) === undefined;

const checksOf = (values: FacilityValues): boolean[] => [
  ...values.facilities.map(facilityDone),
  ...VENDOR_CONTACT_ROLES.filter((r) => r.required).map((r) =>
    contactDone(values.contacts[r.code]!),
  ),
];

export const completionOf = (values: FacilityValues): number => {
  const checks = checksOf(values);
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

/** "Plot 61, Sector 37, Gurugram 122004, Haryana" — one line, for a document. */
export const oneLine = (a: PostalAddress): string =>
  [a.line1, a.line2, a.city, a.pincode, stateName(a.state)].filter(Boolean).join(', ');

/* ==========================================================================
 * The step
 * ======================================================================== */

export interface StepFacilityProps {
  answers: Record<string, unknown>;
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

export function StepFacility({
  answers,
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
  skipValidation = false,
}: StepFacilityProps): React.JSX.Element {
  const [values, setValues] = React.useState<FacilityValues>(() => readFacilityDraft(answers));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const persist = (next: FacilityValues): void => onSaveDraft(toDraft(next), completionOf(next));
  const saveOnBlur = (): void => persist(values);

  const clearError = (key: string): void => setErrors(({ [key]: _dropped, ...rest }) => rest);
  const clearPrefix = (prefix: string): void =>
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(prefix))));

  /** A mobile settles into `+91XXXXXXXXXX` on blur — see `StepContacts`. */
  const settled = (typed: string): string => toE164(typed) || typed;

  const patchFacility = (key: string, patch: Partial<Facility>): FacilityValues => ({
    ...values,
    facilities: values.facilities.map((f) => (f.key === key ? { ...f, ...patch } : f)),
  });

  const setFacility = (key: string, patch: Partial<Facility>): void =>
    setValues(patchFacility(key, patch));

  /** A control with no blur of its own writes through immediately. */
  const setFacilityAndSave = (key: string, patch: Partial<Facility>): void => {
    const next = patchFacility(key, patch);
    setValues(next);
    persist(next);
  };

  const setHours = (key: string, day: number, patch: Partial<DayHours>): FacilityValues => {
    const facility = values.facilities.find((f) => f.key === key)!;
    const current = facility.hours[String(day)] ?? { closed: false, opensAt: '', closesAt: '' };
    return patchFacility(key, {
      hours: { ...facility.hours, [String(day)]: { ...current, ...patch } },
    });
  };

  const addFacility = (): void =>
    setValues((v) => ({ ...v, facilities: [...v.facilities, emptyFacility()] }));

  const removeFacility = (key: string): void => {
    const rest = values.facilities.filter((f) => f.key !== key);
    const next = { ...values, facilities: rest.length > 0 ? rest : [emptyFacility()] };
    setValues(next);
    clearPrefix(`facility.${key}.`);
    persist(next);
  };

  /**
   * Monday's window onto every other open day.
   *
   * Not a default and not a pre-fill — nothing happens until somebody presses
   * it. Seven days times however many sites is the kind of form people abandon,
   * and the alternative to a button is a screen that assumes 09:00 to 18:00 on
   * behalf of a dock that shuts at 16:30.
   */
  const copyMonday = (key: string): void => {
    const facility = values.facilities.find((f) => f.key === key)!;
    const monday = facility.hours['1'];
    if (!monday || monday.closed) return;
    const hours = Object.fromEntries(
      Object.entries(facility.hours).map(([day, value]) => [
        day,
        value.closed ? value : { ...value, opensAt: monday.opensAt, closesAt: monday.closesAt },
      ]),
    );
    setFacilityAndSave(key, { hours });
    clearPrefix(`facility.${key}.hours`);
  };

  const addHoliday = (key: string): void => {
    const facility = values.facilities.find((f) => f.key === key)!;
    setFacility(key, { holidays: [...facility.holidays, { date: '', reason: '' }] });
  };

  const setHoliday = (key: string, index: number, patch: Partial<Holiday>): void => {
    const facility = values.facilities.find((f) => f.key === key)!;
    setFacility(key, {
      holidays: facility.holidays.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    });
  };

  const removeHoliday = (key: string, index: number): void => {
    const facility = values.facilities.find((f) => f.key === key)!;
    setFacilityAndSave(key, { holidays: facility.holidays.filter((_, i) => i !== index) });
  };

  const setContact = (role: string, patch: Partial<VendorContact>): void =>
    setValues((v) => ({
      ...v,
      contacts: { ...v.contacts, [role]: { ...v.contacts[role]!, ...patch } },
    }));

  /* ------------------------------------------------------------ validation */

  const check = (v: FacilityValues): Record<string, string> => {
    const found: Record<string, string> = {};

    v.facilities.forEach((facility) => {
      const at = (field: string): string => `facility.${facility.key}.${field}`;
      if (!facility.label.trim())
        found[at('label')] = 'Name this site — "Sector 37 warehouse", "Okhla refurb unit".';
      if (!facility.facilityType)
        found[at('facilityType')] =
          'Tell us what this site is. It decides whether we send a QC technician here.';
      for (const [field, message] of Object.entries(postalErrors(facility.address)))
        found[at(`address.${field}`)] = message;
      if (!facility.vehicleAccess)
        found[at('vehicleAccess')] =
          'Tell us the largest vehicle that can reach the loading point. A truck sent to a lane it cannot enter is a pick-up that does not happen.';

      const capacity = validateCount(facility.storageCapacityUnits, CAPACITY_RULE);
      if (capacity) found[at('storageCapacityUnits')] = capacity;
      const stations = validateCount(facility.testingStations, STATIONS_RULE);
      if (stations) found[at('testingStations')] = stations;

      if (facility.dispatchSameAsFacility === null)
        found[at('dispatch')] =
          'Answer this before you continue. Whichever address you name here is printed as “Dispatch From” on the e-way bill for every consignment that leaves this site, and correcting it afterwards means a fresh e-way bill per consignment.';
      else if (!facility.dispatchSameAsFacility)
        for (const [field, message] of Object.entries(postalErrors(facility.dispatchAddress)))
          found[at(`dispatchAddress.${field}`)] = message;

      for (const day of WEEK_DAYS) {
        const hours = facility.hours[String(day.day)] ?? {
          closed: false,
          opensAt: '',
          closesAt: '',
        };
        if (hours.closed) continue;
        const problem = validateReceivingHours(hours.opensAt, hours.closesAt);
        if (problem)
          found[at(`hours.${day.day}`)] =
            hours.opensAt || hours.closesAt
              ? problem
              : `Give ${day.label}’s hours, or tick “closed” — a day left blank is a day we do not know about.`;
      }

      facility.holidays.forEach((holiday, index) => {
        if (!holiday.date)
          found[at(`holiday.${index}`)] =
            'Give the date, or remove the row. A holiday with no date stops nothing.';
      });
    });

    for (const role of VENDOR_CONTACT_ROLES) {
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
      const whatsapp = validateWhatsapp(person.whatsapp);
      if (whatsapp) found[`${role.code}.whatsapp`] = whatsapp;
    }

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
    const normalised: FacilityValues = {
      ...values,
      contacts: Object.fromEntries(
        Object.entries(values.contacts).map(([role, p]) => [
          role,
          {
            ...p,
            mobile: isMobileBlank(p.mobile) ? '' : toE164(p.mobile),
            whatsapp: isMobileBlank(p.whatsapp) ? '' : toE164(p.whatsapp),
          },
        ]),
      ),
    };
    const refusal = await onContinue(toDraft(normalised), 100);
    if (refusal) setErrors(refusal);
  };

  /* ----------------------------------------------------------------- view */

  const requiredContacts = VENDOR_CONTACT_ROLES.filter((r) => r.required);
  const contactsDone = requiredContacts.filter((r) => contactDone(values.contacts[r.code]!)).length;

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

      {/* ------------------------------------------------------- facilities */}
      <FormSection
        title="Where your stock actually sits"
        description="Add every site a machine can be picked up from. Each one gets its own dispatch address, its own hours and its own access notes, because a carrier is sent to a site rather than to a company."
        status={
          <>
            <span className="tnum">{values.facilities.filter(facilityDone).length}</span> of{' '}
            <span className="tnum">{values.facilities.length}</span> complete
          </>
        }
      >
        {values.facilities.map((facility, index) => {
          const at = (field: string): string | undefined =>
            errors[`facility.${facility.key}.${field}`];
          const dispatchFrom = facility.dispatchSameAsFacility
            ? facility.address
            : facility.dispatchAddress;

          return (
            <div
              key={facility.key}
              data-testid="facility"
              className="flex flex-col gap-4 rounded-lg border border-rule bg-sheet p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                  Site <span className="tnum">{index + 1}</span>
                </span>
                {values.facilities.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeFacility(facility.key)}
                  >
                    Remove this site
                  </Button>
                )}
              </div>

              <Input
                label="Name this site"
                hint='What your team calls it — "Sector 37 warehouse".'
                required
                value={facility.label}
                onFocus={() => onFieldFocus('Facilities')}
                onBlur={saveOnBlur}
                onChange={(e) => {
                  setFacility(facility.key, { label: e.target.value });
                  clearError(`facility.${facility.key}.label`);
                }}
                error={at('label')}
              />
              <Select
                label="What this site is"
                required
                options={FACILITY_TYPES}
                value={facility.facilityType}
                onFocus={() => onFieldFocus('Facilities')}
                onBlur={saveOnBlur}
                onChange={(e) => {
                  setFacility(facility.key, { facilityType: e.target.value });
                  clearError(`facility.${facility.key}.facilityType`);
                }}
                error={at('facilityType')}
              />

              <AddressFields
                value={facility.address}
                errors={{
                  line1: at('address.line1'),
                  city: at('address.city'),
                  state: at('address.state'),
                  pincode: at('address.pincode'),
                }}
                onChange={(patch) => {
                  setFacility(facility.key, { address: { ...facility.address, ...patch } });
                  clearPrefix(`facility.${facility.key}.address.`);
                }}
                onBlur={saveOnBlur}
                onFocus={() => onFieldFocus('Facilities')}
              />

              {/* ------------------------------------------ dispatch address */}
              <div
                data-testid="dispatch"
                className="flex flex-col gap-3 rounded border border-rule-2 bg-sheet-2 p-4"
              >
                <YesNo
                  legend="Do goods physically leave from the address above?"
                  name={`dispatch-${facility.key}`}
                  required
                  value={facility.dispatchSameAsFacility}
                  onChange={(same) => {
                    setFacilityAndSave(facility.key, { dispatchSameAsFacility: same });
                    clearError(`facility.${facility.key}.dispatch`);
                  }}
                  onFocus={() => onFieldFocus('Dispatch address')}
                  description={
                    <>
                      Whichever address you name here is printed as{' '}
                      <span className="text-ink">Dispatch From</span> on the e-way bill for every
                      consignment that leaves this site. A registered office and a loading dock are
                      often two different buildings, and a consignment whose e-way bill starts at
                      the wrong one can be detained.
                    </>
                  }
                  yesLabel="Yes — same address"
                  noLabel="No — goods leave from somewhere else"
                  noConsequence="Give the address the lorry is actually loaded at, including the gate and the plot number."
                  error={at('dispatch')}
                />

                {facility.dispatchSameAsFacility === false && (
                  <AddressFields
                    line1Label="Dispatch building and street"
                    value={facility.dispatchAddress}
                    errors={{
                      line1: at('dispatchAddress.line1'),
                      city: at('dispatchAddress.city'),
                      state: at('dispatchAddress.state'),
                      pincode: at('dispatchAddress.pincode'),
                    }}
                    onChange={(patch) => {
                      setFacility(facility.key, {
                        dispatchAddress: { ...facility.dispatchAddress, ...patch },
                      });
                      clearPrefix(`facility.${facility.key}.dispatchAddress.`);
                    }}
                    onBlur={saveOnBlur}
                    onFocus={() => onFieldFocus('Dispatch address')}
                  />
                )}

                {/* The document line, printed back. Never a tick — either we can
                    show the address that will appear, or we say we cannot yet. */}
                <p className="text-body-sm text-ink-2">
                  <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                    Dispatch From
                  </span>
                  <span className="mt-1 block">
                    {facility.dispatchSameAsFacility === null ? (
                      <span className="text-ink-4">Not answered — no address will be printed.</span>
                    ) : postalComplete(dispatchFrom) ? (
                      <span className="text-ink">{oneLine(dispatchFrom)}</span>
                    ) : (
                      <span className="text-ink-4">
                        Not provided — finish the address above and it appears here.
                      </span>
                    )}
                  </span>
                </p>
              </div>

              {/* ------------------------------------------------- the dock */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Machines this site can hold"
                  mono
                  inputMode="numeric"
                  hint="Optional. Roughly, at full stretch."
                  value={facility.storageCapacityUnits}
                  onFocus={() => onFieldFocus('Facilities')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setFacility(facility.key, { storageCapacityUnits: e.target.value });
                    clearError(`facility.${facility.key}.storageCapacityUnits`);
                  }}
                  error={at('storageCapacityUnits')}
                />
                <Input
                  label="Testing stations here"
                  mono
                  inputMode="numeric"
                  hint="Optional. Benches where a machine can be powered up and checked."
                  value={facility.testingStations}
                  onFocus={() => onFieldFocus('Facilities')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setFacility(facility.key, { testingStations: e.target.value });
                    clearError(`facility.${facility.key}.testingStations`);
                  }}
                  error={at('testingStations')}
                />
              </div>
              {facility.storageCapacityUnits.trim() === '' && (
                <p className="text-body-sm text-ink-4">Storage capacity not provided.</p>
              )}

              <Select
                label="Largest vehicle that can reach the loading point"
                required
                options={VEHICLE_ACCESS}
                value={facility.vehicleAccess}
                onFocus={() => onFieldFocus('Facilities')}
                onBlur={saveOnBlur}
                onChange={(e) => {
                  setFacility(facility.key, { vehicleAccess: e.target.value });
                  clearError(`facility.${facility.key}.vehicleAccess`);
                }}
                error={at('vehicleAccess')}
              />
              <Checkbox
                label="There is a loading dock"
                consequence="A dock means a tail-lift is not needed and a pallet can come straight off the truck."
                checked={facility.hasLoadingDock}
                onChange={(v) => setFacilityAndSave(facility.key, { hasLoadingDock: v })}
              />
              <Checkbox
                label="There is a working goods lift"
                consequence="Without one we send a second person for anything above the ground floor."
                checked={facility.liftAvailable}
                onChange={(v) => setFacilityAndSave(facility.key, { liftAvailable: v })}
              />
              <Input
                label="Anything a driver needs to know"
                hint='Optional. "Gate 3, ask for the security desk. No entry after 17:30."'
                value={facility.specialInstructions}
                onFocus={() => onFieldFocus('Facilities')}
                onBlur={saveOnBlur}
                onChange={(e) => setFacility(facility.key, { specialInstructions: e.target.value })}
              />

              {/* ------------------------------------------ operating hours */}
              <div
                role="group"
                aria-label={`Operating hours for site ${index + 1}`}
                className="flex flex-col gap-3 rounded border border-rule-2 bg-sheet-2 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="text-body-sm font-medium text-ink">Operating hours</span>
                  <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                    <span className="tnum">
                      {
                        WEEK_DAYS.filter((d) =>
                          dayAnswered(
                            facility.hours[String(d.day)] ?? {
                              closed: false,
                              opensAt: '',
                              closesAt: '',
                            },
                          ),
                        ).length
                      }
                    </span>{' '}
                    of <span className="tnum">{WEEK_DAYS.length}</span> days answered
                  </span>
                </div>
                <p className="text-body-sm text-ink-2">
                  A day you are shut is an answer — tick it. It is what stops us booking a pick-up
                  nobody is there for.
                </p>

                {WEEK_DAYS.map((day) => {
                  const hours = facility.hours[String(day.day)] ?? {
                    closed: false,
                    opensAt: '',
                    closesAt: '',
                  };
                  const problem = at(`hours.${day.day}`);
                  return (
                    <div key={day.day} className="flex flex-col gap-2">
                      <div className="grid items-end gap-3 sm:grid-cols-[6rem_1fr_1fr_auto]">
                        <span className="text-body-sm font-medium text-ink-2 sm:pb-3">
                          {day.label}
                        </span>
                        <Input
                          label="Opens"
                          type="time"
                          mono
                          disabled={hours.closed}
                          value={hours.opensAt}
                          onFocus={() => onFieldFocus('Operating hours')}
                          onBlur={saveOnBlur}
                          onChange={(e) => {
                            setValues(setHours(facility.key, day.day, { opensAt: e.target.value }));
                            clearError(`facility.${facility.key}.hours.${day.day}`);
                          }}
                        />
                        <Input
                          label="Closes"
                          type="time"
                          mono
                          disabled={hours.closed}
                          value={hours.closesAt}
                          onFocus={() => onFieldFocus('Operating hours')}
                          onBlur={saveOnBlur}
                          onChange={(e) => {
                            setValues(
                              setHours(facility.key, day.day, { closesAt: e.target.value }),
                            );
                            clearError(`facility.${facility.key}.hours.${day.day}`);
                          }}
                        />
                        <Checkbox
                          label="Closed"
                          checked={hours.closed}
                          onChange={(closed) => {
                            // The window goes with the answer. `facility_hours`
                            // stores NULL times against `is_closed`, and a shut
                            // day still showing 09:30–18:00 is a value that
                            // contradicts the tick beside it.
                            const next = setHours(
                              facility.key,
                              day.day,
                              closed ? { closed, opensAt: '', closesAt: '' } : { closed },
                            );
                            setValues(next);
                            persist(next);
                            clearError(`facility.${facility.key}.hours.${day.day}`);
                          }}
                          className="sm:pb-3"
                        />
                      </div>
                      {problem && (
                        <p role="alert" className="text-body-sm text-fail">
                          {problem}
                        </p>
                      )}
                    </div>
                  );
                })}

                <div>
                  <Button type="button" variant="ghost" onClick={() => copyMonday(facility.key)}>
                    Copy Monday’s hours to every open day
                  </Button>
                </div>
              </div>

              {/* ----------------------------------------------- holidays */}
              <div
                role="group"
                aria-label={`Holidays for site ${index + 1}`}
                className="flex flex-col gap-3 rounded border border-rule-2 bg-sheet-2 p-4"
              >
                <span className="text-body-sm font-medium text-ink">Holidays</span>
                <p className="text-body-sm text-ink-2">
                  Days this site is shut on top of the weekly pattern. We will not book a pick-up on
                  one.
                </p>
                {facility.holidays.length === 0 ? (
                  <p className="text-body-sm text-ink-4">No holidays listed.</p>
                ) : (
                  facility.holidays.map((holiday, holidayIndex) => (
                    <div
                      key={`${facility.key}-holiday-${holidayIndex}`}
                      className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
                    >
                      <Input
                        label="Date"
                        type="date"
                        mono
                        value={holiday.date}
                        onFocus={() => onFieldFocus('Facilities')}
                        onBlur={saveOnBlur}
                        onChange={(e) => {
                          setHoliday(facility.key, holidayIndex, { date: e.target.value });
                          clearError(`facility.${facility.key}.holiday.${holidayIndex}`);
                        }}
                        error={at(`holiday.${holidayIndex}`)}
                      />
                      <Input
                        label="Reason"
                        hint="Optional. Diwali, stock take, annual shutdown."
                        value={holiday.reason}
                        onFocus={() => onFieldFocus('Facilities')}
                        onBlur={saveOnBlur}
                        onChange={(e) =>
                          setHoliday(facility.key, holidayIndex, { reason: e.target.value })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => removeHoliday(facility.key, holidayIndex)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))
                )}
                <div>
                  <Button type="button" variant="ghost" onClick={() => addHoliday(facility.key)}>
                    Add a holiday
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        <div>
          <Button type="button" variant="ghost" onClick={addFacility}>
            Add another site
          </Button>
        </div>
      </FormSection>

      {/* --------------------------------------------------------- contacts */}
      <FormSection
        title="Who we deal with"
        description="Four different people, usually. A purchase order to the wrong one is a machine nobody packs."
        status={
          <>
            <span className="tnum">{contactsDone}</span> of{' '}
            <span className="tnum">{requiredContacts.length}</span> required contacts
          </>
        }
      >
        {VENDOR_CONTACT_ROLES.map((role) => {
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
                  onFocus={() => onFieldFocus('Contacts')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setContact(role.code, { fullName: e.target.value });
                    clearError(`${role.code}.fullName`);
                  }}
                  error={errors[`${role.code}.fullName`]}
                />
                <Input
                  label={`${role.label} designation`}
                  hint="Optional. What it says on their signature block."
                  value={person.designation}
                  onFocus={() => onFieldFocus('Contacts')}
                  onBlur={saveOnBlur}
                  onChange={(e) => setContact(role.code, { designation: e.target.value })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={`${role.label} email`}
                  inputMode="email"
                  required={role.required}
                  value={person.email}
                  onFocus={() => onFieldFocus('Contacts')}
                  onBlur={saveOnBlur}
                  onChange={(e) => {
                    setContact(role.code, { email: e.target.value });
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
                  onFocus={() => onFieldFocus('Contacts')}
                  onBlur={() => {
                    const next = {
                      ...values,
                      contacts: {
                        ...values.contacts,
                        [role.code]: { ...person, mobile: settled(person.mobile) },
                      },
                    };
                    setValues(next);
                    persist(next);
                  }}
                  onChange={(e) => {
                    setContact(role.code, { mobile: typeMobile(e.target.value) });
                    clearError(`${role.code}.mobile`);
                  }}
                  error={errors[`${role.code}.mobile`]}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={`${role.label} WhatsApp number`}
                  mono
                  inputMode="tel"
                  hint="Optional. Dispatch notes and pick-up windows go here if you give it."
                  value={person.whatsapp}
                  onFocus={() => onFieldFocus('WhatsApp and language')}
                  onBlur={() => {
                    const next = {
                      ...values,
                      contacts: {
                        ...values.contacts,
                        [role.code]: { ...person, whatsapp: settled(person.whatsapp) },
                      },
                    };
                    setValues(next);
                    persist(next);
                  }}
                  onChange={(e) => {
                    setContact(role.code, { whatsapp: typeMobile(e.target.value) });
                    clearError(`${role.code}.whatsapp`);
                  }}
                  error={errors[`${role.code}.whatsapp`]}
                />
                <Select
                  label={`${role.label} preferred language`}
                  hint="Optional. What we write to them in."
                  options={LANGUAGES}
                  value={person.language}
                  onFocus={() => onFieldFocus('WhatsApp and language')}
                  onBlur={saveOnBlur}
                  onChange={(e) => setContact(role.code, { language: e.target.value })}
                />
              </div>

              {/* A missing value never renders as a provided one — and a
                  contact who answered both leaves no empty line behind. */}
              {(isMobileBlank(person.whatsapp) || person.language === '') && (
                <p className="text-body-sm text-ink-4">
                  {isMobileBlank(person.whatsapp) && 'WhatsApp number not provided. '}
                  {person.language === '' &&
                    'Preferred language not stated — we will write in English.'}
                </p>
              )}
            </fieldset>
          );
        })}
      </FormSection>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
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
