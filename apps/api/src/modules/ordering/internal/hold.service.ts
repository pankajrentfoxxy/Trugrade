import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { ClockPort } from '../../../shared/clock';
import { PrismaService } from '../../../shared/db/prisma.service';
import { RequestContextService } from '../../../shared/db/org-scope';
import { InsufficientStockError } from '../../../shared/errors/domain-errors';
import { LockService } from '../../../shared/redis/redis.service';

/**
 * The twenty-minute stock hold, taken when a buyer enters checkout.
 *
 * T15's cart panel says, in as many words, that "stock is held for 20 minutes
 * when you start checkout, and the hold and its countdown are shown there".
 * This file is what makes that sentence true. A countdown against nothing would
 * be a scarcity device wearing a clock — the first dishonest pixel on the site
 * — so the deadline on the checkout screen is read straight off `expires_at`
 * here, and when it passes the machines really do go back on sale.
 *
 * Three properties, each of which is a rule somebody will otherwise break:
 *
 * **1. The hold takes exact machines, not a quantity.** `checkout_hold_unit`
 * names serials, so the buyer who reaches step 6 gets the machines they were
 * shown, and `unit_id UNIQUE` means no second cart can hold one of them.
 *
 * **2. It is released by the same code that took it.** By expiry (the cron
 * below), by the buyer leaving checkout, or by the order transaction consuming
 * it. There is no fourth path, because a hold released by something that did not
 * take it is how inventory leaks.
 *
 * **3. The counters are not written here.** Flipping a unit to `RESERVED` fires
 * `trg_listing_counters`, which recomputes `qty_available` and `qty_reserved`
 * from the units themselves. Writing them by hand as well would give the
 * database two authors for one number.
 */

export interface HeldStock {
  holdId: string;
  cartId: string;
  expiresAt: Date;
  /** unit ids, by listing. What the confirm transaction re-allocates. */
  unitsByListing: ReadonlyMap<string, string[]>;
  unitCount: number;
}

export interface HoldRequest {
  listingId: string;
  qty: number;
  /** `Supply Point A · Gurugram`. What a refusal has to name. */
  supplyPointLabel: string;
}

@Injectable()
export class HoldService {
  private readonly logger = new Logger(HoldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly locks: LockService,
  ) {}

  /**
   * Take, or refresh, the hold for one cart.
   *
   * Idempotent by cart: a second tab, or a reload of the checkout screen, joins
   * the hold that already exists rather than taking a second one against the
   * same lines. **It does not extend the deadline**, and that is deliberate —
   * a hold a buyer can renew by pressing F5 is not a twenty-minute hold, and
   * the machines belong to everyone else again at the time we said they would.
   */
  async take(input: {
    cartId: string;
    buyerOrgId: string;
    userId: string;
    lines: readonly HoldRequest[];
    ttlMinutes: number;
  }): Promise<HeldStock> {
    const existing = await this.read(input.cartId);
    if (existing && existing.expiresAt > this.clock.now()) return existing;
    if (existing) await this.release(input.cartId, 'The hold on these machines had expired.');

    const expiresAt = new Date(this.clock.now().getTime() + input.ttlMinutes * 60_000);
    // Ascending listing id, always. Same discipline as the order transaction
    // and the same reason: a multi-supply-point cart that locks in cart order
    // deadlocks under concurrency (PHASE_06 Task 3, ORD-014).
    const keys = input.lines.map((l) => `lock:listing:${l.listingId}`);

    await this.locks.withLocks(keys, () =>
      this.prisma.runInTransaction(async () => {
        const holdId = randomUUID();
        await this.prisma.$executeRaw`
          INSERT INTO ordering.checkout_hold (id, cart_id, buyer_org_id, user_id, expires_at, created_at)
          VALUES (${holdId}::uuid, ${input.cartId}::uuid, ${input.buyerOrgId}::uuid,
                  ${input.userId}::uuid, ${expiresAt}, ${this.clock.now()})`;

        for (const line of [...input.lines].sort((a, b) => (a.listingId < b.listingId ? -1 : 1))) {
          const unitIds = await this.pick(line);
          await this.prisma.$executeRaw`
            INSERT INTO ordering.checkout_hold_unit (hold_id, unit_id, listing_id)
            SELECT ${holdId}::uuid, u, ${line.listingId}::uuid
              FROM unnest(${unitIds}::uuid[]) AS u`;
          await this.move(unitIds, 'RESERVED', 'Held for checkout', input.cartId);
        }
      }),
    );

    const held = await this.read(input.cartId);
    if (!held) throw new Error('The hold vanished between writing it and reading it back.');
    return held;
  }

