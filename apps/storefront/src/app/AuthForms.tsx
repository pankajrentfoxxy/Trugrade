'use client';

import * as React from 'react';

/**
 * Sign in.
 *
 * Registration is `register/RegisterFlow.tsx`: a five-step flow, not a form.
 *
 * This posts to the API through the same-origin `/api` path so the session
 * cookies stay first-party. The access token in the response body is
 * deliberately ignored here: a browser that holds a token in JS hands it to the
 * first XSS that lands, and the cookie the server just set is what actually
 * authenticates the next request.
 */

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
