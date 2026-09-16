import { Injectable, Logger } from '@nestjs/common';
import { Money } from '@trugrade/contracts';
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
 * Blue Dart, over their WayBill and Tracking APIs.
 *
 * Three things this adapter does that the fake documents and a naive one gets
 * wrong:
 *
 * **The token is refreshed on a 401, never on a timer.** Blue Dart does not
 * document the JWT's TTL, so a timer is a guess that expires mid-consignment.
 * **Raw status codes survive.** Their NDR endpoint decides which actions are
 * legal from the raw code, so normalising to a milestone and discarding the code
 * breaks NDR handling downstream — `legalNdrActions` exists for that reason.
 * **Idempotency is the caller's key.** A timeout after they accepted must not
 * produce a second waybill, because a second waybill is a second real invoice.
 *
 * Credentials come from `logistics.carrier.config_json` and the environment,
 * never from constants here.
 */

interface BlueDartConfig {
  baseUrl: string;
  licenceKey: string;
  loginId: string;
  areaCode?: string;
}

@Injectable()
export class BlueDartCarrier extends CarrierPort {
  readonly code = 'BLUEDART';
  private readonly logger = new Logger(BlueDartCarrier.name);
  private token: string | null = null;

  constructor(private readonly config: BlueDartConfig) {
    super();
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    const body = {
      Request: {
        Consignee: {
          ConsigneeName: input.consignee.name,
          ConsigneeAddress1: input.consignee.line1,
          ConsigneeCity: input.consignee.city,
          ConsigneePincode: input.consignee.pincode,
          ConsigneeMobile: input.consignee.phone,
        },
        Shipper: {
          CustomerName: input.shipFrom.name,
          CustomerAddress1: input.shipFrom.line1,
          CustomerPincode: input.shipFrom.pincode,
          CustomerMobile: input.shipFrom.phone,
          OriginArea: this.config.areaCode ?? '',
        },
        Services: {
          ProductCode: 'D',
          SubProductCode: 'P',
          PieceCount: String(input.packages.length),
          ActualWeight: (input.packages.reduce((g, p) => g + p.weightGrams, 0) / 1000).toFixed(2),
          DeclaredValue: Money.sum(input.packages.map((p) => p.declaredValue)).toString(),
          CreditReferenceNo: input.referenceId,
        },
      },
      Profile: { LoginID: this.config.loginId, LicenceKey: this.config.licenceKey },
    };

    const response = await this.call<{
      GenerateWayBillResult?: { AWBNo?: string; DestinationArea?: string; Status?: unknown };
    }>('/waybill/GenerateWayBill', body, input.idempotencyKey);

    const awb = response.GenerateWayBillResult?.AWBNo;
    if (!awb) {
      throw new ProviderError('BLUEDART', {
        reason: 'NO_AWB',
        hint: 'Blue Dart accepted the request but returned no waybill number.',
        retryable: true,
      });
    }
    return { awb, carrierShipmentId: awb };
  }

  async cancelShipment(awb: string, reason: string): Promise<void> {
    await this.call('/waybill/CancelWaybill', {
      AWBNo: awb,
      Reason: reason,
      Profile: { LoginID: this.config.loginId, LicenceKey: this.config.licenceKey },
    });
  }

  async track(awb: string): Promise<TrackingEvent[]> {
    const response = await this.call<{
      ShipmentData?: { Shipment?: Array<{ Scans?: { ScanDetail?: RawScan[] } }> };
    }>(`/tracking/GetTrackingDetails?awb=${encodeURIComponent(awb)}`, undefined);

    const scans = response.ShipmentData?.Shipment?.[0]?.Scans?.ScanDetail ?? [];
    return scans.map((scan) => ({
      milestone: MILESTONES[scan.ScanCode] ?? 'IN_TRANSIT',
      rawStatusCode: scan.ScanCode,
      rawStatusText: scan.Scan ?? scan.ScanCode,
      occurredAt: new Date(`${scan.ScanDate}T${scan.ScanTime ?? '00:00'}:00+05:30`).toISOString(),
      ...(scan.ScannedLocation ? { location: scan.ScannedLocation } : {}),
      // Scans arrive out of order and duplicated; this is how they are deduped.
      eventFingerprint: `${awb}:${scan.ScanCode}:${scan.ScanDate}:${scan.ScanTime ?? ''}`,
    }));
  }

