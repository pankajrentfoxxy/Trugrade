import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { uuidSchema } from '@trugrade/contracts';
import { CurrentUser, RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import type { Principal } from '../../shared/db/org-scope';
import { PrismaService } from '../../shared/db/prisma.service';
import { ClockPort } from '../../shared/clock';
import { NotFoundError, PreconditionFailedError } from '../../shared/errors/domain-errors';
import { AutomationService } from '../../shared/automation/automation.service';
import { LogisticsDeliveryService } from './internal/delivery.service';

/**
 * The in-house rider's day.
 *
 * **The manifest is the security boundary of this whole controller.** A rider
 * needs to find a door, check a box and hand it over. Everything past that is a
 * disclosure with no operational purpose, so the pickup manifest carries the
 * address, the contact at that address, the slot, the expected serials, the
 * expected seals, the box count and the destination *city* — and never the
 * vendor's legal name, the customer's name, the customer's full address, or any
 * price. Vendor anonymity is the property this business rests on, and a rider's
 * phone is the least controlled screen the platform has.
 *
 * Every route is scoped to the signed-in rider. A rider id in a URL that is not
 * checked against the session is an app where any rider can read any other
 * rider's run.
 */

const scanSchema = z.object({
  serials: z.array(z.string().trim().min(3).max(64)).max(200),
  seals: z.array(z.string().trim().min(3).max(64)).max(200).default([]),
});
type ScanDto = z.infer<typeof scanSchema>;

const completePickupSchema = z.object({ otp: z.string().regex(/^\d{4,8}$/) });
type CompletePickupDto = z.infer<typeof completePickupSchema>;

const completeDeliverySchema = z.object({
  otp: z.string().regex(/^\d{4,8}$/),
  photoKeys: z.array(z.string().trim().min(3).max(200)).min(1).max(10),
});
type CompleteDeliveryDto = z.infer<typeof completeDeliverySchema>;

const failDeliverySchema = z.object({
  reason: z.string().trim().min(3).max(300),
  outcome: z
    .enum([
      'CONSIGNEE_UNAVAILABLE',
      'ADDRESS_NOT_FOUND',
      'REFUSED',
      'GATE_PASS_MISSING',
      'OFFICE_CLOSED',
    ])
    .default('CONSIGNEE_UNAVAILABLE'),
});
type FailDeliveryDto = z.infer<typeof failDeliverySchema>;

export interface RiderTask {
  kind: 'PICKUP' | 'DELIVERY';
  id: string;
  status: string;
  /** "Supply Point A - Gurugram" for a pickup; the destination city for a drop. */
  label: string;
  city: string;
  slotFrom: string | null;
  slotTo: string | null;
  boxes: number;
}

@Controller('rider')
export class RiderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly deliveries: LogisticsDeliveryService,
    private readonly automation: AutomationService,
  ) {}

  /** Today's run, pickups first — a delivery cannot happen before its collection. */
  @Get('tasks')
  @RequirePermissions('logistics.delivery.execute')
  async tasks(@CurrentUser() user: Principal): Promise<RiderTask[]> {
    const riderId = await this.riderId(user.userId);

    // Two statements rather than a join: `no-cross-schema-join` reads a query
    // spanning `logistics` and `identity` as a cross-module read, and it is
    // right to — an address belongs to identity and is asked for by id.
    const pickups = await this.prisma.$queryRaw<
      Array<{
        id: string;
        status: string;
        slot_from: Date | null;
        slot_to: Date | null;
        address_id: string;
        boxes: bigint;
      }>
    >`
      SELECT p.id, p.status, p.slot_from, p.slot_to, p.address_id,
             coalesce(array_length(p.expected_serials, 1), 0)::bigint AS boxes
        FROM logistics.pickup_task p
       WHERE p.assigned_rider_id = ${riderId}::uuid
         AND p.status IN ('PENDING', 'ASSIGNED', 'ARRIVED')
       ORDER BY p.slot_from NULLS LAST`;

    const drops = await this.prisma.$queryRaw<
      Array<{
        id: string;
        status: string;
        to_address_id: string;
        boxes: number;
      }>
    >`
      SELECT d.id, d.status, s.to_address_id, s.boxes
        FROM logistics.delivery_task d
        JOIN logistics.shipment s ON s.id = d.shipment_id
       WHERE d.rider_id = ${riderId}::uuid
         AND d.status IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'ATTEMPTED')
       ORDER BY d.id`;

    const cities = await this.citiesByAddress([
      ...pickups.map((p) => p.address_id),
      ...drops.map((d) => d.to_address_id),
    ]);

    return [
      ...pickups.map((p, i) => ({
        kind: 'PICKUP' as const,
        id: p.id,
        status: p.status,
        label: `Supply Point ${String.fromCharCode(65 + i)} - ${cities.get(p.address_id) ?? '—'}`,
        city: cities.get(p.address_id) ?? '—',
        slotFrom: p.slot_from?.toISOString() ?? null,
        slotTo: p.slot_to?.toISOString() ?? null,
        boxes: Number(p.boxes),
      })),
      ...drops.map((d) => ({
        kind: 'DELIVERY' as const,
        id: d.id,
        status: d.status,
        label: `Delivery - ${cities.get(d.to_address_id) ?? '—'}`,
        city: cities.get(d.to_address_id) ?? '—',
        slotFrom: null,
        slotTo: null,
        boxes: d.boxes,
      })),
    ];
  }

  /**
   * The pickup manifest — "all details", as the requirement puts it, meaning all
   * the details of the collection and none of the commercial ones.
   */
  @Get('pickup/:id')
  @RequirePermissions('logistics.delivery.execute')
  async pickup(
    @CurrentUser() user: Principal,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{
    id: string;
    status: string;
    address: {
      line1: string;
      city: string;
      pincode: string;
      contactName: string;
      contactMobile: string;
      mapLink: string;
    };
    slotFrom: string | null;
    slotTo: string | null;
    expectedSerials: string[];
    expectedSeals: string[];
    boxes: number;
    destinationCity: string;
  }> {
    const riderId = await this.riderId(user.userId);
    const [task] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        status: string;
        expected_serials: string[];
        expected_seals: string[];
        slot_from: Date | null;
        slot_to: Date | null;
        address_id: string;
        sub_order_id: string;
      }>
    >`
      SELECT p.id, p.status, p.expected_serials, p.expected_seals, p.slot_from, p.slot_to,
             p.address_id, p.sub_order_id
        FROM logistics.pickup_task p
       WHERE p.id = ${id}::uuid AND p.assigned_rider_id = ${riderId}::uuid`;
    if (!task) throw new NotFoundError('pickup_task', { id });

    const address = await this.address(task.address_id);

    // The destination CITY and nothing else about the customer. A rider driving
    // to a hub needs to know which way the parcel is going; the buyer's name and
    // address are the delivery task's business, not the collection's.
    const [shipment] = await this.prisma.$queryRaw<Array<{ to_address_id: string }>>`
      SELECT to_address_id FROM logistics.shipment
       WHERE sub_order_id = ${task.sub_order_id}::uuid`;
    const destinationCity = shipment
      ? ((await this.citiesByAddress([shipment.to_address_id])).get(shipment.to_address_id) ?? '—')
      : '—';

    return {
      id: task.id,
      status: task.status,
      address: {
        line1: address.line1,
        city: address.city,
        pincode: address.pincode,
        contactName: address.contact_name,
        contactMobile: address.contact_mobile,
        mapLink: `https://maps.google.com/?q=${encodeURIComponent(`${address.line1}, ${address.city} ${address.pincode}`)}`,
      },
      slotFrom: task.slot_from?.toISOString() ?? null,
      slotTo: task.slot_to?.toISOString() ?? null,
      expectedSerials: task.expected_serials,
      expectedSeals: task.expected_seals ?? [],
      boxes: task.expected_serials.length,
      destinationCity,
    };
  }

  @Post('pickup/:id/arrive')
  @RequirePermissions('logistics.delivery.execute')
  @HttpCode(200)
  async arriveAtPickup(
    @CurrentUser() user: Principal,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ status: string }> {
    const riderId = await this.riderId(user.userId);
    await this.prisma.$executeRaw`
      UPDATE logistics.pickup_task SET status = 'ARRIVED'
       WHERE id = ${id}::uuid AND assigned_rider_id = ${riderId}::uuid`;
    return { status: 'ARRIVED' };
  }

  /** What the rider actually scanned. Compared against the manifest at completion. */
  @Post('pickup/:id/scan')
  @RequirePermissions('logistics.delivery.execute')
  @HttpCode(200)
  async scan(
    @CurrentUser() user: Principal,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(scanSchema)) body: ScanDto,
  ): Promise<{ scannedSerials: number; scannedSeals: number }> {
    const riderId = await this.riderId(user.userId);
    const updated = await this.prisma.$executeRaw`
      UPDATE logistics.pickup_task
         SET scanned_serials = ${body.serials}::text[],
             scanned_seals = ${body.seals}::text[]
       WHERE id = ${id}::uuid AND assigned_rider_id = ${riderId}::uuid`;
    if (updated === 0) throw new NotFoundError('pickup_task', { id });
    return { scannedSerials: body.serials.length, scannedSeals: body.seals.length };
  }

  /**
   * Close the collection: the OTP, the serials and the seals all have to agree.
   *
   * **A scanner that shrugs is worse than no scanner.** Chain of custody is the
   * entire argument for a graded-device marketplace, so a missing serial refuses
   * outright and a broken seal completes but quarantines: the machines are in the
   * van either way, and pretending otherwise loses them.
   */
  @Post('pickup/:id/complete')
  @RequirePermissions('logistics.delivery.execute')
  @HttpCode(200)
  async completePickup(
    @CurrentUser() user: Principal,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(completePickupSchema)) body: CompletePickupDto,
  ): Promise<{ status: string; sealsIntact: boolean; brokenSealCodes: string[] }> {
    const riderId = await this.riderId(user.userId);
    const [task] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        status: string;
        otp_hash: string | null;
        expected_serials: string[];
        scanned_serials: string[] | null;
        expected_seals: string[] | null;
        scanned_seals: string[] | null;
        sub_order_id: string;
      }>
    >`
      SELECT id, status, otp_hash, expected_serials, scanned_serials,
             expected_seals, scanned_seals, sub_order_id
        FROM logistics.pickup_task
       WHERE id = ${id}::uuid AND assigned_rider_id = ${riderId}::uuid`;
    if (!task) throw new NotFoundError('pickup_task', { id });
    if (task.status === 'COMPLETED') {
      return { status: 'COMPLETED', sealsIntact: true, brokenSealCodes: [] };
    }

    this.deliveries.assertOtp(task.otp_hash, body.otp, task.id);

    const scanned = new Set(task.scanned_serials ?? []);
    const missing = task.expected_serials.filter((s) => !scanned.has(s));
    if (missing.length > 0) {
      throw new PreconditionFailedError(
        `${missing.length} machine(s) on this collection have not been scanned. Scan every serial before closing it.`,
        { reason: 'serials_missing', missing },
      );
    }

    const expectedSeals = task.expected_seals ?? [];
    const scannedSeals = new Set(task.scanned_seals ?? []);
    const brokenSealCodes = expectedSeals.filter((code) => !scannedSeals.has(code));
    const sealsIntact = brokenSealCodes.length === 0;

    const now = this.clock.now();
    await this.prisma.$executeRaw`
      UPDATE logistics.pickup_task
         SET status = 'COMPLETED', completed_at = ${now},
             seals_intact = ${sealsIntact},
             broken_seal_codes = ${brokenSealCodes}::text[]
       WHERE id = ${task.id}::uuid`;

    await this.prisma.$executeRaw`
      UPDATE logistics.shipment
         SET status = 'PICKED_UP'::public.shipment_status, dispatched_at = ${now}
       WHERE sub_order_id = ${task.sub_order_id}::uuid
         AND leg = 'OUTBOUND'::public.shipment_leg`;

    const units = await this.prisma.$queryRaw<Array<{ unit_id: string }>>`
      SELECT su.unit_id
        FROM logistics.shipment_unit su
        JOIN logistics.shipment s ON s.id = su.shipment_id
       WHERE s.sub_order_id = ${task.sub_order_id}::uuid`;
    for (const unit of units) {
      await this.prisma.$executeRaw`
        INSERT INTO logistics.custody_event
          (unit_id, from_party, to_party, actor_id, scan_type, occurred_at)
        VALUES (${unit.unit_id}::uuid, 'VENDOR', 'CARRIER', ${user.userId}::uuid, 'BARCODE', ${now})`;
    }

    if (!sealsIntact) await this.quarantine(task.sub_order_id, brokenSealCodes, now);

    return { status: 'COMPLETED', sealsIntact, brokenSealCodes };
  }

  @Get('delivery/:id')
  @RequirePermissions('logistics.delivery.execute')
  async delivery(
    @CurrentUser() user: Principal,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{
    id: string;
    status: string;
    attempts: number;
    address: { line1: string; city: string; pincode: string; contactMobile: string };
    boxes: number;
  }> {
    const riderId = await this.riderId(user.userId);
    const [task] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        status: string;
        attempts: number;
        to_address_id: string;
        boxes: number;
      }>
    >`
      SELECT d.id, d.status, d.attempts, s.to_address_id, s.boxes
        FROM logistics.delivery_task d
        JOIN logistics.shipment s ON s.id = d.shipment_id
       WHERE d.id = ${id}::uuid AND d.rider_id = ${riderId}::uuid`;
    if (!task) throw new NotFoundError('delivery_task', { id });

    const address = await this.address(task.to_address_id);

    return {
      id: task.id,
      status: task.status,
      attempts: task.attempts,
      // The delivery address and a number to call, which is what a doorstep
      // needs. The consignee's NAME is deliberately absent: the OTP proves who
      // answered the door, and a name on a rider's screen is a name that leaves
      // the platform with them.
      address: {
        line1: address.line1,
        city: address.city,
        pincode: address.pincode,
        contactMobile: address.contact_mobile,
      },
      boxes: task.boxes,
    };
  }

  @Post('delivery/:id/arrive')
  @RequirePermissions('logistics.delivery.execute')
  @HttpCode(200)
  async arriveAtDelivery(
    @CurrentUser() user: Principal,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ status: string }> {
    const riderId = await this.riderId(user.userId);
    await this.prisma.$executeRaw`
      UPDATE logistics.delivery_task SET status = 'OUT_FOR_DELIVERY'
       WHERE id = ${id}::uuid AND rider_id = ${riderId}::uuid`;
    return { status: 'OUT_FOR_DELIVERY' };
  }

  /**
   * Handed over. The OTP proves it and the photograph records it.
   *
   * `deliveredAt` is `now()` on this path — unlike a carrier webhook, the person
   * reporting it is standing at the door.
   */
  @Post('delivery/:id/complete')
  @RequirePermissions('logistics.delivery.execute')
  @HttpCode(200)
  async completeDelivery(
    @CurrentUser() user: Principal,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(completeDeliverySchema)) body: CompleteDeliveryDto,
  ): Promise<{ status: string; orderNumber: string | null }> {
    const riderId = await this.riderId(user.userId);
    const [task] = await this.prisma.$queryRaw<
      Array<{ id: string; shipment_id: string; otp_hash: string | null; status: string }>
    >`
      SELECT id, shipment_id, otp_hash, status FROM logistics.delivery_task
       WHERE id = ${id}::uuid AND rider_id = ${riderId}::uuid`;
    if (!task) throw new NotFoundError('delivery_task', { id });

    this.deliveries.assertOtp(task.otp_hash, body.otp, task.id);

    await this.prisma.$executeRaw`
      UPDATE logistics.delivery_task SET photo_keys = ${body.photoKeys}::text[]
       WHERE id = ${task.id}::uuid`;

    const result = await this.deliveries.markDelivered({
      shipmentId: task.shipment_id,
      deliveredAt: this.clock.now(),
      source: 'RIDER',
      podKey: body.photoKeys[0] ?? null,
      actorUserId: user.userId,
    });

    return { status: 'DELIVERED', orderNumber: result.orderNumber };
  }

  @Post('delivery/:id/fail')
  @RequirePermissions('logistics.delivery.execute')
  @HttpCode(200)
  async failDelivery(
    @CurrentUser() user: Principal,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(failDeliverySchema)) body: FailDeliveryDto,
  ): Promise<{ attemptNo: number }> {
    const riderId = await this.riderId(user.userId);
    const [task] = await this.prisma.$queryRaw<Array<{ shipment_id: string }>>`
      SELECT shipment_id FROM logistics.delivery_task
       WHERE id = ${id}::uuid AND rider_id = ${riderId}::uuid`;
    if (!task) throw new NotFoundError('delivery_task', { id });

    return this.deliveries.recordFailedAttempt({
      shipmentId: task.shipment_id,
      outcome: body.outcome,
      reason: body.reason,
      // In-house: we set our own rules, so every action is available. A third
      // party's list comes from its adapter.
      legalActions: ['REATTEMPT', 'DEFER', 'EDIT_ADDRESS', 'EDIT_PHONE', 'RTO'],
      occurredAt: this.clock.now(),
    });
  }

  /**
   * A broken seal stops the machines and the money.
   *
   * The consignment keeps moving — it is in the van — but nothing on it can be
   * sold or paid for until somebody looks at it, so the payable goes on hold in
   * the same breath as the blocker.
   */
  private async quarantine(
    subOrderId: string,
    brokenSealCodes: string[],
    now: Date,
  ): Promise<void> {
    const [sub] = await this.prisma.$queryRaw<
      Array<{ order_id: string; purchase_order_id: string | null }>
    >`
      SELECT order_id, purchase_order_id FROM ordering.sub_order WHERE id = ${subOrderId}::uuid`;

    if (sub?.purchase_order_id) {
      await this.prisma.$executeRaw`
        UPDATE procurement.vendor_payable
           SET status = 'ON_HOLD', hold_reason = ${`Seal broken at collection: ${brokenSealCodes.join(', ')}`}
         WHERE purchase_order_id = ${sub.purchase_order_id}::uuid`;
    }

    await this.prisma.$executeRaw`
      INSERT INTO ordering.ops_task
        (kind, severity, order_id, subject, detail, assigned_role, status, created_at)
      VALUES ('SEAL_BROKEN', 'BLOCKER', ${sub?.order_id ?? null}::uuid,
              ${`${brokenSealCodes.length} seal(s) were not intact at collection. The machines need re-inspection.`},
              ${JSON.stringify({ brokenSealCodes, subOrderId })}::jsonb,
              'QC_MANAGER', 'OPEN', ${now})`;

    await this.automation.note('R8', subOrderId, 'OK', { brokenSealCodes });
  }

  /** Addresses by id, in one statement, from the module that owns them. */
  private async citiesByAddress(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; city: string }>>`
      SELECT id, city FROM identity.org_address WHERE id = ANY(${unique}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.city]));
  }

  private async address(addressId: string): Promise<{
    line1: string;
    city: string;
    pincode: string;
    contact_name: string;
    contact_mobile: string;
  }> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        line1: string;
        city: string;
        pincode: string;
        contact_name: string;
        contact_mobile: string;
      }>
    >`
      SELECT line1, city, pincode, contact_name, contact_mobile
        FROM identity.org_address WHERE id = ${addressId}::uuid`;
    if (!row) throw new NotFoundError('org_address', { addressId });
    return row;
  }

  /** The rider row behind the signed-in user, and the scope of every route here. */
  private async riderId(userId: string): Promise<string> {
    const [rider] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM logistics.rider WHERE user_id = ${userId}::uuid AND is_active`;
    if (!rider) {
      throw new PreconditionFailedError('This account is not registered as a rider.', {
        reason: 'not_a_rider',
      });
    }
    return rider.id;
  }
}
