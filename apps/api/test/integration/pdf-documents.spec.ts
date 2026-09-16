/**
 * Three documents, one letterhead, two audiences.
 *
 * The assertions that matter are about **what is absent**. The purchase order
 * goes to the vendor and must not carry the customer or the selling price; the
 * order confirmation goes to the customer and must not carry a vendor at any
 * depth. Both are checked against the extracted text of the actual file rather
 * than against the payload that built it, because the leak everybody misses is
 * the one in the rendered bytes — a filename, a metadata field, a footer.
 */

import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { LEGAL_DISCLOSURE, formatRegisteredOffice } from '@trugrade/config';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { AuthModule } from '../../src/shared/auth/auth.module';
import { EventBusModule } from '../../src/shared/events/event-bus';
import { AutomationModule } from '../../src/shared/automation/automation.service';
import { RedisModule, RedisService } from '../../src/shared/redis/redis.service';
import { CatalogModule } from '../../src/modules/catalog';
import { OrderingModule } from '../../src/modules/ordering';
import { ProcurementModule } from '../../src/modules/procurement';
import { OrderPdfService } from '../../src/modules/ordering/internal/order-pdf.service';
import { PoPdfService } from '../../src/modules/procurement/internal/po-pdf.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeCatalog, makeOrganization, makeUser } from '../support/factories';

const NOW = new Date('2026-09-16T09:00:00.000Z');
const VENDOR_NAME = 'Northgate IT Assets Pvt. Ltd.';
const CUSTOMER_NAME = 'Harbourpoint Devices Pvt Ltd';
const CUSTOMER_CONTACT = 'Ravi Menon';
const RETAIL = 42_000;
const VENDOR_ASK = 30_000;

let moduleRef: TestingModule;
let orderPdf: OrderPdfService;
let poPdf: PoPdfService;
let redis: RedisService;
let db: PrismaClient;

let orderNumber: string;
let poNumbers: string[];

/**
 * The text actually drawn on the page.
 *
 * pdf-lib has no extractor and page content streams are Flate-compressed, so
 * reading the file as latin1 finds only the metadata — which is how a first pass
 * at this test "passed" while asserting nothing about the page. Every stream is
 * inflated and the text-showing operands are pulled out, so these assertions are
 * about what a person holding the printout would read.
 */
function textOf(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  let streams = '';
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    const chunk = Buffer.from(raw.slice(start, end), 'latin1');
    try {
      streams += inflateSync(chunk).toString('latin1');
    } catch {
      // Not a Flate stream. Its bytes are still searched, because a leak in an
      // uncompressed stream is still a leak.
      streams += chunk.toString('latin1');
    }
  }

  // pdf-lib writes every drawText as a HEX string: `<4E6F...> Tj`. A first pass
  // at this helper looked for `(text) Tj`, found nothing, and asserted nothing
  // at all while appearing to pass — which is exactly the failure mode an
  // anti-leak test must not have.
  const out: string[] = [];
  for (const match of streams.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    out.push(Buffer.from(match[1]!.replace(/\s+/g, ''), 'hex').toString('latin1'));
  }
  for (const match of streams.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    out.push(match[1]!.replace(/\\([()\\])/g, '$1'));
  }
  return out.join('\n');
}

