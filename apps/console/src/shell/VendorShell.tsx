import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { cn, Mark } from '@trugrade/ui';
import { useAuth } from '../lib/auth';
import { VendorSurfaceSync } from '../lib/vendor-surface';
import { useResource } from '../lib/useResource';
import type { OrgProfile } from '../routes/vendor/profile-api';
import { VendorCountsProvider, useVendorCounts, type VendorCounts } from './useVendorCounts';
import { activeEntry, canSee, NAV, visibleGroups, type NavEntry } from './nav';
import './vendor-ledger.css';

function initials(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatLakhs(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const lakhs = n / 100_000;
  const rounded = lakhs >= 10 ? lakhs.toFixed(0) : lakhs.toFixed(1);
  return `₹${rounded.replace(/\.0$/, '')}L`;
}

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
    case '/vendor/payables':
      return counts.netDue ? { text: formatLakhs(counts.netDue), work: false } : null;
    case '/vendor/team':
      return counts.memberCount !== undefined && counts.memberCount > 0
        ? { text: String(counts.memberCount), work: false }
        : null;
    default:
      return null;
  }
}

function Masthead(): React.JSX.Element {
  const { principal, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: profile } = useResource<OrgProfile>('/api/account/profile', 'Profile');
  const [q, setQ] = React.useState('');
  const [signingOut, setSigningOut] = React.useState(false);

  const city = profile?.registeredAddress?.city;
  const legal = profile?.legalName ?? profile?.tradeName;
  const monogram = initials(principal?.fullName);

  return (
    <header className="vl-mast">
      <div className="vl-mast__util">
        <span className="vl-mast__portal">Truegrade supplier portal</span>
        <div className="vl-mast__meta">
          {legal ? <span className="vl-mast__meta-item hidden sm:inline">{legal}</span> : null}
          {city ? (
            <>
              <span className="vl-mast__dot hidden md:inline" aria-hidden="true">
                ·
              </span>
              <span className="hidden md:inline">{city}</span>
            </>
          ) : null}
          {principal?.fullName ? (
            <>
              <span className="vl-mast__dot hidden lg:inline" aria-hidden="true">
                ·
              </span>
              <span className="hidden lg:inline">{principal.fullName}</span>
            </>
          ) : null}
          <span className="vl-mast__dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className="vl-mast__out"
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
      </div>
      <div className="vl-mast__id">
        <Link to="/vendor" aria-label="Vendor home" className="vl-mast__brand">
          <Mark size={22} />
          <span className="vl-mast__wordmark">{BRAND.name}</span>
        </Link>
        <form
          className="vl-mast__search"
          onSubmit={(e) => {
            e.preventDefault();
            const next = q.trim();
            if (!next) return;
            void navigate(`/vendor/listings?q=${encodeURIComponent(next)}`);
          }}
        >
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search listings, POs, serials"
            aria-label="Search listings, POs, serials"
          />
        </form>
        <span aria-hidden="true" className="vl-mast__mono">
          {monogram || '—'}
        </span>
      </div>
      <div className="vl-mast__rule" aria-hidden="true" />
      <div className="vl-mast__rule vl-mast__rule--fine" aria-hidden="true" />
    </header>
  );
}

function Rail({
  groups,
  active,
}: {
  groups: [string, NavEntry[]][];
  active: NavEntry | undefined;
}): React.JSX.Element {
  const counts = useVendorCounts();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        className="vl-rail-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="vendor-rail"
      >
        {open ? 'Close menu' : 'Menu'}
      </button>
      <aside
        id="vendor-rail"
        aria-label="Vendor"
        className={cn('vl-rail', !open && 'max-[899px]:hidden')}
      >
        {groups.map(([group, entries], i) => (
          <div key={group}>
            <div className="vl-rail__group">
              <span className="vl-rail__n">{String(i + 1).padStart(2, '0')}</span>
              {group}
            </div>
            <nav>
              {entries.map((n) => {
                const badge = countFor(n, counts);
                const current = n === active;
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    aria-current={current ? 'page' : undefined}
                    className="vl-rail__item"
                  >
                    <span>{n.label}</span>
                    {badge ? (
                      <span className={cn('vl-rail__count', badge.work && 'vl-rail__count--work')}>
                        {badge.text}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
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
    <footer className="bg-chrome text-on-chrome">
      <div className="mx-auto grid max-w-[var(--maxw)] gap-6 px-8 py-6 md:grid-cols-3">
        <div>
          <span className="font-display text-[16px] font-semibold">{brandName}</span>
          <p className="mt-2 font-mono text-[11px] text-on-chrome-2">{legalName}</p>
        </div>
        <div>
          <h5 className="font-mono text-[10px] uppercase tracking-[0.14em] text-on-chrome-3">Office</h5>
          <address className="mt-2 font-mono text-[12px] not-italic leading-[1.7] text-on-chrome-2">
            {office.line1}
            <br />
            {office.city}, {office.state} {office.pincode}
          </address>
          <a href={website} className="mt-2 inline-block font-mono text-[12px] text-on-chrome-2 underline">
            {website}
          </a>
        </div>
        <div>
          <h5 className="font-mono text-[10px] uppercase tracking-[0.14em] text-on-chrome-3">Care</h5>
          <p className="mt-2 font-mono text-[12px] text-on-chrome-2">{customerCare.email}</p>
          <p className="font-mono text-[12px] text-on-chrome-2">{grievanceOfficer.email}</p>
        </div>
      </div>
      <div className="mx-auto max-w-[var(--maxw)] border-t border-chrome-line px-8 py-3 font-mono text-[11px] text-on-chrome-3">
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

  const vendorEntries = principal
    ? NAV.filter((n) => n.surface === 'VENDOR' && canSee(n, principal))
    : [];
  const groups = principal
    ? visibleGroups(principal).filter(([, entries]) => entries.every((e) => e.surface === 'VENDOR'))
    : [];
  const active = activeEntry(pathname, vendorEntries);

  return (
    <VendorCountsProvider>
      <VendorSurfaceSync />
      <div className="vendor-ledger">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-5 focus:top-2 focus:z-40 focus:bg-acc focus:px-3 focus:py-2 focus:text-acc-on"
        >
          Skip to content
        </a>
        <Masthead />
        <div className="vl-body">
          {groups.length > 0 ? <Rail groups={groups} active={active} /> : null}
          <main id="main" className="vl-main">
            {children}
          </main>
        </div>
        <VendorFooter />
      </div>
    </VendorCountsProvider>
  );
}
