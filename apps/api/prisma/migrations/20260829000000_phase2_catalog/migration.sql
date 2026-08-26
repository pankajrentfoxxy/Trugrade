-- ============================================================================
-- PHASE 2 — Master catalog and the condition image library
--
-- The catalog schema shipped in baseline_core against the legacy Part 6 design
-- and has never been altered since. This migration brings it to the Phase 2
-- specification and closes five defects found while reading it.
--
-- Hand-written, like every migration in this repo. Do NOT run `prisma migrate
-- dev` against this schema: schema.prisma is an introspection artefact that
-- does not represent the partial indexes or the CHECK constraints, so a
-- diff-generated migration silently drops both.
-- ============================================================================

-- ==========================================================================
-- 1. HSN / GST master — VR-098, VR-131, CAT-008
--
-- VR-131 says "no hard-coded 18 in code" and CAT-008 requires the rate to be
-- "resolved from the effective-dated table, not hard-coded". Today the rate is
-- a column default on catalog.sku, which is exactly the hard-coding both
-- forbid: a rate-change notification would leave every historical invoice
-- claiming the new rate.
--
-- Effective-dated, so an invoice raised in March reads the March rate for ever.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS catalog.hsn_code (
  code            TEXT PRIMARY KEY,
  description     TEXT NOT NULL,
  -- 8 digits. VR-098. A 4-digit heading is a chapter, not a commodity code,
  -- and Delhivery rejects it on the e-way bill payload (Phase 8).
  CONSTRAINT chk_hsn_8_digits CHECK (code ~ '^[0-9]{8}$')
);

COMMENT ON TABLE catalog.hsn_code IS
  'HSN master. VR-098 requires an 8-digit code that exists here with a GST rate.';

CREATE TABLE IF NOT EXISTS catalog.gst_rate (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hsn_code       TEXT NOT NULL REFERENCES catalog.hsn_code(code),
  rate_pct       NUMERIC(5,2) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 40),
  cess_pct       NUMERIC(5,2) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  notification   TEXT,
  CONSTRAINT chk_gst_rate_window CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Two rates live for the same HSN on the same day is not a config choice, it is
-- an unanswerable invoice. btree_gist is already installed for exactly this.
ALTER TABLE catalog.gst_rate DROP CONSTRAINT IF EXISTS ex_gst_rate_no_overlap;
ALTER TABLE catalog.gst_rate ADD CONSTRAINT ex_gst_rate_no_overlap
  EXCLUDE USING gist (
    hsn_code WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  );

