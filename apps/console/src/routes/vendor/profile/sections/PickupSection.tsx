import * as React from 'react';
import { Chip, Input, SectionDialog } from '@trugrade/ui';
import { completeStep, lookupPincode, saveStep } from '../../../../../../storefront/src/app/register/api';
import {
  mobileSubscriberDigits,
  toE164,
  validateFullName,
  validateMobile,
} from '../../../../../../storefront/src/app/register/validation';
import { liveFieldError } from '../live-field';

const WINDOWS = [
  { id: 'MON_FRI_10_6', label: 'Mon–Fri 10–6' },
  { id: 'MON_SAT_10_6', label: 'Mon–Sat 10–6' },
  { id: 'MON_SAT_9_8', label: 'Mon–Sat 9–8' },
  { id: 'ALL_DAYS', label: 'All days' },
] as const;

function hoursForWindow(id: (typeof WINDOWS)[number]['id']): Record<string, { closed: boolean; opensAt: string; closesAt: string }> {
  const closed = (_day: number) => ({ closed: true, opensAt: '', closesAt: '' });
  const open = (from: string, to: string) => ({ closed: false, opensAt: from, closesAt: to });
  const base: Record<number, { closed: boolean; opensAt: string; closesAt: string }> = {
    0: closed(0),
    1: open('10:00', '18:00'),
    2: open('10:00', '18:00'),
    3: open('10:00', '18:00'),
    4: open('10:00', '18:00'),
    5: open('10:00', '18:00'),
    6: closed(6),
  };
  if (id === 'MON_SAT_10_6') base[6] = open('10:00', '18:00');
  if (id === 'MON_SAT_9_8') {
    for (let d = 1; d <= 6; d += 1) base[d] = open('09:00', '20:00');
  }
  if (id === 'ALL_DAYS') {
    for (let d = 0; d <= 6; d += 1) base[d] = open('09:00', '20:00');
  }
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v]));
}

export interface PickupDraft {
  pincode: string;
  city: string;
  stateCode: string;
  pinFound: boolean;
  line1: string;
  landmark: string;
  contactName: string;
  contactMobile: string;
  windowId: (typeof WINDOWS)[number]['id'] | '';
}

export interface PickupSectionProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial: Record<string, unknown>;
}

