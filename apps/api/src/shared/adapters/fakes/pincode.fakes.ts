import { Injectable } from '@nestjs/common';
import {
  PincodeLookupPort,
  type PincodeLookupResult,
} from '../ports';

/**
 * Deterministic pincode lookup for tests and mock mode.
 *
 * `999999` — no record. `500010` — provider down. Everything else returns a
 * Delhi-shaped answer so registration address screens can be exercised without
 * calling India Post.
 */
@Injectable()
export class FakePincodeLookup extends PincodeLookupPort {
  async lookup(pincode: string): Promise<PincodeLookupResult> {
    const started = Date.now();
    const latencyMs = Date.now() - started + 40;

    if (pincode === '500010') {
      return {
        outcome: 'PROVIDER_ERROR',
        provider: 'fake-postalpincode',
        latencyMs,
        message:
          "We couldn't reach the pincode directory just now. Enter city and state yourself, or try again in a moment.",
      };
    }

    if (pincode === '999999') {
      return {
        outcome: 'NOT_FOUND',
        provider: 'fake-postalpincode',
        latencyMs,
        message: 'That pincode is not in the India Post directory. Check the six digits.',
      };
    }

    return {
      outcome: 'SUCCESS',
      provider: 'fake-postalpincode',
      latencyMs,
      data: {
        pincode,
        stateCode: pincode.startsWith('12') ? '06' : '07',
        stateName: pincode.startsWith('12') ? 'Haryana' : 'Delhi',
        areas: [
          { value: 'Delhi Cantt', label: 'Delhi Cantt' },
          { value: 'South West Delhi', label: 'South West Delhi' },
        ],
      },
    };
  }
}
