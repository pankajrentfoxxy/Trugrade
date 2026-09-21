import * as React from 'react';
import { BRAND } from '@trugrade/config/brand';
import { OTP_POLICY } from '@trugrade/contracts';
import { OtpInput, RateLimitNotice } from '@trugrade/ui';
import { VendorSurfaceSync } from '../lib/vendor-surface';
import {
  resetPassword,
  sendPasswordResetCode,
  type ApiFailure,
} from '../../../storefront/src/app/register/api';
import {
  signupPasswordRules,
  signupPasswordStrength,
  validateSignupPassword,
} from './sell/signup-validation';
import './auth/auth-split.css';
import './auth/auth-wizard.css';
import './auth/reset-split.css';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 *
 * The approved split-screen mock. LEFT: an envelope opens, a spark shuttles
 * six times along the dashed line, six digits pop into the padlock's slots,
 * and the shackle springs open. RIGHT: the three steps the bars count — the
 * address, the code, the new password — then done.
 *
 * Staff and suppliers reset here on the console origin so cookies and the
 * `/api` proxy stay first-party — same reason vendor registration lives here.
 *
 * The same rule as the sign-in screen governs it: **the answer never depends
 * on whether the address has an account.** "If it has an account, a code is
 * on its way" is said either way, the wait is the same wait, and a code that
 * does not work says one thing whether it was wrong, expired, or issued for an
 * address nobody has ever registered. A reset form is the enumeration oracle
 * people forget about, because it feels like a helpful place to say "we don't
 * know that address".
 *
 * The code is verified and spent in the same call as the new password, because
 * `POST /auth/password/reset` takes both. Holding the code across the third
 * step, rather than round-tripping, is what makes that one call possible — and
 * why a refused code sends the person back to the code step, with the
 * server's sentence, rather than leaving them on a password form that has no
 * way to ask for another.
 */

const SIGN_IN = '/login';

type Stage =
  | { k: 'ask' }
  | { k: 'code'; sentTo: string }
  | { k: 'choose'; sentTo: string; code: string }
  | { k: 'done' };

interface Wait {
  message: string;
  seconds: number | null;
}

const STEP: Readonly<Record<Stage['k'], number>> = { ask: 1, code: 2, choose: 3, done: 4 };

const HEAD: Readonly<Record<Exclude<Stage['k'], 'done'>, { title: string; sub: string }>> = {
  ask: {
    title: 'Reset your password',
    sub: 'We email a six-digit code to the address the account was opened with.',
  },
  code: {
    title: 'Enter the code we emailed you',
    sub: `Six digits, valid for ${OTP_POLICY.ttlSeconds / 60} minutes.`,
  },
  choose: {
    title: 'Choose a new password',
    sub: 'Pick one you don’t use anywhere else.',
  },
};

const validEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

const EyeIcon = ({ open }: { open: boolean }): React.JSX.Element => (
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
    {open ? <path d="M4 4l16 16" /> : null}
  </svg>
);

/* ==========================================================================
 * The brand panel
 * ======================================================================== */

