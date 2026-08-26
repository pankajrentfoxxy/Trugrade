import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { ValidationError } from '../../../shared/errors/domain-errors';

/**
 * The only way a unit's status changes.
 *
 * Not a logger that callers remember to call after an UPDATE — the UPDATE and
 * the `stock_movement` row are the same statement, so there is no window in
 * which a unit has moved and the trail says otherwise. That window is the whole
 * reason this service exists: a unit whose status changed without a movement row
 * is a unit nobody can explain during a dispute, and the dispute is always about
 * the one machine that has no trail.
 *
 * Two consequences worth knowing before writing an UPDATE somewhere else:
 *
 *   - **`listing.stock_movement` is append-only.** `ops.apply_append_only_grants`
 *     REVOKEs UPDATE and DELETE on it, so a row written in error cannot be
 *     tidied away — it is corrected by a *second* movement that says so. There
 *     is deliberately no method here that would let you try.
 *   - **The counters are not ours.** `trg_listing_counters` recomputes
 *     `qty_available`/`qty_reserved`/`qty_awaiting_qc`/`qty_qc_failed` from the
 *     units themselves on every status change, and `trg_recompute_sellable`
 *     recomputes `is_sellable` before the row lands. Writing either by hand here
 *     would give the database two authors for one number, which is exactly the
 *     drift `listing.v_stock_drift` exists to catch.
 */

/** `public.unit_status`. Written out because nothing in contracts owns it yet. */
export type UnitStatus =
  | 'CREATED'
  | 'AWAITING_QC'
  | 'QC_SCHEDULED'
  | 'QC_SEALED'
  | 'LISTED'
  | 'RESERVED'
  | 'PICKUP_SCHEDULED'
  | 'PICKED_UP'
  | 'RECEIVED_AT_HUB'
  | 'QC_IN_PROGRESS'
  | 'QC_PASSED'
  | 'QC_MISMATCH'
  | 'QC_FAILED'
  | 'QC_EXPIRED'
  | 'SEAL_BROKEN'
  | 'PACKED'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'RETURN_REQUESTED'
  | 'RETURN_IN_TRANSIT'
  | 'RETURN_QC'
  | 'RETURNED_TO_VENDOR'
  | 'SCRAPPED';

/** `listing.unit.location` — where the machine physically is, not its state. */
export type UnitLocation = 'VENDOR' | 'TRANSIT' | 'HUB' | 'BUYER';

export interface TransitionInput {
  unitIds: readonly string[];
  to: UnitStatus;
  /**
   * The status the caller believes these units are in. Units in any other status
   * are left alone and simply do not come back in the result, which turns a lost
   * race into a countable answer instead of an overwrite. Omit only when the
   * caller genuinely does not care where the unit was.
   */
  expectedFrom?: UnitStatus;
  /** Free text, kept short and specific. It is read years later, by a stranger. */
  reason: string;
  /** Set only when the machine actually moved. Omitted leaves the location alone. */
  toLocation?: UnitLocation;
  /** What caused this — 'QC_VISIT', 'ORDER', 'SHIPMENT'... — and its id. */
  refType?: string;
  refId?: string;
}

export interface StockMovement {
  unitId: string;
  fromStatus: UnitStatus | null;
  toStatus: UnitStatus;
  fromLocation: UnitLocation | null;
  toLocation: UnitLocation | null;
  occurredAt: Date;
}

interface RawMovement {
  unit_id: string;
  from_status: string | null;
  to_status: string;
  from_location: string | null;
  to_location: string | null;
  occurred_at: Date;
}

@Injectable()
export class StockMovementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
  ) {}

  /**
   * Move units and record the move, atomically.
   *
   * One statement does all of it. `before` reads the current status and location
   * under `FOR UPDATE`, the second CTE writes the new ones, and the INSERT reads
   * both halves back out — so `from_status` is what the row actually held rather
   * than what the caller assumed a moment earlier. Doing it as read-then-update
   * would let a concurrent transition land in between and stamp a movement that
   * never happened.
   *
   * `ORDER BY u.id` in the locking read is not cosmetic: two batches touching an
   * overlapping set of units in different orders deadlock, and a deadlock in the
   * submit path fails a vendor's whole listing.
   *
   * Returns one row per unit that actually moved. A caller that expected fifty
   * and got forty-eight has learned something real and must decide what to do
   * about it; this service does not decide for them.
   */
  async transition(input: TransitionInput): Promise<StockMovement[]> {
    const unitIds = [...new Set(input.unitIds)];
    if (unitIds.length === 0) return [];

    // An audit trail whose reason is blank is a row that costs storage and
    // settles nothing. Nullable in the schema for the rows Phase 0 backfilled;
    // required here, because everything from now on has a caller to ask.
    const reason = input.reason.trim();
    if (reason.length < 3) {
      throw new ValidationError('A stock movement needs a reason.', {
        reason: 'Say why the unit moved, in a few words.',
      });
    }

    const actorId = this.ctx.principal?.userId ?? null;
    const from = input.expectedFrom ?? null;
    const toLocation = input.toLocation ?? null;

    const rows = await this.prisma.$queryRaw<RawMovement[]>`
      WITH before AS (
        SELECT u.id, u.status, u.location
          FROM listing.unit u
         WHERE u.id = ANY(${unitIds}::uuid[])
           AND (${from}::text IS NULL OR u.status::text = ${from})
         ORDER BY u.id
           FOR UPDATE
      ),
      moved AS (
        UPDATE listing.unit u
           SET status   = ${input.to}::public.unit_status,
               location = COALESCE(${toLocation}::text, u.location)
          FROM before b
         WHERE u.id = b.id
        RETURNING u.id,
                  b.status   AS from_status, u.status   AS to_status,
                  b.location AS from_location, u.location AS to_location
      )
      INSERT INTO listing.stock_movement
        (unit_id, from_status, to_status, from_location, to_location,
         reason, actor_id, ref_type, ref_id, occurred_at)
      SELECT m.id, m.from_status, m.to_status, m.from_location, m.to_location,
             ${reason}, ${actorId}::uuid, ${input.refType ?? null}::text,
             ${input.refId ?? null}::uuid, ${this.clock.now()}
        FROM moved m
      RETURNING unit_id, from_status, to_status, from_location, to_location, occurred_at`;

    return rows.map((r) => ({
      unitId: r.unit_id,
      fromStatus: r.from_status as UnitStatus | null,
      toStatus: r.to_status as UnitStatus,
      fromLocation: r.from_location as UnitLocation | null,
      toLocation: r.to_location as UnitLocation | null,
      occurredAt: r.occurred_at,
    }));
  }
}
