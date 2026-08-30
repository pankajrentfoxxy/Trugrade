/**
 * T22 — the buyer's tax invoice, against the real database.
 *
 * Two of the properties below cannot be checked by reading the source once, and
 * both are the kind of failure that is silent until somebody official asks.
 *
 *   1. **The invoice series is gapless and has no duplicates, under
 *      concurrency.** A gap in a GST invoice series is a question you are asked
 *      in an audit; a duplicate is worse. `payment.next_invoice_number` takes
 *      `FOR UPDATE` on the counter row, and "the lock is there" is not evidence
 *      that it holds — so the test below actually RACES eight issuances through
 *      eight real transactions and asserts the eight numbers it gets back are
 *      1..8 with nothing missing and nothing repeated. A version of this that
 *      asserted the function exists would pass against an implementation that
 *      read `last_number` outside the transaction.
 *
 *   2. **No vendor identity anywhere in the file.** We are the principal and the
 *      merchant of record; the buyer never learns who supplied the machine.
 *      "Anywhere" is the hard part, so the sweep reads the raw bytes, inflates
 *      every compressed stream, decodes the hex strings PDF text is written as,
 *      and greps all of it plus the filename and the document metadata. The
 *      vendor's legal name, trade name, GSTIN and org id are all planted in the
 *      database the invoice is built from, so the sweep is testing a real path.
 *      Our own PURCHASE price is swept for too: it is stored on the invoice line
 *      because Rule 32(5) requires a margin line to show its working to us, and
 *      it must not be on the document.
 *
 * Every suite attempts the forbidden thing and expects the refusal — a foreign
 * organisation actually asks for the invoice and is told the order does not
 * exist. There is no `expect(guard).toBeDefined()` below.
 */

import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { findForbiddenKeys, Money, permissionsFor, type Role } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import {
  ContextModule,
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { AuthModule } from '../../src/shared/auth/auth.module';
import { EventBusModule } from '../../src/shared/events/event-bus';
import { RedisModule, RedisService } from '../../src/shared/redis/redis.service';
import { NotFoundError, PreconditionFailedError } from '../../src/shared/errors/domain-errors';
import { CatalogModule } from '../../src/modules/catalog';
import { OrderingModule } from '../../src/modules/ordering';
import { CheckoutService } from '../../src/modules/ordering/internal/checkout.service';
import { OrderDocumentsService } from '../../src/modules/ordering/internal/order-documents.service';
import { InvoiceRepository } from '../../src/modules/payment/internal/invoice.repository';
import { ObjectStorePort } from '../../src/shared/adapters/ports';
import { seedLogisticsNcr } from '../../prisma/seed/logistics-ncr';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeCatalog, makeOrganization, makeTechnician, makeUser } from '../support/factories';

/** A real instant with the DATE tracking today — `order_event` is partitioned. */
const NOW = new Date(new Date().toISOString().slice(0, 10) + 'T09:00:00.000Z');

const HARYANA = { city: 'Gurugram', state: 'Haryana', stateCode: '06', pincode: '122015' };
/** Delhi. Different state from ours, so leg 2 is IGST — the inter-state case. */
const DELHI = { city: 'New Delhi', state: 'Delhi', stateCode: '07', pincode: '110001' };

const RETAIL = 42_000;
const VENDOR_ASK = 30_000;

/**
 * The supplier nobody buying a laptop is allowed to learn about. Every string is
 * planted somewhere the invoice path reads from, so the sweep tests a real path
 * rather than an imaginary one.
 */
const VENDOR = {
  legalName: 'Northwind Refurb Traders Private Limited',
  tradeName: 'Northwind Devices',
  gstin: '06AABCN1234M1Z7',
};

/** Our own registration. Synthetic, and it passes its own check digit. */
const PLATFORM_GSTIN = '06AAJCT2846R1ZL';

let moduleRef: TestingModule;
let checkout: CheckoutService;
let documents: OrderDocumentsService;
let store: ObjectStorePort;
let repo: InvoiceRepository;
let ctx: RequestContextService;
let redis: RedisService;
let prisma: PrismaService;
let db: PrismaClient;

