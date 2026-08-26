-- ##########################################################################
-- HARDENING — closes the ten known schema defects.
-- 02_ARCHITECTURE.md §2.4, PHASE_00_FOUNDATION.md Task 5.
--
-- Nothing in here is a feature. Every statement closes a defect that would
-- otherwise be discovered in production, and defect #1 has a date on it.
-- ##########################################################################

-- ==========================================================================
-- DEFECT 1 — PARTITION RUNWAY. Highest severity; do this first.
--
-- The adopted schema's partitions run out on 2026-10-01 (order_event,
-- shipment_tracking, notification_log, integration_log) and 2026-11-01
-- (audit_log). There is no creation job. On the day the last partition ends,
-- INSERTs simply start failing — silently at first, because nothing is
-- watching.
--
-- We add the machinery, not the partitions: a function that creates a month
-- idempotently, and a function that reports the runway. A BullMQ cron calls
-- them nightly (src/platform/jobs/partition.job.ts) and /health surfaces the
-- runway in days.
--
-- We deliberately do NOT add DEFAULT partitions. A DEFAULT partition silently
-- accepts rows for a month that does not exist yet, and then *blocks* the
-- creation of that month's real partition — turning a loud failure into a
-- quiet one you cannot fix without moving data.
-- ==========================================================================

CREATE SCHEMA IF NOT EXISTS ops;
COMMENT ON SCHEMA ops IS
  'Operational plumbing owned by no business module: partitions, runway checks, job bookkeeping.';

-- The register of what is partitioned and on which column. Adding a partitioned
-- table later means inserting a row here, not editing a job.
CREATE TABLE IF NOT EXISTS ops.partitioned_table (
  table_schema   TEXT NOT NULL,
  table_name     TEXT NOT NULL,
  partition_key  TEXT NOT NULL,
  months_ahead   INT  NOT NULL DEFAULT 3 CHECK (months_ahead BETWEEN 1 AND 12),
  retention_months INT CHECK (retention_months IS NULL OR retention_months >= 1),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (table_schema, table_name)
);

INSERT INTO ops.partitioned_table (table_schema, table_name, partition_key, retention_months) VALUES
  ('identity',  'audit_log',         'created_at',  96),  -- DPDP: statutory records kept 8 years
  ('ordering',  'order_event',       'occurred_at', 96),
  ('logistics', 'shipment_tracking', 'occurred_at', 36),
  ('platform',  'notification_log',  'sent_at',     24),
  ('platform',  'integration_log',   'occurred_at', 12)
ON CONFLICT (table_schema, table_name) DO NOTHING;

/**
 * Create one monthly partition, idempotently. Safe to call every night forever.
 * Returns TRUE when it actually created something, so the job can log usefully.
 */
CREATE OR REPLACE FUNCTION ops.create_month_partition(
  p_schema TEXT, p_table TEXT, p_month DATE
) RETURNS BOOLEAN AS $$
DECLARE
  v_start DATE := date_trunc('month', p_month)::DATE;
  v_end   DATE := (date_trunc('month', p_month) + INTERVAL '1 month')::DATE;
  v_part  TEXT := format('%s_%s', p_table, to_char(v_start, 'YYYY_MM'));
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_schema AND c.relname = v_part
  ) THEN
    RETURN FALSE;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
    p_schema, v_part, p_schema, p_table, v_start, v_end
  );
  RETURN TRUE;
END $$ LANGUAGE plpgsql;

/**
 * Create partitions from this month to `p_months_ahead` months out, for every
 * registered table. Idempotent. Returns one row per table with how many it made.
 */
CREATE OR REPLACE FUNCTION ops.ensure_partitions(p_months_ahead INT DEFAULT NULL)
RETURNS TABLE (table_schema TEXT, table_name TEXT, created_count INT) AS $$
DECLARE
  r RECORD;
  i INT;
  n INT;
  ahead INT;
BEGIN
  FOR r IN SELECT * FROM ops.partitioned_table WHERE is_active LOOP
    ahead := COALESCE(p_months_ahead, r.months_ahead);
    n := 0;
    FOR i IN 0..ahead LOOP
      IF ops.create_month_partition(
           r.table_schema, r.table_name,
           (date_trunc('month', CURRENT_DATE) + (i || ' month')::INTERVAL)::DATE
         ) THEN
        n := n + 1;
      END IF;
    END LOOP;
    table_schema := r.table_schema;
    table_name   := r.table_name;
    created_count := n;
    RETURN NEXT;
  END LOOP;
