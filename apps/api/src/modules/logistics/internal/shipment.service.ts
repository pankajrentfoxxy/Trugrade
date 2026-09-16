import { Injectable, Logger, Inject } from '@nestjs/common';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Money } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { CARRIER_REGISTRY, type CarrierRegistry } from '../../../shared/adapters/adapters.module';
import { NotFoundError } from '../../../shared/errors/domain-errors';
import { RoutingService, NoCarrierError } from './routing.service';

/**
 * Booking a consignment: the carrier, the AWB, the pickup and the delivery.
 *
 * Fifteen tables in the `logistics` schema had no writer at all — not one
 * `INSERT` anywhere in `apps/api/src`. This is where they start being used, and
 * the shape of the work is fixed by two facts about the model:
 *
 * **One shipment per consignment, not per order.** An order that draws from two
 * supply points is two pickups, two AWBs, two ETAs and two delivery events. The
 * sub-order is the consignment (one per supply point since the stage 1 split),
 * so `book(subOrderId)` is the whole interface and multi-leg needs no special
 * case anywhere.
 *
 * **Booked at DISPATCH_READY, not at acknowledgement.** An acknowledgement is a
 * promise; packing is a fact. `purchase_order_line.unit_id` is filled when the
 * vendor scans serials into sealed boxes, and `dispatchPo` already refuses while
 * any accepted line is missing one. Booking a carrier before that sends a rider
 * to collect machines nobody has taken off a shelf.
 */

export interface BookingResult {
  shipmentId: string;
  awb: string | null;
  carrierCode: string;
  quotedFreight: Money;
  pickupTaskId: string;
  deliveryTaskId: string;
  /** True when this call found a shipment that already existed. */
  alreadyBooked: boolean;
  /** Set when the carrier refused or could not be reached. */
  bookingError: string | null;
}

/** A boxed laptop. The same figure `checkout.service.ts` quotes freight on. */
const BOXED_LAPTOP_GRAMS = 2500;