  async checkServiceability(
    _from: string,
    to: string,
    _weightGrams: number,
  ): Promise<ServiceabilityResult> {
    const response = await this.call<{
      GetServicesforPincodeResult?: { ServiceCenterCode?: string; IsODA?: boolean };
    }>(`/pincode/GetServicesforPincode?pincode=${encodeURIComponent(to)}`, undefined);

    const result = response.GetServicesforPincodeResult;
    return {
      serviceable: Boolean(result?.ServiceCenterCode),
      isOda: Boolean(result?.IsODA),
      services: result?.ServiceCenterCode ? ['SURFACE', 'AIR'] : [],
    };
  }

  /**
   * Which actions Blue Dart will accept for this raw code.
   *
   * Asking before acting is the point: firing a refused action burns hours of a
   * 36-hour NDR window, and the window is the only reason NDR is urgent.
   */
  legalNdrActions(rawStatusCode: string): NdrAction[] {
    switch (rawStatusCode) {
      case 'UD':
        return ['REATTEMPT', 'DEFER', 'EDIT_ADDRESS', 'EDIT_PHONE', 'RTO'];
      case 'CN':
        return ['RTO'];
      default:
        return [];
    }
  }

  async submitNdrAction(
    awb: string,
    action: NdrAction,
    detail: Record<string, string> = {},
  ): Promise<{ requestId: string }> {
    const response = await this.call<{ RequestID?: string }>('/ndr/SubmitAction', {
      AWBNo: awb,
      ActionCode: action,
      ...detail,
      Profile: { LoginID: this.config.loginId, LicenceKey: this.config.licenceKey },
    });
    return { requestId: response.RequestID ?? `${awb}:${action}` };
  }

  /** One HTTP path, so the 401-refresh rule cannot be forgotten at a call site. */
  private async call<T>(
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    retriedAfter401 = false,
  ): Promise<T> {
    const token = this.token ?? (await this.login());
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'content-type': 'application/json',
          JWTToken: token,
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ProviderError('BLUEDART', {
        reason: 'NETWORK',
        hint: (err as Error).message,
        retryable: true,
      });
    }

    if (response.status === 401 && !retriedAfter401) {
      this.token = null;
      return this.call<T>(path, body, idempotencyKey, true);
    }
    if (!response.ok) {
      throw new ProviderError('BLUEDART', {
        reason: `HTTP_${response.status}`,
        hint: await response.text().catch(() => ''),
        // 4xx is our request being wrong; retrying it changes nothing.
        retryable: response.status >= 500,
      });
    }
    return (await response.json()) as T;
  }

  private async login(): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        LoginID: this.config.loginId,
        LicenceKey: this.config.licenceKey,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new ProviderError('BLUEDART', {
        reason: 'AUTH_FAILED',
        hint: `Blue Dart refused the credentials (${response.status}).`,
        retryable: false,
      });
    }
    const body = (await response.json()) as { JWTToken?: string };
    if (!body.JWTToken) {
      throw new ProviderError('BLUEDART', {
        reason: 'AUTH_NO_TOKEN',
        hint: 'Blue Dart returned no token.',
        retryable: true,
      });
    }
    this.token = body.JWTToken;
    return body.JWTToken;
  }
}

interface RawScan {
  ScanCode: string;
  Scan?: string;
  ScanDate: string;
  ScanTime?: string;
  ScannedLocation?: string;
}

const MILESTONES: Readonly<Record<string, TrackingMilestone>> = {
  MF: 'MANIFESTED',
  PUD: 'PICKED_UP',
  IT: 'IN_TRANSIT',
  RD: 'REACHED_DESTINATION_HUB',
  OFD: 'OUT_FOR_DELIVERY',
  DL: 'DELIVERED',
  UD: 'FAILED_ATTEMPT',
  RT: 'RTO_INITIATED',
  RD2: 'RTO_DELIVERED',
};
