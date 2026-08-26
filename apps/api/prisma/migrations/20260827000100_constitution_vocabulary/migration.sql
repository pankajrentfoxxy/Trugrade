-- The field requirements I seeded used PRIVATE_LIMITED / PUBLIC_LIMITED / OPC / HUF.
-- The adopted `constitution_type` enum is:
--   PROPRIETORSHIP, PARTNERSHIP, LLP, PVT_LTD, LTD, TRUST, SOCIETY, OTHER
--
-- Left unfixed this is silent rather than loud: `applies_to_constitutions` is a
-- TEXT[] with no FK to the enum, so the wrong labels would simply never match —
-- a private limited company would never be asked for its CIN, and nothing would
-- have complained.
--
-- Aligning the data rather than widening the enum: the enum is what the rest of
-- the schema already validates against.

UPDATE kyc.onboarding_field_requirement
   SET required_for_constitutions = (
         SELECT array_agg(DISTINCT mapped)
         FROM unnest(required_for_constitutions) AS c,
         LATERAL (SELECT CASE c
                    WHEN 'PRIVATE_LIMITED' THEN 'PVT_LTD'
                    WHEN 'PUBLIC_LIMITED'  THEN 'LTD'
                    WHEN 'OPC'             THEN 'PVT_LTD'
                    WHEN 'HUF'             THEN 'OTHER'
                    ELSE c END AS mapped) m
       )
 WHERE required_for_constitutions IS NOT NULL;

UPDATE kyc.onboarding_field_requirement
   SET forbidden_for_constitutions = (
         SELECT array_agg(DISTINCT mapped)
         FROM unnest(forbidden_for_constitutions) AS c,
         LATERAL (SELECT CASE c
                    WHEN 'PRIVATE_LIMITED' THEN 'PVT_LTD'
                    WHEN 'PUBLIC_LIMITED'  THEN 'LTD'
                    WHEN 'OPC'             THEN 'PVT_LTD'
                    WHEN 'HUF'             THEN 'OTHER'
                    ELSE c END AS mapped) m
       )
 WHERE forbidden_for_constitutions IS NOT NULL;

-- An LLPIN is meaningless for anything but an LLP, and a CIN for anything but a
-- company. Being explicit about "never ask" matters as much as "must ask":
-- an optional field a person cannot possibly have is a field they will try to fill.
UPDATE kyc.onboarding_field_requirement
   SET forbidden_for_constitutions = ARRAY['PROPRIETORSHIP','PARTNERSHIP','LLP','TRUST','SOCIETY','OTHER']
 WHERE field_code = 'cin';

UPDATE kyc.onboarding_field_requirement
   SET forbidden_for_constitutions = ARRAY['PROPRIETORSHIP','PARTNERSHIP','PVT_LTD','LTD','TRUST','SOCIETY','OTHER']
 WHERE field_code = 'llpin';

UPDATE kyc.onboarding_field_requirement
   SET forbidden_for_constitutions = ARRAY['PROPRIETORSHIP']
 WHERE field_code = 'incorporation_date';

UPDATE kyc.onboarding_field_requirement
   SET forbidden_for_constitutions = ARRAY['PROPRIETORSHIP','PARTNERSHIP','LLP','TRUST','SOCIETY','OTHER']
 WHERE field_code = 'board_resolution';

/**
 * A guard against this exact class of mistake recurring.
 *
 * The arrays are TEXT[] rather than constitution_type[] because they are
 * optional and nullable, but that gives up the enum's protection. This trigger
 * gives it back: a value that is not a real constitution is rejected at write
 * time, loudly, instead of silently never matching.
 */
CREATE OR REPLACE FUNCTION kyc.assert_known_constitutions() RETURNS trigger AS $$
DECLARE
  v TEXT;
  valid TEXT[] := ARRAY(SELECT unnest(enum_range(NULL::constitution_type))::text);
BEGIN
  FOREACH v IN ARRAY COALESCE(NEW.required_for_constitutions, ARRAY[]::TEXT[]) LOOP
    IF NOT (v = ANY (valid)) THEN
      RAISE EXCEPTION 'Unknown constitution "%" in required_for_constitutions. Valid values: %', v, valid;
    END IF;
  END LOOP;
  FOREACH v IN ARRAY COALESCE(NEW.forbidden_for_constitutions, ARRAY[]::TEXT[]) LOOP
    IF NOT (v = ANY (valid)) THEN
      RAISE EXCEPTION 'Unknown constitution "%" in forbidden_for_constitutions. Valid values: %', v, valid;
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_known_constitutions ON kyc.onboarding_field_requirement;
CREATE TRIGGER trg_known_constitutions
  BEFORE INSERT OR UPDATE ON kyc.onboarding_field_requirement
  FOR EACH ROW EXECUTE FUNCTION kyc.assert_known_constitutions();

-- Same for the step definitions.
CREATE OR REPLACE FUNCTION kyc.assert_known_step_constitutions() RETURNS trigger AS $$
DECLARE
  v TEXT;
  valid TEXT[] := ARRAY(SELECT unnest(enum_range(NULL::constitution_type))::text);
BEGIN
  FOREACH v IN ARRAY COALESCE(NEW.applies_to_constitutions, ARRAY[]::TEXT[]) LOOP
    IF NOT (v = ANY (valid)) THEN
      RAISE EXCEPTION 'Unknown constitution "%" in applies_to_constitutions. Valid values: %', v, valid;
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_known_step_constitutions ON kyc.onboarding_step_definition;
CREATE TRIGGER trg_known_step_constitutions
  BEFORE INSERT OR UPDATE ON kyc.onboarding_step_definition
  FOR EACH ROW EXECUTE FUNCTION kyc.assert_known_step_constitutions();
