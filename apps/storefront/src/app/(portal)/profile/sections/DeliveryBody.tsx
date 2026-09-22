'use client';

import * as React from 'react';
import { Chip, Input } from '@trugrade/ui';
import { completeStep, saveStep, type AccountHolderDetails } from '../../../register/api';
import { PincodeLocalityFields } from '../../../register/PincodeLocalityFields';
import {
  isMobileBlank,
  toE164,
  typeMobile,
  validateCity,
  validateFullName,
  validateLine1,
  validateMobile,
  validatePincode,
} from '../../../register/validation';
import type { StepBodyProps } from './step-body';

/**
 * Delivery: one site, and the window it receives in.
 *
 * **Three typed fields, against the twenty this card used to hold.** It was one
 * all-or-nothing step of five sub-steps — a procurement contact, a finance
 * contact, an IT contact, the billing address and the site — that only counted
 * for anything on the fifth. What is left here is what a rider and an e-way
 * bill genuinely need:
 *
 * - Name the site, the street, the pincode. City and state fill themselves from
 *   the pincode directory and are read-only. Gate instructions sit directly
 *   under them, because that is what they are — the last line of the address.
 * - Who signs is the account holder, and the card neither asks it nor restates
 *   it. The person who opened the account is the person a delivery OTP reaches;
 *   naming somebody else is an edit to the address, not a question to open
 *   with, and repeating their own name back at them was not an answer to
 *   anything. It still travels with the site — `org_address` needs a contact —
 *   and if the account is missing a usable name or mobile the card says which
 *   card to go and fix rather than failing on a field that is not shown.
 * - The window is one chip carrying its own hours, the four the supplier hub
 *   already offers for collection. A chip that reads "Mon–Fri 10–6" makes two
 *   time pickers under it redundant.
 *
 * The finance and IT contacts moved to the team screen, where people belong,
 * and neither blocks an order. The billing row written by the Tax card is
 * carried through untouched — `promoteContactsAddresses` writes billing and
 * delivery together, and this is the card that completes the step.
 */

interface ReceivingWindow {
  id: string;
  label: string;
  /** `RECEIVING_DAYS` on the promotion side, which writes the driver's line. */
  days: string;
  opensAt: string;
  closesAt: string;
}

/**
 * The four windows, each carrying the hours its label promises.
 *
 * Days and hours still travel to the API as three separate answers because
 * `org_address` has no columns for them — promotion folds them into
 * `delivery_instructions` as a sentence. The chip is the question asked; those
 * three fields are only how the answer is stored.
 */
const WINDOWS: readonly ReceivingWindow[] = [
  {
    id: 'MON_FRI_10_6',
    label: 'Mon–Fri 10–6',
    days: 'MON_FRI',
    opensAt: '10:00',
    closesAt: '18:00',
  },
  {
    id: 'MON_SAT_10_6',
    label: 'Mon–Sat 10–6',
    days: 'MON_SAT',
    opensAt: '10:00',
    closesAt: '18:00',
  },
  { id: 'MON_SAT_9_8', label: 'Mon–Sat 9–8', days: 'MON_SAT', opensAt: '09:00', closesAt: '20:00' },
  { id: 'ALL_DAYS', label: 'All days', days: 'ALL', opensAt: '09:00', closesAt: '20:00' },
];

const DEFAULT_WINDOW: ReceivingWindow = WINDOWS[0]!;

export interface DeliveryBodyProps extends StepBodyProps {
  /** Saved CONTACTS_ADDRESSES answers: the billing row and any saved site. */
  initial: Record<string, unknown>;
  accountHolder: AccountHolderDetails;
  blockingReason?: string | null;
}

interface SiteValues {
  label: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
  gateInstructions: string;
  windowId: string;
}

const str = (row: Record<string, unknown>, key: string): string =>
  typeof row[key] === 'string' ? (row[key] as string) : '';

/** Saved days and hours, read back as the chip that produces them. */
function windowIdFrom(saved: Record<string, unknown>): string {
  const match = WINDOWS.find(
    (w) =>
      w.days === str(saved, 'days') &&
      w.opensAt === str(saved, 'opensAt') &&
      w.closesAt === str(saved, 'closesAt'),
  );
  return (match ?? DEFAULT_WINDOW).id;
}

function readSite(initial: Record<string, unknown>, account: AccountHolderDetails): SiteValues {
  const rows = initial.delivery;
  const saved =
    (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined) ?? {};
  return {
    label: str(saved, 'label'),
    line1: str(saved, 'line1'),
    line2: str(saved, 'line2'),
    city: str(saved, 'city'),
    state: str(saved, 'state'),
    pincode: str(saved, 'pincode'),
    // Nothing saved yet: the account holder signs, because they are the person
    // a delivery code can actually reach.
    contactName: str(saved, 'contactName') || account.fullName,
    contactMobile: typeMobile(str(saved, 'contactMobile') || account.mobile),
    gateInstructions: str(saved, 'gateInstructions'),
    windowId: windowIdFrom(saved),
  };
}

