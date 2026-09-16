'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  getOnboarding,
  getSession,
  type ResumableOnboarding,
  type SessionView,
} from '../../register/api';
import {
  getApprovals,
  getOrderReadiness,
  getProfile,
  type ApprovalRow,
  type OrderReadiness,
  type OrgProfile,
} from '../api';

/**
 * What every portal screen needs to know about who is here.
 *
 * One read of the session, the organisation's profile and its onboarding
 * progress, shared through context, so the masthead, the completion banner, the
 * rail and the page do not each ask the API the same three questions.
 *
 * **This is also the door.** A visitor with no session is sent to sign in with
 * a `next` back to where they were, before any portal screen renders. The
 * check is on the client rather than in a middleware because the refresh cookie
 * is scoped to `/api/auth` and never reaches a page request — a middleware could
 * see only the fifteen-minute access cookie, and would bounce a perfectly
 * signed-in buyer whose access cookie had lapsed while their refresh cookie
 * was still good. `GET /auth/session` rotates that pair; nothing else can.
 */

export interface PortalState {
  session: SessionView;
  /** `null` while in flight, or when a seat may not read it. Never a guess. */
  profile: OrgProfile | null;
  /** `null` while in flight, or for a seat refused onboarding (403). */
  onboarding: ResumableOnboarding | null;
  /**
   * Whether this organisation may order, from the server. `null` while in
   * flight or when the read was refused — never a guess, and never recomputed
   * from the profile cards.
   */
  readiness: OrderReadiness | null;
  /**
   * Orders waiting on this person's signature, for the rail's badge.
   *
   * Zero when there is nothing and when the seat may not read approvals — the
   * rail renders no badge either way, because a badge of 0 is a thing to check
   * that turns out to be nothing.
   */
  approvalsWaiting: number;
  /**
   * The first page of those, so Home renders the same rows the board does.
   *
   * Pending approvals used to come from two endpoints with two DTOs — Home read
   * `/orders/summary`'s `PendingApproval`, `/approvals` read `ApprovalRow` —
   * and rendered the same rows from each. One source, read once here.
   */
  approvals: ApprovalRow[];
  /** Re-read everything. Called after a profile section saves. */
  reload: () => void;
  /** Replace the session in place, e.g. after the buyer adds their name. */
  setSession: (next: SessionView) => void;
}

/** Exported for tests, which render a screen inside a hand-built state. */
export const PortalContext = React.createContext<PortalState | null>(null);

export function usePortal(): PortalState {
  const ctx = React.useContext(PortalContext);
  if (!ctx) throw new Error('usePortal() must be rendered inside the portal shell.');
  return ctx;
}

type Gate =
  | { k: 'checking' }
  | { k: 'signed-out' }
  | { k: 'wrong-portal'; message: string }
  | { k: 'ready'; session: SessionView };

export function PortalProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  /** Drawn while the session is being checked. */
  fallback: React.ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [gate, setGate] = React.useState<Gate>({ k: 'checking' });
  const [profile, setProfile] = React.useState<OrgProfile | null>(null);
  const [onboarding, setOnboarding] = React.useState<ResumableOnboarding | null>(null);
  const [readiness, setReadiness] = React.useState<OrderReadiness | null>(null);
  const [approvalsWaiting, setApprovalsWaiting] = React.useState(0);
  const [approvals, setApprovals] = React.useState<ApprovalRow[]>([]);
  const [token, setToken] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getSession();
      if (!live) return;
      if (!result.ok) {
        setGate({ k: 'signed-out' });
        return;
      }
      if (result.data.orgType !== 'BUYER') {
        setGate({
          k: 'wrong-portal',
          message:
            'This account is for vendors and staff. The buyer portal is for buying organisations only — sign in to the supplier console instead.',
        });
        return;
      }
      setGate({ k: 'ready', session: result.data });
    })();
    return () => {
      live = false;
    };
  }, []);

  // The two organisation reads, once there is a session to read them for.
  React.useEffect(() => {
    if (gate.k !== 'ready') return;
    let live = true;
    void (async () => {
      const [p, o, r, a] = await Promise.all([
        getProfile(),
        getOnboarding(),
        getOrderReadiness(),
        getApprovals('status=waiting&per=5'),
      ]);
      if (!live) return;
      setProfile(p.ok ? p.data : null);
      setOnboarding(o.ok ? o.data : null);
      setReadiness(r.ok ? r.data : null);
      setApprovalsWaiting(a.ok ? a.data.waitingOnYou : 0);
      setApprovals(a.ok ? a.data.approvals : []);
    })();
    return () => {
      live = false;
    };
  }, [gate.k, token]);

  React.useEffect(() => {
    if (gate.k !== 'signed-out') return;
    router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [gate.k, pathname, router]);

  const reload = React.useCallback((): void => setToken((n) => n + 1), []);
  const setSession = React.useCallback((next: SessionView): void => {
    setGate({ k: 'ready', session: next });
  }, []);

  const value = React.useMemo<PortalState | null>(
    () =>
      gate.k === 'ready'
        ? {
            session: gate.session,
            profile,
            onboarding,
            readiness,
            approvalsWaiting,
            approvals,
            reload,
            setSession,
          }
        : null,
    [gate, profile, onboarding, readiness, approvalsWaiting, approvals, reload, setSession],
  );

  if (gate.k === 'wrong-portal') {
    return (
      <div className="hub-main">
        <h1>Not a buyer account</h1>
        <p className="mt-3 text-body text-ink-2">{gate.message}</p>
      </div>
    );
  }
  if (!value) return <>{fallback}</>;
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}
