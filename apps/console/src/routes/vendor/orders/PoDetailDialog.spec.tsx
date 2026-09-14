import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../../../lib/auth';
import { PoDetailDialog } from './PoDetailDialog';
import type { AttachableUnit, PurchaseOrderDetail } from '../api';

/**
 * The attach picker's one job: put the vendor on the exact machine our system
 * already committed at order time, without making every other RESERVED row on
 * the platform look like it belongs here.
 *
 * `reservedUnitIdsForOrder` on the API side already scopes a `RESERVED` row to
 * *this* order — see the comment on `unitStatusPill` — so nothing here should
 * re-litigate that. What this file checks is what the API cannot: that the
 * screen tells a reserved-for-this-order unit apart from ordinary stock,
 * pre-selects it so the normal case is one click, and lets a vendor search and
 * multi-select the rest.
 */

const PO: PurchaseOrderDetail = {
  poId: 'po-1',
  poNumber: 'PO-26-00027',
  status: 'ACKNOWLEDGED',
  raisedAt: '2026-09-01T00:00:00.000Z',
  units: 2,
  totalNet: '10000.00',
  tdsRatePct: 0,
  tdsAmount: '0.00',
  valuationMethod: 'REGULAR',
  termsDays: 15,
  acknowledgedAt: '2026-09-02T00:00:00.000Z',
  expectedDispatchAt: null,
  acknowledgeBy: null,
  cancelledAt: null,
  rejectedAt: null,
  rejectionReason: null,
  consignmentCarrier: null,
  consignmentAwb: null,
  dispatchedAt: null,
  originalTotalNet: '10000.00',
  owedNet: '10000.00',
  modelCount: 1,
  modelNames: ['Dell Latitude 3420'],
  deliverTo: { city: 'Gurugram', state: 'Haryana' },
  demands: [],
  lineGroups: [
    {
      lineIds: ['line-1', 'line-2'],
      skuId: 'sku-1',
      skuCode: 'DEL-LAT3420-I31115G4-16-512',
      title: 'Dell Latitude 3420',
      specSummary: 'Core i3 · 16 GB · 512 GB NVME_SSD',
      gradeAtPo: 'A',
      qty: 2,
      unitPrice: '5000.00',
      lineTotal: '10000.00',
      lineStatus: 'ACCEPTED',
      rejectionReason: null,
      attachedCount: 0,
      serials: [],
    },
  ],
  totals: {
    orderTotal: '10000.00',
    rejectedTotal: '0.00',
    tdsAmount: '0.00',
    owedIfAccepted: '10000.00',
  },
};

const UNITS: AttachableUnit[] = [
  { unitId: 'u-reserved', serialNumber: '9SVGXEB', status: 'RESERVED' },
  { unitId: 'u-listed-1', serialNumber: 'BBB2222', status: 'LISTED' },
  { unitId: 'u-listed-2', serialNumber: 'CCC3333', status: 'LISTED' },
];

const CAN_ACK = ['procurement.po.acknowledge', 'procurement.po.read_own'];

function mockApi(posted: string[]): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes('/api/auth/session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          userId: 'u1',
          orgId: 'o1',
          orgType: 'VENDOR',
          roles: ['VENDOR_OWNER'],
          permissions: CAN_ACK,
          mfaRequired: false,
          fullName: 'Harpreet Singh',
        }),
      } as Response);
    }
    if (url.includes('/attachable-units')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => UNITS } as Response);
    }
    if (url.includes('/purchase-orders/po-1/attach')) {
      posted.push(String((init?.body as string | undefined) ?? ''));
      return Promise.resolve({ ok: true, status: 200, json: async () => PO } as Response);
    }
    if (url.includes('/purchase-orders/po-1')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => PO } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
  });
}

const draw = (posted: string[] = []): ReturnType<typeof render> => {
  mockApi(posted);
  return render(
    <AuthProvider>
      <PoDetailDialog poId="po-1" open onClose={() => {}} onUpdated={() => {}} />
    </AuthProvider>,
  );
};

afterEach(() => vi.restoreAllMocks());

async function openAttachPicker(): Promise<void> {
  const user = userEvent.setup();
  await screen.findByText('PO-26-00027');
  await user.click(await screen.findByRole('button', { name: 'Attach' }));
  await screen.findByText('Search serials');
}

describe('the attach picker', () => {
  it('pre-selects the unit reserved for this order and labels it, not the free stock', async () => {
    draw();
    await openAttachPicker();

    const reservedRow = screen.getByText('9SVGXEB').closest('li')!;
    expect(within(reservedRow).getByRole('checkbox')).toBeChecked();
    expect(within(reservedRow).getByText('Reserved for this order')).toBeTruthy();

    const listedRow = screen.getByText('BBB2222').closest('li')!;
    expect(within(listedRow).getByRole('checkbox')).not.toBeChecked();
    expect(within(listedRow).getByText('Available')).toBeTruthy();

    expect(screen.getByText('1')).toBeTruthy(); // "1 of 2 selected"
  });

  it('searches serials by substring and keeps the hidden selection intact', async () => {
    const user = userEvent.setup();
    draw();
    await openAttachPicker();

    await user.type(screen.getByLabelText('Search serials'), 'BBB');

    expect(screen.getByText('BBB2222')).toBeTruthy();
    expect(screen.queryByText('9SVGXEB')).toBeNull();
    expect(screen.queryByText('CCC3333')).toBeNull();
    // The reserved unit is still selected even though the search hid its row.
    expect(screen.getByRole('button', { name: /Attach \d+ of 2/ }).textContent).toBe(
      'Attach 1 of 2',
    );

    await user.clear(screen.getByLabelText('Search serials'));
    expect(screen.getByText('9SVGXEB')).toBeTruthy();
  });

  it('shows a no-match message distinct from the true empty state', async () => {
    const user = userEvent.setup();
    draw();
    await openAttachPicker();

    await user.type(screen.getByLabelText('Search serials'), 'nomatch');

    expect(screen.getByText('No serial matches “nomatch”.')).toBeTruthy();
  });

  it('supports selecting more than one machine and refuses past what the line needs', async () => {
    const user = userEvent.setup();
    draw();
    await openAttachPicker();

    // Already 1 of 2 selected (the reserved unit). Adding one LISTED unit
    // reaches the line's demand.
    await user.click(screen.getByText('CCC3333'));
    expect(screen.getByRole('button', { name: 'Attach 2 of 2' })).toBeTruthy();

    // A third pick is refused rather than silently swapping one out.
    await user.click(screen.getByText('BBB2222'));
    expect(
      await screen.findByText('This line needs exactly 2 machines. Deselect one first.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach 2 of 2' })).toBeTruthy();
  });

  it('attaches every selected machine on confirm, not just the reserved one', async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    draw(posted);
    await openAttachPicker();

    await user.click(screen.getByText('CCC3333'));
    await user.click(screen.getByRole('button', { name: 'Attach 2 of 2' }));

    await waitFor(() => expect(posted).toHaveLength(2));
    const unitIds = posted.map((b) => (JSON.parse(b) as { unitId: string }).unitId).sort();
    expect(unitIds).toEqual(['u-reserved', 'u-listed-2'].sort());
  });
});
