import * as React from 'react';
import { RequirePermission } from '../../lib/auth';
import { VendorDashboardRoute } from './Dashboard';
import { VendorListingsRoute } from './Listings';
import { ListingUnitsRoute, UnitDetailRoute } from './Units';
import { BulkUploadRoute } from './BulkUpload';
import { VendorCorrectionsRoute, VendorCorrectionDetailRoute } from './Corrections';
import { VendorPickListRoute } from './PickList';
import { VendorPurchaseOrderRoute } from './PurchaseOrder';
import { VendorPurchaseOrdersRoute } from './PurchaseOrders';
import { VendorPayablesRoute } from './Payables';
import { RepriceRoute } from './Reprice';
import { SkuRequestRoute } from './SkuRequest';
import { ListingWizardRoute } from './wizard/Wizard';

/**
 * The vendor portal's routes, as data.
 *
 * Exported as an array rather than rendered here because `App.tsx` is the
 * orchestrator's file — it wires every lane's routes at the end, and a lane that
 * edits it is a lane that conflicts with the other three.
 *
 * `element` already carries its `RequirePermission` guard. That is a
 * *convenience* and not a control: the API authorises every request
 * independently, because a guard in the browser is one breakpoint away from
 * irrelevant. What it buys is that a VENDOR_VIEWER never sees a screen full of
 * buttons that will all fail. `permission` is repeated as a field so the caller
 * can gate a nav entry on the same constant rather than a second copy of it.
 *
 * Order matters: `/vendor/listings/new` is listed before `/vendor/listings/:id`,
 * or "new" resolves as a listing id.
 */
export interface VendorRoute {
  path: string;
  /**
   * `procurement.po.read_own` joins the two listing permissions with T32.
   *
   * It is the permission the API already gates the purchase-order routes on and
   * every vendor role holds it, including VENDOR_VIEWER. Note what is NOT here:
   * `procurement.po.acknowledge`. Reading a purchase order and promising the
   * machines on it are different rights — VENDOR_FINANCE holds the first and not
   * the second — so the route is guarded by the read and the Accept button is
   * disabled with its reason on the record screen, the same shape T31 used for
   * answering a grade correction.
   */
  permission: 'listing.own.read' | 'listing.own.write' | 'procurement.po.read_own';
  element: React.ReactNode;
}

const guarded = (
  permission: VendorRoute['permission'],
  Component: () => React.JSX.Element,
): React.ReactNode =>
  React.createElement(RequirePermission, { permission, children: React.createElement(Component) });

export const vendorRoutes: VendorRoute[] = [
  {
    path: '/vendor',
    permission: 'listing.own.read',
    element: guarded('listing.own.read', VendorDashboardRoute),
  },
  {
    path: '/vendor/listings/new',
    permission: 'listing.own.write',
    element: guarded('listing.own.write', ListingWizardRoute),
  },
  {
    path: '/vendor/listings',
    permission: 'listing.own.read',
    element: guarded('listing.own.read', VendorListingsRoute),
  },
  {
    path: '/vendor/listings/:id',
    permission: 'listing.own.read',
    element: guarded('listing.own.read', ListingUnitsRoute),
  },
  {
    path: '/vendor/listings/:id/reprice',
    permission: 'listing.own.write',
    element: guarded('listing.own.write', RepriceRoute),
  },
  {
    path: '/vendor/listings/:id/bulk-upload',
    permission: 'listing.own.write',
    element: guarded('listing.own.write', BulkUploadRoute),
  },
  {
    path: '/vendor/listings/:id/units/:unitId',
    permission: 'listing.own.read',
    element: guarded('listing.own.read', UnitDetailRoute),
  },
  {
    path: '/vendor/corrections',
    permission: 'listing.own.read',
    element: guarded('listing.own.read', VendorCorrectionsRoute),
  },
  {
    // Reading a correction is reading your own stock; ANSWERING one needs
    // `listing.grade_correction.respond`, which VENDOR_FINANCE and VENDOR_VIEWER
    // do not hold. The guard here is the read, and the API refuses the write —
    // a viewer sees the record and the panel tells them it is not theirs to send.
    path: '/vendor/corrections/:id',
    permission: 'listing.own.read',
    element: guarded('listing.own.read', VendorCorrectionDetailRoute),
  },
  {
    path: '/vendor/orders',
    permission: 'procurement.po.read_own',
    element: guarded('procurement.po.read_own', VendorPurchaseOrdersRoute),
  },
  {
    path: '/vendor/orders/:poId',
    permission: 'procurement.po.read_own',
    element: guarded('procurement.po.read_own', VendorPurchaseOrderRoute),
  },
  {
    path: '/vendor/orders/:poId/pick-list',
    permission: 'procurement.po.read_own',
    element: guarded('procurement.po.read_own', VendorPickListRoute),
  },
  {
    // Guarded by the permission the API actually checks. The payables screen
    // is §3B.4's FINANCE/OWNER screen; there is no payable permission in
    // ROLE_PERMISSIONS to gate it on, so it rides on the purchase order's read
    // whose money it restates. Recorded in the ledger as a deviation.
    path: '/vendor/payables',
    permission: 'procurement.po.read_own',
    element: guarded('procurement.po.read_own', VendorPayablesRoute),
  },
  {
    path: '/vendor/sku-request',
    permission: 'listing.own.write',
    element: guarded('listing.own.write', SkuRequestRoute),
  },
];

export default vendorRoutes;