let platformOrgId: string;
let buyerOrgId: string;
let buyerUserId: string;
let gstProfileId: string;
let haryanaSiteId: string;
let delhiSiteId: string;
let skuId: string;
let technician: { technicianId: string; userId: string };
let vendorOrgId: string;

/* ==========================================================================
 * Fixtures
 * ======================================================================== */

function asBuyer<T>(fn: () => Promise<T>, orgId = buyerOrgId, userId = buyerUserId): Promise<T> {
  const roles: Role[] = ['CUSTOMER_OWNER'];
  return runAs(fn, {
    userId,
    orgId,
    orgType: 'BUYER',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 's',
    mfaSatisfied: true,
  });
}

function asPlatform<T>(fn: () => Promise<T>): Promise<T> {
  const roles: Role[] = ['FINANCE'];
  return runAs(fn, {
    userId: randomUUID(),
    orgId: platformOrgId,
    orgType: 'PLATFORM',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 's',
    mfaSatisfied: true,
  });
}

function runAs<T>(fn: () => Promise<T>, principal: Principal): Promise<T> {
  return ctx.run({ requestId: randomUUID() }, () => {
    ctx.setPrincipal(principal);
    return fn();
  });
}

async function makeVendor(): Promise<string> {
  const orgId = await makeOrganization({ legal_name: VENDOR.legalName }, db);
  await db.$executeRaw`
    UPDATE identity.organization SET trade_name = ${VENDOR.tradeName} WHERE id = ${orgId}::uuid`;
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (org_id, gstin, legal_name_as_per_gst, state_code, status,
                                 api_verified_at, is_primary)
    VALUES (${orgId}::uuid, ${VENDOR.gstin}, ${VENDOR.legalName}, '06', 'ACTIVE', ${NOW}, TRUE)`;
  await db.$executeRaw`
    INSERT INTO kyc.pan_record (org_id, pan_enc, pan_last4, pan_hash, verified)
    VALUES (${orgId}::uuid, '\\x00'::bytea, '1234', ${randomUUID()}, TRUE)`;
  return orgId;
}

async function makePickup(orgId: string): Promise<string> {
  const addressId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile, is_pickup_enabled)
    VALUES (${addressId}::uuid, ${orgId}::uuid, 'PICKUP'::address_type, 'Plot 42, Udyog Vihar',
            ${HARYANA.city}, ${HARYANA.state}, ${HARYANA.stateCode}, ${HARYANA.pincode},
            'Warehouse Supervisor', '+919876543210', TRUE)`;
  return addressId;
}

