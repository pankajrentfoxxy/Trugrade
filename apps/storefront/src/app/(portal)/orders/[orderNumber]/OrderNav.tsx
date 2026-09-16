'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePortal } from '../../shell/PortalContext';

/**
 * The sub-navigation for one order record.
 *
 * `03_UX_SPEC.md` §3A.3 gives the order four sub-routes — `/units`,
 * `/documents`, `/tracking`, `/delivery` — hanging off `/orders/[id]`.
 * This lives in the record's **layout**, so the affordance is established once
 * and every sub-route inherits it rather than each one growing its own header.
 *
 * **Only routes that exist are listed.** A tab for `/documents` before T22 has
 * built it is a control that leads to a 404, which is the same defect as a
 * missing measurement drawn as a tick: it tells the buyer something is there.
 * A task that adds a sub-route adds its line to `TABS` and gets the nav for
 * free.
 *
 * A `<nav>` of links rather than `packages/ui`'s `Tabs`: that component owns a
 * selected key and renders the panels itself, which is right for panels inside
 * one page and wrong for four addressable URLs. The router owns this selection,
 * and `aria-current="page"` is what says so.
 */

interface OrderTab {
  /** Appended to the record's own path. Empty string is the record itself. */
  segment: string;
  label: string;
}

interface OrderTabDef extends OrderTab {
  /** What a seat needs to open it. Absent means anyone who can read the order. */
  permission?: string;
}

const TABS: readonly OrderTabDef[] = [
  { segment: '', label: 'Order' },
  { segment: '/units', label: 'Machines' },
  // GET /buyer/orders/:n/documents checks `payment.invoice.read_own`, which an
  // approver and a viewer do not hold. The tab used to render for them and 403.
  { segment: '/documents', label: 'Documents', permission: 'payment.invoice.read_own' },
  { segment: '/delivery', label: 'Delivery check' },
];

export function OrderNav({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  const pathname = usePathname();
  const { session } = usePortal();
  const base = `/orders/${encodeURIComponent(orderNumber)}`;
  // A tab that would 403 is absent rather than dimmed: unlike a rail entry, a
  // tab strip is a set of views of one record, and a locked view of a record
  // you are already reading says nothing a reader can act on.
  const tabs = TABS.filter((t) => !t.permission || session.permissions.includes(t.permission));

  return (
    <nav className="rectabs" aria-label={`Order ${orderNumber}`}>
      {tabs.map((tab) => {
        const href = `${base}${tab.segment}`;
        // Exact match, not `startsWith`: `/units` is under the record's path, so
        // a prefix test would mark the record itself current on every sub-route.
        const current = pathname === href;
        return (
          <Link
            key={tab.segment || 'record'}
            href={href as Route}
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
