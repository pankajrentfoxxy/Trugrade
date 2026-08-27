import * as React from 'react';
import { useNavigate } from 'react-router';
import { BRAND } from '@trugrade/config/brand';
import {
  Button,
  Input,
  Logo,
  MfaChallenge,
  RateLimitNotice,
  StatusPill,
  TickRule,
} from '@trugrade/ui';
import { isFailure, useAuth, type AuthFailure, type Principal } from '../lib/auth';

/**
 * ARCHETYPE F — Focus. One task, centred, no navigation.
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
 * **No code option here, unlike the customer door.** `POST /auth/login/otp`
 * refuses to send a sign-in code to an account whose role needs a second factor,
 * because that second factor is a code to the same mailbox — one code cannot be
 * both, and asking twice is one factor pretending to be two.
 *
 * **A wrong password and an address we have never seen are the same event.** The
 * server makes them identical on purpose and this screen renders whatever it
 * says without inspecting it. Vendor anonymity is the property the business
 * rests on; a login form that confirms an account exists is a supplier
 * directory.
 */

/** Where a supplier's application actually lives. The console does not host it. */
const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:3000';

/** `org_status` values in which the application is with us rather than with them. */
const WITH_US = ['KYC_SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED'];

interface ApplicationState {
  status: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  decision: { decision: string; notes: string | null; decidedAt: string } | null;
}

type Stage =
  | { k: 'password' }
  | { k: 'mfa'; sentTo: string }
  /** Signed in, but the organisation is not open for business. */
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