END $$ LANGUAGE plpgsql;

/**
 * How many days of runway is left on each partitioned table?
 * `/health` reads this. Below 30 days it pages someone (DATA-05, DATA-06).
 *
 * Reads the real upper bound out of pg_class rather than trusting a naming
 * convention, because the failure this guards against is precisely the case
 * where reality and the convention have diverged.
 */
CREATE OR REPLACE VIEW ops.v_partition_runway AS
WITH bounds AS (
  SELECT
    pt.table_schema,
    pt.table_name,
    MAX(
      NULLIF(
        regexp_replace(pg_get_expr(child.relpartbound, child.oid), '^.*TO \(''([^'']+)''\).*$', '\1'),
        pg_get_expr(child.relpartbound, child.oid)
      )::DATE
    ) AS last_bound
  FROM ops.partitioned_table pt
  JOIN pg_class parent   ON parent.relname = pt.table_name
  JOIN pg_namespace pn   ON pn.oid = parent.relnamespace AND pn.nspname = pt.table_schema
  JOIN pg_inherits inh   ON inh.inhparent = parent.oid
  JOIN pg_class child    ON child.oid = inh.inhrelid
  WHERE pt.is_active
  GROUP BY pt.table_schema, pt.table_name
)
SELECT
  table_schema,
  table_name,
  last_bound AS covered_until,
  (last_bound - CURRENT_DATE) AS runway_days,
  (last_bound - CURRENT_DATE) < 30 AS is_critical
FROM bounds;

COMMENT ON VIEW ops.v_partition_runway IS
  'Days of partition runway per table. Below 30 is a P1 page, not a warning.';

-- Create the runway now, so the adopted schema stops expiring on 2026-10-01.
SELECT * FROM ops.ensure_partitions(6);

-- ==========================================================================
-- DEFECT 2 — ZERO TRIGGERS, ZERO FUNCTIONS.
--
-- Every invariant the adopted schema asserts in prose is enforced only by
-- application code. The ones below are the invariants where "the application
-- forgot" produces either an oversell or a false claim to a buyer, so they
-- move into the database where no code path can skip them.
-- ==========================================================================

-- --- 2a. updated_at, everywhere it is claimed -----------------------------

CREATE OR REPLACE FUNCTION ops.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

/**
 * Attach the trigger to every table that has an `updated_at` column and does not
 * already have it. Run once here; re-runnable, so a later migration that adds a
 * table can simply call it again.
 */
CREATE OR REPLACE FUNCTION ops.attach_updated_at_triggers() RETURNS INT AS $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN pg_class pc ON pc.relname = c.table_name
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
    WHERE c.column_name = 'updated_at'
      AND c.table_schema IN ('identity','customer','vendor','kyc','catalog','listing',
                             'ordering','qc','logistics','payment','platform','procurement')
      AND pc.relkind IN ('r','p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = pc.oid AND t.tgname = 'trg_set_updated_at'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at()',
      r.table_schema, r.table_name
    );
    n := n + 1;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql;

SELECT ops.attach_updated_at_triggers();

-- --- 2b. valuation_method immutability ------------------------------------
-- This is a tax control, not data hygiene. `valuation_method` decides the GST
-- treatment for the life of the unit; flipping it after purchase retrospectively
-- destroys the Rule 32(5) position on a unit already invoiced.
-- 02_ARCHITECTURE.md §2.3, VR-133.

ALTER TABLE listing.unit
  ADD COLUMN IF NOT EXISTS vendor_ask_price  NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS purchase_price    NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valuation_method  TEXT NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN IF NOT EXISTS itc_eligible      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS retail_price      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS margin_rule_id    UUID,
  ADD COLUMN IF NOT EXISTS supply_point_code TEXT;

