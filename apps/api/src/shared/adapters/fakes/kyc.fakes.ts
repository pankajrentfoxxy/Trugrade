import { Injectable } from '@nestjs/common';
import { Money, stateCodeFromGstin } from '@trugrade/contracts';
import {
  BankVerificationPort,
  GstinVerificationPort,
  PanVerificationPort,
  type BankAccountHolder,
  type GstinTaxpayer,
  type PanHolder,
  type VerificationResult,
} from '../ports';

/**
 * Deterministic fakes, per 04_TEST_PLAN.md §1.4.3.
 *
 * The triggers are encoded in the *input*, so a test asks for the outcome it
 * wants by choosing a GSTIN rather than by wiring a mock. That keeps the test
 * readable and keeps the fake honest — it cannot be told to lie about a value
 * a real provider would have rejected.
 */

/** Similarity for the penny-drop name match (VR-026). Token-set Dice coefficient. */
export function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(private|pvt|limited|ltd|llp|and|&|the|co|company)\b/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const A = new Set(norm(a));
  const B = new Set(norm(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

const ok = <T>(data: T, extra: Partial<VerificationResult<T>> = {}): VerificationResult<T> => ({
  outcome: 'PASS',
  data,
  provider: 'fake',
  latencyMs: 120,
  costPaise: 200,
  ...extra,
});

@Injectable()
export class FakeGstinVerification extends GstinVerificationPort {
  async verify(
    gstin: string,
    expectedLegalName?: string,
  ): Promise<VerificationResult<GstinTaxpayer>> {
    const suffix = gstin.slice(-2).toUpperCase();

    if (suffix === 'Z9') {
      return {
        outcome: 'PROVIDER_ERROR',
        provider: 'fake',
        latencyMs: 30_000,
        costPaise: 0,
        reason:
          "We couldn't reach the GST portal. We'll retry automatically — nothing for you to do.",
      };
    }
    if (suffix === 'Z8') {
      return {
        outcome: 'TIMEOUT',
        provider: 'fake',
        latencyMs: 30_000,
        costPaise: 0,
        reason: "The GST portal didn't respond. We'll retry automatically.",
      };
    }
    if (suffix === 'Z4') {
      return {
        outcome: 'FAIL',
        provider: 'fake',
        latencyMs: 140,
        costPaise: 200,
        reason:
          'The GST portal has no record of this GSTIN. Check the number against your certificate.',
      };
    }

    const taxpayer: GstinTaxpayer = {
      gstin,
      legalName:
        suffix === 'Z2'
          ? 'Entirely Different Traders LLP'
          : (expectedLegalName ?? 'Alpha Systems Private Limited'),
      tradeName: 'Alpha Systems',
      status: suffix === 'Z3' ? 'CANCELLED' : 'ACTIVE',
      stateCode: stateCodeFromGstin(gstin) ?? '06',
      registrationDate: '2019-07-01',
      taxpayerType: 'Regular',
      principalAddress: 'Plot 42, Udyog Vihar Phase IV, Gurugram, Haryana',
    };

    if (taxpayer.status === 'CANCELLED') {
      return {
        outcome: 'FAIL',
        data: taxpayer,
        provider: 'fake',
        latencyMs: 140,
        costPaise: 200,
        reason:
          'This GSTIN is cancelled on the GST portal. We can only onboard an active registration.',
      };
    }

    const score = expectedLegalName ? nameSimilarity(expectedLegalName, taxpayer.legalName) : 1;
    if (expectedLegalName && score < 0.7) {
      return {
        outcome: 'MISMATCH',
        data: taxpayer,
        matchScore: score,
        provider: 'fake',
        latencyMs: 140,
        costPaise: 200,
        reason: `The GST portal shows this GSTIN registered to "${taxpayer.legalName}", which doesn't match the business name you entered.`,
      };
    }

    return ok(taxpayer, { matchScore: score });
  }
}

@Injectable()
export class FakePanVerification extends PanVerificationPort {
  async verify(pan: string, expectedName?: string): Promise<VerificationResult<PanHolder>> {
    if (pan === 'AAAPZ9999Z') {
      return {
        outcome: 'PROVIDER_ERROR',
        provider: 'fake',
        latencyMs: 5_000,
        costPaise: 0,
        reason: "We couldn't reach the PAN service. We'll retry automatically.",
      };
    }
    if (pan === 'AAAPZ0000Z') {
      return {
        outcome: 'FAIL',
        provider: 'fake',
        latencyMs: 110,
        costPaise: 150,
        reason: 'This PAN is not valid. Check it against your PAN card.',
      };
    }

    const fourth = pan[3] ?? 'C';
    const holder: PanHolder = {
      pan,
      name: expectedName ?? 'ALPHA SYSTEMS PRIVATE LIMITED',
      status: 'VALID',
      holderType: fourth === 'P' ? 'INDIVIDUAL' : fourth === 'C' ? 'COMPANY' : 'OTHER',
    };
    const score = expectedName ? nameSimilarity(expectedName, holder.name) : 1;
    return ok(holder, { matchScore: score });
  }
}

@Injectable()
export class FakeBankVerification extends BankVerificationPort {
  async pennyDrop(
    accountNumber: string,
    ifsc: string,
    expectedName: string,
  ): Promise<VerificationResult<BankAccountHolder>> {
    const tail = accountNumber.slice(-4);

    if (tail === '0009') {
      return {
        outcome: 'PROVIDER_ERROR',
        provider: 'fake',
        latencyMs: 8_000,
        costPaise: 0,
        reason: "We couldn't reach the bank. We'll retry automatically.",
      };
    }
    if (tail === '0008') {
      return {
        outcome: 'FAIL',
        provider: 'fake',
        latencyMs: 900,
        costPaise: Number(Money.rupees(1).paise),
        reason: 'The bank reports this account as closed. Add a different payout account.',
      };
    }

    const beneficiaryName =
      tail === '0002'
        ? 'Unrelated Person'
        : tail === '0001'
          ? `${expectedName} Enterprises`
          : expectedName;

    const holder: BankAccountHolder = {
      accountNumber,
      ifsc,
      beneficiaryName,
      bankName: 'HDFC Bank',
      branch: 'Udyog Vihar, Gurugram',
      creditReference: `PD${tail}${Date.parse('2026-08-26T00:00:00Z')}`,
    };

    const score = nameSimilarity(expectedName, beneficiaryName);
    if (score < 0.7) {
      return {
        outcome: 'FAIL',
        data: holder,
        matchScore: score,
        provider: 'fake',
        latencyMs: 900,
        costPaise: 100,
        reason: `The bank holds this account in the name "${beneficiaryName}", which doesn't match your registered business name. Payouts can only go to an account in your own name.`,
      };
    }
    if (score < 0.9) {
      return {
        outcome: 'MISMATCH',
        data: holder,
        matchScore: score,
        provider: 'fake',
        latencyMs: 900,
        costPaise: 100,
        reason: `The bank holds this account as "${beneficiaryName}". That is close to your registered name but not identical, so we'll have someone check it.`,
      };
    }
    return ok(holder, { matchScore: score, costPaise: 100 });
  }

  async lookupIfsc(
    ifsc: string,
  ): Promise<VerificationResult<{ bank: string; branch: string; city: string }>> {
    if (ifsc.startsWith('ZZZZ')) {
      return {
        outcome: 'FAIL',
        provider: 'fake',
        latencyMs: 60,
        costPaise: 0,
        reason: "We don't recognise this bank code. Please check the IFSC.",
      };
    }
    return ok(
      { bank: 'HDFC Bank', branch: 'Udyog Vihar, Gurugram', city: 'Gurugram' },
      { costPaise: 0 },
    );
  }
}
