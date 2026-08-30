import type { PrismaClient } from '@prisma/client';

/**
 * Orders far enough along that the after-sale screens have something to show —
 * T23 and T24.
 *
 * **The problem this solves is not "no data", it is "one reachable state".**
 * Every order on the demo database was RESERVED or PAYMENT_PENDING, so the
 * warranty register had nothing in it, the 48-hour inspection window had never
 * opened, and the delivery screen had no manifest to verify. A screen with one
 * reachable state is a screen nobody has really looked at.
 *
 * Two different things happen here and the difference matters.
 *
 * **Dispatch is ADVANCED, not invented.** These are real orders with real
 * allocated serials and real supply points; only their status moves, which is
 * exactly what a pickup would do to them. `logistics` has no pickup writer — the
 * same gap `seedInvoicing` documents — so this stands in for it.
 *
 * **Delivery is left to the real code path** for the orders that arrive today:
 * `POST /api/ops/orders/:orderNumber/delivery` is what stamps `delivered_at`
 * from the injected clock and opens the warranty. A delivery written by a seed
 * is a delivery that never went through the term arithmetic it is supposed to
 * prove.
 *
 * The exception is the orders that arrived in the PAST. The endpoint
 * deliberately has no timestamp parameter — that would be the knob that moves a
 * money deadline — so a backdated arrival can only come from here. Those get
 * `delivered_at` written directly and nothing else; running the endpoint
 * afterwards opens their cover from the backdated start, which is how an expired
 * inspection window and an out-of-warranty machine become reachable at all.
 */

/**
 * Arrived today. A live 48-hour window and cover that has just begun.
 *
 * `TT-26-00005` carries the seeded BROKEN seal and `TT-26-00013` the MISMATCH
 * verdict, so the delivery screen's two refusal states are on orders a person
 * can actually open.
 */
const ARRIVING_TODAY = ['TT-26-00001', 'TT-26-00005', 'TT-26-00013'];

/**
 * Arrived in the past, by days. Each one makes a state reachable that today's
 * clock cannot produce.
 */
const ARRIVED_EARLIER: ReadonlyArray<{ order: string; daysAgo: number; why: string }> = [
  {
    order: 'TT-26-00007',
    daysAgo: 5,
    why: 'the 48-hour inspection window has closed; warranty is still live',
  },
  {
    order: 'TT-26-00009',
    daysAgo: 165,
    why: 'inside 30 days of expiry on a 6-month term — the expiring-soon chip',
  },
  {
    order: 'TT-26-00003',
    daysAgo: 400,
    why: 'out of warranty; the claim form must refuse and offer a paid repair',
  },
];

/**
 * Left at the supply point on purpose. Without one undelivered order the
 * register cannot show "cover has not started yet", which is a different and
 * more alarming thing than "cover has expired" and must not render as one.
 */
const DELIBERATELY_UNDELIVERED = 'TT-26-00010';

/**
 * `now` is supplied by the caller, not read here.
 *
 * The 48-hour inspection window and every warranty term are measured by the
 * services against `ClockPort`. If this file stamped a delivery from the wall
 * clock instead, the seed and the service would be reasoning about time from two
 * different sources — which is the defect T25 found in the approval SLA, where
 * `requested_at` came from the database's `DEFAULT now()` and `expires_at` from
 * `ClockPort`, and the window came out two hours short. Taking the instant as a
 * parameter makes the two agree by construction, and every date below is
 * relative to it rather than a literal, so nothing here expires on a future run.
 */
