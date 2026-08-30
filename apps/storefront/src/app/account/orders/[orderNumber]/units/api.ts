/**
 * The browser half of one order's machines — `GET /api/buyer/orders/:orderNumber/units`,
 * through the same-origin rewrite so the `httpOnly` refresh cookie stays
 * first-party.
 *
 * **The types below are the server's response types, copied field for field**
 * from `OrderUnitsService`
 * (`apps/api/src/modules/ordering/internal/order-units.service.ts`). They are
 * copied rather than imported because the storefront may not import the API —
 * and they are allow-lists on that side, which is what guarantees there is no
 * vendor identifier here to render. Nothing in this file widens them.
 *
 * Every measurement is nullable and stays nullable. A screen made of
 * measurements is exactly where `number | null` gets quietly narrowed to
 * `number` with a `?? 0`, and a battery that was never read would then draw as a
 * flat one.
 */
import { call, type ApiResult } from '../../../../register/api';

/** The four things a DeviceSure run can conclude. */
export type QcVerdict = 'PASS' | 'PASS_WITH_NOTE' | 'MISMATCH' | 'FAIL';

export interface OrderedUnit {
  serialNumber: string;
  /** Null when the SKU has been withdrawn since. Never an invented title. */
  title: string | null;
  specSummary: string | null;
  /** What the order line was priced at — the commercial fact. `A_PLUS`|`A`|`B`. */
  gradeOrdered: string;
  /** `qc_report.grade_final` — what the inspection concluded. Null if none. */
  gradeActual: string | null;
  unitPrice: string;
  verdict: QcVerdict | null;
  qcScore: number | null;
  /** Null means NOT MEASURED. It is never rendered as a number. */
  batteryHealthPct: number | null;
  /** `YYYY-MM-DD`. */
  inspectedOn: string | null;
  seal: { code: string; status: string } | null;
  passportPath: string;
}

export interface OrderUnits {
  orderNumber: string;
  status: string;
  placedAt: string;
  units: OrderedUnit[];
}

/** One order's machines, scoped to the reader's organisation by the API. */
export const getOrderUnits = (orderNumber: string): Promise<ApiResult<OrderUnits>> =>
  call<OrderUnits>(`/api/buyer/orders/${encodeURIComponent(orderNumber)}/units`, {
    method: 'GET',
  });