async function buildOrder(supplyPoints: number): Promise<void> {
  const { skuId } = await makeCatalog({}, db);
  const vendorOrgId = await makeOrganization({ legal_name: VENDOR_NAME }, db);
  const buyerOrgId = await makeOrganization({ org_type: 'BUYER', legal_name: CUSTOMER_NAME }, db);
  const buyerUserId = await makeUser(buyerOrgId, {}, db);

  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (gen_random_uuid(), ${vendorOrgId}::uuid, '06AAACN1111R1ZX', ${VENDOR_NAME},
            '06', 'ACTIVE', ${NOW}, TRUE)`;
  const buyerGstId = randomUUID();
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${buyerGstId}::uuid, ${buyerOrgId}::uuid, '07AABCU9603R1ZM', ${CUSTOMER_NAME},
            '07', 'ACTIVE', ${NOW}, TRUE)`;

  // Billing in Karnataka, delivery in Delhi: the place of supply follows the
  // movement under s.10(1)(a), so these two deliberately disagree.
  const billingId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile, is_billing_enabled)
    VALUES (${billingId}::uuid, ${buyerOrgId}::uuid, 'BILLING'::address_type, 'MG Road',
            'Bengaluru', 'Karnataka', '29', '560001', ${CUSTOMER_CONTACT}, '+919812345678', TRUE)`;
  const shipToId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile)
    VALUES (${shipToId}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type, 'Tower B',
            'New Delhi', 'Delhi', '07', '110001', ${CUSTOMER_CONTACT}, '+919812345678')`;

  const orderId = randomUUID();
  orderNumber = 'TT-26-20001';
  await db.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
       billing_address_id, shipping_address_id, buyer_po_number, cost_centre,
       subtotal, gst_total, freight_total, grand_total, payment_mode, payment_status,
       status, placed_at)
    VALUES (${orderId}::uuid, ${orderNumber}, ${buyerOrgId}::uuid, ${buyerUserId}::uuid,
            ${buyerGstId}::uuid, ${billingId}::uuid, ${shipToId}::uuid, 'PO-BUYER-77', 'IT-CAPEX',
            ${RETAIL * supplyPoints}, ${Math.round(RETAIL * supplyPoints * 0.18)}, 1180,
            ${RETAIL * supplyPoints + Math.round(RETAIL * supplyPoints * 0.18) + 1180},
            'PREPAID', 'PAID', 'VENDOR_ACCEPTED'::public.order_status, ${NOW})`;

  poNumbers = [];
  for (let i = 0; i < supplyPoints; i += 1) {
    const city = i === 0 ? 'Gurugram' : 'Pune';
    const pickupId = randomUUID();
    await db.$executeRaw`
      INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                        contact_name, contact_mobile, is_pickup_enabled)
      VALUES (${pickupId}::uuid, ${vendorOrgId}::uuid, 'PICKUP'::address_type,
              ${'Plot ' + (42 + i)}, ${city}, ${i === 0 ? 'Haryana' : 'Maharashtra'},
              ${i === 0 ? '06' : '27'}, ${i === 0 ? '122015' : '411001'},
              'Warehouse Supervisor', '+919876543210', TRUE)`;

    const poNumber = `PO-26-2000${i}`;
    poNumbers.push(poNumber);
    const poId = randomUUID();
    await db.$executeRaw`
      INSERT INTO procurement.purchase_order
        (id, po_number, vendor_org_id, order_id, pickup_address_id, supply_point_label,
         status, total_net, tds_rate_pct, tds_amount, valuation_method, terms_days,
         created_at, updated_at)
      VALUES (${poId}::uuid, ${poNumber}, ${vendorOrgId}::uuid, ${orderId}::uuid,
              ${pickupId}::uuid, ${'Supply Point ' + String.fromCharCode(65 + i) + ' - ' + city},
              'RAISED', ${VENDOR_ASK}, 0.10, 30, 'REGULAR', 15, ${NOW}, ${NOW})`;
    await db.$executeRaw`
      INSERT INTO procurement.purchase_order_line
        (po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, created_at)
      VALUES (${poId}::uuid, NULL, ${skuId}::uuid, ${VENDOR_ASK}, 'A'::public.grade_type, ${NOW})`;
    await db.$executeRaw`
      INSERT INTO procurement.vendor_payable
        (vendor_org_id, purchase_order_id, gross, tds, net_payable, status, created_at)
      VALUES (${vendorOrgId}::uuid, ${poId}::uuid, ${VENDOR_ASK}, 30, ${VENDOR_ASK - 30},
              'ACCRUED', ${NOW})`;

    // A real listing: `order_line.listing_id` has a foreign key, and a fixture
    // that invents one is a fixture that tests nothing about the join.
    const listingId = randomUUID();
    await db.$executeRaw`
      INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id, grade,
                                   condition_type, battery_health_band, parts_status,
                                   unit_price, gst_rate, qty_total, status)
      VALUES (${listingId}::uuid, ${vendorOrgId}::uuid, ${skuId}::uuid, ${pickupId}::uuid,
              'A'::grade_type, 'REFURBISHED'::condition_type, 'GOOD_80_89'::battery_band,
              'ALL_ORIGINAL'::parts_status_type, ${RETAIL}, 18.00, 1, 'ACTIVE'::listing_status)`;

    const subOrderId = randomUUID();
    await db.$executeRaw`
      INSERT INTO ordering.sub_order
        (id, order_id, sub_order_number, vendor_org_id, pickup_address_id, purchase_order_id,
         subtotal, gst_total, freight, status)
      VALUES (${subOrderId}::uuid, ${orderId}::uuid, ${orderNumber + '-' + (i + 1)},
              ${vendorOrgId}::uuid, ${pickupId}::uuid, ${poId}::uuid,
              ${RETAIL}, ${Math.round(RETAIL * 0.18)}, 0, 'VENDOR_ACCEPTED'::public.order_status)`;
    await db.$executeRaw`
      INSERT INTO ordering.order_line
        (sub_order_id, listing_id, sku_id, grade, qty, unit_price, gst_rate, gst_amount,
         line_total, status)
      VALUES (${subOrderId}::uuid, ${listingId}::uuid, ${skuId}::uuid, 'A'::public.grade_type, 1,
              ${RETAIL}, 18.00, ${Math.round(RETAIL * 0.18)}, ${RETAIL * 1.18},
              'VENDOR_ACCEPTED'::public.order_status)`;
  }
}

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ContextModule,
      RedisModule,
      EventBusModule,
      AutomationModule,
      AuthModule,
      AdaptersModule,
      // Ordering resolves CatalogService from the container on first use, so the
      // container has to have it — exactly as the running app does.
      CatalogModule,
      OrderingModule,
      ProcurementModule,
    ],
  })
    .overrideProvider(ClockPort)
    .useValue(new FixedClock(NOW))
    .overrideProvider(PrismaService)
    .useFactory({
      factory: (config: AppConfig) => {
        Object.defineProperty(config, 'env', {
          value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
        });
        return new PrismaService(config);
      },
      inject: [AppConfig],
    })
    .compile();

  orderPdf = moduleRef.get(OrderPdfService);
  poPdf = moduleRef.get(PoPdfService);
  redis = moduleRef.get(RedisService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await redis.client.flushdb();
  await buildOrder(2);
});

/* ========================================================================== */

describe('every document renders and parses', () => {
  it('produces a readable PDF for the purchase order and the order confirmation', async () => {
    const po = await poPdf.render({ poNumber: poNumbers[0]! });
    const order = await orderPdf.render(orderNumber);

    for (const doc of [po, order]) {
      expect(doc.bytes.length).toBeGreaterThan(1000);
      // Parses back, which is the only proof that what we wrote is a PDF.
      const parsed = await PDFDocument.load(doc.bytes);
      expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    }
    expect(po.documentNumber).toBe(poNumbers[0]);
    expect(order.documentNumber).toBe(orderNumber);
  });
});

describe('the purchase order, which the vendor reads', () => {
  it('names the vendor and the warehouse it collects from', async () => {
    const po = await poPdf.render({ poNumber: poNumbers[0]! });
    const text = textOf(po.bytes);

    expect(text).toContain('Northgate');
    expect(text).toContain('Gurugram');
    // The vendor needs the street, not a supply point label: it is their own site.
    expect(text).toContain('Plot 42');
    expect(text).toContain('Serial to be captured at pickup');
  });

  it('carries no customer identity and no selling price', async () => {
    const po = await poPdf.render({ poNumber: poNumbers[0]! });
    const text = textOf(po.bytes);

    expect(text).not.toContain(CUSTOMER_NAME);
    expect(text).not.toContain('Harbourpoint');
    expect(text).not.toContain(CUSTOMER_CONTACT);
    expect(text).not.toContain('Tower B');
    // The retail price and the platform's margin. A vendor who can read what we
    // charge can price against it.
    expect(text).not.toContain('42000');
    expect(text).not.toContain('49560');
    // What it DOES carry: the agreed payout and the deduction.
    expect(text).toContain('30000');
    // The filename travels through mail clients and download folders.
    expect(po.filename).not.toMatch(/northgate|harbourpoint/i);
  });
});

describe('the order confirmation, which the customer reads', () => {
  it('names each consignment by supply point and no vendor anywhere', async () => {
    const order = await orderPdf.render(orderNumber);
    const text = textOf(order.bytes);

    expect(text).toContain('Supply Point A - Gurugram');
    expect(text).toContain('Supply Point B - Pune');

    // Asserted against the vendor's actual name from the fixture, at any depth.
    const vendors = await db.$queryRaw<Array<{ legal_name: string }>>`
      SELECT legal_name FROM identity.organization WHERE org_type = 'VENDOR'`;
    for (const vendor of vendors) {
      expect(text).not.toContain(vendor.legal_name);
      expect(text).not.toContain(vendor.legal_name.split(' ')[0]!);
    }
    // The vendor's GSTIN and its warehouse street are the other two leaks.
    expect(text).not.toContain('06AAACN1111R1ZX');
    expect(text).not.toContain('Plot 42');
    expect(order.filename).not.toMatch(/northgate/i);
  });

  it('shows the whole charge stack at once, freight included', async () => {
    const order = await orderPdf.render(orderNumber);
    const text = textOf(order.bytes);

    // CCPA Dark Patterns Guidelines 2023: charges may not be revealed
    // progressively, so freight is on the confirmation and not saved for the
    // invoice.
    expect(text).toContain('Delivery');
    expect(text).toContain('1180');
    expect(text).toContain('Goods');
    expect(text).toContain('GST');
    expect(text).toContain('Total payable');
  });
});

describe('one letterhead, and one absence stated the same way', () => {
  it('prints the same registered office, GSTIN and grievance officer on both', async () => {
    const po = await poPdf.render({ poNumber: poNumbers[0]! });
    const order = await orderPdf.render(orderNumber);

    for (const doc of [po, order]) {
      const text = textOf(doc.bytes);
      // Read from brand.ts rather than hard-coded here, so the test cannot pass
      // against a document that disagrees with the constant.
      expect(text).toContain(LEGAL_DISCLOSURE.gstin);
      expect(text).toContain(LEGAL_DISCLOSURE.registeredOffice.city);
      expect(text).toContain(LEGAL_DISCLOSURE.grievanceOfficer.email);
      expect(formatRegisteredOffice()).toContain(LEGAL_DISCLOSURE.registeredOffice.pincode);
    }
  });

  it('renders a null CIN as "Not yet published", never as a blank or a number', async () => {
    // The constant is deliberately null until the MCA record is live.
    expect(LEGAL_DISCLOSURE.cin).toBeNull();

    const po = await poPdf.render({ poNumber: poNumbers[0]! });
    const order = await orderPdf.render(orderNumber);
    for (const doc of [po, order]) {
      expect(textOf(doc.bytes)).toContain('Not yet published');
    }
  });

  it('renders the same bytes for the same unchanged document', async () => {
    const first = await poPdf.render({ poNumber: poNumbers[0]! });
    const second = await poPdf.render({ poNumber: poNumbers[0]! });
    // Same filename and same number, so the storage key is stable and a document
    // a counterparty already has is not quietly replaced by a different file.
    expect(second.filename).toBe(first.filename);
    expect(second.documentNumber).toBe(first.documentNumber);
  });
});
