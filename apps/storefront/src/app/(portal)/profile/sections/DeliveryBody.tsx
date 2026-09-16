'use client';

import * as React from 'react';
import { Button, Chip, Input } from '@trugrade/ui';
import { completeStep, saveStep, type AccountHolderDetails } from '../../../register/api';
import { PincodeLocalityFields } from '../../../register/PincodeLocalityFields';
import { RECEIVING_DAYS } from '../../../register/picklists';
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
 * Delivery: one site, and who signs for it.
 *
 * **Three typed fields, against the twenty this card used to hold.** It was one
 * all-or-nothing step of five sub-steps — a procurement contact, a finance
 * contact, an IT contact, the billing address and the site — that only counted
 * for anything on the fifth. What is left here is what a rider and an e-way
 * bill genuinely need:
 *
 * - Name the site, the street, the pincode. City and state fill themselves from
 *   the pincode directory and are read-only.
 * - Who signs defaults to the account holder, because the person creating the
 *   account is that person until they say otherwise. A delivery OTP has to
 *   reach somebody, so this is never left blank.
 * - The receiving window defaults to Monday to Friday, 10:00 to 19:00, the way
 *   the supplier hub's collection window is one pre-selected chip. Three
 *   required fields with no defaults were three questions nobody needed asked.
 *
 * The finance and IT contacts moved to the team screen, where people belong,
 * and neither blocks an order. The billing row written by the Tax card is
 * carried through untouched — `promoteContactsAddresses` writes billing and
 * delivery together, and this is the card that completes the step.
 */

const DEFAULT_DAYS = 'MON_FRI';
const DEFAULT_OPENS_AT = '10:00';
const DEFAULT_CLOSES_AT = '19:00';

/** The picklist minus its "Select the days" placeholder — these are chips now. */
const DAY_CHIPS = RECEIVING_DAYS.filter((d) => d.value !== '');

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
  landmark: string;
  gateInstructions: string;
  days: string;
  opensAt: string;
  closesAt: string;
}

const str = (row: Record<string, unknown>, key: string): string =>
  typeof row[key] === 'string' ? (row[key] as string) : '';

function readSite(initial: Record<string, unknown>, account: AccountHolderDetails): SiteValues {
  const rows = initial.delivery;
  const saved =
    (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined) ?? {};
  const savedName = str(saved, 'contactName');
  const savedMobile = str(saved, 'contactMobile');
  return {
    label: str(saved, 'label'),
    line1: str(saved, 'line1'),
    line2: str(saved, 'line2'),
    city: str(saved, 'city'),
    state: str(saved, 'state'),
    pincode: str(saved, 'pincode'),
    // Nothing saved yet: the account holder signs until somebody says otherwise.
    contactName: savedName || account.fullName,
    contactMobile: typeMobile(savedMobile || account.mobile),
    landmark: str(saved, 'landmark'),
    gateInstructions: str(saved, 'gateInstructions'),
    days: str(saved, 'days') || DEFAULT_DAYS,
    opensAt: str(saved, 'opensAt') || DEFAULT_OPENS_AT,
    closesAt: str(saved, 'closesAt') || DEFAULT_CLOSES_AT,
  };
}

/** Whether the site still names the account holder, unedited. */
const usesAccountHolder = (site: SiteValues, account: AccountHolderDetails): boolean =>
  site.contactName.trim() === account.fullName.trim() &&
  toE164(site.contactMobile) === toE164(typeMobile(account.mobile));

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
  const [someoneElse, setSomeoneElse] = React.useState(
    () => !usesAccountHolder(readSite(initial, accountHolder), accountHolder),
  );
  const [showWindow, setShowWindow] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    onFrame({ index: 1, count: 1, primaryLabel: 'Save' });
  }, [onFrame]);

  const patch = (next: Partial<SiteValues>): void => setSite((s) => ({ ...s, ...next }));
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
    const name = validateFullName(site.contactName);
    if (name) found.contactName = 'Name the person who signs for the delivery.';
    const mobile = isMobileBlank(site.contactMobile)
      ? 'A delivery code goes to this number. Give one.'
      : validateMobile(site.contactMobile);
    if (mobile) found.contactMobile = mobile;
    return found;
  };

  const save = async (): Promise<void> => {
    const found = check();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setError(undefined);
    onBusy(true);

    const settled = { ...site, contactMobile: toE164(site.contactMobile) || site.contactMobile };
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

  const windowLabel = `${DAY_CHIPS.find((d) => d.value === site.days)?.label ?? 'Monday to Friday'}, ${site.opensAt} to ${site.closesAt}`;

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
        Who signs, pre-filled and read-only. A delivery OTP has to reach a
        person, and the person who opened the account is that person until they
        name somebody else.
      */}
      {!someoneElse ? (
        <div>
          <p className="mb-1 block text-body-sm font-medium text-ink-2">Who signs for deliveries</p>
          <p className="text-body-sm text-ink">
            {site.contactName || 'You'}
            {site.contactMobile ? (
              <span className="ml-2 font-mono tnum text-ink-2">{site.contactMobile}</span>
            ) : null}
          </p>
          <div className="mt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSomeoneElse(true);
                patch({ contactName: '', contactMobile: typeMobile('') });
              }}
            >
              Someone else signs
            </Button>
          </div>
          {errors.contactName || errors.contactMobile ? (
            <p role="alert" className="mt-2 text-body-sm text-fail">
              {errors.contactName ?? errors.contactMobile}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <Input
            label="Who signs for the delivery"
            required
            value={site.contactName}
            onChange={(e) => patch({ contactName: e.target.value })}
            error={errors.contactName}
          />
          <Input
            label="Their mobile"
            mono
            type="tel"
            inputMode="numeric"
            maxLength={14}
            required
            value={site.contactMobile}
            onChange={(e) => patch({ contactMobile: typeMobile(e.target.value) })}
            error={errors.contactMobile}
          />
        </>
      )}

      {/*
        The window has a default, so it is a fact with an edit rather than three
        empty required fields. Landmark and gate instructions live behind the
        same disclosure: useful to a rider, never worth blocking an order over.
      */}
      <div>
        <p className="mb-1 block text-body-sm font-medium text-ink-2">Receiving window</p>
        <p className="text-body-sm text-ink">{windowLabel}</p>
        {!showWindow ? (
          <div className="mt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowWindow(true)}>
              Change window or add gate instructions
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {DAY_CHIPS.map((d) => (
                <Chip
                  key={d.value}
                  label={d.label}
                  selected={site.days === d.value}
                  onToggle={() => patch({ days: d.value })}
                />
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Opens at"
                type="time"
                mono
                value={site.opensAt}
                onChange={(e) => patch({ opensAt: e.target.value })}
              />
              <Input
                label="Closes at"
                type="time"
                mono
                value={site.closesAt}
                onChange={(e) => patch({ closesAt: e.target.value })}
              />
            </div>
            <Input
              label="Landmark"
              value={site.landmark}
              onChange={(e) => patch({ landmark: e.target.value })}
            />
            <Input
              label="Gate instructions"
              value={site.gateInstructions}
              onChange={(e) => patch({ gateInstructions: e.target.value })}
            />
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