  /** The live hold for a cart, or null. Expired rows are not live. */
  async read(cartId: string): Promise<HeldStock | null> {
    const [hold] = await this.prisma.$queryRaw<Array<{ id: string; expires_at: Date }>>`
      SELECT id, expires_at FROM ordering.checkout_hold WHERE cart_id = ${cartId}::uuid`;
    if (!hold) return null;

    const rows = await this.prisma.$queryRaw<Array<{ unit_id: string; listing_id: string }>>`
      SELECT unit_id, listing_id FROM ordering.checkout_hold_unit
       WHERE hold_id = ${hold.id}::uuid ORDER BY unit_id`;

    const unitsByListing = new Map<string, string[]>();
    for (const r of rows) {
      const bucket = unitsByListing.get(r.listing_id);
      if (bucket) bucket.push(r.unit_id);
      else unitsByListing.set(r.listing_id, [r.unit_id]);
    }
    return {
      holdId: hold.id,
      cartId,
      expiresAt: hold.expires_at,
      unitsByListing,
      unitCount: rows.length,
    };
  }

  /**
   * Put the machines back on sale and forget the hold.
   *
   * `reason` is written onto every `stock_movement` row, so a year later the
   * trail says whether a machine came back because a buyer walked away or
   * because a clock ran out.
   */
  async release(cartId: string, reason: string): Promise<number> {
    return this.prisma.runInTransaction(async () => {
      const rows = await this.prisma.$queryRaw<Array<{ unit_id: string }>>`
        SELECT hu.unit_id
          FROM ordering.checkout_hold_unit hu
          JOIN ordering.checkout_hold h ON h.id = hu.hold_id
         WHERE h.cart_id = ${cartId}::uuid
         ORDER BY hu.unit_id`;
      if (rows.length === 0) {
        await this.prisma.$executeRaw`
          DELETE FROM ordering.checkout_hold WHERE cart_id = ${cartId}::uuid`;
        return 0;
      }
      const unitIds = rows.map((r) => r.unit_id);
      await this.prisma.$executeRaw`
        DELETE FROM ordering.checkout_hold WHERE cart_id = ${cartId}::uuid`;
      await this.move(unitIds, 'LISTED', reason, cartId);
      return unitIds.length;
    });
  }

  /**
   * Hand the held machines to the order transaction, inside its transaction.
   *
   * The units go back to `LISTED` **without a movement row**, and that is the
   * honest entry rather than the missing one: nothing left the hold. The release
   * and the re-allocation happen in the same instant, under the same listing
   * locks, so a machine never became available to anyone. Writing "released" and
   * then "reserved" a microsecond later would put two events in the trail for
   * something that did not happen twice — and the movement that DID happen, the
   * one that says "reserved for order TT-26-00001", is written by the order
   * transaction a few statements later.
   */
  async consume(cartId: string): Promise<void> {
    if (!this.prisma.isInTransaction) {
      throw new Error('consume() must run inside the order transaction that re-allocates.');
    }
    const rows = await this.prisma.$queryRaw<Array<{ unit_id: string }>>`
      SELECT hu.unit_id
        FROM ordering.checkout_hold_unit hu
        JOIN ordering.checkout_hold h ON h.id = hu.hold_id
       WHERE h.cart_id = ${cartId}::uuid
       ORDER BY hu.unit_id`;
    if (rows.length === 0) return;

    await this.prisma.$executeRaw`
      DELETE FROM ordering.checkout_hold WHERE cart_id = ${cartId}::uuid`;
    // `AND status = 'RESERVED'` is load bearing. A held machine can still move
    // underneath the hold — an ops correction, a seal found broken, a unit
    // scrapped — and without the guard this UPDATE would put a SCRAPPED laptop
    // back on sale and sell it. Restoring only what is still ours means the
    // allocation below simply finds one machine short and the whole transaction
    // fails cleanly, which is the right answer.
    await this.prisma.$executeRaw`
      UPDATE listing.unit SET status = 'LISTED'::public.unit_status, order_line_id = NULL
       WHERE id = ANY(${rows.map((r) => r.unit_id)}::uuid[])
         AND status = 'RESERVED'::public.unit_status`;
  }

