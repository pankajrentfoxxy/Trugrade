import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { normalisePastedSerial, validateSerialBatch, type Grade } from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import {
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { QcRepository } from './qc.repository';
import { SchedulingService } from './scheduling.service';

/**
 * The order-first inspection: a technician is sent for exactly the machines a
 * buyer ordered, and names each one.
 *
 * A listing is a declared quantity with no serials. When a buyer orders, ops
 * assigns a technician here; that creates one `qc_visit` per consignment
 * (vendor + pickup address) carrying `order_id`. At the vendor's site the
 * technician types the serial of each machine into a vacant `order_line_unit`
 * slot. That is the moment the machine gets an identity: a `listing.unit` row
 * is created, the nationwide `uq_unit_active_serial` index refuses a serial
 * that is live elsewhere, and the blacklist is checked.
 *
 * Naming a machine and judging it are two moments, and they are two methods.
 * `nameUnit` gives the serial an identity and a PENDING line on the visit's
 * manifest; the console's inspection form then records the full twelve-area
 * report against that unit, and `settleUnit` carries the verdict back onto
 * the order — the slot's status, the order's progress. `recordUnit`, the
 * technician app's one-tap path, is the two around a bare pass: presence and
 * serial as the evidence, no report, no invented score, and every screen that
 * reads such a unit says "not measured" for what was not measured.
 *
 * Cross-schema writes to `ordering` and `listing` are raw statements, one
 * schema each, the way `ordering` writes `listing.unit` today.
 */

export interface OrderInspectionSlot {
  slotId: string;
  title: string | null;
  specSummary: string | null;
  grade: Grade;
  serialNumber: string | null;
  inspectedAt: string | null;
  verifiedAt: string | null;
}

export interface OrderInspectionView {
  visitId: string;
  visitNumber: string;
  status: string;
  orderNumber: string;
  /** The vendor's name: this is a staff screen, and the technician is going there. */
  vendorLegalName: string | null;
  site: { line1: string; city: string; pincode: string } | null;
  technicianId: string | null;
  technicianName: string | null;
  assignedAt: string | null;
  /** Who sent the technician. The ops user on the visit's `requested_by`. */
  assignedByName: string | null;
  scheduledDate: string | null;
  /** The technician's first and last recorded serial, on the visit's own clock. */
  startedAt: string | null;
  completedAt: string | null;
  /**
   * When the LAST machine on this visit was verified, and by whom — null while
   * any machine is still unverified. Verification is per machine on
   * `order_line_unit`, so the visit's moment is the latest of its slots'.
   */
  verifiedAt: string | null;
  verifiedByName: string | null;
  /**
   * The purchase order raised to this supply point for this order, or null
   * when none has been. One consignment, one PO; the newest wins if a
   * re-raise ever leaves two.
   */
  purchaseOrderNumber: string | null;
  unitsRequested: number;
  unitsInspected: number;
  slots: OrderInspectionSlot[];
}

export interface AssignResult {
  orderNumber: string;
  visits: Array<{ visitId: string; visitNumber: string; units: number }>;
  technicianName: string;
}

interface VisitRow {
  id: string;
  visit_number: string;
  status: string;
  order_id: string;
  vendor_org_id: string;
  address_id: string;
  technician_id: string | null;
  requested_by: string | null;
  requested_at: Date;
  scheduled_date: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  units_requested: number;
  units_inspected: number;
}

@Injectable()
export class OrderInspectionService {
  private readonly logger = new Logger(OrderInspectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly repo: QcRepository,
    private readonly scheduling: SchedulingService,
  ) {}

  /* ------------------------------------------------------------------------
   * Ops: assign a technician to an order
   * --------------------------------------------------------------------- */

  /**
   * Send a technician for an order's machines.
   *
   * With a `slot`, every visit the assignment creates or moves is booked through
   * `SchedulingService.schedule` — the same six checks a stock visit passes
   * (site hours, zone, certification, availability, day capacity, licence) —
   * inside this transaction, so a refusal rolls the assignment back rather than
   * leaving a technician named on a visit nobody could book. Without a slot the
   * visit is dated today and unslotted, as before.
   */
  async assign(
    orderNumber: string,
    technicianId: string,
    slot?: { scheduledDate: string; slotFrom: string; slotTo: string },
  ): Promise<AssignResult> {
    const technicians = await this.repo.findTechnicians({ activeOnly: true });
    const technician = technicians.find((t) => t.id === technicianId);
    if (!technician) {
      throw new ValidationError('Pick an active technician.', {
        technicianId: 'That technician is not on the active roster.',
      });
    }
    const [name] = await this.prisma.$queryRaw<Array<{ full_name: string }>>`
      SELECT full_name FROM identity.user_account WHERE id = ${technician.userId}::uuid`;

    return this.prisma.runInTransaction(async () => {
      const [order] = await this.prisma.$queryRaw<
        Array<{ id: string; status: string; order_number: string }>
      >`
        SELECT id, status::text AS status, order_number
          FROM ordering."order" WHERE order_number = ${orderNumber} FOR UPDATE`;
      if (!order) throw new NotFoundError('order', { orderNumber });
      if (order.status !== 'AWAITING_INSPECTION' && order.status !== 'QC_IN_PROGRESS') {
        throw new PreconditionFailedError(
          `Order ${orderNumber} is ${order.status.toLowerCase().replaceAll('_', ' ')}, so a technician cannot be assigned to it.`,
          { reason: 'order_not_inspectable', status: order.status },
        );
      }

      const consignments = await this.prisma.$queryRaw<
        Array<{ id: string; vendor_org_id: string; pickup_address_id: string | null; units: number }>
      >`
        SELECT so.id, so.vendor_org_id, so.pickup_address_id,
               (SELECT count(*)::int FROM ordering.order_line_unit olu
                  JOIN ordering.order_line ol ON ol.id = olu.order_line_id
                 WHERE ol.sub_order_id = so.id) AS units
          FROM ordering.sub_order so
         WHERE so.order_id = ${order.id}::uuid
         ORDER BY so.sub_order_number`;

      const now = this.clock.now();
      const visits: AssignResult['visits'] = [];
      for (const c of consignments) {
        if (!c.pickup_address_id) {
          throw new PreconditionFailedError(
            'One consignment on this order has no pickup address, so there is nowhere to send a technician.',
            { reason: 'consignment_without_pickup', subOrderId: c.id },
          );
        }
        const facilityId = await this.facilityAt(c.pickup_address_id, c.vendor_org_id);

        // One visit per consignment. Reassigning moves the technician on the
        // existing visit rather than raising a second one for the same machines.
        const [existing] = await this.prisma.$queryRaw<Array<{ id: string; visit_number: string }>>`
          SELECT id, visit_number FROM qc.qc_visit
           WHERE order_id = ${order.id}::uuid AND vendor_org_id = ${c.vendor_org_id}::uuid
             AND address_id = ${c.pickup_address_id}::uuid
             AND status NOT IN ('CANCELLED', 'COMPLETED')`;
        if (existing) {
          await this.prisma.$executeRaw`
            UPDATE qc.qc_visit
               SET technician_id = ${technicianId}::uuid, status = 'TECH_ASSIGNED',
                   scheduled_date = COALESCE(scheduled_date, ${now}::date)
             WHERE id = ${existing.id}::uuid`;
          if (slot) await this.scheduling.schedule(existing.id, { ...slot, technicianId });
          visits.push({ visitId: existing.id, visitNumber: existing.visit_number, units: c.units });
          continue;
        }

        const visitId = randomUUID();
        const visitNumber = this.visitNumber();
        await this.prisma.$executeRaw`
          INSERT INTO qc.qc_visit
            (id, visit_number, vendor_org_id, facility_id, address_id, requested_by, requested_at,
             units_requested, technician_id, scheduled_date, status, visit_fee, fee_bearer, order_id)
          VALUES (${visitId}::uuid, ${visitNumber}, ${c.vendor_org_id}::uuid, ${facilityId}::uuid,
                  ${c.pickup_address_id}::uuid, ${this.ctx.principal?.userId ?? null}::uuid, ${now},
                  ${c.units}, ${technicianId}::uuid, ${now}::date, 'TECH_ASSIGNED', 0, 'TRUETECH',
                  ${order.id}::uuid)`;
        if (slot) await this.scheduling.schedule(visitId, { ...slot, technicianId });
        visits.push({ visitId, visitNumber, units: c.units });
      }

      if (order.status === 'AWAITING_INSPECTION') {
        await this.prisma.$executeRaw`
          UPDATE ordering."order" SET status = 'QC_IN_PROGRESS'::public.order_status
           WHERE id = ${order.id}::uuid`;
        await this.prisma.$executeRaw`
          UPDATE ordering.sub_order SET status = 'QC_IN_PROGRESS'::public.order_status
           WHERE order_id = ${order.id}::uuid`;
      }
      await this.prisma.$executeRaw`
        INSERT INTO ordering.order_event
          (order_id, event_type, from_status, to_status, actor_id, note, occurred_at)
        VALUES (${order.id}::uuid, 'order.technician_assigned', ${order.status}, 'QC_IN_PROGRESS',
                ${this.ctx.principal?.userId ?? null}::uuid,
                ${`${name?.full_name ?? technician.employeeCode} will inspect the machines at the supply point and record each serial.`},
                ${now})`;

      return {
        orderNumber: order.order_number,
        visits,
        technicianName: name?.full_name ?? technician.employeeCode,
      };
    });
  }

  /* ------------------------------------------------------------------------
   * Reads — the technician's queue and one visit
   * --------------------------------------------------------------------- */

  /** Every order visit assigned to the signed-in technician, open first. */
  async mine(userId: string): Promise<OrderInspectionView[]> {
    const technician = await this.repo.findTechnicianByUserId(userId);
    if (!technician) {
      throw new PreconditionFailedError('This account is not registered as a QC technician.', {
        userId,
        reason: 'not_a_technician',
      });
    }
    const rows = await this.prisma.$queryRaw<VisitRow[]>`
      SELECT id, visit_number, status::text AS status, order_id, vendor_org_id, address_id,
             technician_id, requested_by, requested_at, scheduled_date, started_at, completed_at,
             units_requested, units_inspected
        FROM qc.qc_visit
       WHERE order_id IS NOT NULL AND technician_id = ${technician.id}::uuid
       ORDER BY CASE WHEN status IN ('COMPLETED', 'CANCELLED') THEN 1 ELSE 0 END, requested_at DESC`;
    return Promise.all(rows.map((r) => this.view(r)));
  }

  /** Every order visit on the platform, for the ops board. */
  async all(): Promise<OrderInspectionView[]> {
    const rows = await this.prisma.$queryRaw<VisitRow[]>`
      SELECT id, visit_number, status::text AS status, order_id, vendor_org_id, address_id,
             technician_id, requested_by, requested_at, scheduled_date, started_at, completed_at,
             units_requested, units_inspected
        FROM qc.qc_visit
       WHERE order_id IS NOT NULL
       ORDER BY CASE WHEN status IN ('COMPLETED', 'CANCELLED') THEN 1 ELSE 0 END, requested_at DESC`;
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async one(visitId: string, opts: { forUserId?: string } = {}): Promise<OrderInspectionView> {
    const row = await this.visit(visitId);
    if (opts.forUserId) {
      const technician = await this.repo.findTechnicianByUserId(opts.forUserId);
      if (!technician || technician.id !== row.technician_id) {
        throw new NotFoundError('visit', { reason: 'not_assigned_to_this_technician' });
      }
    }
    return this.view(row);
  }

  /* ------------------------------------------------------------------------
   * Technician: name one machine
   * --------------------------------------------------------------------- */

  /**
   * Record the serial of one ordered machine, and a bare passing inspection.
   *
   * The technician app's one-tap path. The console's inspection form does not
   * come here: it names the machine with `nameUnit`, writes a full report, and
   * settles the slot from the verdict.
   *
   * Idempotent on the slot: sending the same serial for a slot that already
   * carries it is a no-op, so a retried request does not create a second unit.
   */
  async recordUnit(input: {
    visitId: string;
    slotId: string;
    serial: string;
    userId: string;
  }): Promise<OrderInspectionView> {
    const technician = await this.repo.findTechnicianByUserId(input.userId);
    if (!technician) {
      throw new PreconditionFailedError('This account is not registered as a QC technician.', {
        userId: input.userId,
        reason: 'not_a_technician',
      });
    }

    await this.prisma.runInTransaction(async () => {
      const visit = await this.visit(input.visitId);
      if (visit.technician_id !== technician.id) {
        throw new NotFoundError('visit', { reason: 'not_assigned_to_this_technician' });
      }
      const named = await this.nameUnit(input);
      if (named.alreadyNamed) return;
      await this.prisma.$executeRaw`
        UPDATE qc.qc_visit_unit
           SET outcome = 'PASS'::public.qc_unit_outcome, completed_at = ${this.clock.now()}
         WHERE id = ${named.visitUnitId}::uuid`;
      await this.settleUnit({ visitId: input.visitId, unitId: named.unitId, userId: input.userId, passed: true });
    });

    return this.one(input.visitId);
  }

  /**
   * Give one ordered machine its identity: the serial the technician read off
   * it, checked and written, with nothing yet said about whether it passed.
   *
   * Creates the `listing.unit` — RESERVED for the order; the nationwide
   * `uq_unit_active_serial` index refuses a serial that is live elsewhere and
   * the blacklist is checked first — the stock movement, and a PENDING line on
   * the visit's manifest, and writes the serial onto the slot. The visit goes
   * IN_PROGRESS. The slot's status and `inspected_at` wait for `settleUnit`,
   * once there is a verdict to settle with.
   *
   * Idempotent on the slot: the same serial for a slot that already carries it
   * returns the rows that exist, so a retried report does not create a second
   * unit. A different serial for a named slot is refused — a slot is not
   * renamed; ops releases it.
   */
  async nameUnit(input: {
    visitId: string;
    slotId: string;
    serial: string;
    userId: string;
  }): Promise<{ visitUnitId: string; unitId: string; serial: string; alreadyNamed: boolean }> {
    const serial = normalisePastedSerial(input.serial);
    const batch = validateSerialBatch({ serials: [serial], blacklisted: await this.blacklisted(serial) });
    const problem = batch.errors[0];
    if (problem) {
      throw new ValidationError(problem.message, { serial: problem.message });
    }

    return this.prisma.runInTransaction(async () => {
      const visit = await this.visit(input.visitId);
      if (visit.status === 'COMPLETED' || visit.status === 'CANCELLED') {
        throw new PreconditionFailedError('This visit is closed. Nothing more can be recorded on it.', {
          reason: 'visit_closed',
          status: visit.status,
        });
      }

      const [slot] = await this.prisma.$queryRaw<
        Array<{
          id: string;
          unit_id: string | null;
          serial_number: string | null;
          order_line_id: string;
          listing_id: string;
          sku_id: string;
          grade: string;
          vendor_org_id: string;
        }>
      >`
        SELECT olu.id, olu.unit_id, olu.serial_number, ol.id AS order_line_id, ol.listing_id,
               ol.sku_id, ol.grade::text AS grade, so.vendor_org_id
          FROM ordering.order_line_unit olu
          JOIN ordering.order_line ol ON ol.id = olu.order_line_id
          JOIN ordering.sub_order so ON so.id = ol.sub_order_id
         WHERE olu.id = ${input.slotId}::uuid
           AND so.order_id = ${visit.order_id}::uuid
           AND so.vendor_org_id = ${visit.vendor_org_id}::uuid
           AND so.pickup_address_id = ${visit.address_id}::uuid
           FOR UPDATE OF olu`;
      if (!slot) throw new NotFoundError('slot', { reason: 'slot_not_on_this_visit' });
      if (slot.unit_id) {
        if (slot.serial_number !== serial) {
          throw new ConflictError(
            `This machine is already recorded as ${slot.serial_number}. A slot cannot be renamed; ask ops to release it.`,
            { reason: 'slot_already_named' },
          );
        }
        const [line] = await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM qc.qc_visit_unit
           WHERE visit_id = ${visit.id}::uuid AND unit_id = ${slot.unit_id}::uuid`;
        if (!line) throw new NotFoundError('visit unit', { reason: 'slot_named_off_this_visit' });
        return { visitUnitId: line.id, unitId: slot.unit_id, serial, alreadyNamed: true };
      }

      const [listing] = await this.prisma.$queryRaw<
        Array<{ vendor_ask_price: unknown; unit_price: unknown; pickup_location_id: string }>
      >`
        SELECT vendor_ask_price, unit_price, pickup_location_id
          FROM listing.listing WHERE id = ${slot.listing_id}::uuid`;
      if (!listing) throw new NotFoundError('listing', { listingId: slot.listing_id });

      const now = this.clock.now();
      const validUntil = new Date(now.getTime() + 90 * 86_400_000);
      const unitId = randomUUID();
      try {
        // Named and reserved for this order. `is_sellable` stays false by the
        // trigger — a RESERVED machine is not for sale. `qc_passed_at` is
        // written now for the app's bare-pass path; the verdict engine
        // overwrites it, either way, when a full report is recorded.
        await this.prisma.$executeRaw`
          INSERT INTO listing.unit
            (id, serial_number, listing_id, vendor_org_id, sku_id, grade_declared, grade_actual,
             status, order_line_id, qc_visit_id, qc_passed_at, qc_valid_until,
             vendor_ask_price, retail_price, supply_point_code, location)
          VALUES (${unitId}::uuid, ${serial}, ${slot.listing_id}::uuid, ${slot.vendor_org_id}::uuid,
                  ${slot.sku_id}::uuid, ${slot.grade}::public.grade_type, ${slot.grade}::public.grade_type,
                  'RESERVED'::public.unit_status, ${slot.order_line_id}::uuid, ${visit.id}::uuid,
                  ${now}, ${validUntil}::date,
                  ${String(listing.vendor_ask_price ?? listing.unit_price)}::numeric,
                  ${String(listing.unit_price)}::numeric,
                  ${await this.supplyPointCode(slot.vendor_org_id, listing.pickup_location_id)},
                  'VENDOR')`;
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002' || /uq_unit_active_serial/.test(String(e))) {
          throw new ConflictError(
            `Serial ${serial} is already live on the platform. A laptop can be in exactly one place at a time — check the sticker and try again.`,
            { reason: 'serial_already_live', serial },
          );
        }
        throw e;
      }

      await this.prisma.$executeRaw`
        INSERT INTO listing.stock_movement
          (unit_id, from_status, to_status, from_location, to_location, reason, actor_id,
           ref_type, ref_id, occurred_at)
        VALUES (${unitId}::uuid, NULL, 'RESERVED'::public.unit_status, NULL, 'VENDOR',
                ${`Named by the technician on visit ${visit.visit_number} for the order.`},
                ${input.userId}::uuid, 'QC_VISIT', ${visit.id}::uuid, ${now})`;

      const [line] = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO qc.qc_visit_unit
          (visit_id, unit_id, serial_number, listing_id, sequence_no, outcome, started_at)
        VALUES (${visit.id}::uuid, ${unitId}::uuid, ${serial}, ${slot.listing_id}::uuid,
                (SELECT count(*)::int + 1 FROM qc.qc_visit_unit WHERE visit_id = ${visit.id}::uuid),
                'PENDING'::public.qc_unit_outcome, ${now})
        RETURNING id`;
      if (!line) throw new NotFoundError('visit unit', { reason: 'manifest_line_not_written' });

      await this.prisma.$executeRaw`
        UPDATE ordering.order_line_unit
           SET unit_id = ${unitId}::uuid, serial_number = ${serial}
         WHERE id = ${slot.id}::uuid`;
      await this.prisma.$executeRaw`
        UPDATE qc.qc_visit
           SET status = 'IN_PROGRESS'::public.qc_visit_status,
               started_at = COALESCE(started_at, ${now})
         WHERE id = ${visit.id}::uuid`;

      return { visitUnitId: line.id, unitId, serial, alreadyNamed: false };
    });
  }

  /**
   * The verdict reaches the order.
   *
   * The slot takes the unit's QC state and its `inspected_at`. Any machine
   * that did not fail goes back to RESERVED for the buyer: the verdict engine
   * writes QC_PASSED (QC_SEALED once its seal is pointed at it) for a
   * certified pass and QC_MISMATCH for a pass it holds for review, and
   * everything downstream — verification, the PO, the pickup, a refusal's
   * release — finds an ordered machine by RESERVED. For an ordered machine the
   * review the engine is holding for IS ops verification, so a held pass must
   * reach it rather than be refused by it; the slot keeps QC_MISMATCH so the
   * verifier sees it was held. The pass itself lives on in `qc_passed_at`,
   * the report and the seal rows. A failed machine stays QC_FAILED. When the
   * last slot is in, the visit closes and the order moves to
   * AWAITING_VERIFICATION.
   *
   * `passed` is for the app's bare-pass path, which has no verdict on the unit
   * to read; the report path leaves it out and the unit's state decides.
   */
  async settleUnit(input: { visitId: string; unitId: string; userId: string; passed?: boolean }): Promise<void> {
    await this.prisma.runInTransaction(async () => {
      const visit = await this.visit(input.visitId);
      const now = this.clock.now();
      const [unit] = await this.prisma.$queryRaw<Array<{ status: string; qc_report_id: string | null }>>`
        SELECT status::text AS status, qc_report_id FROM listing.unit WHERE id = ${input.unitId}::uuid`;
      if (!unit) throw new NotFoundError('unit', { unitId: input.unitId });

      const PASSED = ['QC_PASSED', 'QC_SEALED'];
      const JUDGED = [...PASSED, 'QC_MISMATCH', 'QC_FAILED'];
      if (!input.passed && !JUDGED.includes(unit.status)) {
        throw new PreconditionFailedError('The inspection left no verdict on the unit, so the order cannot take one.', {
          reason: 'no_verdict_on_unit',
          status: unit.status,
        });
      }
      const slotStatus = input.passed || PASSED.includes(unit.status) ? 'QC_PASSED' : unit.status;

      // The slot keeps the report the machine was sold against: the buyer's
      // machines tab and the PO line read QC through this id and no other, so a
      // re-inspection months later cannot redraw what they were sold under.
      await this.prisma.$executeRaw`
        UPDATE ordering.order_line_unit
           SET status = ${slotStatus}::public.unit_status, inspected_at = ${now},
               qc_report_id = COALESCE(${unit.qc_report_id}::uuid, qc_report_id)
         WHERE unit_id = ${input.unitId}::uuid`;
      if (slotStatus !== 'QC_FAILED') {
        await this.prisma.$executeRaw`
          UPDATE listing.unit SET status = 'RESERVED'::public.unit_status
           WHERE id = ${input.unitId}::uuid
             AND status IN ('QC_PASSED'::public.unit_status, 'QC_SEALED'::public.unit_status,
                            'QC_MISMATCH'::public.unit_status)`;
      }

      // The visit's own progress, and the order's.
      const [progress] = await this.prisma.$queryRaw<Array<{ total: number; done: number }>>`
        SELECT count(*)::int AS total, count(olu.inspected_at)::int AS done
          FROM ordering.order_line_unit olu
          JOIN ordering.order_line ol ON ol.id = olu.order_line_id
          JOIN ordering.sub_order so ON so.id = ol.sub_order_id
         WHERE so.order_id = ${visit.order_id}::uuid
           AND so.vendor_org_id = ${visit.vendor_org_id}::uuid
           AND so.pickup_address_id = ${visit.address_id}::uuid`;
      const done = progress?.done ?? 0;
      const total = progress?.total ?? 0;
      await this.prisma.$executeRaw`
        UPDATE qc.qc_visit
           SET status = ${done >= total ? 'COMPLETED' : 'IN_PROGRESS'}::public.qc_visit_status,
               started_at = COALESCE(started_at, ${now}),
               completed_at = ${done >= total ? now : null}
         WHERE id = ${visit.id}::uuid`;

      const [orderProgress] = await this.prisma.$queryRaw<Array<{ total: number; done: number }>>`
        SELECT count(*)::int AS total, count(olu.inspected_at)::int AS done
          FROM ordering.order_line_unit olu
          JOIN ordering.order_line ol ON ol.id = olu.order_line_id
          JOIN ordering.sub_order so ON so.id = ol.sub_order_id
         WHERE so.order_id = ${visit.order_id}::uuid`;
      if ((orderProgress?.done ?? 0) >= (orderProgress?.total ?? 0)) {
        await this.prisma.$executeRaw`
          UPDATE ordering."order" SET status = 'AWAITING_VERIFICATION'::public.order_status
           WHERE id = ${visit.order_id}::uuid AND status = 'QC_IN_PROGRESS'::public.order_status`;
        await this.prisma.$executeRaw`
          INSERT INTO ordering.order_event
            (order_id, event_type, from_status, to_status, actor_id, note, occurred_at)
          VALUES (${visit.order_id}::uuid, 'order.inspected', 'QC_IN_PROGRESS', 'AWAITING_VERIFICATION',
                  ${input.userId}::uuid,
                  ${`Every machine has been inspected and its serial recorded. Waiting for verification.`},
                  ${now})`;
      }
    });
  }

  /* ------------------------------------------------------------------------
   * Parts
   * --------------------------------------------------------------------- */

  private async visit(visitId: string): Promise<VisitRow> {
    const [row] = await this.prisma.$queryRaw<VisitRow[]>`
      SELECT id, visit_number, status::text AS status, order_id, vendor_org_id, address_id,
             technician_id, requested_by, requested_at, scheduled_date, started_at, completed_at,
             units_requested, units_inspected
        FROM qc.qc_visit WHERE id = ${visitId}::uuid AND order_id IS NOT NULL`;
    if (!row) throw new NotFoundError('visit', { visitId });
    return row;
  }

  private async view(row: VisitRow): Promise<OrderInspectionView> {
    const [order] = await this.prisma.$queryRaw<Array<{ order_number: string }>>`
      SELECT order_number FROM ordering."order" WHERE id = ${row.order_id}::uuid`;
    const [vendor] = await this.prisma.$queryRaw<Array<{ legal_name: string }>>`
      SELECT legal_name FROM identity.organization WHERE id = ${row.vendor_org_id}::uuid`;
    const [site] = await this.prisma.$queryRaw<Array<{ line1: string; city: string; pincode: string }>>`
      SELECT line1, city, pincode FROM identity.org_address WHERE id = ${row.address_id}::uuid`;
    // Two statements, two schemas: `qc` owns the technician row, `identity`
    // owns the person's name.
    const technicianName = row.technician_id ? await this.technicianName(row.technician_id) : null;

    const slots = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sku_id: string;
        grade: string;
        serial_number: string | null;
        inspected_at: Date | null;
        verified_at: Date | null;
        verified_by: string | null;
      }>
    >`
      SELECT olu.id, ol.sku_id, ol.grade::text AS grade, olu.serial_number,
             olu.inspected_at, olu.verified_at, olu.verified_by
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${row.order_id}::uuid
         AND so.vendor_org_id = ${row.vendor_org_id}::uuid
         AND so.pickup_address_id = ${row.address_id}::uuid
       ORDER BY ol.id, olu.inspected_at NULLS LAST, olu.id`;
    const skus = await this.skuTitles([...new Set(slots.map((s) => s.sku_id))]);

    // The visit is verified when its last machine is. One name: verification
    // is one ops action over the order, so every slot carries the same actor.
    const allVerified = slots.length > 0 && slots.every((s) => s.verified_at !== null);
    const verifiedAt = allVerified
      ? new Date(Math.max(...slots.map((s) => s.verified_at?.getTime() ?? 0)))
      : null;
    const verifierId = allVerified ? (slots.find((s) => s.verified_by)?.verified_by ?? null) : null;
    const [assignedByName, verifiedByName, purchaseOrderNumber] = await Promise.all([
      this.userName(row.requested_by),
      this.userName(verifierId),
      this.purchaseOrderFor(row.order_id, row.vendor_org_id),
    ]);

    return {
      visitId: row.id,
      visitNumber: row.visit_number,
      status: row.status,
      orderNumber: order?.order_number ?? '',
      vendorLegalName: vendor?.legal_name ?? null,
      site: site ?? null,
      technicianId: row.technician_id,
      technicianName,
      assignedAt: row.requested_at.toISOString(),
      assignedByName,
      startedAt: row.started_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
      verifiedAt: verifiedAt?.toISOString() ?? null,
      verifiedByName,
      purchaseOrderNumber,
      scheduledDate: row.scheduled_date ? row.scheduled_date.toISOString().slice(0, 10) : null,
      unitsRequested: row.units_requested,
      unitsInspected: slots.filter((s) => s.inspected_at !== null).length,
      slots: slots.map((s) => ({
        slotId: s.id,
        title: skus.get(s.sku_id)?.title ?? null,
        specSummary: skus.get(s.sku_id)?.spec ?? null,
        grade: s.grade as Grade,
        serialNumber: s.serial_number,
        inspectedAt: s.inspected_at?.toISOString() ?? null,
        verifiedAt: s.verified_at?.toISOString() ?? null,
      })),
    };
  }

  /** `procurement` in its own statement: the PO we raised for this order, to this vendor. */
  private async purchaseOrderFor(orderId: string, vendorOrgId: string): Promise<string | null> {
    const [po] = await this.prisma.$queryRaw<Array<{ po_number: string }>>`
      SELECT po_number FROM procurement.purchase_order
       WHERE order_id = ${orderId}::uuid AND vendor_org_id = ${vendorOrgId}::uuid
       ORDER BY created_at DESC LIMIT 1`;
    return po?.po_number ?? null;
  }

  /** A person's name from `identity`, or null for nobody. */
  private async userName(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [user] = await this.prisma.$queryRaw<Array<{ full_name: string }>>`
      SELECT full_name FROM identity.user_account WHERE id = ${userId}::uuid`;
    return user?.full_name ?? null;
  }

  private async technicianName(technicianId: string): Promise<string | null> {
    const [tech] = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT user_id FROM qc.qc_technician WHERE id = ${technicianId}::uuid`;
    if (!tech) return null;
    const [user] = await this.prisma.$queryRaw<Array<{ full_name: string }>>`
      SELECT full_name FROM identity.user_account WHERE id = ${tech.user_id}::uuid`;
    return user?.full_name ?? null;
  }

  private async skuTitles(
    skuIds: readonly string[],
  ): Promise<Map<string, { title: string; spec: string }>> {
    if (skuIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        brand: string;
        model: string;
        cpu_model: string;
        ram_gb: number;
        storage_gb: number;
        storage_type: string;
      }>
    >`
      SELECT s.id, b.name AS brand, m.name AS model, s.cpu_model, s.ram_gb, s.storage_gb,
             s.storage_type::text AS storage_type
        FROM catalog.sku s
        JOIN catalog.model m ON m.id = s.model_id
        JOIN catalog.series se ON se.id = m.series_id
        JOIN catalog.brand b ON b.id = se.brand_id
       WHERE s.id = ANY(${[...skuIds]}::uuid[])`;
    return new Map(
      rows.map((r) => [
        r.id,
        {
          title: `${r.brand} ${r.model}`.trim(),
          spec: [r.cpu_model, `${r.ram_gb} GB`, `${r.storage_gb} GB ${r.storage_type}`].join(' · '),
        },
      ]),
    );
  }

  /**
   * The facility a technician is sent to. A pickup address with no facility
   * behind it is a real, recoverable state and the message says what fixes it.
   */
  private async facilityAt(addressId: string, orgId: string): Promise<string> {
    const [facility] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM vendor.vendor_facility
       WHERE address_id = ${addressId}::uuid AND org_id = ${orgId}::uuid`;
    if (!facility) {
      throw new PreconditionFailedError(
        'The supply point for this order has no registered facility at its pickup address, so a technician cannot be sent. Ask the vendor to add the address as a facility in their profile.',
        { addressId, reason: 'pickup_address_has_no_facility' },
      );
    }
    return facility.id;
  }

  private async supplyPointCode(vendorOrgId: string, addressId: string): Promise<string | null> {
    const [address] = await this.prisma.$queryRaw<Array<{ city: string | null }>>`
      SELECT city FROM identity.org_address WHERE id = ${addressId}::uuid`;
    const city = address?.city?.trim();
    if (!city) return null;
    const [assigned] = await this.prisma.$queryRaw<Array<{ assign_supply_point: string }>>`
      SELECT listing.assign_supply_point(${vendorOrgId}::uuid, ${city})`;
    return assigned?.assign_supply_point ?? null;
  }

  /** `kyc.blacklist_entry` stores SHA-256 hashes of serials, never values. */
  private async blacklisted(serial: string): Promise<string[]> {
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(serial).digest('hex');
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM kyc.blacklist_entry
       WHERE entity_type = 'SERIAL' AND value_hash = ${hash}
         AND active AND (expires_at IS NULL OR expires_at > now())`;
    return (rows[0]?.n ?? 0) > 0 ? [serial] : [];
  }

  private visitNumber(): string {
    const day = this.clock.nowIso().slice(0, 10).replace(/-/g, '');
    return `QCV-${day}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  /** Kept so a future failure path has a logger without re-plumbing. */
  protected get log(): Logger {
    return this.logger;
  }
}
