/**
 * The PUBLIC barrel for `kyc`.
 *
 * Only the service interface and the module. The onboarding engine, the
 * verification retry policy and the consent ledger are all internal: another
 * module wanting an onboarding decision asks for the decision, never for the
 * table it was derived from.
 */
export { type IKycService, KycService, type OnboardingSummary } from './kyc.service';
export { KycModule } from './kyc.module';
export { type ConsentPurpose, CONSENT_PURPOSES } from './internal/consent.service';