function Scene(): React.JSX.Element {
  return (
    <div className="scene" aria-hidden="true">
      <div className="rig">
        <div className="env">
          <span className="flap" />
          <span className="at">@</span>
        </div>
        <span className="path" />
        <span className="spark" />
        <div className="lock">
          <div className="shackle" />
          <span className="unlocked">UNLOCKED</span>
          <div className="lockbody">
            <small>RESET CODE</small>
            <div className="slots">
              {['4', '2', '4', '2', '4', '2'].map((d, i) => (
                <span className="slot" key={i}>
                  <i>{d}</i>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrandPanel(): React.JSX.Element {
  return (
    <aside className="left">
      <a href="/" className="brand-logo" aria-label={`${BRAND.name} home`}>
        <span className="b" aria-hidden="true">
          t
        </span>
        <span className="t">
          <b>
            tru<i>grade</i>
          </b>
          <small>SUPPLIER HUB</small>
        </span>
      </a>
      <h1>
        Locked out? <span>One code away.</span>
      </h1>
      <p className="sub">
        We email a six-digit code to the address the account was opened with — type it in, set a
        new password, <b>back in under a minute</b>.
      </p>
      <Scene />
    </aside>
  );
}

/* ==========================================================================
 * The route
 * ======================================================================== */

export function ForgotPasswordRoute(): React.JSX.Element {
  const [stage, setStage] = React.useState<Stage>({ k: 'ask' });
  const [email, setEmail] = React.useState('');
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [passwordTouched, setPasswordTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | undefined>();
  const [confirmError, setConfirmError] = React.useState<string | undefined>();
  const [wait, setWait] = React.useState<Wait | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);
  const [shaking, setShaking] = React.useState<'email' | 'password' | 'confirm' | null>(null);

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const shake = (key: 'email' | 'password' | 'confirm'): void => {
    setShaking(null);
    requestAnimationFrame(() => setShaking(key));
  };

  const refuse = (failure: ApiFailure): void => {
    setBusy(false);
    if (failure.code === 'RATE_LIMITED') {
      setError(null);
      setWait({ message: failure.message, seconds: failure.retryAfterSeconds });
      return;
    }
    setWait(null);
    setError(failure.message);
  };

  const request = async (): Promise<void> => {
    const trimmed = email.trim();
    if (!validEmail(trimmed)) {
      setEmailError('Enter a valid work email.');
      shake('email');
      return;
    }
    setEmailError(null);
    setBusy(true);
    setError(null);
    const sent = await sendPasswordResetCode(trimmed);
    if (!sent.ok) {
      refuse(sent);
      return;
    }
    setBusy(false);
    setCode('');
    setCooldown(OTP_POLICY.resendCooldownSeconds);
    setStage({ k: 'code', sentTo: sent.data.sentTo });
  };

  const resend = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const sent = await sendPasswordResetCode(email.trim());
    setBusy(false);
    if (!sent.ok) {
      refuse(sent);
      return;
    }
    setCode('');
    setCooldown(OTP_POLICY.resendCooldownSeconds);
    setStage({ k: 'code', sentTo: sent.data.sentTo });
  };

  const commit = async (): Promise<void> => {
    if (stage.k !== 'choose') return;
    setPasswordTouched(true);
    const rule = validateSignupPassword(password, { email: email.trim() });
    if (rule) {
      setFieldError(rule);
      shake('password');
      return;
    }
    if (confirm !== password) {
      setConfirmError('These don’t match yet.');
      shake('confirm');
      return;
    }
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    setConfirmError(undefined);
    const result = await resetPassword({ email: email.trim(), code: stage.code, password });
    if (!result.ok) {
      // The password rules are the one refusal that belongs on the field. Every
      // other one is about the code, and the code is spent by then — so go back
      // to the step that can ask for another, carrying the server's sentence.
      if (result.fields.password) {
        setFieldError(result.fields.password);
        setBusy(false);
        return;
      }
      refuse(result);
      if (result.code !== 'RATE_LIMITED') {
        setCode('');
        setStage({ k: 'code', sentTo: stage.sentTo });
      }
      return;
    }
    setBusy(false);
    setStage({ k: 'done' });
  };

  const notices = (
    <div className="notices">
      {wait && (
        <RateLimitNotice
          message={wait.message}
          retryAfterSeconds={wait.seconds}
          onExpire={() => setWait(null)}
        />
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </div>
  );

  const step = STEP[stage.k];
  const rules = signupPasswordRules(password);
  const strength = signupPasswordStrength(password, { email: email.trim() });
  const passwordOk = password.length > 0 && !validateSignupPassword(password, { email });
  const match = confirm.length > 0 && confirm === password;

  return (
    <div className="auth-split reset-split">
      <VendorSurfaceSync />
      <div className="split">
        <BrandPanel />
        <main className="right">
          <div className="panel">
            <div
              className="prog"
              role="progressbar"
              aria-label="Reset progress"
              aria-valuemin={1}
              aria-valuemax={3}
              aria-valuenow={Math.min(step, 3)}
            >
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={`seg${n < step ? ' done' : n === step ? ' cur' : ''}`}
                >
                  <i />
                </span>
              ))}
            </div>

            {stage.k === 'done' ? (
              <div className="done" data-testid="reset-done">
                <div className="done-badge" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m4.5 12.5 5 5L19.5 7" />
                  </svg>
                </div>
                <h2>Password changed.</h2>
                <p className="sub">
                  Every signed-in session was signed out, including any you did not start. Use the
                  new password from now on.
                </p>
                <a className="go" href={SIGN_IN}>
                  Back to sign in
                </a>
              </div>
            ) : (
              <>
                <h2>{HEAD[stage.k].title}</h2>
                <p className="sub">{HEAD[stage.k].sub}</p>

                {stage.k === 'ask' ? (
                  <form
                    className="stepbox"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      void request();
                    }}
                  >
                    {notices}
                    <label className="f-lbl" htmlFor="reset-email">
                      Work email <i>*</i>
                    </label>
                    <input
                      id="reset-email"
                      name="email"
                      type="email"
                      className={`field${emailError ? ' bad' : ''}${shaking === 'email' ? ' shake' : ''}`}
                      placeholder="you@company.in"
                      autoComplete="username"
                      autoFocus
                      value={email}
                      aria-invalid={emailError ? true : undefined}
                      aria-describedby={emailError ? 'reset-email-err' : undefined}
                      onChange={(e) => {
                        setEmail(e.currentTarget.value);
                        setEmailError(null);
                      }}
                    />
                    {emailError ? (
                      <p className="err" id="reset-email-err">
                        {emailError}
                      </p>
                    ) : null}
                    <button
                      type="submit"
                      className="go"
                      disabled={busy || wait !== null}
                      aria-disabled={wait ? true : undefined}
                      aria-busy={busy || undefined}
                      title={wait ? 'Too many attempts. The wait above has to run out first.' : undefined}
                    >
                      Email me a reset code
                    </button>
                    <p className="note">
                      We say the same thing whether or not that address has an account — telling
                      you would tell anybody who asked. <a href={SIGN_IN}>Back to sign in</a>
                    </p>
                  </form>
                ) : null}

                {stage.k === 'code' ? (
                  <div className="stepbox">
                    {notices}
                    <p className="sent-line">
                      If <b>{stage.sentTo}</b> has an account, a code is on its way.
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setCode('');
                          setStage({ k: 'ask' });
                        }}
                      >
                        Change
                      </button>
                    </p>
                    <OtpInput
                      label="Six-digit code"
                      value={code}
                      onChange={(v) => {
                        setCode(v);
                        setError(null);
                      }}
                      disabled={busy || wait !== null}
                      onComplete={(entered) => {
                        // Verified and spent together with the new password: held
                        // here, not round-tripped.
                        setStage({ k: 'choose', sentTo: stage.sentTo, code: entered });
                      }}
                    />
                    <p className="resend">
                      Didn&rsquo;t get it? Check spam, or{' '}
                      <button
                        type="button"
                        disabled={cooldown > 0 || busy || wait !== null}
                        onClick={() => void resend()}
                      >
                        {cooldown > 0 ? (
                          <>
                            resend in <b>{cooldown}</b>s
                          </>
                        ) : (
                          'resend now'
                        )}
                      </button>
                    </p>
                    <button
                      type="button"
                      className="go"
                      aria-disabled={code.length < 6 ? true : undefined}
                      onClick={() => {
                        if (code.length < 6) {
                          setError('Enter all six digits.');
                          return;
                        }
                        setStage({ k: 'choose', sentTo: stage.sentTo, code });
                      }}
                    >
                      Verify code
                    </button>
                    <p className="links">
                      <a href={SIGN_IN}>Back to sign in</a>
                    </p>
                  </div>
                ) : null}

                {stage.k === 'choose' ? (
                  <form
                    className="stepbox"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      void commit();
                    }}
                  >
                    {notices}
                    <label className="f-lbl" htmlFor="reset-password">
                      New password <i>*</i>
                    </label>
                    <div className="field-wrap">
                      <input
                        id="reset-password"
                        name="password"
                        type={show ? 'text' : 'password'}
                        className={`field pw${fieldError ? ' bad' : ''}${shaking === 'password' ? ' shake' : ''}`}
                        autoComplete="new-password"
                        autoFocus
                        value={password}
                        aria-invalid={fieldError ? true : undefined}
                        aria-describedby="reset-password-hint"
                        onFocus={() => setPasswordTouched(true)}
                        onChange={(e) => {
                          setPassword(e.currentTarget.value);
                          setFieldError(undefined);
                        }}
                      />
                      <button
                        type="button"
                        className="eyebtn"
                        aria-label={show ? 'Hide password' : 'Show password'}
                        aria-pressed={show}
                        onClick={() => setShow((s) => !s)}
                      >
                        <EyeIcon open={show} />
                      </button>
                    </div>
                    <div className="meter" aria-hidden="true">
                      {[1, 2, 3, 4].map((n) => (
                        <span key={n} data-on={strength.score >= n} />
                      ))}
                    </div>
                    {fieldError ? (
                      <p className="err" role="alert">
                        {fieldError}
                      </p>
                    ) : null}
                    {passwordTouched ? (
                      <ul className="rules" id="reset-password-hint">
                        {rules.map((rule) => (
                          <li key={rule.id} data-met={rule.met}>
                            {rule.label}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={`hint${passwordOk ? ' ok' : ''}`} id="reset-password-hint">
                        12+ characters, one lowercase, one capital, one number, one symbol. Different
                        from the last five you have used here.
                      </p>
                    )}

                    <label className="f-lbl gap" htmlFor="reset-confirm">
                      Confirm password <i>*</i>
                    </label>
                    <input
                      id="reset-confirm"
                      type={show ? 'text' : 'password'}
                      className={`field${confirmError ? ' bad' : ''}${shaking === 'confirm' ? ' shake' : ''}`}
                      autoComplete="new-password"
                      value={confirm}
                      aria-invalid={confirmError ? true : undefined}
                      aria-describedby="reset-confirm-hint"
                      onChange={(e) => {
                        setConfirm(e.currentTarget.value);
                        setConfirmError(undefined);
                      }}
                    />
                    <p
                      className={`hint${match ? ' ok' : ''}`}
                      id="reset-confirm-hint"
                      aria-live="polite"
                    >
                      {confirmError
                        ? confirmError
                        : confirm.length === 0
                          ? ''
                          : match
                            ? 'Passwords match.'
                            : 'These don’t match yet.'}
                    </p>

                    <button
                      type="submit"
                      className="go"
                      disabled={busy}
                      aria-busy={busy || undefined}
                    >
                      Set this password
                    </button>
                    <p className="links">
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setFieldError(undefined);
                          setCode('');
                          setStage({ k: 'code', sentTo: stage.sentTo });
                        }}
                      >
                        Use a different code
                      </button>
                      <span className="plain"> · </span>
                      <a href={SIGN_IN}>Back to sign in</a>
                    </p>
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
