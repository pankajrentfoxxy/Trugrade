import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Input, OtpInput } from '@trugrade/ui';
import { SupplierBrandPanel } from '../../AuthShell';
import { VendorSurfaceSync } from '../../lib/vendor-surface';
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
  liveFieldError,
  mobileSubscriberDigits,
  signupPasswordRules,
  signupPasswordStrength,
  toE164,
  type SignupFieldKey,
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
const STEP_LABELS = ['Mobile', 'Verify', 'Email', 'Account'] as const;

type Step = 1 | 2 | 3 | 4;

/**
 * A contact `POST /auth/register` refused at the last step. `expired` is the
 * thirty-minute proof lapsing while the supplier chose a password; `taken` is a
 * duplicate the server names only once both channels are proved.
 */
interface ContactRefusal {
  channel: 'EMAIL' | 'MOBILE';
  kind: 'expired' | 'taken';
  message: string;
  sentTo: string | null;
  code: string;
  devCode: string | null;
  busy: boolean;
  error: string | null;
}

export interface SupplierSignupProps {
  /**
   * Awaited before this screen navigates anywhere. Called once right after
   * `register()` succeeds and, separately, once the second factor clears — see
   * the note on `completeOnboarding` for why the second call has to happen and
   * has to be awaited, not fired and forgotten.
   */
  onSessionEstablished?: () => Promise<void> | void;
}

/**
 * The resend wait, as text. It used to exist only as the disabled button's
 * `title` tooltip, which a phone never shows — and a phone is where most
 * suppliers sign up — so the button simply looked broken for a minute.
 */
function ResendCountdown({ seconds }: { seconds: number }): React.JSX.Element | null {
  if (seconds <= 0) return null;
  return (
    <p className="text-body-sm text-ink-3" aria-live="polite" data-testid="resend-countdown">
      You can ask for another code in <span className="font-mono tnum">{seconds}</span>{' '}
      {seconds === 1 ? 'second' : 'seconds'}.
    </p>
  );
}