  /* ------------------------------------------------------------------------
   * Expiry
   * --------------------------------------------------------------------- */

  /**
   * Release every hold whose deadline has passed.
   *
   * Every minute, because the hold is twenty and a machine that stays off sale
   * for an hour after its hold lapsed is stock we are not selling. `FOR UPDATE
   * SKIP LOCKED` so two API instances take different holds instead of blocking.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'checkout-hold-expiry' })
  async expireDueHolds(): Promise<{ released: number; units: number }> {
    const due = await this.prisma.$queryRaw<Array<{ cart_id: string }>>`
      SELECT cart_id FROM ordering.checkout_hold
       WHERE expires_at <= ${this.clock.now()}
       ORDER BY expires_at
       LIMIT 200
         FOR UPDATE SKIP LOCKED`;

    let units = 0;
    for (const row of due) {
      try {
        units += await this.release(
          row.cart_id,
          'The twenty-minute checkout hold expired and the machines went back on sale.',
        );
      } catch (e) {
        this.logger.error(`Releasing hold for cart ${row.cart_id} failed: ${(e as Error).message}`);
      }
    }
    if (due.length > 0) {
      this.logger.log(`Released ${due.length} expired checkout hold(s), ${units} unit(s).`);
    }
    return { released: due.length, units };
  }

  /* ------------------------------------------------------------------------
   * The two statements that do the work
   * --------------------------------------------------------------------- */

  /**
   * Pick exact machines for one line.
   *
   * Candidates come from `v_sellable_unit` and nowhere else — it re-evaluates
   * the expiry and seal predicates on read, so a machine whose inspection lapsed
   * at midnight stops being holdable at midnight. The lock cannot be taken
   * through that view (it has an outer join, and Postgres refuses to lock the
   * nullable side of one), so it is taken on the table with `SKIP LOCKED`: two
   * buyers holding at the same instant take different machines rather than
   * queueing.
   */
  private async pick(line: HoldRequest): Promise<string[]> {
    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.v_sellable_unit
       WHERE listing_id = ${line.listingId}::uuid
       ORDER BY id`;

    const picked = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.unit
       WHERE id = ANY(${candidates.map((c) => c.id)}::uuid[])
         AND status = 'LISTED'::public.unit_status
       ORDER BY id
         FOR UPDATE SKIP LOCKED
       LIMIT ${line.qty}`;

    if (picked.length < line.qty) {
      throw new InsufficientStockError(line.qty, picked.length, line.supplyPointLabel);
    }
    return picked.map((p) => p.id);
  }

  /**
   * Move units and record the move in one statement.
   *
   * Mirrors `listing`'s own `StockMovementService.transition`: the UPDATE and
   * the `stock_movement` row are the same statement, so there is no window in
   * which a machine has moved and the trail says otherwise. It is restated
   * rather than called because that service is `internal/` to another module and
   * these rows are written inside this transaction or not at all.
   */
  private async move(
    unitIds: readonly string[],
    to: 'RESERVED' | 'LISTED',
    reason: string,
    cartId: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      WITH before AS (
        SELECT u.id, u.status, u.location
          FROM listing.unit u
         WHERE u.id = ANY(${[...unitIds]}::uuid[])
           -- Only units still in the status this move expects. Releasing a hold
           -- must never resurrect a machine that has since been scrapped, failed
           -- QC or had its seal broken; one that is not where we left it is no
           -- longer ours to move, and it simply does not come back in the result.
           AND u.status = ${to === 'RESERVED' ? 'LISTED' : 'RESERVED'}::public.unit_status
         ORDER BY u.id
           FOR UPDATE
      ),
      moved AS (
        UPDATE listing.unit u
           SET status = ${to}::public.unit_status
          FROM before b
         WHERE u.id = b.id
        RETURNING u.id, b.status AS from_status, u.status AS to_status,
                  b.location AS from_location, u.location AS to_location
      )
      INSERT INTO listing.stock_movement
        (unit_id, from_status, to_status, from_location, to_location,
         reason, actor_id, ref_type, ref_id, occurred_at)
      SELECT m.id, m.from_status, m.to_status, m.from_location, m.to_location,
             ${reason}, ${this.ctx.principal?.userId ?? null}::uuid,
             'CHECKOUT_HOLD', ${cartId}::uuid, ${this.clock.now()}
        FROM moved m`;
  }
}
