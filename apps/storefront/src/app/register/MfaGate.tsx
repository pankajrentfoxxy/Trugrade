'use client';

import * as React from 'react';
import { Button, OtpInput, StatusPill } from '@trugrade/ui';
import { OTP_POLICY } from '@trugrade/contracts';
import { requestMfaCode, verifyMfa } from './api';

/**
 * The second factor, in the middle of registration.
 *
 * **A supplier account cannot do anything without this.** `MFA_REQUIRED_ROLES`
 * covers VENDOR_OWNER — the roles that can move money or change where it goes —
 * and `AuthGuard` refuses every non-public route on a session that has not
 * satisfied it. So the moment `POST /auth/register` creates a vendor, the very
 * next call (`POST /onboarding/start`) is a 403 until a code lands. Without this
 * panel a vendor registers successfully and then cannot save one field, which is
 * exactly the state the flow was in before this existed.
 *
 * It is driven by the server's own `mfaRequired`, not by `orgType`: a buyer
 * account whose owner is later given a money-moving role meets the same guard,
 * and a flag the server sets is the honest condition to branch on.
 *
 * The code goes to the address that was verified two fields ago, so this is a
 * *third* code and reads as a nuisance unless it says why. It says why.
 */

export interface MfaGateProps {
  /** Masked by the server. Never re-derived — showing an address we assembled
   *  ourselves would hide the case where the code went somewhere else. */
  sentTo: string;
  /** Called with a rotated, MFA-satisfied session in place. */
  onVerified: () => Promise<void>;
}

export function MfaGate({ sentTo, onVerified }: MfaGateProps): React.JSX.Element {
  const [code, setCode] = React.useState('');
  const [target, setTarget] = React.useState(sentTo);
  const [error, setError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [cooldown, setCooldown] = React.useState<number>(OTP_POLICY.resendCooldownSeconds);

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const submit = async (entered: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await verifyMfa(entered);
    if (!result.ok) {
      // The server's own wording, which says whether an attempt was spent or the
      // code timed out. Those are different problems with different fixes.
      setError(result.message || result.fields.code);
      setCode('');
      setBusy(false);
      return;
    }
    await onVerified();
    setBusy(false);
  };

  const resend = async (): Promise<void> => {
    setError(undefined);
    const sent = await requestMfaCode();
    if (!sent.ok) {
      setError(sent.message);
      return;
    }
    setTarget(sent.data.sentTo);
    setCode('');
    setCooldown(OTP_POLICY.resendCooldownSeconds);
  };

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-rule bg-sheet p-5"
      aria-labelledby="mfa-heading"
    >
      <StatusPill className="self-start" tone="processing" label="One more code" />
      <h2 id="mfa-heading" className="text-h3 text-ink">
        Your account is created. It needs a second code before you can carry on.
      </h2>
      <p className="max-w-[62ch]">
        A supplier account can change where we send money, so we ask for a second code every time
        you sign in — not only today. We have sent one to{' '}
        <span className="font-mono tnum text-ink">{target}</span>.
      </p>

      <div className="flex flex-col gap-3 rounded border border-rule bg-sheet-2 p-4">
        <OtpInput
          label={`Enter the code we sent to ${target}`}
          value={code}
          onChange={setCode}
          onComplete={(entered) => void submit(entered)}
          disabled={busy}
          error={error}
        />
        <p className="text-body-sm text-ink-2">
          The code is good for{' '}
          <span className="tnum text-ink">{OTP_POLICY.ttlSeconds / 60}</span> minutes.{' '}
          {cooldown > 0 ? (
            <>
              No code yet? You can ask for another in{' '}
              <span className="tnum text-ink">{cooldown}</span> seconds.
            </>
          ) : (
            'No code yet? Ask for another below.'
          )}
        </p>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabledReason={
              cooldown > 0 ? `You can ask for another code in ${cooldown} seconds.` : undefined
            }
            onClick={() => void resend()}
          >
            Resend code
          </Button>
        </div>
      </div>

      <p className="text-body-sm text-ink-3">
        Nothing you typed on this step has been lost — it is saved the moment this code is
        accepted.
      </p>
    </section>
  );
}
