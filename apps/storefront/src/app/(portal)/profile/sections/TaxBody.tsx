'use client';

import * as React from 'react';
import { Button, Input, StatusPill } from '@trugrade/ui';
import { stateCodeFromGstin } from '@trugrade/contracts';
import {
  completeStep,
  saveStep,
  verifyGstin,
  type AccountHolderDetails,
  type GstinTaxpayer,
  type VerificationOutcomeView,
} from '../../../register/api';
import { Select } from '../../../../lib/controls';
import { STATES, stateName } from '../../../register/picklists';
import {
  billingStateMatchesGstin,
  toGstin,
  typeMobile,
  validateCity,
  validateGstin,
  validateLine1,
  validatePincode,
} from '../../../register/validation';
import { ProviderProblem, isProviderProblem, useRetryLadder } from '../../../register/verification';
import type { StepBodyProps } from './step-body';

/**
 * Tax and billing: one GSTIN, and the address it bills.
 *
 * **Two typed things and two confirmations, in place of the old Statutory card,
 * Company card and billing sub-step.** The GST portal returns the legal name,
 * trade name, constitution, the year of registration and the registered office.
 * All of it was already arriving and being asked for again:
 *
 * - The Company card asked for headcount and annual laptop volume before a
 *   buyer could order. They are pricing-desk inputs, they are asked once after
 *   the first order, and BUSINESS_PROFILE is completed here from the portal's
 *   own answer so the server still counts its step.
 * - The billing sub-step rendered four required fields over an address the
 *   portal had already given us, plus a state cross-check that could reject the
 *   prefill outright. It is confirmed here, not typed, and the cross-check is a
 *   warning that offers an edit.
 *
 * No PAN is asked for or recorded — the draft carries an empty one on purpose,
 * so the server's PAN write (which needs the encryption key) never runs. The
 * PAN shown is read out of the GSTIN itself, labelled as the derivation it is.
 *
 * The billing address is written into the CONTACTS_ADDRESSES draft rather than
 * completing that step: `promoteContactsAddresses` writes billing and delivery
 * together, and the Delivery card completes it.
 */

export interface TaxBodyProps extends StepBodyProps {
  /** Saved STATUTORY answers, so a reopened card starts from what was there. */
  initial: Record<string, unknown>;
  /** Saved CONTACTS_ADDRESSES answers — the billing row is kept here. */
  contacts: Record<string, unknown>;
  /** Who to attach the billing address to when nobody has been named. */
  accountHolder: AccountHolderDetails;
  /** Verbatim from the reviewer when either step was sent back. */
  blockingReason?: string | null;
}

interface Postal {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

const EMPTY_POSTAL: Postal = { line1: '', line2: '', city: '', state: '', pincode: '' };

function savedGstin(initial: Record<string, unknown>): string {
  const rows = initial.gstins;
  const first = Array.isArray(rows) ? (rows[0] as { gstin?: unknown } | undefined) : undefined;
  return typeof first?.gstin === 'string' ? first.gstin : '';
}

/** The billing row already in the CONTACTS_ADDRESSES draft, if any. */
function savedBilling(contacts: Record<string, unknown>): Postal | null {
  const rows = contacts.billing;
  const first = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  if (!first || typeof first.line1 !== 'string' || !first.line1.trim()) return null;
  const str = (key: string): string =>
    typeof first[key] === 'string' ? (first[key] as string) : '';
  return {
    line1: str('line1'),
    line2: str('line2'),
    city: str('city'),
    state: str('state'),
    pincode: str('pincode'),
  };
}

const postalFromGst = (taxpayer: GstinTaxpayer | undefined, gstin: string): Postal | null => {
  const address = taxpayer?.registeredAddress;
  if (!address) return null;
  if (!address.line1 && !address.city && !address.pincode) return null;
  return {
    line1: address.line1 ?? '',
    line2: address.line2 ?? '',
    city: address.city ?? '',
    state: address.state || gstin.slice(0, 2),
    pincode: address.pincode ?? '',
  };
};

const postalLines = (p: Postal): string =>
  [p.line1, p.line2, p.city, p.pincode].filter((x) => x && x.trim()).join(', ');

/** The entity PAN sits inside every GSTIN: characters 3 to 12. */
const panFromGstin = (gstin: string): string | null =>
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}/.test(gstin) ? gstin.slice(2, 12) : null;

