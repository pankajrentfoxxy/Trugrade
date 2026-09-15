'use client';

import * as React from 'react';
import { Button, Input, StatusPill } from '@trugrade/ui';
import { stateCodeFromGstin } from '@trugrade/contracts';
import {
  completeStep,
  saveStep,
  verifyGstin,
  type VerificationOutcomeView,
} from '../../../register/api';
import { stateName } from '../../../register/picklists';
import { toGstin, validateGstin } from '../../../register/validation';
import { ProviderProblem, isProviderProblem, useRetryLadder } from '../../../register/verification';
import type { StepBodyProps } from './step-body';

/**
 * The Statutory card: one GSTIN, verified with the portal, and the legal name
 * it returns confirmed as yours.
 *
 * One number and nothing else. No PAN is asked for or recorded — the draft
 * carries an empty one on purpose, so the server's PAN write (which needs the
 * encryption key) never runs — and no registry numbers or second registration
 * are asked for; a reviewer confirms those against the certificate uploaded on
 * the Documents card. The verified response is what the Company card fills
 * itself from: legal name, trade name, constitution and the year registered.
 */

export interface StatutoryBodyProps extends StepBodyProps {
  /** The saved STATUTORY answers, so a reopened card starts from what was there. */
  initial: Record<string, unknown>;
  /** Verbatim from the reviewer when this step was sent back. */
  blockingReason?: string | null;
}

function savedGstin(initial: Record<string, unknown>): string {
  const rows = initial.gstins;
  const first = Array.isArray(rows) ? (rows[0] as { gstin?: unknown } | undefined) : undefined;
  return typeof first?.gstin === 'string' ? first.gstin : '';
}

export function StatutoryBody({
  initial,
  blockingReason,
  registerSubmit,
  onBusy,
  onFrame,
  onSaved,
}: StatutoryBodyProps): React.JSX.Element {
  const [gstin, setGstin] = React.useState(() => savedGstin(initial));
  const [verified, setVerified] = React.useState<VerificationOutcomeView | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusyState] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const verifyRef = React.useRef<() => void>(() => undefined);
  const retry = useRetryLadder(() => verifyRef.current());

  const setBusy = (next: boolean): void => {
    setBusyState(next);
    onBusy(next);
  };

  React.useEffect(() => {
    onFrame({ index: 1, count: 1, primaryLabel: 'Save' });
  }, [onFrame]);

  const normalised = toGstin(gstin);
  const stateCode = stateCodeFromGstin(normalised);
  const taxpayer = verified?.resolved as
    | {
        legalName?: string;
        registeredAddress?: { line1?: string; city?: string; pincode?: string };
      }
    | undefined;

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
  };
  verifyRef.current = () => void verify();

  const save = async (): Promise<void> => {
    if (!verified || verified.outcome !== 'PASS' || !confirmed) {
      setError('Verify your GSTIN and confirm the legal name before saving.');
      return;
    }
    const legalName = taxpayer?.legalName ?? '';
    setBusy(true);
    setError(undefined);
    const saved = await saveStep(
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
    if (!saved.ok) {
      setBusy(false);
      setError(saved.fields.gstin ?? saved.message);
      return;
    }
    const completed = await completeStep('STATUTORY');
    setBusy(false);
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
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
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

      {verified?.outcome === 'PASS' && taxpayer ? (
        <div className="profile-hub-pass-block">
          <p className="text-body-sm font-medium text-ink">{taxpayer.legalName}</p>
          {taxpayer.registeredAddress ? (
            <p className="mt-1 text-body-sm text-ink-2">
              {[
                taxpayer.registeredAddress.line1,
                taxpayer.registeredAddress.city,
                taxpayer.registeredAddress.pincode,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
          ) : null}
          {stateCode && stateName(stateCode) ? (
            <p className="mt-1 text-body-sm text-ink-3">Registered in {stateName(stateCode)}</p>
          ) : null}
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