/** A listing with `qty` genuinely sellable machines behind it. */
async function makeOffer(input: {
  vendorOrgId: string;
  pickupAddressId: string;
  qty: number;
  valuationMethod?: 'REGULAR' | 'MARGIN';
}): Promise<{ listingId: string; serials: string[] }> {
  const listingId = randomUUID();
  await db.$executeRaw`
    INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id, grade,
                                 condition_type, battery_health_band, parts_status,
                                 unit_price, gst_rate, qty_total, status)
    VALUES (${listingId}::uuid, ${input.vendorOrgId}::uuid, ${skuId}::uuid,
            ${input.pickupAddressId}::uuid, 'A'::grade_type, 'REFURBISHED'::condition_type,
            'GOOD_80_89'::battery_band, 'ALL_ORIGINAL'::parts_status_type,
            ${RETAIL}, 18.00, ${input.qty}, 'ACTIVE'::listing_status)`;

  const [{ code } = { code: '' }] = await db.$queryRaw<Array<{ code: string }>>`
    SELECT listing.assign_supply_point(${input.vendorOrgId}::uuid, ${HARYANA.city}) AS code`;

  const method = input.valuationMethod ?? 'REGULAR';
  const serials: string[] = [];
  for (let i = 0; i < input.qty; i += 1) {
    const unitId = randomUUID();
    const serial = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
    await db.$executeRaw`
      INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, grade_actual, status, location,
                                qc_passed_at, qc_valid_until, vendor_ask_price,
                                valuation_method, itc_eligible, retail_price, supply_point_code)
      VALUES (${unitId}::uuid, ${listingId}::uuid, ${input.vendorOrgId}::uuid, ${skuId}::uuid,
              ${serial}, 'A'::grade_type, 'A'::grade_type, 'LISTED'::unit_status, 'VENDOR',
              ${NOW}, CURRENT_DATE + 60, ${VENDOR_ASK}::numeric, ${method},
              ${method === 'REGULAR'}, ${RETAIL}::numeric, ${code})`;

    const qcReportId = randomUUID();
    await db.$executeRaw`
      INSERT INTO qc.qc_report (id, unit_id, technician_id, device_cert_id, agent_version,
                                started_at, completed_at, signature, nonce, grade_final,
                                qc_score, verdict, valid_until, is_current)
      VALUES (${qcReportId}::uuid, ${unitId}::uuid, ${technician.technicianId}::uuid,
              ${'CERT-' + qcReportId.slice(0, 8)}, '2.3.1', ${NOW}, ${NOW},
              ${'sig_' + qcReportId}, ${randomUUID()}, 'A'::grade_type, 92,
              'PASS'::qc_verdict, CURRENT_DATE + 60, TRUE)`;
    const sealId = randomUUID();
    await db.$executeRaw`
      INSERT INTO qc.qc_seal (id, unit_id, qc_report_id, seal_code, applied_by, status,
                              applied_at, applied_photo_key)
      VALUES (${sealId}::uuid, ${unitId}::uuid, ${qcReportId}::uuid,
              ${'TRG-26HR-' + String(Math.floor(Math.random() * 9_999_999)).padStart(7, '0')},
              ${technician.technicianId}::uuid, 'APPLIED'::seal_status, ${NOW},
              ${'qc/seals/' + unitId + '.jpg'})`;
    await db.$executeRaw`
      UPDATE listing.unit SET seal_id = ${sealId}::uuid, qc_report_id = ${qcReportId}::uuid
       WHERE id = ${unitId}::uuid`;
    serials.push(serial);
  }
  return { listingId, serials };
}

/** Place a real order through the real transaction. */
async function placeOrder(
  listingId: string,
  qty: number,
  siteId = haryanaSiteId,
): Promise<{ orderNumber: string }> {
  const cartId = randomUUID();
  await db.$executeRaw`
    INSERT INTO ordering.cart (id, buyer_org_id, user_id, name, status)
    VALUES (${cartId}::uuid, ${buyerOrgId}::uuid, ${buyerUserId}::uuid,
            ${'Cart ' + cartId.slice(0, 6)}, 'OPEN')`;
  await db.$executeRaw`
    INSERT INTO ordering.cart_item (cart_id, listing_id, qty, unit_price_snapshot)
    VALUES (${cartId}::uuid, ${listingId}::uuid, ${qty}, ${RETAIL}::numeric)`;

  const confirmed = await asBuyer(() =>
    checkout.confirm({
      cartId,
      gstProfileId,
      billingAddressId: siteId,
      deliveryAddressId: siteId,
      paymentMode: 'PREPAID',
    }),
  );
  return { orderNumber: confirmed.orderNumber! };
}

/** What a pickup would do to the order. The trigger for s.31(1)(a) issuance. */
async function dispatch(orderNumber: string): Promise<void> {
  await db.$executeRaw`
    UPDATE ordering.sub_order SET status = 'DISPATCHED'::public.order_status
     WHERE order_id = (SELECT id FROM ordering."order" WHERE order_number = ${orderNumber})`;
}

