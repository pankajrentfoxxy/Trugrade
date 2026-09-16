import type { PrismaClient } from '@prisma/client';

/**
 * The delegation-of-authority ladder.
 *
 * Seeded by `20260916050000_maker_checker/migration.sql` and repeated here for
 * the same reason `automation-rules.ts` exists: a suite that truncates the
 * identity schema takes the ladder with it, and nothing in a migration runs
 * twice. An empty `authority_band` is not "no limits" — `ApprovalService.decide`
 * reads no band and therefore enforces no required role, so the control quietly
 * weakens rather than failing. That is the wrong way round for a control.
 *
 * Kept identical to the migration's VALUES. If the ladder changes, it changes in
 * both places, and the acceptance test asserts the top band still needs two
 * signatures.
 */
export const AUTHORITY_BANDS: ReadonlyArray<{
  docType: string;
  min: number;
  max: number | null;
  role: string;
  second: boolean;
}> = [
  { docType: 'PAYOUT_RUN', min: 0, max: 500000, role: 'CONTROLLER', second: false },
  { docType: 'PAYOUT_RUN', min: 500000, max: null, role: 'CONTROLLER', second: true },
  { docType: 'CREDIT_NOTE', min: 0, max: 50000, role: 'CONTROLLER', second: false },
  { docType: 'CREDIT_NOTE', min: 50000, max: null, role: 'CONTROLLER', second: true },
  { docType: 'REFUND', min: 0, max: 50000, role: 'CONTROLLER', second: false },
  { docType: 'REFUND', min: 50000, max: null, role: 'CONTROLLER', second: true },
  { docType: 'WRITE_OFF', min: 0, max: 25000, role: 'CONTROLLER', second: false },
  { docType: 'WRITE_OFF', min: 25000, max: null, role: 'PLATFORM_SUPERADMIN', second: true },
  { docType: 'JOURNAL', min: 0, max: null, role: 'CONTROLLER', second: false },
  { docType: 'VENDOR_BANK', min: 0, max: null, role: 'CONTROLLER', second: false },
  { docType: 'PRICE_OVERRIDE', min: 0, max: null, role: 'CONTROLLER', second: false },
  { docType: 'KYC_APPLICATION', min: 0, max: null, role: 'OPS_MANAGER', second: false },
  { docType: 'PERIOD_CLOSE', min: 0, max: null, role: 'CONTROLLER', second: false },
  { docType: 'GST_RETURN', min: 0, max: null, role: 'CONTROLLER', second: false },
];

export async function seedAuthorityBands(db: PrismaClient): Promise<void> {
  for (const band of AUTHORITY_BANDS) {
    await db.$executeRaw`
      INSERT INTO identity.authority_band
        (doc_type, min_amount, max_amount, required_role, requires_second_checker)
      SELECT ${band.docType}, ${band.min}::numeric, ${band.max}::numeric, ${band.role}, ${band.second}
       WHERE NOT EXISTS (
         SELECT 1 FROM identity.authority_band
          WHERE doc_type = ${band.docType} AND min_amount = ${band.min}::numeric
            AND effective_to IS NULL)`;
  }
}
