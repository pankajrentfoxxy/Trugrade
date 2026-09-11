import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { financialYearOf } from '@trugrade/contracts';
import { generateVerificationCode } from '../../src/modules/qc/internal/qc.repository';

/**
 * Purchase orders for the Northgate demo vendor — T of `/vendor/orders`.
 *
 * Checkout is what raises a PO in production (`order-transaction.service.ts`
 * `raisePurchaseOrder`). The demo database already has ten of those, all
 * against other supply points, so `owner@northgate.example` opens an empty
 * board. These rows follow the same columns that write path writes — order,
 * sub-order, line, allocated serial, PO, payable, TDS — against Northgate's
 * own listed machines, so the vendor board and the record have something real
 * to show. Open POs (RAISED, ACKNOWLEDGED) leave the line vacant — the vendor
 * attaches a matching machine from their listings. Settled POs keep the unit.
 *
 * Idempotent on the machines: a unit already on a PO line is skipped. Re-running
 * after a reset therefore fills the board again; re-running against a filled
 * board writes nothing.
 */

const NORTHGATE_OWNER = 'owner@northgate.example';
const BUYER_EMAIL = 'buyer@acme.example';

interface FreeUnit {
  id: string;
  serial_number: string;
  listing_id: string;
  sku_id: string;
  grade: string;
  vendor_ask_price: string;
  retail_price: string;
  qc_report_id: string | null;
  valuation_method: string;
}

interface PoSpec {
  status: 'RAISED' | 'ACKNOWLEDGED' | 'DISPATCHED';
  units: number;
}

const BATCHES: readonly PoSpec[] = [
  { status: 'RAISED', units: 1 },
  { status: 'RAISED', units: 2 },
  { status: 'ACKNOWLEDGED', units: 1 },
  { status: 'DISPATCHED', units: 2 },
];

/** Extra RAISED POs for the accept-then-attach walk, without the rest of the board. */
const RAISED_BATCHES: readonly PoSpec[] = [
  { status: 'RAISED', units: 1 },
  { status: 'RAISED', units: 2 },
];

export async function seedNorthgatePurchaseOrders(
  prisma: PrismaClient,
  now: Date,
  log: (m: string) => void = () => undefined,
): Promise<void> {
  const [vendor] = await prisma.$queryRaw<Array<{ org_id: string }>>`
    SELECT u.org_id FROM identity.user_account u
     WHERE u.email = ${NORTHGATE_OWNER}`;
  if (!vendor) {
    log(`  ${NORTHGATE_OWNER} is not on this database — run the demo seed first`);
    return;
  }

  const [buyer] = await prisma.$queryRaw<
    Array<{ user_id: string; org_id: string; gst_id: string; address_id: string }>
  >`
    SELECT ua.id AS user_id, ua.org_id,
           (SELECT g.id FROM kyc.gst_profile g
             WHERE g.org_id = ua.org_id AND g.is_primary LIMIT 1) AS gst_id,
           (SELECT a.id FROM identity.org_address a
             WHERE a.org_id = ua.org_id AND a.type = 'SHIPPING' AND a.is_active
             ORDER BY a.is_default DESC, a.created_at
             LIMIT 1) AS address_id
      FROM identity.user_account ua
     WHERE ua.email = ${BUYER_EMAIL}`;
  if (!buyer?.gst_id || !buyer.address_id) {
    log(`  ${BUYER_EMAIL} is not checkout-ready — run the demo seed first`);
    return;
  }

  await raiseBatches(prisma, now, log, vendor.org_id, buyer, BATCHES);
}

