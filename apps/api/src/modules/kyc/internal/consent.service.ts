import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { ValidationError } from '../../../shared/errors/domain-errors';

/**
 * Consent, under the DPDP Act 2023.
 *
 * Four properties, each of which is a compliance requirement rather than a
 * design preference:
 *
 *   1. **Itemised and purpose-specific.** Blanket consent is not valid consent,
 *      so there is no `grantAll`.
 *   2. **Rows are never deleted.** `withdrawn_at` is itself the compliance
 *      artifact, and the grant it withdraws is the evidence consent ever existed.
 *      Enforced by `REVOKE UPDATE, DELETE` — this service has no delete method
 *      because the database would refuse it anyway.
 *   3. **The notice version and language are recorded.** Consent given against a
 *      Hindi notice must be provable *as such*; "they agreed" is not a record of
 *      what they agreed to.
 *   4. **No pre-ticked boxes.** CP e-Comm r.4(9) requires explicit affirmative
 *      action, so `granted` has no default and every call states it.
 */

export const CONSENT_PURPOSES = [
  'KYC_VERIFICATION',
  'TRANSACTIONAL_COMMS',
  'MARKETING',
  'WHATSAPP_BUSINESS',
  'CREDIT_CHECK',
  'DATA_SHARING_LOGISTICS',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * Purposes without which the service cannot be provided at all. These are still
 * consented to explicitly — but declining them means declining the account, and
 * the UI must say so rather than letting someone opt out into a broken state.
 */
export const ESSENTIAL_PURPOSES: readonly ConsentPurpose[] = [
  'KYC_VERIFICATION',
  'TRANSACTIONAL_COMMS',
];

export interface ConsentState {
  purpose: ConsentPurpose;
  granted: boolean;
  essential: boolean;
  noticeVersion: string | null;
  noticeLanguage: string | null;
  grantedAt: Date | null;
  withdrawnAt: Date | null;
}

@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
  ) {}

  /**
   * Record an affirmative grant.
   *
   * `granted` is a required argument with no default, so a caller cannot
   * accidentally record consent nobody gave.
   */
  async grant(input: {
    orgId: string;
    userId?: string | null;
    purpose: ConsentPurpose;
    granted: boolean;
    noticeVersion: string;
    noticeLanguage: 'en' | 'hi';
    channel: 'WEB' | 'MOBILE' | 'API' | 'PAPER';
  }): Promise<void> {
    if (!CONSENT_PURPOSES.includes(input.purpose)) {
      throw new ValidationError(`Unknown consent purpose: ${input.purpose}`);
    }
    if (!input.granted && ESSENTIAL_PURPOSES.includes(input.purpose)) {
      throw new ValidationError(
        'We cannot verify your business or send you order updates without this. Declining it means we cannot open the account.',
        { [input.purpose]: 'This one is required to use the platform.' },
      );
    }

    const context = this.ctx.get();
    const now = this.clock.now();

    // Withdraw any live grant for this purpose first, so the partial unique index
    // holds and the history reads as a sequence rather than a set.
    await this.prisma.$executeRaw`
      UPDATE kyc.consent_record
         SET withdrawn_at = ${now}
       WHERE org_id = ${input.orgId}::uuid
         AND COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(${input.userId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         AND purpose = ${input.purpose}
         AND withdrawn_at IS NULL
         AND granted`;

    await this.prisma.db.consent_record.create({
      data: {
        org_id: input.orgId,
        user_id: input.userId ?? null,
        purpose: input.purpose,
        granted: input.granted,
        notice_version: input.noticeVersion,
        notice_language: input.noticeLanguage,
        channel: input.channel,
        ip: context?.ip ?? null,
        user_agent: context?.userAgent ?? null,
        granted_at: now,
      },
    });
  }

  /**
   * Withdraw. Writes a withdrawal timestamp; it does not delete anything.
   * An essential purpose cannot be withdrawn while the account is live — the
   * route for that is account closure, which is a data-subject request.
   */
  async withdraw(orgId: string, purpose: ConsentPurpose, userId?: string | null): Promise<void> {
    if (ESSENTIAL_PURPOSES.includes(purpose)) {
      throw new ValidationError(
        'This consent is required for the account to function. To withdraw it, close the account — we will keep only what the law requires us to keep.',
      );
    }

    await this.prisma.$executeRaw`
      UPDATE kyc.consent_record
         SET withdrawn_at = ${this.clock.now()}
       WHERE org_id = ${orgId}::uuid
         AND COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(${userId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         AND purpose = ${purpose}
         AND withdrawn_at IS NULL`;
  }

  /** The current state of every purpose, including the ones never answered. */
  async currentState(orgId: string, userId?: string | null): Promise<ConsentState[]> {
    const rows = await this.prisma.db.consent_record.findMany({
      where: {
        org_id: orgId,
        ...(userId === undefined ? {} : { user_id: userId }),
      },
      orderBy: { granted_at: 'desc' },
    });

    return CONSENT_PURPOSES.map((purpose) => {
      const latest = rows.find((r) => r.purpose === purpose);
      return {
        purpose,
        granted: Boolean(latest?.granted && !latest.withdrawn_at),
        essential: ESSENTIAL_PURPOSES.includes(purpose),
        noticeVersion: latest?.notice_version ?? null,
        noticeLanguage: latest?.notice_language ?? null,
        grantedAt: latest?.granted_at ?? null,
        withdrawnAt: latest?.withdrawn_at ?? null,
      };
    });
  }

  /**
   * May we send this?
   *
   * **Transactional messages ignore consent flags entirely** — an OTP, an order
   * confirmation and a delivery notification are not marketing, and withholding
   * them because someone unticked a marketing box would break the service they
   * did consent to. Only marketing and digests consult this.
   */
  async maySend(input: {
    orgId: string;
    userId?: string | null;
    purpose: ConsentPurpose;
    isTransactional: boolean;
  }): Promise<boolean> {
    if (input.isTransactional) return true;

    const row = await this.prisma.db.consent_record.findFirst({
      where: {
        org_id: input.orgId,
        ...(input.userId ? { user_id: input.userId } : {}),
        purpose: input.purpose,
        granted: true,
        withdrawn_at: null,
      },
    });
    return row !== null;
  }

  /** The full history for a data-subject access request. Nothing is hidden. */
  async history(orgId: string): Promise<
    Array<{
      purpose: string;
      granted: boolean;
      noticeVersion: string;
      noticeLanguage: string;
      channel: string;
      grantedAt: Date;
      withdrawnAt: Date | null;
    }>
  > {
    const rows = await this.prisma.db.consent_record.findMany({
      where: { org_id: orgId },
      orderBy: { granted_at: 'desc' },
    });
    return rows.map((r) => ({
      purpose: r.purpose,
      granted: r.granted,
      noticeVersion: r.notice_version,
      noticeLanguage: r.notice_language,
      channel: r.channel,
      grantedAt: r.granted_at,
      withdrawnAt: r.withdrawn_at,
    }));
  }
}
