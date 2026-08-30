import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { money, type Money } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { OrgScope, RequestContextService } from '../../../shared/db/org-scope';
import { EventBus } from '../../../shared/events/event-bus';
import {
  ConflictError,
  IllegalStateTransitionError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { StockMovementService } from './stock-movement.service';

/**
 * Submit. The pivot of the whole model: **the listing does not go live.**
 *
 * A vendor presses the button and gets an inspection, not a shop window. The
 * listing goes to AWAITING_QC, every unit goes to AWAITING_QC, `qty_available`
 * stays zero and nothing is buyer-visible until a technician has held the
 * machines. Everything else in this file is bookkeeping around that one fact.
 *
 * It is one transaction, and it has to be. The failure this prevents is a listing
 * sitting in AWAITING_QC with no visit behind it — units frozen out of the
 * wizard, no technician coming, and nothing in the system that knows to look.
 */

export type SubmitChoice = 'HOLD' | 'ACCEPT_FEE';

/**
 * Fewer units than a visit is worth. **Not a rejection** — the vendor is asked,
 * and the caller has to come back with an answer. Silently refusing here is how
 * a vendor with eighteen machines concludes the platform does not want them.
 */
export interface SubmitDecisionRequired {
  outcome: 'DECISION_REQUIRED';
  unitCount: number;
  minUnitsPerVisit: number;
  shortBy: number;
  /** What ACCEPT_FEE would cost. Zero if the waiver already covers this batch. */
  visitFee: Money;
  options: readonly SubmitChoice[];
}

/** They chose to wait. Nothing was written; the listing is still a draft. */
export interface SubmitHeld {
  outcome: 'HELD';
  unitCount: number;
  minUnitsPerVisit: number;
  shortBy: number;
}

export interface SubmitAccepted {
  outcome: 'SUBMITTED';
  listingId: string;
  status: 'AWAITING_QC';
  unitCount: number;
  qcVisitId: string;
  visitNumber: string;
  visitFee: Money;
  feeBearer: FeeBearer;
}

export type SubmitResult = SubmitDecisionRequired | SubmitHeld | SubmitAccepted;

export type FeeBearer = 'TRUETECH' | 'VENDOR' | 'SPLIT' | 'WAIVED';

export interface QcVisitRequest {
  vendorOrgId: string;
  facilityId: string;
  addressId: string;
  requestedBy: string | null;
  unitsRequested: number;
  visitFee: Money;
  feeBearer: FeeBearer;
}

export interface QcVisitRef {
  id: string;
  visitNumber: string;
}

/**
 * The one thing `listing` needs from `qc`, and nothing more.
 *
 * `qc.qc_visit` belongs to the qc module; listing may not import its internals
 * and may not join to its schema. So the dependency is inverted into this
 * abstract class: submit knows "ask for an inspection and get a reference back",
 * and knows nothing about scheduling, technicians, tool providers or manifests.
 *
 * It is deliberately **not** an outbox event. The outbox dispatches after commit
 * — correct for a notification, wrong for this: it would leave a window in which
 * the listing is AWAITING_QC and no visit exists, and the retry that closes the
 * window is indistinguishable from a duplicate that opens a second one.
 *
 * When qc grows a real visit service, this abstract class moves to a shared
 * ports file and the provider registration swaps. The seam is what matters; the
 * file it currently lives in does not.
 */
export abstract class QcVisitPort {
  abstract request(input: QcVisitRequest): Promise<QcVisitRef>;
}

/**
 * The in-process implementation, until `qc` has a service of its own.
 *
 * One INSERT, bound parameters, no join and no read of any listing table — the
 * whole point of the port is that the qc module can take this over without
 * anything on the listing side changing.
 */
@Injectable()
export class LocalQcVisitPort extends QcVisitPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {
    super();
  }

  async request(input: QcVisitRequest): Promise<QcVisitRef> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; visit_number: string }>>`
      INSERT INTO qc.qc_visit
        (visit_number, vendor_org_id, facility_id, address_id, requested_by,
         requested_at, units_requested, status, visit_fee, fee_bearer)
      VALUES
        (${this.visitNumber()}, ${input.vendorOrgId}::uuid, ${input.facilityId}::uuid,
         ${input.addressId}::uuid, ${input.requestedBy}::uuid, ${this.clock.now()},
         ${input.unitsRequested}, 'REQUESTED', ${input.visitFee.toString()}::numeric,
         ${input.feeBearer})
      RETURNING id, visit_number`;
    return { id: rows[0]!.id, visitNumber: rows[0]!.visit_number };
  }

  /**
   * The reference a vendor and a technician say out loud to each other.
   *
   * ponytail: random suffix, not a per-day sequence. 8 hex characters is about
   * one collision per 8,000 days at a thousand visits a day, and `visit_number`
   * is UNIQUE so a collision is a loud failure rather than a shared reference.
   * If that day arrives, give it a sequence — it needs DDL, so it is not free.
   */
  private visitNumber(): string {
    const day = this.clock.nowIso().slice(0, 10).replace(/-/g, '');
    return `QCV-${day}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }
}

/**
 * The three `platform_config` keys this flow is tuned by.
 *
 * `qc.visit_fee_waived_above` used to be read here as `qc.visit_fee_waiver_units`
 * — **one number under two names**, and no database had both. The baseline
 * migration writes `waived_above` (which `PricingService` reads); the seed wrote
 * `waiver_units` (which only this file read). So a database built from the seed
 * alone could not price a listing, and one built from migrations alone could not
 * request an inspection. Both names meant "the batch size above which we stop
 * charging the visit fee", and a value that has two keys eventually has two
 * values.
 */
const CONFIG_KEYS = ['qc.min_units_per_visit', 'qc.visit_fee_inr', 'qc.visit_fee_waived_above'];

interface VisitEconomics {
  minUnitsPerVisit: number;
  visitFee: Money;
  waiverUnits: number;
}

@Injectable()
export class SubmitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly scope: OrgScope,
    private readonly ctx: RequestContextService,
    private readonly movements: StockMovementService,
    private readonly qcVisits: QcVisitPort,
    private readonly bus: EventBus,
  ) {}

  /**
   * Request an inspection for every unit on a draft listing.
   *
   * `choice` answers the minimum-units question and is only ever needed after a
   * DECISION_REQUIRED came back. Passing it when the batch is already large
   * enough is harmless and ignored — the fee question does not arise.
   */
  async submit(listingId: string, choice?: SubmitChoice): Promise<SubmitResult> {
    const economics = await this.economics();

    return this.prisma.runInTransaction(async () => {
      // FOR UPDATE before anything is read off it: two tabs pressing submit on
      // the same listing must not each raise a visit for the same machines.
      const [listing] = await this.prisma.$queryRaw<
        Array<{
          id: string;
          vendor_org_id: string;
          pickup_location_id: string;
          status: string;
        }>
      >`
        SELECT id, vendor_org_id, pickup_location_id, status
          FROM listing.listing WHERE id = ${listingId}::uuid FOR UPDATE`;
      if (!listing) throw new NotFoundError('listing');
      this.scope.assertOwns(listing.vendor_org_id, 'listing');
      if (listing.status !== 'DRAFT') {
        throw new IllegalStateTransitionError('listing', listing.status, 'AWAITING_QC');
      }

      const unitIds = (
        await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM listing.unit WHERE listing_id = ${listingId}::uuid ORDER BY id`
      ).map((r) => r.id);

      if (unitIds.length === 0) {
        throw new ValidationError('Add at least one serial number before submitting.', {
          serials: 'A listing with no machines has nothing to inspect.',
        });
      }

      const shortBy = Math.max(0, economics.minUnitsPerVisit - unitIds.length);

      // HOLD is honoured unconditionally, including once the batch has grown past
      // the minimum. A client replaying the answer to an older question — the
      // vendor said "hold", then added twenty more serials in another tab — must
      // not have that answer turned into a submission. Nothing is written.
      if (choice === 'HOLD') {
        return {
          outcome: 'HELD' as const,
          unitCount: unitIds.length,
          minUnitsPerVisit: economics.minUnitsPerVisit,
          shortBy,
        };
      }

      if (shortBy > 0) {
        // Below the minimum a technician's day is worth. The vendor gets the
        // choice, not a refusal — hold the units until they reach it, or accept
        // the fee. Silently rejecting is how a vendor with eighteen machines
        // decides the platform does not want their stock.
        const visitFee = unitIds.length > economics.waiverUnits ? money(0) : economics.visitFee;
        if (choice !== 'ACCEPT_FEE') {
          return {
            outcome: 'DECISION_REQUIRED' as const,
            unitCount: unitIds.length,
            minUnitsPerVisit: economics.minUnitsPerVisit,
            shortBy,
            visitFee,
            options: ['HOLD', 'ACCEPT_FEE'] as const,
          };
        }
        return this.request(listing, unitIds, visitFee, visitFee.isZero() ? 'WAIVED' : 'VENDOR');
      }

      // At or above the minimum the visit pays for itself, so we carry it.
      return this.request(listing, unitIds, money(0), 'TRUETECH');
    });
  }

  /** Everything after the fee question is settled. Runs inside the transaction. */
  private async request(
    listing: { id: string; vendor_org_id: string; pickup_location_id: string },
    unitIds: readonly string[],
    visitFee: Money,
    feeBearer: FeeBearer,
  ): Promise<SubmitAccepted> {
    const facilityId = await this.facilityAt(listing.pickup_location_id, listing.vendor_org_id);
    const now = this.clock.now();

    const visit = await this.qcVisits.request({
      vendorOrgId: listing.vendor_org_id,
      facilityId,
      addressId: listing.pickup_location_id,
      requestedBy: this.ctx.principal?.userId ?? null,
      unitsRequested: unitIds.length,
      visitFee,
      feeBearer,
    });

    // Every unit moves through the one function that records movements, so the
    // visit reference is on the trail from the first transition rather than
    // being reconstructed later from timestamps.
    //
    // `is_sellable` is not written here even though Task 4 names it: it is a
    // computed column, and `trg_recompute_sellable` forces it FALSE on this
    // transition because AWAITING_QC is not LISTED. Setting it by hand would
    // give it two authors and hide the day the trigger stops agreeing.
    // `qty_awaiting_qc` is the same story — `trg_listing_counters` derives it
    // from the units, which is the only definition that cannot drift.
    const moved = await this.movements.transition({
      unitIds,
      expectedFrom: 'CREATED',
      to: 'AWAITING_QC',
      reason: 'Vendor submitted the listing; inspection requested.',
      refType: 'QC_VISIT',
      refId: visit.id,
    });

    if (moved.length !== unitIds.length) {
      // Something moved a unit off CREATED while the listing was still a draft.
      // The transaction rolls back, visit included — a half-submitted listing is
      // worse than a failed submit, because nobody goes looking for it.
      throw new ConflictError(
        'Some of these machines changed status while the listing was being submitted. Nothing was submitted — please try again.',
        { listingId: listing.id, expected: unitIds.length, moved: moved.length },
      );
    }

    await this.prisma.$executeRaw`
      UPDATE listing.unit SET qc_visit_id = ${visit.id}::uuid
       WHERE id = ANY(${[...unitIds]}::uuid[])`;

    await this.prisma.$executeRaw`
      UPDATE listing.listing
         SET status          = 'AWAITING_QC',
             qc_requested_at = ${now},
             qc_visit_id     = ${visit.id}::uuid,
             updated_at      = ${now}
       WHERE id = ${listing.id}::uuid`;

    // The vendor's "Inspection requested — we'll confirm a slot" message rides
    // this, through the outbox, so it is sent only if the transaction commits
    // and never for a submit that rolled back. Whoever owns notifications
    // subscribes; nothing here knows about templates or channels.
    await this.bus.publish('listing.submitted', {
      listingId: listing.id,
      vendorOrgId: listing.vendor_org_id,
      facilityId,
      unitCount: unitIds.length,
    });

    return {
      outcome: 'SUBMITTED',
      listingId: listing.id,
      status: 'AWAITING_QC',
      unitCount: unitIds.length,
      qcVisitId: visit.id,
      visitNumber: visit.visitNumber,
      visitFee,
      feeBearer,
    };
  }

  /**
   * The facility a technician would actually be sent to.
   *
   * `qc_visit.facility_id` is NOT NULL and a listing only carries a pickup
   * address, so the two are reconciled here — `vendor_facility.address_id` is
   * UNIQUE, which makes it a lookup rather than a choice. A pickup address with
   * no facility behind it is a real and recoverable state: it means the vendor
   * added an address but never described the site, and the fix is a form, not a
   * support ticket.
   */
  private async facilityAt(addressId: string, orgId: string): Promise<string> {
    const [facility] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM vendor.vendor_facility
       WHERE address_id = ${addressId}::uuid AND org_id = ${orgId}::uuid`;
    if (!facility) {
      throw new PreconditionFailedError(
        'We can only send a technician to a registered facility. Add this pickup address as a facility in your vendor profile, then submit again.',
        { addressId, reason: 'pickup_address_has_no_facility' },
      );
    }
    return facility.id;
  }

  /**
   * The visit thresholds, from `platform_config` through `v_current_config` —
   * effective-dated, latest wins, which is the only view anything reads.
   *
   * A missing key throws rather than falling back to the number in the phase
   * doc. A silent default is worse than an outage here: ops lowering the minimum
   * to 10 and the code still sending technicians at 25 is a decision that was
   * made, recorded, and quietly ignored.
   */
  private async economics(): Promise<VisitEconomics> {
    const rows = await this.prisma.$queryRaw<Array<{ key: string; value_json: unknown }>>`
      SELECT key, value_json FROM platform.v_current_config
       WHERE key = ANY(${CONFIG_KEYS}::text[])`;
    const byKey = new Map(rows.map((r) => [r.key, r.value_json]));

    const missing = CONFIG_KEYS.filter((k) => !byKey.has(k));
    if (missing.length > 0) {
      throw new PreconditionFailedError(
        "We can't request inspections just now. Please try again shortly.",
        { reason: 'missing_platform_config', keys: missing },
      );
    }

    const count = (key: string): number => {
      const v = byKey.get(key);
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw new PreconditionFailedError(
          "We can't request inspections just now. Please try again shortly.",
          { reason: 'malformed_platform_config', key, value: v },
        );
      }
      return v;
    };

    return {
      minUnitsPerVisit: count('qc.min_units_per_visit'),
      // Config holds it as a JSON number; `money()` parses the decimal string and
      // refuses anything with a third decimal place, so a fat-fingered fee is a
      // loud failure rather than a silently truncated one.
      visitFee: money(String(byKey.get('qc.visit_fee_inr'))),
      waiverUnits: count('qc.visit_fee_waived_above'),
    };
  }
}