async function configureSeller(): Promise<void> {
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (org_id, gstin, legal_name_as_per_gst, state_code, status,
                                 api_verified_at, is_primary)
    VALUES (${platformOrgId}::uuid, ${PLATFORM_GSTIN}, 'TrueTech Services Pvt. Ltd.', '06',
            'ACTIVE', ${NOW}, TRUE)`;
  await db.$executeRaw`
    INSERT INTO payment.invoice_series (gstin, financial_year, prefix, last_number)
    VALUES (${PLATFORM_GSTIN}, ${financialYear()}, 'TT', 0)`;
}

/** The Indian tax year `NOW` falls in, as the series row spells it. */
function financialYear(): string {
  const year = NOW.getUTCFullYear();
  const start = NOW.getUTCMonth() + 1 >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/* ==========================================================================
 * Boot
 * ======================================================================== */

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
      AuthModule,
      AdaptersModule,
      CatalogModule,
      OrderingModule,
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

  checkout = moduleRef.get(CheckoutService);
  documents = moduleRef.get(OrderDocumentsService);
  store = moduleRef.get(ObjectStorePort);
  repo = moduleRef.get(InvoiceRepository);
  ctx = moduleRef.get(RequestContextService);
  redis = moduleRef.get(RedisService);
  prisma = moduleRef.get(PrismaService);
  await prisma.$connect();
});

afterAll(async () => {
  await prisma?.$disconnect();
  await moduleRef?.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await seedLogisticsNcr(db);
  await redis.client.flushdb();

  platformOrgId = await makeOrganization(
    { org_type: 'INTERNAL', legal_name: 'TrueTech Services Pvt. Ltd.' },
    db,
  );
  buyerOrgId = await makeOrganization(
    { org_type: 'BUYER', legal_name: 'Acme Industries Pvt Ltd' },
    db,
  );
  buyerUserId = await makeUser(buyerOrgId, { full_name: 'Priya Sharma' }, db);
  technician = await makeTechnician(db);
  skuId = (await makeCatalog({}, db)).skuId;
  vendorOrgId = await makeVendor();

  gstProfileId = randomUUID();
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid, '06AABCU9603R1ZM',
            'Acme Industries Pvt Ltd', '06', 'ACTIVE', ${NOW}, TRUE)`;

  const site = async (place: typeof HARYANA): Promise<string> => {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO identity.org_address (id, org_id, type, label, line1, city, state, state_code,
                                        pincode, contact_name, contact_mobile, is_default,
                                        is_billing_enabled)
      VALUES (${id}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type,
              ${place.city + ' office'}, 'Tower B, 4th floor', ${place.city}, ${place.state},
              ${place.stateCode}, ${place.pincode}, 'Ravi Menon', '+919812345678',
              ${place.stateCode === '06'}, TRUE)`;
    return id;
  };
  haryanaSiteId = await site(HARYANA);
  delhiSiteId = await site(DELHI);

  await db.$executeRaw`
    INSERT INTO customer.buyer_profile (org_id, credit_limit, credit_used, payment_mode_allowed)
    VALUES (${buyerOrgId}::uuid, 0, 0, ARRAY['PREPAID']::public.payment_mode[])`;
  await db.$executeRaw`
    INSERT INTO customer.org_preference (org_id, po_required, default_shipping_address_id)
    VALUES (${buyerOrgId}::uuid, FALSE, ${haryanaSiteId}::uuid)`;
});

/* ==========================================================================
 * PAY-T22-01 — the series is gapless and unique, under a real race
 * ======================================================================== */

describe('the invoice series', () => {
  it('hands eight concurrent issuers eight consecutive numbers, with no gap and no duplicate', async () => {
    await configureSeller();
    const vendor = { orgId: vendorOrgId, addressId: await makePickup(vendorOrgId) };
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const { orderNumber } = await placeOrder(offer.listingId, 1);
    const [subOrder] = await db.$queryRaw<Array<{ id: string }>>`
      SELECT so.id FROM ordering.sub_order so
        JOIN ordering."order" o ON o.id = so.order_id
       WHERE o.order_number = ${orderNumber}`;

    const write = {
      subOrderId: subOrder!.id,
      issuerOrgId: platformOrgId,
      recipientOrgId: buyerOrgId,
      invoiceDate: NOW.toISOString().slice(0, 10),
      placeOfSupply: '06',
      taxableValue: '1000.00',
      cgst: '90.00',
      sgst: '90.00',
      igst: '0.00',
      total: '1180.00',
      valuationMethod: 'REGULAR' as const,
      lines: [],
    };

    // THE RACE. Eight real transactions, started together, each allocating a
    // number and inserting a row. If `next_invoice_number` read `last_number`
    // outside the lock, two of these would come back with the same number and
    // `UNIQUE (invoice_number)` would reject one — or, worse, a retry loop
    // somewhere would quietly skip one and leave a hole.
    const issued = await Promise.all(
      Array.from({ length: 8 }, () =>
        asPlatform(() => repo.insertTaxInvoice(write, PLATFORM_GSTIN, financialYear())),
      ),
    );

    const numbers = issued.map((i) => i.invoiceNumber).sort();
    expect(new Set(numbers).size).toBe(8);
    expect(numbers).toEqual(
      Array.from({ length: 8 }, (_, i) => `TT/${financialYear()}/${String(i + 1).padStart(5, '0')}`),
    );

    const [counter] = await db.$queryRaw<Array<{ last_number: number }>>`
      SELECT last_number FROM payment.invoice_series WHERE gstin = ${PLATFORM_GSTIN}`;
    expect(counter!.last_number).toBe(8);
  });

  it('refuses to invent a number when no series is configured for the year', async () => {
    // Our GSTIN exists; the series row does not. Deriving one on first use is
    // how a business ends up with two series it cannot explain, so the refusal
    // is the feature.
    await db.$executeRaw`
      INSERT INTO kyc.gst_profile (org_id, gstin, legal_name_as_per_gst, state_code, status,
                                   api_verified_at, is_primary)
      VALUES (${platformOrgId}::uuid, ${PLATFORM_GSTIN}, 'TrueTech Services Pvt. Ltd.', '06',
              'ACTIVE', ${NOW}, TRUE)`;
    const vendor = { orgId: vendorOrgId, addressId: await makePickup(vendorOrgId) };
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const { orderNumber } = await placeOrder(offer.listingId, 1);
    await dispatch(orderNumber);

    await expect(asPlatform(() => documents.issue(orderNumber))).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    const [count] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM payment.invoice`;
    expect(Number(count!.n)).toBe(0);
  });
});