CREATE OR REPLACE FUNCTION catalog.gst_rate_on(p_hsn TEXT, p_on DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC AS $$
  SELECT rate_pct FROM catalog.gst_rate
  WHERE hsn_code = p_hsn
    AND effective_from <= p_on
    AND (effective_to IS NULL OR effective_to > p_on)
  LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION catalog.gst_rate_on IS
  'The rate that applied on a given date. Invoices call this with the invoice date, never CURRENT_DATE, so a reprint of a March invoice still says what March said.';

INSERT INTO catalog.hsn_code (code, description) VALUES
  ('84713010', 'Portable digital automatic data processing machines, weighing not more than 10 kg')
ON CONFLICT (code) DO NOTHING;

INSERT INTO catalog.gst_rate (hsn_code, rate_pct, effective_from, notification)
SELECT '84713010', 18.00, DATE '2017-07-01', 'Notification 1/2017-Central Tax (Rate), Schedule III'
WHERE NOT EXISTS (SELECT 1 FROM catalog.gst_rate WHERE hsn_code = '84713010');

-- ==========================================================================
-- 2. catalog.sku — the Task 3 field list, and the HSN defect
--
-- DEFECT: hsn_code DEFAULT '8471' is four digits and fails the platform's own
-- VR-098 (^[0-9]{8}$). Every SKU created without an explicit HSN carried an
-- invalid code straight onto a Phase 7 invoice line and a Phase 8 shipment
-- payload. There was no CHECK, so the database accepted it.
-- ==========================================================================

UPDATE catalog.sku SET hsn_code = '84713010' WHERE hsn_code !~ '^[0-9]{8}$';

ALTER TABLE catalog.sku ALTER COLUMN hsn_code SET DEFAULT '84713010';

ALTER TABLE catalog.sku DROP CONSTRAINT IF EXISTS chk_sku_hsn_8_digits;
ALTER TABLE catalog.sku ADD CONSTRAINT chk_sku_hsn_8_digits
  CHECK (hsn_code ~ '^[0-9]{8}$');

ALTER TABLE catalog.sku DROP CONSTRAINT IF EXISTS fk_sku_hsn;
ALTER TABLE catalog.sku ADD CONSTRAINT fk_sku_hsn
  FOREIGN KEY (hsn_code) REFERENCES catalog.hsn_code(code);

COMMENT ON COLUMN catalog.sku.gst_rate IS
  'DEPRECATED as a source of truth. Read catalog.gst_rate_on(hsn_code, invoice_date) instead — VR-131 and CAT-008 both require an effective-dated lookup. Retained so historical rows keep the rate they were raised under.';

-- Task 3 fields the baseline did not carry.
ALTER TABLE catalog.sku
  ADD COLUMN IF NOT EXISTS ram_slots          INT,
  ADD COLUMN IF NOT EXISTS storage_slots      INT,
  ADD COLUMN IF NOT EXISTS os_licence_type    TEXT
    CHECK (os_licence_type IS NULL OR os_licence_type IN ('OEM','RETAIL','VOLUME','NONE')),
  ADD COLUMN IF NOT EXISTS wifi_standard      TEXT,
  ADD COLUMN IF NOT EXISTS bluetooth_version  TEXT,
  ADD COLUMN IF NOT EXISTS keyboard_layout    TEXT,
  ADD COLUMN IF NOT EXISTS backlit_keyboard   BOOLEAN,
  ADD COLUMN IF NOT EXISTS fingerprint_reader BOOLEAN,
  ADD COLUMN IF NOT EXISTS webcam_mp          NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS year_released      INT,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

-- Task 3's names differ from the baseline's for six fields. Renaming would
-- break spec-match.ts, the seed and every existing query for no functional
-- gain, so the baseline names stand and the mapping is recorded here instead.
COMMENT ON COLUMN catalog.sku.cores IS 'Task 3 calls this cpu_cores.';
COMMENT ON COLUMN catalog.sku.screen_size_inch IS
  'Task 3 calls this screen_size_in. NUMERIC(4,1) — Prisma returns a Decimal, so convert with .toNumber() at the repository boundary. Arithmetic on the raw Decimal yields NaN and NaN > tolerance is false, which makes a tolerance check pass for everything.';
COMMENT ON COLUMN catalog.sku.resolution IS 'Task 3 calls this screen_resolution.';
COMMENT ON COLUMN catalog.sku.panel_type IS 'Task 3 calls this screen_panel.';
COMMENT ON COLUMN catalog.sku.is_touch IS
  'Task 3 calls this touchscreen. Part of normalized_key — a touch variant is a different SKU, not a note (legacy 6.3).';
COMMENT ON COLUMN catalog.sku.os_supported IS 'Task 3 calls this os.';
COMMENT ON COLUMN catalog.sku.battery_wh IS 'Task 3 calls this battery_design_wh.';

COMMENT ON COLUMN catalog.sku.normalized_key IS
  'The dedupe guarantee. brand|model|cpu_family|cpu_model|ram_gb|storage_gb|storage_type|screen_size|resolution|gpu|os|is_touch, each canonicalised. Generated ONLY by skuNormalizedKey() in packages/contracts — a second code path that computes it differently is how a catalog rots, and the UNIQUE below then fails open instead of catching it.';

-- ==========================================================================
-- 3. catalog.grade_definition — Task 5
--
-- Rule 7(5) makes the grading claim a liability trigger and the CCPA Misleading
-- Advertisements Guidelines 2022 test claims against reality, so a grade has to
-- be a threshold a machine either meets or does not. Not a technician's opinion.
--
-- Thresholds are 85/75/60 per TEST_PLAN VR-094/VR-095 and rules.ts. Phase 2's
-- prose says 90/80/70; that number appears nowhere else and the platform's own
-- validation catalogue plus a passing test both say otherwise.
--
-- effective_from is what lets a report from six months ago be read against the
-- rules that applied then.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS catalog.grade_definition (
  grade                  public.grade_type NOT NULL,
  effective_from         DATE NOT NULL DEFAULT CURRENT_DATE,
  display_name           TEXT NOT NULL,
  customer_description   TEXT NOT NULL,
  min_battery_health_pct INT NOT NULL CHECK (min_battery_health_pct BETWEEN 0 AND 100),
  max_cycle_count        INT CHECK (max_cycle_count IS NULL OR max_cycle_count >= 0),
  min_cosmetic_score     INT NOT NULL CHECK (min_cosmetic_score BETWEEN 0 AND 100),
  allowed_defects_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  screen_defects_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  effective_to           DATE,
  -- Deliberately NOT an FK to identity.user_account.
  --
  -- This is reference data that must survive a test run's TRUNCATE ... CASCADE.
  -- CASCADE truncates every table holding an FK that POINTS AT a truncated
  -- table, unconditionally and regardless of whether any row actually
  -- references it — so an FK here silently empties the grade definitions the
  -- moment user_account is cleared, and the QC engine then grades against
  -- nothing. Excluding the table from the truncate list does not help; the
  -- cascade is structural.
  --
  -- The actor is recorded in catalog.catalog_change_log, which is where the
  -- audit question is actually asked.
  created_by             UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (grade, effective_from),
  CONSTRAINT chk_grade_def_window CHECK (effective_to IS NULL OR effective_to > effective_from)
);

ALTER TABLE catalog.grade_definition DROP CONSTRAINT IF EXISTS ex_grade_def_no_overlap;
-- The enum goes in directly, not cast to text: an enum-to-text cast is only
-- STABLE (labels can be renamed), and an index expression must be IMMUTABLE.
-- btree_gist ships an enum operator class for exactly this.
ALTER TABLE catalog.grade_definition ADD CONSTRAINT ex_grade_def_no_overlap
  EXCLUDE USING gist (
    grade WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  );

CREATE OR REPLACE VIEW catalog.v_current_grade_definition AS
  SELECT DISTINCT ON (grade) *
  FROM catalog.grade_definition
  WHERE effective_from <= CURRENT_DATE
    AND (effective_to IS NULL OR effective_to > CURRENT_DATE)
  ORDER BY grade, effective_from DESC;

COMMENT ON TABLE catalog.grade_definition IS
  'Grades as numeric thresholds, versioned by effective_from. The Phase 4 QC engine reads THIS, not a constant in code — a grade that lives in a constant cannot be defended against a report written six months ago.';

-- ==========================================================================
-- 4. catalog.condition_image — Task 4
--
-- The DDL sketched in 02_ARCHITECTURE.md §2.3 ships three defects, and Phase 2
-- says to build it "exactly as specified". Copying it verbatim would produce:
--
--   1. UNIQUE (model_id, grade, view_code, sort_order) is INERT for SKU-anchored
--      rows, because model_id is NULL there and Postgres treats NULLs as
--      distinct. The constraint that is supposed to stop duplicate slots does
--      nothing on precisely the rows that override a model.
--   2. uq_condition_primary over COALESCE(sku_id, model_id) has the same hole
--      for series-level rows, where both are NULL — unlimited orphan primaries.
--   3. No retired_at, so a replacement is an overwrite or a hard delete. §3C.2
--      and the caching section both require retire-not-overwrite, because
--      "prove what the buyer saw on 12 Aug" is a Rule 7(5) question.
--
-- It also has no series_id, so it cannot express step 3 of its own resolution
-- order. Added here.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS catalog.condition_image (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactly one anchor. The resolution order is sku -> model -> series, so a
  -- row anchored to two levels at once has no defined precedence.
  sku_id        UUID REFERENCES catalog.sku(id),
  model_id      UUID REFERENCES catalog.model(id),
  series_id     UUID REFERENCES catalog.series(id),
  grade         public.grade_type NOT NULL,
  view_code     TEXT NOT NULL,
  s3_key        TEXT NOT NULL,
  alt_text      TEXT NOT NULL CHECK (length(btrim(alt_text)) >= 10),
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INT NOT NULL DEFAULT 0,
  -- §3C.2 metadata. A Grade B set must be able to show the worst permissible
  -- defect for that grade, which needs the defect to be named on the row.
  defect_type   TEXT,
  severity      TEXT CHECK (severity IS NULL OR severity IN ('NONE','FAINT','MINOR','MODERATE','WORST_ALLOWED')),
  shot_angle    TEXT,
  captured_on   DATE,
  photographer  TEXT,
  licence       TEXT,
  -- Rendering. The blur placeholder is generated at upload so there is no
  -- runtime cost and no layout shift (03_UX_SPEC image pipeline).
  blur_data_uri TEXT,
  width_px      INT,
  height_px     INT,
  -- Retire, never overwrite. A new version is a new row and a new URL.
  version       INT NOT NULL DEFAULT 1,
  retired_at    TIMESTAMPTZ,
  retired_by    UUID REFERENCES identity.user_account(id),
  supersedes_id UUID REFERENCES catalog.condition_image(id),
  created_by    UUID NOT NULL REFERENCES identity.user_account(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_condition_view_code CHECK (view_code IN (
    'LID_TOP','PALMREST','KEYBOARD','SCREEN_ON','PORTS_LEFT',
    'PORTS_RIGHT','BASE','HINGE','CORNER_WEAR','SCREEN_DEFECT')),
  -- The fix for defects 1 and 2: exactly one anchor, never zero, never two.
  CONSTRAINT chk_condition_one_anchor CHECK (
    num_nonnulls(sku_id, model_id, series_id) = 1),
  CONSTRAINT chk_condition_retired_pair CHECK (
    (retired_at IS NULL AND retired_by IS NULL) OR (retired_at IS NOT NULL))
);

-- One live image per slot, at each anchor level independently. Partial on
-- retired_at IS NULL so retiring a row frees its slot for the replacement —
-- which is what makes retire-then-replace possible at all.
CREATE UNIQUE INDEX IF NOT EXISTS uq_condition_slot_sku
  ON catalog.condition_image (sku_id, grade, view_code, sort_order)
  WHERE retired_at IS NULL AND sku_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_condition_slot_model
  ON catalog.condition_image (model_id, grade, view_code, sort_order)
  WHERE retired_at IS NULL AND model_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_condition_slot_series
  ON catalog.condition_image (series_id, grade, view_code, sort_order)
  WHERE retired_at IS NULL AND series_id IS NOT NULL;

-- One primary per (anchor, grade) — the hero frame. Three partial indexes
-- rather than COALESCE, because COALESCE collapses to NULL for series rows and
-- a NULL is not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_condition_primary_sku
  ON catalog.condition_image (sku_id, grade)
  WHERE is_primary AND retired_at IS NULL AND sku_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_condition_primary_model
  ON catalog.condition_image (model_id, grade)
  WHERE is_primary AND retired_at IS NULL AND model_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_condition_primary_series
  ON catalog.condition_image (series_id, grade)
  WHERE is_primary AND retired_at IS NULL AND series_id IS NOT NULL;

-- The resolver's read path: anchor + grade, live rows only, in render order.
CREATE INDEX IF NOT EXISTS ix_condition_resolve_sku
  ON catalog.condition_image (sku_id, grade, sort_order) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_condition_resolve_model
  ON catalog.condition_image (model_id, grade, sort_order) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_condition_resolve_series
  ON catalog.condition_image (series_id, grade, sort_order) WHERE retired_at IS NULL;

COMMENT ON TABLE catalog.condition_image IS
  'The platform-owned image library. Vendors upload no photographs — that is what makes "list the model and the serial, we handle the rest" true, and it removes the stock-photo fraud vector. Resolution is sku -> model -> series -> labelled placeholder; a miss must never silently render another grade.';

COMMENT ON COLUMN catalog.condition_image.retired_at IS
  'Retire, never overwrite. Edge caches hold these for a year against an immutable version-hashed URL, and "what did the buyer see on 12 Aug" is a Rule 7(5) question that a mutated row cannot answer.';

-- ==========================================================================
-- 5. catalog.catalog_change_log — Task 6 and exit criterion 9
--
-- DEFECT: sku_id is NOT NULL and it is the only anchor, so an edit to a brand,
-- a series or a model is unloggable — the log physically cannot hold it. And
-- changed_by is NULLABLE, so an actorless row is legal, while the exit
-- criterion requires "every mutation with an actor".
-- ==========================================================================

ALTER TABLE catalog.catalog_change_log
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id   UUID,
  ADD COLUMN IF NOT EXISTS reason      TEXT,
  ADD COLUMN IF NOT EXISTS action      TEXT NOT NULL DEFAULT 'UPDATE';

-- Back-fill the existing rows before tightening: they are all SKU edits.
UPDATE catalog.catalog_change_log
   SET entity_type = 'sku', entity_id = sku_id
 WHERE entity_type IS NULL;

ALTER TABLE catalog.catalog_change_log ALTER COLUMN sku_id DROP NOT NULL;
ALTER TABLE catalog.catalog_change_log ALTER COLUMN entity_type SET NOT NULL;
ALTER TABLE catalog.catalog_change_log ALTER COLUMN entity_id   SET NOT NULL;

ALTER TABLE catalog.catalog_change_log DROP CONSTRAINT IF EXISTS chk_change_log_entity;
ALTER TABLE catalog.catalog_change_log ADD CONSTRAINT chk_change_log_entity
  CHECK (entity_type IN ('brand','series','model','sku','condition_image','grade_definition'));

ALTER TABLE catalog.catalog_change_log DROP CONSTRAINT IF EXISTS chk_change_log_action;
ALTER TABLE catalog.catalog_change_log ADD CONSTRAINT chk_change_log_action
  CHECK (action IN ('CREATE','UPDATE','DEPRECATE','MERGE','RETIRE'));

-- An actorless catalog mutation is not a record of anything. Exit criterion 9.
ALTER TABLE catalog.catalog_change_log ALTER COLUMN changed_by SET NOT NULL;

CREATE INDEX IF NOT EXISTS ix_change_log_entity
  ON catalog.catalog_change_log (entity_type, entity_id, changed_at DESC);

COMMENT ON TABLE catalog.catalog_change_log IS
  'Every catalog mutation, with actor and reason. A SKU spec that changes after units are listed against it is a live data-integrity problem: the listing''s claims change with it, so this is the record of what the catalog said on the day a buyer read it.';

-- ==========================================================================
-- 6. Search — Task 8, CAT-009
--
-- GENERATED ALWAYS, so the vector cannot drift from the row. A trigger-
-- maintained tsvector is one missed UPDATE away from a stale index.
--
-- CAT-009b: the vector contains catalog terms ONLY. No vendor column is
-- reachable from here, which is what keeps vendor anonymity (VR-099) true even
-- through search ranking.
-- ==========================================================================

ALTER TABLE catalog.sku
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(sku_code, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(cpu_model, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(cpu_family, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(cpu_generation, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(ram_gb::text, '') || 'gb'), 'C') ||
    setweight(to_tsvector('simple', coalesce(storage_gb::text, '') || 'gb'), 'C') ||
    setweight(to_tsvector('simple', coalesce(storage_type, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(resolution, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(gpu_model, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(os_supported, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS ix_sku_search ON catalog.sku USING gin (search_tsv);

-- Brand and model rank highest, but they live on other tables. A materialised
-- view carries them so the weighting is one index rather than a join per query.
DROP MATERIALIZED VIEW IF EXISTS catalog.mv_sku_search;
CREATE MATERIALIZED VIEW catalog.mv_sku_search AS
SELECT
  s.id  AS sku_id,
  s.model_id,
  m.series_id,
  se.brand_id,
  b.name  AS brand_name,
  se.name AS series_name,
  m.name  AS model_name,
  m.form_factor,
  s.sku_code,
  s.cpu_family,
  s.cpu_generation,
  s.ram_gb,
  s.storage_gb,
  s.storage_type,
  s.screen_size_inch,
  s.is_active,
  setweight(to_tsvector('simple', b.name), 'A') ||
  setweight(to_tsvector('simple', m.name), 'A') ||
  setweight(to_tsvector('simple', se.name), 'A') ||
  s.search_tsv AS search_tsv
FROM catalog.sku s
JOIN catalog.model  m  ON m.id  = s.model_id
JOIN catalog.series se ON se.id = m.series_id
JOIN catalog.brand  b  ON b.id  = se.brand_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_sku_search ON catalog.mv_sku_search (sku_id);
CREATE INDEX IF NOT EXISTS ix_mv_sku_search_tsv ON catalog.mv_sku_search USING gin (search_tsv);
CREATE INDEX IF NOT EXISTS ix_mv_sku_facets
  ON catalog.mv_sku_search (brand_id, cpu_family, ram_gb, storage_gb, screen_size_inch)
  WHERE is_active;

-- Typo tolerance on model names — "latitide 5420" must still find it.
CREATE INDEX IF NOT EXISTS ix_model_name_trgm
  ON catalog.model USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_brand_name_trgm
  ON catalog.brand USING gin (name gin_trgm_ops);

COMMENT ON MATERIALIZED VIEW catalog.mv_sku_search IS
  'Denormalised search and facet source. CAT-009b: contains catalog columns only — no vendor column is reachable from here, so search ranking cannot leak vendor identity.';

-- ==========================================================================
-- 7. Missing indexes and housekeeping
-- ==========================================================================

CREATE INDEX IF NOT EXISTS ix_sku_image_sku ON catalog.sku_image (sku_id);
CREATE INDEX IF NOT EXISTS ix_series_brand  ON catalog.series (brand_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS ix_model_series  ON catalog.model (series_id) WHERE is_active;

COMMENT ON TABLE catalog.sku_image IS
  'SUPERSEDED by catalog.condition_image for anything a buyer sees. Its six marketing view codes (FRONT/OPEN/LEFT/RIGHT/KEYBOARD/PORTS) do not map onto the ten condition view codes — only KEYBOARD is common — so do not migrate rows between them. Retained for the model-page hero shot only.';

-- catalog.sku gained updated_at above; attach the shared trigger.
SELECT ops.attach_updated_at_triggers();

-- ==========================================================================
-- 8. The change log joins the append-only set
--
-- The list inside apply_append_only_grants() is hard-coded, so adding a table
-- means redefining the function — calling it as-is would silently do nothing
-- for catalog. The catalog is the basis of every listing claim, so its history
-- is evidence: an engineer must not be able to "just fix" a row in it.
-- ==========================================================================

CREATE OR REPLACE FUNCTION ops.apply_append_only_grants(p_role TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
  v_role TEXT := COALESCE(p_role, current_user);
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('identity','audit_log'),
      ('identity','password_history'),
      ('payment','ledger_entry'),
      ('listing','stock_movement'),
      ('logistics','custody_event'),
      ('kyc','consent_record'),
      ('kyc','verification_check'),
      ('kyc','blacklist_hit'),
      ('catalog','catalog_change_log')
    ) AS t(sch, tbl)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = r.sch AND table_name = r.tbl) THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON %I.%I FROM %I', r.sch, r.tbl, v_role);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN format('append-only REVOKEs applied to %s tables for %s', v_count, v_role);
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.apply_append_only_grants IS
  'Re-applies the append-only REVOKEs. verification_check joined in Phase 1: an attempt history you can edit is not a history. catalog_change_log joined in Phase 2: it is what answers "what did the catalog say on the day the buyer read it". procurement.tds_ledger joins in Phase 7.';

SELECT ops.apply_append_only_grants();