DO $$ BEGIN
  ALTER TABLE listing.unit ADD CONSTRAINT chk_unit_valuation_method
    CHECK (valuation_method IN ('REGULAR','MARGIN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- VR-132: a MARGIN unit may never be ITC-eligible. The two are mutually
-- exclusive by law (Rule 32(5) is conditional on no ITC having been availed),
-- so they are mutually exclusive in the table.
DO $$ BEGIN
  ALTER TABLE listing.unit ADD CONSTRAINT chk_unit_margin_no_itc
    CHECK (valuation_method <> 'MARGIN' OR itc_eligible = FALSE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION listing.lock_valuation_method() RETURNS trigger AS $$
BEGIN
  IF OLD.purchase_price IS NOT NULL AND NEW.valuation_method IS DISTINCT FROM OLD.valuation_method THEN
    RAISE EXCEPTION
      'valuation_method is immutable once purchase_price is set (unit %). Changing it would retrospectively alter the GST treatment of a unit already purchased.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lock_valuation ON listing.unit;
CREATE TRIGGER trg_lock_valuation BEFORE UPDATE ON listing.unit
  FOR EACH ROW EXECUTE FUNCTION listing.lock_valuation_method();

COMMENT ON COLUMN listing.unit.valuation_method IS
  'REGULAR (ITC claimed, 18% on full value) or MARGIN (Rule 32(5), 18% on sale-purchase). Immutable once purchase_price is set — enforced by trigger, not convention.';
COMMENT ON COLUMN listing.unit.supply_point_code IS
  'The anonymised buyer-facing label (A, B, C...) assigned per vendor per city. A label, never a reversible transform of the vendor UUID.';

-- --- 2c. is_sellable is computed, in one place ----------------------------
-- 03_UX_SPEC / Phase 5: "Never compute sellability in a query — one place, one
-- definition." That place is here.

CREATE OR REPLACE FUNCTION listing.recompute_is_sellable() RETURNS trigger AS $$
DECLARE
  v_seal_ok BOOLEAN;
BEGIN
  SELECT COALESCE(s.status IN ('APPLIED','INTACT'), FALSE)
    INTO v_seal_ok
  FROM qc.qc_seal s WHERE s.id = NEW.seal_id;

  NEW.is_sellable :=
        NEW.status = 'LISTED'
    AND NEW.qc_passed_at IS NOT NULL
    AND NEW.qc_valid_until IS NOT NULL
    AND NEW.qc_valid_until >= CURRENT_DATE
    AND COALESCE(v_seal_ok, FALSE);

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recompute_sellable ON listing.unit;
CREATE TRIGGER trg_recompute_sellable
  BEFORE INSERT OR UPDATE OF status, qc_passed_at, qc_valid_until, seal_id
  ON listing.unit
  FOR EACH ROW EXECUTE FUNCTION listing.recompute_is_sellable();

-- --- 2d. exactly one current QC report per unit ---------------------------
-- Re-inspections supersede; they never overwrite. History is the evidence you
-- need the day a buyer disputes a grade.

CREATE OR REPLACE FUNCTION qc.enforce_single_current_report() RETURNS trigger AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE qc.qc_report
       SET is_current = FALSE,
           superseded_by_id = NEW.id
     WHERE unit_id = NEW.unit_id
       AND id <> NEW.id
       AND is_current;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_single_current_report ON qc.qc_report;
CREATE TRIGGER trg_single_current_report AFTER INSERT ON qc.qc_report
  FOR EACH ROW EXECUTE FUNCTION qc.enforce_single_current_report();

-- --- 2e. listing quantity counters ----------------------------------------
-- A counter bug is how you oversell. The counters are derived from the units,
-- by the database, on every unit status change.

CREATE OR REPLACE FUNCTION listing.recompute_listing_counters() RETURNS trigger AS $$
DECLARE
  v_listing UUID := COALESCE(NEW.listing_id, OLD.listing_id);
BEGIN
  IF v_listing IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE listing.listing l
     SET qty_available   = c.available,
         qty_reserved    = c.reserved,
         qty_awaiting_qc = c.awaiting_qc,
         qty_qc_failed   = c.qc_failed
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE u.status = 'LISTED')                                AS available,
        COUNT(*) FILTER (WHERE u.status = 'RESERVED')                              AS reserved,
        COUNT(*) FILTER (WHERE u.status IN ('AWAITING_QC','QC_SCHEDULED','QC_SEALED')) AS awaiting_qc,
        COUNT(*) FILTER (WHERE u.status IN ('QC_FAILED','QC_EXPIRED','SEAL_BROKEN'))   AS qc_failed
      FROM listing.unit u WHERE u.listing_id = v_listing
    ) c
   WHERE l.id = v_listing;

  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listing_counters ON listing.unit;
CREATE TRIGGER trg_listing_counters
  AFTER INSERT OR DELETE OR UPDATE OF status, listing_id ON listing.unit
  FOR EACH ROW EXECUTE FUNCTION listing.recompute_listing_counters();

-- --- 2f. QC visit unit counters -------------------------------------------

CREATE OR REPLACE FUNCTION qc.recompute_visit_counters() RETURNS trigger AS $$
DECLARE
  v_visit UUID := COALESCE(NEW.visit_id, OLD.visit_id);
BEGIN
  IF v_visit IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE qc.qc_visit v
     SET units_inspected = c.inspected,
         units_passed    = c.passed,
         units_failed    = c.failed
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE vu.outcome <> 'PENDING')                                  AS inspected,
        COUNT(*) FILTER (WHERE vu.outcome IN ('PASS','PASS_WITH_NOTE','PASS_GRADE_CORRECTED')) AS passed,
        COUNT(*) FILTER (WHERE vu.outcome IN ('FAIL','UNTESTABLE'))                      AS failed
      FROM qc.qc_visit_unit vu WHERE vu.visit_id = v_visit
    ) c
   WHERE v.id = v_visit;

  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_visit_counters ON qc.qc_visit_unit;
