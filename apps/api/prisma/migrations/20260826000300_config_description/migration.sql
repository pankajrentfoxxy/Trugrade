-- Every tunable threshold should say why it exists.
--
-- PHASE_10 Task 1 asks for "every threshold in one place with its effective date,
-- an editor with type validation, and a change log". An ops person raising
-- qc.min_sample_for_headline from 10 to 25 needs to know it exists because of the
-- CCPA Misleading Advertisements Guidelines, not because someone liked the number.
ALTER TABLE platform.platform_config
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN platform.platform_config.description IS
  'Why this key exists and what changing it affects. Shown in the admin config editor.';