export function DeliveryBody({
  initial,
  accountHolder,
  blockingReason,
  registerSubmit,
  onBusy,
  onFrame,
  onSaved,
}: DeliveryBodyProps): React.JSX.Element {
  const [site, setSite] = React.useState<SiteValues>(() => readSite(initial, accountHolder));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    onFrame({ index: 1, count: 1, primaryLabel: 'Save' });
  }, [onFrame]);

  /**
   * A field edit also drops that field's message. The sentence named a
   * problem with what was in the box; once the box changes it is about text
   * that is no longer there, and a red message under a box that has since
   * been filled reads as "still wrong". The next save says whether the new
   * text is right.
   */
  const patch = (next: Partial<SiteValues>): void => {
    setSite((s) => ({ ...s, ...next }));
    setErrors((e) => {
      const touched = Object.keys(next).filter((k) => k in e);
      if (touched.length === 0) return e;
      const rest = { ...e };
      for (const k of touched) delete rest[k];
      return rest;
    });
  };
  const noop = (): void => undefined;

  const check = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (!site.label.trim()) found.label = 'Name this site — "Head office", "Gurugram warehouse".';
    const line1 = validateLine1(site.line1);
    if (line1) found.line1 = line1;
    const pincode = validatePincode(site.pincode);
    if (pincode) found.pincode = pincode;
    const city = validateCity(site.city);
    if (city) found.city = city;
    if (!site.state) found.state = 'The pincode decides the state. Check the pincode.';
    return found;
  };

  /**
   * The signatory is not a field on this card, so a bad one is not a red
   * border — it is a sentence saying which card to go and fix.
   */
  const signatoryProblem = (): string | undefined => {
    if (validateFullName(site.contactName)) {
      return 'A delivery has to be signed for, and we use your own name. Fill in your full name on the Account card first.';
    }
    const mobile = isMobileBlank(site.contactMobile)
      ? 'missing'
      : (validateMobile(site.contactMobile) ?? '');
    if (!mobile) return undefined;
    return 'The delivery code goes to your mobile number, and your account does not have a usable one. Fix it on the Account card first.';
  };

  const save = async (): Promise<void> => {
    const found = check();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const signatory = signatoryProblem();
    if (signatory) {
      setError(signatory);
      return;
    }
    setError(undefined);
    onBusy(true);

    const chosen = WINDOWS.find((w) => w.id === site.windowId) ?? DEFAULT_WINDOW;
    const { windowId: _windowId, ...typed } = site;
    const settled = {
      ...typed,
      contactMobile: toE164(site.contactMobile) || site.contactMobile,
      days: chosen.days,
      opensAt: chosen.opensAt,
      closesAt: chosen.closesAt,
    };
    const saved = await saveStep(
      'CONTACTS_ADDRESSES',
      // Everything the Tax card wrote — the billing row and the named person —
      // carried through untouched. Only the site is this card's to change.
      { ...initial, delivery: [settled] },
      100,
    );
    if (!saved.ok) {
      onBusy(false);
      setError(Object.values(saved.fields)[0] ?? saved.message);
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

  const saveRef = React.useRef(save);
  saveRef.current = save;
  React.useEffect(() => {
    registerSubmit(() => void saveRef.current());
  }, [registerSubmit]);

  return (
    <div className="flex flex-col gap-4">
      {blockingReason ? (
        <p
          role="alert"
          className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail"
        >
          {blockingReason}
        </p>
      ) : null}

      <Input
        label="Name this site"
        required
        placeholder="Head office, Gurugram warehouse"
        value={site.label}
        onChange={(e) => patch({ label: e.target.value })}
        error={errors.label}
      />
      <Input
        label="Building and street"
        required
        value={site.line1}
        onChange={(e) => patch({ line1: e.target.value })}
        error={errors.line1}
      />
      <Input
        label="Floor, unit or area"
        value={site.line2}
        onChange={(e) => patch({ line2: e.target.value })}
      />
      <PincodeLocalityFields
        value={{ pincode: site.pincode, city: site.city, state: site.state }}
        onChange={(next) => patch(next)}
        errors={{ pincode: errors.pincode, city: errors.city, state: errors.state }}
        autoLookup={false}
        onFocus={noop}
        onBlur={noop}
      />
      {/*
        Gate instructions belong under the state the pincode settled: a rider
        reads them as the last line of where they are going, not as a preference
        filed somewhere else on the card.
      */}
      <Input
        label="Gate instructions"
        placeholder="Deliveries to the basement dock only"
        value={site.gateInstructions}
        onChange={(e) => patch({ gateInstructions: e.target.value })}
      />

      {/*
        One chip, carrying its own hours. Four answers cover what a dock
        actually keeps, and not one of them is an empty required field.
      */}
      <div>
        <p className="mb-2 block text-h3 text-ink">Receiving window</p>
        <div className="flex flex-wrap gap-2">
          {WINDOWS.map((w) => (
            <Chip
              key={w.id}
              label={w.label}
              selected={site.windowId === w.id}
              onToggle={() => patch({ windowId: w.id })}
            />
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