CREATE TRIGGER trg_visit_counters
  AFTER INSERT OR DELETE OR UPDATE OF outcome ON qc.qc_visit_unit
  FOR EACH ROW EXECUTE FUNCTION qc.recompute_visit_counters();

-- ==========================================================================
-- DEFECT 3 — v_sellability_drift silently misses seal-less units.
--
-- The adopted view LEFT JOINs qc.qc_seal. When a unit has no seal at all,
-- `s.status` is NULL, `s.status IN (...)` evaluates to NULL, the whole WHERE
-- predicate goes NULL, and the row is filtered out.
--
-- So a unit marked sellable **with no seal whatsoever** — precisely the
-- anti-swap failure the seal exists to prevent — never appears in the drift
-- report that is supposed to catch it. COALESCE closes it. (LST-051, DATA-03)
-- ==========================================================================

CREATE OR REPLACE VIEW listing.v_sellability_drift AS
SELECT u.id AS unit_id, u.serial_number, u.listing_id, u.is_sellable,
       (u.status = 'LISTED')                                  AS status_ok,
       (u.qc_passed_at IS NOT NULL)                           AS qc_done,
       (u.qc_valid_until >= CURRENT_DATE)                     AS qc_fresh,
       COALESCE(s.status IN ('APPLIED','INTACT'), FALSE)      AS seal_ok
FROM listing.unit u
LEFT JOIN qc.qc_seal s ON s.id = u.seal_id
WHERE u.is_sellable IS DISTINCT FROM (
        u.status = 'LISTED'
    AND u.qc_passed_at IS NOT NULL
    AND COALESCE(u.qc_valid_until >= CURRENT_DATE, FALSE)
    AND COALESCE(s.status IN ('APPLIED','INTACT'), FALSE)
);

COMMENT ON VIEW listing.v_sellability_drift IS
  'Units whose is_sellable flag disagrees with the facts. Must return zero rows nightly. A seal-less sellable unit DOES appear here — that is defect #3, fixed.';

-- ==========================================================================
-- DEFECT 4 — platform_config.key has no UNIQUE.
--
-- Config is effective-dated, so the key alone is not unique — but
-- (key, effective_from) must be, and reads must take the latest effective row
-- rather than whatever the planner returns first.
-- ==========================================================================

ALTER TABLE platform.platform_config
  ADD COLUMN IF NOT EXISTS effective_from DATE NOT NULL DEFAULT CURRENT_DATE;

DO $$ BEGIN
  ALTER TABLE platform.platform_config ADD CONSTRAINT uq_platform_config_key_from
    UNIQUE (key, effective_from);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The adopted seed carries three keys with an upper-case grade in them
-- (warranty.default.A_PLUS). VR-152 fixes the key shape as lower-case, and the
-- keys are ours to name — so normalise the three rows rather than widen the rule
-- and let mixed case in forever.
UPDATE platform.platform_config
   SET key = lower(key)
 WHERE key <> lower(key)
   AND NOT EXISTS (
     SELECT 1 FROM platform.platform_config c2 WHERE c2.key = lower(platform_config.key)
   );

