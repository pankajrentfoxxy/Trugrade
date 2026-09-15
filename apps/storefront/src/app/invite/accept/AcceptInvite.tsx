'use client';

import * as React from 'react';
import { Button, Skeleton, StatusPill } from '@trugrade/ui';
import { acceptInvite, previewInvite, type InvitePreview } from '../../(portal)/api';
import { AuthShell } from '../../AuthShell';

/**
 * **ARCHETYPE F — Focus.** Taking up a team invite.
 *
 * The link in the email is the proof: opening it says the mailbox is theirs.
 * There is no password to choose — a buyer's colleague signs in with a code
 * to the email or mobile on the invite from then on — so the whole task is to
 * read who invited you to what, and say yes.
 */

type Phase =
  | { k: 'loading' }
  | { k: 'no-token' }
  | { k: 'unavailable'; message: string }
  | { k: 'ready'; invite: InvitePreview };

export function AcceptInvite(): React.JSX.Element {
  const [token, setToken] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(t);
    if (!t) {
      setPhase({ k: 'no-token' });
      return;
    }
    void previewInvite(t).then((result) => {
      if (result.ok) setPhase({ k: 'ready', invite: result.data });
      else setPhase({ k: 'unavailable', message: result.message });
    });
  }, []);

  const accept = async (): Promise<void> => {
    if (!token) return;
    setBusy(true);
    setError(null);
    const result = await acceptInvite(token);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    window.location.replace('/home');
  };

  if (phase.k === 'no-token') {
    return (
      <AuthShell title="Invite link invalid" lede="This link is missing its token." wide>
        <p className="text-body text-ink-2">Ask your account owner to send the invite again.</p>
      </AuthShell>
    );
  }

  if (phase.k === 'loading') {
    return (
      <AuthShell title="Your invite" lede="Checking the link…" wide>
        <Skeleton lines={4} />
      </AuthShell>
    );
  }

  if (phase.k === 'unavailable') {
    return (
      <AuthShell title="Invite unavailable" lede={phase.message} wide>
        <p className="text-body text-ink-2">Ask your account owner to send a new invite.</p>
      </AuthShell>
    );
  }

  const { invite } = phase;
  if (invite.expired || invite.alreadyUsed) {
    return (
      <AuthShell
        title="This invite is no longer valid"
        lede={
          invite.alreadyUsed
            ? 'This link was already used.'
            : 'The link expired after 72 hours. Ask for a new one.'
        }
        wide
      >
        <a className="hub-link" href="/sign-in">
          Already joined? Sign in.
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${invite.orgLegalName}`}
      lede={`${invite.inviterName} has invited you as ${invite.roleLabel}. You will sign in with a code to ${invite.email ?? 'your email'} — there is no password to set.`}
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
          <dt className="text-ink-3">Organisation</dt>
          <dd className="text-ink">{invite.orgLegalName}</dd>
          <dt className="text-ink-3">Your role</dt>
          <dd className="text-ink">{invite.roleLabel}</dd>
          <dt className="text-ink-3">Invited by</dt>
          <dd className="text-ink">{invite.inviterName}</dd>
          {invite.email ? (
            <>
              <dt className="text-ink-3">Signing in as</dt>
              <dd className="font-mono text-ink">{invite.email}</dd>
            </>
          ) : null}
        </dl>
        {invite.mfaRequired ? (
          <StatusPill tone="info" label="A second code is asked for on every sign-in" />
        ) : null}
        {error ? (
          <p className="text-body-sm text-fail" role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <Button variant="primary" loading={busy} onClick={() => void accept()}>
            Join and sign in
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