export async function seedAfterSale(
  prisma: PrismaClient,
  now: Date,
  log: (m: string) => void = () => undefined,
): Promise<void> {
  const dispatched: string[] = [];
  for (const orderNumber of [...ARRIVING_TODAY, ...ARRIVED_EARLIER.map((a) => a.order)]) {
    if (await dispatch(prisma, orderNumber)) dispatched.push(orderNumber);
  }
  if (dispatched.length > 0) log(`  dispatched ${dispatched.join(', ')}`);

  for (const arrival of ARRIVED_EARLIER) {
    const when = new Date(now.getTime() - arrival.daysAgo * 86_400_000);
    const rows = await prisma.$executeRaw`
      UPDATE ordering.sub_order so
         SET delivered_at = ${when}, status = 'DELIVERED'::public.order_status
        FROM ordering."order" o
       WHERE o.id = so.order_id
         AND o.order_number = ${arrival.order}
         AND so.delivered_at IS NULL
         AND so.status <> 'CANCELLED'::public.order_status`;
    if (rows > 0) {
      await prisma.$executeRaw`
        UPDATE ordering."order" SET status = 'DELIVERED'::public.order_status
         WHERE order_number = ${arrival.order}`;
      await prisma.$executeRaw`
        UPDATE ordering.order_line_unit SET status = 'DELIVERED'::public.unit_status
         WHERE order_line_id IN (
                 SELECT ol.id FROM ordering.order_line ol
                   JOIN ordering.sub_order so ON so.id = ol.sub_order_id
                   JOIN ordering."order" o    ON o.id  = so.order_id
                  WHERE o.order_number = ${arrival.order})`;
      // `ordering.order_event` is RANGE-partitioned by month and the partitions
      // run from the platform's own launch, so an arrival 400 days ago has
      // nowhere to land. That is the partitioning working, not a bug to route
      // around by creating history-shaped partitions from a seed — so the event
      // is skipped and said out loud rather than silently dropped.
      try {
        await prisma.$executeRaw`
          INSERT INTO ordering.order_event (order_id, event_type, from_status, to_status, note, occurred_at)
          SELECT id, 'STATUS_CHANGE', 'DISPATCHED', 'DELIVERED',
                 'Received by the buyer.', ${when}
            FROM ordering."order" WHERE order_number = ${arrival.order}`;
      } catch {
        log(
          `  ${arrival.order}: no order_event partition covers ` +
            `${when.toISOString().slice(0, 10)}, so its arrival is not on the timeline`,
        );
      }
      log(`  ${arrival.order} arrived ${arrival.daysAgo} days ago — ${arrival.why}`);
    }
  }

  log(`  ${DELIBERATELY_UNDELIVERED} stays at the supply point — "cover has not started yet"`);
  log(
    '  now open the cover with, as a platform account, one call per order:\n' +
      [...ARRIVING_TODAY, ...ARRIVED_EARLIER.map((a) => a.order)]
        .map((o) => `    POST /api/ops/orders/${o}/delivery`)
        .join('\n'),
  );
}

/**
 * Move one order's machines out of the supply point.
 *
 * `order_event` is written as well as the statuses, because a status that
 * changed with nothing in the timeline saying so is exactly the kind of demo
 * data that makes a real screen look broken. Returns whether anything moved, so
 * a re-run of the seed is silent rather than noisy.
 */
async function dispatch(prisma: PrismaClient, orderNumber: string): Promise<boolean> {
  const [order] = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status::text AS status FROM ordering."order" WHERE order_number = ${orderNumber}`;
  if (!order) return false;
  // Anything at or past DISPATCHED has already left; re-running must not rewind it.
  if (['DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)) {
    return false;
  }

  await prisma.$executeRaw`
    UPDATE ordering."order"
       SET status = 'DISPATCHED'::public.order_status,
           payment_status = 'PAID'::public.payment_status
     WHERE id = ${order.id}::uuid`;
  await prisma.$executeRaw`
    UPDATE ordering.sub_order SET status = 'DISPATCHED'::public.order_status
     WHERE order_id = ${order.id}::uuid AND status <> 'CANCELLED'::public.order_status`;
  await prisma.$executeRaw`
    UPDATE ordering.order_line SET status = 'DISPATCHED'::public.order_status
     WHERE sub_order_id IN (SELECT id FROM ordering.sub_order WHERE order_id = ${order.id}::uuid)`;
  await prisma.$executeRaw`
    INSERT INTO ordering.order_event (order_id, event_type, from_status, to_status, note)
    VALUES (${order.id}::uuid, 'STATUS_CHANGE', ${order.status}, 'DISPATCHED',
            'Machines handed over at the supply point.')`;
  return true;
}
