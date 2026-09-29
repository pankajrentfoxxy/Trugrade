import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { ClockPort } from '../../../shared/clock';
import { PrismaService } from '../../../shared/db/prisma.service';
import { InsufficientStockError } from '../../../shared/errors/domain-errors';
import { LockService } from '../../../shared/redis/redis.service';

/**
 * The twenty-minute stock hold, taken when a buyer enters checkout.
 *
 * T15's cart panel says, in as many words, that "stock is held for 20 minutes
 * when you start checkout, and the hold and its countdown are shown there".
 * This file is what makes that sentence true: the deadline on the checkout
 * screen is read straight off `expires_at` here, and when it passes the stock
 * really does go back on sale.
 *
 * **The hold takes a quantity, not machines.** A listing is a declared count
 * with no serials behind it until a buyer orders, so there is nothing to pick.
 * The hold decrements `listing.qty_available` and writes how much to give back
 * to `checkout_hold_line`; the order transaction consumes that line and takes
 * the same quantity as a reservation of its own.
 *
 * Three properties, each of which is a rule somebody will otherwise break:
 *
 * **1. The decrement is arithmetic on the stored value.** Postgres re-evaluates
 * it against whatever the winner of a race committed, so the loser subtracts
 * into the negative and `chk_qty_nonneg` refuses the row. The Redis lock is an
 * optimisation; the CHECK is the guarantee.
 *
 * **2. It is released by the same code that took it.** By expiry (the cron
 * below), by the buyer leaving checkout, or by the order transaction consuming
 * it. There is no fourth path, because a hold released by something that did
 * not take it is how inventory leaks.
 *
 * **3. The listing's counters are written here and in the order transaction,
 * and nowhere else.** `trg_listing_counters` no longer derives them from the
 * units, because a live listing has no units.
 */

export interface HeldStock {
  holdId: string;
  cartId: string;
  expiresAt: Date;
  /** Quantity held, by listing. What the confirm transaction re-reserves. */
  qtyByListing: ReadonlyMap<string, number>;
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
    private readonly locks: LockService,
  ) {}

  /**
   * Take, or refresh, the hold for one cart.
   *
   * Idempotent by cart: a second tab, or a reload of the checkout screen, joins
   * the hold that already exists rather than taking a second one. **It does
   * not extend the deadline** — a hold a buyer can renew by pressing F5 is not
   * a twenty-minute hold.
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
          await this.reserve(line);
          await this.prisma.$executeRaw`
            INSERT INTO ordering.checkout_hold_line (hold_id, listing_id, qty)
            VALUES (${holdId}::uuid, ${line.listingId}::uuid, ${line.qty})`;
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

    const rows = await this.prisma.$queryRaw<Array<{ listing_id: string; qty: number }>>`
      SELECT listing_id, qty FROM ordering.checkout_hold_line
       WHERE hold_id = ${hold.id}::uuid ORDER BY listing_id`;

    const qtyByListing = new Map(rows.map((r) => [r.listing_id, Number(r.qty)]));
    return {
      holdId: hold.id,
      cartId,
      expiresAt: hold.expires_at,
      qtyByListing,
      unitCount: rows.reduce((n, r) => n + Number(r.qty), 0),
    };
  }

  /**
   * Put the quantity back on sale and forget the hold.
   *
   * `reason` is kept for the log line: with no unit rows there is no
   * `stock_movement` to write it onto, and the listing counters are the record.
   */
  async release(cartId: string, reason: string): Promise<number> {
    return this.prisma.runInTransaction(async () => {
      const rows = await this.prisma.$queryRaw<Array<{ listing_id: string; qty: number }>>`
        SELECT hl.listing_id, hl.qty
          FROM ordering.checkout_hold_line hl
          JOIN ordering.checkout_hold h ON h.id = hl.hold_id
         WHERE h.cart_id = ${cartId}::uuid
         ORDER BY hl.listing_id`;
      await this.prisma.$executeRaw`
        DELETE FROM ordering.checkout_hold WHERE cart_id = ${cartId}::uuid`;
      let units = 0;
      for (const row of rows) {
        await this.giveBack(row.listing_id, Number(row.qty));
        units += Number(row.qty);
      }
      if (units > 0) this.logger.log(`Released ${units} unit(s) for cart ${cartId}: ${reason}`);
      return units;
    });
  }

  /**
   * Hand the held quantity to the order transaction, inside its transaction.
   *
   * The quantity goes back to available here and the order transaction takes
   * it again a few statements later, under the same listing locks, so it never
   * became available to anyone else. One implementation of the reservation,
   * whichever door the buyer came through.
   */
  async consume(cartId: string): Promise<void> {
    if (!this.prisma.isInTransaction) {
      throw new Error('consume() must run inside the order transaction that re-allocates.');
    }
    const rows = await this.prisma.$queryRaw<Array<{ listing_id: string; qty: number }>>`
      SELECT hl.listing_id, hl.qty
        FROM ordering.checkout_hold_line hl
        JOIN ordering.checkout_hold h ON h.id = hl.hold_id
       WHERE h.cart_id = ${cartId}::uuid
       ORDER BY hl.listing_id`;
    if (rows.length === 0) return;

    await this.prisma.$executeRaw`
      DELETE FROM ordering.checkout_hold WHERE cart_id = ${cartId}::uuid`;
    for (const row of rows) await this.giveBack(row.listing_id, Number(row.qty));
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
          'The twenty-minute checkout hold expired and the stock went back on sale.',
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
   * Take `qty` off one listing's availability.
   *
   * Row-locked and re-read, so two carts holding the last machine queue behind
   * each other and the second one is refused with the true remaining count.
   */
  private async reserve(line: HoldRequest): Promise<void> {
    const [row] = await this.prisma.$queryRaw<Array<{ qty_available: number; status: string }>>`
      SELECT qty_available, status::text AS status
        FROM listing.listing WHERE id = ${line.listingId}::uuid FOR UPDATE`;
    if (!row || (row.status !== 'ACTIVE' && row.status !== 'PARTIALLY_ACTIVE')) {
      throw new InsufficientStockError(line.qty, 0, line.supplyPointLabel);
    }
    if (Number(row.qty_available) < line.qty) {
      throw new InsufficientStockError(line.qty, Number(row.qty_available), line.supplyPointLabel);
    }
    await this.prisma.$executeRaw`
      UPDATE listing.listing
         SET qty_available = qty_available - ${line.qty},
             qty_reserved  = qty_reserved  + ${line.qty},
             updated_at    = ${this.clock.now()}
       WHERE id = ${line.listingId}::uuid`;
  }

  private async giveBack(listingId: string, qty: number): Promise<void> {
    // `GREATEST` on the reserved side: a hold coming back after ops re-approved
    // the listing with a smaller total must not drive the counter negative.
    // `chk_qty_balance` still refuses an available count above the total.
    await this.prisma.$executeRaw`
      UPDATE listing.listing
         SET qty_available = qty_available + ${qty},
             qty_reserved  = GREATEST(qty_reserved - ${qty}, 0),
             updated_at    = ${this.clock.now()}
       WHERE id = ${listingId}::uuid`;
  }
}
