import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { KycService } from './kyc.service';
import { OnboardingService } from './internal/onboarding.service';
import { VerificationService } from './internal/verification.service';
import { ConsentService } from './internal/consent.service';

@Module({
  imports: [IdentityModule],
  providers: [KycService, OnboardingService, VerificationService, ConsentService],
  exports: [KycService],
})
export class KycModule {}
