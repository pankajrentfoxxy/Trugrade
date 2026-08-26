import * as React from 'react';
import { useNavigate } from 'react-router';
import { BRAND } from '@trugrade/config/brand';
import { Button, Input, Logo, TickRule } from '@trugrade/ui';
import { useAuth } from '../lib/auth';

/**
 * ARCHETYPE F — Focus. One task, centred, no navigation.
 *
 * Deliberately outside the shell: chrome offering sections you cannot reach yet
 * is noise, and the section rail is meaningless before there is a principal to
 * filter it by.
 */

export function LoginRoute(): React.JSX.Element {
  const { signIn, principal } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (principal) void navigate('/kyc', { replace: true });
  }, [principal, navigate]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await signIn(String(form.get('email')), String(form.get('password')));
    } catch (err) {
      // Deliberately one message for both a wrong password and an unknown
      // address. Distinguishing them turns the login form into an account
      // enumerator.
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-5">
      <div className="tg-card w-full max-w-sm rounded-lg border border-rule bg-sheet">
        <Logo />
        <h1 className="mt-6 text-h1 text-ink">Sign in</h1>
        <TickRule />
        <p className="mt-2 text-body-sm text-ink-2">
          {BRAND.name} staff only. Vendors and buyers use their own portal.
        </p>

        <form onSubmit={(e) => void onSubmit(e)} className="mt-6 flex flex-col gap-5">
          <Input label="Work email" name="email" type="email" required autoComplete="username" />
          <Input
            label="Password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            {...(error ? { error } : {})}
          />
          {/* The one amber control on the screen. */}
          <Button type="submit" variant="primary" block loading={busy}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
