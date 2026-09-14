import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { cn } from '@trugrade/ui';
import { useAuth, type Principal } from '../lib/auth';
import { VendorSurfaceSync } from '../lib/vendor-surface';
import { useResource } from '../lib/useResource';
import type { OrgProfile } from '../routes/vendor/profile-api';
import { ROLE_LABEL } from '../routes/vendor/team/capability-matrix';
import { VendorCountsProvider, useVendorCounts, type VendorCounts } from './useVendorCounts';
import { activeEntry, canSee, NAV, visibleGroups, type NavEntry } from './nav';
import { LockIcon, RailIcon, SearchIcon } from './rail-icons';
import { ProfileBanner } from './ProfileBanner';
import type { ResumableOnboarding } from '../../../storefront/src/app/register/api';
import './vendor-hub.css';

/**
 * The supplier hub frame: white masthead, 96px icon rail, white footer.
 *
 * The bar is white and not `--chrome`. The dark chrome is the buyer brand; this
 * is a different product on a different subdomain for a different audience.
 * See the note on `:root[data-surface='hub']` in packages/ui/src/globals.css.
 */

/** Listing and SKU work is refused by the API until onboarding is verified. */
const GATED_UNTIL_VERIFIED = new Set(['/vendor/listings/new', '/vendor/sku-request']);

