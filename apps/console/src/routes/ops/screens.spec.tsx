import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '../../lib/auth';
import { OpsOrderBoardRoute } from './OrderBoard';
import { OpsOrderRecordRoute } from './OrderRecord';
import { OpsPurchaseOrderBoardRoute } from './PurchaseOrderBoard';

/**
 * T39, asserted by trying to break it.
 *
 * Six claims these screens make that no integration test can see, because every
 * one is about what is on the page rather than what the API returned:
 *
 *   1. **An order that raised no purchase order does not print a `0`.** In a
 *      numeric column a zero reads as a measured, unremarkable value; on a
 *      DELIVERED row it means we shipped a machine with no record of buying it.
 *      Two of the demo database's orders are in exactly that state.
 *   2. **A margin that cannot be stated is words, not a zero.** ₹0.00 margin and
 *      "we never recorded what we paid" are opposite facts and must never render
 *      the same.
 *   3. **No order, payment or purchase-order status is a verdict.** `--pass` and
 *      `--fail` are PASS/FAIL only. A cancelled order is not a failed test.
 *   4. **A purchase order nobody has accepted is waiting, never late.** There is
 *      no acceptance deadline in this product, so "overdue" would be a promise
 *      nobody made.
 *   5. **A row says why it matched.** A seal-code search landing on a board with
 *      no seal column reads as a mistake.
 *   6. **A grade badge carries no verdict class.** A+, A and B are all sellable.
 */

const APPROVAL = {
  status: 'PENDING' as const,
  approverName: 'Suresh Pillai',
  requestedAt: '2026-08-29T21:43:25.526Z',
  expiresAt: '2026-08-30T21:43:25.523Z',
  breached: true,
};

const BOARD = {
  rows: [
    {
      orderNumber: 'TT-26-00009',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      placedAt: '2026-08-29T21:43:25.527Z',
      buyer: { legalName: 'Acme Industries Pvt. Ltd.', tradeName: null },
      buyerPoNumber: null,
      grandTotal: '344050.24',
      units: 6,
      /** The alarming zero. */
      purchaseOrders: 0,
      approval: APPROVAL,
      matchedOn: [{ kind: 'seal' as const, value: 'TG-TGD88B6C311' }],
    },
    {
      orderNumber: 'TT-26-00011',
      status: 'CANCELLED',
      paymentStatus: 'PENDING',
      placedAt: '2026-08-29T21:45:34.064Z',
      buyer: { legalName: 'Acme Industries Pvt. Ltd.', tradeName: null },
      buyerPoNumber: null,
      grandTotal: '344050.24',
      units: 6,
      purchaseOrders: 2,
      approval: null,
      matchedOn: [],
    },
  ],
  total: 2,
  page: 1,
  per: 25,
  pages: 1,
  facets: {
    status: [{ value: 'DELIVERED', label: 'Delivered', count: 1 }],
    payment: [{ value: 'PAID', label: 'Paid', count: 1 }],
  },
  searchedFor: ['our order number', 'a seal code'],
};

const RECORD_BASE = {
  orderNumber: 'TT-26-00007',
  status: 'DELIVERED',
  paymentStatus: 'PAID',
  paymentMode: 'PREPAID',
  placedAt: '2026-08-29T21:40:24.828Z',
  buyer: { legalName: 'Acme Industries Pvt. Ltd.', tradeName: null },
  buyerGstin: '06AABCA1429B1Z8',
  placedByName: 'Farah Khan',
  placedByMobile: '+919854598621',
  buyerPoNumber: null,
  costCentre: null,
  shipTo: null,
  money: {
    subtotal: '291000.00',
    freight: '568.00',
    gstTotal: '52482.24',
    tcs: '0.00',
    grandTotal: '344050.24',
  },
  subOrders: [
    {
      subOrderNumber: 'TT-26-00007-1',
      vendorLegalName: 'Noida Phase II Recommerce Pvt. Ltd.',
      status: 'DELIVERED',
      subtotal: '153000.00',
      dispatchSlaDueAt: null,
      deliveredAt: '2026-08-25T13:55:18.177Z',
      machines: [
        {
          serialNumber: 'TGD52FFA3D5',
          title: 'Dell Latitude 5420',
          grade: 'A',
          unitPrice: '51000.00',
          purchaseCost: null,
          status: 'DELIVERED',
        },
      ],
    },
  ],
  purchaseOrders: [],
  approval: null,
  timeline: [],
};