/* ==========================================================================
 * PAY-T22-02 — when an invoice exists, and when it does not
 * ======================================================================== */

describe('issuing', () => {
  it('raises nothing until the machines have left, then exactly one per consignment', async () => {
    await configureSeller();
    const vendor = { orgId: vendorOrgId, addressId: await makePickup(vendorOrgId) };
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 2,
    });
    const { orderNumber } = await placeOrder(offer.listingId, 2);

    // s.31(1)(a): the tax invoice is issued at REMOVAL of the goods. Nothing has
    // been picked, so nothing is billed — and the screen says so rather than
    // showing a dead download.
    expect(await asPlatform(() => documents.issue(orderNumber))).toEqual([]);
    const before = await asBuyer(() => documents.byOrderNumber(orderNumber));
    const taxRowBefore = before.documents.find((d) => d.kind === 'TAX_INVOICE')!;
    expect(taxRowBefore.status).toBe('AWAITED');
    expect(taxRowBefore.downloadPath).toBeNull();
    expect(taxRowBefore.whenItWillExist).toContain('leave the supply point');

    await dispatch(orderNumber);
    const issued = await asPlatform(() => documents.issue(orderNumber));
    expect(issued).toHaveLength(1);

    // Idempotent by consignment. A second press must not spend another number:
    // a number consumed by a duplicate is a gap the moment the duplicate goes.
    expect(await asPlatform(() => documents.issue(orderNumber))).toEqual([]);
    const [count] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM payment.invoice`;
    expect(Number(count!.n)).toBe(1);

    const after = await asBuyer(() => documents.byOrderNumber(orderNumber));
    const taxRow = after.documents.find((d) => d.kind === 'TAX_INVOICE')!;
    expect(taxRow.status).toBe('ISSUED');
    expect(taxRow.documentNumber).toBe(issued[0]!.invoiceNumber);
    expect(taxRow.downloadPath).not.toBeNull();
  });

  it('bills a MARGIN machine on its margin, not on its sale price (Rule 32(5))', async () => {
    await configureSeller();
    const vendor = { orgId: vendorOrgId, addressId: await makePickup(vendorOrgId) };
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
      valuationMethod: 'MARGIN',
    });
    const { orderNumber } = await placeOrder(offer.listingId, 1);
    await dispatch(orderNumber);
    await asPlatform(() => documents.issue(orderNumber));

    const [invoice] = await db.$queryRaw<
      Array<{ taxable_value: string; valuation_method: string; total: string }>
    >`
      SELECT taxable_value::text, valuation_method, total::text FROM payment.invoice`;
    expect(invoice!.valuation_method).toBe('MARGIN');

    // The margin is (sale - purchase) per serial, plus freight which is taxed in
    // full because Rule 32(5) values the second-hand GOODS and not the carriage.
    // If this ever equals RETAIL + freight, the margin scheme has been dropped
    // and the buyer is being over-charged tax on somebody's whole laptop.
    const [line] = await db.$queryRaw<Array<{ margin_value: string; purchase_price: string }>>`
      SELECT margin_value::text, purchase_price::text FROM payment.invoice_line`;
    expect(Money.parse(line!.margin_value)).toEqual(Money.rupees(RETAIL - VENDOR_ASK));
    expect(Money.parse(line!.purchase_price)).toEqual(Money.rupees(VENDOR_ASK));
    expect(Money.parse(invoice!.taxable_value).paise).toBeLessThan(Money.rupees(RETAIL).paise);
  });
});

/* ==========================================================================
 * PAY-T22-03 — another organisation asks for the invoice
 * ======================================================================== */

describe('an organisation that is not the recipient', () => {
  it('is told the order does not exist, and cannot fetch the invoice by its id either', async () => {
    await configureSeller();
    const vendor = { orgId: vendorOrgId, addressId: await makePickup(vendorOrgId) };
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const { orderNumber } = await placeOrder(offer.listingId, 1);
    await dispatch(orderNumber);
    const [issued] = await asPlatform(() => documents.issue(orderNumber));

    const otherOrgId = await makeOrganization(
      { org_type: 'BUYER', legal_name: 'Someone Else Pvt Ltd' },
      db,
    );
    const otherUserId = await makeUser(otherOrgId, { full_name: 'Interloper' }, db);

    // 404, not 403. Order numbers are sequential, so "you may not see
    // TT-26-00004" confirms it exists and turns the route into an order-volume
    // oracle for anyone with an account. T17 established this.
    await expect(
      asBuyer(() => documents.byOrderNumber(orderNumber), otherOrgId, otherUserId),
    ).rejects.toBeInstanceOf(NotFoundError);

    // And the invoice id itself, which they might have from anywhere. The scope
    // is welded into the repository's WHERE, not checked after the fetch.
    await expect(
      asBuyer(() => repo.findById(issued!.invoiceId), otherOrgId, otherUserId),
    ).resolves.toBeNull();

    // The rightful recipient still gets it, so the test above is proving a
    // refusal rather than a broken query.
    await expect(asBuyer(() => repo.findById(issued!.invoiceId))).resolves.not.toBeNull();
  });
});

/* ==========================================================================
 * PAY-T22-04 — the anti-leak sweep, in the JSON and in the PDF bytes
 * ======================================================================== */

describe('the document a buyer receives', () => {
  it('carries no vendor identity and no purchase price, in the payload or in the file', async () => {
    await configureSeller();
    const vendor = { orgId: vendorOrgId, addressId: await makePickup(vendorOrgId) };
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 2,
    });
    // Delivered in Delhi against a Haryana registration: inter-state, so the
    // invoice carries IGST. The sweep runs on the harder of the two shapes.
    const { orderNumber } = await placeOrder(offer.listingId, 2, delhiSiteId);
    await dispatch(orderNumber);
    const [issued] = await asPlatform(() => documents.issue(orderNumber));

    const view = await asBuyer(() => documents.byOrderNumber(orderNumber));
    expect(findForbiddenKeys(view)).toEqual([]);

    const json = JSON.stringify(view);
    for (const forbidden of [VENDOR.legalName, VENDOR.tradeName, VENDOR.gstin, vendorOrgId]) {
      expect(json).not.toContain(forbidden);
    }

    // The real download path: it mints the signed object token, writes the
    // audit row, and leaves the rendered bytes in the object store under a key
    // that names the invoice and nothing else.
    const download = await asBuyer(() => documents.download(orderNumber, issued!.invoiceId));
    expect(download.url).toContain('/api/objects/');
    // NOT a presigned URL: the key is encrypted into the token, because a key
    // path is where a supplier slug leaks (PHASE_05 Task 1).
    expect(download.url).not.toContain('invoices/');

    // §3A.3: every download writes an `audit_log` row. One row per download, not
    // one per page view — the list above was read three times and wrote none.
    const [audited] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM identity.audit_log
       WHERE action = 'payment.document.downloaded'`;
    expect(Number(audited!.n)).toBe(1);

    const bytes = await store.get(`invoices/${issued!.invoiceId}.pdf`);
    const haystack = [
      extract(bytes),
      download.filename.toLowerCase(),
      await metadata(bytes),
    ].join('\n');

    for (const forbidden of [
      VENDOR.legalName,
      VENDOR.tradeName,
      VENDOR.gstin,
      vendorOrgId,
      // Our cost. Stored on the line because Rule 32(5) needs it; never printed.
      String(VENDOR_ASK),
      'vendor',
      'supplier',
      'sub_order',
      'purchase order',
    ]) {
      expect(haystack).not.toContain(forbidden.toLowerCase());
    }

    // Positive assertions, so the sweep proves an absence rather than grepping
    // an empty haystack. A test that greps nothing passes forever.
    expect(haystack).toContain(offer.serials[0]!.toLowerCase());
    expect(haystack).toContain(issued!.invoiceNumber.toLowerCase());
    expect(haystack).toContain(PLATFORM_GSTIN.toLowerCase());
    expect(haystack).toContain('igst');
  });
});