export function SupplierSignup({ onSessionEstablished }: SupplierSignupProps): React.JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = React.useState<Step>(1);
  const [mobileDigits, setMobileDigits] = React.useState('');
  const [mobileSentTo, setMobileSentTo] = React.useState<string | null>(null);
  const [mobileCode, setMobileCode] = React.useState('');
  const [mobileDevCode, setMobileDevCode] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState('');
  const [emailLocked, setEmailLocked] = React.useState(false);
  const [emailSentTo, setEmailSentTo] = React.useState<string | null>(null);
  const [emailCode, setEmailCode] = React.useState('');
  const [emailDevCode, setEmailDevCode] = React.useState<string | null>(null);
  const [fullName, setFullName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const [serverErrors, setServerErrors] = React.useState<Partial<Record<SignupFieldKey, string>>>(
    {},
  );
  const [busy, setBusy] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);
  const [mfaSentTo, setMfaSentTo] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState<SignupFieldKey | null>(null);
  const [active, setActive] = React.useState<Partial<Record<SignupFieldKey, boolean>>>({});
  const [refusal, setRefusal] = React.useState<ContactRefusal | null>(null);

  const mobileDisplay = mobileDigits.length > 0 ? `+91 ${mobileDigits}` : '+91 ';
  const e164 = toE164(mobileDisplay);

  const markActive = (key: SignupFieldKey): void => {
    setActive((prev) => ({ ...prev, [key]: true }));
  };

  const mobileError =
    liveFieldError('mobile', mobileDisplay, validateMobile, focused, active) ??
    (error && step === 1 ? error : undefined);

  const emailError =
    liveFieldError('email', email, validateEmail, focused, active) ??
    (error && step === 3 && !emailLocked ? error : undefined);

  const passwordContext = React.useMemo(
    () => ({ email: email.trim(), mobile: e164 }),
    [email, e164],
  );

  const nameError =
    liveFieldError('fullName', fullName, validateFullName, focused, active) ??
    serverErrors.fullName;

  const passwordError =
    liveFieldError(
      'password',
      password,
      (value) => validateSignupPassword(value, passwordContext),
      focused,
      active,
    ) ?? serverErrors.password;

  const confirmError =
    liveFieldError(
      'confirm',
      confirm,
      (value) => (value.length > 0 && value !== password ? 'Passwords do not match.' : undefined),
      focused,
      active,
    ) ?? serverErrors.confirm;

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const sendMobileOtp = async (): Promise<void> => {
    markActive('mobile');
    const validation = validateMobile(mobileDisplay);
    if (validation) return;
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
    setMobileDevCode(result.data.devCode ?? null);
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
    setMobileDevCode(null);
    setStep(3);
  };

  const sendEmailOtp = async (): Promise<void> => {
    markActive('email');
    const validation = validateEmail(email);
    if (validation) return;
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
    setEmailDevCode(result.data.devCode ?? null);
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
    setEmailDevCode(null);
    setStep(4);
  };

  const finishSignup = async (): Promise<void> => {
    markActive('fullName');
    markActive('password');
    markActive('confirm');
    const nameErr = validateFullName(fullName);
    const passErr = validateSignupPassword(password, passwordContext);
    if (nameErr || passErr) return;
    if (password !== confirm) return;
    setError(undefined);
    setServerErrors({});
    setBusy(true);
    const result = await register('VENDOR', {
      fullName: fullName.trim(),
      email: email.trim(),
      mobile: e164,
      password,
    });
    setBusy(false);
    if (!result.ok) {
      // Email and mobile are not on this step, so a refusal naming either one
      // used to be stored against a field that was not drawn — and the supplier
      // pressed "Create account" to no visible effect at all.
      const contactMessage = result.fields.email ?? result.fields.mobile;
      if (contactMessage) {
        const channel = result.fields.email ? 'EMAIL' : 'MOBILE';
        const taken = /already registered/i.test(`${result.message} ${contactMessage}`);
        setRefusal({
          channel,
          kind: taken ? 'taken' : 'expired',
          message: taken ? contactMessage : result.message,
          sentTo: null,
          code: '',
          devCode: null,
          busy: false,
          error: null,
        });
        setError(undefined);
        return;
      }
      const next: Partial<Record<SignupFieldKey, string>> = {};
      if (result.fields.password) next.password = result.fields.password;
      if (result.fields.fullName) next.fullName = result.fields.fullName;
      setServerErrors(next);
      const hasField = Object.keys(next).length > 0;
      setError(hasField ? undefined : result.message);
      return;
    }
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

  /**
   * Reached twice: directly from `finishSignup` when the fresh account needs
   * no second factor, and from `MfaGate.onVerified` once it clears one. Either
   * way the browser is about to land on `/vendor`, which `RequirePermission`
   * guards on `useAuth().principal` — and that principal lives in React
   * context, not in the cookies `register`, `verifyMfa` and `startOnboarding`
   * read and write directly.
   *
   * Nothing else on this screen ever calls back into the console's
   * `AuthContext`, so skipping this await left context holding the PRE-MFA
   * principal (`mfaRequired: true`) at the moment `/vendor` first rendered —
   * `RequirePermission` saw that flag and bounced the brand-new account to
   * `/login`, which read the same stale flag off its own session check and
   * asked for a second, redundant code. `onSessionEstablished` is `syncSession`
   * (see `VendorRegisterRoute`), and awaiting it here is what makes the
   * principal current before the guard ever looks at it.
   */
  const completeOnboarding = async (): Promise<void> => {
    setBusy(true);
    await onSessionEstablished?.();
    const started = await startOnboarding();
    setBusy(false);
    if (!started.ok) {
      setError(started.message);
      return;
    }
    void navigate('/vendor', { replace: true });
  };

  const refusalValue = refusal?.channel === 'EMAIL' ? email.trim() : e164;

  const patchRefusal = (patch: Partial<ContactRefusal>): void =>
    setRefusal((prev) => (prev ? { ...prev, ...patch } : prev));

  /** Re-prove a lapsed channel here, without losing the name and password typed. */
  const resendForRefusal = async (): Promise<void> => {
    if (!refusal) return;
    patchRefusal({ busy: true, error: null });
    const result = await sendOtp(refusal.channel, refusalValue);
    if (!result.ok) {
      patchRefusal({ busy: false, error: result.fields.value ?? result.message });
      return;
    }
    patchRefusal({
      busy: false,
      sentTo: result.data.sentTo,
      devCode: result.data.devCode ?? null,
      code: '',
    });
  };

  const verifyForRefusal = async (code: string): Promise<void> => {
    if (!refusal) return;
    patchRefusal({ busy: true, error: null });
    const result = await verifyOtp(refusal.channel, refusalValue, code);
    if (!result.ok) {
      patchRefusal({ busy: false, code: '', error: result.message || result.fields.code || null });
      return;
    }
    setRefusal(null);
  };

  /** A taken address cannot be re-proved; go back to the step that asks for it. */
  const changeRefusedContact = (): void => {
    if (!refusal) return;
    if (refusal.channel === 'EMAIL') {
      setEmailLocked(false);
      setEmailCode('');
      setEmailSentTo(null);
      setStep(3);
    } else {
      setMobileCode('');
      setStep(1);
    }
    setRefusal(null);
  };

  const strength = signupPasswordStrength(password, passwordContext);
  const rules = signupPasswordRules(password);
  const passwordEngaged = focused === 'password' || active.password;
  const stepFourBanner = error && step === 4 ? error : undefined;

  const stepHead =
    step === 1
      ? {
          title: 'Create your supplier account',
          sub: 'About a minute. Business details come later.',
        }
      : step === 2
        ? { title: 'Verify your mobile', sub: null }
        : step === 3
          ? {
              title: 'Your work email',
              sub: 'Purchase orders and payout statements go here.',
            }
          : {
              title: 'Set a password',
              sub: 'Mobile and email verified. One more field.',
            };

  return (
    <div className="sup-signup-page">
      <VendorSurfaceSync />
      <div className="sup-signup-card">
        <SupplierBrandPanel />

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
                  <span key={label} data-active={i + 1 <= step} title={label} aria-hidden="true" />
                ))}
              </div>

              <div className="sup-signup-head">
                <h1 className="sup-signup-step-title">{stepHead.title}</h1>
                {stepHead.sub ? <p className="sup-signup-step-sub">{stepHead.sub}</p> : null}
              </div>

              {step === 1 ? (
                <div className="sup-signup-fields">
                  <div>
                    <label htmlFor="sup-mobile" className="sup-signup-field-label">
                      Mobile number <span className="req">*</span>
                    </label>
                    <div className="sup-signup-mobile-row">
                      <span className="sup-signup-prefix">+91</span>
                      <input
                        id="sup-mobile"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        maxLength={10}
                        value={mobileDigits}
                        aria-invalid={Boolean(mobileError) || undefined}
                        aria-describedby={mobileError ? 'sup-mobile-error' : undefined}
                        placeholder="9876543210"
                        onFocus={() => setFocused('mobile')}
                        onBlur={() => setFocused(null)}
                        onChange={(e) => {
                          markActive('mobile');
                          setMobileDigits(mobileSubscriberDigits(e.target.value));
                          setError(undefined);
                        }}
                      />
                    </div>
                    {mobileError ? (
                      <p id="sup-mobile-error" className="sup-signup-field-error" role="alert">
                        {mobileError}
                      </p>
                    ) : null}
                  </div>
                  <div className="sup-signup-actions">
                    <Button
                      variant="primary"
                      loading={busy}
                      disabledReason={validateMobile(mobileDisplay)}
                      onClick={() => void sendMobileOtp()}
                    >
                      Send OTP
                    </Button>
                    <p className="sup-signup-foot">
                      Already with us? <Link to="/login">Sign in</Link>
                    </p>
                  </div>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="sup-signup-fields">
                  <p className="sup-signup-sent">
                    Code sent to <span className="tnum">{mobileSentTo ?? e164}</span>
                    <button
                      type="button"
                      className="sup-signup-change"
                      onClick={() => {
                        setStep(1);
                        setMobileCode('');
                        setError(undefined);
                      }}
                    >
                      change
                    </button>
                  </p>
                  <OtpInput
                    label="Six-digit code"
                    value={mobileCode}
                    onChange={(code) => {
                      setMobileCode(code);
                      setError(undefined);
                    }}
                    disabled={busy}
                    error={error}
                    onComplete={(code) => void verifyMobileOtp(code)}
                  />
                  {mobileDevCode ? (
                    <p className="sup-signup-prototype">
                      Prototype — your code is <span className="tnum">{mobileDevCode}</span>
                    </p>
                  ) : null}
                  <div className="sup-signup-actions">
                    <Button
                      variant="primary"
                      loading={busy}
                      disabledReason={mobileCode.length < 6 ? 'Enter all six digits.' : undefined}
                      onClick={() => void verifyMobileOtp(mobileCode)}
                    >
                      Verify
                    </Button>
                    <div className="sup-signup-actions-row">
                      <Button
                        type="button"
                        variant="secondary"
                        disabledReason={cooldown > 0 ? `Resend in ${cooldown} s` : undefined}
                        loading={busy}
                        onClick={() => void sendMobileOtp()}
                      >
                        Resend
                      </Button>
                      <ResendCountdown seconds={cooldown} />
                    </div>
                  </div>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="sup-signup-fields">
                  <Input
                    label="Email address"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    readOnly={emailLocked}
                    error={emailError}
                    placeholder="name@company.com"
                    onFocus={() => setFocused('email')}
                    onBlur={() => setFocused(null)}
                    onChange={(e) => {
                      markActive('email');
                      setEmail(e.target.value);
                      setError(undefined);
                    }}
                  />
                  {!emailLocked ? (
                    <div className="sup-signup-actions">
                      <Button
                        variant="primary"
                        loading={busy}
                        disabledReason={validateEmail(email)}
                        onClick={() => void sendEmailOtp()}
                      >
                        Send OTP
                      </Button>
                    </div>
                  ) : (
                    <>
                      <OtpInput
                        label={`Code sent to ${emailSentTo ?? email}`}
                        value={emailCode}
                        onChange={(code) => {
                          setEmailCode(code);
                          setError(undefined);
                        }}
                        disabled={busy}
                        error={error}
                        onComplete={(code) => void verifyEmailAndContinue(code)}
                      />
                      {emailDevCode ? (
                        <p className="sup-signup-prototype">
                          Prototype — your code is <span className="tnum">{emailDevCode}</span>
                        </p>
                      ) : null}
                      <div className="sup-signup-actions">
                        <Button
                          variant="primary"
                          loading={busy}
                          disabledReason={
                            emailCode.length < 6 ? 'Enter all six digits.' : undefined
                          }
                          onClick={() => void verifyEmailAndContinue(emailCode)}
                        >
                          Verify and continue
                        </Button>
                        <div className="sup-signup-actions-row">
                          <Button
                            type="button"
                            variant="secondary"
                            disabledReason={cooldown > 0 ? `Resend in ${cooldown} s` : undefined}
                            onClick={() => void sendEmailOtp()}
                          >
                            Resend
                          </Button>
                          <ResendCountdown seconds={cooldown} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {step === 4 ? (
                <div className="sup-signup-fields">
                  <Input
                    label="Your name"
                    autoComplete="name"
                    required
                    value={fullName}
                    error={nameError}
                    onFocus={() => setFocused('fullName')}
                    onBlur={() => setFocused(null)}
                    onChange={(e) => {
                      markActive('fullName');
                      setFullName(typeFullName(e.target.value));
                      setError(undefined);
                      setServerErrors((prev) => ({ ...prev, fullName: undefined }));
                    }}
                  />
                  <div>
                    <Input
                      label="Password"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={password}
                      error={passwordError}
                      placeholder="At least 12 characters"
                      onFocus={() => setFocused('password')}
                      onBlur={() => setFocused(null)}
                      onChange={(e) => {
                        markActive('password');
                        setPassword(e.target.value);
                        setError(undefined);
                        setServerErrors((prev) => ({ ...prev, password: undefined }));
                      }}
                    />
                    <div className="sup-signup-meter mt-2" aria-hidden="true">
                      {[1, 2, 3, 4].map((n) => (
                        <span key={n} data-on={strength.score >= n} />
                      ))}
                    </div>
                    {passwordEngaged ? (
                      <ul className="sup-signup-rules mt-2">
                        {rules.map((rule) => (
                          <li key={rule.id} data-met={rule.met}>
                            {rule.label}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-body-sm text-ink-3 mt-2">
                        12+ characters, one lowercase, one capital, one number, one symbol
                      </p>
                    )}
                  </div>
                  <Input
                    label="Confirm password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    error={confirmError}
                    onFocus={() => setFocused('confirm')}
                    onBlur={() => setFocused(null)}
                    onChange={(e) => {
                      markActive('confirm');
                      setConfirm(e.target.value);
                      setError(undefined);
                      setServerErrors((prev) => ({ ...prev, confirm: undefined }));
                    }}
                  />
                  {refusal ? (
                    <div
                      className="flex flex-col gap-3 rounded border border-fail bg-sheet-2 p-4"
                      data-testid="signup-contact-refusal"
                    >
                      <p role="alert" className="text-body-sm text-ink">
                        {refusal.message}
                      </p>
                      <p className="text-body-sm text-ink-2">
                        {refusal.channel === 'EMAIL' ? 'Email' : 'Mobile'}:{' '}
                        <span className="font-mono tnum text-ink">{refusalValue}</span>
                      </p>
                      {refusal.kind === 'taken' ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <Button type="button" variant="secondary" onClick={changeRefusedContact}>
                            {refusal.channel === 'EMAIL'
                              ? 'Use a different email'
                              : 'Use a different number'}
                          </Button>
                          <Link
                            to="/login"
                            className="text-body-sm text-acc-ink underline underline-offset-4"
                          >
                            Sign in instead
                          </Link>
                        </div>
                      ) : refusal.sentTo ? (
                        <>
                          <OtpInput
                            label={`Code sent to ${refusal.sentTo}`}
                            value={refusal.code}
                            onChange={(code) => patchRefusal({ code, error: null })}
                            disabled={refusal.busy}
                            error={refusal.error ?? undefined}
                            onComplete={(code) => void verifyForRefusal(code)}
                          />
                          {refusal.devCode ? (
                            <p className="sup-signup-prototype">
                              Prototype — your code is{' '}
                              <span className="tnum">{refusal.devCode}</span>
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              loading={refusal.busy}
                              onClick={() => void resendForRefusal()}
                            >
                              Send a new code
                            </Button>
                          </div>
                          {refusal.error ? (
                            <p className="text-body-sm text-fail">{refusal.error}</p>
                          ) : null}
                          <p className="text-body-sm text-ink-3">
                            Your name and password stay as you typed them.
                          </p>
                        </div>
                      )}
                    </div>
                  ) : null}
                  {stepFourBanner ? (
                    <p className="text-body-sm text-fail" role="alert">
                      {stepFourBanner}
                    </p>
                  ) : null}
                  <div className="sup-signup-actions">
                    <Button variant="primary" loading={busy} onClick={() => void finishSignup()}>
                      Create account
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
