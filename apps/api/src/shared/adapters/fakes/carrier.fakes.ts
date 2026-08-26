import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  CarrierPort,
  type CreateShipmentInput,
  type NdrAction,
  type ServiceabilityResult,
  type ShipmentResult,
  type TrackingEvent,
} from '../ports';
import { ConflictError, ProviderError } from '../../errors/domain-errors';

/**
 * Carrier fakes.
 *
 * These encode the *quirks*, not just the happy path, because the quirks are what
 * break a first integration: Delhivery's form-encoded body, its five rejected
 * characters, its case-sensitive warehouse name and its ₹500 wallet minimum;
 * Blue Dart's undocumented JWT TTL; Shiprocket's 429 with no published limit;
 * Porter's 1 req/min tracking budget.
 *
 * A fake that only does the happy path teaches the codebase nothing.
 */
abstract class BaseFakeCarrier extends CarrierPort {
  /** awb -> the events emitted so far, so tracking is replayable and orderable. */
  protected readonly shipments = new Map<
    string,
    { input: CreateShipmentInput; events: TrackingEvent[] }
  >();
  /** idempotencyKey -> awb. A retried timeout must not book a second shipment. */
  protected readonly idempotency = new Map<string, string>();

  protected awbFor(key: string): string {
    return `${this.code.slice(0, 2).toUpperCase()}${createHash('sha1').update(key).digest('hex').slice(0, 11).toUpperCase()}`;
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    const existing = this.idempotency.get(input.idempotencyKey);
    if (existing) {
      // The whole point: the second call returns the first result rather than a
      // second label and a second billed shipment.
      return { awb: existing, carrierShipmentId: existing, labelUrl: `memory://label/${existing}` };
    }

    this.validate(input);

    const awb = this.awbFor(input.idempotencyKey);
    this.idempotency.set(input.idempotencyKey, awb);
    this.shipments.set(awb, {
      input,
      events: [
        {
          milestone: 'MANIFESTED',
          rawStatusCode: 'X-UCI',
          rawStatusText: 'Manifested',
          occurredAt: '2026-08-26T04:00:00.000Z',
          location: input.shipFrom.city,
          eventFingerprint: `${awb}:X-UCI:2026-08-26T04:00:00.000Z`,
        },
      ],
    });
    return {
      awb,
      carrierShipmentId: awb,
      labelUrl: `memory://label/${awb}`,
      estimatedDeliveryDate: '2026-08-29',
    };
  }

  protected validate(_input: CreateShipmentInput): void {}

  async cancelShipment(awb: string, _reason: string): Promise<void> {
    if (!this.shipments.has(awb))
      throw new ProviderError(this.code, { awb, reason: 'unknown AWB' });
  }

  async track(awb: string): Promise<TrackingEvent[]> {
    const s = this.shipments.get(awb);
    if (!s) throw new ProviderError(this.code, { awb, reason: 'unknown AWB' });
    return s.events;
  }

  async checkServiceability(
    _from: string,
    to: string,
    _weightGrams: number,
  ): Promise<ServiceabilityResult> {
    // 79xxxx is the north-east; genuinely non-serviceable for several carriers.
    if (to.startsWith('79')) return { serviceable: false, isOda: false, services: [] };
    // ODA pincodes carry a surcharge that must reach the landed price.
    const isOda = to.startsWith('19') || to.startsWith('79') || to.endsWith('999');
    return {
      serviceable: true,
      isOda,
      estimatedDays: isOda ? 6 : 3,
      services: ['SURFACE', 'EXPRESS'],
    };
  }

  legalNdrActions(rawStatusCode: string): NdrAction[] {
    switch (rawStatusCode) {
      case 'EOD-74': // consignee unavailable
        return ['REATTEMPT', 'DEFER', 'EDIT_PHONE'];
      case 'EOD-15': // address incorrect
        return ['EDIT_ADDRESS', 'REATTEMPT'];
      case 'EOD-104': // refused
        return ['RTO'];
      case 'ST-108': // out for delivery
        return [];
      default:
        return ['REATTEMPT', 'RTO'];
    }
  }

  async submitNdrAction(
    awb: string,
    action: NdrAction,
    _detail?: Record<string, string>,
  ): Promise<{ requestId: string }> {
    const s = this.shipments.get(awb);
    if (!s) throw new ProviderError(this.code, { awb });
    const last = s.events[s.events.length - 1];
    const legal = this.legalNdrActions(last?.rawStatusCode ?? '');
    if (!legal.includes(action)) {
      // Rejected *before* the API call in the real adapter; here we make the
      // fake refuse it too, so the test proves the check exists.
      throw new ConflictError(
        `${action} is not a legal action for this shipment's current carrier status.`,
        { awb, action, rawStatusCode: last?.rawStatusCode, legal },
      );
    }
    return { requestId: `ndr_${awb}_${action}` };
  }

  /** Test helper: push a scan, including out of order and duplicated. */
  pushEvent(awb: string, event: TrackingEvent): void {
    const s = this.shipments.get(awb);
    if (s) s.events.push(event);
  }
}

@Injectable()
export class FakeDelhivery extends BaseFakeCarrier {
  readonly code = 'DELHIVERY';
  /** Prepaid accounts need ≥ ₹500 to manifest. A silent production failure mode. */
  walletBalanceInr = 5000;
  /** Must match the registered warehouse name exactly, case-sensitive. */
  registeredWarehouses = new Set<string>(['Trugrade Gurugram Hub']);

