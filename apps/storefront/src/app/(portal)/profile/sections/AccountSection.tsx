'use client';

import * as React from 'react';
import { Button, Input, Modal, OtpInput, StatusPill } from '@trugrade/ui';
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

/**
 * The Account card: the two things the mobile-only sign-up did not ask for.
 *
 * The name is written straight to the user. The work email is added the way
 * the mobile was proved — a code to the address, and nothing else — because
 * an unverified email is an address we cannot invoice or notify. Once both are
 * on the session the ACCOUNT step is saved and completed, so the server's own
 * `isSubmittable` counts it.
 *
 * The mobile is shown, not edited: it was proved at sign-in, and changing it is
 * the dual-code contact change, which is not this card's job.
 */

export interface AccountSectionProps {
  open: boolean;
  onClose: () => void;
  onSaved: (session: SessionView) => void;
  session: SessionView;
}

type EmailPhase =
  | { k: 'idle' }
  | { k: 'sent'; sentTo: string; devCode: string | null }
  | { k: 'verified' };

export function AccountSection({
  open,
  onClose,
  onSaved,
  session,
}: AccountSectionProps): React.JSX.Element {
  const [fullName, setFullName] = React.useState(session.fullName ?? '');
  const [nameError, setNameError] = React.useState<string | undefined>();
  const [email, setEmail] = React.useState(session.email ?? '');
  const [emailError, setEmailError] = React.useState<string | undefined>();
  const [code, setCode] = React.useState('');
  const [emailPhase, setEmailPhase] = React.useState<EmailPhase>(
    session.email ? { k: 'verified' } : { k: 'idle' },
  );
  const [cooldown, setCooldown] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  /** The session as the server last described it, after each write here. */
  const latest = React.useRef<SessionView>(session);

  React.useEffect(() => {
    if (!open) return;
    latest.current = session;
    setFullName(session.fullName ?? '');
    setEmail(session.email ?? '');
    setEmailPhase(session.email ? { k: 'verified' } : { k: 'idle' });
    setCode('');
    setNameError(undefined);
    setEmailError(undefined);
    setFormError(null);
  }, [open, session]);

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
    setEmailPhase({ k: 'verified' });
  };

  const save = async (): Promise<void> => {
    const invalid = validateFullName(fullName);
    if (invalid) {
      setNameError(invalid);
      return;
    }
    if (emailPhase.k !== 'verified') {
      setEmailError('Verify your work email first — enter the code we sent to it.');
      return;
    }
    setNameError(undefined);
    setFormError(null);
    setBusy(true);

    const trimmed = fullName.trim();
    if (trimmed !== (latest.current.fullName ?? '')) {
      const renamed = await updateMe(trimmed);
      if (!renamed.ok) {
        setBusy(false);
        setNameError(renamed.fields.fullName ?? renamed.message);
        return;
      }
      latest.current = renamed.data;
    }

    const answers = {
      fullName: trimmed,
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
    onSaved(latest.current);
  };

  const footer = (
    <div className="flex w-full flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button type="button" variant="primary" loading={busy} onClick={() => void save()}>
        Save
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Account"
      description="Who you are, and the work email we send invoices and order updates to."
      size="md"
      footer={footer}
    >
      <div className="flex flex-col gap-5">
        <Input
          label="Your name"
          required
          value={fullName}
          onChange={(e) => setFullName(typeFullName(e.target.value))}
          error={nameError}
          autoComplete="name"
        />

        <div>
          <p className="mb-1 block text-body-sm font-medium text-ink-2">Mobile</p>
          <p className="font-mono tnum text-body text-ink">{session.mobile ?? '—'}</p>
          <p className="mt-1 text-body-sm text-ink-3">Verified when you signed in.</p>
        </div>

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
              onChange={(e) => setEmail(e.target.value)}
              error={emailPhase.k === 'idle' ? emailError : undefined}
              autoComplete="email"
              hint="We send a six-digit code to prove it is yours."
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
    </Modal>
  );
}
