import * as React from 'react';
import { Link, useLocation } from 'react-router';
import { cn } from '@trugrade/ui';
import { useAuth, type Principal } from '../lib/auth';
import { roleLabel } from '../lib/roles';
import { OpsSurfaceSync } from '../lib/ops-surface';
import { CommandPalette } from './CommandPalette';
import { OPS_HOME, activeTab, visibleDomains, type OpsDomain, type OpsTab } from './domains';
import { useOpsCounts } from './useOpsCounts';
import { DomainIcon } from './rail-icons';
import './vendor-hub.css';

/**
 * The internal console frame, drawn against the same `hub-*` template as
 * `VendorShell` — white masthead, icon rail, `hub-main` page container — so an
 * admin screen and a vendor screen read as the same product wearing different
 * badges rather than two different tools bolted together.
 *
 * The rail stays at domain grain — seven rows, one per domain, the shape it
 * had before this pass and the shape `domains.ts` was written to keep: "the
 * rail is places and the tabs are places" is about what the RAIL holds, not
 * about hiding tabs altogether. A tab strip under the masthead, sticky over
 * the page, carries the current domain's places instead — same job the
 * breadcrumb-plus-tab-strip pair did, redrawn in the hub's own materials.
 *
 * **Typeface: IBM Plex Sans/Mono, admin only.** A supplied design for `/kyc`
 * set these rather than the product's own Lato; since this component is the
 * one frame every admin screen renders inside (platform staff, not on
 * `/vendor`), the override lives here once instead of being repeated per
 * route. `VendorShell` and the storefront are untouched — this component
 * never renders for either. `--font-mono` is reset alongside `--font-sans`
 * because every `font-mono`/`tnum` class already in this codebase (`KpiRow`,
 * every serial and price column) resolves through that one variable.
 */
function initials(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function seatRole(principal: Principal | null | undefined): string | null {
  const code = principal?.roles?.[0];
  return code ? roleLabel(code) : null;
}

function Masthead({ principal }: { principal: Principal | null }): React.JSX.Element {
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = React.useState(false);
  const monogram = initials(principal?.fullName);
  const role = seatRole(principal);

  return (
    <header className="hub-mast">
      <Link to={OPS_HOME.to} aria-label="Ops console home" className="hub-mast__brand">
        <span className="hub-mast__tile" aria-hidden="true">
          t
        </span>
        <span className="hub-mast__names">
          <span className="hub-mast__wordmark">
            tru<em>grade</em>
          </span>
          <span className="hub-mast__portal">Ops console</span>
        </span>
      </Link>

      <CommandPalette variant="hub" />

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
  domains,
  active,
  counts,
}: {
  domains: readonly OpsDomain[];
  active: { domain: OpsDomain; tab: OpsTab } | null;
  counts: Record<string, number>;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        className="hub-rail-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="ops-rail"
      >
        {open ? 'Close menu' : 'Menu'}
      </button>
      <aside
        id="ops-rail"
        aria-label="Domains"
        className={cn('hub-rail', !open && 'max-[899px]:hidden')}
      >
        {domains.map((domain) => {
          const first = domain.tabs[0];
          if (!first) return null;
          // The domain's count is the sum of its tabs' — a collapsed rail
          // still says where the work is without opening every tab.
          const total = domain.tabs.reduce(
            (sum, tab) => sum + (tab.countKey ? (counts[tab.countKey] ?? 0) : 0),
            0,
          );
          return (
            <Link
              key={domain.key}
              to={first.to}
              aria-current={active?.domain.key === domain.key ? 'page' : undefined}
              className="hub-rail__item"
            >
              <span className="hub-rail__tile">
                <DomainIcon domainKey={domain.key} />
              </span>
              <span className="hub-rail__label">{domain.label}</span>
              {total > 0 ? <span className="hub-rail__count">{total}</span> : null}
            </Link>
          );
        })}
      </aside>
    </>
  );
}

/** The current domain's places, sticky under the masthead over the page. */
function TabStrip({
  domain,
  active,
  counts,
}: {
  domain: OpsDomain | undefined;
  active: { domain: OpsDomain; tab: OpsTab } | null;
  counts: Record<string, number>;
}): React.JSX.Element | null {
  if (!domain || domain.tabs.length === 0) return null;
  return (
    <nav aria-label={`${domain.label} sections`} className="hub-tabs">
      {domain.tabs.map((tab) => {
        const count = tab.countKey ? counts[tab.countKey] : undefined;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active?.tab.to === tab.to ? 'page' : undefined}
            className="hub-tabs__item"
          >
            {tab.label}
            {count !== undefined && count > 0 ? (
              <span className="hub-tabs__count">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function OpsShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { principal } = useAuth();
  const { pathname } = useLocation();
  const counts = useOpsCounts();

  const domains = React.useMemo(() => visibleDomains(principal), [principal]);
  const active = activeTab(pathname, domains);
  // A URL with no tab behind it still belongs to a domain, and falling back to
  // the first one keeps the tab strip populated instead of blank.
  const domain = active?.domain ?? domains[0];

  return (
    <div
      className="vendor-hub"
      style={
        {
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          '--font-mono': "'IBM Plex Mono', ui-monospace, monospace",
        } as React.CSSProperties
      }
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <OpsSurfaceSync />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-acc focus:px-3 focus:py-2 focus:text-body-sm focus:text-acc-on"
      >
        Skip to content
      </a>

      <Masthead principal={principal} />

      <div className="hub-body">
        {domains.length > 0 ? <Rail domains={domains} active={active} counts={counts} /> : null}
        <div className="hub-main-col">
          <TabStrip domain={domain} active={active} counts={counts} />
          <main id="main" className="hub-main">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
