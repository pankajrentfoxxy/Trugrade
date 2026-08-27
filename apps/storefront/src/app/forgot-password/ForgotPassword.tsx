'use client';

import * as React from 'react';
import { Button, Input, MfaChallenge, RateLimitNotice, StatusPill } from '@trugrade/ui';
import { resetPassword, sendPasswordResetCode, type ApiFailure } from '../register/api';
import { StrengthMeter } from '../register/StepAccount';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 *
 * Forgotten password, and the reset that follows it. Two panels rather than two
 * routes, because they are one errand and a reset code that arrives on a page
 * the person has navigated away from is a code they have to ask for twice.
 *
 * The same rule as the sign-in screen governs it: **the answer never depends on
 * whether the address has an account.** "We have sent a code" is said either
 * way, the wait is the same wait, and a code that does not work says one thing
 * whether it was wrong, expired, or issued for an address nobody has ever
 * registered. A reset form is the enumeration oracle people forget about,
 * because it feels like a helpful place to say "we don't know that address".
 *
 * What it does not hide is the wait. A rate-limit refusal shows the server's
 * sentence and counts the remaining seconds down.
 */

type Stage =
  | { k: 'ask' }
  | { k: 'code'; sentTo: string }
  | { k: 'choose'; sentTo: string; code: string }
  | { k: 'done' };

interface Wait {
  message: string;
  seconds: number | null;
}

export function ForgotPassword(): React.JSX.Element {
  const [stage, setStage] = React.useState<Stage>({ k: 'ask' });
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | undefined>();
  const [wait, setWait] = React.useState<Wait | null>(null);
  const [busy, setBusy] = React.useState(false);

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
    setBusy(true);
    setError(null);
    const sent = await sendPasswordResetCode(email);
    if (!sent.ok) {
      refuse(sent);
      return;
    }
    setBusy(false);
    setStage({ k: 'code', sentTo: sent.data.sentTo });
  };

  const commit = async (code: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    const result = await resetPassword({ email, code, password });
    if (!result.ok) {
      // The password rules are the one refusal that belongs on the field. Every
      // other one is about the code, and the code is spent by then.
      if (result.fields.password) {
        setFieldError(result.fields.password);
        setBusy(false);
        return;
      }
      refuse(result);
      return;
    }
    setBusy(false);
    setStage({ k: 'done' });
  };

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

  if (stage.k === 'done') {
    return (
      <div className="flex flex-col gap-4" data-testid="reset-done">
        <StatusPill className="self-start" tone="pass" label="Password changed" />
        <h2 className="text-h3 text-ink">Your new password is set</h2>
        <p className="max-w-[62ch]">
          Every session that was open on this account has been signed out, including any you did not
          start. Sign in again with the password you have just chosen.
        </p>
        <div>
          <Button
            type="button"
            variant="primary"
            onClick={() => window.location.assign('/sign-in')}
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  if (stage.k === 'choose') {
    return (
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void commit(stage.code);
        }}
      >
        {notices}
        <StatusPill className="self-start" tone="processing" label="Code accepted" />
        <h2 className="text-h3 text-ink">Choose a new password</h2>
        <Input
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.currentTarget.value);
            setFieldError(undefined);
          }}
          hint="It must also be different from the last five you have used on this account."
          {...(fieldError ? { error: fieldError } : {})}
        />
        {/* The registration form's meter, not a second one. It mirrors the rules
            the server actually enforces, and a meter that disagrees with the
            server reads "very strong" on a password that is then refused. */}
        <StrengthMeter password={password} email={email} />
        <Button type="submit" variant="primary" block loading={busy}>
          Set this password
        </Button>
      </form>
    );
  }

  if (stage.k === 'code') {
    return (
      <div className="flex flex-col gap-4">
        {notices}
        <MfaChallenge
          sentTo={stage.sentTo}
          pillLabel="Reset code"
          heading="Enter the code we emailed you"
          reason="It proves you can read the address the account was opened with."
          factorNote="If nothing arrives within a few minutes, check the spam folder — and check the address above is the one the account uses. We cannot tell you whether it is."
          onVerify={async (code) => {
            // Verified and spent in the same call as the new password, because
            // `POST /auth/password/reset` takes both. Holding the code here
            // rather than round-tripping is what makes that one call possible.
            setStage({ k: 'choose', sentTo: stage.sentTo, code });
            return undefined;
          }}
          onResend={async () => {
            const sent = await sendPasswordResetCode(email);
            return sent.ok ? { sentTo: sent.data.sentTo } : { error: sent.message };
          }}
        />
        <div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setError(null);
              setStage({ k: 'ask' });
            }}
          >
            Use a different address
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void request();
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
        hint="The address the account was opened with. We email a six-digit code to it."
      />
      <Button
        type="submit"
        variant="primary"
        block
        loading={busy}
        {...(wait
          ? { disabledReason: 'Too many attempts. The wait above has to run out first.' }
          : {})}
      >
        Email me a reset code
      </Button>
      <p className="text-body-sm text-ink-3">
        We say the same thing whether or not that address has an account — telling you would tell
        anybody else who asked.{' '}
        <a className="text-acc-ink underline underline-offset-4" href="/sign-in">
          Back to sign in
        </a>
      </p>
    </form>
  );
}
