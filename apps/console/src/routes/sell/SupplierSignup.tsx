import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { BRAND } from '@trugrade/config/brand';
import { OtpInput } from '@trugrade/ui';
import { OTP_POLICY } from '@trugrade/contracts';
import { VendorSurfaceSync } from '../../lib/vendor-surface';
import {
  register,
  requestMfaCode,
  sendOtp,
  startOnboarding,
  verifyOtp,
} from '../../../../storefront/src/app/register/api';
import { MfaGate } from '../../../../storefront/src/app/register/MfaGate';
import { PROFILE_SECTIONS } from '../vendor/profile/sections.config';
import {
  liveFieldError,
  mobileSubscriberDigits,
  supplierPasswordRules,
  supplierPasswordStrength,
  toE164,
  type SignupFieldKey,
  typeFullName,
  validateEmail,
  validateFullName,
  validateMobile,
  validateSupplierPassword,
} from './signup-validation';
import '../auth/auth-split.css';
import '../auth/auth-wizard.css';

/**
 * ARCHETYPE F — Focus. One-minute supplier signup; business details come later.
 *
 * The approved split-screen mock. LEFT: a laptop gets the Trugrade treatment
 * on loop — the scan beam sweeps it, six check-dots pop around it, the A+ seal
 * stamps on, a payout pill rises — and beneath it the four supplier promises
 * tick themselves in. All CSS, in `auth-wizard.css`, and hidden from assistive
 * technology. RIGHT: the wizard the four progress bars count.
 *
 * The mock's wizard was mobile → code → details → done. The real one has one
 * more proof in it: the work email is verified with its own code before the
 * account is created, because the server only names a duplicate contact once
 * both channels are proved — so "details" is two steps here, and the bars
 * count four real ones. The done card is real too: it is on screen while the
 * fresh session is synced and the application opened, and the button on it
 * goes where that lands anyway.
 */

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

/** What the six check-dots around the machine are labelled. Illustration, in QC's own words. */
const DOTS = ['SCREEN', 'CHASSIS', 'BATTERY', 'PORTS', 'KEYBOARD', 'THERMALS'] as const;

const PROMISES = [
  { lead: 'We ', bold: 'inspect, grade and seal', rest: ' every machine before it goes live' },
  { lead: 'Your name is ', bold: 'never shown', rest: ' to buyers' },
  { lead: 'Payment on a ', bold: 'fixed cycle', rest: ', every deduction itemised' },
  { lead: '', bold: 'No listing fee,', rest: ' no monthly fee' },
] as const;

const two = (i: number): string => String(i + 1).padStart(2, '0');

const Tick = ({ width }: { width: number }): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

/**
 * The resend wait, as text. It used to exist only as the disabled button's
 * `title` tooltip, which a phone never shows — and a phone is where most
 * suppliers sign up — so the button simply looked broken for a minute.
 */
function ResendCountdown({ seconds }: { seconds: number }): React.JSX.Element | null {
  if (seconds <= 0) return null;
  return (
    <span data-testid="resend-countdown" aria-live="polite">
      You can ask for another code in <b>{seconds}</b> {seconds === 1 ? 'second' : 'seconds'}.
    </span>
  );
}

/* ==========================================================================
 * The brand panel
 * ======================================================================== */

function Scene(): React.JSX.Element {
  return (
    <div className="scene" aria-hidden="true">
      <div className="rig">
        <div className="lap">
          <div className="scr">
            <div className="glass">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="beam" />
          </div>
          <div className="base" />
        </div>
        {DOTS.map((label, i) => (
          <span className={`dot d${i + 1}`} key={label}>
            <Tick width={3} />
            <small>{label}</small>
          </span>
        ))}
        <div className="seal">
          <b>A+</b>
          <small>SEALED</small>
        </div>
        <div className="payout">
          ₹38,500 · <b>paid to you</b>
        </div>
      </div>
    </div>
  );
}

