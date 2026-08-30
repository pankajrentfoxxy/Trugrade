'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The customer portal's own navigation.
 *
 * Until T25 the account area had four routes and no way to move between them:
 * `/account/orders` was reachable from a dashboard tile, and `/account/addresses`,
 * `/account/team` and `/account/approvals` would have been reachable from
 * nowhere at all. A screen nothing links to is not finished, which is the same
 * rule that made T19 build `/account` in the first place — the header's Account
 * button led to a 404 for four waves.
 *
 * **Only routes that exist are listed.** A link to `/account/invoices` before it
 * is built is a control that leads to a 404, and telling somebody a thing is
 * there when it is not is the same defect as a missing measurement drawn as a
 * tick. A task that adds an account route adds its line here and gets the nav.
 *
 * `<nav>` of links rather than `packages/ui`'s `Tabs`, for the reason `OrderNav`
 * gives: that component owns a selected key and renders panels, which is right
 * for panels in one page and wrong for addressable URLs. The router owns this
 * selection and `aria-current` says so.
 */

const TABS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/account', label: 'Today' },
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/approvals', label: 'Approvals' },
  { href: '/account/warranty', label: 'Warranty' },
  { href: '/account/addresses', label: 'Addresses' },
  { href: '/account/team', label: 'Team' },
];

export function AccountNav(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav className="rectabs acctabs" aria-label="Your account">
      {TABS.map((tab) => {
        // Exact for the dashboard, prefix for the rest: a sub-route like
        // `/account/orders/TT-26-00004/units` still belongs to Orders, but
        // `/account` is a prefix of every one of them.
        const current =
          tab.href === '/account' ? pathname === '/account' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href as Route}
            className={current ? 'rectab on' : 'rectab'}
            aria-current={current ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