const yearOf = (value: string | undefined): string => {
  if (!value) return '';
  const iso = /^(\d{4})-\d{2}-\d{2}$/.exec(value.trim());
  if (iso) return iso[1]!;
  const dmy = /^\d{2}\/\d{2}\/(\d{4})$/.exec(value.trim());
  if (dmy) return dmy[1]!;
  return /^\d{4}$/.test(value.trim()) ? value.trim() : '';
};

export function TaxBody({
  initial,
  contacts,
  accountHolder,
  blockingReason,
  registerSubmit,
  onBusy,
  onFrame,
  onSaved,
}: TaxBodyProps): React.JSX.Element {
  const [sub, setSub] = React.useState<1 | 2>(1);
  const [gstin, setGstin] = React.useState(() => savedGstin(initial));
  const [verified, setVerified] = React.useState<VerificationOutcomeView | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [billing, setBilling] = React.useState<Postal>(
    () => savedBilling(contacts) ?? EMPTY_POSTAL,
  );
  /** The confirm block becomes fields only when the buyer asks, or has nothing to confirm. */
  const [editing, setEditing] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusyState] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const verifyRef = React.useRef<() => void>(() => undefined);
  const retry = useRetryLadder(() => verifyRef.current());

  const setBusy = (next: boolean): void => {
    setBusyState(next);
    onBusy(next);
  };

  React.useEffect(() => {
    onFrame({
      index: sub,
      count: 2,
      back: sub === 2 ? () => setSub(1) : undefined,
      primaryLabel: sub === 2 ? 'Save' : 'Continue',
    });
  }, [sub, onFrame]);

  const normalised = toGstin(gstin);
  const stateCode = stateCodeFromGstin(normalised);
  const taxpayer = verified?.outcome === 'PASS' ? (verified.resolved as GstinTaxpayer) : undefined;
  const pan = panFromGstin(normalised);

  const verify = async (): Promise<void> => {
    const invalid = validateGstin(gstin);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await verifyGstin({ gstin: normalised });
    setBusy(false);
    if (!result.ok) {
      setError(result.fields.gstin ?? result.message);
      return;
    }
    setVerified(result.data);
    setConfirmed(false);
    retry.note('gstin', result.data);
    // The portal's own registered office, unless a saved address is already here.
    const fromGst = postalFromGst(result.data.resolved as GstinTaxpayer | undefined, normalised);
    if (fromGst && !savedBilling(contacts)) {
      setBilling(fromGst);
      setEditing(false);
    }
  };
  verifyRef.current = () => void verify();

  /** A warning, never a refusal: the portal's own answer is not the buyer's mistake. */
  const stateWarning =
    normalised.length === 15 && billing.state
      ? billingStateMatchesGstin(normalised, billing.state, stateName)
      : undefined;

  const checkBilling = (): Record<string, string> => {
    const found: Record<string, string> = {};
    const line1 = validateLine1(billing.line1);
    if (line1) found.line1 = line1;
    const city = validateCity(billing.city);
    if (city) found.city = city;
    if (!billing.state) found.state = 'Choose the state on the registration.';
    const pincode = validatePincode(billing.pincode);
    if (pincode) found.pincode = pincode;
    return found;
  };

  const continueFromGstin = (): void => {
    if (!verified || verified.outcome !== 'PASS' || !confirmed) {
      setError('Verify your GSTIN and confirm the legal name before continuing.');
      return;
    }
    setError(undefined);
    // Nothing came back from the portal to confirm, so it has to be typed.
    if (!billing.line1.trim()) setEditing(true);
    setSub(2);
  };

  const save = async (): Promise<void> => {
    const found = checkBilling();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setEditing(true);
      return;
    }
    if (!taxpayer) {
      setError('Verify your GSTIN first.');
      setSub(1);
      return;
    }
    setError(undefined);
    setBusy(true);

    const legalName = taxpayer.legalName ?? '';
    const statutory = await saveStep(
      'STATUTORY',
      {
        legalName,
        pan: '',
        panOutcome: null,
        panDeferred: false,
        primaryGstin: normalised,
        gstins: [
          {
            key: 'primary',
            gstin: normalised,
            isPrimary: true,
            outcome: verified,
            confirmed: true,
            deferred: false,
          },
        ],
        captured: {},
      },
      100,
    );
    if (!statutory.ok) {
      setBusy(false);
      setError(statutory.fields.gstin ?? statutory.message);
      return;
    }
    const statutoryDone = await completeStep('STATUTORY');
    if (!statutoryDone.ok) {
      setBusy(false);
      setError(statutoryDone.message);
      return;
    }

    // Everything the Company card used to ask for, from the portal's answer.
    const company = await saveStep(
      'BUSINESS_PROFILE',
      {
        legalName,
        tradeName: taxpayer.tradeName ?? '',
        constitution: taxpayer.constitutionType ?? '',
        yearEstablished: yearOf(taxpayer.registrationDate),
        industry: '',
        employeeBand: '',
        annualVolume: '',
      },
      100,
    );
    if (!company.ok) {
      setBusy(false);
      setError(Object.values(company.fields)[0] ?? company.message);
      return;
    }
    const companyDone = await completeStep('BUSINESS_PROFILE');
    if (!companyDone.ok) {
      setBusy(false);
      setError(companyDone.message);
      return;
    }

    // Billing into the contacts draft, with a person on it: the promotion drops
    // a billing address that names nobody. The Delivery card completes the step.
    const existingContacts =
      typeof contacts.contacts === 'object' && contacts.contacts !== null
        ? (contacts.contacts as Record<string, unknown>)
        : {};
    const procurement =
      typeof existingContacts.PROCUREMENT === 'object' && existingContacts.PROCUREMENT !== null
        ? (existingContacts.PROCUREMENT as Record<string, unknown>)
        : {};
    const named = typeof procurement.fullName === 'string' && procurement.fullName.trim();
    const billingDraft = await saveStep(
      'CONTACTS_ADDRESSES',
      {
        ...contacts,
        contacts: {
          ...existingContacts,
          PROCUREMENT: named
            ? procurement
            : {
                useAccountDetails: true,
                fullName: accountHolder.fullName,
                designation: '',
                email: accountHolder.email,
                mobile: typeMobile(accountHolder.mobile),
              },
        },
        billing: [{ gstin: normalised, ...billing }],
      },
      50,
    );
    setBusy(false);
    if (!billingDraft.ok) {
      setError(Object.values(billingDraft.fields)[0] ?? billingDraft.message);
      return;
    }
    onSaved();
  };

  const submitRef = React.useRef<() => void>(() => undefined);
  submitRef.current = sub === 1 ? continueFromGstin : (): void => void save();
  React.useEffect(() => {
    registerSubmit(() => submitRef.current());
  }, [registerSubmit]);

  if (sub === 1) {
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
          label="GSTIN"
          mono
          required
          maxLength={15}
          autoComplete="off"
          value={gstin}
          // Judged as it is typed; an empty box waits for Verify.
          error={error ?? (gstin.trim() ? validateGstin(gstin) : undefined)}
          onChange={(e) => {
            setGstin(e.target.value.toUpperCase());
            setVerified(null);
            setConfirmed(false);
            setError(undefined);
            retry.clear('gstin');
          }}
          readOnly={busy}
          action={
            <Button type="button" variant="secondary" loading={busy} onClick={() => void verify()}>
              Verify
            </Button>
          }
        />

        {verified && isProviderProblem(verified) ? (
          <ProviderProblem
            view={verified}
            provider="the GST portal"
            retryIn={retry.pending.gstin?.secondsLeft}
            retryAttempt={retry.pending.gstin?.attempt}
            exhausted={retry.exhausted('gstin', verified, busy)}
            onRetryNow={() => void verify()}
          />
        ) : null}

        {taxpayer ? (
          <div className="profile-hub-pass-block" data-testid="gstin-verified">
            <p className="text-body-sm font-medium text-ink">{taxpayer.legalName}</p>
            {taxpayer.tradeName && taxpayer.tradeName !== taxpayer.legalName ? (
              <p className="mt-1 text-body-sm text-ink-2">Trading as {taxpayer.tradeName}</p>
            ) : null}
            <dl className="mt-3 flex flex-col gap-2">
              {stateCode && stateName(stateCode) ? (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-body-sm text-ink-2">State of registration</dt>
                  <dd className="text-body-sm text-ink">{stateName(stateCode)}</dd>
                </div>
              ) : null}
              {pan ? (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-body-sm text-ink-2">PAN, from the GSTIN</dt>
                  <dd className="font-mono tnum text-body-sm text-ink">{pan}</dd>
                </div>
              ) : null}
              {taxpayer.constitutionType ? (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-body-sm text-ink-2">Constitution</dt>
                  <dd className="text-body-sm text-ink">
                    {taxpayer.constitutionType.replace(/_/g, ' ')}
                  </dd>
                </div>
              ) : null}
            </dl>
            <label className="mt-3 flex items-start gap-2 text-body-sm text-ink-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              This is our registered business name.
            </label>
          </div>
        ) : null}

        {verified && (verified.outcome === 'FAIL' || verified.outcome === 'MISMATCH') ? (
          <div className="flex flex-col gap-2">
            <StatusPill tone="fail" label="Not verified" />
            <p className="text-body-sm text-ink-2">{verified.message}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-sm text-ink-2">
        We invoice this address. It came back with your GSTIN.
      </p>

      {!editing ? (
        <div className="profile-hub-pass-block" data-testid="billing-confirm">
          <p className="text-body-sm text-ink">{postalLines(billing)}</p>
          {billing.state && stateName(billing.state) ? (
            <p className="mt-1 text-body-sm text-ink-3">{stateName(billing.state)}</p>
          ) : null}
          <div className="mt-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Use a different billing address
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Input
            label="Building and street"
            required
            value={billing.line1}
            onChange={(e) => setBilling((b) => ({ ...b, line1: e.target.value }))}
            error={errors.line1}
          />
          <Input
            label="Floor, unit or area"
            value={billing.line2}
            onChange={(e) => setBilling((b) => ({ ...b, line2: e.target.value }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="PIN code"
              mono
              required
              inputMode="numeric"
              maxLength={6}
              value={billing.pincode}
              onChange={(e) => setBilling((b) => ({ ...b, pincode: e.target.value }))}
              error={errors.pincode}
            />
            <Input
              label="City"
              required
              value={billing.city}
              onChange={(e) => setBilling((b) => ({ ...b, city: e.target.value }))}
              error={errors.city}
            />
          </div>
          <Select
            label="State"
            required
            options={STATES}
            value={billing.state}
            onChange={(e) => setBilling((b) => ({ ...b, state: e.target.value }))}
            error={errors.state}
          />
        </>
      )}

      {/*
        A warning that offers an edit, never a refusal. The address came from the
        GST portal; refusing the portal's own answer strands the buyer with
        nothing to correct.
      */}
      {stateWarning ? (
        <div className="flex flex-col gap-2" data-testid="billing-state-warning">
          <StatusPill tone="warn" label="Check the state" />
          <p className="text-body-sm text-ink-2">{stateWarning}</p>
          {!editing ? (
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Edit the address
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
