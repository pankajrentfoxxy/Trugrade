'use client';

import * as React from 'react';
import { Button, Input, OtpInput, RateLimitNotice } from '@trugrade/ui';
import { OTP_POLICY, normaliseMobile } from '@trugrade/contracts';
import {
  sendBuyerCode,
  startOnboarding,
  verifyBuyerCode,
  type ApiFailure,
} from '../register/api';
import { mobileSubscriberDigits, validateEmail, validateMobile } from '../register/validation';
import { AuthShell } from '../AuthShell';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 *
 * The buyer's one way in, for both a first visit and every visit after it.
 *
 * A mobile number and a code creates the account and signs it in; a mobile or
 * a work email and a code signs an existing buyer in. There is no password on
 * the buyer side at all — the name and the work email are collected later, on
 * the profile page, once there is an account to hang them on.
 *
 * Three things this screen exists to get right.
 *
 * **1. It answers nothing.** A number nobody has registered, an email with no
 * account, an address belonging to a supplier — every one of them gets the
 * identical words, the identical shape and the identical wait. The server
 * decides what, if anything, to send; this screen renders a mask of what was
 * typed and never branches on why a code did not arrive.
 *
 * **2. A wait is said out loud.** When the rate limiter refuses, the server's
 * own sentence is rendered word for word and the exact remaining time counts
 * down beside it, off `Retry-After`.
 *
 * **3. Signing in lands somewhere.** A buyer sent here mid-task goes back to
 * where they were, off a `next` that is refused unless it stays on this origin.
 * Everyone else lands on the portal's home.
 */

export interface OtpSignInProps {
  /**
   * `register` asks for a mobile number only — that is the sign-up.
   * `sign-in` accepts a mobile or a work email.
   */
  mode: 'register' | 'sign-in';
  /** Server-resolved supplier console origin, so the link is right before hydration. */
  sellerRegisterUrl: string;
  /**
   * Where a signed-in buyer is sent. Defaults to replacing the location so the
   * server-rendered header re-reads the cookie and back never returns here;
   * a test hands in a spy, because jsdom cannot navigate.
   */
  onSignedIn?: (url: string) => void;
}

/* ==========================================================================
 * Where signing in lands
 * ======================================================================== */

/**
 * **Resolved against this origin and refused unless it stays here.** A sign-in
 * page that forwards to whatever a query string names is an open redirect. The
 * check is the URL parser rather than a string prefix on purpose: `//evil.example`
 * and `/\evil.example` are both absolute to a browser and both pass a naive
 * "starts with a slash" test.
 */
