import { Injectable } from '@nestjs/common';
import { ProviderError } from '../../errors/domain-errors';
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
 * Porter — intra-city, on-demand, two-wheeler or tempo.
 *
 * **It refuses work it cannot do, and the refusal is the feature.** Porter is a
 * same-city courier: a multi-package consignment does not fit on the vehicle and
 * an inter-city lane is not a service they sell. The fake refuses both, and this
 * adapter refuses them the same way, because a routing layer that catches the
 * refusal and falls through silently would put a Gurugram-to-Pune consignment on
 * a motorbike.
 *
 * The other difference from a parcel carrier: there is no NDR workflow. A trip
 * that cannot be completed is cancelled and re-booked, so `legalNdrActions`
 * returns nothing rather than pretending.
 */

interface PorterConfig {
  baseUrl: string;
  apiKey: string;
}

@Injectable()
export class PorterCarrier extends CarrierPort {
  readonly code = 'PORTER';

  constructor(private readonly config: PorterConfig) {
    super();
  }

  async checkServiceability(from: string, to: string): Promise<ServiceabilityResult> {
    // Same city, decided on the pincode prefix the way the fake does. Asking
    // Porter about a lane they do not serve costs a round trip to be told no.
    const sameCity = from.slice(0, 3) === to.slice(0, 3);
    return {
      serviceable: sameCity,
      isOda: false,
      ...(sameCity ? { estimatedDays: 1 } : {}),
      services: sameCity ? ['TWO_WHEELER', 'TEMPO'] : [],
    };
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    if (input.packages.length > 1) {
      throw new ProviderError('PORTER', {
        reason: 'MULTI_PACKAGE_UNSUPPORTED',
        hint: 'Porter carries one consignment per trip. Book a parcel carrier for multiple boxes.',
        retryable: false,
      });
    }
    if (input.shipFrom.pincode.slice(0, 3) !== input.consignee.pincode.slice(0, 3)) {
      throw new ProviderError('PORTER', {
        reason: 'INTER_CITY_UNSUPPORTED',
        hint: 'Porter is an intra-city service. This lane needs a parcel carrier.',
        retryable: false,
      });
    }

    const response = await this.call<{ order_id?: string; tracking_url?: string }>('/v1/orders', {
      request_id: input.idempotencyKey,
      pickup_details: {
        address: {
          street_address1: input.shipFrom.line1,
          city: input.shipFrom.city,
          pincode: input.shipFrom.pincode,
          contact_details: { name: input.shipFrom.name, phone_number: input.shipFrom.phone },
        },
      },
      drop_details: {
        address: {
          street_address1: input.consignee.line1,
          city: input.consignee.city,
          pincode: input.consignee.pincode,
          contact_details: { name: input.consignee.name, phone_number: input.consignee.phone },
        },
      },
    });

    if (!response.order_id) {
      throw new ProviderError('PORTER', {
        reason: 'NO_ORDER_ID',
        hint: 'Porter accepted the trip but returned no order id.',
        retryable: true,
      });
    }
    return {
      awb: response.order_id,
      carrierShipmentId: response.order_id,
      ...(response.tracking_url ? { labelUrl: response.tracking_url } : {}),
    };
  }

  async cancelShipment(awb: string, reason: string): Promise<void> {
    await this.call(`/v1/orders/${encodeURIComponent(awb)}/cancel`, { reason });
  }

  async track(awb: string): Promise<TrackingEvent[]> {
    const response = await this.call<{
      status?: string;
      events?: Array<{ status: string; timestamp: string; location?: string }>;
    }>(`/v1/orders/${encodeURIComponent(awb)}`, undefined);

    return (response.events ?? []).map((event) => ({
      milestone: MILESTONES[event.status] ?? 'IN_TRANSIT',
      rawStatusCode: event.status,
      rawStatusText: event.status,
      occurredAt: new Date(event.timestamp).toISOString(),
      ...(event.location ? { location: event.location } : {}),
      eventFingerprint: `${awb}:${event.status}:${event.timestamp}`,
    }));
  }

  /** No NDR workflow exists: a failed trip is cancelled and re-booked. */
  legalNdrActions(): NdrAction[] {
    return [];
  }

  async submitNdrAction(): Promise<{ requestId: string }> {
    throw new ProviderError('PORTER', {
      reason: 'NDR_UNSUPPORTED',
      hint: 'Porter has no NDR workflow. Cancel the trip and book another.',
      retryable: false,
    });
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', 'X-API-KEY': this.config.apiKey },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ProviderError('PORTER', {
        reason: 'NETWORK',
        hint: (err as Error).message,
        retryable: true,
      });
    }
    if (!response.ok) {
      throw new ProviderError('PORTER', {
        reason: `HTTP_${response.status}`,
        hint: await response.text().catch(() => ''),
        retryable: response.status >= 500,
      });
    }
    return (await response.json()) as T;
  }
}

const MILESTONES: Readonly<Record<string, TrackingMilestone>> = {
  accepted: 'MANIFESTED',
  live: 'IN_TRANSIT',
  ended: 'DELIVERED',
  cancelled: 'FAILED_ATTEMPT',
};
