-- Append-only, enforced by something that actually holds.
--
-- `ops.apply_append_only_grants()` REVOKEs UPDATE and DELETE from the connecting
-- role, and it has been silently doing nothing since the day it was written.
-- Two independent reasons:
--
--   1. Phases 3 and 6 each REDEFINED the function to add a table
--      (listing.price_history, procurement.tds_ledger) and then never CALLED it.
--      Phase 2 was the last migration to invoke it. On a fresh `migrate deploy`
--      those two tables therefore never had a REVOKE run against them at all.
--
--   2. The far bigger one: the application connects as the role that OWNS the
--      tables. A Postgres owner holds its privileges implicitly, and REVOKE
--      cannot take them away — the owner can re-GRANT itself at will. Proven on
--      the dev database: after calling apply_append_only_grants() explicitly,
--      has_table_privilege('trugrade','procurement.tds_ledger','UPDATE') is
--      still true. Every table in the list was, and is, freely mutable.
--
-- The test that was meant to catch this asserted only that the function EXISTS
-- (test/integration/schema-hardening.spec.ts). It passed, forever, against a
-- control that did nothing — which is worse than having no control, because the
-- green tick was load-bearing in the Phase 7 argument that a TDS record cannot
-- be edited.
--
-- The fix is a trigger. A BEFORE UPDATE OR DELETE trigger fires for the table
-- owner exactly as it fires for anyone else, so it works in the deployment we
-- actually have rather than the one the grant model assumed. Disabling it is
-- possible but takes a deliberate ALTER TABLE ... DISABLE TRIGGER, which is a
-- DDL statement someone has to write on purpose and can be found afterwards.
--
-- The grants are kept and re-applied alongside. They are correct and they are
-- free; the day the API connects as a non-owner app_role they become a real
-- second layer. Belt and braces, where the braces are the part holding.

-- ---------------------------------------------------------------------------
-- 1. The refusal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION
    '%.% is append-only: a row may be inserted but never %. This table is evidence — supersede a wrong row by writing a new one, do not edit history.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME,
    CASE TG_OP WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END
    USING ERRCODE = 'check_violation';
END $fn$;

COMMENT ON FUNCTION ops.reject_mutation IS
  'Refuses UPDATE and DELETE. Attached by ops.attach_append_only_triggers() to every table in the append-only list. Unlike a REVOKE this binds the table owner too, which is the role the application actually connects as.';

-- ---------------------------------------------------------------------------
-- 2. Attaching it — one list, shared with the grants function
-- ---------------------------------------------------------------------------
-- The table list lives here and in ops.apply_append_only_grants(). Keeping two
-- copies is how phase 3 and phase 6 drifted in the first place, so this reads
-- the list back out of the grants function's own source rather than restating
-- it: whatever a future migration adds there is picked up here for free.
CREATE OR REPLACE FUNCTION ops.attach_append_only_triggers() RETURNS INT
LANGUAGE plpgsql AS $fn$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    -- pg_get_functiondef gives the VALUES list; pull out each ('sch','tbl') pair.
    SELECT m[1] AS sch, m[2] AS tbl
    FROM regexp_matches(
           pg_get_functiondef('ops.apply_append_only_grants(text)'::regprocedure),
           '\(''([a-z_]+)'',''([a-z_]+)''\)', 'g') AS m
  LOOP
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

COMMENT ON FUNCTION ops.attach_append_only_triggers IS
  'Attaches trg_append_only to every table named in ops.apply_append_only_grants(). Idempotent, and re-runnable by any later migration that adds a table to that list — which is the step phases 3 and 6 forgot.';

-- ---------------------------------------------------------------------------
-- 3. Catching up everything phases 3 to 7 skipped
-- ---------------------------------------------------------------------------
-- attach_updated_at_triggers() was last called in phase 2 as well, so every
-- table added since with an updated_at column has been carrying a column
-- nothing maintains. Same omission, quieter symptom.
SELECT ops.attach_updated_at_triggers();
SELECT ops.apply_append_only_grants();
SELECT ops.attach_append_only_triggers();

-- ---------------------------------------------------------------------------
-- 4. The detective control
-- ---------------------------------------------------------------------------
-- If a later migration adds a table to the grants list and forgets to re-run
-- the attacher — the exact mistake this migration exists to repair — this view
-- says so instead of leaving it to be discovered during an audit.
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
      WHERE nsp.nspname = t.sch AND c.relname = t.tbl AND g.tgname = 'trg_append_only');

COMMENT ON VIEW ops.v_append_only_unprotected IS
  'Append-only tables with no trg_append_only. Must return zero rows. A row here means history is editable on that table.';