export function PickupSection({ open, onClose, onSaved, initial }: PickupSectionProps): React.JSX.Element {
  const readInitial = (): PickupDraft => {
    const fac = (initial.facilities as unknown[])?.[0] as
      | { address?: { pincode?: string; city?: string; state?: string; line1?: string; line2?: string } }
      | undefined;
    const wh = (initial.contacts as { WAREHOUSE?: { fullName?: string; mobile?: string } })?.WAREHOUSE;
    return {
      pincode: fac?.address?.pincode ?? '',
      city: fac?.address?.city ?? '',
      stateCode: fac?.address?.state ?? '',
      pinFound: Boolean(fac?.address?.pincode),
      line1: fac?.address?.line1 ?? '',
      landmark: fac?.address?.line2 ?? '',
      contactName: wh?.fullName ?? '',
      contactMobile: wh?.mobile?.replace(/^\+91/, '') ?? '',
      windowId: 'MON_FRI_10_6',
    };
  };

  const [step, setStep] = React.useState<1 | 2>(1);
  const [draft, setDraft] = React.useState<PickupDraft>(readInitial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [focused, setFocused] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<Partial<Record<string, boolean>>>({});

  React.useEffect(() => {
    if (open) {
      setStep(1);
      setDraft(readInitial());
      setError(undefined);
    }
  }, [open, initial]);

  const lookupPin = async (pin: string): Promise<void> => {
    if (pin.length !== 6) return;
    setBusy(true);
    const result = await lookupPincode(pin);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setDraft((d) => ({ ...d, pinFound: false, city: '', stateCode: '' }));
      return;
    }
    setDraft((d) => ({
      ...d,
      pinFound: true,
      city: result.data.areas[0]?.label.split(',')[0]?.trim() ?? result.data.stateName,
      stateCode: result.data.stateCode,
    }));
    setError(undefined);
  };

  const mobileDisplay = draft.contactMobile ? `+91 ${draft.contactMobile}` : '+91 ';

  const save = async (): Promise<void> => {
    if (step === 1) {
      if (!draft.pinFound || !draft.line1.trim()) {
        setError('Enter a valid pincode and street address.');
        return;
      }
      setStep(2);
      return;
    }
    const nameErr = validateFullName(draft.contactName);
    const mobileErr = validateMobile(mobileDisplay);
    if (nameErr || mobileErr || !draft.windowId) {
      setError(nameErr ?? mobileErr ?? 'Choose a collection window.');
      return;
    }
    setBusy(true);
    const answers = {
      facilities: [
        {
          key: 'pickup-primary',
          label: 'Primary pickup',
          facilityType: 'WAREHOUSE',
          dispatchSameAsFacility: true,
          vehicleAccess: 'TEMPO',
          hasLoadingDock: false,
          address: {
            line1: draft.line1.trim(),
            line2: draft.landmark.trim(),
            city: draft.city,
            state: draft.stateCode,
            pincode: draft.pincode,
          },
          hours: hoursForWindow(draft.windowId),
          holidays: [],
        },
      ],
      contacts: {
        WAREHOUSE: {
          fullName: draft.contactName.trim(),
          mobile: toE164(mobileDisplay),
          designation: '',
          email: '',
        },
      },
    };
    await saveStep('FACILITY_CONTACTS', answers, 100);
    await completeStep('FACILITY_CONTACTS');
    setBusy(false);
    onSaved();
  };

  return (
    <SectionDialog
      open={open}
      onClose={onClose}
      title="Pickup address"
      subtitle={step === 1 ? 'Where we collect machines.' : 'Who meets the driver.'}
      stepIndex={step}
      stepCount={2}
      primaryLabel={step === 1 ? 'Continue' : 'Save'}
      primaryLoading={busy}
      onPrimary={() => void save()}
      onBack={step === 2 ? () => setStep(1) : undefined}
    >
      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <Input
            label="Pincode"
            mono
            required
            maxLength={6}
            inputMode="numeric"
            value={draft.pincode}
            error={error}
            onFocus={() => setFocused('pincode')}
            onBlur={() => setFocused(null)}
            onChange={(e) => {
              const pin = mobileSubscriberDigits(e.target.value).slice(0, 6);
              setActive((a) => ({ ...a, pincode: true }));
              setDraft((d) => ({ ...d, pincode: pin, pinFound: false }));
              setError(undefined);
              if (pin.length === 6) void lookupPin(pin);
            }}
          />
          {draft.pinFound ? <p className="profile-hub-found">Found</p> : null}
          <Input label="City" readOnly className="profile-hub-readonly" value={draft.city || '—'} />
          <Input
            label="State"
            readOnly
            className="profile-hub-readonly"
            value={draft.stateCode || '—'}
          />
          <Input
            label="Building and street"
            required
            value={draft.line1}
            onChange={(e) => setDraft((d) => ({ ...d, line1: e.target.value }))}
          />
          <Input
            label="Landmark (optional)"
            value={draft.landmark}
            onChange={(e) => setDraft((d) => ({ ...d, landmark: e.target.value }))}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Input
            label="Contact name"
            required
            value={draft.contactName}
            error={liveFieldError('name', draft.contactName, validateFullName, focused, active)}
            onFocus={() => setFocused('name')}
            onBlur={() => setFocused(null)}
            onChange={(e) => {
              setActive((a) => ({ ...a, name: true }));
              setDraft((d) => ({ ...d, contactName: e.target.value }));
            }}
          />
          <Input
            label="Contact mobile"
            required
            mono
            inputMode="numeric"
            maxLength={10}
            value={draft.contactMobile}
            error={liveFieldError(
              'mobile',
              mobileDisplay,
              validateMobile,
              focused,
              active,
            )}
            onFocus={() => setFocused('mobile')}
            onBlur={() => setFocused(null)}
            onChange={(e) => {
              setActive((a) => ({ ...a, mobile: true }));
              setDraft((d) => ({ ...d, contactMobile: mobileSubscriberDigits(e.target.value) }));
            }}
          />
          <div>
            <p className="mb-2 text-body-sm font-medium text-ink-2">Collection window</p>
            <div className="flex flex-wrap gap-2">
              {WINDOWS.map((w) => (
                <Chip
                  key={w.id}
                  label={w.label}
                  selected={draft.windowId === w.id}
                  onToggle={() => setDraft((d) => ({ ...d, windowId: w.id }))}
                />
              ))}
            </div>
          </div>
          {error ? (
            <p className="text-body-sm text-fail" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </SectionDialog>
  );
}
