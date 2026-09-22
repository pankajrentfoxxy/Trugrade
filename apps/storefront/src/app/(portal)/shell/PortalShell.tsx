'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { HubAccountMenu, Skeleton, ToastProvider } from '@trugrade/ui';
import { logout } from '../../register/api';
import { PortalProvider, usePortal } from './PortalContext';
import { ProfileBanner } from './ProfileBanner';
import { activePortalEntry, lockLabel, lockOn, portalGroups, type PortalNavEntry } from './nav';
import { RailIcon, SearchIcon } from './rail-icons';
import { screenLock, ShutScreen } from './ShutScreen';

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
  const name = session.fullName?.trim() || null;
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
      {/*
        The wordmark goes to the shop, not to `/home`.

        It pointed at the portal's own Home, which is the screen the rail's
        first entry opens and usually the screen you are already on — a brand
        mark that does nothing. Everywhere else on the web it means "the front
        of this site", and on the buyer side the front of the site is the
        catalogue. The way back to the portal is the rail, which is always up.
      */}
      <Link href="/" aria-label="Trugrade home" className="hub-mast__brand">
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

      {/*
        Inside the portal, this searches the buyer's OWN orders.

        It used to push `/search?q=` — the public catalogue — while sitting
        directly above an orders board whose own search already accepts an order
        number, a PO reference or a serial. Somebody typing an order number into
        the box at the top of their orders screen was sent shopping.

        The catalogue is still one click away, offered underneath rather than
        assumed: a buyer in the portal is far more often looking for something
        they have already bought.
      */}
      <form
        className="hub-mast__search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const next = q.trim();
          if (!next) return;
          router.push(`/orders?q=${encodeURIComponent(next)}` as Route);
        }}
      >
        <SearchIcon />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your orders"
          aria-label="Search your orders by order number, PO reference or serial"
        />
        {q.trim() ? (
          <Link
            className="hub-link hub-mast__elsewhere"
            href={`/search?q=${encodeURIComponent(q.trim())}` as Route}
          >
            Search the catalogue instead
          </Link>
        ) : null}
      </form>

      <HubAccountMenu
        className="hub-mast__account"
        monogram={monogram}
        name={name}
        role={role}
        label={`${name ?? 'Your account'} — account menu`}
      >
        {/*
          Shopping is the one thing the portal had no door to: every rail entry
          is something already bought. A client transition, because `/` is this
          same app — the portal's SurfaceSync puts the dark shop chrome back on
          the way out.
        */}
        <Link className="hub-menu__item" role="menuitem" href="/">
          Start purchasing
        </Link>
        {name ? null : (
          <Link className="hub-menu__item" role="menuitem" href="/profile">
            Add your name
          </Link>
        )}
        <button
          type="button"
          className="hub-menu__item"
          role="menuitem"
          onClick={signOut}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </HubAccountMenu>
    </header>
  );
}

/**
 * The rail, which now tells the truth about what this seat can open.
 *
 * It used to render all eight entries for all six customer roles, so a viewer
 * clicked Team and met a 403 and an approver clicked Returns and met a control
 * that refused on submit. An entry a seat cannot open is **dimmed with a lock**
 * rather than hidden: somebody who cannot find a screen files a ticket, and
 * somebody who can see it exists and is not theirs does not.
 *
 * `hub-rail__lock` and `hub-rail__count` were designed and styled in
 * `packages/ui/hub.css` and emitted by nobody on this side; the vendor shell
 * has used both for months.
 *
 * There are two reasons an entry is shut and they are different sentences. A
 * permission is about the seat and will not change on its own. Verification is
 * about the organisation and is somebody else's outstanding work, so the four
 * screens behind it say what is being waited on rather than naming a grant the
 * buyer has never heard of and cannot give themselves.
 */
function Rail({
  active,
  counts,
}: {
  active: PortalNavEntry | undefined;
  /** Work waiting, by route. Absent means nothing to say — never a zero badge. */
  counts: Readonly<Record<string, number>>;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const { session, orgVerified } = usePortal();
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
            {entries.map((n) => {
              const lock = lockOn(n, { permissions: session.permissions, orgVerified });
              const waiting = counts[n.to];
              const label = lock ? lockLabel(n, lock) : n.label;
              return (
                <Link
                  key={n.to}
                  href={n.to as Route}
                  aria-current={n === active ? 'page' : undefined}
                  aria-disabled={lock ? true : undefined}
                  title={lock ? label : undefined}
                  className="hub-rail__item"
                  data-locked={lock ? 'true' : undefined}
                  data-lock={lock?.kind}
                  onClick={(e) => {
                    if (lock) {
                      e.preventDefault();
                      return;
                    }
                    setOpen(false);
                  }}
                >
                  <span className="hub-rail__tile">
                    <RailIcon to={n.to} />
                  </span>
                  <span className="hub-rail__label">{n.label}</span>
                  {/*
                    The reason, for a screen reader. `title` is a hover tooltip
                    and a padlock is `aria-hidden`, so without this the only
                    thing announced is a link that does nothing when followed.
                  */}
                  {lock ? <span className="sr-only">{label}</span> : null}
                  {lock ? (
                    <span className="hub-rail__lock" aria-hidden="true">
                      <LockIcon />
                    </span>
                  ) : waiting ? (
                    // A count, never a dot: "3 waiting" and "some waiting" are
                    // different facts. Absent at zero rather than a badge of 0.
                    <span className="hub-rail__count hub-rail__count--work">{waiting}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </aside>
    </>
  );
}

/** The padlock on an entry that is shut, whichever of the two reasons shut it. */
function LockIcon(): React.JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
    </svg>
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

/**
 * The frame, and the lock on the screen inside it.
 *
 * The rail's padlock used to be the only gate, and a padlock on a link does
 * nothing to a URL typed by hand: `/orders` rendered for an unverified
 * organisation and `/team` for a viewer. The same `lockOn` the rail draws from
 * now decides what goes in the main slot — the page, or a screen that says why
 * not. A route the rail shows shut is shut.
 */
function Frame({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const active = activePortalEntry(pathname);
  const { session, orgVerified, approvalsWaiting } = usePortal();
  const lock = screenLock(active, { permissions: session.permissions, orgVerified });
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
        <Rail active={active} counts={{ '/approvals': approvalsWaiting }} />
        <main id="main" className="hub-main">
          {active && lock ? <ShutScreen entry={active} lock={lock} /> : children}
        </main>
      </div>
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