/** RAISED POs only — so the owner can accept, then attach. */
export async function seedNorthgateRaisedPurchaseOrders(
  prisma: PrismaClient,
  now: Date,
  log: (m: string) => void = () => undefined,
): Promise<void> {
  const [vendor] = await prisma.$queryRaw<Array<{ org_id: string }>>`
    SELECT u.org_id FROM identity.user_account u
     WHERE u.email = ${NORTHGATE_OWNER}`;
  if (!vendor) {
    log(`  ${NORTHGATE_OWNER} is not on this database — run the demo seed first`);
    return;
  }

  const [buyer] = await prisma.$queryRaw<
    Array<{ user_id: string; org_id: string; gst_id: string; address_id: string }>
  >`
    SELECT ua.id AS user_id, ua.org_id,
           (SELECT g.id FROM kyc.gst_profile g
             WHERE g.org_id = ua.org_id AND g.is_primary LIMIT 1) AS gst_id,
           (SELECT a.id FROM identity.org_address a
             WHERE a.org_id = ua.org_id AND a.type = 'SHIPPING' AND a.is_active
             ORDER BY a.is_default DESC, a.created_at
             LIMIT 1) AS address_id
      FROM identity.user_account ua
     WHERE ua.email = ${BUYER_EMAIL}`;
  if (!buyer?.gst_id || !buyer.address_id) {
    log(`  ${BUYER_EMAIL} is not checkout-ready — run the demo seed first`);
    return;
  }

  await raiseBatches(prisma, now, log, vendor.org_id, buyer, RAISED_BATCHES);
}

async function listedFree(prisma: PrismaClient, vendorOrgId: string, limit: number): Promise<FreeUnit[]> {
  return prisma.$queryRaw<FreeUnit[]>`
    SELECT u.id, u.serial_number, u.listing_id, u.sku_id,
           coalesce(u.grade_actual, u.grade_declared)::text AS grade,
           u.vendor_ask_price::text AS vendor_ask_price,
           u.retail_price::text AS retail_price,
           u.qc_report_id, u.valuation_method
      FROM listing.unit u
     WHERE u.vendor_org_id = ${vendorOrgId}::uuid
       AND u.is_sellable
       AND u.purchase_price IS NULL
       AND u.vendor_ask_price IS NOT NULL AND u.vendor_ask_price > 0
       AND u.listing_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM procurement.purchase_order_line l WHERE l.unit_id = u.id)
     ORDER BY u.serial_number
     LIMIT ${limit}`;
}

/**
 * Northgate's listed stock was already reserved by earlier demo orders. List
 * waiting machines of one SKU + grade so a RAISED PO has something to attach.
 */
