import { Injectable, Logger } from '@nestjs/common';
import { stateCodeFromGstin } from '@trugrade/contracts';
import { AppConfig } from '../../config';
import {
  GstinVerificationPort,
  type GstinTaxpayer,
  type VerificationResult,
} from '../ports';
import { nameSimilarity } from '../fakes/kyc.fakes';

/**
 * GSTIN look-up against Zoho Books `GET /api/v3/search/gstin`.
 *
 * Same provider the GoRefurbo buyer KYC flow already calls. The register
 * screens keep talking to `POST /onboarding/verify/gstin`; this adapter is
 * only the outbound hop. A missing legal name or an inactive registration is
 * the applicant's FAIL. A network or 5xx is PROVIDER_ERROR and does not
 * consume an attempt.
 */
@Injectable()
export class ZohoGstinVerification extends GstinVerificationPort {
  private readonly logger = new Logger(ZohoGstinVerification.name);

  constructor(private readonly config: AppConfig) {
    super();
  }

  async verify(
    gstin: string,
    expectedLegalName?: string,
  ): Promise<VerificationResult<GstinTaxpayer>> {
    const started = Date.now();
    const url = this.buildUrl(gstin);

    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', headers: this.buildHeaders() });
    } catch (err) {
      this.logger.error(`GST API network error: ${(err as Error).message}`);
      return {
        outcome: 'PROVIDER_ERROR',
        provider: 'zoho-books',
        latencyMs: Date.now() - started,
        costPaise: 0,
        reason:
          "We couldn't reach the GST portal. We'll retry automatically — nothing for you to do.",
      };
    }

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const latencyMs = Date.now() - started;

    if (response.status >= 500) {
      return {
        outcome: 'PROVIDER_ERROR',
        provider: 'zoho-books',
        latencyMs,
        costPaise: 0,
        reason:
          "We couldn't reach the GST portal. We'll retry automatically — nothing for you to do.",
        raw: body,
      };
    }

    const code = body.code;
    if (!response.ok || (typeof code === 'number' && code !== 0)) {
      return {
        outcome: 'FAIL',
        provider: 'zoho-books',
        latencyMs,
        costPaise: 0,
        reason: this.extractError(body, 'The GST portal has no record of this GSTIN. Check the number against your certificate.'),
        raw: body,
      };
    }

    const data = this.extractPayload(body);
    const legalName = this.pick(data, 'legal_name', 'legalName', 'lgnm', 'business_name', 'company_name');
    if (!legalName) {
      return {
        outcome: 'FAIL',
        provider: 'zoho-books',
        latencyMs,
        costPaise: 0,
        reason: this.extractError(body, 'GSTIN not found or invalid.'),
        raw: body,
      };
    }

    const statusRaw = this.pick(data, 'status', 'gstin_status', 'sts') || 'Active';
    const status = this.mapStatus(statusRaw);
    const registeredAddress = this.parseRegisteredAddress(data, gstin);
    const taxpayer: GstinTaxpayer = {
      gstin: this.pick(data, 'gstin', 'gst_no') || gstin,
      legalName,
      tradeName: this.pick(data, 'trade_name', 'tradeName', 'tradeNam', 'dba') || legalName,
      status,
      stateCode: stateCodeFromGstin(gstin) ?? gstin.slice(0, 2),
      registrationDate: this.normalisePortalDate(
        this.pick(
          data,
          'registered_date',
          'registration_date',
          'registrationDate',
          'rgdt',
        ),
      ),
      taxpayerType: this.pick(data, 'taxpayer_type', 'taxpayerType', 'dty') || undefined,
      principalAddress: this.formatAddress(data) || undefined,
      constitutionType: this.mapConstitutionType(data),
      vendorCategory: this.mapVendorCategory(data),
      registeredAddress,
    };

    if (status !== 'ACTIVE' && status !== 'PROVISIONAL') {
      return {
        outcome: 'FAIL',
        data: taxpayer,
        provider: 'zoho-books',
        latencyMs,
        costPaise: 0,
        reason: `This GSTIN is ${statusRaw} on the GST portal. We can only onboard an active registration.`,
        raw: body,
      };
    }

    const score = expectedLegalName ? nameSimilarity(expectedLegalName, taxpayer.legalName) : 1;
    if (expectedLegalName && score < 0.7) {
      return {
        outcome: 'MISMATCH',
        data: taxpayer,
        matchScore: score,
        provider: 'zoho-books',
        latencyMs,
        costPaise: 0,
        reason: `The GST portal shows this GSTIN registered to "${taxpayer.legalName}", which doesn't match the business name you entered.`,
        raw: body,
      };
    }

