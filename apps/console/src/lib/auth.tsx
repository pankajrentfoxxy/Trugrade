import * as React from 'react';
import { Navigate, useLocation } from 'react-router';

export interface Principal {
  userId: string;
  orgId: string;
  orgType: 'PLATFORM' | 'VENDOR' | 'BUYER';
  roles: string[];
  permissions: string[];
}

interface AuthState {
  principal: Principal | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

/**
 * The console's session.
 *
 * The access token is never put in `localStorage`. It lives in memory and the
 * refresh token is an httpOnly cookie the API sets — so an XSS that gets script
 * execution still cannot read a token out and replay it later. Losing the access
 * token on reload is the cost, and `restore()` pays it with one refresh call.
 */
export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [principal, setPrincipal] = React.useState<Principal | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        if (!cancelled) setPrincipal(res.ok ? ((await res.json()) as Principal) : null);
      } catch {
        // Network failure is not the same as signed out, but there is nothing
        // useful to render either way; the login screen is the honest fallback.
        if (!cancelled) setPrincipal(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = React.useMemo<AuthState>(
    () => ({
      principal,
      loading,
      signIn: async (email, password) => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) throw new Error('Those details did not match an account.');
        setPrincipal((await res.json()) as Principal);
      },
      signOut: async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
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
  permission: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { principal, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="p-6 text-ink-2">Checking your session…</div>;
  if (!principal) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
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
