import * as React from 'react';
import { OTP_POLICY } from '@trugrade/contracts';
import { Button } from './primitives';
import { StatusPill } from './primitives';
import { OtpInput } from './forms';
import { cn } from '../lib/cn';

/**
 * The second-factor exchange, once, for both portals.
 *
 * A buyer meets this in the middle of registration; a supplier owner meets it on
 * every sign-in, in the console. Same six boxes, same sixty-second cooldown,
 * same rule about whose words a refusal is in — so it is the same component,
 * with the two network calls passed in rather than imported. A second copy in
 * the console would be a second place for the cooldown to be forgotten, which is
 * exactly the argument `IdentityController` makes for not having a resend route.
 *
 * **It says what the factor actually is.** Today that is a code to the address
 * on the account, which is a weaker thing than an authenticator app and is
 * described as what it is. There is no TOTP enrolment anywhere in the platform;
 * labelling this "authenticator app" would be a lie told by a label.
 */

export interface MfaChallengeProps {
  /**
   * Masked by the server. Never re-derived — an address we assembled ourselves
   * would hide the case where the code went somewhere other than we think.
   */
  sentTo: string;
  /** Resolves to an error message, or undefined once the session is upgraded. */
  onVerify: (code: string) => Promise<string | undefined>;
  /** Resolves to the new masked target, or an error message. */
  onResend: () => Promise<{ sentTo: string } | { error: string }>;
  /** Defaults suit registration; the sign-in screens pass their own. */
  pillLabel?: string;
  heading?: string;
  /** Why this account is asked for a second factor. "We have sent one to X" follows. */
  reason?: string;
  /**
   * What the factor actually is. The default names today's truth for a second
   * factor; a first-factor sign-in code passes its own, because it is not one.
   */
  factorNote?: React.ReactNode;
  /** Anything the calling flow needs to promise, e.g. that a draft is safe. */
  footNote?: React.ReactNode;
  className?: string;
}

export function MfaChallenge({
  sentTo,
  onVerify,
  onResend,
  pillLabel = 'One more code',
  heading = 'Your account is created. It needs a second code before you can carry on.',
  reason = 'A supplier account can change where we send money, so we ask for a second code every time you sign in — not only today.',
  factorNote = 'This second factor is a code to the address on the account. An authenticator app is not supported yet, so it is a second code rather than a second device.',
  footNote,
  className,
}: MfaChallengeProps): React.JSX.Element {
  const [code, setCode] = React.useState('');
  const [target, setTarget] = React.useState(sentTo);
  const [error, setError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [cooldown, setCooldown] = React.useState<number>(OTP_POLICY.resendCooldownSeconds);
  const headingId = React.useId();

  React.useEffect(() => setTarget(sentTo), [sentTo]);

  React.useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const submit = async (entered: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    // The server's own wording, which says whether an attempt was spent or the
    // code timed out. Those are different problems with different fixes.
    const failure = await onVerify(entered);
    if (failure) {
      setError(failure);
      setCode('');
    }
    setBusy(false);
  };

  const resend = async (): Promise<void> => {
    if (cooldown > 0 || busy) return;
    setError(undefined);
    const result = await onResend();
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setTarget(result.sentTo);
    setCode('');
    setCooldown(OTP_POLICY.resendCooldownSeconds);
  };

  return (
    <section
      className={cn('flex flex-col gap-4 rounded-lg border border-rule bg-sheet p-5', className)}
      aria-labelledby={headingId}
    >
      <StatusPill className="self-start" tone="processing" label={pillLabel} />
      <h2 id={headingId} className="text-h3 text-ink">
        {heading}
      </h2>
      <p className="max-w-[62ch]">
        {reason} We have sent one to <span className="font-mono tnum text-ink">{target}</span>.
      </p>

      <div className="flex flex-col gap-3 rounded border border-rule bg-sheet-2 p-4">
        <OtpInput
          label={`Enter the code we sent to ${target}`}
          value={code}
          onChange={setCode}
          onComplete={(entered) => void submit(entered)}
          disabled={busy}
          {...(error ? { error } : {})}
        />
        <p className="text-body-sm text-ink-2">
          The code is good for{' '}
          <span className="tnum text-ink">{OTP_POLICY.ttlSeconds / 60}</span> minutes.{' '}
          {cooldown > 0 ? (
            <>
              No code yet? You can ask for another in{' '}
              <span className="tnum text-ink">{cooldown}</span> seconds.
            </>
          ) : (
            'No code yet? Ask for another below.'
          )}
        </p>
        <div>
          <Button
            type="button"
            variant="secondary"
            {...(cooldown > 0
              ? { disabledReason: `You can ask for another code in ${cooldown} seconds.` }
              : {})}
            onClick={() => void resend()}
          >
            Resend code
          </Button>
        </div>
      </div>

      {/*
        What the factor really is. The backlog asks for TOTP on owner accounts
        and there is no enrolment for it anywhere in the platform, so this says
        the true thing rather than borrowing the word "authenticator".
      */}
      {factorNote && <p className="text-body-sm text-ink-3">{factorNote}</p>}

      {footNote && <p className="text-body-sm text-ink-3">{footNote}</p>}
    </section>
  );
}
