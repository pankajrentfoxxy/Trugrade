/**
 * The things about the approval screens that would be silently wrong on them.
 *
 * None of these is a "the component renders" assertion. This is the one screen
 * in the customer portal that commits money, so each test attempts the failure
 * that shape of screen invites and expects the refusal:
 *
 * 1. **The requester cannot decide their own order from the UI either.** VR-123
 *    is enforced in the service and proven there against a database; here the
 *    screen is given a `decidable: false` approval and the test looks for a
 *    control to press. There is none, and the reason is on screen in words.
 * 2. **A decline with no reason never reaches the network.** `Button`'s
 *    `disabledReason` deliberately leaves the element focusable — and therefore
 *    clickable — so a screen reader can read the reason. T16 shipped a live
 *    defect of exactly this shape: a control the screen called unavailable that
 *    POSTed anyway. The test presses it and asserts `decideApproval` was never
 *    called.
 * 3. **An expired approval offers no decision at all**, because the deadline the
 *    server reports has passed, and the screen says nothing was charged.
 * 4. **The browser never decides the status.** A `PENDING` row whose `expiresAt`
 *    is in the past is rendered exactly as the server labelled it — as PENDING —
 *    because a browser clock must not be able to move a money deadline in either
 *    direction. The screen renders the server's answer and nothing else.
 * 5. **The board reproduces itself from the URL**, and the filter writes back to
 *    it rather than into local state.
 */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ApprovalsBoard } from './ApprovalsBoard';
import { ApprovalRecord } from './[id]/ApprovalRecord';
import type { ApprovalInbox, ApprovalRecord as Record_, ApprovalRow } from '../api';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getApprovals: jest.fn(),
  getApproval: jest.fn(),
  decideApproval: jest.fn(),
}));

import { decideApproval, getApproval, getApprovals } from '../api';

const mockList = getApprovals as jest.MockedFunction<typeof getApprovals>;
const mockOne = getApproval as jest.MockedFunction<typeof getApproval>;
const mockDecide = decideApproval as jest.MockedFunction<typeof decideApproval>;

/* ----------------------------------------------------------------- fixtures */

const HOUR = 3_600_000;

const approval = (over: Partial<ApprovalRow> = {}): ApprovalRow => ({
  id: '8f3c9a1e-0000-4000-8000-000000000001',
  orderNumber: 'TT-26-00007',
  status: 'PENDING',
  orderValue: '344050.24',
  requestedByName: 'Farah Khan',
  approverName: 'Suresh Pillai',
  requestedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  expiresAt: new Date(Date.now() + 22 * HOUR).toISOString(),
  decidedAt: null,
  comment: null,
  unitsHeld: 6,
  slaHours: 24,
  decidable: true,
  blockedReason: null,
  ...over,
});

const inbox = (rows: ApprovalRow[]): ApprovalInbox => ({
  approvals: rows,
  total: rows.length,
  page: 1,
  per: 10,
  pages: 1,
  facets: [
    { value: 'waiting', label: 'Waiting on you', count: rows.length },
    { value: 'decided', label: 'Decided', count: 0 },
    { value: 'all', label: 'Everything', count: rows.length },
  ],
  waitingOnYou: rows.filter((r) => r.status === 'PENDING').length,
});

const record = (over: Partial<ApprovalRow> = {}): Record_ => ({
  approval: approval(over),
  policyRule: 'Your organisation asks for a signature on any order above ₹2,00,000.00.',
  order: {
    orderNumber: 'TT-26-00007',
    status: 'AWAITING_APPROVAL',
    paymentMode: 'PREPAID',
    paymentStatus: 'PENDING',
    placedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    buyerPoNumber: null,
    costCentre: null,
    subtotal: '291000.00',
    freight: '568.00',
    gstTotal: '52482.24',
    grandTotal: '344050.24',
    tax: {
      interState: false,
      igst: '0.00',
      cgst: '26241.12',
      sgst: '26241.12',
      stateTaxLabel: 'SGST',
      ratePct: 18,
      ourStateCode: '06',
      placeOfSupplyStateCode: '06',
      placeOfSupplyState: 'Haryana',
      basis: 's.10(1)(a) IGST Act',
    },
    billedTo: { gstin: '06AABCU9603R1ZM', legalName: 'Acme Retail Pvt Ltd', tradeName: null },
    billingAddress: address(),
    deliveryAddress: address(),
    unitsAllocated: 1,
    dispatchGroups: [
      {
        label: 'Supply Point D · Ghaziabad',
        machines: [
          {
            serialNumber: 'TGD11CAAFF9',
            title: 'Dell Latitude 5420',
            specSummary: 'Core i5 · 16 GB',
            grade: 'A',
            unitPrice: '46000.00',
          },
        ],
      },
    ],
    approval: null,
  },
});

function address(): Record_['order']['deliveryAddress'] {
  return {
    label: 'Gurugram IT campus',
    line1: 'Tower C, DLF Cyber City',
    line2: null,
    city: 'Gurugram',
    state: 'Haryana',
    stateCode: '06',
    pincode: '122001',
    contactName: 'Ravi Menon',
    contactMobile: '+919810045512',
    landmark: null,
    gateInstructions: null,
    receivingHours: null,
  };
}

const ok = <T,>(data: T) => ({ ok: true as const, data });

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(cleanup);

/* ========================================================================== */

