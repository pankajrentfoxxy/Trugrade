import * as React from 'react';
import { persistInOrder } from '../persist';
import { SectionDialog, cn } from '@trugrade/ui';
import { completeStep, saveStep } from '../../../../../../storefront/src/app/register/api';

/**
 * The ACCOUNT step, which the console never completed.
 *
 * The storefront's registration flow completes it after verifying the
 * applicant's mobile and email. A supplier who signed up through the console
 * arrived with the step open and no card to close it, so the server counted six
 * of seven and refused submission while this hub said "100%". The details are
 * already on the account — the server pre-fills the step's answers from the
 * signed-in user — so this card shows them and records them on the application.
 * Nothing here is typed: changing a name or number is done under Team, where
 * the change is verified.
 */

export interface ContactSectionProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** The step's saved answers, pre-filled by the server from the account. */
  initial: Record<string, unknown>;
  /** `GET /api/account/profile`, for a step that has no answers yet. */
  account: { fullName: string; email: string | null; mobile: string | null } | null;
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function ContactSection({
  open,
  onClose,
  onSaved,
  initial,
  account,
}: ContactSectionProps): React.JSX.Element {
  const fullName = str(initial.fullName) || account?.fullName?.trim() || '';
  const email = str(initial.email) || account?.email?.trim() || '';
  const mobile = str(initial.mobile) || account?.mobile?.trim() || '';
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (open) setError(undefined);
  }, [open]);

  const save = async (): Promise<void> => {
    const missing = [!fullName && 'a name', !email && 'a work email', !mobile && 'a mobile'].filter(
      (x): x is string => typeof x === 'string',
    );
    if (missing.length > 0) {
      setError(
        `This account has no ${missing.join(', ')} on file. Add it under Team, then confirm here.`,
      );
      return;
    }
    setBusy(true);
    const failed = await persistInOrder([
      () => saveStep('ACCOUNT', { ...initial, fullName, email, mobile }, 100),
      () => completeStep('ACCOUNT'),
    ]);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onSaved();
  };

  const rows: readonly { label: string; value: string; mono: boolean }[] = [
    { label: 'Name', value: fullName, mono: false },
    { label: 'Work email', value: email, mono: false },
    { label: 'Mobile', value: mobile, mono: true },
  ];

  return (
    <SectionDialog
      open={open}
      onClose={onClose}
      title="Contact"
      subtitle="The person we reach about this account. Taken from your sign-in."
      stepIndex={1}
      stepCount={1}
      primaryLabel="Confirm"
      primaryLoading={busy}
      onPrimary={() => void save()}
    >
      <dl className="flex flex-col gap-4">
        {rows.map((row) => (
          <div key={row.label} className="border-b border-rule-2 pb-4 last:border-b-0 last:pb-0">
            <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
              {row.label}
            </dt>
            {/* A missing value reads as missing, in --ink-4, never as a blank that passes. */}
            <dd
              className={cn(
                'mt-1 text-body-sm',
                row.value ? 'text-ink' : 'text-ink-4',
                row.value && row.mono && 'font-mono tnum',
              )}
            >
              {row.value || 'Not on file'}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-body-sm text-ink-3">
        Confirming records these on your application. To change any of them, edit your account under
        Team.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </SectionDialog>
  );
}
