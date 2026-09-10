-- Board resolution is no longer collected on vendor documents.
DELETE FROM kyc.onboarding_field_requirement
WHERE org_type = 'VENDOR'
  AND step_code = 'DOCUMENTS_BANK'
  AND field_code = 'board_resolution';