    return {
      outcome: 'PASS',
      data: taxpayer,
      matchScore: score,
      provider: 'zoho-books',
      latencyMs,
      costPaise: 0,
      raw: body,
    };
  }

  private buildUrl(gstin: string): string {
    const apiUrl = this.config.get('GST_VERIFY_API_URL');
    if (apiUrl.includes('{gstin}')) {
      return apiUrl.replace('{gstin}', encodeURIComponent(gstin));
    }
    const sep = apiUrl.includes('?') ? '&' : '?';
    const orgId = this.config.get('GST_VERIFY_ORGANIZATION_ID');
    let url = `${apiUrl}${sep}gstin=${encodeURIComponent(gstin)}`;
    if (orgId) url += `&organization_id=${encodeURIComponent(orgId)}`;
    return url;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Connection: 'keep-alive',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      'X-ZOHO-Include-Formatted': 'true',
    };
    const referer = this.config.get('GST_VERIFY_REFERER');
    const roleId = this.config.get('GST_VERIFY_ROLE_ID');
    const csrf = this.stripQuotes(this.config.get('GST_VERIFY_CSRF_TOKEN'));
    const cookie = this.stripQuotes(this.config.get('GST_VERIFY_COOKIE'));
    const zbSource = this.config.get('GST_VERIFY_ZB_SOURCE');
    const zbAssetVersion = this.config.get('GST_VERIFY_ZB_ASSET_VERSION');
    if (referer) headers.Referer = referer;
    if (roleId) headers['X-ROLE-ID'] = roleId;
    if (csrf) headers['X-ZCSRF-TOKEN'] = csrf;
    if (cookie) headers.Cookie = cookie;
    if (zbSource) headers['X-ZB-SOURCE'] = zbSource;
    if (zbAssetVersion) headers['X-ZB-Asset-Version'] = zbAssetVersion;
    return headers;
  }

  private extractPayload(body: Record<string, unknown>): Record<string, unknown> {
    for (const key of ['data', 'gstin', 'gstin_details', 'gstinDetails', 'result']) {
      const candidate = body[key];
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate as Record<string, unknown>;
      }
    }
    return body;
  }

  private parseRegisteredAddress(
    data: Record<string, unknown>,
    gstin: string,
  ): GstinTaxpayer['registeredAddress'] | undefined {
    const pob =
      (data.pradr as Record<string, unknown> | undefined) ||
      (data.principal_place_of_business as Record<string, unknown> | undefined) ||
      (data.principalPlaceOfBusiness as Record<string, unknown> | undefined);
    if (!pob || typeof pob !== 'object') return undefined;

    const addr =
      (pob.addr as Record<string, unknown> | undefined) ||
      (pob.address as Record<string, unknown> | undefined);
    if (!addr || typeof addr !== 'object') return undefined;

    const line1 = [
      this.pick(addr, 'flno'),
      this.pick(addr, 'bno'),
      this.pick(addr, 'bnm'),
    ]
      .filter(Boolean)
      .join(', ');
    const line2 = [this.pick(addr, 'st'), this.pick(addr, 'locality')]
      .filter(Boolean)
      .join(', ');
    const city = this.pick(addr, 'loc', 'dst', 'city');
    const pincode = this.pick(addr, 'pncd', 'pincode', 'pin');
    const state = stateCodeFromGstin(gstin) ?? '';

    if (!line1 && !city && !pincode) return undefined;
    return {
      line1: line1 || line2,
      line2: line1 ? line2 : '',
      city,
      state,
      pincode,
    };
  }

  private mapConstitutionType(data: Record<string, unknown>): string | undefined {
    const raw = this.pick(
      data,
      'constitution_of_business',
      'constitutionOfBusiness',
      'ctb',
    );
    if (!raw) return undefined;
    const n = raw.toLowerCase();
    if (n.includes('private limited')) return 'PVT_LTD';
    if (n.includes('public limited')) return 'LTD';
    if (n.includes('limited liability partnership') || n.includes('llp')) return 'LLP';
    if (n.includes('partnership')) return 'PARTNERSHIP';
    if (n.includes('proprietor')) return 'PROPRIETORSHIP';
    if (n.includes('trust')) return 'TRUST';
    if (n.includes('society')) return 'SOCIETY';
    return 'OTHER';
  }

  private mapVendorCategory(data: Record<string, unknown>): string | undefined {
    const natureRaw = data.nature_of_business ?? data.natureOfBusiness;
    const nature = Array.isArray(natureRaw) ? natureRaw.map(String) : [];
    const pradr = data.pradr as Record<string, unknown> | undefined;
    const ntr = typeof pradr?.ntr === 'string' ? pradr.ntr : '';
    const text = `${nature.join(' ')} ${ntr}`.toLowerCase();
    if (text.includes('itad') || text.includes('disposal')) return 'ITAD';
    if (text.includes('leasing')) return 'LEASING';
    if (text.includes('refurb')) return 'REFURBISHER';
    if (text.includes('warehouse') || text.includes('depot')) return 'TRADER';
    if (text.includes('recipient of goods')) return 'TRADER';
    if (text.includes('oem') || text.includes('brand')) return 'OEM_PARTNER';
    if (text.includes('retail')) return 'RETAILER';
    if (nature.length > 0 || ntr) return 'TRADER';
    return undefined;
  }

  private normalisePortalDate(value: string): string | undefined {
    if (!value) return undefined;
    const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    return value;
  }

  private formatAddress(data: Record<string, unknown>): string {
    const pob =
      (data.principal_place_of_business as Record<string, unknown>) ||
      (data.principalPlaceOfBusiness as Record<string, unknown>) ||
      (data.pradr as Record<string, unknown>) ||
      (data.address as Record<string, unknown>);
    if (!pob || typeof pob !== 'object') return '';
    const addr =
      (pob.addr as Record<string, unknown>) ||
      (pob.address as Record<string, unknown>) ||
      pob;
    return [
      this.pick(addr, 'address_line_1', 'addressLine1', 'bnm', 'bno', 'street'),
      this.pick(addr, 'address_line_2', 'addressLine2', 'st', 'landmark'),
      this.pick(addr, 'city', 'loc', 'dst'),
      this.pick(addr, 'state', 'stcd'),
      this.pick(addr, 'pincode', 'pin', 'zip'),
    ]
      .filter(Boolean)
      .join(', ');
  }

  private pick(obj: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  private extractError(body: Record<string, unknown>, fallback: string): string {
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
    return fallback;
  }

  private mapStatus(value: string): GstinTaxpayer['status'] {
    const n = value.trim().toLowerCase();
    if (n.includes('cancel')) return 'CANCELLED';
    if (n.includes('suspend')) return 'SUSPENDED';
    if (n.includes('provisional')) return 'PROVISIONAL';
    return 'ACTIVE';
  }

  private stripQuotes(value: string): string {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }
}
