-- Buyer registration: statutory (GSTIN/PAN) before company profile.
UPDATE kyc.onboarding_step_definition
SET step_order = CASE step_code
  WHEN 'STATUTORY' THEN 2
  WHEN 'BUSINESS_PROFILE' THEN 3
  ELSE step_order
END
WHERE org_type = 'BUYER'
  AND step_code IN ('STATUTORY', 'BUSINESS_PROFILE');

UPDATE kyc.onboarding_progress p
SET step_order = d.step_order
FROM kyc.onboarding_step_definition d,
     identity.organization o
WHERE o.id = p.org_id
  AND d.org_type = o.org_type
  AND d.step_code = p.step_code
  AND o.org_type = 'BUYER'
  AND p.step_code IN ('STATUTORY', 'BUSINESS_PROFILE');
