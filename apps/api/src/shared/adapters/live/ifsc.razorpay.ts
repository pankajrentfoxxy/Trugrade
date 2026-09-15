import { Injectable, Logger } from '@nestjs/common';
import type { VerificationResult } from '../ports';
import { FakeBankVerification } from '../fakes/kyc.fakes';

interface RawIfsc {
  BANK?: string;
  BRANCH?: string;
  CITY?: string;
  DISTRICT?: string;
}

/**
 * IFSC → bank and branch via Razorpay's public IFSC directory
 * (https://ifsc.razorpay.com, RBI data, no credentials).
 *
 * Only the lookup is live. Penny-drop needs a paid, contracted provider that is
 * not signed yet, so it is inherited from the fake until one is — which is why
 * this extends the fake rather than the port.
 */
@Injectable()
export class RazorpayIfscBankVerification extends FakeBankVerification {
  private readonly logger = new Logger(RazorpayIfscBankVerification.name);

  override async lookupIfsc(
    ifsc: string,
  ): Promise<VerificationResult<{ bank: string; branch: string; city: string }>> {
    const started = performance.now();
    const provider = 'ifsc.razorpay.com';

    let response: Response;
    try {
      response = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6_000),
      });
    } catch (err) {
      this.logger.error(`IFSC API network error: ${(err as Error).message}`);
      return {
        outcome: 'PROVIDER_ERROR',
        provider,
        latencyMs: Math.round(performance.now() - started),
        costPaise: 0,
        reason:
          "We couldn't reach the bank directory just now. That is our problem, not your IFSC — try again in a moment.",
      };
    }

    const latencyMs = Math.round(performance.now() - started);
    if (response.status === 404) {
      return {
        outcome: 'FAIL',
        provider,
        latencyMs,
        costPaise: 0,
        reason: `We could not find IFSC ${ifsc}. Check it against your cheque or passbook.`,
      };
    }

    const body = (await response.json().catch(() => null)) as RawIfsc | null;
    if (!response.ok || !body?.BANK) {
      return {
        outcome: 'PROVIDER_ERROR',
        provider,
        latencyMs,
        costPaise: 0,
        reason:
          "The bank directory didn't answer properly just now. That is our problem, not your IFSC — try again in a moment.",
        raw: body,
      };
    }

    return {
      outcome: 'PASS',
      provider,
      latencyMs,
      costPaise: 0,
      data: {
        bank: body.BANK,
        branch: body.BRANCH ?? '',
        city: body.CITY ?? body.DISTRICT ?? '',
      },
      raw: body,
    };
  }
}