/* ==========================================================================
 * Reading a PDF back
 * ======================================================================== */

/**
 * Everything legible in the file, lower-cased: the raw bytes, every inflated
 * stream, and the hex strings PDF text is written as.
 *
 * The raw bytes alone would prove nothing — page content is Flate-compressed and
 * text inside it is hex-encoded, so a supplier's name could sit in a file that a
 * naive `bytes.includes(name)` swears is clean.
 */
function extract(bytes: Buffer): string {
  const parts = [bytes.toString('latin1'), inflated(bytes)];
  const hex = /<([0-9A-Fa-f]{2,})>/g;
  for (const part of [...parts]) {
    let match: RegExpExecArray | null;
    while ((match = hex.exec(part)) !== null) {
      parts.push(Buffer.from(match[1]!, 'hex').toString('latin1'));
    }
  }
  return parts.join('\n').toLowerCase();
}

function inflated(bytes: Buffer): string {
  const text = bytes.toString('latin1');
  const starts = /stream\r?\n/g;
  let out = '';
  let match: RegExpExecArray | null;
  while ((match = starts.exec(text)) !== null) {
    const from = match.index + match[0].length;
    const to = text.indexOf('endstream', from);
    if (to < 0) continue;
    try {
      out += `\n${inflateSync(Buffer.from(text.slice(from, to), 'latin1')).toString('latin1')}`;
    } catch {
      // Not a Flate stream. Not what this is reading.
    }
  }
  return out;
}

/** Title/Author/Subject/Producer/Creator, read back through a parser. */
async function metadata(bytes: Buffer): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  return [
    doc.getTitle(),
    doc.getAuthor(),
    doc.getSubject(),
    doc.getProducer(),
    doc.getCreator(),
    (doc.getKeywords() ?? '').toString(),
  ]
    .join('\n')
    .toLowerCase();
}
