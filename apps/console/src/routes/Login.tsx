import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { BRAND } from '@trugrade/config/brand';
import { OTP_POLICY, normaliseMobile } from '@trugrade/contracts';
import { MfaChallenge, OtpInput, RateLimitNotice, StatusPill, Tabs } from '@trugrade/ui';
import { VendorSurfaceSync } from '../lib/vendor-surface';
import { isFailure, useAuth, type AuthFailure, type Principal } from '../lib/auth';
import './auth/auth-split.css';

/**
 * ARCHETYPE F — Focus. One task, centred, no navigation.
 *
 * The approved split-screen mock: a dark brand panel on the left where four
 * figures hold placards with one supplier promise each, and the working form
 * on the right. The crew is CSS in `auth/auth-split.css` and is hidden from
 * assistive technology — the promises it carries are decoration here, and are
 * stated in full on the landing page.
 *
 * Deliberately outside the shell: chrome offering sections you cannot reach yet
 * is noise, and the section rail is meaningless before there is a principal to
 * filter it by.
 *
 * **Password first, and a second factor after it.** This is the supplier and
 * staff door, and every role behind it that can move money — VENDOR_OWNER,
 * PLATFORM_SUPERADMIN, OPS_MANAGER, FINANCE, DPO — is in `MFA_REQUIRED_ROLES`.
 * Their session is issued with `mfa: false` and refused by every guard until the
 * factor lands, so the challenge is part of signing in rather than a screen
 * somewhere else. The backlog asks for TOTP on owner accounts; there is no TOTP
 * enrolment anywhere in the platform yet, so what actually happens is a code to
 * the address on the account, and `MfaChallenge` says exactly that rather than
 * borrowing the word "authenticator".
 *
 * **A mobile code is the other way in.** `POST /auth/login/mobile/otp` sends a
 * WhatsApp code to the account's mobile. The second factor still follows it for
 * an owner account, and goes to the email — two channels, not one asked twice.
 *
 * **A wrong password and an address we have never seen are the same event.** The
 * server makes them identical on purpose and this screen renders whatever it
 * says without inspecting it. Vendor anonymity is the property the business
 * rests on; a login form that confirms an account exists is a supplier
 * directory.
 */

/** Supplier registration lives on this console, not the storefront. */
const sellRegisterPath = '/sell/register';

const SIGN_IN_LEDE = `${BRAND.name} staff and suppliers. Buyers sign in on the shop.`;

/** What the crew holds up. The bold run is the mock's own emphasis. */
const PLACARDS = [
  { hair: '', lead: 'We ', bold: 'inspect, grade and seal', rest: ' every machine before it goes live' },
  { hair: 'bun', lead: 'Your name is ', bold: 'never shown', rest: ' to buyers' },
  { hair: 'cap', lead: 'Payment on a ', bold: 'fixed cycle', rest: ', every deduction itemised' },
  { hair: 'curl', lead: '', bold: 'No listing fee,', rest: ' no monthly fee' },
] as const;

/** A work email, or a ten-digit Indian mobile. The same test the mock runs. */
const validIdentifier = (v: string): boolean =>
  /^[6-9]\d{9}$/.test(v) || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

interface ApplicationState {
  status: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  decision: { decision: string; notes: string | null; decidedAt: string } | null;
}

type Stage =
  | { k: 'password' }
  | { k: 'mfa'; sentTo: string }
  /**
   * Signed in, but rejected. The one `org_status` genuinely not told anywhere
   * on `/vendor` — Home's gate names open sections, never a reviewer's
   * verdict — so this is the only status that still stops here rather than
   * going straight through.
   */
  | { k: 'application'; state: ApplicationState }
  /** The server refused outright — suspended, deactivated, not active. */
  | { k: 'refused'; message: string };

const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/* ==========================================================================
 * The brand panel
 * ======================================================================== */

