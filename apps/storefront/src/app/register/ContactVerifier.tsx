'use client';

import * as React from 'react';
import { Button, Input, OtpInput } from '@trugrade/ui';
import { OTP_POLICY } from '@trugrade/contracts';
import { sendOtp, verifyOtp, type OtpChannel } from './api';

/**
 * One address, one code, one proof — used for the work email and again for the
 * mobile.
 *
 * The pair of them is what `POST /auth/register` checks before it will create
 * anything, so this component owns the whole exchange rather than leaving the
 * form to remember which half of it happened.
 *
 * Four states, all of them real:
 *   - **sent** — the server's masked address is echoed back, never one we
 *     re-derive, so what is shown is what was actually written to.
 *   - **cooldown** — `OTP_POLICY.resendCooldownSeconds`, the same constant the
 *     server refuses inside. Seeded from the contract rather than from a clock
 *     read: the response has just arrived, so the full cooldown is what remains.
 *   - **wrong code** — the server's message, which says an attempt was spent.
 *   - **expired** — likewise, with the resend that fixes it right beside it.
 */

export interface ContactVerifierProps {
  channel: OtpChannel;
  label: string;
  hint?: string;
  /** The address itself. Owned by the form so a resumed draft can repopulate it. */
  value: string;
  onValueChange: (value: string) => void;
  /** Runs before a code is sent, so a typo never costs an SMS. */
  validate: (value: string) => string | undefined;
  /** The normalised form the server will store — `+91…` for a mobile. */
  normalise?: (value: string) => string;
  verified: boolean;
  onVerified: (normalisedValue: string) => void;
  mono?: boolean;
  autoComplete?: string;
  placeholder?: string;
  inputMode?: 'text' | 'email' | 'tel';
  type?: string;
  /** Surfaced by the form when the server rejects the address at registration. */
  error?: string;
}

type Phase = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified';

export function ContactVerifier({
  channel,
  label,
  hint,
  value,
  onValueChange,
  validate,
  normalise,
  verified,
  onVerified,
  mono,
  autoComplete,
  placeholder,
  inputMode,
  type = 'text',
  error,
}: ContactVerifierProps): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>(verified ? 'verified' : 'idle');
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [localError, setLocalError] = React.useState<string | undefined>();
  const [otpError, setOtpError] = React.useState<string | undefined>();
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (verified) setPhase('verified');
  }, [verified]);

  // One interval, counting the cooldown the server just told us about. It is a
  // resend gate, not a scarcity device: nothing expires from the applicant's
  // point of view when it reaches zero except the wait.
  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const target = normalise ? normalise(value) : value.trim();

  const send = async (): Promise<void> => {
    const invalid = validate(value);
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    setLocalError(undefined);
    setOtpError(undefined);
    setPhase('sending');
    const result = await sendOtp(channel, target);
    if (!result.ok) {
      setLocalError(result.fields.value ?? result.message);
      setPhase(sentTo ? 'sent' : 'idle');
      return;
    }
    setSentTo(result.data.sentTo);
    setCode('');
    setCooldown(OTP_POLICY.resendCooldownSeconds);
    setPhase('sent');
  };

  const submitCode = async (entered: string): Promise<void> => {
    setPhase('verifying');
    setOtpError(undefined);
    const result = await verifyOtp(channel, target, entered);
    if (!result.ok) {
      // The server's own wording: "Too many incorrect attempts. Request a new
      // code." or "That code has expired." Rewriting it here would lose the
      // distinction between an attempt spent and a code that timed out.
      // The message carries how many attempts are left; `fields.code` is the
      // short form and drops that half of it.
      setOtpError(result.message || result.fields.code);
      setCode('');
      setPhase('sent');
      return;
    }
    setPhase('verified');
    onVerified(target);
  };

  const describedError = error ?? localError;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
        <Input
          className="w-full"
          label={label}
          hint={hint}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          mono={mono}
          required
          value={value}
          readOnly={phase === 'verified'}
          onChange={(e) => {
            onValueChange(e.target.value);
            setLocalError(undefined);
          }}
          error={describedError}
          verifyState={phase === 'verified' ? 'verified' : 'idle'}
          verifyDetail={
            phase === 'verified' ? (
              <>
                Verified. We sent a code to <span className="tnum">{sentTo ?? target}</span> and you
                entered it.
              </>
            ) : undefined
          }
        />
        </div>

        {phase !== 'verified' && (
          <Button
            type="button"
            variant="secondary"
            className="sm:mt-7"
            loading={phase === 'sending'}
            disabledReason={
              cooldown > 0 && phase === 'sent'
                ? `You can ask for another code in ${cooldown} seconds.`
                : undefined
            }
            onClick={() => void send()}
          >
            {phase === 'sent' ? 'Resend code' : 'Send code'}
          </Button>
        )}
      </div>

      {(phase === 'sent' || phase === 'verifying') && (
        <div className="flex flex-col gap-3 rounded border border-rule bg-sheet-2 p-4">
          <OtpInput
            label={`Enter the code we sent to ${sentTo ?? target}`}
            value={code}
            onChange={setCode}
            onComplete={(entered) => void submitCode(entered)}
            disabled={phase === 'verifying'}
            error={otpError}
          />
          <p className="text-body-sm text-ink-2">
            <>
              The code is good for <span className="tnum text-ink">{OTP_POLICY.ttlSeconds / 60}</span>{' '}
              minutes.{' '}
            </>
            {cooldown > 0 ? (
              <>
                No code yet? You can ask for another in{' '}
                <span className="tnum text-ink">{cooldown}</span> seconds.
              </>
            ) : (
              'No code yet? Use Resend, or correct the address above and send again.'
            )}
          </p>
        </div>
      )}
    </div>
  );
}
