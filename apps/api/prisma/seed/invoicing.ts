import type { PrismaClient } from '@prisma/client';
import { LEGAL_DISCLOSURE } from '@trugrade/config';
import { financialYearOf, isValidGstin } from '@trugrade/contracts';

/**
 * What the platform needs before it can issue a single tax invoice — T22.
 *
 * Two facts were missing and both are the kind that make a feature look broken
 * rather than unconfigured.
 *
 * **1. We had no GST registration of our own.** Under the merchant-of-record
 * model we are the seller: we buy the serial from the supply point and sell it
 * on our own invoice. `identity.organization` carried the INTERNAL row for
 * TrueTech Services Pvt. Ltd. and `kyc.gst_profile` carried a GSTIN for every
 * buyer and vendor and none for us — so there was no seller to put on the
 * document. `InvoiceIssueService` refuses rather than printing a blank GSTIN,
 * which is correct and left the whole path unreachable.
 *
 * **2. There was no invoice series.** `payment.next_invoice_number` raises
 * outright without a `(gstin, financial_year)` counter row, and that refusal is
 * deliberate: a series is a decision about how our invoices are numbered for a
 * whole financial year, and deriving one on first use is how a business ends up
 * with two series it cannot explain. So it is configured here, once, with a
 * `last_number` of 0.
 *
 * The GSTIN below is synthetic — it passes the mod-36 check digit and the
 * jurisdiction is real (06, Haryana, which is where `LEGAL_DISCLOSURE` says the
 * registered office is), but it is not a live registration and must be replaced
 * before launch. That is why it is asserted rather than assumed: a GSTIN that
 * fails its own check digit on our own invoice is worse than none.
 */

/** Haryana, matching `LEGAL_DISCLOSURE.registeredOffice.stateCode`. */
const PLATFORM_GSTIN = '06AAJCT2846R1ZL';

/**
 * The prefix every invoice number carries: `TT/2026-27/00001`.
 *
 * Short, and the same two letters as the order number, because a buyer's
 * accounts-payable clerk holding an order confirmation and an invoice should be
 * able to see at a glance that they came from the same place.
 */
const SERIES_PREFIX = 'TT';

/**
 * The order the demo dispatches, so the documents screen has both halves of its
 * story on one database: an order still being picked, whose tax invoice honestly
 * does not exist yet, and one whose machines have left, whose invoice does.
 *
 * Advanced rather than invented. It is a real order with real allocated serials
 * and a real supply point; only its status moves, which is exactly what a pickup
 * would do to it. Without one dispatched order the ONLY reachable state of this
 * screen is "not issued yet", and a screen with one reachable state is a screen
 * nobody has really looked at.
 */
const DISPATCHED_ORDER = 'TT-26-00001';

export async function seedInvoicing(
  prisma: PrismaClient,
  log: (m: string) => void = () => undefined,
): Promise<void> {
  if (!isValidGstin(PLATFORM_GSTIN)) {
    throw new Error(
      `${PLATFORM_GSTIN} fails its GSTIN check digit. Our own registration is the one that must ` +
        'never be wrong — every invoice we issue carries it.',
    );
  }

  const [platform] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.organization WHERE org_type = 'INTERNAL' LIMIT 1`;
  if (!platform) {
    log('  no INTERNAL organisation on this database — run the demo seed first');
    return;
  }

  await prisma.$executeRaw`
    INSERT INTO kyc.gst_profile (org_id, gstin, legal_name_as_per_gst, trade_name, state_code,
                                 registration_type, status, api_verified_at, is_primary)
    VALUES (${platform.id}::uuid, ${PLATFORM_GSTIN}, ${LEGAL_DISCLOSURE.legalName},
            ${LEGAL_DISCLOSURE.brandName}, ${LEGAL_DISCLOSURE.registeredOffice.stateCode},
            'REGULAR', 'ACTIVE', now(), TRUE)
    ON CONFLICT (org_id, gstin) DO NOTHING`;

  // The current financial year and the next one. A series that runs out at
  // midnight on 31 March is a series that stops the business on 1 April, and
  // "configure it before invoicing" is only a reasonable rule if somebody has.
  const thisYear = financialYearOf(new Date().toISOString());
  const nextYear = financialYearOf(
    new Date(Date.UTC(Number(thisYear.slice(0, 4)) + 1, 5, 1)).toISOString(),
  );
  for (const fy of [thisYear, nextYear]) {
    await prisma.$executeRaw`
      INSERT INTO payment.invoice_series (gstin, financial_year, prefix, last_number)
      VALUES (${PLATFORM_GSTIN}, ${fy}, ${SERIES_PREFIX}, 0)
      ON CONFLICT (gstin, financial_year) DO NOTHING`;
  }
  log(`  seller GSTIN ${PLATFORM_GSTIN}, invoice series ${SERIES_PREFIX} for ${thisYear}, ${nextYear}`);

  await dispatchOneOrder(prisma, log);
}

/**
 * Move one order's machines out of the supply point.
 *
 * `order_event` is written as well as the statuses, because a status that
 * changed with nothing in the timeline saying so is exactly the kind of demo
 * data that makes a real screen look broken.
 *
 * The invoice itself is NOT written here. It is raised by the real code path —
 * `POST /api/ops/orders/:orderNumber/invoices`, which allocates the number
 * inside the transaction that inserts the row — because an invoice written by a
 * seed is an invoice that never went through the numbering it is supposed to
 * prove.
 */
async function dispatchOneOrder(prisma: PrismaClient, log: (m: string) => void): Promise<void> {
  const [order] = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status::text AS status FROM ordering."order"
     WHERE order_number = ${DISPATCHED_ORDER}`;
  if (!order) {
    log(`  ${DISPATCHED_ORDER} is not on this database — nothing to dispatch`);
    return;
  }
  if (order.status === 'DISPATCHED') return;

  await prisma.$executeRaw`
    UPDATE ordering."order"
       SET status = 'DISPATCHED'::public.order_status,
           payment_status = 'PAID'::public.payment_status
     WHERE id = ${order.id}::uuid`;
  await prisma.$executeRaw`
    UPDATE ordering.sub_order SET status = 'DISPATCHED'::public.order_status
     WHERE order_id = ${order.id}::uuid`;
  await prisma.$executeRaw`
    UPDATE ordering.order_line SET status = 'DISPATCHED'::public.order_status
     WHERE sub_order_id IN (SELECT id FROM ordering.sub_order WHERE order_id = ${order.id}::uuid)`;
  await prisma.$executeRaw`
    INSERT INTO ordering.order_event (order_id, event_type, from_status, to_status, note)
    VALUES (${order.id}::uuid, 'STATUS_CHANGE', ${order.status}, 'DISPATCHED',
            'Machines handed over at the supply point.')`;

  log(
    `  ${DISPATCHED_ORDER} dispatched — raise its tax invoice with ` +
      `POST /api/ops/orders/${DISPATCHED_ORDER}/invoices as a platform account`,
  );
}
