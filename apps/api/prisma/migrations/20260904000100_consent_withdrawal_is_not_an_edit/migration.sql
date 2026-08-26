-- kyc.consent_record is evidence, but withdrawal is not an edit.
--
-- 20260904000100 put a blanket "no UPDATE, no DELETE" trigger on every table in
-- the append-only list, and consent_record is on that list. That immediately
-- broke the one thing the DPDP Act actually requires us to support:
--
--   ConsentService.withdraw() does
--     UPDATE kyc.consent_record SET withdrawn_at = now() WHERE ... AND withdrawn_at IS NULL
--
-- and the schema is built around exactly that transition — uq_consent_live is a
-- PARTIAL unique index `WHERE withdrawn_at IS NULL AND granted`, so "live" is
-- defined by the column being null and withdrawal is defined by stamping it.
-- The row is meant to move from live to withdrawn in place; it was never meant
-- to be immutable.
--
-- So the blanket rule was too coarse, not the withdrawal. But dropping the
-- protection entirely would be the wrong correction in the other direction: a
-- consent artefact that can be freely rewritten is not evidence of consent, and
-- silently re-stamping granted_at or flipping `granted` is precisely the abuse
-- an auditor would look for.
--
-- The rule that is actually true: nothing on this table may be deleted, nothing
-- may be edited, EXCEPT that withdrawn_at may go from NULL to a timestamp
-- exactly once. One-way, one column. That keeps every property the append-only
-- list wanted and permits the only mutation the law asks for.

-- ---------------------------------------------------------------------------
-- 1. The bespoke rule
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kyc.consent_record_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'kyc.consent_record cannot be deleted. Withdrawing consent stamps withdrawn_at; it never removes the record that consent was once given.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Withdrawal is one-way. Un-withdrawing would let a withdrawn consent be
  -- quietly restored to live, which is the same as forging a fresh grant.
  IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
    RAISE EXCEPTION
      'Consent % was already withdrawn at %. Re-granting is a new row, not an edit to the old one.',
      OLD.id, OLD.withdrawn_at
      USING ERRCODE = 'check_violation';
  END IF;

  -- Everything else about the artefact is fixed: who, what purpose, under which
  -- notice version, in which language, from which channel, when.
  IF ROW(NEW.org_id, NEW.user_id, NEW.purpose, NEW.granted, NEW.notice_version,
         NEW.notice_language, NEW.channel, NEW.ip, NEW.user_agent, NEW.granted_at)
     IS DISTINCT FROM
     ROW(OLD.org_id, OLD.user_id, OLD.purpose, OLD.granted, OLD.notice_version,
         OLD.notice_language, OLD.channel, OLD.ip, OLD.user_agent, OLD.granted_at)
  THEN
    RAISE EXCEPTION
      'kyc.consent_record is append-only apart from the withdrawal stamp. Only withdrawn_at may change (once, NULL to a timestamp); correct anything else by recording a new consent.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION kyc.consent_record_guard IS
  'Append-only apart from one one-way transition: withdrawn_at NULL -> timestamp. Replaces the blanket trg_append_only on this table, which forbade the DPDP withdrawal the service is required to perform.';

DROP TRIGGER IF EXISTS trg_append_only ON kyc.consent_record;
DROP TRIGGER IF EXISTS trg_consent_record_guard ON kyc.consent_record;
CREATE TRIGGER trg_consent_record_guard
  BEFORE UPDATE OR DELETE ON kyc.consent_record
  FOR EACH ROW EXECUTE FUNCTION kyc.consent_record_guard();

-- ---------------------------------------------------------------------------
-- 2. Teach the attacher to leave it alone
-- ---------------------------------------------------------------------------
-- Otherwise the next migration that calls attach_append_only_triggers() puts the
-- blanket trigger back and breaks withdrawal again. The exception is named here,
-- once, with its reason, rather than being remembered.
CREATE OR REPLACE FUNCTION ops.attach_append_only_triggers() RETURNS INT
LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  n INT := 0;
  -- Tables whose immutability is real but not blanket, and which therefore own
  -- a bespoke guard trigger instead. Keep the reason with the entry.
  v_bespoke TEXT[] := ARRAY[
    'kyc.consent_record'  -- withdrawn_at must be stampable once (DPDP withdrawal)
  ];
BEGIN
  FOR r IN
    SELECT m[1] AS sch, m[2] AS tbl
    FROM regexp_matches(
           pg_get_functiondef('ops.apply_append_only_grants(text)'::regprocedure),
           '\(''([a-z_]+)'',''([a-z_]+)''\)', 'g') AS m
  LOOP
    CONTINUE WHEN r.sch || '.' || r.tbl = ANY (v_bespoke);
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = r.sch AND table_name = r.tbl);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_append_only ON %I.%I', r.sch, r.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION ops.reject_mutation()',
      r.sch, r.tbl);
    n := n + 1;
  END LOOP;
  RETURN n;
END $fn$;

-- The detective view has to know about the exception too, or it reports a table
-- that is in fact protected — by a different trigger — as unprotected forever.
CREATE OR REPLACE VIEW ops.v_append_only_unprotected AS
  SELECT t.sch, t.tbl
    FROM (SELECT m[1] AS sch, m[2] AS tbl
            FROM regexp_matches(
                   pg_get_functiondef('ops.apply_append_only_grants(text)'::regprocedure),
                   '\(''([a-z_]+)'',''([a-z_]+)''\)', 'g') AS m) t
    JOIN information_schema.tables it
      ON it.table_schema = t.sch AND it.table_name = t.tbl
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_trigger g
       JOIN pg_class c  ON c.oid = g.tgrelid
       JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
      WHERE nsp.nspname = t.sch AND c.relname = t.tbl
        AND g.tgname IN ('trg_append_only', 'trg_consent_record_guard'));

SELECT ops.attach_append_only_triggers();
