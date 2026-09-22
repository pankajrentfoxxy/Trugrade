/**
 * The documents on an order nobody has picked a machine for yet.
 *
 * `order_line_unit` is a vacant slot at confirm — `unit_id` and
 * `serial_number` are null until the vendor allocates. Every order between
 * placement and pick-up looks like this, and the buyer's Documents tab 500'd on
 * all of them: the slots' nulls reached the unit valuation query as `[null]`,
 * which Postgres refuses to cast to `uuid[]`. TT-26-00033 on the dev database
 * is one such order, and so were five of the seeded buyer's eight.
 */
import type { PaymentService } from '../../payment';
import type { AuditService } from '../../identity';
import type { PrismaService } from '../../../shared/db/prisma.service';
import type { RequestContextService } from '../../../shared/db/org-scope';
import type { CatalogLookup } from './catalog-lookup';
import { OrderDocumentsService } from './order-documents.service';
import { UNKNOWN_DISPATCH_LABEL } from './dispatch-label';

const ORG = 'fc3fc0ce-9c96-4aa4-84af-0b71f8476d60';
const ORDER = '2b4b3c1e-5c3e-4a9e-9d2a-0f1e2d3c4b5a';
const SUB = '019365b6-0139-4511-976c-e7758893a03a';
const LINE = '046af830-9720-40a8-a5a1-02c22de5c2fd';
const SKU = '20a0388b-ea0b-4565-85cd-ca2026976cbf';
const GST_PROFILE = '7c1e0b7a-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const BILL_TO = 'cfd1c869-96f9-4b3d-ada0-bc5e8cf7f9fb';
const SHIP_TO = '8cbbd2d7-10e2-4d0d-9b43-5eee71aee64b';

const address = (id: string) => ({
  id,
  line1: 'Plot 12, Sector 18',
  line2: null,
  city: 'Gurugram',
  state: 'Haryana',
  state_code: '06',
  pincode: '122015',
  contact_name: 'Rahul Choudhary',
  contact_mobile: '+919876543210',
});

function build(lineRows: unknown[]): {
  service: OrderDocumentsService;
  queryRaw: jest.Mock;
} {
  // Answered by what is asked rather than in a fixed order, because which reads
  // happen depends on whether any slot has a unit — which is the point.
  const queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM ordering."order"')) {
      return [
      {
        id: ORDER,
        order_number: 'TT-26-00033',
        status: 'PAYMENT_PENDING',
        buyer_po_number: null,
        cost_centre: null,
        placed_at: new Date('2026-09-21T10:00:00Z'),
        buyer_org_id: ORG,
        billing_gst_profile_id: GST_PROFILE,
        billing_address_id: BILL_TO,
        shipping_address_id: SHIP_TO,
      },
      ];
    }
    if (sql.includes('FROM ordering.sub_order')) return lineRows;
    if (sql.includes('FROM kyc.gst_profile')) {
      return [
        { gstin: '06AAHCT0310N1ZG', legal_name_as_per_gst: 'CHOUDHARY EXPORTS', trade_name: null, state_code: '06' },
      ];
    }
    if (sql.includes('FROM identity.org_address')) return [address(BILL_TO), address(SHIP_TO)];
    // The unit reads — labels and valuations. Nothing to say about a unit the
    // test did not seed, and nothing to say is not an error.
    return [];
  });

  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const ctx = {
    requirePrincipal: () => ({ orgType: 'BUYER', orgId: ORG }),
  } as unknown as RequestContextService;
  const catalog = {
    describe: async () => ({ title: 'ThinkPad T14 Gen 3', hsn: '84713010' }),
  } as unknown as CatalogLookup;
  // Hands the basis straight back, so the test reads what the service built.
  const payments = {
    documentsForOrder: jest.fn(async (basis: unknown) => basis),
  } as unknown as PaymentService;
  const audit = {} as AuditService;

  return { service: new OrderDocumentsService(prisma, ctx, catalog, payments, audit), queryRaw };
}

const vacantSlot = {
  sub_order_id: SUB,
  sub_order_status: 'PAYMENT_PENDING',
  sub_order_number: 'TT-26-00033-1',
  freight: '149.00',
  order_line_id: LINE,
  sku_id: SKU,
  grade: 'B',
  unit_price: '36500.00',
  gst_rate: '18.00',
  unit_id: null,
  serial_number: null,
};

describe('OrderDocumentsService.byOrderNumber on an order awaiting allocation', () => {
  it('builds the basis rather than sending a null unit id to the database', async () => {
    const { service, queryRaw } = build([vacantSlot, vacantSlot]);
    const basis = (await service.byOrderNumber('TT-26-00033')) as unknown as {
      consignments: Array<{
        dispatchLabel: string;
        lines: Array<{ qty: number; serialNumbers: string[]; valuationMethod: string }>;
      }>;
    };

    // Exactly the four reads listed above. A fifth would be the unit lookup
    // with `[null]` in it — the query that 500'd.
    expect(queryRaw).toHaveBeenCalledTimes(4);
    for (const call of queryRaw.mock.calls) {
      const values = (call as unknown[]).slice(1);
      expect(values.some((v) => Array.isArray(v) && v.includes(null))).toBe(false);
    }

    const [consignment] = basis.consignments;
    expect(consignment!.dispatchLabel).toBe(UNKNOWN_DISPATCH_LABEL);
    const [line] = consignment!.lines;
    // Two slots are two machines' worth of money and no serials at all —
    // never `[null, null]`, which would print on the proforma.
    expect(line).toMatchObject({ qty: 2, serialNumbers: [], valuationMethod: 'REGULAR' });
  });

  it('still names the serials it has once some slots are filled', async () => {
    const { service } = build([
      vacantSlot,
      { ...vacantSlot, unit_id: '3d6b1c2a-4e5f-4a6b-8c7d-9e0f1a2b3c4d', serial_number: 'PF3XK9Q1' },
    ]);
    // This time the units exist, so the label and valuation reads happen too;
    // they may answer nothing without changing what the line says.
    const basis = (await service.byOrderNumber('TT-26-00033')) as unknown as {
      consignments: Array<{ lines: Array<{ qty: number; serialNumbers: string[] }> }>;
    };
    const [line] = basis.consignments[0]!.lines;
    expect(line).toMatchObject({ qty: 2, serialNumbers: ['PF3XK9Q1'] });
  });
});
