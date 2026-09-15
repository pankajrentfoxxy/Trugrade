'use client';

import * as React from 'react';
import { Button, Input, OtpInput, StatusPill } from '@trugrade/ui';
import { OTP_POLICY } from '@trugrade/contracts';
import {
  completeStep,
  saveStep,
  sendContactAddCode,
  updateMe,
  verifyContactAddCode,
  type SessionView,
} from '../../../register/api';
import { typeFullName, validateEmail, validateFullName } from '../../../register/validation';
import type { StepBodyProps } from './step-body';

/**
 * The Account card, in two steps: who you are, then the work email.
 *
 * Step 1 is the name, with the mobile that was proved at sign-in shown under
 * it. Continue writes the name straight to the user and moves on. Step 2 adds
 * the work email the way the mobile was proved — a code to the address — and
 * Save completes the ACCOUNT step so the server's own `isSubmittable` counts
 * it. An email already verified skips straight to Save.
 */

export interface AccountBodyProps extends StepBodyProps {
  session: SessionView;
  /** The session as the server describes it after the writes here. */
  onSession: (session: SessionView) => void;
}

type EmailPhase =
  | { k: 'idle' }
  | { k: 'sent'; sentTo: string; devCode: string | null }
  | { k: 'verified' };

export function AccountBody({
  session,
  onSession,
  registerSubmit,
  onBusy,
  onFrame,
  onSaved,
}: AccountBodyProps): React.JSX.Element {
  const [sub, setSub] = React.useState<1 | 2>(1);
  const [fullName, setFullName] = React.useState(session.fullName ?? '');
  const [nameError, setNameError] = React.useState<string | undefined>();
  const [email, setEmail] = React.useState(session.email ?? '');
  const [emailError, setEmailError] = React.useState<string | undefined>();
  const [code, setCode] = React.useState('');
  const [emailPhase, setEmailPhase] = React.useState<EmailPhase>(
    session.email ? { k: 'verified' } : { k: 'idle' },
  );
  const [cooldown, setCooldown] = React.useState(0);
  const [busy, setBusyState] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  /** The session as the server last described it, after each write here. */
  const latest = React.useRef<SessionView>(session);

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

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const sendCode = async (): Promise<void> => {
    const invalid = validateEmail(email);
    if (invalid) {
      setEmailError(invalid);
      return;
    }
    setEmailError(undefined);
    setBusy(true);
    const result = await sendContactAddCode('EMAIL', email.trim());
    setBusy(false);
    if (!result.ok) {
      setEmailError(result.fields.value ?? result.message);
      if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
      return;
    }
    setCode('');
    setEmailPhase({ k: 'sent', sentTo: result.data.sentTo, devCode: result.data.devCode ?? null });
    setCooldown(OTP_POLICY.resendCooldownSeconds);
  };

  const verifyCode = async (entered: string): Promise<void> => {
    setBusy(true);
    setEmailError(undefined);
    const result = await verifyContactAddCode('EMAIL', email.trim(), entered);
    setBusy(false);
    if (!result.ok) {
      setEmailError(result.fields.code ?? result.message);
      setCode('');
      return;
    }
    latest.current = result.data;
    onSession(result.data);
    setEmailPhase({ k: 'verified' });
  };

  /** Step 1's Continue: the name is written now, so nothing typed is lost. */
  const continueFromName = async (): Promise<void> => {
    const invalid = validateFullName(fullName);
    if (invalid) {
      setNameError(invalid);
      return;
    }
    setNameError(undefined);
    setFormError(null);
    const trimmed = fullName.trim();
    if (trimmed !== (latest.current.fullName ?? '')) {
      setBusy(true);
      const renamed = await updateMe(trimmed);
      setBusy(false);
      if (!renamed.ok) {
        setNameError(renamed.fields.fullName ?? renamed.message);
        return;
      }
      latest.current = renamed.data;
      onSession(renamed.data);
    }
    setSub(2);
  };

  /** Step 2's Save: the step is complete once both details are on the account. */
  const save = async (): Promise<void> => {
    if (emailPhase.k !== 'verified') {
      setEmailError('Verify your work email first — enter the code we sent to it.');
      return;
    }
    setFormError(null);
    setBusy(true);
    const answers = {
      fullName: latest.current.fullName ?? fullName.trim(),
      email: latest.current.email ?? email.trim(),
      mobile: latest.current.mobile ?? '',
      emailVerified: true,
      mobileVerified: true,
    };
    const saved = await saveStep('ACCOUNT', answers, 100);
    if (!saved.ok) {
      setBusy(false);
      setFormError(saved.message);
      return;
    }
    const completed = await completeStep('ACCOUNT');
    setBusy(false);
    if (!completed.ok) {
      setFormError(completed.message);
      return;
    }
    onSaved();
  };

  const submitRef = React.useRef<() => Promise<void>>(continueFromName);
  submitRef.current = sub === 1 ? continueFromName : save;
  React.useEffect(() => {
    registerSubmit(() => void submitRef.current());
  }, [registerSubmit]);

  if (sub === 1) {
    return (
      <div className="flex flex-col gap-5">
        <Input
          label="Your name"
          required
          value={fullName}
          onChange={(e) => {
            const typed = typeFullName(e.target.value);
            setFullName(typed);
            // Judged as it is typed; an empty box waits for Continue.
            setNameError(typed.trim() ? validateFullName(typed) : undefined);
          }}
          error={nameError}
          autoComplete="name"
        />
        <div>
          <p className="mb-1 block text-body-sm font-medium text-ink-2">Mobile</p>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono tnum text-body text-ink">{session.mobile ?? '—'}</span>
            {session.mobile ? <StatusPill tone="pass" label="Verified" /> : null}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {emailPhase.k === 'verified' ? (
        <div>
          <p className="mb-1 block text-body-sm font-medium text-ink-2">Work email</p>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-body text-ink">{latest.current.email ?? email}</span>
            <StatusPill tone="pass" label="Verified" />
          </p>
        </div>
      ) : (
        <>
          <Input
            label="Work email"
            required
            type="email"
            value={email}
            readOnly={emailPhase.k === 'sent'}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(e.target.value.trim() ? validateEmail(e.target.value) : undefined);
            }}
            error={emailPhase.k === 'idle' ? emailError : undefined}
            autoComplete="email"
          />
          {emailPhase.k === 'idle' ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                loading={busy}
                disabled={cooldown > 0}
                onClick={() => void sendCode()}
              >
                Send code
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-body-sm text-ink-2">
                Code sent to <span className="font-mono">{emailPhase.sentTo}</span>.
              </p>
              <OtpInput
                label="Six-digit code"
                value={code}
                onChange={setCode}
                onComplete={(c) => void verifyCode(c)}
                error={emailError}
                disabled={busy}
              />
              {emailPhase.devCode ? (
                <p className="text-body-sm text-ink-3" data-testid="prototype-code">
                  Prototype: your code is{' '}
                  <span className="font-mono tnum">{emailPhase.devCode}</span>.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={cooldown > 0 || busy}
                  onClick={() => void sendCode()}
                >
                  Resend code
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEmailPhase({ k: 'idle' })}
                >
                  Change email
                </Button>
                {cooldown > 0 ? (
                  <span className="text-body-sm text-ink-3">
                    Another code in <span className="font-mono tnum">{cooldown}</span>s
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}

      {formError ? (
        <p role="alert" className="text-body-sm text-fail">
          {formError}
        </p>
      ) : null}
    </div>
  );
}
