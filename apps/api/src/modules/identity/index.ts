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