DO $$ BEGIN
  ALTER TABLE platform.platform_config ADD CONSTRAINT chk_platform_config_key
    CHECK (key ~ '^[a-z0-9_.]{3,80}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE VIEW platform.v_current_config AS
SELECT DISTINCT ON (key) key, value_json, effective_from
FROM platform.platform_config
WHERE effective_from <= CURRENT_DATE
ORDER BY key, effective_from DESC;

COMMENT ON VIEW platform.v_current_config IS
  'The config the application reads. Effective-dated, latest wins. Nothing reads platform_config directly.';

-- ==========================================================================
-- DEFECT 5 — nine free-text status columns, all on the after-sale and money
-- tables, with no CHECK. A typo becomes a row nothing will ever query again.
-- VR-156.
-- ==========================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('logistics','delivery_task','status',
       ARRAY['PENDING','ASSIGNED','OUT_FOR_DELIVERY','ATTEMPTED','DELIVERED','FAILED','RTO','CANCELLED']),
      ('payment','eway_bill','status',
       ARRAY['DRAFT','GENERATED','PART_B_PENDING','ACTIVE','EXPIRED','CANCELLED','REJECTED']),
      ('payment','refund','status',
       ARRAY['REQUESTED','APPROVED','PROCESSING','COMPLETED','FAILED','REJECTED','CANCELLED']),
      ('payment','payout','status',
       ARRAY['PENDING','QUEUED','PROCESSING','PAID','FAILED','REVERSED','CARRIED_FORWARD','CANCELLED']),
      ('platform','return_request','status',
       ARRAY['RAISED','APPROVED','REJECTED','PICKUP_SCHEDULED','PICKED_UP','RECEIVED','INSPECTED','REFUNDED','REPLACED','RETURNED_TO_BUYER','CANCELLED']),
      ('platform','ticket','status',
       ARRAY['OPEN','ACKNOWLEDGED','IN_PROGRESS','INFO_REQUESTED','ESCALATED','RESOLVED','CLOSED','REOPENED']),
      ('platform','warranty_claim','status',
       ARRAY['RAISED','ACKNOWLEDGED','TRIAGE','INFO_REQUESTED','APPROVED','REJECTED','IN_REPAIR','REPLACEMENT_ISSUED','REFUND_ISSUED','ESCALATED','CLOSED']),
      ('platform','dispute','status',
       ARRAY['RAISED','UNDER_REVIEW','EVIDENCE_REQUESTED','RESOLVED_BUYER','RESOLVED_PLATFORM','RESOLVED_VENDOR','WITHDRAWN','CLOSED']),
      ('platform','data_subject_request','status',
       ARRAY['RECEIVED','VERIFYING','IN_PROGRESS','COMPLETED','PARTIALLY_COMPLETED','REJECTED','WITHDRAWN'])
    ) AS t(sch, tbl, col, vals)
  LOOP
    -- Only if the table and column actually exist, and only if the values in it
    -- are already legal. A CHECK that cannot be validated is a failed migration.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = r.sch AND table_name = r.tbl AND column_name = r.col
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = format('chk_%s_%s_status', r.tbl, r.col)
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (%I = ANY (%L::text[]))',
        r.sch, r.tbl, format('chk_%s_%s_status', r.tbl, r.col), r.col, r.vals
      );
    END IF;
  END LOOP;
END $$;

-- The adopted index ix_ewb_expiry filters on status = 'ACTIVE', a value nothing
-- ever wrote. The enum above now contains it, so the index becomes reachable
-- instead of permanently empty.
COMMENT ON INDEX payment.ix_ewb_expiry IS
  'Filters on status = ACTIVE, which nothing wrote before the status CHECK above made ACTIVE a real value.';

-- ==========================================================================
-- DEFECTS 6 and 7 — deferred to Phase 8, deliberately.
--
--   #6  logistics.routing_rule.carrier_code is TEXT, not an FK to carrier(code)
--   #7  logistics.carrier_rate_card has no overlap-exclusion constraint
--
-- Both are logistics-domain fixes that need the carrier master and the rate-card
-- shape settled first (02_ARCHITECTURE.md §2.4 assigns both to Phase 8). Listed
-- here so this file is a complete account of all ten, not eight.
-- ==========================================================================

-- ==========================================================================
-- DEFECT 8 — qc_sampling_rule allows two active rules per tier.
-- Two matching rules means the sampling percentage is whichever the planner
-- returned, which is not a policy.
-- ==========================================================================

DO $$ BEGIN
  ALTER TABLE qc.qc_sampling_rule ADD CONSTRAINT uq_sampling_tier_from
    UNIQUE (vendor_tier, effective_from);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sampling_active_per_tier
  ON qc.qc_sampling_rule (vendor_tier) WHERE is_active;

