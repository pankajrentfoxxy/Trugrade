'use client';

import * as React from 'react';

/**
 * Sign in and registration.
 *
 * Both post to the API through the same-origin `/api` path so the session
 * cookies stay first-party. The access token in the response body is
 * deliberately ignored here: a browser that holds a token in JS hands it to the
 * first XSS that lands, and the cookie the server just set is what actually
 * authenticates the next request.
 */

type OrgType = 'VENDOR' | 'BUYER';

interface FieldErrors {
  [field: string]: string | undefined;
}

/** The API's error envelope, as `shared/errors` renders it. */
interface ApiError {
  error?: { code?: string; message?: string; fields?: FieldErrors };
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

function messageOf(data: unknown, fallback: string): string {
  const m = (data as ApiError)?.error?.message;
  return typeof m === 'string' && m.length > 0 ? m : fallback;
}

/**
 * Where each kind of account lands after signing in.
 *
 * A vendor and a platform user both belong in the console; a buyer belongs on
 * the storefront. Sending a vendor to the shop is the small wrongness that makes
 * someone think they signed in as the wrong person.
 */
function destinationFor(orgType: unknown): string {
  return orgType === 'BUYER' ? '/' : 'http://localhost:5173/';
}

export function SignInForm(): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const { ok, data } = await post('/api/auth/login', {
      email: String(f.get('email') ?? ''),
      password: String(f.get('password') ?? ''),
    });
    if (!ok) {
      // The API deliberately does not say WHICH of the two was wrong, and
      // neither does this. Naming the field tells an attacker which addresses
      // are registered.
      setError(messageOf(data, 'That email or password is not right.'));
      setBusy(false);
      return;
    }
    window.location.href = destinationFor((data as { orgType?: unknown }).orgType);
  };

  return (
    <form className="authform" onSubmit={submit}>
      {error && (
        <p className="autherr" role="alert">
          {error}
        </p>
      )}
      <label htmlFor="email">Work email</label>
      <input id="email" name="email" type="email" autoComplete="username" required />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />

      <button type="submit" className="pill acc" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="authalt">
        No account yet? <a href="/register">Create one</a>
      </p>
    </form>
  );
}

export function RegisterForm(): React.JSX.Element {
  const [orgType, setOrgType] = React.useState<OrgType>('BUYER');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const { ok, data } = await post('/api/auth/register', {
      orgType,
      companyName: String(f.get('companyName') ?? ''),
      fullName: String(f.get('fullName') ?? ''),
      email: String(f.get('email') ?? ''),
      mobile: String(f.get('mobile') ?? ''),
      password: String(f.get('password') ?? ''),
    });
    if (!ok) {
      setError(messageOf(data, 'We could not create that account.'));
      setBusy(false);
      return;
    }
    // Registration signs you in, so there is no login screen in between.
    window.location.href = destinationFor(orgType);
  };

  return (
    <form className="authform" onSubmit={submit}>
      {error && (
        <p className="autherr" role="alert">
          {error}
        </p>
      )}

      <fieldset className="authtype">
        <legend>What are you here to do?</legend>
        <label className={orgType === 'BUYER' ? 'on' : undefined}>
          <input
            type="radio"
            name="orgType"
            value="BUYER"
            checked={orgType === 'BUYER'}
            onChange={() => setOrgType('BUYER')}
          />
          <b>Buy laptops</b>
          <span>Inspected stock, one GST invoice, serial-level tracking.</span>
        </label>
        <label className={orgType === 'VENDOR' ? 'on' : undefined}>
          <input
            type="radio"
            name="orgType"
            value="VENDOR"
            checked={orgType === 'VENDOR'}
            onChange={() => setOrgType('VENDOR')}
          />
          <b>Sell laptops</b>
          <span>We buy outright at a payout you name. Inspection at your site.</span>
        </label>
      </fieldset>

      <label htmlFor="companyName">Company legal name</label>
      <input id="companyName" name="companyName" required minLength={2} />

      <label htmlFor="fullName">Your name</label>
      <input id="fullName" name="fullName" autoComplete="name" required />

      <label htmlFor="email">Work email</label>
      <input id="email" name="email" type="email" autoComplete="username" required />

      <label htmlFor="mobile">Mobile</label>
      <input
        id="mobile"
        name="mobile"
        className="mono"
        placeholder="+9198…"
        autoComplete="tel"
        required
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
      />
      {/* The composition rule is enforced server-side by passwordSchema. Saying
          it here saves a round trip; it is not the enforcement. */}
      <p className="authhint">
        At least 12 characters, with upper and lower case, a digit and a symbol.
      </p>

      <button type="submit" className="pill acc" disabled={busy}>
        {busy ? 'Creating…' : 'Create account'}
      </button>
      <p className="authalt">
        Already registered? <a href="/sign-in">Sign in</a>
      </p>
    </form>
  );
}
