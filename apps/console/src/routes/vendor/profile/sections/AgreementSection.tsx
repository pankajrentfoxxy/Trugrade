import * as React from 'react';
import { persistInOrder } from '../persist';
import { Checkbox, Input, SectionDialog } from '@trugrade/ui';
import { LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { completeStep, saveStep } from '../../../../../../storefront/src/app/register/api';
import { validateFullName } from '../../../../../../storefront/src/app/register/validation';
import { liveFieldError } from '../live-field';

const CLAUSES = [
  'We are the seller of record on every customer invoice; you supply back-to-back when an order lands.',
  'Grades are measured on site before a machine goes live — a disputed grade is settled against the inspection record.',
  'Payouts run on a fixed cycle after delivery and inspection; every deduction is itemised on the statement.',
  'You accept our data-wipe standard before any buyer machine ships.',
  'Returns that meet the policy are handled through us — not by exposing your identity to the buyer.',
] as const;

const VERSION = '1.0';
const EFFECTIVE = '1 September 2026';

export interface AgreementSectionProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial: Record<string, unknown>;
  legalName: string;
}

export function AgreementSection({
  open,
  onClose,
  onSaved,
  initial,
  legalName,
}: AgreementSectionProps): React.JSX.Element {
  const [name, setName] = React.useState(String(initial.acceptedName ?? ''));
  const [accepted, setAccepted] = React.useState(initial.accepted === true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [focused, setFocused] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<Partial<Record<string, boolean>>>({});

  React.useEffect(() => {
    if (open) {
      setName(String(initial.acceptedName ?? ''));
      setAccepted(initial.accepted === true);
      setError(undefined);
    }
  }, [open, initial]);

  const save = async (): Promise<void> => {
    const nameErr = validateFullName(name);
    if (nameErr) {
      setError(nameErr);
      return;
    }
    if (!accepted) {
      setError('Tick the box to record your acceptance.');
      return;
    }
    setBusy(true);
    const failed = await persistInOrder([
      () =>
        saveStep(
          'AGREEMENT',
          {
            acceptedName: name.trim(),
            accepted: true,
            agreementVersion: VERSION,
            acceptedAt: new Date().toISOString(),
            agreements: { VENDOR_AGREEMENT: true },
            pricingMode: 'NET_PAYOUT',
          },
          100,
        ),
      () => completeStep('AGREEMENT'),
    ]);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onSaved();
  };

  return (
    <SectionDialog
      open={open}
      onClose={onClose}
      title="Supplier agreement"
      subtitle="Recorded acceptance — not an e-signature."
      stepIndex={1}
      stepCount={1}
      primaryLabel="Save"
      primaryLoading={busy}
      onPrimary={() => void save()}
    >
      <div className="flex flex-col gap-4">
        <div className="profile-hub-clauses">
          <ol>
            {CLAUSES.map((clause) => (
              <li key={clause}>{clause}</li>
            ))}
          </ol>
        </div>
        <p className="text-body-sm text-ink-3">
          Signing as <span className="text-ink">{legalName || LEGAL_DISCLOSURE.legalName}</span> ·
          version <span className="font-mono tnum">{VERSION}</span> ·{' '}
          <span className="font-mono tnum">{EFFECTIVE}</span>
        </p>
        <p className="text-body-sm text-ink-3">
          We record your name, this version and the time. There is no e-sign provider connected —
          this is not a digital signature.
        </p>
        <Input
          label="Your name"
          required
          value={name}
          error={liveFieldError('name', name, validateFullName, focused, active) ?? error}
          onFocus={() => setFocused('name')}
          onBlur={() => setFocused(null)}
          onChange={(e) => {
            setActive((a) => ({ ...a, name: true }));
            setName(e.target.value);
            setError(undefined);
          }}
        />
        <Checkbox
          label="I accept the supplier agreement on behalf of the business named above."
          checked={accepted}
          onChange={(checked) => {
            setAccepted(checked);
            setError(undefined);
          }}
        />
      </div>
    </SectionDialog>
  );
}
