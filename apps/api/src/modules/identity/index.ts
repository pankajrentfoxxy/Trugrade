/**
 * The PUBLIC barrel for `identity`.
 *
 * Adding to this file is an architectural decision: everything here becomes
 * something another module may depend on, and therefore something that cannot
 * change without coordinating. Repositories and internal DTOs never appear.
 */
export {
  type IIdentityService,
  IdentityService,
  type AuthenticatedUser,
  type OrganizationSummary,
  type OrgType,
} from './identity.service';
export { IdentityModule } from './identity.module';

// `kyc` records its review decisions and its verification attempts through these.
export { AuditService, type AuditEntry, maskValue, redact } from './internal/audit.service';
export { OtpService, type IssueOtpResult } from './internal/otp.service';
export { PasswordService, type PasswordCheckResult } from './internal/password.service';

// `kyc` runs the onboarding stepper; the tables three of its steps promote into
// — `organization`, `org_address`, `org_contact` — are this module's. It asks
// through here rather than writing them, which is the seam doing its job.
export {
  OrgPromotionService,
  type AddressPromotion,
  type ContactPromotion,
  type OrgProfilePatch,
} from './internal/promotion.service';
