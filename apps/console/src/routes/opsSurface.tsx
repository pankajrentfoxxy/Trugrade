import * as React from 'react';
import type { Permission } from '@trugrade/contracts';
import Shipments from './fulfilment/Shipments';
import Pickups from './fulfilment/Pickups';
import Riders from './fulfilment/Riders';
import Carriers from './fulfilment/Carriers';
import Ndr from './fulfilment/Ndr';
import PurchaseOrders from './fulfilment/PurchaseOrders';
import Payables from './finance/Payables';
import Payouts from './finance/Payouts';
import Escrow from './finance/Escrow';
import Credit from './demand/Credit';
import Automation from './platform/Automation';
import Approvals from './platform/Approvals';
import Inspections from './supply/Inspections';

/**
 * The screens Stage 8 adds, as data.
 *
 * Same shape as `platformRoutes` and `qcRoutes`, and for the same reason: a lane
 * that hand-edits `App.tsx` is a lane that conflicts with the other three. The
 * elements come back bare — guarding and chroming them is the shell's business.
 *
 * `permission` restates what the API actually checks. Two entries in this
 * console have already been gated on strings that are not in
 * `ROLE_PERMISSIONS` at all, which made the screens behind them invisible to
 * every account ever issued; that is what this duplication is buying.
 */
export interface OpsSurfaceRoute {
  path: string;
  permission: Permission;
  element: React.ReactElement;
}

export const opsSurfaceRoutes: readonly OpsSurfaceRoute[] = [
  // Fulfilment. `/procurement/pos` keeps its path: it is a link people have
  // bookmarked, and the board behind it is what changed, not its address.
  {
    path: '/procurement/pos',
    permission: 'procurement.po.read_any',
    element: <PurchaseOrders />,
  },
  { path: '/fulfilment/shipments', permission: 'logistics.shipment.read', element: <Shipments /> },
  { path: '/fulfilment/pickups', permission: 'logistics.shipment.read', element: <Pickups /> },
  { path: '/fulfilment/riders', permission: 'logistics.rider.manage', element: <Riders /> },
  { path: '/fulfilment/carriers', permission: 'logistics.shipment.read', element: <Carriers /> },
  { path: '/fulfilment/ndr', permission: 'logistics.ndr.action', element: <Ndr /> },

  // Finance.
  {
    path: '/finance/payables',
    permission: 'procurement.payable.read_any',
    element: <Payables />,
  },
  { path: '/finance/payouts', permission: 'procurement.po.read_any', element: <Payouts /> },
  { path: '/finance/escrow', permission: 'finance.escrow.read', element: <Escrow /> },

  // Demand.
  { path: '/demand/credit', permission: 'credit.limit.read', element: <Credit /> },

  // Supply — the inspection queue between a vendor's submit and a live listing.
  { path: '/supply/inspections', permission: 'qc.visit.read', element: <Inspections /> },

  // Platform.
  { path: '/platform/automation', permission: 'automation.rule.read', element: <Automation /> },
  { path: '/platform/approvals', permission: 'identity.audit.read', element: <Approvals /> },
];