function BrandPanel(): React.JSX.Element {
  return (
    <aside className="left">
      <Link to="/" className="brand-logo" aria-label={`${BRAND.name} home`}>
        <span className="b" aria-hidden="true">
          t
        </span>
        <span className="t">
          <b>
            tru<i>grade</i>
          </b>
          <small>SUPPLIER HUB</small>
        </span>
      </Link>
      <h1>
        Your machines, <span>working for you.</span>
      </h1>
      <Scene />
      <ul className="promises" aria-label="What every supplier gets">
        {PROMISES.map((p) => (
          <li key={p.bold}>
            <span className="tickring" aria-hidden="true">
              <Tick width={3.4} />
            </span>
            <span>
              {p.lead}
              <b>{p.bold}</b>
              {p.rest}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ==========================================================================
 * The wizard
 * ======================================================================== */

export function SupplierSignup({ onSessionEstablished }: SupplierSignupProps): React.JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = React.useState<Step>(1);
  const [done, setDone] = React.useState(false);
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
  const [showPassword, setShowPassword] = React.useState(false);
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
  const [shaking, setShaking] = React.useState<SignupFieldKey | null>(null);

  const mobileDisplay = mobileDigits.length > 0 ? `+91 ${mobileDigits}` : '+91 ';
  const e164 = toE164(mobileDisplay);

  const markActive = (key: SignupFieldKey): void => {
    setActive((prev) => ({ ...prev, [key]: true }));
  };

  /** The mock's refusal: the field turns, shakes and takes focus. */
  const shake = (key: SignupFieldKey): void => {
    setShaking(null);
    requestAnimationFrame(() => setShaking(key));
  };

  const mobileError =
    // The digits, not the '+91 ' display: an untouched field is empty, and the
    // live rule must not read the prefix as something typed.
    liveFieldError('mobile', mobileDigits, () => validateMobile(mobileDisplay), focused, active) ??
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
      (value) => validateSupplierPassword(value, passwordContext),
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
    if (validation) {
      shake('mobile');
      return;
    }
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
    if (validation) {
      shake('email');
      return;
    }
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
    const passErr = validateSupplierPassword(password, passwordContext);
    if (nameErr) {
      shake('fullName');
      return;
    }
    if (passErr) {
      shake('password');
      return;
    }
    if (password !== confirm) {
      shake('confirm');
      return;
    }
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
   *
   * The done card is shown for the whole of that wait, so the account's
   * creation is told rather than implied by a page change.
   */
  const completeOnboarding = async (): Promise<void> => {
    setMfaSentTo(null);
    setDone(true);
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

  const strength = supplierPasswordStrength(password, passwordContext);
  const rules = supplierPasswordRules(password);
  const passwordEngaged = focused === 'password' || active.password;
  const passwordOk = password.length > 0 && !validateSupplierPassword(password, passwordContext);
  const stepFourBanner = error && step === 4 ? error : undefined;

  const stepHead =
    step === 1
      ? {
          title: 'Create your supplier account',
          sub: 'About a minute. Business details come later.',
        }
      : step === 2
        ? {
            title: 'Verify your mobile',
            sub: 'This number gets order alerts and payout confirmations.',
          }
        : step === 3
          ? {
              title: 'Your work email',
              sub: 'Purchase orders and payout statements go here.',
            }
          : {
              title: 'Set a password',
              sub: 'Who runs this account, and how you’ll sign in.',
            };

  const field = (key: SignupFieldKey, bad: boolean, extra = ''): string =>
    `field${extra}${bad ? ' bad' : ''}${shaking === key ? ' shake' : ''}`;

  const firstName = fullName.trim().split(' ')[0] ?? '';

  return (
    <div className="auth-split signup-split">
      <VendorSurfaceSync />
      <div className="split">
        <BrandPanel />
        <main className="right">
          <div className="panel">
            <div className="prog" aria-label="Signup progress" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={done ? 4 : step}>
              {[1, 2, 3, 4].map((n) => (
                <span
                  key={n}
                  className={`seg${done || n < step ? ' done' : n === step ? ' cur' : ''}`}
                >
                  <i />
                </span>
              ))}
            </div>

            {mfaSentTo ? (
              <div className="stage">
                <MfaGate
                  sentTo={mfaSentTo}
                  onVerified={async () => {
                    await completeOnboarding();
                  }}
                />
              </div>
            ) : done ? (
              <div className="done" data-testid="signup-done">
                <div className="done-badge" aria-hidden="true">
                  <Tick width={2.4} />
                </div>
                <h2>Account created.</h2>
                <p className="sub">
                  Welcome{firstName ? `, ${firstName}` : ''} — signed in on{' '}
                  <span className="font-mono tnum">{mobileSentTo ?? e164}</span>.
                </p>
                {error ? (
                  <p className="alert" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="next-box">
                  <h4>The application asks for {PROFILE_SECTIONS.length} short sections:</h4>
                  <ul className="next-chips">
                    {PROFILE_SECTIONS.map((s, i) => (
                      <li className="nchip" key={s.id}>
                        <i>{two(i)}</i>
                        {s.title}
                      </li>
                    ))}
                  </ul>
                  <p>
                    Stop after any section and come back — <b>nothing is submitted</b> until every
                    required one is saved.
                  </p>
                </div>
                <button
                  type="button"
                  className="go"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => void navigate('/vendor', { replace: true })}
                >
                  {busy ? 'Opening your application…' : 'Start your application'}
                </button>
              </div>
            ) : (
              <>
                <h2>{stepHead.title}</h2>
                <p className="sub">{stepHead.sub}</p>

                {step === 1 ? (
                  <form
                    className="stepbox"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      void sendMobileOtp();
                    }}
                  >
                    <label className="f-lbl" htmlFor="sup-mobile">
                      Mobile number <i>*</i>
                    </label>
                    <div
                      className={`mob${mobileError ? ' bad' : ''}${shaking === 'mobile' ? ' shake' : ''}`}
                    >
                      <span className="cc" aria-hidden="true">
                        +91
                      </span>
                      <input
                        id="sup-mobile"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        maxLength={10}
                        value={mobileDigits}
                        aria-invalid={Boolean(mobileError) || undefined}
                        aria-describedby={mobileError ? 'sup-mobile-error' : undefined}
                        placeholder="9876543210"
                        autoFocus
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
                      <p id="sup-mobile-error" className="err" role="alert">
                        {mobileError}
                      </p>
                    ) : null}
                    <button
                      type="submit"
                      className="go"
                      aria-disabled={validateMobile(mobileDisplay) ? true : undefined}
                      aria-busy={busy || undefined}
                    >
                      {busy ? 'Sending…' : 'Send OTP'}
                    </button>
                    <p className="links">
                      Already with us? <Link to="/login">Sign in</Link>
                    </p>
                  </form>
                ) : null}

                {step === 2 ? (
                  <div className="stepbox">
                    <p className="sent-line">
                      OTP sent to <b>{mobileSentTo ?? e164}</b>
                      <button
                        type="button"
                        onClick={() => {
                          setStep(1);
                          setMobileCode('');
                          setError(undefined);
                        }}
                      >
                        Change
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
                      <p className="proto" data-testid="prototype-code">
                        Prototype — your code is <b>{mobileDevCode}</b>
                      </p>
                    ) : null}
                    <p className="resend">
                      Didn&rsquo;t get it?{' '}
                      <button
                        type="button"
                        disabled={cooldown > 0 || busy}
                        onClick={() => void sendMobileOtp()}
                      >
                        Resend
                      </button>{' '}
                      <ResendCountdown seconds={cooldown} />
                    </p>
                    <button
                      type="button"
                      className="go"
                      aria-disabled={mobileCode.length < 6 ? true : undefined}
                      aria-busy={busy || undefined}
                      onClick={() => {
                        if (mobileCode.length < 6) {
                          setError('Enter all six digits.');
                          return;
                        }
                        void verifyMobileOtp(mobileCode);
                      }}
                    >
                      {busy ? 'Verifying…' : 'Verify'}
                    </button>
                  </div>
                ) : null}

                {step === 3 ? (
                  <form
                    className="stepbox"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!emailLocked) void sendEmailOtp();
                      else void verifyEmailAndContinue(emailCode);
                    }}
                  >
                    <label className="f-lbl" htmlFor="sup-email">
                      Work email address <i>*</i>
                    </label>
                    <input
                      id="sup-email"
                      className={field('email', Boolean(emailError))}
                      type="email"
                      autoComplete="email"
                      value={email}
                      readOnly={emailLocked}
                      placeholder="you@company.in"
                      aria-invalid={Boolean(emailError) || undefined}
                      aria-describedby={emailError ? 'sup-email-error' : undefined}
                      autoFocus
                      onFocus={() => setFocused('email')}
                      onBlur={() => setFocused(null)}
                      onChange={(e) => {
                        markActive('email');
                        setEmail(e.target.value);
                        setError(undefined);
                      }}
                    />
                    {emailError ? (
                      <p id="sup-email-error" className="err" role="alert">
                        {emailError}
                      </p>
                    ) : null}
                    {!emailLocked ? (
                      <button
                        type="submit"
                        className="go"
                        aria-disabled={validateEmail(email) ? true : undefined}
                        aria-busy={busy || undefined}
                      >
                        {busy ? 'Sending…' : 'Send OTP'}
                      </button>
                    ) : (
                      <div className="gap">
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
                          <p className="proto" data-testid="prototype-code">
                            Prototype — your code is <b>{emailDevCode}</b>
                          </p>
                        ) : null}
                        <p className="resend">
                          Didn&rsquo;t get it?{' '}
                          <button
                            type="button"
                            disabled={cooldown > 0 || busy}
                            onClick={() => void sendEmailOtp()}
                          >
                            Resend
                          </button>{' '}
                          <ResendCountdown seconds={cooldown} />
                        </p>
                        <button
                          type="submit"
                          className="go"
                          aria-disabled={emailCode.length < 6 ? true : undefined}
                          aria-busy={busy || undefined}
                        >
                          {busy ? 'Verifying…' : 'Verify and continue'}
                        </button>
                      </div>
                    )}
                  </form>
                ) : null}

                {step === 4 ? (
                  <form
                    className="stepbox"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      void finishSignup();
                    }}
                  >
                    <label className="f-lbl" htmlFor="sup-name">
                      Your name <i>*</i>
                    </label>
                    <input
                      id="sup-name"
                      className={field('fullName', Boolean(nameError))}
                      autoComplete="name"
                      placeholder="As on your PAN"
                      value={fullName}
                      aria-invalid={Boolean(nameError) || undefined}
                      aria-describedby={nameError ? 'sup-name-error' : undefined}
                      autoFocus
                      onFocus={() => setFocused('fullName')}
                      onBlur={() => setFocused(null)}
                      onChange={(e) => {
                        markActive('fullName');
                        setFullName(typeFullName(e.target.value));
                        setError(undefined);
                        setServerErrors((prev) => ({ ...prev, fullName: undefined }));
                      }}
                    />
                    {nameError ? (
                      <p id="sup-name-error" className="err" role="alert">
                        {nameError}
                      </p>
                    ) : null}

                    <label className="f-lbl gap" htmlFor="sup-password">
                      Password <i>*</i>
                    </label>
                    <div className="field-wrap">
                      <input
                        id="sup-password"
                        className={field('password', Boolean(passwordError), ' pw')}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={password}
                        aria-invalid={Boolean(passwordError) || undefined}
                        aria-describedby="sup-password-hint"
                        onFocus={() => setFocused('password')}
                        onBlur={() => setFocused(null)}
                        onChange={(e) => {
                          markActive('password');
                          setPassword(e.target.value);
                          setError(undefined);
                          setServerErrors((prev) => ({ ...prev, password: undefined }));
                        }}
                      />
                      <button
                        type="button"
                        className="eyebtn"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword((s) => !s)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                          <circle cx="12" cy="12" r="2.8" />
                          {showPassword ? <path d="M4 4l16 16" /> : null}
                        </svg>
                      </button>
                    </div>
                    <div className="meter" aria-hidden="true">
                      {[1, 2, 3, 4].map((n) => (
                        <span key={n} data-on={strength.score >= n} />
                      ))}
                    </div>
                    {passwordError ? (
                      <p className="err" role="alert">
                        {passwordError}
                      </p>
                    ) : null}
                    {passwordEngaged ? (
                      <ul className="rules" id="sup-password-hint">
                        {rules.map((rule) => (
                          <li key={rule.id} data-met={rule.met}>
                            {rule.label}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={`hint${passwordOk ? ' ok' : ''}`} id="sup-password-hint">
                        {passwordOk
                          ? 'Good — that’ll do.'
                          : 'At least one letter and one number.'}
                      </p>
                    )}

                    <label className="f-lbl gap" htmlFor="sup-confirm">
                      Confirm password <i>*</i>
                    </label>
                    <input
                      id="sup-confirm"
                      className={field('confirm', Boolean(confirmError))}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirm}
                      aria-invalid={Boolean(confirmError) || undefined}
                      aria-describedby={confirmError ? 'sup-confirm-error' : undefined}
                      onFocus={() => setFocused('confirm')}
                      onBlur={() => setFocused(null)}
                      onChange={(e) => {
                        markActive('confirm');
                        setConfirm(e.target.value);
                        setError(undefined);
                        setServerErrors((prev) => ({ ...prev, confirm: undefined }));
                      }}
                    />
                    {confirmError ? (
                      <p id="sup-confirm-error" className="err" role="alert">
                        {confirmError}
                      </p>
                    ) : null}

                    {refusal ? (
                      <div className="refusal" data-testid="signup-contact-refusal">
                        <p role="alert">{refusal.message}</p>
                        <p>
                          {refusal.channel === 'EMAIL' ? 'Email' : 'Mobile'}:{' '}
                          <span className="mono">{refusalValue}</span>
                        </p>
                        {refusal.kind === 'taken' ? (
                          <div className="row">
                            <button type="button" className="ghost" onClick={changeRefusedContact}>
                              {refusal.channel === 'EMAIL'
                                ? 'Use a different email'
                                : 'Use a different number'}
                            </button>
                            <Link to="/login" className="ghost">
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
                              <p className="proto">
                                Prototype — your code is <b>{refusal.devCode}</b>
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <div className="row">
                            <button
                              type="button"
                              className="ghost"
                              disabled={refusal.busy}
                              onClick={() => void resendForRefusal()}
                            >
                              Send a new code
                            </button>
                            {refusal.error ? <span className="err">{refusal.error}</span> : null}
                            <span>Your name and password stay as you typed them.</span>
                          </div>
                        )}
                      </div>
                    ) : null}
                    {stepFourBanner ? (
                      <p className="err" role="alert">
                        {stepFourBanner}
                      </p>
                    ) : null}
                    <button type="submit" className="go" aria-busy={busy || undefined}>
                      {busy ? 'Creating…' : 'Create account'}
                    </button>
                  </form>
                ) : null}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
