import { Injectable, Logger } from '@nestjs/common';
import { stateCodeFromName } from '@trugrade/contracts';
import {
  PincodeLookupPort,
  type PincodeArea,
  type PincodeLookupResult,
} from '../ports';

interface RawPostOffice {
  Name?: string;
  Block?: string | null;
  District?: string | null;
  State?: string | null;
  Pincode?: string | null;
}

interface RawEnvelope {
  Status?: string;
  Message?: string;
  PostOffice?: RawPostOffice[];
}

/**
 * India Post reference data via https://api.postalpincode.in — no credentials.
 *
 * The register screens call our own route; this adapter is only the outbound hop.
 * A missing pincode is NOT_FOUND. A network or 5xx error is PROVIDER_ERROR and
 * the applicant may still type city and state manually.
 */
@Injectable()
export class PostalPincodeLookup extends PincodeLookupPort {
  private readonly logger = new Logger(PostalPincodeLookup.name);

  async lookup(pincode: string): Promise<PincodeLookupResult> {
    const started = Date.now();
    const url = `https://api.postalpincode.in/pincode/${encodeURIComponent(pincode)}`;

    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    } catch (err) {
      this.logger.error(`Pincode API network error: ${(err as Error).message}`);
      return {
        outcome: 'PROVIDER_ERROR',
        provider: 'postalpincode.in',
        latencyMs: Date.now() - started,
        message:
          "We couldn't reach the pincode directory just now. Enter city and state yourself, or try again in a moment.",
      };
    }

    const body = (await response.json().catch(() => [])) as RawEnvelope[];
    const latencyMs = Date.now() - started;

    if (response.status >= 500) {
      return {
        outcome: 'PROVIDER_ERROR',
        provider: 'postalpincode.in',
        latencyMs,
        message:
          "We couldn't reach the pincode directory just now. Enter city and state yourself, or try again in a moment.",
        raw: body,
      };
    }

    const envelope = Array.isArray(body) ? body[0] : undefined;
    const offices = envelope?.PostOffice ?? [];
    if (envelope?.Status !== 'Success' || offices.length === 0) {
      return {
        outcome: 'NOT_FOUND',
        provider: 'postalpincode.in',
        latencyMs,
        message: 'That pincode is not in the India Post directory. Check the six digits.',
        raw: body,
      };
    }

    const stateName = offices.map((o) => o.State?.trim()).find(Boolean) ?? '';
    const stateCode = stateCodeFromName(stateName);
    if (!stateCode) {
      return {
        outcome: 'NOT_FOUND',
        provider: 'postalpincode.in',
        latencyMs,
        message: `We found ${pincode} but do not recognise the state "${stateName}". Choose city and state manually.`,
        raw: body,
      };
    }

    const areas = dedupeAreas(offices);
    if (areas.length === 0) {
      return {
        outcome: 'NOT_FOUND',
        provider: 'postalpincode.in',
        latencyMs,
        message: 'That pincode returned no areas we could list. Choose city and state manually.',
        raw: body,
      };
    }

    return {
      outcome: 'SUCCESS',
      provider: 'postalpincode.in',
      latencyMs,
      data: {
        pincode,
        stateCode,
        stateName,
        areas,
      },
      raw: body,
    };
  }
}

/** Prefer the post-office name — what India Post lists for this pincode. */
export function areaLabel(office: RawPostOffice): string | null {
  const name = office.Name?.trim();
  if (name) return name;
  const block = office.Block?.trim();
  if (block && block.toUpperCase() !== 'NA') return block;
  const district = office.District?.trim();
  return district && district.length > 0 ? district : null;
}

export function dedupeAreas(offices: RawPostOffice[]): PincodeArea[] {
  const seen = new Set<string>();
  const areas: PincodeArea[] = [];
  for (const office of offices) {
    const label = areaLabel(office);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    areas.push({ value: label, label });
  }
  return areas.sort((a, b) => a.label.localeCompare(b.label));
}