function safeNext(): string | null {
  if (typeof window === 'undefined') return null;
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next) return null;
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    if (url.pathname.startsWith('/sign-in') || url.pathname.startsWith('/register')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Leave without leaving this screen in history — back must not return here. */
const leave = (url: string): void => {
  window.location.replace(url);
};

/* ==========================================================================
 * State
 * ======================================================================== */

type Stage =
  /** The address, and nothing else. */
  | { k: 'identifier' }
  /** A code has been asked for. It may or may not have been sent — see the note. */
  | { k: 'code'; sentTo: string; devCode: string | null }
  /** The server refused the sign-in outright, in its own words. */
  | { k: 'refused'; message: string };

interface Wait {
  message: string;
  seconds: number | null;
}

/** True for the one refusal that is about the account, not the code. */
const isRefusal = (failure: ApiFailure): boolean => failure.status === 403;

/** What a typed identifier is, once normalised. Mobile first, as the server does. */
function classify(raw: string): { kind: 'mobile' | 'email'; value: string } {
  const mobile = normaliseMobile(raw);
  if (mobile) return { kind: 'mobile', value: mobile };
  return { kind: 'email', value: raw.trim() };
}

export function OtpSignIn({
  mode,
  sellerRegisterUrl,
  onSignedIn = leave,
}: OtpSignInProps): React.JSX.Element {
  const [stage, setStage] = React.useState<Stage>({ k: 'identifier' });
  const [mobileDigits, setMobileDigits] = React.useState('');
  const [identifier, setIdentifier] = React.useState('');
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const [wait, setWait] = React.useState<Wait | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  /** The string the code is asked for and redeemed against. Identical on both calls. */
  const target =
    mode === 'register'
      ? `+91${mobileDigits}`
      : classify(identifier).value;

  const identifierError = (): string | undefined => {
    if (mode === 'register') return validateMobile(`+91 ${mobileDigits}`);
    const typed = identifier.trim();
    if (!typed) return 'Enter your mobile number or work email.';
    if (classify(typed).kind === 'mobile') return undefined;
    return validateEmail(typed) ? 'Enter a 10-digit mobile number or a work email.' : undefined;
  };

  const refuse = (failure: ApiFailure): void => {
    if (failure.status === 429) {
      setWait({ message: failure.message, seconds: failure.retryAfterSeconds });
      return;
    }
    if (isRefusal(failure)) {
      setStage({ k: 'refused', message: failure.message });
      return;
    }
    setError(failure.fields.code ?? failure.fields.identifier ?? failure.message);
  };

  const send = async (): Promise<void> => {
    setTouched(true);
    const invalid = identifierError();
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(undefined);
    setWait(null);
    setBusy(true);
    const result = await sendBuyerCode(target);
    setBusy(false);
    if (!result.ok) {
      refuse(result);
      return;
    }
    setCode('');
    setCooldown(OTP_POLICY.resendCooldownSeconds);
    setStage({ k: 'code', sentTo: result.data.sentTo, devCode: result.data.devCode ?? null });
  };

  const verify = async (entered: string): Promise<void> => {
    setError(undefined);
    setWait(null);
    setBusy(true);
    const result = await verifyBuyerCode(target, entered);
    if (!result.ok) {
      setBusy(false);
      setCode('');
      refuse(result);
      return;
    }
    // A brand-new organisation gets its onboarding rows now, so the profile
    // page has steps to show the moment it opens. Idempotent server-side.
    if (result.data.created) await startOnboarding();
    onSignedIn(safeNext() ?? '/home');
  };

  const title = mode === 'register' ? 'Create a buyer account' : 'Sign in';
  const lede =
    mode === 'register'
      ? 'Your mobile number and a code. Your name, work email and company details come later, from your account.'
      : 'A code to your mobile number or work email. There is no password.';

  return (
    <AuthShell title={title} lede={lede}>
      {stage.k === 'refused' ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-body text-ink">
            {stage.message}
          </p>
          <Button variant="secondary" onClick={() => setStage({ k: 'identifier' })}>
            Try a different number or email
          </Button>
        </div>
      ) : stage.k === 'identifier' ? (
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {mode === 'register' ? (
            <Input
              label="Mobile number"
              required
              mono
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              placeholder="9876543210"
              hint="Ten digits. We add +91 and send a six-digit code on WhatsApp."
              value={mobileDigits}
              onChange={(e) => {
                setMobileDigits(mobileSubscriberDigits(e.target.value));
                setError(undefined);
              }}
              error={touched ? (error ?? identifierError()) : undefined}
            />
          ) : (
            <Input
              label="Mobile number or work email"
              required
              autoComplete="username"
              placeholder="9876543210 or you@company.in"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setError(undefined);
              }}
              error={touched ? (error ?? identifierError()) : undefined}
            />
          )}

          {wait ? (
            <RateLimitNotice
              message={wait.message}
              retryAfterSeconds={wait.seconds}
              onExpire={() => setWait(null)}
            />
          ) : null}

          <div>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              {...(wait ? { disabledReason: 'Wait for the timer, then ask again.' } : {})}
            >
              Send code
            </Button>
          </div>

          <p className="text-body-sm text-ink-3">
            {mode === 'register' ? (
              <>
                Already with us?{' '}
                <a className="hub-link" href="/sign-in">
                  Sign in
                </a>
                .
              </>
            ) : (
              <>
                New to Trugrade?{' '}
                <a className="hub-link" href="/register">
                  Create a buyer account
                </a>{' '}
                with your mobile number.
              </>
            )}
          </p>
          <p className="text-body-sm text-ink-3">
            Selling refurbished laptops?{' '}
            <a className="hub-link" href={sellerRegisterUrl}>
              Apply to supply
            </a>{' '}
            on the supplier console.
          </p>
        </form>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-body text-ink-2">
            If <span className="font-mono">{stage.sentTo}</span> is on a buyer account, a six-digit
            code is on its way. It is good for five minutes.
          </p>
          <OtpInput
            label="Six-digit code"
            value={code}
            onChange={setCode}
            onComplete={(entered) => void verify(entered)}
            error={error}
            disabled={busy || wait !== null}
          />
          {stage.devCode ? (
            <p className="text-body-sm text-ink-3" data-testid="prototype-code">
              Prototype: your code is{' '}
              <span className="font-mono tnum">{stage.devCode}</span>.
            </p>
          ) : null}

          {wait ? (
            <RateLimitNotice
              message={wait.message}
              retryAfterSeconds={wait.seconds}
              onExpire={() => setWait(null)}
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={cooldown > 0 || busy || wait !== null}
              onClick={() => void send()}
            >
              Resend code
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setStage({ k: 'identifier' });
                setError(undefined);
                setCode('');
              }}
            >
              {mode === 'register' ? 'Change number' : 'Change number or email'}
            </Button>
            {cooldown > 0 ? (
              <span className="text-body-sm text-ink-3" aria-live="polite">
                Another code in <span className="font-mono tnum">{cooldown}</span>{' '}
                {cooldown === 1 ? 'second' : 'seconds'}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </AuthShell>
  );
}