function Crew(): React.JSX.Element {
  return (
    <div className="crew" aria-hidden="true">
      {PLACARDS.map((p, i) => (
        <figure className={`pal p${i + 1}`} key={p.bold}>
          <div className="sign">
            <p>
              {p.lead}
              <b>{p.bold}</b>
              {p.rest}
            </p>
          </div>
          <div className="stick" />
          <div className="human">
            <div className={`hair ${p.hair}`.trim()} />
            <div className="face">
              <i className="eye l" />
              <i className="eye r" />
              <i className="smile" />
            </div>
            <div className="torso" />
            <div className="arm al" />
            <div className="arm ar" />
            <div className="leg ll" />
            <div className="leg lr" />
          </div>
        </figure>
      ))}
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
      <Crew />
      <div className="floor" />
    </aside>
  );
}

/* ==========================================================================
 * The route
 * ======================================================================== */

export function LoginRoute(): React.JSX.Element {
  const {
    signIn,
    signInWithMobileCode,
    requestMobileCode,
    requestMfaCode,
    verifyMfa,
    signOut,
    principal,
  } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = React.useState<Stage>({ k: 'password' });
  const [error, setError] = React.useState<string | null>(null);
  const [wait, setWait] = React.useState<AuthFailure | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [method, setMethod] = React.useState<'password' | 'mobile'>('password');

  /**
   * A restored session that still owes a factor lands here from `RequirePermission`.
   * Asking for the code is the only useful thing this screen can do with it —
   * otherwise the person bounces between an empty console and an empty form.
   */
  const outstanding = principal?.mfaRequired ?? false;
  React.useEffect(() => {
    if (!outstanding || stage.k !== 'password') return;
    void (async () => {
      const sent = await requestMfaCode();
      if (isFailure(sent)) {
        setError(sent.message);
        return;
      }
      setStage({ k: 'mfa', sentTo: sent.sentTo });
    })();
  }, [outstanding, stage.k, requestMfaCode]);

  React.useEffect(() => {
    if (principal && !principal.mfaRequired && stage.k === 'password') {
      void navigate('/', { replace: true });
    }
  }, [principal, stage.k, navigate]);

  const refuse = (failure: AuthFailure): void => {
    setBusy(false);
    if (failure.code === 'RATE_LIMITED') {
      setError(null);
      setWait(failure);
      return;
    }
    setWait(null);
    if (failure.status === 403) {
      setStage({ k: 'refused', message: failure.message });
      return;
    }
    setError(failure.message);
  };

  /**
   * Leave a half-finished sign-in. The session that still owes a factor is ended
   * on the server, not just forgotten here — otherwise the next visit restores it
   * and lands straight back on this challenge.
   */
  const startOver = async (message: string | null = null): Promise<void> => {
    await signOut();
    setBusy(false);
    setWait(null);
    setError(message);
    setStage({ k: 'password' });
  };

  /** The access cookie outlived the challenge; the code cannot land on it now. */
  const SESSION_LAPSED =
    'Your sign-in timed out before the code was entered. Sign in again and we will send a new one.';

  const afterSignIn = async (session: Principal): Promise<void> => {
    if (session.orgType === 'PLATFORM') {
      void navigate('/', { replace: true });
      return;
    }

    // Deliberately NOT `apiFetch`. This runs on a cookie set seconds ago, and
    // `apiFetch` signs out on a second 401 — which on this screen would be
    // sign in, 401, sign out, back to this screen. A refusal here just routes
    // the supplier home, which is the right answer whatever the reason.
    const res = await fetch('/api/onboarding/steps', { credentials: 'include' });
    if (!res.ok) {
      void navigate('/', { replace: true });
      return;
    }
    const state = (await res.json()) as ApplicationState;
    if (state.status !== 'REJECTED') {
      // Every status but REJECTED is told in full on /vendor itself — Home's
      // gate names the sections still open, and the shell's banner tracks the
      // same percentage — so stopping here to say it a second, narrower way
      // is redundant at best.
      void navigate('/', { replace: true });
      return;
    }
    setBusy(false);
    setStage({ k: 'application', state });
  };

  /** Both doors land here once the first factor is in hand. */
  const afterFirstFactor = async (result: Principal | AuthFailure): Promise<void> => {
    if (isFailure(result)) {
      refuse(result);
      return;
    }
    if (result.mfaRequired) {
      const sent = await requestMfaCode();
      if (isFailure(sent)) {
        refuse(sent);
        return;
      }
      setBusy(false);
      setStage({ k: 'mfa', sentTo: sent.sentTo });
      return;
    }
    await afterSignIn(result);
  };

  const notices = (
    <div className="notices">
      {wait && (
        <RateLimitNotice
          message={wait.message}
          retryAfterSeconds={wait.retryAfterSeconds}
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

  return (
    <div className="auth-split login-split">
      <VendorSurfaceSync />
      <div className="split">
        <BrandPanel />
        <main className="right">
          <div className="panel">
            {stage.k === 'refused' ? (
              <div className="stage" data-testid="login-suspended">
                <h2>We cannot sign you in</h2>
                <StatusPill className="self-start" tone="fail" label="Account closed to sign-in" />
                <p>{stage.message}</p>
                <p>Nothing on the account was changed by this attempt.</p>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setError(null);
                    setStage({ k: 'password' });
                  }}
                >
                  Try a different account
                </button>
              </div>
            ) : stage.k === 'application' ? (
              <ApplicationPanel state={stage.state} />
            ) : stage.k === 'mfa' ? (
              <div className="stage">
                {notices}
                <MfaChallenge
                  sentTo={stage.sentTo}
                  pillLabel="Second factor"
                  heading="One more code before you are in"
                  reason="This account can change where money is sent, so it needs a second factor every time — not only today."
                  className="border-0 bg-transparent p-0"
                  onVerify={async (code) => {
                    const result = await verifyMfa(code);
                    if (isFailure(result)) {
                      if (result.status === 401) {
                        await startOver(SESSION_LAPSED);
                        return undefined;
                      }
                      if (result.code === 'RATE_LIMITED') {
                        refuse(result);
                        return undefined;
                      }
                      return result.message;
                    }
                    await afterSignIn(result);
                    return undefined;
                  }}
                  onResend={async () => {
                    const sent = await requestMfaCode();
                    if (isFailure(sent) && sent.status === 401) {
                      await startOver(SESSION_LAPSED);
                      return { error: SESSION_LAPSED };
                    }
                    return isFailure(sent) ? { error: sent.message } : { sentTo: sent.sentTo };
                  }}
                />
                <button type="button" className="ghost" onClick={() => void startOver()}>
                  Use a different account
                </button>
              </div>
            ) : (
              <>
                <h2>Sign in</h2>
                <p className="sub">{SIGN_IN_LEDE}</p>
                <Tabs
                  label="How to sign in"
                  value={method}
                  onChange={(key) => {
                    setMethod(key === 'mobile' ? 'mobile' : 'password');
                    setError(null);
                  }}
                  items={[
                    {
                      key: 'password',
                      label: 'Email & password',
                      panel: (
                        <PasswordForm
                          notices={method === 'password' ? notices : null}
                          busy={busy}
                          blocked={wait !== null}
                          onSubmit={async (identifier, password) => {
                            setError(null);
                            setBusy(true);
                            await afterFirstFactor(await signIn(identifier, password));
                          }}
                        />
                      ),
                    },
                    {
                      key: 'mobile',
                      label: 'Mobile & OTP',
                      panel: (
                        <MobileCodeForm
                          notices={method === 'mobile' ? notices : null}
                          blocked={wait !== null}
                          requestCode={requestMobileCode}
                          onFailure={refuse}
                          onCode={async (mobile, code) => {
                            setError(null);
                            setBusy(true);
                            const result = await signInWithMobileCode(mobile, code);
                            if (isFailure(result) && result.status === 422) {
                              setBusy(false);
                              return result.message;
                            }
                            await afterFirstFactor(result);
                            return undefined;
                          }}
                        />
                      ),
                    },
                  ]}
                />
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ==========================================================================
 * Email & password
 * ======================================================================== */

function PasswordForm({
  notices,
  busy,
  blocked,
  onSubmit,
}: {
  notices: React.ReactNode;
  busy: boolean;
  blocked: boolean;
  onSubmit: (identifier: string, password: string) => Promise<void>;
}): React.JSX.Element {
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [idError, setIdError] = React.useState<string | null>(null);
  const [pwError, setPwError] = React.useState<string | null>(null);
  const [shaking, setShaking] = React.useState<'id' | 'pw' | null>(null);
  const idRef = React.useRef<HTMLInputElement>(null);
  const pwRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    idRef.current?.focus();
  }, []);

  const shake = (which: 'id' | 'pw'): void => {
    setShaking(null);
    requestAnimationFrame(() => setShaking(which));
    (which === 'id' ? idRef : pwRef).current?.focus();
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const id = identifier.trim();
        if (!validIdentifier(id)) {
          setIdError('Enter a valid work email or a 10-digit mobile number.');
          shake('id');
          return;
        }
        setIdError(null);
        if (!password) {
          setPwError('Enter your password.');
          shake('pw');
          return;
        }
        setPwError(null);
        void onSubmit(id, password);
      }}
    >
      {notices}
      <label className="f-lbl" htmlFor="login-identifier">
        Work email or mobile <i>*</i>
      </label>
      <input
        ref={idRef}
        id="login-identifier"
        name="email"
        className={`field${idError ? ' bad' : ''}${shaking === 'id' ? ' shake' : ''}`}
        placeholder="you@company.in or 9876543210"
        autoComplete="username"
        value={identifier}
        onChange={(e) => {
          setIdentifier(e.target.value);
          setIdError(null);
        }}
        aria-invalid={idError ? true : undefined}
        aria-describedby={idError ? 'login-identifier-err' : undefined}
      />
      {idError ? (
        <p className="err" id="login-identifier-err">
          {idError}
        </p>
      ) : null}

      <label className="f-lbl gap" htmlFor="login-password">
        Password <i>*</i>
      </label>
      <div className="field-wrap">
        <input
          ref={pwRef}
          id="login-password"
          name="password"
          type={show ? 'text' : 'password'}
          className={`field pw${pwError ? ' bad' : ''}${shaking === 'pw' ? ' shake' : ''}`}
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setPwError(null);
          }}
          aria-invalid={pwError ? true : undefined}
          aria-describedby={pwError ? 'login-password-err' : undefined}
        />
        <button
          type="button"
          className="eyebtn"
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          onClick={() => setShow((s) => !s)}
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
            {show ? <path d="M4 4l16 16" /> : null}
          </svg>
        </button>
      </div>
      {pwError ? (
        <p className="err" id="login-password-err">
          {pwError}
        </p>
      ) : null}

      <button
        type="submit"
        className="go"
        disabled={busy || blocked}
        aria-disabled={blocked || undefined}
        aria-busy={busy || undefined}
        title={blocked ? 'Too many attempts. The wait above has to run out first.' : undefined}
      >
        Sign in
      </button>

      <div className="links">
        <span>
          <Link to="/forgot-password">Forgotten your password?</Link>
        </span>
        <span>
          Applying to supply? <a href={sellRegisterPath}>Start an application</a>.
        </span>
      </div>
    </form>
  );
}

