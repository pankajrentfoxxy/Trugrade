-- v_current_config compared a TIMESTAMPTZ against CURRENT_DATE.
--
-- `platform_config.effective_from` is a timestamptz in the adopted schema (the
-- hardening migration's `ADD COLUMN ... DATE` was a no-op because the column
-- already existed). So a row written today at 07:08 was tested as
-- `2026-08-26 07:08+00 <= 2026-08-26 00:00+00` — false — and stayed invisible to
-- the application until the following midnight.
--
-- Nothing had read the view in anger yet, which is the only reason this was cheap
-- to find. A config key that silently does not exist for its first day is the kind
-- of bug that gets diagnosed as "the feature flag didn't work".
CREATE OR REPLACE VIEW platform.v_current_config AS
SELECT DISTINCT ON (key) key, value_json, effective_from, description
FROM platform.platform_config
WHERE effective_from <= now()
ORDER BY key, effective_from DESC;

COMMENT ON VIEW platform.v_current_config IS
  'The config the application reads. Effective-dated against now(), latest wins, future-dated rows are scheduled rather than current. Nothing reads platform_config directly.';
