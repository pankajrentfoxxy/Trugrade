'use client';

import * as React from 'react';
import { Button, Input, MfaChallenge, RateLimitNotice, StatusPill } from '@trugrade/ui';
import {
  getOnboarding,
  login,
  requestMfaCode,
  sendLoginCode,
  verifyLoginCode,
  verifyMfa,
  type ApiFailure,
  type ResumableOnboarding,
  type SessionView,
} from '../register/api';
import { AuthShell } from '../AuthShell';
import { ApplicationStatus, type StatusCopy } from '../register/review-parts';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 *
 * Signing in, for the customer side. A code first and a password second, which
 * is the way round the backlog asks for and the right way round for a buyer:
 * the mailbox they registered with is the credential they still have, and a
 * password they set once eight months ago is the one they do not.
 *
 * Three things this screen exists to get right.
 *
 * **1. It answers nothing.** A wrong password, an address with no account, an
 * address belonging to a supplier owner who may not use codes — every one of
 * them gets the identical words, the identical shape and the identical wait.
 * That is not politeness. Vendor anonymity is the property this business is
 * built on (`docs/_CONTEXT.md`), and a sign-in form that confirms "this dealer
 * has an account" is a supplier directory with a text box. The server closed
 * that hole deliberately (`IdentityService.loginWithPassword`, VR-060, and the
 * `deliver: false` path on the code routes); this file's whole contribution is
 * not to reopen it by branching on an error code.
 *
 * **2. A wait is said out loud.** When the rate limiter refuses, the server's
 * own sentence is rendered word for word and the exact remaining time counts
 * down beside it, off `Retry-After`. The dishonest versions of this screen are
 * the spinner that hides the refusal and the "please try again later" that hides
 * the number — both leave somebody guessing at a door that will not open for
 * eleven more minutes.
 *
 * **3. Signing in is not the end of it.** An applicant whose organisation is
 * still with a reviewer, or was refused, or was suspended, has a real question
 * that "welcome back" does not answer. Each of those states says what it is and
 * what happens next, and a refusal shows the reviewer's own sentence verbatim —
 * `ApplicationStatus`, the same component the registration flow ends on, so the
 * two cannot drift into describing one application differently.
 */

/* ==========================================================================
 * Where each kind of account lands
 * ======================================================================== */

/**
 * A vendor and a platform user both belong in the console; a buyer belongs on
 * the storefront. Sending a vendor to the shop is the small wrongness that makes
 * someone think they signed in as the wrong person.
 */
const CONSOLE_URL = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:5173/';

const destinationFor = (orgType: string): string => (orgType === 'BUYER' ? '/' : CONSOLE_URL);

/** Where an unfinished application is picked up again. */
const applicationFor = (orgType: string): string =>
  orgType === 'VENDOR' ? '/sell/register' : '/register';

/**
 * The statuses that mean "your application is not finished", as opposed to "it
 * is with us" (`WITH_US`) or decided. Read off the `org_status` enum rather than
 * guessed: LEAD, REGISTERED and PROFILE_SUBMITTED are all before submission.
 */
const UNFINISHED = ['LEAD', 'REGISTERED', 'PROFILE_SUBMITTED'];

const OUTCOME: Record<string, StatusCopy> = {
  KYC_SUBMITTED: {
    title: 'You are signed in. Your application is still with our team.',
    body: 'Nothing more is needed from you right now. You can buy the moment it is approved, and we will email the contacts you gave us as soon as there is a decision.',
    tone: 'info',
  },
  UNDER_REVIEW: {
    title: 'You are signed in. A reviewer is looking at your application.',
    body: 'Someone has picked it up. If they need anything else it will appear here and in your inbox.',
    tone: 'info',
  },
  INFO_REQUESTED: {
    title: 'You are signed in, and we need something from you.',
    body: 'The reviewer has asked for a change. Their words are below — open the step it refers to and send it again.',
    tone: 'fail',
  },
  VERIFIED: {
    title: 'Your account is open',
    body: 'You can buy on this account now. Prices, stock and delivery dates are live.',
    tone: 'pass',
  },
  REJECTED: {
    title: 'This account was not approved',
    body: 'The reviewer’s reason is below, exactly as they wrote it. If you think it is wrong, reply to the email we sent and a person will look again.',
    tone: 'fail',
  },
};

/* ==========================================================================
 * State
 * ======================================================================== */

type Stage =
  /** OTP-first: the address, and nothing else. */
  | { k: 'code' }
  /** A code has been asked for. It may or may not have been sent — see the note. */
  | { k: 'code-sent'; sentTo: string }
  /** The secondary path, for anyone who has a password and prefers it. */
  | { k: 'password' }
  /** The session exists and still owes a second factor. */
  | { k: 'mfa'; sentTo: string }
  /** Signed in, and the organisation is not simply open for business. */
  | { k: 'outcome'; orgType: string; data: ResumableOnboarding }
  /** The server refused the sign-in outright, in its own words. */
  | { k: 'refused'; message: string };