const UNCOVERED = {
  ...RECORD_BASE,
  margin: null,
  marginUnavailable:
    'No purchase order was ever raised for this order, so what we paid for its 6 machines is not recorded anywhere. The margin cannot be stated.',
};

/** One purchase order on the record, for the permission-gated link test. */
const PO_ON_RECORD = {
  poId: 'po-1',
  poNumber: 'PO-26-00015',
  status: 'RAISED',
  vendorLegalName: 'Faridabad TechCycle Pvt. Ltd.',
  totalNet: '46010.00',
  tdsAmount: '0.00',
  lines: 1,
  raisedAt: '2026-08-30T07:24:48.764Z',
  acknowledgedAt: null,
};

const COVERED = {
  ...RECORD_BASE,
  orderNumber: 'TT-26-00013',
  margin: { soldFor: '53500.00', paid: '46010.00', amount: '7490.00', pct: '14.0' },
  marginUnavailable: null,
};

const POS = {
  rows: [
    {
      poId: 'po-1',
      poNumber: 'PO-26-00015',
      status: 'RAISED',
      vendorOrgId: 'v1',
      vendorLegalName: 'Faridabad TechCycle Pvt. Ltd.',
      orderNumber: 'TT-26-00013',
      raisedAt: '2026-08-30T07:24:48.764Z',
      lines: 1,
      totalNet: '46010.00',
      tdsAmount: '0.00',
      valuationMethod: 'REGULAR',
      termsDays: 15,
      acknowledgedAt: null,
      waitingHours: 13,
      matchedSerials: ['TGD5963139B'],
    },
    {
      poId: 'po-2',
      poNumber: 'PO-26-00001',
      status: 'CANCELLED',
      vendorOrgId: 'v2',
      vendorLegalName: 'Okhla Asset Recovery LLP',
      orderNumber: 'TT-26-00002',
      raisedAt: '2026-08-20T07:24:48.764Z',
      lines: 2,
      totalNet: '37410.00',
      tdsAmount: '0.00',
      valuationMethod: 'REGULAR',
      termsDays: 15,
      acknowledgedAt: '2026-08-21T09:00:00.000Z',
      waitingHours: null,
      matchedSerials: [],
    },
  ],
  total: 2,
  page: 1,
  per: 25,
  pages: 1,
  facets: {
    status: [{ value: 'RAISED', label: 'Raised, not yet accepted', count: 1 }],
    vendor: [],
  },
  totals: { value: '83420.00', tds: '0.00', machines: 3 },
  searchedFor: null,
};

/**
 * Two permissions, because these screens genuinely branch on the second.
 *
 * SUPPORT is the role §3C.4 gives the order board to, and it does NOT hold
 * `procurement.po.read_any` — so the purchase-order count on a row and the PO
 * number on the record are links for an ops manager and plain text for them. A
 * link that 403s for the role the screen exists for is the dead-control pattern.
 */
const SUPPORT_PERMS = ['ordering.any.read'];
const OPS_PERMS = ['ordering.any.read', 'procurement.po.read_any'];

/**
 * The session call and the screen's own call, answered separately.
 *
 * `AuthProvider` fetches `/api/auth/session` on mount; a single-body mock would
 * hand it the board payload and it would read as a principal with no
 * permissions, which is a different bug wearing this one's clothes.
 */
