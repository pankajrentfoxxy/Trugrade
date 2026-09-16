import * as React from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';
import { AccountMenu } from './AccountMenu';
import { CommandPalette } from './CommandPalette';
import { OPS_HOME, activeTab, visibleDomains, type OpsDomain } from './domains';
import { useOpsCounts } from './useOpsCounts';

/**
 * The internal console frame.
 *
 * Four fixed regions, and **the page is the only thing that scrolls**:
 *
 *     ┌─ rail 236 ─┬─ top bar 54 ───────────────────────┐
 *     │ brand      │ breadcrumb   search ⌘K   account   │
 *     │            ├─ tab strip 42 ─────────────────────┤
 *     │ 7 domains  │ tabs for the current domain        │
 *     │ + counts   ├────────────────────────────────────┤
 *     │            │ page — the only scroll container   │
 *     └────────────┴────────────────────────────────────┘
 *
 * The admin `Shell` scrolls the document, which means a sticky table header
 * competes with a sticky top bar and both fight the footer. Here the rail and
 * the two bars are out of the flow entirely, so a board's header can stick to
 * the top of its own scroller and stay there.
 *
 * **The rail is near-black.** Not a theme choice: it separates chrome from
 * content so the eye lands on the data, and it makes internal tooling look
 * unmistakably unlike anything a vendor or a customer sees — which matters the
 * moment somebody screen-shares.
 *
 * Below 1040px the rail collapses to 64px of icons; below 720px the tab strip
 * scrolls sideways and the top bar keeps three controls. Nothing at any width
 * scrolls the page horizontally.
 */
export function OpsShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { principal } = useAuth();
  const { pathname } = useLocation();
  const counts = useOpsCounts();

  const domains = React.useMemo(() => visibleDomains(principal), [principal]);
  const active = activeTab(pathname, domains);
  const domain = active?.domain ?? domains[0];

  // One attribute on the app root, read by every tg-cell below it. Admin work
  // is dense; there is no per-screen override and no density prop anywhere.
  return (
    <div data-surface="ops" data-density="compact" className="flex h-dvh w-full overflow-hidden bg-ground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-acc focus:px-3 focus:py-2 focus:text-body-sm focus:text-acc-on"
      >
        Skip to content
      </a>

      <Rail domains={domains} activeKey={domain?.key} counts={counts} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-chrome-line bg-chrome px-4">
          <nav aria-label="Breadcrumb" className="min-w-0 truncate text-body-sm text-on-chrome-2">
            {domain ? (
              <>
                <span className="text-on-chrome">{domain.label}</span>
                {active && <span className="px-2 text-on-chrome-2">/</span>}
                {active && <span className="text-on-chrome-2">{active.tab.label}</span>}
              </>
            ) : (
              <span className="text-on-chrome">Today</span>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <CommandPalette />
            <AccountMenu fullName={principal?.fullName ?? null} />
          </div>
        </header>

        {domain && domain.tabs.length > 0 && (
          <nav
            aria-label={`${domain.label} sections`}
            className="flex h-[42px] shrink-0 items-stretch gap-1 overflow-x-auto border-b border-rule bg-sheet px-3"
          >
            {domain.tabs.map((tab) => {
              const on = active?.tab.to === tab.to;
              const count = tab.countKey ? counts[tab.countKey] : undefined;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  aria-current={on ? 'page' : undefined}
                  className={`flex shrink-0 items-center gap-2 border-b-2 px-3 text-body-sm ${
                    on
                      ? 'border-acc text-acc-ink'
                      : 'border-transparent text-ink-2 hover:text-ink'
                  }`}
                >
                  {tab.label}
                  {count !== undefined && count > 0 && (
                    <span className="mono tnum text-caption text-ink-3">{count}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}

        {/* The only scroll container in the app. */}
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-container px-5 py-5">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Rail({
  domains,
  activeKey,
  counts,
}: {
  domains: readonly OpsDomain[];
  activeKey?: string;
  counts: Record<string, number>;
}): React.JSX.Element {
  return (
    <nav
      aria-label="Domains"
      className="flex w-[236px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-chrome-line bg-chrome px-3 py-3 max-[1040px]:w-16 max-[1040px]:px-1"
    >
      <Link
        to={OPS_HOME.to}
        className="mb-2 flex items-center gap-2 rounded px-2 py-2 text-on-chrome hover:bg-chrome-2"
      >
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded bg-brand-tint text-caption font-semibold text-chrome"
        >
          TG
        </span>
        <span className="text-body-sm font-medium max-[1040px]:sr-only">Trugrade ops</span>
      </Link>

      {domains.map((domain) => {
        const on = domain.key === activeKey;
        // The domain's count is the sum of its tabs', so a collapsed rail still
        // says where the work is.
        const total = domain.tabs.reduce(
          (sum, tab) => sum + (tab.countKey ? (counts[tab.countKey] ?? 0) : 0),
          0,
        );
        const first = domain.tabs[0];
        if (!first) return null;
        return (
          <Link
            key={domain.key}
            to={first.to}
            aria-current={on ? 'page' : undefined}
            title={domain.label}
            className={`flex items-center gap-2 rounded px-2 py-2 text-body-sm max-[1040px]:justify-center ${
              on
                ? 'bg-chrome-2 text-on-chrome'
                : 'text-on-chrome-2 hover:bg-chrome-2 hover:text-on-chrome'
            }`}
          >
            <span
              aria-hidden="true"
              className={`grid size-6 shrink-0 place-items-center rounded text-caption font-semibold ${
                on ? 'bg-brand-tint text-chrome' : 'bg-chrome-3 text-on-chrome-2'
              }`}
            >
              {domain.label.slice(0, 2).toUpperCase()}
            </span>
            <span className="truncate max-[1040px]:sr-only">{domain.label}</span>
            {total > 0 && (
              <span className="mono tnum ml-auto text-caption text-on-chrome-2 max-[1040px]:sr-only">
                {total}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
