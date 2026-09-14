import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { Button, Input, OtpInput } from '@trugrade/ui';
import { OTP_POLICY } from '@trugrade/contracts';
import {
  register,
  requestMfaCode,
  sendOtp,
  startOnboarding,
  verifyOtp,
} from '../../../../storefront/src/app/register/api';
import { MfaGate } from '../../../../storefront/src/app/register/MfaGate';
import {
  mobileSubscriberDigits,
  signupPasswordStrength,
  toE164,
  typeFullName,
  validateEmail,
  validateFullName,
  validateMobile,
  validateSignupPassword,
} from './signup-validation';
import './supplier-signup.css';

/**
 * ARCHETYPE F — Focus. One-minute supplier signup; business details come later.
 */
const CLAIMS = [
  'Every machine opened and graded on site',
  'Paid after delivery, not before',
  'One invoice — TrueTech is the seller',
  'Sealed until it reaches the buyer',
] as const;

const STEP_LABELS = ['Mobile', 'Verify', 'Email', 'Account'] as const;

type Step = 1 | 2 | 3 | 4;

export interface SupplierSignupProps {
  onSessionEstablished?: () => void;
}

export function SupplierSignup({ onSessionEstablished }: SupplierSignupProps): React.JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = React.useState<Step>(1);
  const [mobileDigits, setMobileDigits] = React.useState('');
  const [mobileSentTo, setMobileSentTo] = React.useState<string | null>(null);
  const [mobileCode, setMobileCode] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [emailLocked, setEmailLocked] = React.useState(false);
  const [emailSentTo, setEmailSentTo] = React.useState<string | null>(null);
  const [emailCode, setEmailCode] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const [fieldError, setFieldError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);
  const [mfaSentTo, setMfaSentTo] = React.useState<string | null>(null);

  const mobileDisplay = mobileDigits.length > 0 ? `+91 ${mobileDigits}` : '+91 ';
  const e164 = toE164(mobileDisplay);

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const sendMobileOtp = async (): Promise<void> => {
    const validation = validateMobile(mobileDisplay);
    if (validation) {
      setFieldError(validation);
      return;
    }
    setFieldError(undefined);
    setError(undefined);
    setBusy(true);
    const result = await sendOtp('MOBILE', e164);
    setBusy(false);
    if (!result.ok) {
      setError(result.fields.value ?? result.message);
      if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
      return;
    }
    setMobileSentTo(result.data.sentTo);
    setCooldown(OTP_POLICY.resendCooldownSeconds);
    setStep(2);
  };

  const verifyMobileOtp = async (code: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await verifyOtp('MOBILE', e164, code);
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.fields.code);
      setMobileCode('');
      return;
    }
    setStep(3);
  };

  const sendEmailOtp = async (): Promise<void> => {
    const validation = validateEmail(email);
    if (validation) {
      setFieldError(validation);
      return;
    }
    setFieldError(undefined);
    setError(undefined);
    setBusy(true);
    const result = await sendOtp('EMAIL', email.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.fields.value ?? result.message);
      if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
      return;
    }
    setEmailLocked(true);
    setEmailSentTo(result.data.sentTo);
    setCooldown(OTP_POLICY.resendCooldownSeconds);
  };

  const verifyEmailAndContinue = async (code: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await verifyOtp('EMAIL', email.trim(), code);
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.fields.code);
      setEmailCode('');
      return;
    }
    setStep(4);
  };

  const finishSignup = async (): Promise<void> => {
    const nameErr = validateFullName(fullName);
    const passErr = validateSignupPassword(password);
    if (nameErr) {
      setFieldError(nameErr);
      return;
    }
    if (passErr) {
      setFieldError(passErr);
      return;
    }
    if (password !== confirm) {
      setFieldError('Passwords do not match.');
      return;
    }
    setFieldError(undefined);
    setError(undefined);
    setBusy(true);
    const result = await register('VENDOR', {
      fullName: fullName.trim(),
      email: email.trim(),
      mobile: e164,
      password,
    });
    setBusy(false);
    if (!result.ok) {
      setError(
        result.fields.mobile ??
          result.fields.email ??
          result.fields.password ??
          result.message,
      );
      return;
    }
    onSessionEstablished?.();
    if (result.data.mfaRequired) {
      setBusy(true);
      const sent = await requestMfaCode();
      setBusy(false);
      if (!sent.ok) {
        setError(sent.message);
        return;
      }
      setMfaSentTo(sent.data.sentTo);
      return;
    }
    await completeOnboarding();
  };

  const completeOnboarding = async (): Promise<void> => {
    setBusy(true);
    const started = await startOnboarding();
    setBusy(false);
    if (!started.ok) {
      setError(started.message);
      return;
    }
    void navigate('/vendor', { replace: true });
  };

  const strength = signupPasswordStrength(password);

  return (
    <div className="sup-signup-page">
      <div className="sup-signup-card">
        <aside className="sup-signup-brand" aria-hidden="true">
          <div>
            <p className="wm">
              tru<span className="g">grade</span>
            </p>
            <p className="sup-signup-claim">Supplier portal</p>
            <ul className="sup-signup-ticks">
              {CLAIMS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <p className="sup-signup-legal">{LEGAL_DISCLOSURE.legalName}</p>
        </aside>

        <div className="sup-signup-main">
          {mfaSentTo ? (
            <MfaGate
              sentTo={mfaSentTo}
              onVerified={async () => {
                await completeOnboarding();
              }}
            />
          ) : (
            <>
              <div className="sup-signup-progress" aria-label="Signup progress">
                {STEP_LABELS.map((label, i) => (
                  <span
                    key={label}
                    data-active={i + 1 <= step}
                    title={label}
                    aria-hidden="true"
                  />
                ))}
              </div>

              {step === 1 ? (
                <>
                  <h1 className="sup-signup-step-title">Mobile number</h1>
                  <div className="sup-signup-mobile-row">
                    <span className="sup-signup-prefix">+91</span>
                    <Input
                      label="Mobile"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      mono
                      value={mobileDigits}
                      maxLength={10}
                      error={fieldError}
                      onChange={(e) => {
                        setMobileDigits(mobileSubscriberDigits(e.target.value));
                        setFieldError(undefined);
                      }}
                      placeholder="9876543210"
                    />
                  </div>
                  <div className="sup-signup-actions">
                    <Button
                      variant="primary"
                      loading={busy}
                      onClick={() => void sendMobileOtp()}
                    >
                      Send code
                    </Button>
                    <Link to="/login" className="text-body-sm text-acc underline">
                      Sign in
                    </Link>
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <h1 className="sup-signup-step-title">Verify mobile</h1>
                  <p className="text-body-sm text-ink-2">
                    Code sent to{' '}
                    <span className="tnum text-ink">{mobileSentTo ?? e164}</span>
                  </p>
                  <OtpInput
                    label="Six-digit code"
                    value={mobileCode}
                    onChange={setMobileCode}
                    disabled={busy}
                    error={error}
                    onComplete={(code) => void verifyMobileOtp(code)}
                  />
                  <div className="sup-signup-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      disabledReason={
                        cooldown > 0 ? `Resend in ${cooldown} s` : undefined
                      }
                      loading={busy}
                      onClick={() => void sendMobileOtp()}
                    >
                      Resend
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                      Change number
                    </Button>
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <h1 className="sup-signup-step-title">Work email</h1>
                  <Input
                    label="Email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    readOnly={emailLocked}
                    error={fieldError}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldError(undefined);
                    }}
                    action={
                      !emailLocked ? (
                        <Button
                          type="button"
                          variant="secondary"
                          loading={busy}
                          disabledReason={
                            cooldown > 0 ? `Resend in ${cooldown} s` : undefined
                          }
                          onClick={() => void sendEmailOtp()}
                        >
                          Send code
                        </Button>
                      ) : undefined
                    }
                  />
                  {emailLocked ? (
                    <>
                      <OtpInput
                        label={`Code sent to ${emailSentTo ?? email}`}
                        value={emailCode}
                        onChange={setEmailCode}
                        disabled={busy}
                        error={error}
                        onComplete={(code) => void verifyEmailAndContinue(code)}
                      />
                      <div className="sup-signup-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          disabledReason={
                            cooldown > 0 ? `Resend in ${cooldown} s` : undefined
                          }
                          onClick={() => void sendEmailOtp()}
                        >
                          Resend
                        </Button>
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}

              {step === 4 ? (
                <>
                  <h1 className="sup-signup-step-title">Your account</h1>
                  <Input
                    label="Full name"
                    autoComplete="name"
                    value={fullName}
                    error={fieldError && fieldError.includes('name') ? fieldError : undefined}
                    onChange={(e) => {
                      setFullName(typeFullName(e.target.value));
                      setFieldError(undefined);
                    }}
                  />
                  <Input
                    label="Password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFieldError(undefined);
                    }}
                  />
                  <div className="sup-signup-meter" aria-hidden="true">
                    {[1, 2, 3].map((n) => (
                      <span key={n} data-on={strength.score >= n} />
                    ))}
                  </div>
                  <p className="text-body-sm text-ink-3">{strength.label}</p>
                  <Input
                    label="Confirm password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    error={error ?? (fieldError && !fieldError.includes('name') ? fieldError : undefined)}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      setFieldError(undefined);
                      setError(undefined);
                    }}
                  />
                  <div className="sup-signup-actions">
                    <Button variant="primary" loading={busy} onClick={() => void finishSignup()}>
                      Create account
                    </Button>
                  </div>
                </>
              ) : null}

              {error && step !== 2 && step !== 3 ? (
                <p className="text-body-sm text-fail" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