  protected override validate(input: CreateShipmentInput): void {
    if (this.walletBalanceInr < 500) {
      throw new ProviderError('DELHIVERY', {
        reason: 'WALLET_BELOW_MINIMUM',
        balance: this.walletBalanceInr,
        // A business failure, not a transient one: retrying does not add money.
        retryable: false,
      });
    }

    if (!this.registeredWarehouses.has(input.shipFrom.name)) {
      throw new ProviderError('DELHIVERY', {
        reason: 'ClientWarehouse matching query does not exist',
        given: input.shipFrom.name,
        hint: 'pickup_location must match the registered warehouse name exactly, including case',
        retryable: false,
      });
    }

    // Five characters are rejected outright by the API.
    const forbidden = /[&\\%#;]/;
    for (const [field, value] of Object.entries({
      consigneeName: input.consignee.name,
      line1: input.consignee.line1,
      line2: input.consignee.line2 ?? '',
      description: input.packages[0]?.description ?? '',
    })) {
      if (forbidden.test(value)) {
        throw new ProviderError('DELHIVERY', {
          reason: 'FORBIDDEN_CHARACTER',
          field,
          hint: 'Delhivery rejects & \\ % # ; outright — strip or encode them before sending',
          retryable: false,
        });
      }
    }

    if (!input.sellerGstin) {
      throw new ProviderError('DELHIVERY', {
        reason: 'seller_gst_tin is mandatory',
        retryable: false,
      });
    }
    if (!input.packages[0]?.hsnCode) {
      throw new ProviderError('DELHIVERY', { reason: 'hsn_code is mandatory', retryable: false });
    }
  }
}

@Injectable()
export class FakeBlueDart extends BaseFakeCarrier {
  readonly code = 'BLUEDART';
  /** TTL is undocumented, so the real adapter refreshes on 401, never on a timer. */
  private token: { value: string; expiresAt: number } | null = null;
  private refreshCount = 0;
  forceNext401 = false;

  async ensureToken(nowMs: number): Promise<string> {
    if (this.forceNext401) {
      this.forceNext401 = false;
      this.token = null;
    }
    if (!this.token || this.token.expiresAt <= nowMs) {
      this.refreshCount++;
      this.token = { value: `jwt_${this.refreshCount}`, expiresAt: nowMs + 3_600_000 };
    }
    return this.token.value;
  }

  get refreshes(): number {
    return this.refreshCount;
  }

  /** Blue Dart publishes no rate-quote API — quotes come from our own contract card. */
  async quote(): Promise<never> {
    throw new ProviderError('BLUEDART', {
      reason: 'NO_RATE_API',
      hint: 'Blue Dart publishes no rate-quote API. Quote from carrier_rate_card.',
      retryable: false,
    });
  }
}

@Injectable()
export class FakeShiprocket extends BaseFakeCarrier {
  readonly code = 'SHIPROCKET';
  /** Bearer token expires at 240 h. Refresh before, not after. */
  tokenIssuedAtMs = 0;
  private callsInWindow = 0;
  throttleAfter = 40;

  protected override validate(_input: CreateShipmentInput): void {
    this.callsInWindow++;
    if (this.callsInWindow > this.throttleAfter) {
      throw new ProviderError('SHIPROCKET', {
        reason: 'RATE_LIMITED',
        httpStatus: 429,
        retryAfterSeconds: 30,
        hint: 'Shiprocket returns 429 with an unpublished limit',
        retryable: true,
      });
    }
  }

  resetWindow(): void {
    this.callsInWindow = 0;
  }

  tokenExpired(nowMs: number): boolean {
    return nowMs - this.tokenIssuedAtMs > 240 * 3_600_000;
  }
}

@Injectable()
export class FakeDtdc extends BaseFakeCarrier {
  readonly code = 'DTDC';
}

@Injectable()
export class FakePorter extends BaseFakeCarrier {
  readonly code = 'PORTER';
  private lastTrackMs = -Infinity;

  /** Intra-city, 2-wheeler, prepaid, single pickup and single drop. Nothing else. */
  protected override validate(input: CreateShipmentInput): void {
    if (input.packages.length > 1) {
      throw new ProviderError('PORTER', {
        reason: 'SINGLE_PACKAGE_ONLY',
        hint: 'Porter is single pickup and single drop, 2-wheeler only. Architecturally unsuited to B2B freight.',
        retryable: false,
      });
    }
    if (input.shipFrom.city.toLowerCase() !== input.consignee.city.toLowerCase()) {
      throw new ProviderError('PORTER', { reason: 'INTRA_CITY_ONLY', retryable: false });
    }
    const grams = input.packages.reduce((a, p) => a + p.weightGrams, 0);
    if (grams > 20_000)
      throw new ProviderError('PORTER', { reason: 'WEIGHT_EXCEEDS_2W', retryable: false });
  }

  /** Tracking is capped at 1 request per minute. */
  override async track(awb: string): Promise<TrackingEvent[]> {
    const now = Date.parse('2026-08-26T00:00:00Z') + this.lastTrackMs;
    if (this.lastTrackMs !== -Infinity && now - this.lastTrackMs < 60_000) {
      throw new ProviderError('PORTER', {
        reason: 'TRACKING_BUDGET',
        retryAfterSeconds: 60,
        retryable: true,
      });
    }
    this.lastTrackMs = now;
    return super.track(awb);
  }
}

@Injectable()
export class FakeInHouse extends BaseFakeCarrier {
  readonly code = 'INHOUSE';
  /** Our own riders — no third-party constraints, full control, NCR pilot rail. */
  override async checkServiceability(_from: string, to: string): Promise<ServiceabilityResult> {
    const ncr = /^(11|12[012]|20[13]|24[15])/.test(to);
    return {
      serviceable: ncr,
      isOda: false,
      estimatedDays: ncr ? 1 : undefined,
      services: ncr ? ['SAME_DAY', 'NEXT_DAY'] : [],
    };
  }
}
