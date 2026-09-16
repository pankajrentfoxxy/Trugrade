import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';
import {
  CarrierPort,
  type CreateShipmentInput,
  type NdrAction,
  type ServiceabilityResult,
  type ShipmentResult,
  type TrackingEvent,
  type TrackingMilestone,
} from '../ports';

/**
 * Our own riders.
 *
 * Different in kind from a third-party adapter and worth saying why: there is no
 * remote system. `createShipment` mints an internal AWB and returns — nothing is
 * booked with anybody — and `track` reads `shipment_tracking`, which our own
 * rider app writes, rather than polling an API that does not exist.
 *
 * It is still a `CarrierPort` because the booking code must not care which of
 * the three paths a consignment takes. The moment in-house needs a special case
 * upstream, the abstraction has failed.
 */
@Injectable()
export class InHouseCarrier extends CarrierPort {
  readonly code = 'INHOUSE';

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** NCR only, which is the pilot rail. Same predicate the fake states. */
  async checkServiceability(_from: string, to: string): Promise<ServiceabilityResult> {
    const ncr = /^(11|12[012]|20[13]|24[15])/.test(to);
    return {
      serviceable: ncr,
      isOda: false,
      ...(ncr ? { estimatedDays: 1 } : {}),
      services: ncr ? ['SAME_DAY', 'NEXT_DAY'] : [],
    };
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    const awb = `TG-IH-${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    return {
      awb,
      carrierShipmentId: input.idempotencyKey,
      // No label to fetch: the rider's app shows the manifest, and a courier
      // label with a customer's name on it is a disclosure we do not need to
      // make to print a sticker.
      estimatedDeliveryDate: undefined,
    };
  }

  async cancelShipment(): Promise<void> {
    // Cancelling an in-house run is the ops screen unassigning the rider; there
    // is nobody to tell.
  }

  async track(awb: string): Promise<TrackingEvent[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ status_code: string; description: string | null; occurred_at: Date }>
    >`
      SELECT t.status_code, t.description, t.occurred_at
        FROM logistics.shipment_tracking t
        JOIN logistics.shipment s ON s.id = t.shipment_id
       WHERE s.awb_number = ${awb}
       ORDER BY t.occurred_at`;

    return rows.map((r) => ({
      milestone: MILESTONES[r.status_code] ?? 'IN_TRANSIT',
      rawStatusCode: r.status_code,
      rawStatusText: r.description ?? r.status_code,
      occurredAt: r.occurred_at.toISOString(),
      eventFingerprint: `${awb}:${r.status_code}:${r.occurred_at.toISOString()}`,
    }));
  }

  /** Our own rules, so every action is available to ops. */
  legalNdrActions(): NdrAction[] {
    return ['REATTEMPT', 'DEFER', 'EDIT_ADDRESS', 'EDIT_PHONE', 'RTO'];
  }

  async submitNdrAction(awb: string, action: NdrAction): Promise<{ requestId: string }> {
    return { requestId: `${awb}:${action}` };
  }
}

const MILESTONES: Readonly<Record<string, TrackingMilestone>> = {
  BOOKED: 'MANIFESTED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED_ATTEMPT',
  RTO: 'RTO_INITIATED',
};