/* ==========================================================================
 * Mobile & OTP
 * ======================================================================== */

interface MobileCodeFormProps {
  notices: React.ReactNode;
  /** A rate-limit wait is running; nothing can be sent until it ends. */
  blocked: boolean;
  requestCode: (mobile: string) => Promise<{ sentTo: string; devCode?: string } | AuthFailure>;
  onFailure: (failure: AuthFailure) => void;
  /** Resolves to the code's own refusal to show under the boxes, or undefined. */
  onCode: (mobile: string, code: string) => Promise<string | undefined>;
}

/**
 * The mobile half of the sign-in. Like the password form, it never says whether
 * a number is on an account: every number gets the same "if it is" sentence.
 */
function MobileCodeForm({
  notices,
  blocked,
  requestCode,
  onFailure,
  onCode,
}: MobileCodeFormProps): React.JSX.Element {
  const [digits, setDigits] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | undefined>();
  const [shaking, setShaking] = React.useState(false);
  const [sent, setSent] = React.useState<{ sentTo: string; devCode: string | null } | null>(null);
  const [code, setCode] = React.useState('');
  const [codeError, setCodeError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const mobile = normaliseMobile(digits);

  const send = async (): Promise<void> => {
    if (!mobile) {
      setFieldError(
        digits.length === 10
          ? 'Indian mobile numbers start with 6, 7, 8 or 9. Check the first digit.'
          : `Enter the 10-digit mobile number on your account — ${digits.length} digits so far.`,
      );
      setShaking(false);
      requestAnimationFrame(() => setShaking(true));
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    const result = await requestCode(mobile);
    setBusy(false);
    if (isFailure(result)) {
      onFailure(result);
      return;
    }
    setCode('');
    setCodeError(undefined);
    setCooldown(OTP_POLICY.resendCooldownSeconds);
    setSent({ sentTo: result.sentTo, devCode: result.devCode ?? null });
  };

  const verify = (entered: string): void => {
    if (!mobile) return;
    setBusy(true);
    void onCode(mobile, entered).then((refusal) => {
      setBusy(false);
      if (refusal) {
        setCode('');
        setCodeError(refusal);
      }
    });
  };

  if (!sent) {
    return (
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {notices}
        <label className="f-lbl" htmlFor="login-mobile">
          Registered mobile number <i>*</i>
        </label>
        <input
          id="login-mobile"
          className={`field mono${fieldError ? ' bad' : ''}${shaking ? ' shake' : ''}`}
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          placeholder="9876543210"
          value={digits}
          onChange={(e) => {
            setDigits(e.target.value.replace(/\D/g, '').slice(0, 10));
            setFieldError(undefined);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby="login-mobile-hint"
        />
        {fieldError ? (
          <p className="err" id="login-mobile-err">
            {fieldError}
          </p>
        ) : null}
        <p className="proto" id="login-mobile-hint">
          The number on your supplier account. We add +91 and send a six-digit code on WhatsApp.
        </p>
        <button
          type="submit"
          className="go"
          disabled={busy || blocked}
          aria-disabled={blocked || undefined}
          aria-busy={busy || undefined}
          title={blocked ? 'Too many attempts. The wait above has to run out first.' : undefined}
        >
          Send code
        </button>
        <div className="links">
          <span>
            Applying to supply? <a href={sellRegisterPath}>Start an application</a>.
          </span>
        </div>
      </form>
    );
  }

  return (
    <div>
      {notices}
      <p className="sent-line">
        Code sent to <b>{sent.sentTo}</b>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setSent(null);
            setCode('');
            setCodeError(undefined);
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
          setCodeError(undefined);
        }}
        onComplete={verify}
        error={codeError}
        disabled={busy || blocked}
      />
      {sent.devCode ? (
        <p className="proto" data-testid="prototype-code">
          Prototype: your code is <b>{sent.devCode}</b>.
        </p>
      ) : null}
      <p className="resend">
        Didn&rsquo;t get it?{' '}
        <button
          type="button"
          disabled={cooldown > 0 || busy || blocked}
          onClick={() => void send()}
          aria-live="polite"
        >
          {cooldown > 0 ? (
            <>
              Resend in <b>{cooldown}</b>s
            </>
          ) : (
            'Resend code'
          )}
        </button>
      </p>
      <button
        type="button"
        className="go"
        disabled={busy || blocked || code.length < 6}
        aria-busy={busy || undefined}
        onClick={() => verify(code)}
      >
        Verify &amp; sign in
      </button>
      <div className="links">
        <span>
          Applying to supply? <a href={sellRegisterPath}>Start an application</a>.
        </span>
      </div>
    </div>
  );
}

/* ==========================================================================
 * A rejected application
 * ======================================================================== */

/** Reached only for REJECTED — `afterSignIn` sends every other status to /vendor. */
function ApplicationPanel({ state }: { state: ApplicationState }): React.JSX.Element {
  return (
    <div className="stage" data-testid="login-application">
      <h2>This account was not approved</h2>
      <StatusPill className="self-start" tone="fail" label={state.status.replace(/_/g, ' ')} />
      <p>The reviewer&rsquo;s reason is below, exactly as they wrote it.</p>
      <p>If you believe it is wrong, reply to the email we sent and a person will look again.</p>

      {state.decision && state.decision.decision !== 'APPROVE' && (
        <div role="alert" className="alert">
          <span className="font-mono text-label uppercase tracking-[0.13em]">
            What the reviewer said
          </span>
          <blockquote>
            {state.decision.notes ?? (
              <span className="text-ink-4">
                No reason was recorded. That is our mistake — contact support quoting the date
                below.
              </span>
            )}
          </blockquote>
          <p>
            Decided <span className="font-mono tnum">{formatWhen(state.decision.decidedAt)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
