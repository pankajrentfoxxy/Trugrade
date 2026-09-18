import * as React from 'react';
import { Link, useLocation } from 'react-router';
import { cn, Logo } from '@trugrade/ui';
import { useAuth } from '../lib/auth';
import { AccountMenu } from './AccountMenu';
import { OpsShell } from './OpsShell';
import { CommandPalette } from './CommandPalette';
import { activeEntry, visibleGroups, type NavEntry } from './nav';

/**
 * The console frame. Not an archetype — it is the chrome every archetype hangs
 * in, and the reason no route carries a layout of its own.
 *
 * Three rules from `09_FRONTEND_LOCKED.md` shape it and none of them are
 * negotiable:
 *   - The top bar and the footer are `--chrome` in BOTH themes. The dark chrome
 *     is the brand; only the working surfaces between them flip.
 *   - Amber is a primary action, a measured value or an active state. Here it is
 *     only ever the third.
 *   - Density is a property of the *app*, not of a table: admin screens are
 *     compact, the vendor portal is default, and `data-density` on the root is
 *     how `DataTable` and the token layer both find out.
 */

/** The dark band. Identical in both themes — that is the point of it. */
function TopBar({
  groups,
  activeGroup,
}: {
  groups: [string, NavEntry[]][];
  activeGroup: string | undefined;
}): React.JSX.Element {
  const { principal } = useAuth();
  // Vendors navigate in the section rail; repeating the group name in the top bar
  // is a second door to the same place.
  const sectionTabs = groups.filter(([, entries]) => entries.every((entry) => entry.surface !== 'VENDOR'));

  return (
    <header className="tg-chrome sticky top-0 z-30 border-b border-chrome-line">
      <div className="mx-auto flex h-[62px] max-w-container items-center gap-3 px-5">
        {/*
          `Wordmark` paints "tru" with --ink, which is near-black under the light
          theme and therefore invisible on the chrome band. `.tg-brandlock`
          rebinds that one token for the lockup rather than forking the component
          — one wordmark, still one source of the brand string.
        */}
        <Link to="/" aria-label="Console home" className="tg-brandlock shrink-0">
          <Logo size={26} />
        </Link>

        {/*
          T35. §3C: the palette is the primary navigation for experienced ops
          staff and the rail is the discoverable fallback — so it sits in the
          chrome and is reachable with Ctrl+K from every screen. It renders
          nothing without a principal.
        */}
        <CommandPalette />

        {sectionTabs.length > 0 ? (
          <nav aria-label="Sections" className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {sectionTabs.map(([group, entries]) => (
              <Link
                key={group}
                to={entries[0]?.to ?? '/'}
                aria-current={group === activeGroup ? 'true' : undefined}
                className={cn(
                  'flex h-[38px] shrink-0 items-center rounded px-3 text-body-sm transition-colors',
                  group === activeGroup
                    ? 'bg-chrome-2 text-acc'
                    : 'text-on-chrome-2 hover:bg-chrome-2 hover:text-on-chrome',
                )}
              >
                {group}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {principal ? <AccountMenu fullName={principal.fullName} /> : null}
        </div>
      </div>
    </header>
  );
}

/**
 * The section rail: the screens inside the section the top bar has you in.
 *
 * The two do not duplicate each other — the bar switches section, the rail moves
 * inside one. Under 900px it stops being a rail at all and becomes a scrolling
 * strip above the work.
 */
function SectionRail({
  group,
  entries,
  active,
}: {
  group: string;
  entries: NavEntry[];
  active: NavEntry | undefined;
}): React.JSX.Element {
  return (
    <aside
      id="section-rail"
      aria-label={group}
      className={cn(
        'w-[212px] shrink-0 self-start overflow-hidden rounded-lg border border-rule bg-sheet',
        'max-[900px]:w-full max-[900px]:self-stretch',
      )}
    >
      <div className="border-b border-rule bg-sheet-2 px-3 py-2 max-[900px]:hidden">
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{group}</span>
      </div>
      <nav className="flex flex-col gap-1 p-2 max-[900px]:flex-row max-[900px]:overflow-x-auto">
        {entries.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            title={n.label}
            aria-current={n === active ? 'page' : undefined}
            className={cn(
              'flex items-center whitespace-nowrap rounded px-3 py-2 text-body-sm transition-colors',
              n === active ? 'bg-acc-wash text-acc-ink' : 'text-ink-2 hover:bg-sheet-2 hover:text-ink',
            )}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

/**
 * The admin frame.
 *
 * Platform staff get `OpsShell` — seven domains, a tab strip and a record
 * drawer. The delegation happens here rather than at each of the twenty route
 * definitions, so adding a screen does not mean choosing a frame, and the
 * vendor-facing paths that still reach this component keep the old chrome.
 */
export function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { principal } = useAuth();
  const { pathname } = useLocation();

  if (principal?.orgType === 'PLATFORM' && !pathname.startsWith('/vendor')) {
    return <OpsShell>{children}</OpsShell>;
  }

  const groups = principal ? visibleGroups(principal) : [];
  const visible = groups.flatMap(([, entries]) => entries);
  const active = activeEntry(pathname, visible);
  // A URL with no nav entry behind it — a QC visit detail reached from a link,
  // say — still belongs to a section, and falling back to the first one keeps
  // the rail populated instead of blank.
  const section = groups.find(([group]) => group === active?.group) ?? groups[0];

  /**
   * Admin screens are dense boards; the vendor portal is not. One attribute on
   * the app root, read by every `tg-cell` / `tg-card` below it — there is no
   * second table component and no per-screen override.
   */
  const density = pathname.startsWith('/vendor') ? 'default' : 'compact';

  return (
    <div data-density={density} className="flex min-h-screen flex-col bg-ground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-5 focus:top-2 focus:z-40 focus:rounded focus:bg-acc focus:px-3 focus:py-2 focus:text-body-sm focus:text-acc-on"
      >
        Skip to content
      </a>
      <TopBar groups={groups} activeGroup={section?.[0]} />
      <div className="mx-auto flex w-full max-w-container gap-5 px-5 py-5 max-[900px]:flex-col max-[900px]:gap-3">
        {section ? (
          <SectionRail group={section[0]} entries={section[1]} active={active} />
        ) : null}
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
