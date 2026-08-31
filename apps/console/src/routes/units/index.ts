import * as React from 'react';
import type { Permission } from '@trugrade/contracts';
import type { ConsoleRoute } from '../qc';
import { Unit360Route } from './Unit360';

/**
 * The unit 360 — T35.
 *
 * A plain array, as `routes/qc` and `routes/ops` do it, so the app shell keeps
 * deciding how a route is wrapped.
 *
 * **No `label`, deliberately.** This screen is reached from the command palette
 * or from a serial on another board, and a navigation link to a record with no
 * identifier is a link to nowhere — the same reason the order record and the QC
 * visit detail stay out of the rail.
 *
 * `listing.any.read` is the permission `GET /api/ops/units/:serial` actually
 * checks, and it is an `*.any.*` — which by the convention `roles.ts` documents
 * no vendor or buyer role holds. The server refuses any principal outside the
 * platform's own organisation on top of that, because `listing.any.read` reaches
 * TECHNICIAN and CATALOG_ADMIN and the permission alone is not the whole rule.
 */
export const unitRoutes: ConsoleRoute[] = [
  {
    path: '/units/:serial',
    element: React.createElement(Unit360Route),
    permission: 'listing.any.read' satisfies Permission,
  },
];

export { Unit360Route };