function initials(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function roleLabel(principal: Principal | null | undefined): string | null {
  for (const role of principal?.roles ?? []) {
    const label = ROLE_LABEL[role];
    if (label) return label;
  }
  return null;
}

/**
 * A rail badge is a count of things waiting, never a measure. Payables briefly
 * carried a rounded rupee total here; five glyphs do not fit a 40px tile, and a
 * figure that matters is worth reading in full on the screen that owns it.
 */
function countFor(entry: NavEntry, counts: VendorCounts | undefined): { text: string; work: boolean } | null {
  if (!counts) return null;
  switch (entry.to) {
    case '/vendor/listings':
      return counts.liveListings !== undefined && counts.liveListings > 0
        ? { text: String(counts.liveListings), work: false }
        : null;
    case '/vendor/qc/visits':
      return counts.openVisits !== undefined && counts.openVisits > 0
        ? { text: String(counts.openVisits), work: false }
        : null;
    case '/vendor/corrections':
      return counts.openCorrections !== undefined && counts.openCorrections > 0
        ? { text: String(counts.openCorrections), work: true }
        : null;
    case '/vendor/orders':
      return counts.unacknowledgedPos !== undefined && counts.unacknowledgedPos > 0
        ? { text: String(counts.unacknowledgedPos), work: true }
        : null;
    case '/vendor/dispatch':
      return counts.awaitingDispatch !== undefined && counts.awaitingDispatch > 0
        ? { text: String(counts.awaitingDispatch), work: false }
        : null;
    case '/vendor/team':
      return counts.memberCount !== undefined && counts.memberCount > 0
        ? { text: String(counts.memberCount), work: false }
        : null;
    default:
      return null;
  }
}

function Masthead({ profile }: { profile: OrgProfile | null }): React.JSX.Element {
  const { principal, signOut } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = React.useState('');
  const [signingOut, setSigningOut] = React.useState(false);

  const monogram = initials(principal?.fullName ?? profile?.fullName);
  const role = roleLabel(principal);

  return (
    <header className="hub-mast">
      <Link to="/vendor" aria-label="Supplier hub home" className="hub-mast__brand">
        <span className="hub-mast__tile" aria-hidden="true">
          t
        </span>
        <span className="hub-mast__names">
          <span className="hub-mast__wordmark">
            tru<em>grade</em>
          </span>
          <span className="hub-mast__portal">Supplier Hub</span>
        </span>
      </Link>

      <form
        className="hub-mast__search"
        onSubmit={(e) => {
          e.preventDefault();
          const next = q.trim();
          if (!next) return;
          void navigate(`/vendor/listings?q=${encodeURIComponent(next)}`);
        }}
      >
        <SearchIcon />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search listings, POs, serials"
          aria-label="Search listings, POs, serials"
        />
      </form>

      <div className="hub-mast__account">
        <span className="hub-mast__avatar font-mono" aria-hidden="true">
          {monogram || '—'}
        </span>
        {principal?.fullName ? (
          <span className="hub-mast__who">
            <span className="hub-mast__name">{principal.fullName}</span>
            {role ? <span className="hub-mast__role">{role}</span> : null}
          </span>
        ) : null}
        <button
          type="button"
          className="hub-mast__out"
          disabled={signingOut}
          onClick={() => {
            if (signingOut) return;
            setSigningOut(true);
            void signOut().finally(() => setSigningOut(false));
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}

function Rail({
  groups,
  active,
  verified,
}: {
  groups: [string, NavEntry[]][];
  active: NavEntry | undefined;
  /** `undefined` while the profile is in flight — no padlock on a guess. */
  verified: boolean | undefined;
}): React.JSX.Element {
  const counts = useVendorCounts();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        className="hub-rail-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="vendor-rail"
      >
        {open ? 'Close menu' : 'Menu'}
      </button>
      <aside id="vendor-rail" aria-label="Vendor" className={cn('hub-rail', !open && 'max-[899px]:hidden')}>
        {groups.map(([group, entries]) => (
          <div key={group} className="contents">
            <div className="hub-rail__group">{group}</div>
            {entries.map((n) => {
              const badge = countFor(n, counts);
              const gated = verified === false && GATED_UNTIL_VERIFIED.has(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-current={n === active ? 'page' : undefined}
                  className="hub-rail__item"
                >
                  <span className="hub-rail__tile">
                    <RailIcon to={n.to} />
                  </span>
                  <span className="hub-rail__label">{n.label}</span>
                  {gated ? (
                    <span className="hub-rail__lock" title="Locked until your profile is verified">
                      <LockIcon />
                    </span>
                  ) : badge ? (
                    <span className={cn('hub-rail__count', badge.work && 'hub-rail__count--work')}>
                      {badge.text}
                    </span>
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

function VendorFooter(): React.JSX.Element {
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
          <h5 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">Office</h5>
          <address className="mt-2 font-mono text-[12px] not-italic leading-[1.7] text-ink-3">
            {office.line1}
            <br />
            {office.city}, {office.state} {office.pincode}
          </address>
          <a href={website} className="mt-2 inline-block font-mono text-[12px] text-ink-3 underline">
            {website}
          </a>
        </div>
        <div>
          <h5 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">Care</h5>
          <p className="mt-2 font-mono text-[12px] text-ink-3">{customerCare.email}</p>
          <p className="font-mono text-[12px] text-ink-3">{grievanceOfficer.email}</p>
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

export function VendorShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { principal } = useAuth();
  const { pathname } = useLocation();
  const { data: profile } = useResource<OrgProfile>('/api/account/profile', 'Profile');
  const { data: onboarding } = useResource<ResumableOnboarding>(
    '/api/onboarding/steps',
    'Onboarding',
  );

  const vendorEntries = principal
    ? NAV.filter((n) => n.surface === 'VENDOR' && canSee(n, principal))
    : [];
  // `rail: false` entries stay in NAV — `activeEntry` still highlights the item
  // a sub-route belongs under, and the command palette still finds them — but
  // the rail is ten places, not an index of every route.
  const groups = principal
    ? visibleGroups(principal)
        .filter(([, entries]) => entries.every((e) => e.surface === 'VENDOR'))
        .map(([group, entries]): [string, NavEntry[]] => [
          group,
          entries.filter((e) => e.rail !== false),
        ])
        .filter(([, entries]) => entries.length > 0)
    : [];
  const active = activeEntry(pathname, vendorEntries);

  return (
    <VendorCountsProvider>
      <VendorSurfaceSync />
      <div className="vendor-hub">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-5 focus:top-2 focus:z-40 focus:rounded focus:bg-acc focus:px-3 focus:py-2 focus:text-acc-on"
        >
          Skip to content
        </a>
        <Masthead profile={profile} />
        <ProfileBanner onboarding={onboarding ?? null} roles={principal?.roles ?? []} />
        <div className="hub-body">
          {groups.length > 0 ? (
            <Rail
              groups={groups}
              active={active}
              verified={profile ? profile.status === 'VERIFIED' : undefined}
            />
          ) : null}
          <main id="main" className="hub-main">
            {children}
          </main>
        </div>
        <VendorFooter />
      </div>
    </VendorCountsProvider>
  );
}