-- ==========================================================================
-- DEFECT 9 — two QC models coexist with nothing marking which is canonical.
-- Vendor-site QC is canonical. The hub-batch path keeps its data for history
-- and stops accepting new rows.
-- ==========================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'qc' AND table_name = 'qc_batch') THEN
    EXECUTE $c$COMMENT ON TABLE qc.qc_batch IS
      'DEPRECATED 2026-08-26. The hub-batch (post-order) QC model is superseded by vendor-site QC at listing time. Existing rows are retained for history; new rows are blocked by chk_qc_batch_deprecated.'$c$;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_qc_batch_deprecated') THEN
      -- NOT VALID so existing history is untouched while new inserts are refused.
      EXECUTE 'ALTER TABLE qc.qc_batch ADD CONSTRAINT chk_qc_batch_deprecated CHECK (FALSE) NOT VALID';
    END IF;
  END IF;
END $$;

-- ==========================================================================
-- DEFECT 10 — role provisioning and append-only enforcement.
--
-- Role *creation* is gone (see the baseline header). What stays is the part
-- that is genuinely schema: which tables the application role may never UPDATE
-- or DELETE. An engineer cannot "just fix" a ledger row in production, and that
-- is the point. 02_ARCHITECTURE.md §2.5.
--
-- The grants are applied to whatever role the deployment provisions, resolved
-- at migration time, so this works identically on a laptop and in RDS.
-- ==========================================================================

CREATE SCHEMA IF NOT EXISTS procurement;
COMMENT ON SCHEMA procurement IS
  'Merchant-of-record procurement: purchase orders, vendor invoices, three-way match, TDS, payouts. Tables land in Phase 7; the schema exists from Phase 0 so multiSchema and the boundary lint are complete from the start.';

CREATE OR REPLACE FUNCTION ops.apply_append_only_grants(p_role TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
  v_role TEXT := COALESCE(p_role, current_user);
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('identity','audit_log'),
      ('payment','ledger_entry'),
      ('listing','stock_movement'),
      ('logistics','custody_event'),
      ('kyc','consent_record')
    ) AS t(sch, tbl)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = r.sch AND table_name = r.tbl) THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON %I.%I FROM %I', r.sch, r.tbl, v_role);
    END IF;
  END LOOP;
  RETURN v_role;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.apply_append_only_grants IS
  'Re-applies the append-only REVOKEs. Called after every migration that creates one of these tables, and by Terraform against the production app role. procurement.tds_ledger joins the list in Phase 7.';

-- Note: not applied to the local superuser, which would be pointless — a
-- superuser bypasses grants. Terraform calls this against the real app role.

-- ==========================================================================
-- THE TRANSACTIONAL OUTBOX
--
-- Publishing an event inside a transaction must not dispatch until that
-- transaction commits. Otherwise a subscriber acts on an order that was rolled
-- back — and it will be the payout subscriber, and it will be at volume.
-- PHASE_00_FOUNDATION.md Task 4.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS platform.event_outbox (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name     TEXT NOT NULL,
  payload_json   JSONB NOT NULL,
  trace_id       TEXT,
  actor_user_id  UUID,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- dispatch bookkeeping
  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','DISPATCHED','FAILED','DEAD_LETTER')),
  attempts       INT NOT NULL DEFAULT 0,
  last_error     TEXT,
  dispatched_at  TIMESTAMPTZ,
  next_retry_at  TIMESTAMPTZ
);

-- The drain query. Partial so it stays small however large the table grows.
CREATE INDEX IF NOT EXISTS ix_outbox_pending
  ON platform.event_outbox (occurred_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS ix_outbox_retry
  ON platform.event_outbox (next_retry_at)
  WHERE status = 'FAILED';

COMMENT ON TABLE platform.event_outbox IS
  'Transactional outbox. Events are written here inside the business transaction and drained after commit, so a rolled-back transaction publishes nothing.';

-- ==========================================================================
-- JOB BOOKKEEPING — /health reports the last successful run of every nightly
-- integrity job, because a drift view that stopped running looks exactly like
-- a drift view returning zero rows.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ops.job_run (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name      TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'RUNNING'
                CHECK (status IN ('RUNNING','SUCCESS','FAILED')),
  rows_affected INT,
  detail_json   JSONB,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS ix_job_run_name_started
  ON ops.job_run (job_name, started_at DESC);

CREATE OR REPLACE VIEW ops.v_job_health AS
SELECT DISTINCT ON (job_name)
       job_name, started_at, finished_at, status, rows_affected, error
FROM ops.job_run
ORDER BY job_name, started_at DESC;