interface Wait {
  message: string;
  seconds: number | null;
}

/** True for the one refusal that is about the organisation, not the credentials. */
const isSuspension = (failure: ApiFailure): boolean => failure.status === 403;

/**
 * The frame, with the title fixed. It lives inside this component rather than in
 * `page.tsx` because only this component knows which stage it is on, and the
 * outcome stages need the wide column.
 */
function Shell({
  wide,
  children,
}: {
  wide?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <AuthShell
      title="Sign in"
      lede="Buyers land on the shop. Suppliers and staff land in the console."
      {...(wide ? { wide: true } : {})}
    >
      {children}
    </AuthShell>
  );
}

export function SignIn(): React.JSX.Element {
  const [stage, setStage] = React.useState<Stage>({ k: 'code' });
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [wait, setWait] = React.useState<Wait | null>(null);
  const [busy, setBusy] = React.useState(false);

  /**
   * Every refusal lands here, so there is exactly one place that decides what a
   * failure looks like — and therefore exactly one place that could accidentally
   * make two failures look different from each other.
   */
  const refuse = (failure: ApiFailure): void => {
    setBusy(false);
    if (failure.code === 'RATE_LIMITED') {
      setError(null);
      setWait({ message: failure.message, seconds: failure.retryAfterSeconds });
      return;
    }
    setWait(null);
    if (isSuspension(failure)) {
      setStage({ k: 'refused', message: failure.message });
      return;
    }
    setError(failure.message);
  };

  /**
   * What happens after the server says yes.
   *
   * The organisation's status decides where they go, and it is asked for rather
   * than assumed: an approved buyer goes to the shop, an unfinished application
   * goes back to its own flow, and anything in between gets a screen that says
   * where it stands. `GET /onboarding/steps` is only open to the owner and admin
   * roles, so a refusal there is not an error — it means this person is not the
   * one who fills the application in, and the destination is right for them.
   */
  const afterSignIn = async (session: SessionView): Promise<void> => {
    if (session.mfaRequired) {
      const sent = await requestMfaCode();
      if (!sent.ok) {
        refuse(sent);
        return;
      }
      setBusy(false);
      setStage({ k: 'mfa', sentTo: sent.data.sentTo });
      return;
    }

    if (session.orgType === 'INTERNAL') {
      window.location.assign(CONSOLE_URL);
      return;
    }

    const onboarding = await getOnboarding();
    if (!onboarding.ok) {
      window.location.assign(destinationFor(session.orgType));
      return;
    }

    const status = onboarding.data.status;
    if (status === 'VERIFIED') {
      window.location.assign(destinationFor(session.orgType));
      return;
    }
    if (UNFINISHED.includes(status)) {
      window.location.assign(applicationFor(session.orgType));
      return;
    }

    setBusy(false);
    setStage({ k: 'outcome', orgType: session.orgType, data: onboarding.data });
  };

  /* ---------------------------------------------------------------- actions */

  const requestCode = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const sent = await sendLoginCode(email);
    if (!sent.ok) {
      refuse(sent);
      return;
    }
    setBusy(false);
    setStage({ k: 'code-sent', sentTo: sent.data.sentTo });
  };

  const signInWithPassword = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await login(email, password);
    if (!result.ok) {
      refuse(result);
      return;
    }
    await afterSignIn(result.data);
  };

  /* ----------------------------------------------------------------- render */

  const notices = (
    <>
      {wait && (
        <RateLimitNotice
          message={wait.message}
          retryAfterSeconds={wait.seconds}
          onExpire={() => setWait(null)}
        />
      )}
      {error && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-ink">
          {error}
        </p>
      )}
    </>
  );

  if (stage.k === 'refused') {
    // Narrow, unlike the application outcome below: this is four sentences, and
    // a 760px column with nothing in it reads as a page that failed to load.
    return (
      <Shell>
        <div className="flex flex-col gap-4" data-testid="signin-suspended">
          <StatusPill className="self-start" tone="fail" label="Account closed to sign-in" />
          <h2 className="text-h3 text-ink">We cannot sign you in to this account</h2>
          {/* The server's sentence, verbatim. It is the only one that knows whether
            this is the organisation, the individual account, or something a
            support agent has already been in touch about. */}
          <p className="max-w-[62ch] text-body text-ink">{stage.message}</p>
          <p className="max-w-[62ch] text-body-sm text-ink-3">
            Nothing on the account has been changed by this attempt. If you believe this is wrong,
            reply to the email we sent or contact support — quoting the address you signed in with
            is enough for us to find it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={() => setStage({ k: 'code' })}>
              Try a different account
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  if (stage.k === 'outcome') {
    const steps = stage.data.progress.steps;
    return (
      <Shell wide>
        <div className="flex flex-col gap-6" data-testid="signin-outcome">
          <ApplicationStatus
            orgStatus={stage.data.status}
            slaDueAt={stage.data.slaDueAt}
            slaBreached={stage.data.slaBreached}
            needsFix={steps.filter((s) => s.status === 'NEEDS_FIX')}
            onEdit={() => window.location.assign(applicationFor(stage.orgType))}
            copy={OUTCOME}
            steps={steps}
            decision={stage.data.decision}
          />
          {stage.data.status !== 'REJECTED' && (
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => window.location.assign(applicationFor(stage.orgType))}
              >
                Open your application
              </Button>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  if (stage.k === 'mfa') {
    return (
      <Shell>
        <MfaChallenge
          className="border-0 bg-transparent p-0"
          sentTo={stage.sentTo}
          pillLabel="Second factor"
          heading="One more code before you are in"
          reason="This account can change where money is sent, so it needs a second factor every time — not only today."
          onVerify={async (code) => {
            const result = await verifyMfa(code);
            if (!result.ok) return result.message || result.fields.code;
            await afterSignIn(result.data);
            return undefined;
          }}
          onResend={async () => {
            const sent = await requestMfaCode();
            return sent.ok ? { sentTo: sent.data.sentTo } : { error: sent.message };
          }}
        />
      </Shell>
    );
  }

  if (stage.k === 'code-sent') {
    return (
      <Shell>
        <div className="flex flex-col gap-4">
          {notices}
          <MfaChallenge
            sentTo={stage.sentTo}
            pillLabel="Sign-in code"
            heading="Enter the code we emailed you"
            reason="No password needed."
            /*
            The honest version of "we always say we sent it". Some accounts are
            deliberately not sent a code — a supplier owner signs in with a
            password because their second factor is a code to this same mailbox,
            and one code cannot be both. Saying which accounts those are, without
            saying whether THIS one is, is the most that can be said without
            turning the form into a lookup.
          */
            factorNote="The code goes to the address on the account. Supplier and staff accounts are not sent one — they sign in with a password below."
            onVerify={async (code) => {
              const result = await verifyLoginCode(email, code);
              if (!result.ok) {
                if (result.code === 'RATE_LIMITED') {
                  refuse(result);
                  return undefined;
                }
                return result.message || result.fields.code;
              }
              await afterSignIn(result.data);
              return undefined;
            }}
            onResend={async () => {
              const sent = await sendLoginCode(email);
              return sent.ok ? { sentTo: sent.data.sentTo } : { error: sent.message };
            }}
          />
          <div className="flex flex-col gap-3 border-t border-rule-2 pt-4">
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => {
                setError(null);
                setWait(null);
                setStage({ k: 'password' });
              }}
            >
              Use a password instead
            </Button>
            <Button
              type="button"
              variant="link"
              className="self-start px-0"
              onClick={() => {
                setError(null);
                setStage({ k: 'code' });
              }}
            >
              Use a different address
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  const codeStage = stage.k === 'code';

  return (
    <Shell>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void (codeStage ? requestCode() : signInWithPassword());
        }}
      >
        {notices}

        <Input
          label="Work email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          hint={
            codeStage
              ? 'We email a six-digit code. It is good for five minutes.'
              : 'The address your account was opened with.'
          }
        />

        {!codeStage && (
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
        )}

        {/* The one amber control on the screen. */}
        <Button
          type="submit"
          variant="primary"
          block
          loading={busy}
          {...(wait
            ? { disabledReason: 'Too many attempts. The wait above has to run out first.' }
            : {})}
        >
          {codeStage ? 'Email me a sign-in code' : 'Sign in'}
        </Button>

        <div className="flex flex-col gap-2 border-t border-rule-2 pt-4">
          <Button
            type="button"
            variant="link"
            className="self-start px-0"
            onClick={() => {
              setError(null);
              // The wait goes with the mode, and that is not a loophole: the two
              // paths spend different budgets. A password refusal is `login-id`
              // and `login-ip`; a code request is `auth-account-otp-ip` and the
              // OTP service's own per-target windows. Holding a password lockout
              // over the code form would be inventing a wait the server has not
              // imposed — the mirror image of hiding one.
              setWait(null);
              setStage(codeStage ? { k: 'password' } : { k: 'code' });
            }}
          >
            {codeStage ? 'Use a password instead' : 'Email me a code instead'}
          </Button>
          <a
            className="self-start text-body-sm text-acc-ink underline underline-offset-4"
            href="/forgot-password"
          >
            Forgotten your password?
          </a>
          {/* Navigation, not an action: `--ink-2` with a rule underline that turns
            amber on hover, the same treatment the legal footer uses. Amber text
            is for a primary action, a measured value or an active state, and a
            stack of four amber links is none of those three. */}
          <p className="text-body-sm text-ink-3">
            No account yet?{' '}
            <a
              className="text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-acc"
              href="/register"
            >
              Create one
            </a>{' '}
            — or{' '}
            <a
              className="text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-acc"
              href="/sell/register"
            >
              apply to supply
            </a>
            .
          </p>
        </div>
      </form>
    </Shell>
  );
}