function mockApi(body: unknown, permissions: string[] = OPS_PERMS): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const payload = url.includes('/api/auth/session')
      ? {
          userId: 'u1',
          orgId: 'o1',
          orgType: 'PLATFORM',
          roles: ['OPS_MANAGER'],
          permissions,
          mfaRequired: false,
          fullName: 'Anand Krishnan',
        }
      : body;
    return Promise.resolve({ ok: true, status: 200, json: async () => payload } as Response);
  });
}

const draw = (
  entry: string,
  path: string,
  element: React.ReactElement,
): ReturnType<typeof render> =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );

const drawOrders = (): ReturnType<typeof render> =>
  draw('/orders', '/orders', <OpsOrderBoardRoute />);

const drawRecord = (orderNumber: string): ReturnType<typeof render> =>
  draw(`/orders/${orderNumber}`, '/orders/:orderNumber', <OpsOrderRecordRoute />);

const drawPos = (): ReturnType<typeof render> =>
  draw('/procurement/pos', '/procurement/pos', <OpsPurchaseOrderBoardRoute />);

afterEach(() => vi.restoreAllMocks());

/* ========================================================================== */

describe('a missing value never renders as a passing one', () => {
  it('says an order raised no purchase order, and never prints a bare zero for it', async () => {
    mockApi(BOARD);
    drawOrders();
    expect(await screen.findByText('TT-26-00009')).toBeTruthy();
    expect(screen.getByText('None raised')).toBeTruthy();
    // The control: the other row raised two and prints the number, so "None
    // raised" is a considered rendering rather than the column being broken.
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders an unstatable margin as the reason, in --ink-4, never as an amount', async () => {
    mockApi(UNCOVERED);
    drawRecord('TT-26-00007');
    const reason = await screen.findByText(/is not recorded anywhere/);
    expect(reason).toBeTruthy();
    // `--ink-4` is what a value we do not have looks like. A zero margin and an
    // unrecorded one are opposite facts and must not share a rendering.
    expect(reason.className).toContain('text-ink-4');
    // No figure anywhere in the margin block: no amount, no share, no zero.
    expect(screen.queryByText('As a share')).toBeNull();
    // 'Sold for' exists only inside the margin block; 'We pay' is also a column
    // header on the machine table, so it is not a usable absence assertion.
    expect(screen.queryByText('Sold for')).toBeNull();
  });

  it('states the margin with its denominator when it can be stated', async () => {
    mockApi(COVERED);
    drawRecord('TT-26-00013');
    expect(await screen.findByText('As a share')).toBeTruthy();
    // Every percentage carries its denominator (09_FRONTEND_LOCKED §3).
    expect(screen.getByText('14.0%')).toBeTruthy();
    expect(screen.getByText(/of.*sold, ex GST and ex freight/s)).toBeTruthy();
  });

  it('says a machine has no purchase-order line rather than showing it at ₹0', async () => {
    mockApi(UNCOVERED);
    drawRecord('TT-26-00007');
    expect(await screen.findByText('No PO line')).toBeTruthy();
  });
});

describe('a status is not a verdict', () => {
  it('paints no order or payment status with the PASS or FAIL colours', async () => {
    mockApi(BOARD);
    const { container } = drawOrders();
    await screen.findByText('TT-26-00009');
    // `--pass` and `--fail` are reserved for a QC verdict. A cancelled order is
    // not a failed test and a delivered one is not a passed one.
    expect(container.querySelectorAll('.text-pass')).toHaveLength(0);
    expect(container.querySelectorAll('.text-fail')).toHaveLength(0);
  });

  it('paints no purchase-order status with them either', async () => {
    mockApi(POS);
    const { container } = drawPos();
    await screen.findByText('PO-26-00015');
    expect(container.querySelectorAll('.text-pass')).toHaveLength(0);
    expect(container.querySelectorAll('.text-fail')).toHaveLength(0);
  });

  it('paints a grade badge neutrally on the record', async () => {
    mockApi(COVERED);
    const { container } = drawRecord('TT-26-00013');
    await screen.findByText('TGD52FFA3D5');
    expect(container.querySelectorAll('.text-pass')).toHaveLength(0);
    expect(container.querySelectorAll('.text-fail')).toHaveLength(0);
  });

  it('renders a breached approval deadline as warn, because the deadline was ours', async () => {
    mockApi(BOARD);
    const { container } = drawOrders();
    await screen.findByText('TT-26-00009');
    // T34's ledger entry settled this: an SLA we set and let lapse is our
    // failure, not a verdict on the applicant — or here, on the buyer.
    expect(container.querySelector('.text-warn')).toBeTruthy();
  });
});