export function LoginRoute(): React.JSX.Element {
  const { signIn, requestMfaCode, verifyMfa, principal } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = React.useState<Stage>({ k: 'password' });
  const [error, setError] = React.useState<string | null>(null);
  const [wait, setWait] = React.useState<AuthFailure | null>(null);
  const [busy, setBusy] = React.useState(false);

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
    // 403 is the organisation, not the credentials: suspended, blacklisted,
    // deactivated, or an account somebody has turned off. The server's sentence
    // says which, and it is shown as written.
    if (failure.status === 403) {
      setStage({ k: 'refused', message: failure.message });
      return;
    }
    setError(failure.message);
  };

  /**
   * Signing in is not the same as being able to work.
   *
   * A supplier whose KYC is still with a reviewer holds a perfectly valid
   * session and a console full of screens that will refuse them. Asking for the
   * application state costs one call and turns that into a sentence.
   * `GET /onboarding/steps` is open only to the owner and admin roles, so a
   * refusal means this person does not own the application — which is itself the
   * answer, and the console is the right place for them.
   */
  const afterSignIn = async (session: Principal): Promise<void> => {
    if (session.orgType === 'PLATFORM') {
      void navigate('/', { replace: true });
      return;
    }

    const res = await fetch('/api/onboarding/steps', { credentials: 'include' });
    if (!res.ok) {
      void navigate('/', { replace: true });
      return;
    }
    const state = (await res.json()) as ApplicationState;
    if (state.status === 'VERIFIED') {
      void navigate('/', { replace: true });
      return;
    }
    setBusy(false);
    setStage({ k: 'application', state });
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const result = await signIn(String(form.get('email')), String(form.get('password')));
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
  }

  const notices = (
    <>
      {wait && (
        <RateLimitNotice
          message={wait.message}
          retryAfterSeconds={wait.retryAfterSeconds}
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-5 py-11">
      <div className="tg-card w-full max-w-xl rounded-lg border border-rule bg-sheet">
        <Logo />

        {stage.k === 'refused' ? (
          <div className="flex flex-col gap-4" data-testid="login-suspended">
            <h1 className="mt-6 text-h1 text-ink">We cannot sign you in</h1>
            <TickRule />
            <StatusPill className="self-start" tone="fail" label="Account closed to sign-in" />
            {/* Verbatim. Only the server knows whether this is the organisation
                or the individual account, and paraphrasing loses the sentence
                that says who to contact. */}
            <p className="text-body text-ink">{stage.message}</p>
            <p className="text-body-sm text-ink-3">
              Nothing on the account was changed by this attempt.
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setStage({ k: 'password' });
                }}
              >
                Try a different account
              </Button>
            </div>
          </div>
        ) : stage.k === 'application' ? (
          <ApplicationPanel state={stage.state} />
        ) : stage.k === 'mfa' ? (
          <div className="mt-6 flex flex-col gap-5">
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
                return isFailure(sent) ? { error: sent.message } : { sentTo: sent.sentTo };
              }}
            />
          </div>
        ) : (
          <>
            <h1 className="mt-6 text-h1 text-ink">Sign in</h1>
            <TickRule />
            <p className="mt-2 text-body-sm text-ink-2">
              {BRAND.name} staff and suppliers. Buyers sign in on the shop.
            </p>

            <form onSubmit={(e) => void onSubmit(e)} className="mt-6 flex flex-col gap-5">
              {notices}
              <Input label="Work email" name="email" type="email" required autoComplete="username" />
              <Input
                label="Password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
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
                Sign in
              </Button>
              <div className="flex flex-col gap-2 border-t border-rule-2 pt-4">
                <a
                  className="text-body-sm text-acc-ink underline underline-offset-4"
                  href={`${STOREFRONT_URL}/forgot-password`}
                >
                  Forgotten your password?
                </a>
                <p className="text-body-sm text-ink-3">
                  Applying to supply?{' '}
                  <a
                    className="text-acc-ink underline underline-offset-4"
                    href={`${STOREFRONT_URL}/sell/register`}
                  >
                    Start an application
                  </a>
                  .
                </p>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Signed in, and the organisation is not open for business yet.
 *
 * The application itself lives on the storefront — that is where every step was
 * filled in and where the review screen is — so this says where it stands and
 * hands them back to it rather than rebuilding a seven-step flow in the console.
 * A refusal prints the reviewer's own sentence, which `KycService.decide`
 * refuses to record without precisely because the applicant reads it.
 */
function ApplicationPanel({ state }: { state: ApplicationState }): React.JSX.Element {
  const rejected = state.status === 'REJECTED';
  const pending = WITH_US.includes(state.status);

  return (
    <div className="flex flex-col gap-4" data-testid="login-application">
      <h1 className="mt-6 text-h1 text-ink">
        {rejected
          ? 'This account was not approved'
          : pending
            ? 'You are signed in. Your application is still with our team.'
            : 'Your application is not finished'}
      </h1>
      <TickRule />
      <StatusPill
        className="self-start"
        tone={rejected ? 'fail' : pending ? 'info' : 'warn'}
        label={state.status.replace(/_/g, ' ')}
      />

      <p className="text-body text-ink-2">
        {rejected
          ? 'The reviewer’s reason is below, exactly as they wrote it. If you believe it is wrong, reply to the email we sent and a person will look again.'
          : pending
            ? 'Nothing more is needed from you right now. Listing, pricing and payouts open the moment it is approved.'
            : 'There are steps still to fill in. Nothing you have already typed has been lost.'}
      </p>

      {state.decision && state.decision.decision !== 'APPROVE' && (
        <div role="alert" className="flex flex-col gap-3 rounded border border-fail bg-sheet-2 p-4">
          <span className="font-mono text-label uppercase tracking-[0.13em] text-fail">
            What the reviewer said
          </span>
          <blockquote className="text-body text-ink">
            {state.decision.notes ?? (
              <span className="text-ink-4">
                No reason was recorded. That is our mistake — contact support quoting the date
                below.
              </span>
            )}
          </blockquote>
          <dl className="flex items-baseline gap-3 border-t border-rule-2 pt-3">
            <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">Decided</dt>
            <dd className="font-mono text-data tnum text-ink">
              {formatWhen(state.decision.decidedAt)}
            </dd>
          </dl>
        </div>
      )}

      {pending && (
        <dl className="flex flex-col gap-3 border-t border-rule-2 pt-4 sm:flex-row sm:gap-8">
          <div className="flex flex-col gap-1">
            <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Decision due by
            </dt>
            <dd className="font-mono text-data tnum text-ink">
              {state.slaDueAt ? (
                formatWhen(state.slaDueAt)
              ) : (
                // A promise we did not record is not a promise we can show.
                <span className="text-ink-4">Not recorded</span>
              )}
            </dd>
          </div>
          {state.slaBreached && (
            <p role="status" className="text-body-sm text-fail">
              We are past the time we promised you a decision. That is on us.
            </p>
          )}
        </dl>
      )}

      {!rejected && (
        <div>
          <Button
            type="button"
            variant="primary"
            onClick={() => window.location.assign(`${STOREFRONT_URL}/sell/register`)}
          >
            Open your application
          </Button>
        </div>
      )}
    </div>
  );
}
