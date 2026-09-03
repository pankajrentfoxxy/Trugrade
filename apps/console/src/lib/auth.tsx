import * as React from 'react';
import { Navigate, useLocation } from 'react-router';
import { SESSION_POLICY, type Permission } from '@trugrade/contracts';

export interface Principal {
  userId: string;
  orgId: string;
  orgType: 'PLATFORM' | 'VENDOR' | 'BUYER';
  roles: string[];
  permissions: string[];
  /**
   * This session still owes a second factor, and `AuthGuard` refuses every
   * non-public route until it lands.
   *
   * It has to be on the principal because it decides what the console may
   * render: without it, a VENDOR_OWNER signs in, is shown a full navigation
   * rail, and every screen behind it 403s with `mfa_required`. The flag is the
   * server's own — `GET /auth/session` reads it off the token claim — so the
   * console never infers an outstanding factor from a symptom.
   */
  mfaRequired: boolean;
  /** From `GET /auth/session` — initials on the chrome avatar. */
  fullName?: string | null;
}

/**
 * A refusal, unwrapped, with everything a screen needs to say what happened.
 *
 * An `Error` was the wrong shape here and cost the login screen three things:
 * the server's own sentence (which is the only one that distinguishes a
 * suspended organisation from a wrong password), the `Retry-After` seconds that
 * make a rate limit a real wait rather than a shrug, and the status that tells
 * the two apart at all.
 */
export interface AuthFailure {
  status: number;
  code: string;
  message: string;
  /** Seconds until the caller may try again. Null unless the server sent one. */
  retryAfterSeconds: number | null;
}

interface AuthState {
  principal: Principal | null;
  loading: boolean;
  /** Resolves to the failure, or to the principal. Never throws. */
  signIn: (email: string, password: string) => Promise<Principal | AuthFailure>;
  /** Requests a second-factor code for the half-finished session. */
  requestMfaCode: () => Promise<{ sentTo: string } | AuthFailure>;
  verifyMfa: (code: string) => Promise<Principal | AuthFailure>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

/** Narrow any of the three results this module returns. */
export const isFailure = <T,>(r: T | AuthFailure): r is AuthFailure =>
  typeof r === 'object' && r !== null && 'code' in r && 'status' in r;

/** `DomainExceptionFilter`'s envelope, plus the header that carries the wait. */
async function call(path: string, init?: RequestInit): Promise<unknown | AuthFailure> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  } catch {
    return {
      status: 0,
      code: 'NETWORK',
      message: 'We could not reach the server. Nothing you typed has been lost — try again.',
      retryAfterSeconds: null,
    } satisfies AuthFailure;
  }

  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.ok) return body;

  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  const seconds = Number(res.headers.get('Retry-After'));
  return {
    status: res.status,
    code: err?.code ?? 'UNKNOWN',
    // The server's words. It is the only party that knows whether this is a
    // wrong password, a suspended organisation or a spent budget — and it is
    // deliberately identical for the first of those and an unknown address.
    message: err?.message ?? `That did not go through (${res.status}).`,
    retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null,
  } satisfies AuthFailure;
}

/**
 * One in-flight `/auth/session` at a time, and every caller shares it.
 *
 * That route is also the rotation point — there is no separate `/auth/refresh` —
 * so two concurrent calls present the same refresh token and the loser looks
 * exactly like a replay. `StrictMode` mounts the provider's effect twice in
 * development and fires both, because the `cancelled` flag below suppresses the
 * `setState`, never the request.
 *
 * The server tolerates that race now (`TokenService.rotate` replays a rotation
 * for a few seconds), but sending one request instead of two is still correct.
 * This only dedupes within one document; nothing here can dedupe across tabs,
 * which is exactly why the server-side fix is the one that matters.
 */
let sessionInFlight: Promise<unknown | AuthFailure> | null = null;

export function refreshSession(): Promise<unknown | AuthFailure> {
  if (!sessionInFlight) {
    const started = call('/api/auth/session');
    sessionInFlight = started;
    void started.finally(() => {
      // Guard the identity: a later call may already have claimed the slot.
      if (sessionInFlight === started) sessionInFlight = null;
    });
  }
  return sessionInFlight;
}