interface ConsignmentRow {
  sub_order_id: string;
  order_id: string;
  order_number: string;
  vendor_org_id: string;
  pickup_address_id: string | null;
  shipping_address_id: string;
  subtotal: string;
  po_id: string | null;
  po_number: string | null;
}

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly routing: RoutingService,
    @Inject(CARRIER_REGISTRY) private readonly carriers: CarrierRegistry,
  ) {}

  /**
   * Book the outbound leg for one consignment.
   *
   * **Idempotent on (sub_order_id, leg).** `uq_shipment_sub_leg` makes that a
   * database fact rather than a convention, because an AWB created twice is a
   * second real invoice from the carrier and a second rider at the vendor's gate.
   * A retry after a timeout returns the shipment that exists.
   *
   * **The carrier call happens outside any transaction.** Holding one open
   * across an external HTTP request is how a slow carrier turns into a pool
   * exhaustion incident. The rows are written first, the AWB is written after —
   * so a failed booking leaves a shipment at CREATED carrying the error, which
   * is a fact ops needs to see rather than an absence.
   */
  async book(subOrderId: string): Promise<BookingResult> {
    const existing = await this.existing(subOrderId);
    if (existing) return existing;

    const consignment = await this.consignment(subOrderId);
    const units = await this.unitsOf(subOrderId);
    const from = await this.address(consignment.pickup_address_id);
    const to = await this.address(consignment.shipping_address_id);

    const declaredValue = Money.parse(consignment.subtotal);
    let choice;
    try {
      choice = await this.routing.select({
        leg: 'OUTBOUND',
        fromPincode: from.pincode,
        toPincode: to.pincode,
        fromCity: from.city,
        toCity: to.city,
        units: Math.max(units.length, 1),
        weightGrams: BOXED_LAPTOP_GRAMS,
        declaredValue,
        // Every machine on this consignment carries an intact seal or it would
        // not have been packed — `SealingService` is the only thing that seals,
        // and a broken seal takes the unit out of the listing entirely. A
        // consignment that somehow carries one is routed through the hub for
        // re-inspection by the highest-priority rule.
        sealsIntact: units.every((u) => u.seal_code !== null),
        multiVendorOrder: await this.isMultiSupplyPoint(consignment.order_id),
        vendorTier: await this.vendorTier(consignment.vendor_org_id),
      });
    } catch (err) {
      if (err instanceof NoCarrierError) {
        return this.recordUnbookable(consignment, err);
      }
      throw err;
    }

    const shipmentId = randomUUID();
    const now = this.clock.now();
    await this.prisma.$executeRaw`
      INSERT INTO logistics.shipment
        (id, leg, sub_order_id, carrier_id, from_address_id, to_address_id, mode,
         declared_value, weight_kg, boxes, status, route_type, routing_rule_id,
         quoted_freight, rate_card_id, eta_from, eta_to, detail, created_at)
      VALUES (${shipmentId}::uuid, 'OUTBOUND'::public.shipment_leg, ${subOrderId}::uuid,
              ${choice.carrierId}::uuid, ${from.id}::uuid, ${to.id}::uuid, 'SURFACE',
              ${declaredValue.toString()}::numeric,
              ${((BOXED_LAPTOP_GRAMS * Math.max(units.length, 1)) / 1000).toFixed(2)}::numeric,
              ${Math.max(units.length, 1)}, 'CREATED'::public.shipment_status,
              ${choice.routeType}::public.route_type, ${choice.routingRuleId}::uuid,
              ${choice.quotedFreight.toString()}::numeric, ${choice.rateCardId}::uuid,
              ${choice.etaFrom}, ${choice.etaTo},
              ${JSON.stringify({ chosen: choice.carrierCode, excluded: choice.excluded })}::jsonb,
              ${now})`;

    for (const unit of units) {
      await this.prisma.$executeRaw`
        INSERT INTO logistics.shipment_unit (shipment_id, unit_id, serial_number)
        VALUES (${shipmentId}::uuid, ${unit.unit_id}::uuid, ${unit.serial_number})
        ON CONFLICT DO NOTHING`;
    }

    const pickupOtp = this.otp();
    const deliveryOtp = this.otp();
    const pickupTaskId = randomUUID();
    const deliveryTaskId = randomUUID();

    await this.prisma.$executeRaw`
      INSERT INTO logistics.pickup_task
        (id, sub_order_id, vendor_org_id, address_id, expected_serials, expected_seals,
         otp_hash, status)
      VALUES (${pickupTaskId}::uuid, ${subOrderId}::uuid, ${consignment.vendor_org_id}::uuid,
              ${from.id}::uuid, ${units.map((u) => u.serial_number)}::text[],
              ${units.map((u) => u.seal_code).filter((c): c is string => !!c)}::text[],
              ${this.hashOtp(pickupOtp, pickupTaskId)}, 'PENDING')`;

    await this.prisma.$executeRaw`
      INSERT INTO logistics.delivery_task (id, shipment_id, otp_hash, status)
      VALUES (${deliveryTaskId}::uuid, ${shipmentId}::uuid,
              ${this.hashOtp(deliveryOtp, deliveryTaskId)}, 'PENDING')`;

    for (const unit of units) {
      await this.custody(unit.unit_id, 'VENDOR', 'VENDOR', 'MANUAL');
    }

    const booking = await this.callCarrier(shipmentId, choice, consignment, from, to, units.length);

    return {
      shipmentId,
      awb: booking.awb,
      carrierCode: choice.carrierCode,
      quotedFreight: choice.quotedFreight,
      pickupTaskId,
      deliveryTaskId,
      alreadyBooked: false,
      bookingError: booking.error,
    };
  }

  /**
   * Ask the carrier for an AWB.
   *
   * A failure here is not a rollback. The consignment is real, the vendor has
   * packed it, and an ops screen that shows nothing is worse than one that shows
   * a shipment stuck at CREATED with the carrier's own error on it.
   */
  private async callCarrier(
    shipmentId: string,
    choice: { carrierId: string; carrierCode: string; excluded: unknown },
    consignment: ConsignmentRow,
    from: AddressRow,
    to: AddressRow,
    units: number,
  ): Promise<{ awb: string | null; error: string | null }> {
    const adapter = this.carriers.get(choice.carrierCode);
    if (!adapter) {
      return this.failBooking(shipmentId, choice, `No adapter is bound for ${choice.carrierCode}`);
    }

    try {
      const result = await adapter.createShipment({
        referenceId: consignment.order_number,
        // Keyed on the consignment, so a retry after a timeout reaches the
        // carrier's own idempotency rather than minting a second label.
        idempotencyKey: `${consignment.sub_order_id}:OUTBOUND`,
        shipFrom: {
          name: 'Trugrade',
          line1: from.line1,
          city: from.city,
          stateCode: from.state_code,
          pincode: from.pincode,
          phone: from.contact_mobile,
        },
        consignee: {
          name: to.contact_name,
          line1: to.line1,
          city: to.city,
          stateCode: to.state_code,
          pincode: to.pincode,
          phone: to.contact_mobile,
        },
        packages: Array.from({ length: Math.max(units, 1) }, () => ({
          weightGrams: BOXED_LAPTOP_GRAMS,
          lengthCm: 40,
          widthCm: 30,
          heightCm: 8,
          declaredValue: Money.parse(consignment.subtotal),
          hsnCode: '84713010',
          description: 'Refurbished laptop',
        })),
        serviceCode: 'SURFACE',
        sellerGstin: '06AAJCT2846R1ZL',
      });

      await this.prisma.$executeRaw`
        UPDATE logistics.shipment
           SET awb_number = ${result.awb},
               label_key = ${result.labelUrl ?? null},
               status = 'SCHEDULED'::public.shipment_status
         WHERE id = ${shipmentId}::uuid`;
      await this.track(shipmentId, 'BOOKED', `Booked with ${choice.carrierCode}`);
      return { awb: result.awb, error: null };
    } catch (err) {
      return this.failBooking(shipmentId, choice, (err as Error).message);
    }
  }

  private async failBooking(
    shipmentId: string,
    choice: { carrierCode: string; excluded: unknown },
    message: string,
  ): Promise<{ awb: null; error: string }> {
    this.logger.error(`Shipment ${shipmentId} could not be booked: ${message}`);
    await this.prisma.$executeRaw`
      UPDATE logistics.shipment
         SET detail = detail || ${JSON.stringify({ bookingError: message })}::jsonb
       WHERE id = ${shipmentId}::uuid`;
    const [row] = await this.prisma.$queryRaw<Array<{ sub_order_id: string | null }>>`
      SELECT sub_order_id FROM logistics.shipment WHERE id = ${shipmentId}::uuid`;
    await this.raiseBookingTask(shipmentId, row?.sub_order_id ?? null, choice.carrierCode, message);
    return { awb: null, error: message };
  }

  /** A booking nobody can do is a blocker on somebody's desk, not a log line. */
  private async raiseBookingTask(
    shipmentId: string,
    subOrderId: string | null,
    carrierCode: string,
    message: string,
  ): Promise<void> {
    const order = subOrderId
      ? await this.prisma.$queryRaw<Array<{ order_id: string }>>`
          SELECT order_id FROM ordering.sub_order WHERE id = ${subOrderId}::uuid`
      : [];
    await this.prisma.$executeRaw`
      INSERT INTO ordering.ops_task
        (kind, severity, order_id, shipment_id, subject, detail, assigned_role, status, created_at)
      VALUES ('BOOKING_FAILED', 'BLOCKER', ${order[0]?.order_id ?? null}::uuid,
              ${shipmentId}::uuid,
              ${`This consignment could not be booked with ${carrierCode}. Book it by hand or change the routing.`},
              ${JSON.stringify({ carrierCode, error: message })}::jsonb,
              'OPS_MANAGER', 'OPEN', ${this.clock.now()})`;
  }

  /**
   * Nothing can carry it at all — no shipment row, because there is no carrier
   * to put on one, and `carrier_id` is NOT NULL for the good reason that a
   * shipment without a carrier is not a shipment.
   */
  private async recordUnbookable(
    consignment: ConsignmentRow,
    err: NoCarrierError,
  ): Promise<BookingResult> {
    await this.prisma.$executeRaw`
      INSERT INTO ordering.ops_task
        (kind, severity, order_id, subject, detail, assigned_role, status, created_at)
      VALUES ('BOOKING_FAILED', 'BLOCKER', ${consignment.order_id}::uuid,
              ${`No carrier serves this lane for ${consignment.order_number}. Quote it by hand.`},
              ${JSON.stringify({ excluded: err.excluded, message: err.message })}::jsonb,
              'OPS_MANAGER', 'OPEN', ${this.clock.now()})`;
    throw err;
  }

  /**
   * More than one consignment on the order.
   *
   * The seeded "Multi-vendor order consolidates at the hub" rule is about an
   * order arriving in pieces, which since the supply-point split is a question
   * about consignments rather than vendors: two warehouses of ONE vendor are two
   * pickups and two lanes, exactly like two vendors.
   */
  private async isMultiSupplyPoint(orderId: string): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM ordering.sub_order WHERE order_id = ${orderId}::uuid`;
    return Number(row?.n ?? 0) > 1;
  }

  private async vendorTier(vendorOrgId: string): Promise<string | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ tier: string | null }>>`
      SELECT tier::text AS tier FROM identity.organization WHERE id = ${vendorOrgId}::uuid`;
    return row?.tier ?? null;
  }

  /** The shipment this consignment already has, if any. */
  private async existing(subOrderId: string): Promise<BookingResult | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        awb_number: string | null;
        quoted_freight: string | null;
        code: string;
        detail: { bookingError?: string };
      }>
    >`
      SELECT s.id, s.awb_number, s.quoted_freight::text AS quoted_freight, c.code, s.detail
        FROM logistics.shipment s
        JOIN logistics.carrier c ON c.id = s.carrier_id
       WHERE s.sub_order_id = ${subOrderId}::uuid
         AND s.leg = 'OUTBOUND'::public.shipment_leg`;
    if (!row) return null;

    const [pickup] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM logistics.pickup_task WHERE sub_order_id = ${subOrderId}::uuid LIMIT 1`;
    const [delivery] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM logistics.delivery_task WHERE shipment_id = ${row.id}::uuid LIMIT 1`;

    return {
      shipmentId: row.id,
      awb: row.awb_number,
      carrierCode: row.code,
      quotedFreight: row.quoted_freight ? Money.parse(row.quoted_freight) : Money.ZERO,
      pickupTaskId: pickup?.id ?? '',
      deliveryTaskId: delivery?.id ?? '',
      alreadyBooked: true,
      bookingError: row.detail?.bookingError ?? null,
    };
  }

  private async consignment(subOrderId: string): Promise<ConsignmentRow> {
    const [row] = await this.prisma.$queryRaw<ConsignmentRow[]>`
      SELECT so.id AS sub_order_id, so.order_id, o.order_number, so.vendor_org_id,
             so.pickup_address_id, o.shipping_address_id, so.subtotal::text AS subtotal,
             so.purchase_order_id AS po_id, NULL::text AS po_number
        FROM ordering.sub_order so
        JOIN ordering."order" o ON o.id = so.order_id
       WHERE so.id = ${subOrderId}::uuid`;
    if (!row) throw new NotFoundError('sub_order', { subOrderId });
    if (!row.pickup_address_id) {
      throw new NotFoundError('pickup_address', {
        subOrderId,
        reason: 'This consignment has no supply point recorded, so nothing can collect it.',
      });
    }
    return row;
  }

  /**
   * The machines on this consignment, with the seal a rider has to find intact.
   *
   * Read from `purchase_order_line.unit_id`, which is what the vendor's packing
   * scan fills — so a consignment that is not packed has nothing to collect and
   * the manifest is empty rather than wrong.
   */
  private async unitsOf(
    subOrderId: string,
  ): Promise<Array<{ unit_id: string; serial_number: string; seal_code: string | null }>> {
    const [sub] = await this.prisma.$queryRaw<Array<{ purchase_order_id: string | null }>>`
      SELECT purchase_order_id FROM ordering.sub_order WHERE id = ${subOrderId}::uuid`;
    if (!sub?.purchase_order_id) return [];

    const lines = await this.prisma.$queryRaw<Array<{ unit_id: string | null }>>`
      SELECT unit_id FROM procurement.purchase_order_line
       WHERE po_id = ${sub.purchase_order_id}::uuid
         AND line_status = 'ACCEPTED'`;
    const unitIds = lines.map((l) => l.unit_id).filter((id): id is string => !!id);
    if (unitIds.length === 0) return [];

    // Two statements rather than one join: `no-cross-schema-join` reads a query
    // spanning `listing` and `qc` as a cross-module read, and it is right to.
    const units = await this.prisma.$queryRaw<
      Array<{ unit_id: string; serial_number: string; seal_id: string | null }>
    >`
      SELECT id AS unit_id, serial_number, seal_id
        FROM listing.unit
       WHERE id = ANY(${unitIds}::uuid[])
       ORDER BY serial_number`;

    const sealIds = units.map((u) => u.seal_id).filter((id): id is string => !!id);
    const seals = sealIds.length
      ? await this.prisma.$queryRaw<Array<{ id: string; seal_code: string }>>`
          SELECT id, seal_code FROM qc.qc_seal WHERE id = ANY(${sealIds}::uuid[])`
      : [];
    const codeById = new Map(seals.map((s) => [s.id, s.seal_code]));

    return units.map((u) => ({
      unit_id: u.unit_id,
      serial_number: u.serial_number,
      seal_code: u.seal_id ? (codeById.get(u.seal_id) ?? null) : null,
    }));
  }

  private async address(addressId: string | null): Promise<AddressRow> {
    const [row] = await this.prisma.$queryRaw<AddressRow[]>`
      SELECT id, line1, city, state_code, pincode, contact_name, contact_mobile
        FROM identity.org_address WHERE id = ${addressId}::uuid`;
    if (!row) throw new NotFoundError('org_address', { addressId });
    return row;
  }

  /** One row per scan, append-only by trigger. This is the chain of custody. */
  private async custody(
    unitId: string,
    fromParty: string,
    toParty: string,
    scanType: 'BARCODE' | 'MANUAL' | 'OTP',
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO logistics.custody_event (unit_id, from_party, to_party, scan_type, occurred_at)
      VALUES (${unitId}::uuid, ${fromParty}, ${toParty}, ${scanType}, ${this.clock.now()})`;
  }

  async track(shipmentId: string, statusCode: string, description: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO logistics.shipment_tracking
        (shipment_id, status_code, description, occurred_at)
      VALUES (${shipmentId}::uuid, ${statusCode}, ${description}, ${this.clock.now()})`;
  }

  /**
   * Six digits, and only its hash is stored.
   *
   * Salted with the task id the same way `OtpService` salts with the target, so
   * two tasks issued the same code do not share a hash and the table cannot be
   * turned into a rainbow lookup.
   */
  private otp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private hashOtp(code: string, saltId: string): string {
    return createHash('sha256').update(`${saltId}:${code}`).digest('hex');
  }
}

interface AddressRow {
  id: string;
  line1: string;
  city: string;
  state_code: string;
  pincode: string;
  contact_name: string;
  contact_mobile: string;
}
