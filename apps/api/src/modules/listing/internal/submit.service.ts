import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Money } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { OrgScope } from '../../../shared/db/org-scope';
import { EventBus } from '../../../shared/events/event-bus';
import {
  IllegalStateTransitionError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { PricingService } from './pricing.service';

/**
 * Submit. **The listing goes to ops, not to a technician and not to a buyer.**
 *
 * A vendor declares a machine, a condition, a price and a quantity — no serial
 * numbers. Nothing is inspected at this point, because there is nothing to
 * inspect: the machines are identified only once a buyer has ordered them, when
 * a technician is sent to the vendor for that order and names one serial per
 * machine. So submit moves the listing from DRAFT to PENDING_APPROVAL and ops
 * decides whether it goes live (`ListingApprovalService`).
 *
 * The visit economics that used to live here — minimum units per visit, the
 * visit fee, HOLD / ACCEPT_FEE — are gone with the pre-order inspection they
 * priced. `qty_available` stays zero until approval; a buyer cannot see or buy
 * a listing that is still with ops.
 */

/** Kept as the request shape for one reason: the wizard still sends it. Ignored. */
export type SubmitChoice = 'HOLD' | 'ACCEPT_FEE';

export interface SubmitAccepted {
  outcome: 'SUBMITTED';
  listingId: string;
  status: 'PENDING_APPROVAL';
  /** The declared quantity. Named `unitCount` because the wizard already reads it. */
  unitCount: number;
  /**
   * Our selling price once the margin rule has run, or null when pricing failed.
   * Null is reported rather than guessed: an unpriced listing is still with ops
   * and they will see the same gap.
   */
  sellingPrice: Money | null;
}

export type SubmitResult = SubmitAccepted;

export type FeeBearer = 'TRUETECH' | 'VENDOR' | 'SPLIT' | 'WAIVED';

export interface QcVisitRequest {
  vendorOrgId: string;
  facilityId: string;
  addressId: string;
  requestedBy: string | null;
  unitsRequested: number;
  visitFee: Money;
  feeBearer: FeeBearer;
  units: ReadonlyArray<{ unitId: string; serialNumber: string; listingId: string }>;
}

export interface QcVisitRef {
  id: string;
  visitNumber: string;
}

/**
 * The one thing `listing` may ask of `qc`: raise a visit and get a reference.
 *
 * No longer called by submit — the pre-order inspection is gone — but kept
 * bound in the module so a batch inspection can still be requested by hand
 * from the vendor's listing record without re-plumbing the seam.
 */
export abstract class QcVisitPort {
  abstract request(input: QcVisitRequest): Promise<QcVisitRef>;
}

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
    const visit = { id: rows[0]!.id, visitNumber: rows[0]!.visit_number };

    for (const [i, unit] of input.units.entries()) {
      await this.prisma.$executeRaw`
        INSERT INTO qc.qc_visit_unit (visit_id, unit_id, serial_number, listing_id, sequence_no)
        VALUES (${visit.id}::uuid, ${unit.unitId}::uuid, ${unit.serialNumber},
                ${unit.listingId}::uuid, ${i + 1})
        ON CONFLICT (visit_id, unit_id) DO NOTHING`;
    }

    return visit;
  }

  private visitNumber(): string {
    const day = this.clock.nowIso().slice(0, 10).replace(/-/g, '');
    return `QCV-${day}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }
}

@Injectable()
export class SubmitService {
  private readonly logger = new Logger(SubmitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly scope: OrgScope,
    private readonly bus: EventBus,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Send a draft to ops.
   *
   * `_choice` is accepted and ignored so a wizard built for the old three-way
   * answer keeps working while it is replaced; there is no question to answer
   * any more.
   */
  async submit(listingId: string, _choice?: SubmitChoice): Promise<SubmitResult> {
    const submitted = await this.prisma.runInTransaction(async () => {
      // FOR UPDATE before anything is read off it: two tabs pressing submit must
      // not each send the same listing to ops.
      const [listing] = await this.prisma.$queryRaw<
        Array<{ id: string; vendor_org_id: string; status: string; qty_total: number }>
      >`
        SELECT id, vendor_org_id, status, qty_total
          FROM listing.listing WHERE id = ${listingId}::uuid FOR UPDATE`;
      if (!listing) throw new NotFoundError('listing');
      this.scope.assertOwns(listing.vendor_org_id, 'listing');
      if (listing.status !== 'DRAFT') {
        throw new IllegalStateTransitionError('listing', listing.status, 'PENDING_APPROVAL');
      }
      if (listing.qty_total < 1) {
        throw new ValidationError('Say how many machines you are offering before submitting.', {
          qtyTotal: 'A listing with no quantity has nothing for a buyer to order.',
        });
      }

      const now = this.clock.now();
      await this.prisma.$executeRaw`
        UPDATE listing.listing
           SET status     = 'PENDING_APPROVAL',
               updated_at = ${now}
         WHERE id = ${listing.id}::uuid`;

      // Ops' "a listing is waiting for you" notification rides this, through
      // the outbox, so it is sent only if the transaction commits.
      await this.bus.publish('listing.submitted', {
        listingId: listing.id,
        vendorOrgId: listing.vendor_org_id,
        facilityId: null,
        unitCount: listing.qty_total,
      });

      return { id: listing.id, qtyTotal: listing.qty_total };
    });

    // Priced once it is with ops, and outside the transaction above so a
    // pricing problem cannot roll a submission back. Ops sees our selling price
    // beside the vendor's ask on the approval board; a listing that could not
    // be priced shows the gap there rather than failing the vendor here.
    let sellingPrice: Money | null = null;
    try {
      const priced = await this.pricing.priceListing(submitted.id, {
        reason: 'Priced when the listing was sent for approval.',
        changeSource: 'MARGIN_RULE',
      });
      sellingPrice = priced.sellingPrice;
    } catch (err) {
      this.logger.error(
        `Listing ${submitted.id} was submitted but could not be priced: ${(err as Error).message}`,
      );
    }

    return {
      outcome: 'SUBMITTED',
      listingId: submitted.id,
      status: 'PENDING_APPROVAL',
      unitCount: submitted.qtyTotal,
      sellingPrice,
    };
  }
}