describe('a purchase order nobody accepted is waiting, never late', () => {
  it('prints the hours it has waited and calls it nothing else', async () => {
    mockApi(POS);
    drawPos();
    expect(await screen.findByText('PO-26-00015')).toBeTruthy();
    expect(screen.getByText('Not accepted')).toBeTruthy();
    expect(screen.getByText(/waiting/)).toBeTruthy();
    // There is no acceptance window in this product, so no row may claim one.
    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.queryByText(/late/i)).toBeNull();
    expect(screen.queryByText(/past due/i)).toBeNull();
  });

  it('prints the acceptance date, and no waiting clause, once it is accepted', async () => {
    mockApi(POS);
    drawPos();
    await screen.findByText('PO-26-00001');
    // One "waiting" clause on the page, not two: the accepted row is finished
    // with and its waiting time is a closed fact, not a live one.
    expect(screen.getAllByText(/waiting/)).toHaveLength(1);
  });

  it('sums the whole filtered set in the toolbar, not the page', async () => {
    mockApi(POS);
    drawPos();
    expect(await screen.findByText(/to pay across/)).toBeTruthy();
    expect(screen.getByText('₹83,420.00')).toBeTruthy();
  });
});

describe('a row says why it matched', () => {
  it('names the seal code that put an order in the result', async () => {
    mockApi(BOARD);
    drawOrders();
    await screen.findByText('TT-26-00009');
    expect(screen.getByText('TG-TGD88B6C311')).toBeTruthy();
    expect(screen.getByText(/matched on/)).toBeTruthy();
  });

  it('names the serial that put a purchase order in the result', async () => {
    mockApi(POS);
    drawPos();
    await screen.findByText('PO-26-00015');
    expect(screen.getByText('TGD5963139B')).toBeTruthy();
  });

  it('prints what the box was compared against, so an empty result is explicable', async () => {
    mockApi(BOARD);
    drawOrders();
    await screen.findByText('TT-26-00009');
    expect(screen.getByText(/Compared against .*seal code/)).toBeTruthy();
  });
});

describe('a link the caller cannot open is not a link', () => {
  it('makes the purchase-order count a link for a caller who may open the board', async () => {
    mockApi(BOARD, OPS_PERMS);
    drawOrders();
    await screen.findByText('TT-26-00009');
    expect(screen.getByRole('link', { name: '2' })).toBeTruthy();
  });

  it('leaves it as a plain number for SUPPORT, who would be refused that board', async () => {
    mockApi(BOARD, SUPPORT_PERMS);
    drawOrders();
    await screen.findByText('TT-26-00009');
    // The number is still there — the count is a fact SUPPORT is entitled to.
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '2' })).toBeNull();
  });

  it('leaves the purchase-order number on the record unlinked for SUPPORT', async () => {
    mockApi({ ...COVERED, purchaseOrders: [{ ...PO_ON_RECORD }] }, SUPPORT_PERMS);
    drawRecord('TT-26-00013');
    await screen.findByText('PO-26-00015');
    expect(screen.queryByRole('link', { name: 'PO-26-00015' })).toBeNull();
  });
});

describe('the record offers no control it cannot honour', () => {
  it('names cancel, reallocate and force-progress as absent rather than showing them', async () => {
    mockApi(COVERED);
    drawRecord('TT-26-00013');
    await screen.findByText('TGD52FFA3D5');
    expect(screen.getByText(/None of the three is built/)).toBeTruthy();
    for (const label of [/^Cancel$/, /^Reallocate$/, /^Force progress$/]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });
});
