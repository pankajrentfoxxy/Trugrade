'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { Skeleton, ToastProvider } from '@trugrade/ui';
import { logout } from '../../register/api';
import { PortalProvider, usePortal } from './PortalContext';
import { ProfileBanner } from './ProfileBanner';
import { activePortalEntry, portalGroups, type PortalNavEntry } from './nav';
import { RailIcon, SearchIcon } from './rail-icons';

/**
 * The buyer portal frame: white masthead, 96px icon rail, completion banner,
 * white footer — the same shape as the supplier hub, on the storefront's own
 * origin so the session cookie is the one the shop already set.
 *
 * The frame is `data-surface="hub"` on the root element (see `layout.tsx`),
 * which swaps the storefront's dark chrome tokens for the hub's. The dark
 * header stays on the shopping pages; this is the working surface behind it.
 */

/** What each role is called on the masthead. */
const ROLE_LABEL: Record<string, string> = {
  CUSTOMER_OWNER: 'Account owner',
  CUSTOMER_ADMIN: 'Admin',
  CUSTOMER_BUYER: 'Buyer',
  CUSTOMER_APPROVER: 'Approver',
  CUSTOMER_FINANCE: 'Finance',
  CUSTOMER_VIEWER: 'Viewer',
};

function initials(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function Masthead(): React.JSX.Element {
  const { session, profile } = usePortal();
  const router = useRouter();
  const [q, setQ] = React.useState('');
  const [signingOut, setSigningOut] = React.useState(false);

  const monogram = initials(session.fullName);
  const role = session.roles.map((r) => ROLE_LABEL[r]).find(Boolean) ?? null;
  const orgName =
    profile && profile.legalName !== 'Pending company details' ? profile.legalName : null;

  const signOut = (): void => {
    if (signingOut) return;
    setSigningOut(true);
    void (async () => {
      await logout();
      // A full navigation, not a client transition: the shop's header reads
      // the cookie on the server, and the portal must not get a chance to
      // notice the missing session and bounce to sign-in on the way out.
      window.location.assign('/');
    })();
  };

  return (
    <header className="hub-mast">
      <Link href="/home" aria-label="Buyer portal home" className="hub-mast__brand">
        <span className="hub-mast__tile" aria-hidden="true">
          t
        </span>
        <span className="hub-mast__names">
          <span className="hub-mast__wordmark">
            tru<em>grade</em>
          </span>
          <span className="hub-mast__portal">{orgName ?? 'Buyer portal'}</span>
        </span>
      </Link>

      <form
        className="hub-mast__search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const next = q.trim();
          if (!next) return;
          router.push(`/search?q=${encodeURIComponent(next)}` as Route);
        }}
      >
        <SearchIcon />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search inspected laptops"
          aria-label="Search inspected laptops"
        />
      </form>

      <div className="hub-mast__account">
        <span className="hub-mast__avatar font-mono" aria-hidden="true">
          {monogram || '—'}
        </span>
        <span className="hub-mast__who">
          <span className="hub-mast__name">
            {session.fullName?.trim() || (
              <Link href="/profile" className="hub-link">
                Add your name
              </Link>
            )}
          </span>
          {role ? <span className="hub-mast__role">{role}</span> : null}
        </span>
        <button
          type="button"
          className="hub-mast__out"
          onClick={signOut}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}

function Rail({ active }: { active: PortalNavEntry | undefined }): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const groups = portalGroups();

  return (
    <>
      <button
        type="button"
        className="hub-rail-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="portal-rail"
      >
        {open ? 'Close menu' : 'Menu'}
      </button>
      <aside
        id="portal-rail"
        aria-label="Your account"
        className="hub-rail"
        data-open={open ? 'true' : 'false'}
      >
        {groups.map(([group, entries]) => (
          <div key={group} className="contents">
            <div className="hub-rail__group">{group}</div>
            {entries.map((n) => (
              <Link
                key={n.to}
                href={n.to as Route}
                aria-current={n === active ? 'page' : undefined}
                className="hub-rail__item"
                onClick={() => setOpen(false)}
              >
                <span className="hub-rail__tile">
                  <RailIcon to={n.to} />
                </span>
                <span className="hub-rail__label">{n.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </aside>
    </>
  );
}

function PortalFooter(): React.JSX.Element {
  const {
    legalName,
    brandName,
    website,
    gstin,
    cin,
    registeredOffice: office,
    customerCare,
    grievanceOfficer,
  } = LEGAL_DISCLOSURE;

  return (
    <footer>
      <div className="mx-auto grid max-w-[var(--maxw)] gap-6 px-8 py-6 md:grid-cols-3">
        <div>
          <span className="text-[16px] font-semibold text-ink">{brandName}</span>
          <p className="mt-2 font-mono text-[11px] text-ink-3">{legalName}</p>
        </div>
        <div>
          <h5 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">
            Office
          </h5>
          <address className="mt-2 font-mono text-[12px] not-italic leading-[1.7] text-ink-3">
            {office.line1}
            <br />
            {office.city}, {office.state} {office.pincode}
          </address>
          <a
            href={website}
            className="mt-2 inline-block font-mono text-[12px] text-ink-3 underline"
          >
            {website}
          </a>
        </div>
        <div>
          <h5 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">Care</h5>
          <p className="mt-2 font-mono text-[12px] text-ink-3">{customerCare.email}</p>
          <p className="font-mono text-[12px] text-ink-3">{grievanceOfficer.email}</p>
          <Link href="/legal" className="mt-2 inline-block text-[12px] text-ink-3 underline">
            Policies and legal
          </Link>
        </div>
      </div>
      <div className="mx-auto max-w-[var(--maxw)] border-t border-rule px-8 py-3 font-mono text-[11px] text-ink-4">
        {legalName}
        {cin ? ` · CIN ${cin}` : ''}
        {` · GSTIN ${gstin}`}
        {` · ${grievanceOfficer.designation}`}
      </div>
    </footer>
  );
}

/** The frame with nothing in it yet — drawn while the session is being checked. */
function Checking(): React.JSX.Element {
  return (
    <div className="hub-frame">
      <header className="hub-mast" aria-hidden="true" />
      <div className="hub-body">
        <main className="hub-main">
          <Skeleton lines={6} />
        </main>
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const active = activePortalEntry(pathname);
  return (
    <div className="hub-frame">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-5 focus:top-2 focus:z-40 focus:rounded focus:bg-acc focus:px-3 focus:py-2 focus:text-acc-on"
      >
        Skip to content
      </a>
      <Masthead />
      <ProfileBanner />
      <div className="hub-body">
        <Rail active={active} />
        <main id="main" className="hub-main">
          {children}
        </main>
      </div>
      <PortalFooter />
    </div>
  );
}

/**
 * Sets `data-surface="hub"` for the life of the portal. The inline script in
 * `layout.tsx` does the same before first paint; this covers a client-side
 * navigation into the portal, and puts the buyer chrome back on the way out.
 */
function SurfaceSync(): null {
  React.useEffect(() => {
    const root = document.documentElement;
    root.dataset.surface = 'hub';
    return () => {
      delete root.dataset.surface;
    };
  }, []);
  return null;
}

export function PortalShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ToastProvider>
      <SurfaceSync />
      <PortalProvider fallback={<Checking />}>
        <Frame>{children}</Frame>
      </PortalProvider>
    </ToastProvider>
  );
}
