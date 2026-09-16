/**
 * The fulfilment boards' row shapes, mirroring
 * `apps/api/src/modules/logistics/internal/fulfilment-board.service.ts`.
 *
 * Declared rather than inferred because the console and the API are separate
 * builds: a field the server stops sending has to fail the type check here, not
 * render as `undefined` in a cell.
 */

export const FULFILMENT_API = {
  shipments: '/api/ops/shipments',
  pickups: '/api/ops/pickups',
  riders: '/api/ops/riders',
  carriers: '/api/ops/carriers',
  ndr: '/api/ops/ndr',
  dispatch: (poNumber: string) =>
    `/api/ops/purchase-orders/${encodeURIComponent(poNumber)}/dispatch`,
  dispatchBulk: '/api/ops/purchase-orders/dispatch',
} as const;

export interface ShipmentRow {
  id: string;
  awb: string | null;
  leg: string;
  status: string;
  carrier: string | null;
  mode: string | null;
  subOrderId: string;
  orderNumber: string | null;
  boxes: number;
  declaredValue: string;
  quotedFreight: string | null;
  freightCost: string | null;
  sealId: string | null;
  sealVerifiedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  etaFrom: string | null;
  createdAt: string;
}

export interface PickupRow {
  id: string;
  subOrderId: string;
  supplyPoint: string | null;
  status: string;
  riderId: string | null;
  riderName: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  expected: number;
  scanned: number;
  sealsIntact: boolean | null;
  brokenSeals: string[];
  completedAt: string | null;
}

export interface RiderRow {
  id: string;
  userId: string | null;
  name: string | null;
  phone: string;
  zone: string | null;
  vehicleType: string | null;
  isActive: boolean;
  openPickups: number;
  openDeliveries: number;
}

export interface CarrierRow {
  id: string;
  code: string;
  name: string;
  adapterKey: string;
  supportsLeg: string[];
  isActive: boolean;
  priority: number;
  live: boolean;
  shipments: number;
  delivered: number;
  onTimePct: number | null;
  avgDays: number | null;
}

export interface NdrRow {
  id: string;
  deliveryTaskId: string;
  shipmentId: string | null;
  awb: string | null;
  carrier: string | null;
  attemptNo: number;
  attemptedAt: string;
  outcome: string;
  reason: string | null;
  nextAttemptOn: string | null;
  legalActions: string[];
}

export interface DispatchResult {
  poNumber: string;
  awb: string | null;
  carrier: string;
  freight: string;
  alreadyBooked: boolean;
  error: string | null;
}

/** `₹1,24,500`. No paise: a freight quote to the rupee is false precision. */
export const inr = (value: string | number | null | undefined): string =>
  value === null || value === undefined || value === ''
    ? '—'
    : new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(Number(value));

/** `12 Sep, 14:30`. Dates on a board are for ordering, not for filing. */
export const when = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** `12 Sep`. */
export const day = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
