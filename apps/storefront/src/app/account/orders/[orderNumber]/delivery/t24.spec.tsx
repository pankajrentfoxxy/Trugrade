/**
 * The things about the seal-check screen that would be silently wrong on it.
 *
 * None of these is a "the panel renders" assertion. Each one attempts the
 * failure this particular screen invites and expects the refusal:
 *
 * 1. **A check that did not happen never renders as one that passed.** An order
 *    whose window closed with nobody having looked at a single seal must not say
 *    "Every seal checked" at the top. This is the defect the screen was actually
 *    shipped with for one capture run, and it is the oldest rule in the build
 *    wearing a delivery hat: APPLIED is not INTACT, and neither is "we ran out
 *    of time".
 *
 * 2. **A machine with no seal on record is not a machine that passed.** No chip,
 *    no tick — the words, and the handover stays blocked.
 *
 * 3. **One amber control on the screen, across every consignment.** An order
 *    split into three deliveries has three scan boxes; painting all three amber
 *    is three primary actions.
 *
 * 4. **The refusal is announced and verbatim.** A code that is not on the
 *    delivery gets `role="alert"` carrying the server's own sentence, never a
 *    summary of it — the correct response to that sentence is to refuse a
 *    machine.
 *
 * 5. **Nothing on the screen does date arithmetic.** The window's verdict comes
 *    from the payload, so a `window.open: false` with hours still nominally on
 *    the clock is honoured rather than second-guessed.
 */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DeliveryCheck } from './DeliveryCheck';
import type { DeliveryConsignment, DeliveryMachine, DeliveryView } from './api';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  getDelivery: jest.fn(),
  checkSeal: jest.fn(),
  confirmReceipt: jest.fn(),
}));

import { checkSeal, getDelivery } from './api';

const mockGet = getDelivery as jest.MockedFunction<typeof getDelivery>;
const mockCheck = checkSeal as jest.MockedFunction<typeof checkSeal>;

/* ----------------------------------------------------------------- fixtures */

const machine = (over: Partial<DeliveryMachine> = {}): DeliveryMachine => ({
  serialNumber: 'TGD88DA0397',
  title: 'Dell Latitude 5420',
  specSummary: 'Core i5 · 16 GB · 512 GB NVME_SSD · 14"',
  seal: { code: 'TG-TGD88DA0397', status: 'APPLIED' },
  verdict: 'PASS',
  passportPath: '/unit/TGD88DA0397',
  blockedReason: 'Nobody has checked this seal yet.',
  ...over,
});

const consignment = (over: Partial<DeliveryConsignment> = {}): DeliveryConsignment => ({
  index: 1,
  label: 'Delivery 1 of 1 · Supply Point A · Gurugram',
  status: 'DELIVERED',
  deliveredAt: '2026-08-30T06:00:00.000Z',
  window: { closesAt: '2026-09-01T06:00:00.000Z', open: true, hoursRemaining: 41 },
  machines: [machine()],
  receiptConfirmedAt: null,
  blockedReason: '1 of 1 machine has a seal nobody has looked at yet — TGD88DA0397.',
  ...over,
});

const view = (over: Partial<DeliveryView> = {}): DeliveryView => ({
  orderNumber: 'TT-26-00004',
  status: 'DELIVERED',
  asOf: '2026-08-31T06:00:00.000Z',
  windowHours: 48,
  consignments: [consignment()],
  ...over,
});

