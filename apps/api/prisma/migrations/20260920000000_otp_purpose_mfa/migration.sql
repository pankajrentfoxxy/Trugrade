-- The second factor gets its own OTP purpose.
--
-- MFA codes were issued as LOGIN, the same purpose the public sign-in-code
-- routes issue and verify for any typed address. Issuing supersedes every live
-- code for the same target and purpose, and the resend and verify budgets are
-- keyed on the purpose, so one unauthenticated request with a supplier owner's
-- email burned their live second-factor code and spent its budgets.
--
-- The purpose column is TEXT with a CHECK, not an enum, so widening it is a
-- constraint swap. Existing LOGIN rows are left as they are: an in-flight MFA
-- code issued under LOGIN simply expires within five minutes.

ALTER TABLE identity.otp_request DROP CONSTRAINT IF EXISTS otp_request_purpose_check;
ALTER TABLE identity.otp_request ADD CONSTRAINT otp_request_purpose_check
  CHECK (purpose = ANY (ARRAY[
    'REGISTRATION','LOGIN','REGISTER','CONTACT_CHANGE_OLD','CONTACT_CHANGE_NEW',
    'CONTACT_CHANGE','BANK_CHANGE','PAYOUT_CHANGE','QC_VISIT_SIGNOFF',
    'PICKUP','DELIVERY','TICKET_CLOSE','PASSWORD_RESET','MFA'
  ]));
