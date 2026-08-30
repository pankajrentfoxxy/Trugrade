import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { AccountController } from './account.controller';
import { OpsController } from './ops.controller';
import { AccountService } from './internal/account.service';
import { PasswordService } from './internal/password.service';
import { OtpService } from './internal/otp.service';
import { AuditService } from './internal/audit.service';
import { ContactChangeService } from './internal/contact-change.service';
import { OrgPromotionService } from './internal/promotion.service';

@Module({
  // `/api/auth/*`. Everything it needs beyond this module's own providers —
  // `TokenService`, `AppConfig`, `RequestContextService` — comes from the global
  // shared modules, so there is nothing to import here.
  // `OpsController` is here rather than in a module of its own: the ops
  // dashboard is an aggregate over seven schemas that no domain owns, and this
  // module already holds the platform's own tables. See its own header.
  controllers: [IdentityController, AccountController, OpsController],
  providers: [
    IdentityService,
    PasswordService,
    OtpService,
    AuditService,
    ContactChangeService,
    OrgPromotionService,
    AccountService,
  ],
  // AuditService and OtpService are exported because `kyc` legitimately needs
  // both — an onboarding step that cannot audit its own decisions is not a
  // reviewable process, and step 1 is an OTP flow. Nothing else leaves.
  exports: [IdentityService, AuditService, OtpService, PasswordService, OrgPromotionService],
})
export class IdentityModule {}