const served = (data: DeliveryView): void => {
  mockGet.mockResolvedValue({ ok: true, data });
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(cleanup);

/* ========================================================================== */

describe('a check that did not happen', () => {
  it('never renders as one that passed, once the window has closed', async () => {
    served(
      view({
        consignments: [
          consignment({
            // Closed, and NOT ONE seal was ever looked at.
            window: { closesAt: '2026-08-27T06:00:00.000Z', open: false, hoursRemaining: 0 },
            machines: [
              machine({ serialNumber: 'TGDAAA00001' }),
              machine({ serialNumber: 'TGDBBB00002' }),
            ],
            blockedReason: '2 of 2 seals were never checked, and the window has closed.',
          }),
        ],
      }),
    );

    render(<DeliveryCheck orderNumber="TT-26-00004" />);

    // The whole point. "Every seal checked" on this order would be a missing
    // value drawn as a passing one, on the screen whose entire subject is that
    // distinction.
    expect(await screen.findByText('2 of 2 never checked')).toBeInTheDocument();
    expect(screen.queryByText('Every seal checked')).not.toBeInTheDocument();
  });

  it('says every seal checked only when every seal really was', async () => {
    served(
      view({
        consignments: [
          consignment({
            machines: [
              machine({
                seal: { code: 'TG-1', status: 'INTACT' },
                blockedReason: null,
              }),
            ],
            blockedReason: null,
          }),
        ],
      }),
    );

    render(<DeliveryCheck orderNumber="TT-26-00004" />);
    expect(await screen.findByText('Every seal checked')).toBeInTheDocument();
  });
});

describe('a machine with no seal on record', () => {
  it('says so in words and shows no chip', async () => {
    served(
      view({
        consignments: [
          consignment({
            machines: [
              machine({
                seal: null,
                blockedReason: 'We have no seal recorded on this machine. Do not accept it.',
              }),
            ],
          }),
        ],
      }),
    );

    render(<DeliveryCheck orderNumber="TT-26-00004" />);

    expect(await screen.findByText('No seal recorded')).toBeInTheDocument();
    // Not "Sealed", not "Seal intact" — the absence of a seal is not a state of
    // one, and `SealChip`'s vocabulary must not be borrowed to describe it.
    expect(screen.queryByText('Sealed')).not.toBeInTheDocument();
    expect(screen.queryByText('Seal intact')).not.toBeInTheDocument();
    expect(
      screen.getByText(/no seal recorded on this machine\. Do not accept it\./i),
    ).toBeInTheDocument();
  });
});

describe('one primary action', () => {
  it('paints exactly one amber control across three deliveries with work outstanding', async () => {
    served(
      view({
        consignments: [
          consignment({ index: 1 }),
          consignment({
            index: 2,
            label: 'Delivery 2 of 3 · Supply Point B · Noida',
            machines: [machine({ serialNumber: 'TGDCCC00003' })],
          }),
          consignment({
            index: 3,
            label: 'Delivery 3 of 3 · Supply Point C · Sonipat',
            machines: [machine({ serialNumber: 'TGDDDD00004' })],
          }),
        ],
      }),
    );

    const { container } = render(<DeliveryCheck orderNumber="TT-26-00004" />);
    await screen.findByText('Delivery 1 of 1 · Supply Point A · Gurugram');

    // Three scan boxes, one accent. `09_FRONTEND_LOCKED.md` allows one amber
    // control per screen and this screen has as many as the order has
    // deliveries.
    expect(container.querySelectorAll('.dvgo')).toHaveLength(3);
    expect(container.querySelectorAll('.dvgo.acc')).toHaveLength(1);
  });
});

describe('a code that is not on this delivery', () => {
  it('is announced, and carries the server’s sentence word for word', async () => {
    served(view());
    const sentence = 'Seal 88-041992 is not on this delivery. Do not accept this machine.';
    mockCheck.mockResolvedValue({
      ok: false,
      status: 422,
      code: 'VALIDATION_FAILED',
      message: sentence,
      fields: { sealCode: 'This code is not on any machine we sent you.' },
      retryAfterSeconds: null,
    });

    render(<DeliveryCheck orderNumber="TT-26-00004" />);
    const input = await screen.findByLabelText(/seal code on the machine/i);
    // `fireEvent` rather than `user-event`: the latter is not a declared
    // dependency of this app, and one assertion is not worth adding one.
    fireEvent.change(input, { target: { value: '88-041992' } });
    fireEvent.click(screen.getByRole('button', { name: /record what you found/i }));

    const alert = await screen.findByRole('alert');
    // Verbatim. Summarising it would turn an instruction to refuse a machine
    // into a typo notice.
    expect(alert).toHaveTextContent(sentence);
  });
});

describe('the window', () => {
  it('is read off the payload and never recomputed', async () => {
    // `open: false` with a closing instant still in the future. A screen doing
    // its own arithmetic would draw this as live; this one must not, because the
    // server is the only clock that decides whether a buyer has a remedy.
    served(
      view({
        consignments: [
          consignment({
            window: { closesAt: '2099-01-01T00:00:00.000Z', open: false, hoursRemaining: 0 },
            blockedReason: 'The window has closed.',
          }),
        ],
      }),
    );

    render(<DeliveryCheck orderNumber="TT-26-00004" />);

    await waitFor(() =>
      expect(screen.getByText(/inspection window closed/i)).toBeInTheDocument(),
    );
    // The scan box is gone, and the way forward is the warranty route.
    expect(screen.queryByLabelText(/seal code on the machine/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /warranty claim/i })[0]).toHaveAttribute(
      'href',
      '/account/warranty',
    );
  });

  it('draws no window at all when the platform cannot state one', async () => {
    served(
      view({
        windowHours: null,
        consignments: [consignment({ window: null })],
      }),
    );

    render(<DeliveryCheck orderNumber="TT-26-00004" />);

    // Not 48, not zero. A deadline we cannot name is one we must not draw.
    expect(
      await screen.findByText(/cannot state the inspection window right now/i),
    ).toBeInTheDocument();
  });
});
