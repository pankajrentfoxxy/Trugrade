import { Injectable } from '@nestjs/common';
import { OTP_POLICY } from '@trugrade/contracts';
import { AppConfig } from '../../../shared/config';
import { PrismaService } from '../../../shared/db/prisma.service';
import { PreconditionFailedError, ValidationError } from '../../../shared/errors/domain-errors';
import { maskValue, OtpService } from '../../identity';
import { VerificationService, type BankAccountChangeResult } from './verification.service';

/** Free-form per `NotificationPort`, like the identity templates. */
const BANK_CHANGE_OTP_TEMPLATE = 'KYC_BANK_CHANGE_OTP';

export interface BankChangeCodeSent {
  sentTo: string;
  expiresAt: string;
  resendAvailableAt: string;
  /** Only while `OTP_DEV_CODE_IN_RESPONSE` is on. */
  devCode?: string;
}

/**
 * A payout-account change asks the person making it for a fresh code, whatever
 * their role.
 *
 * `MFA_REQUIRED_ROLES` puts the second factor on the seat, and VENDOR_ADMIN is
 * not in it — so an admin with a password-only session could redirect where the
 * money goes. The factor belongs on the operation: this is the one route every
 * caller of `POST /onboarding/bank-account` goes through, and it refuses to reach
 * `VerificationService.changeBankAccount` without a BANK_CHANGE code issued to,
 * and verified by, the same user.
 *
 * The code goes to the actor's own contact. The owner is still warned on every
 * channel they hold by `changeBankAccount` itself, which is the out-of-band half;
 * this is the "are you really the person holding this session" half.
 *
 * The code is spent before the penny-drop runs, so a change the bank then refuses
 * needs a new code. Checking afterwards would let a stolen session run penny-drops
 * against arbitrary accounts, which is its own oracle.
 */
@Injectable()
export class BankChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly verification: VerificationService,
    private readonly config: AppConfig,
  ) {}

  async requestCode(orgId: string, actorUserId: string): Promise<BankChangeCodeSent> {
    const target = await this.actorContact(orgId, actorUserId);
    const issued = await this.otp.issue({
      target: target.to,
      purpose: 'BANK_CHANGE',
      channel: target.channel,
      templateCode: BANK_CHANGE_OTP_TEMPLATE,
      refType: 'user_account',
      refId: actorUserId,
      exposeDevCode: this.config.exposeOtpDevCode,
    });
    return {
      sentTo: maskValue(target.to),
      expiresAt: issued.expiresAt.toISOString(),
      resendAvailableAt: issued.resendAvailableAt.toISOString(),
      ...(issued.devCode ? { devCode: issued.devCode } : {}),
    };
  }

  async changeWithCode(input: {
    orgId: string;
    actorUserId: string;
    otpCode: string;
    accountNumber: string;
    ifsc: string;
    accountHolderName: string;
    accountType?: 'CURRENT' | 'SAVINGS' | 'CC' | 'OD';
  }): Promise<BankAccountChangeResult> {
    const { otpCode, ...change } = input;
    const target = await this.actorContact(input.orgId, input.actorUserId);
    const redeemed = await this.otp.verify({
      target: target.to,
      purpose: 'BANK_CHANGE',
      code: otpCode,
    });

    // A code for the same address issued against someone else — a shared team
    // mailbox — is not this person's confirmation.
    if (redeemed.refId !== input.actorUserId) {
      throw new ValidationError(OTP_POLICY.wrongScopeMessage, {
        otpCode: OTP_POLICY.wrongScopeMessage,
      });
    }

    return this.verification.changeBankAccount(change);
  }

  private async actorContact(
    orgId: string,
    userId: string,
  ): Promise<{ to: string; channel: 'EMAIL' | 'WHATSAPP' }> {
    const user = await this.prisma.db.user_account.findFirst({
      where: { id: userId, org_id: orgId, status: 'ACTIVE' },
      select: { email: true, mobile: true },
    });
    if (user?.email) return { to: String(user.email).toLowerCase(), channel: 'EMAIL' };
    if (user?.mobile) return { to: user.mobile, channel: 'WHATSAPP' };
    throw new PreconditionFailedError(
      'We need an email address or mobile number on your account to confirm a payout account change. Add one to your profile, then try again.',
      { reason: 'bank_change_actor_unreachable' },
    );
  }
}
