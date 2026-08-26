import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { VendorModule } from '../vendor';
import { KycService } from './kyc.service';
import { OnboardingService } from './internal/onboarding.service';
import { VerificationService } from './internal/verification.service';
import { ConsentService } from './internal/consent.service';
import { DocumentService } from './internal/document.service';
import {
  KycReviewController,
  OnboardingController,
  OnboardingLeadController,
} from './kyc.controller';

@Module({
  // `VendorModule` because the review payload carries the four Change 4
  // captures, and those live in `vendor.*` tables. Through the barrel, never
  // into the schema: the vendor module owns what "not captured" means.
  imports: [IdentityModule, VendorModule],
  // Three controllers because they have three different answers to "who may
  // call this": platform reviewers, the applicant acting on their own org, and
  // an anonymous visitor who does not have an org yet. See kyc.controller.ts.
  controllers: [KycReviewController, OnboardingController, OnboardingLeadController],
  providers: [
    KycService,
    OnboardingService,
    VerificationService,
    ConsentService,
    // OnboardingController injects this directly. It was written, wired into the
    // controller and left out of this array, so the app typechecked, linted and
    // passed every unit test while failing to BOOT — Nest resolves the graph at
    // runtime and nothing before that point looks at it.
    DocumentService,
  ],
  exports: [KycService],
})
export class KycModule {}
