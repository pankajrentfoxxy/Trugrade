import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Input, StatusPill } from '@trugrade/ui';
import { measurePassword } from '../../../../storefront/src/app/register/validation';
import { acceptInvite, previewInvite } from '../vendor/team/teamApi';

/**
 * ARCHETYPE F — Set password after a team invite. Outside the shell.
 */
export function AcceptInviteRoute(): React.JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [preview, setPreview] = React.useState<Awaited<
    ReturnType<typeof previewInvite>
  > | null>(null);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) return;
    void previewInvite(token).then(setPreview);
  }, [token]);

  const strength = measurePassword(password, {
    email: preview && preview.ok ? preview.data.email ?? '' : '',
    mobile: '',
  });

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <h1 className="text-h2 text-ink">Invite link invalid</h1>
        <p className="mt-2 text-body text-ink-2">Ask your account owner for a new invite.</p>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <p className="text-body text-ink-2">Loading invite…</p>
      </main>
    );
  }

  if (!preview.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <h1 className="text-h2 text-ink">Invite unavailable</h1>
        <p className="mt-2 text-body text-ink-2">{preview.message}</p>
      </main>
    );
  }

  const { data } = preview;
  if (data.expired || data.alreadyUsed) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <h1 className="text-h2 text-ink">This invite is no longer valid</h1>
        <p className="mt-2 text-body text-ink-2">
          {data.alreadyUsed
            ? 'This link was already used.'
            : 'The link expired after 72 hours. Ask for a new one.'}
        </p>
      </main>
    );
  }

  const submit = async (): Promise<void> => {
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (strength.missing.length > 0) {
      setError(`Password needs: ${strength.missing.join(', ')}.`);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await acceptInvite(token, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    void navigate('/vendor', { replace: true });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-h2 text-ink">Set your password</h1>
      <p className="mt-2 text-body text-ink-2">
        Joining <span className="text-ink">{data.orgLegalName}</span> as{' '}
        <span className="text-ink">{data.roleLabel}</span>. Invited by {data.inviterName}.
      </p>
      {data.mfaRequired ? (
        <StatusPill className="mt-4" tone="info" label="2FA required for this role after sign-in" />
      ) : null}

      <div className="mt-6 flex flex-col gap-4">
        <Input
          label="Password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="font-mono text-label tnum text-ink-3">
          Strength: {strength.label}
          {strength.missing.length > 0 ? ` — needs ${strength.missing.join(', ')}` : ''}
        </p>
        <Input
          label="Confirm password"
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error ? (
          <p className="text-body-sm text-fail" role="alert">
            {error}
          </p>
        ) : null}
        <Button variant="primary" loading={busy} onClick={() => void submit()}>
          Create account and sign in
        </Button>
      </div>
    </main>
  );
}
