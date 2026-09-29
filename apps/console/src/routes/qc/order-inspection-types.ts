/**
 * The shapes `GET /api/qc/order-inspections*` returns, copied field for field
 * from `OrderInspectionService`. Copied rather than imported: the console may
 * not import the API, and a hand-written mirror is what keeps a field the API
 * grows from arriving on a screen by accident.
 */

export interface OrderInspectionSlot {
  slotId: string;
  title: string | null;
  specSummary: string | null;
  grade: string;
  serialNumber: string | null;
  inspectedAt: string | null;
  verifiedAt: string | null;
}

export interface OrderInspectionView {
  visitId: string;
  visitNumber: string;
  status: string;
  orderNumber: string;
  vendorLegalName: string | null;
  site: { line1: string; city: string; pincode: string } | null;
  technicianId: string | null;
  technicianName: string | null;
  assignedAt: string | null;
  assignedByName: string | null;
  scheduledDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  purchaseOrderNumber: string | null;
  unitsRequested: number;
  unitsInspected: number;
  slots: OrderInspectionSlot[];
}
