import * as React from 'react';
import { RequirePermission } from '../../lib/auth';
import { VendorDashboardRoute } from './Dashboard';
import { VendorListingsRoute } from './Listings';
import { ListingUnitsRoute, UnitDetailRoute } from './Units';
import { BulkUploadRoute } from './BulkUpload';
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
  permission: 'listing.own.read' | 'listing.own.write';
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
    path: '/vendor/sku-request',
    permission: 'listing.own.write',
    element: guarded('listing.own.write', SkuRequestRoute),
  },
];

export default vendorRoutes;