async function ensureListedStock(
  prisma: PrismaClient,
  vendorOrgId: string,
  needed: number,
  now: Date,
  log: (m: string) => void,
): Promise<void> {
  const free = await listedFree(prisma, vendorOrgId, needed);
  if (free.length >= needed) return;

  const [tech] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM qc.qc_technician LIMIT 1`;
  if (!tech) {
    log('  no QC technician on this database — cannot list waiting machines');
    return;
  }

  const short = needed - free.length;
  const awaiting = await prisma.$queryRaw<FreeUnit[]>`
    SELECT u.id, u.serial_number, u.listing_id, u.sku_id,
           coalesce(u.grade_actual, u.grade_declared)::text AS grade,
           u.vendor_ask_price::text AS vendor_ask_price,
           u.retail_price::text AS retail_price,
           u.qc_report_id, u.valuation_method
      FROM listing.unit u
     WHERE u.vendor_org_id = ${vendorOrgId}::uuid
       AND u.status = 'AWAITING_QC'::public.unit_status
       AND u.listing_id IS NOT NULL
       AND u.vendor_ask_price IS NOT NULL AND u.vendor_ask_price > 0
       AND u.qc_report_id IS NULL
       AND (u.sku_id, coalesce(u.grade_actual, u.grade_declared)::text) = (
         SELECT u2.sku_id, coalesce(u2.grade_actual, u2.grade_declared)::text
           FROM listing.unit u2
          WHERE u2.vendor_org_id = ${vendorOrgId}::uuid
            AND u2.status = 'AWAITING_QC'::public.unit_status
            AND u2.listing_id IS NOT NULL
            AND u2.vendor_ask_price IS NOT NULL AND u2.vendor_ask_price > 0
            AND u2.qc_report_id IS NULL
          GROUP BY 1, 2
          ORDER BY count(*) DESC
          LIMIT 1
       )
     ORDER BY u.serial_number
     LIMIT ${short}`;

  for (const unit of awaiting) {
    await listWaitingUnit(prisma, unit, tech.id, now);
    log(`  listed ${unit.serial_number} so a raised PO has a machine to attach`);
  }
}

async function listWaitingUnit(
  prisma: PrismaClient,
  unit: FreeUnit,
  technicianId: string,
  now: Date,
): Promise<void> {
  const reportId = randomUUID();
  const sealId = randomUUID();
  const score = 88;
  await prisma.$executeRaw`
    INSERT INTO qc.qc_report
      (id, unit_id, technician_id, device_cert_id, agent_version, started_at, completed_at,
       signature, nonce, qc_score, verdict, grade_proposed, grade_final,
       verification_code, valid_until, is_current, rules_version)
    VALUES (${reportId}::uuid, ${unit.id}::uuid, ${technicianId}::uuid,
            ${'CERT-' + unit.serial_number}, '0.1.0', ${now}, ${now},
            'demo-sig', ${randomUUID()}, ${score}, 'PASS'::public.qc_verdict,
            ${unit.grade}::public.grade_type, ${unit.grade}::public.grade_type,
            ${generateVerificationCode()}, CURRENT_DATE + 87, TRUE, '2026.08')`;

  await prisma.$executeRaw`
    INSERT INTO qc.qc_hardware_detected
      (qc_report_id, hw_serial, hw_model, ram_detected_gb, battery_health_pct, smart_status)
    VALUES (${reportId}::uuid, ${unit.serial_number}, ${unit.serial_number}, 16, 90, 'OK')`;

  await prisma.$executeRaw`
    INSERT INTO qc.qc_seal
      (id, seal_code, unit_id, qc_report_id, applied_by, applied_at, applied_photo_key, status)
    VALUES (${sealId}::uuid, ${'TG-' + unit.serial_number}, ${unit.id}::uuid,
            ${reportId}::uuid, ${technicianId}::uuid, ${now},
            ${'qc/seals/' + unit.serial_number + '.svg'}, 'APPLIED'::public.seal_status)`;

  await prisma.$executeRaw`
    UPDATE listing.unit
       SET seal_id = ${sealId}::uuid,
           qc_report_id = ${reportId}::uuid,
           qc_passed_at = ${now},
           qc_valid_until = CURRENT_DATE + 87,
           qc_score = ${score},
           status = 'LISTED'::public.unit_status
     WHERE id = ${unit.id}::uuid`;
}

async function raiseBatches(
  prisma: PrismaClient,
  now: Date,
  log: (m: string) => void,
  vendorOrgId: string,
  buyer: { user_id: string; org_id: string; gst_id: string; address_id: string },
  batches: readonly PoSpec[],
): Promise<void> {
  const needed = batches.reduce((n, b) => n + b.units, 0);
  await ensureListedStock(prisma, vendorOrgId, needed, now, log);

  const free = await listedFree(prisma, vendorOrgId, needed);
  if (free.length < needed) {
    log(`  Northgate has ${free.length} uncommitted listed machine(s); need ${needed}`);
    if (free.length === 0) return;
  }

  const fy = financialYearOf(now.toISOString());
  const fyShort = fy.slice(2, 4);
  let cursor = 0;
  let raised = 0;

  for (const batch of batches) {
    const units = free.slice(cursor, cursor + batch.units);
    cursor += batch.units;
    if (units.length === 0) break;

    const poNumber = await nextNumber(prisma, 'procurement.po_number_seq', `PO-${fyShort}-`);
    const orderNumber = await nextNumber(prisma, 'ordering.order_number_seq', `TT-${fyShort}-`);
    await prisma.$transaction((tx) =>
      raiseOne(tx, {
        now,
        fy,
        vendorOrgId,
        buyer,
        units,
        poNumber,
        orderNumber,
        status: batch.status,
      }),
    );
    raised += 1;
    log(`  ${poNumber} ${batch.status} — ${units.length} Northgate machine(s) for ${orderNumber}`);
  }

  if (raised === 0) log('  Northgate already has purchase orders on the machines that were free');
}

async function nextNumber(
  prisma: PrismaClient,
  sequence: 'procurement.po_number_seq' | 'ordering.order_number_seq',
  prefix: string,
): Promise<string> {
  const sql =
    sequence === 'procurement.po_number_seq'
      ? prisma.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('procurement.po_number_seq') AS n`
      : prisma.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('ordering.order_number_seq') AS n`;
  const [row] = await sql;
  return `${prefix}${String(row?.n ?? 1n).padStart(5, '0')}`;
}

async function raiseOne(
  prisma: Pick<PrismaClient, '$executeRaw'>,
  input: {
    now: Date;
    fy: string;
    vendorOrgId: string;
    buyer: { user_id: string; org_id: string; gst_id: string; address_id: string };
    units: readonly FreeUnit[];
    poNumber: string;
    orderNumber: string;
    status: PoSpec['status'];
  },
): Promise<void> {
  const payout = input.units.reduce((s, u) => s + Number(u.vendor_ask_price), 0);
  const retail = input.units.reduce((s, u) => s + Number(u.retail_price ?? u.vendor_ask_price), 0);
  const gst = Math.round(retail * 0.18 * 100) / 100;
  const grand = Math.round((retail + gst) * 100) / 100;
  const payoutStr = payout.toFixed(2);
  const retailStr = retail.toFixed(2);
  const gstStr = gst.toFixed(2);
  const grandStr = grand.toFixed(2);
  const valuation = input.units.every((u) => u.valuation_method === 'MARGIN')
    ? 'MARGIN'
    : 'REGULAR';

  const orderId = randomUUID();
  const subOrderId = randomUUID();
  const lineId = randomUUID();
  const poId = randomUUID();
  const acknowledgedAt = input.status === 'RAISED' ? null : input.now;
  const orderStatus = input.status === 'DISPATCHED' ? 'DISPATCHED' : 'CONFIRMED';

  await prisma.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
       billing_address_id, shipping_address_id, subtotal, gst_total, grand_total,
       payment_mode, payment_status, status, placed_at)
    VALUES (${orderId}::uuid, ${input.orderNumber}, ${input.buyer.org_id}::uuid,
            ${input.buyer.user_id}::uuid, ${input.buyer.gst_id}::uuid,
            ${input.buyer.address_id}::uuid, ${input.buyer.address_id}::uuid,
            ${retailStr}::numeric, ${gstStr}::numeric, ${grandStr}::numeric,
            'PREPAID'::public.payment_mode, 'PAID'::public.payment_status,
            ${orderStatus}::public.order_status, ${input.now})`;

  await prisma.$executeRaw`
    INSERT INTO ordering.sub_order
      (id, order_id, sub_order_number, vendor_org_id, subtotal, gst_total, status)
    VALUES (${subOrderId}::uuid, ${orderId}::uuid, ${`${input.orderNumber}-1`},
            ${input.vendorOrgId}::uuid, ${retailStr}::numeric, ${gstStr}::numeric,
            ${orderStatus}::public.order_status)`;

  await prisma.$executeRaw`
    INSERT INTO ordering.order_line
      (id, sub_order_id, listing_id, sku_id, grade, qty, unit_price,
       gst_rate, gst_amount, line_total, status)
    VALUES (${lineId}::uuid, ${subOrderId}::uuid, ${input.units[0]!.listing_id}::uuid,
            ${input.units[0]!.sku_id}::uuid, ${input.units[0]!.grade}::public.grade_type,
            ${input.units.length}, ${(retail / input.units.length).toFixed(2)}::numeric,
            18, ${gstStr}::numeric, ${grandStr}::numeric,
            ${orderStatus}::public.order_status)`;

  const attachNow = input.status === 'DISPATCHED';
  for (const unit of input.units) {
    await prisma.$executeRaw`
      INSERT INTO ordering.order_line_unit
        (order_line_id, unit_id, serial_number, qc_report_id, status)
      VALUES (${lineId}::uuid, ${attachNow ? unit.id : null}::uuid,
              ${attachNow ? unit.serial_number : null},
              ${attachNow ? unit.qc_report_id : null}::uuid, 'RESERVED'::public.unit_status)`;

    await prisma.$executeRaw`
      UPDATE listing.unit
         SET status = 'RESERVED'::public.unit_status,
             order_line_id = ${lineId}::uuid,
             purchase_price = ${unit.vendor_ask_price}::numeric
       WHERE id = ${unit.id}::uuid AND purchase_price IS NULL`;

    await prisma.$executeRaw`
      INSERT INTO listing.stock_movement
        (unit_id, from_status, to_status, from_location, to_location,
         reason, actor_id, ref_type, ref_id, occurred_at)
      VALUES (${unit.id}::uuid, 'LISTED'::public.unit_status, 'RESERVED'::public.unit_status,
              'VENDOR', 'VENDOR', ${`Reserved for order ${input.orderNumber}`},
              ${input.buyer.user_id}::uuid, 'ORDER', ${orderId}::uuid, ${input.now})`;
  }

  await prisma.$executeRaw`
    INSERT INTO procurement.purchase_order
      (id, po_number, vendor_org_id, order_id, status, total_net,
       tds_rate_pct, tds_amount, valuation_method, terms_days,
       acknowledged_at, created_at, updated_at)
    VALUES (${poId}::uuid, ${input.poNumber}, ${input.vendorOrgId}::uuid, ${orderId}::uuid,
            ${input.status}::identity.po_status, ${payoutStr}::numeric, 0, 0, ${valuation}, 15,
            ${acknowledgedAt}, ${input.now}, ${input.now})`;

  for (const unit of input.units) {
    await prisma.$executeRaw`
      INSERT INTO procurement.purchase_order_line
        (po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, qc_report_id, created_at)
      VALUES (${poId}::uuid, ${attachNow ? unit.id : null}::uuid, ${unit.sku_id}::uuid,
              ${unit.vendor_ask_price}::numeric, ${unit.grade}::public.grade_type,
              ${attachNow ? unit.qc_report_id : null}::uuid, ${input.now})`;
  }

  await prisma.$executeRaw`
    INSERT INTO procurement.vendor_payable
      (vendor_org_id, purchase_order_id, gross, tds, net_payable, status, created_at)
    VALUES (${input.vendorOrgId}::uuid, ${poId}::uuid, ${payoutStr}::numeric, 0,
            ${payoutStr}::numeric, 'ACCRUED', ${input.now})`;

  await prisma.$executeRaw`
    INSERT INTO procurement.tds_ledger
      (vendor_org_id, financial_year, purchase_order_id, entry_type,
       gross_amount, tds_rate_pct, tds_amount, reason, actor_id, occurred_at)
    VALUES (${input.vendorOrgId}::uuid, ${input.fy}, ${poId}::uuid, 'ACCRUAL',
            ${payoutStr}::numeric, 0, 0, ${`Purchase order ${input.poNumber} raised`},
            ${input.buyer.user_id}::uuid, ${input.now})`;

  await prisma.$executeRaw`
    INSERT INTO ordering.order_event (order_id, event_type, from_status, to_status, note, occurred_at)
    VALUES (${orderId}::uuid, 'order.placed', NULL, ${orderStatus},
            ${`Order placed. ${input.units.length} machine(s) allocated by serial.`},
            ${input.now})`;
}
