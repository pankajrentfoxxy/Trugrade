import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { PasswordService } from './internal/password.service';
import { OtpService } from './internal/otp.service';
import { AuditService } from './internal/audit.service';

@Module({
  providers: [IdentityService, PasswordService, OtpService, AuditService],
  // AuditService and OtpService are exported because `kyc` legitimately needs
  // both — an onboarding step that cannot audit its own decisions is not a
  // reviewable process, and step 1 is an OTP flow. Nothing else leaves.
  exports: [IdentityService, AuditService, OtpService, PasswordService],
})
export class IdentityModule {}