describe('the approval inbox', () => {
  it('offers no decision on a row that is not the reader’s to decide, and says why', async () => {
    mockList.mockResolvedValue(
      ok(
        inbox([
          approval({
            decidable: false,
            blockedReason: 'You placed this order, so you cannot also approve it.',
          }),
        ]),
      ),
    );
    render(<ApprovalsBoard query="" />);

    await screen.findByText('TT-26-00007');
    expect(
      screen.getByText('You placed this order, so you cannot also approve it.'),
    ).toBeInTheDocument();
    // The forbidden thing, attempted: there is no control to press at all.
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('writes the filter to the URL rather than holding it', async () => {
    mockList.mockResolvedValue(ok(inbox([approval()])));
    render(<ApprovalsBoard query="" />);
    await screen.findByText('TT-26-00007');

    fireEvent.click(screen.getByRole('checkbox', { name: /Decided/ }));
    expect(push).toHaveBeenCalledWith('/account/approvals?status=decided', { scroll: false });
  });

  it('renders the server’s status even when the browser clock disagrees', async () => {
    // A PENDING row whose deadline has already passed by the browser's reckoning.
    // The server is the only clock that may retire an approval, so the screen
    // shows what it was told — and offers the decision the server still allows.
    mockList.mockResolvedValue(
      ok(
        inbox([
          approval({
            status: 'PENDING',
            expiresAt: new Date(Date.now() - HOUR).toISOString(),
            decidable: true,
          }),
        ]),
      ),
    );
    render(<ApprovalsBoard query="" />);

    await screen.findByText('TT-26-00007');
    // The pill in the row, not the facet label of the same words in the rail.
    const row = screen.getByRole('row', { name: /TT-26-00007/ });
    expect(within(row).getByText('Waiting on you')).toBeInTheDocument();
    expect(within(row).queryByText('Window closed')).not.toBeInTheDocument();
  });
});

describe('deciding one approval', () => {
  it('REFUSES to send a decline with no reason, and never calls the endpoint', async () => {
    mockOne.mockResolvedValue(ok(record()));
    render(<ApprovalRecord approvalId="8f3c9a1e-0000-4000-8000-000000000001" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Decline it' }));
    fireEvent.change(screen.getByLabelText(/Why are you declining/), {
      target: { value: 'too much' },
    });

    expect(screen.getByText(/at least/)).toBeInTheDocument();
    // `disabledReason` keeps the button reachable on purpose, so pressing it is
    // the real test. T16 shipped a control that announced itself unavailable and
    // POSTed anyway.
    fireEvent.click(screen.getByRole('button', { name: /Decline and send this reason/ }));
    await waitFor(() => expect(mockDecide).not.toHaveBeenCalled());
  });

  it('sends the approver’s words verbatim once the reason is long enough', async () => {
    mockOne.mockResolvedValue(ok(record()));
    mockDecide.mockResolvedValue(
      ok({
        approval: approval({ status: 'REJECTED', decidedAt: new Date().toISOString() }),
        orderStatus: 'CANCELLED' as const,
        units: 6,
      }),
    );
    render(<ApprovalRecord approvalId="8f3c9a1e-0000-4000-8000-000000000001" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Decline it' }));
    fireEvent.change(screen.getByLabelText(/Why are you declining/), {
      target: { value: 'Over budget this quarter — resubmit in October.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Decline and send this reason/ }));

    await waitFor(() =>
      expect(mockDecide).toHaveBeenCalledWith('8f3c9a1e-0000-4000-8000-000000000001', {
        decision: 'REJECT',
        comment: 'Over budget this quarter — resubmit in October.',
      }),
    );
  });

  it('offers no decision on an expired approval, and says nothing was charged', async () => {
    mockOne.mockResolvedValue(ok(record({ status: 'EXPIRED', decidable: false })));
    render(<ApprovalRecord approvalId="8f3c9a1e-0000-4000-8000-000000000001" />);

    await screen.findByText('The window closed');
    expect(screen.getByText(/Nothing was charged/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve this order/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline it' })).not.toBeInTheDocument();
  });

  it('offers the requester no decision on the order they raised', async () => {
    mockOne.mockResolvedValue(
      ok(
        record({
          decidable: false,
          blockedReason: 'You placed this order, so you cannot also approve it.',
        }),
      ),
    );
    render(<ApprovalRecord approvalId="8f3c9a1e-0000-4000-8000-000000000001" />);

    await screen.findByText('This one is not yours to decide');
    expect(
      screen.getByText('You placed this order, so you cannot also approve it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve this order/ })).not.toBeInTheDocument();
  });

  it('shows the whole landed cost and the serials BEFORE the button', async () => {
    // 03_UX_SPEC: "Approving shows the full landed cost, the requester and which
    // policy rule triggered the approval, before the button."
    mockOne.mockResolvedValue(ok(record()));
    const { container } = render(
      <ApprovalRecord approvalId="8f3c9a1e-0000-4000-8000-000000000001" />,
    );

    const button = await screen.findByRole('button', { name: /Approve this order/ });
    // Every one of them, and `getAllByText` because the requester's name is
    // stated twice — in the header and in the why-panel — which is itself the
    // point: it is unmissable before the signature.
    for (const evidence of [/TGD11CAAFF9/, /Farah Khan/, /signature on any order above/]) {
      const [node] = screen.getAllByText(evidence);
      expect(node!.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(container.querySelector('.adec')).toBeTruthy();
  });
});
