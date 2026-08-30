import * as React from 'react';
import type { Permission } from '@trugrade/contracts';
import type { ConsoleRoute } from '../qc';
import { OpsOrderBoardRoute } from './OrderBoard';
import { OpsOrderRecordRoute } from './OrderRecord';
import { OpsPurchaseOrderBoardRoute } from './PurchaseOrderBoard';

/**
 * The platform's order and procurement boards — T39.
 *
 * A plain array, as `routes/qc` does it, so the app shell keeps deciding how a
 * route is wrapped: `RequirePermission` and `Shell` are its business. `label` is
 * present only on the two entries that belong in the rail, which is why the
 * order record omits it — it is reached from a row, and a navigation link to a
 * record with no id is a link to nowhere.
 *
 * **Each `permission` is the one the API actually checks.** `ordering.any.read`
 * guards `GET /api/ops/orders` and `procurement.po.read_any` guards
 * `GET /api/ops/purchase-orders`, and a link gated on anything else is how a
 * rail comes to offer a screen that 403s — two entries in this console were dead
 * for exactly that reason before T34. `ConsoleRoute.permission` is the closed
 * union out of `@trugrade/contracts`, so a string that is not a real permission
 * is a compile error rather than a screen nobody can reach.
 *
 * Both are `*.any.*`, which by the convention documented in `roles.ts` no vendor
 * or buyer role holds — so these two entries need no `orgType` guard of their
 * own. The nav entries carry one anyway, because a rail is cheap to be sure
 * about and the permission is the boundary the server enforces.
 */
export const opsRoutes: ConsoleRoute[] = [
  {
    path: '/orders',
    element: React.createElement(OpsOrderBoardRoute),
    permission: 'ordering.any.read' satisfies Permission,
    label: 'Orders',
  },
  {
    path: '/orders/:orderNumber',
    element: React.createElement(OpsOrderRecordRoute),
    permission: 'ordering.any.read' satisfies Permission,
  },
  {
    path: '/procurement/pos',
    element: React.createElement(OpsPurchaseOrderBoardRoute),
    permission: 'procurement.po.read_any' satisfies Permission,
    label: 'Purchase orders',
  },
];

export { OpsOrderBoardRoute, OpsOrderRecordRoute, OpsPurchaseOrderBoardRoute };