/**
 * The console's session.
 *
 * The access token is never put in `localStorage`. It lives in the httpOnly
 * cookie the API sets — so an XSS that gets script execution still cannot read a
 * token out and replay it later. Losing it on reload is the cost, and the
 * restore below pays it with one `/auth/session` call.
 */
export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [principal, setPrincipal] = React.useState<Principal | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await refreshSession();
      if (cancelled) return;
      setPrincipal(result && !('code' in (result as object)) ? (result as Principal) : null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Renew ahead of expiry, because nothing else does.
   *
   * The access cookie is set to `accessTtl - 30s` and there is no interceptor
   * renewing it, so a tab left open simply starts 401ing at the fifteen-minute
   * mark while the chrome goes on drawing a session that is gone. The user's
   * instinct is to reload, and a reload used to be the thing that destroyed the
   * session outright.
   *
   * Only a 401 clears the principal. A refresh that failed because the network
   * blinked is not evidence that the session ended, and signing someone out over
   * it would swap a silent failure for a rude one.
   */
  React.useEffect(() => {
    if (!principal) return;
    const everyMs = SESSION_POLICY.accessTtlSeconds * 0.8 * 1000;
    const id = setInterval(() => {
      void refreshSession().then((result) => {
        if (result && 'code' in (result as object)) {
          if ((result as AuthFailure).status === 401) setPrincipal(null);
        }
      });
    }, everyMs);
    return () => clearInterval(id);
  }, [principal]);

  const value = React.useMemo<AuthState>(
    () => ({
      principal,
      loading,
      signIn: async (email, password) => {
        const result = await call('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        if (result && 'code' in (result as object)) return result as AuthFailure;
        const next = result as Principal;
        // A session that still owes a factor is NOT signed in as far as the
        // chrome is concerned: publishing it would draw a rail of sections that
        // every guard is about to refuse. The login screen holds it instead
        // until `verifyMfa` returns a session that opens doors.
        if (!next.mfaRequired) setPrincipal(next);
        return next;
      },
      requestMfaCode: async () => {
        const result = await call('/api/auth/mfa/otp', { method: 'POST' });
        if (result && 'code' in (result as object)) return result as AuthFailure;
        return result as { sentTo: string };
      },
      verifyMfa: async (code) => {
        const result = await call('/api/auth/mfa/verify', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        if (result && 'code' in (result as object)) return result as AuthFailure;
        const next = result as Principal;
        setPrincipal(next);
        return next;
      },
      signOut: async () => {
        await call('/api/auth/logout', { method: 'POST' });
        setPrincipal(null);
      },
    }),
    [principal, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/**
 * Route-level RBAC.
 *
 * This is a *convenience*, not a control. The API authorises every request
 * independently, because a guard that lives in the browser is one devtools
 * breakpoint away from being irrelevant. What it buys is that a reviewer without
 * the permission never sees a screen full of buttons that will all fail.
 */
export function RequirePermission({
  permission,
  children,
}: {
  // `Permission`, not `string`. Two nav entries used to be gated on
  // 'kyc.review' and 'vendor.read', which are not in ROLE_PERMISSIONS and so
  // matched no principal ever issued — the screens behind them were simply
  // invisible, and nothing failed loudly enough to say so. A closed union turns
  // that from a silent dead link into a compile error.
  permission: Permission;
  children: React.ReactNode;
}): React.JSX.Element {
  const { principal, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="p-6 text-ink-2">Checking your session…</div>;
  if (!principal) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  // A restored session that still owes a factor lands back on the login screen,
  // which is the only place that can ask for one.
  if (principal.mfaRequired) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (!principal.permissions.includes(permission)) {
    return (
      <div className="mx-auto max-w-container p-6">
        <h1 className="text-h2 text-ink">You do not have access to this screen</h1>
        <p className="mt-3 text-body text-ink-2">
          Ask an administrator for the <code className="font-mono text-data">{permission}</code>{' '}
          permission. Nothing was changed.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
