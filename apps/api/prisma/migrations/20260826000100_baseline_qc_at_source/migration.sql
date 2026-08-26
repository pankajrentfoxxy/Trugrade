-- ##########################################################################
-- BASELINE (2/2) — the QC-at-source model (v3), adopted verbatim.
--
-- Source: docs/legacy/truetech_schema_migration_v3_qc_at_source.sql (17 tables).
-- Vendor-site QC is canonical; the hub-batch path is deprecated in the
-- hardening migration that follows, not here.
--
-- The BEGIN/COMMIT pairs in this file are load-bearing: Postgres will not let a
-- new enum value be *used* in the transaction that added it, so the ALTER TYPE
-- block must commit before the tables that reference those values are created.
-- ##########################################################################

-- ##########################################################################
-- TrueTech Marketplace — MIGRATION v3
-- "QC at source": inspection moves from the hub (post-order)
--                 to the vendor's premises (at listing time)
--
-- Apply after truetech_complete_schema.sql
--   psql -d truetech_prod -f truetech_schema_migration_v3_qc_at_source.sql
--
-- WHAT CHANGES
--   1. A listing is not sellable until every unit in it has passed QC
--   2. QC happens at the vendor site, performed by a field technician
--      running a licensed third-party diagnostic tool
--   3. Each inspected unit is sealed; the seal is the anti-swap control
--      for the gap between inspection and dispatch
--   4. A QC report expires (default 90 days) because battery health moves
--   5. Dispatch can now go direct vendor -> buyer, or via a hub, decided
--      by rule rather than always routing through Gurugram
-- ##########################################################################

BEGIN;

-- ==========================================================================
-- 1. NEW ENUM TYPES
-- ==========================================================================
CREATE TYPE public.qc_location_type AS ENUM ('VENDOR_SITE','HUB','BUYER_SITE','THIRD_PARTY_LAB');
CREATE TYPE public.qc_visit_status  AS ENUM (
  'REQUESTED','QUOTED','SCHEDULED','TECH_ASSIGNED','EN_ROUTE','IN_PROGRESS',
  'COMPLETED','PARTIALLY_COMPLETED','CANCELLED','NO_SHOW_VENDOR','NO_SHOW_TECH','RESCHEDULED');
CREATE TYPE public.seal_status      AS ENUM ('APPLIED','INTACT','BROKEN','MISSING','REPLACED');
CREATE TYPE public.route_type       AS ENUM ('DIRECT','VIA_HUB','CONSOLIDATED');
CREATE TYPE public.qc_unit_outcome  AS ENUM (
  'PENDING','PASS','PASS_GRADE_CORRECTED','PASS_WITH_NOTE','FAIL','UNTESTABLE','ABSENT');

-- New unit statuses for the pre-sale QC lifecycle
ALTER TYPE public.unit_status ADD VALUE IF NOT EXISTS 'AWAITING_QC'      BEFORE 'LISTED';
ALTER TYPE public.unit_status ADD VALUE IF NOT EXISTS 'QC_SCHEDULED'     BEFORE 'LISTED';
ALTER TYPE public.unit_status ADD VALUE IF NOT EXISTS 'QC_SEALED'        BEFORE 'LISTED';
ALTER TYPE public.unit_status ADD VALUE IF NOT EXISTS 'QC_EXPIRED'       AFTER  'QC_FAILED';
ALTER TYPE public.unit_status ADD VALUE IF NOT EXISTS 'SEAL_BROKEN'      AFTER  'QC_EXPIRED';

-- New listing statuses
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'AWAITING_QC'      AFTER 'DRAFT';
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'QC_IN_PROGRESS'   AFTER 'AWAITING_QC';
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'PARTIALLY_ACTIVE' AFTER 'ACTIVE';

COMMIT;
BEGIN;

-- ==========================================================================
-- 2. QC TOOLING — which third-party diagnostic product produced the report
-- ==========================================================================
CREATE TABLE qc.qc_tool_provider (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT UNIQUE NOT NULL,          -- PHONECHECK / BLANCCO / AIDEN / TT_AGENT
  name                TEXT NOT NULL,
  vendor_company      TEXT,
  integration_type    TEXT NOT NULL CHECK (integration_type IN ('API','WEBHOOK','FILE_IMPORT','MANUAL_ENTRY')),
  report_format       TEXT NOT NULL CHECK (report_format IN ('JSON','XML','PDF','CSV')),
  field_map_json      JSONB NOT NULL,
  supports_wipe       BOOLEAN NOT NULL DEFAULT FALSE,
  wipe_standard       TEXT,
  licence_expiry      DATE,
  licence_seats       INT,
  cost_per_scan_paise INT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN qc.qc_tool_provider.field_map_json IS
  'Maps the tool''s own field names onto our qc_hardware_detected columns. Swapping tools is a config change, not a rewrite.';
COMMENT ON COLUMN qc.qc_tool_provider.licence_seats IS
  'Concurrent seats we have paid for. Scheduling must not assign more technicians than seats.';

-- ==========================================================================
-- 3. FIELD TECHNICIANS
-- ==========================================================================
CREATE TABLE qc.qc_technician (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID UNIQUE NOT NULL REFERENCES identity.user_account(id),
  employee_code         TEXT UNIQUE NOT NULL,
  home_pincode          CHAR(6) NOT NULL,
  zones                 TEXT[] NOT NULL,
  certified_tools       TEXT[] NOT NULL,
  device_cert_id        TEXT UNIQUE,
  daily_capacity_units  INT NOT NULL DEFAULT 40,
  max_sites_per_day     INT NOT NULL DEFAULT 3,
  employment_type       TEXT NOT NULL DEFAULT 'INHOUSE'
                        CHECK (employment_type IN ('INHOUSE','CONTRACT','PARTNER')),
  divergence_rate       NUMERIC(5,2),
  units_inspected_total INT NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_tech_zone ON qc.qc_technician USING gin (zones) WHERE is_active;
COMMENT ON COLUMN qc.qc_technician.divergence_rate IS
  'How often a 5% audit re-check disagrees with this technician. Rising divergence is retrained, not ignored.';

CREATE TABLE qc.technician_availability (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES qc.qc_technician(id) ON DELETE CASCADE,
  the_date     DATE NOT NULL,
  slot_from    TIME NOT NULL,
  slot_to      TIME NOT NULL,
  status       TEXT NOT NULL DEFAULT 'AVAILABLE'
               CHECK (status IN ('AVAILABLE','BOOKED','LEAVE','TRAVEL','HOLIDAY')),
  note         TEXT,
  UNIQUE (technician_id, the_date, slot_from)
);
CREATE INDEX ix_tech_avail ON qc.technician_availability (the_date, status);

-- ==========================================================================
-- 4. THE QC VISIT — one technician, one vendor site, one day
-- ==========================================================================
CREATE TABLE qc.qc_visit (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_number         TEXT UNIQUE NOT NULL,
  vendor_org_id        UUID NOT NULL REFERENCES identity.organization(id),
  facility_id          UUID NOT NULL REFERENCES vendor.vendor_facility(id),
  address_id           UUID NOT NULL REFERENCES identity.org_address(id),
  requested_by         UUID REFERENCES identity.user_account(id),
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  units_requested      INT NOT NULL,
  units_presented      INT,
  units_inspected      INT NOT NULL DEFAULT 0,
  units_passed         INT NOT NULL DEFAULT 0,
  units_grade_corrected INT NOT NULL DEFAULT 0,
  units_failed         INT NOT NULL DEFAULT 0,
  units_absent         INT NOT NULL DEFAULT 0,

  technician_id        UUID REFERENCES qc.qc_technician(id),
  tool_provider_id     UUID REFERENCES qc.qc_tool_provider(id),
  scheduled_date       DATE,
  slot_from            TIME,
  slot_to              TIME,
  status               public.qc_visit_status NOT NULL DEFAULT 'REQUESTED',

  arrived_at           TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  arrival_geo_lat      NUMERIC(9,6),
  arrival_geo_lng      NUMERIC(9,6),
  geo_variance_metres  INT,

  vendor_contact_id    UUID REFERENCES identity.org_contact(id),
  vendor_otp_hash      TEXT,
  vendor_signoff_at    TIMESTAMPTZ,
  vendor_signoff_name  TEXT,

  visit_fee            NUMERIC(14,2) NOT NULL DEFAULT 0,
  fee_bearer           TEXT NOT NULL DEFAULT 'TRUETECH'
                       CHECK (fee_bearer IN ('TRUETECH','VENDOR','SPLIT','WAIVED')),
  fee_waiver_reason    TEXT,
  reschedule_count     INT NOT NULL DEFAULT 0,
  cancellation_reason  TEXT,
  notes                TEXT,

  CONSTRAINT chk_visit_min CHECK (units_requested > 0)
);
CREATE INDEX ix_visit_vendor  ON qc.qc_visit (vendor_org_id, status);
CREATE INDEX ix_visit_tech    ON qc.qc_visit (technician_id, scheduled_date);
CREATE INDEX ix_visit_pending ON qc.qc_visit (status, requested_at) WHERE status IN ('REQUESTED','QUOTED');
COMMENT ON COLUMN qc.qc_visit.geo_variance_metres IS
  'Distance between where the technician checked in and the registered facility address. A large variance is a fraud signal, not a rounding error.';

-- Which units are on the manifest for this visit
CREATE TABLE qc.qc_visit_unit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id       UUID NOT NULL REFERENCES qc.qc_visit(id) ON DELETE CASCADE,
  unit_id        UUID NOT NULL REFERENCES listing.unit(id),
  serial_number  TEXT NOT NULL,
  listing_id     UUID REFERENCES listing.listing(id),
  sequence_no    INT,
  outcome        public.qc_unit_outcome NOT NULL DEFAULT 'PENDING',
  qc_report_id   UUID REFERENCES qc.qc_report(id),
  absent_reason  TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  duration_seconds INT,
  UNIQUE (visit_id, unit_id)
);
CREATE INDEX ix_visitunit_unit ON qc.qc_visit_unit (unit_id);

-- Travel and expense per visit — the economics of field QC live here
CREATE TABLE qc.qc_visit_expense (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id       UUID NOT NULL REFERENCES qc.qc_visit(id) ON DELETE CASCADE,
  expense_type   TEXT NOT NULL CHECK (expense_type IN
                 ('TRAVEL','FUEL','TOLL','PARKING','FOOD','ACCOMMODATION','TOOL_LICENCE','OTHER')),
  amount         NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  distance_km    NUMERIC(8,2),
  receipt_key    TEXT,
  approved_by    UUID REFERENCES identity.user_account(id),
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- 5. RAW TOOL OUTPUT — stored before we interpret it
-- ==========================================================================
CREATE TABLE qc.qc_tool_run (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_unit_id      UUID REFERENCES qc.qc_visit_unit(id) ON DELETE CASCADE,
  unit_id            UUID NOT NULL REFERENCES listing.unit(id),
  tool_provider_id   UUID NOT NULL REFERENCES qc.qc_tool_provider(id),
  tool_version       TEXT NOT NULL,
  tool_run_id        TEXT,
  device_cert_id     TEXT NOT NULL,
  raw_report_key     TEXT,
  raw_report_json    JSONB,
  raw_report_hash    TEXT NOT NULL,
  parse_status       TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (parse_status IN ('PENDING','PARSED','PARSE_FAILED','MANUAL_ENTRY')),
  parse_error        TEXT,
  serial_from_tool   TEXT,
  serial_matches     BOOLEAN,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  signature          TEXT,
  nonce              TEXT UNIQUE,
  ingested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tool_provider_id, tool_run_id)
);
CREATE INDEX ix_toolrun_unit  ON qc.qc_tool_run (unit_id, ingested_at DESC);
CREATE INDEX ix_toolrun_parse ON qc.qc_tool_run (parse_status) WHERE parse_status IN ('PENDING','PARSE_FAILED');
COMMENT ON TABLE qc.qc_tool_run IS
  'The third-party tool''s own output, kept verbatim. We parse it into qc_report, but the original survives so a disputed reading can be re-examined against what the tool actually said.';
COMMENT ON COLUMN qc.qc_tool_run.serial_matches IS
  'The serial the tool read from the machine versus the serial on the manifest. FALSE is an immediate stop — the label does not belong to the laptop.';

-- ==========================================================================
-- 6. SEALS — the anti-swap control between inspection and dispatch
-- ==========================================================================
CREATE TABLE qc.qc_seal (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seal_code         TEXT UNIQUE NOT NULL,
  unit_id           UUID NOT NULL REFERENCES listing.unit(id),
  qc_report_id      UUID NOT NULL REFERENCES qc.qc_report(id),
  applied_by        UUID NOT NULL REFERENCES qc.qc_technician(id),
  applied_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_photo_key TEXT NOT NULL,
  status            public.seal_status NOT NULL DEFAULT 'APPLIED',
  verified_at       TIMESTAMPTZ,
  verified_by       UUID REFERENCES identity.user_account(id),
  verified_photo_key TEXT,
  broken_at         TIMESTAMPTZ,
  broken_reason     TEXT,
  replaced_by_seal_id UUID REFERENCES qc.qc_seal(id)
);
CREATE INDEX ix_seal_unit ON qc.qc_seal (unit_id, status);
COMMENT ON TABLE qc.qc_seal IS
  'A numbered tamper-evident seal is applied the moment a unit passes QC at the vendor site. Every later handover verifies the code and photographs it. A broken seal sends the unit back to QC before it can ship.';

-- ==========================================================================
-- 7. RE-VERIFICATION — the 2-minute check at pickup, not a full re-inspection
-- ==========================================================================
CREATE TABLE qc.qc_reverification (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id           UUID NOT NULL REFERENCES listing.unit(id),
  original_report_id UUID NOT NULL REFERENCES qc.qc_report(id),
  trigger           TEXT NOT NULL CHECK (trigger IN
                    ('DISPATCH_PICKUP','SEAL_BROKEN','QC_EXPIRED','RANDOM_AUDIT','BUYER_DISPUTE','VENDOR_REQUEST')),
  method            TEXT NOT NULL CHECK (method IN ('SEAL_CHECK','QUICK_SCAN','FULL_RESCAN')),
  performed_by      UUID REFERENCES identity.user_account(id),
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  seal_code_scanned TEXT,
  seal_intact       BOOLEAN,
  serial_scanned    TEXT,
  serial_matches    BOOLEAN,
  fingerprint_hash  TEXT,
  fingerprint_matches BOOLEAN,
  outcome           TEXT NOT NULL CHECK (outcome IN ('PASS','FAIL_RESEND_TO_QC','FAIL_REJECT','ESCALATE')),
  photo_keys        TEXT[],
  notes             TEXT
);
CREATE INDEX ix_reverif_unit ON qc.qc_reverification (unit_id, performed_at DESC);

-- ==========================================================================
-- 8. SAMPLING RULES — not every vendor needs 100% inspection forever
-- ==========================================================================
CREATE TABLE qc.qc_sampling_rule (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_tier           public.vendor_tier,
  min_units_inspected   INT NOT NULL DEFAULT 0,
  min_pass_rate         NUMERIC(5,2),
  min_grade_accuracy    NUMERIC(5,2),
  sample_pct            INT NOT NULL CHECK (sample_pct BETWEEN 1 AND 100),
  always_full_above_value NUMERIC(14,2),
  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE qc.qc_sampling_rule IS
  'A Platinum vendor with 5,000 units inspected at 99% accuracy does not need every machine opened. Sampling is earned, revoked on any failure, and never applies above a value threshold.';

-- ==========================================================================
-- 9. ALTERATIONS TO qc.qc_report
-- ==========================================================================
ALTER TABLE qc.qc_report
  ADD COLUMN visit_id          UUID REFERENCES qc.qc_visit(id),
  ADD COLUMN tool_run_id       UUID REFERENCES qc.qc_tool_run(id),
  ADD COLUMN location_type     public.qc_location_type NOT NULL DEFAULT 'VENDOR_SITE',
  ADD COLUMN location_address_id UUID REFERENCES identity.org_address(id),
  ADD COLUMN valid_until       DATE,
  ADD COLUMN superseded_by_id  UUID REFERENCES qc.qc_report(id),
  ADD COLUMN is_current        BOOLEAN NOT NULL DEFAULT TRUE,
  ALTER COLUMN batch_id DROP NOT NULL;

CREATE INDEX ix_qcrep_visit   ON qc.qc_report (visit_id);
CREATE INDEX ix_qcrep_expiry  ON qc.qc_report (valid_until) WHERE is_current;
CREATE UNIQUE INDEX uq_qcrep_current ON qc.qc_report (unit_id) WHERE is_current;

COMMENT ON COLUMN qc.qc_report.valid_until IS
  'QC reports expire, default 90 days. Battery health and storage wear move; a six-month-old report is a claim we can no longer stand behind.';
COMMENT ON COLUMN qc.qc_report.is_current IS
  'Exactly one current report per unit, enforced by a partial unique index. Re-inspections supersede rather than replace, so history survives.';

-- ==========================================================================
-- 10. GRADE CORRECTION — the central win of inspecting before sale
-- ==========================================================================
CREATE TABLE listing.grade_correction (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id           UUID NOT NULL REFERENCES listing.unit(id),
  listing_id        UUID REFERENCES listing.listing(id),
  qc_report_id      UUID NOT NULL REFERENCES qc.qc_report(id),
  grade_declared    public.grade_type NOT NULL,
  grade_corrected   public.grade_type NOT NULL,
  reason            TEXT NOT NULL,
  price_before      NUMERIC(14,2),
  price_suggested   NUMERIC(14,2),
  vendor_notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  vendor_response   TEXT CHECK (vendor_response IN
                    ('ACCEPT_NEW_GRADE','ACCEPT_AND_REPRICE','WITHDRAW_UNIT','DISPUTE')),
  vendor_responded_at TIMESTAMPTZ,
  auto_applied_at   TIMESTAMPTZ,
  counts_against_accuracy BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_actually_different CHECK (grade_declared <> grade_corrected)
);
CREATE INDEX ix_gradecorr_unit   ON listing.grade_correction (unit_id);
CREATE INDEX ix_gradecorr_vendor ON listing.grade_correction (listing_id, vendor_notified_at DESC);
COMMENT ON TABLE listing.grade_correction IS
  'Because inspection now happens before a buyer exists, a wrong grade is corrected quietly instead of becoming a mid-order dispute. It still counts against the vendor''s grade accuracy score.';

-- ==========================================================================
-- 11. ALTERATIONS TO listing.unit AND listing.listing
-- ==========================================================================
ALTER TABLE listing.unit
  ADD COLUMN qc_visit_id       UUID REFERENCES qc.qc_visit(id),
  ADD COLUMN qc_passed_at      TIMESTAMPTZ,
  ADD COLUMN qc_valid_until    DATE,
  ADD COLUMN qc_score          INT CHECK (qc_score BETWEEN 0 AND 100),
  ADD COLUMN seal_id           UUID REFERENCES qc.qc_seal(id),
  ADD COLUMN sealed_at         TIMESTAMPTZ,
  ADD COLUMN battery_health_pct NUMERIC(5,2),
  ADD COLUMN is_sellable       BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX ix_unit_sellable ON listing.unit (listing_id) WHERE is_sellable;
CREATE INDEX ix_unit_qcexpiry ON listing.unit (qc_valid_until) WHERE is_sellable;
COMMENT ON COLUMN listing.unit.is_sellable IS
  'TRUE only when: QC passed, seal applied and intact, QC not expired, unit not reserved elsewhere. A buyer can only ever be shown units where this is TRUE.';

ALTER TABLE listing.listing
  ADD COLUMN qc_requested_at    TIMESTAMPTZ,
  ADD COLUMN qc_completed_at    TIMESTAMPTZ,
  ADD COLUMN qty_awaiting_qc    INT NOT NULL DEFAULT 0,
  ADD COLUMN qty_qc_failed      INT NOT NULL DEFAULT 0,
  ADD COLUMN grade_corrected_from public.grade_type,
  ADD COLUMN qc_visit_id        UUID REFERENCES qc.qc_visit(id);

-- The balance rule now has to account for units still waiting on inspection
ALTER TABLE listing.listing DROP CONSTRAINT chk_qty_balance;
ALTER TABLE listing.listing ADD CONSTRAINT chk_qty_balance
  CHECK (qty_available + qty_reserved + qty_awaiting_qc + qty_qc_failed <= qty_total);

-- ==========================================================================
-- 12. DISPATCH ROUTING
-- ==========================================================================
CREATE TABLE logistics.routing_rule (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  priority              INT NOT NULL,
  name                  TEXT NOT NULL,
  from_is_ncr           BOOLEAN,
  to_is_ncr             BOOLEAN,
  same_city             BOOLEAN,
  min_units             INT,
  max_units             INT,
  min_value             NUMERIC(14,2),
  max_value             NUMERIC(14,2),
  min_vendor_tier       public.vendor_tier,
  seal_must_be_intact   BOOLEAN NOT NULL DEFAULT TRUE,
  multi_vendor_order    BOOLEAN,
  route_type            public.route_type NOT NULL,
  carrier_code          TEXT NOT NULL,
  fallback_carrier_code TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX ix_routing_priority ON logistics.routing_rule (priority) WHERE is_active;
COMMENT ON TABLE logistics.routing_rule IS
  'Evaluated in priority order; the first match wins. Ops tunes routing without a code release.';

CREATE TABLE logistics.carrier_rate_card (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id     UUID NOT NULL REFERENCES logistics.carrier(id),
  from_zone      TEXT NOT NULL,
  to_zone        TEXT NOT NULL,
  weight_from_kg NUMERIC(8,2) NOT NULL,
  weight_to_kg   NUMERIC(8,2) NOT NULL,
  base_rate      NUMERIC(14,2) NOT NULL,
  per_kg_rate    NUMERIC(14,2) NOT NULL DEFAULT 0,
  fuel_surcharge_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  oda_surcharge  NUMERIC(14,2) NOT NULL DEFAULT 0,
  insurance_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  min_charge     NUMERIC(14,2) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL,
  effective_to   DATE
);
CREATE INDEX ix_ratecard ON logistics.carrier_rate_card (carrier_id, from_zone, to_zone, weight_from_kg);

CREATE TABLE logistics.vehicle (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_no TEXT UNIQUE NOT NULL,
  vehicle_type    TEXT NOT NULL CHECK (vehicle_type IN ('BIKE','TEMPO','VAN','TRUCK')),
  capacity_units  INT NOT NULL,
  owned_by        TEXT NOT NULL DEFAULT 'INHOUSE' CHECK (owned_by IN ('INHOUSE','PARTNER','RENTED')),
  insurance_valid_to DATE,
  puc_valid_to    DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE logistics.route_plan (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date      DATE NOT NULL,
  rider_id       UUID REFERENCES logistics.rider(id),
  technician_id  UUID REFERENCES qc.qc_technician(id),
  vehicle_id     UUID REFERENCES logistics.vehicle(id),
  zone           TEXT NOT NULL,
  purpose        TEXT NOT NULL CHECK (purpose IN ('PICKUP','DELIVERY','QC_VISIT','MIXED')),
  total_stops    INT NOT NULL DEFAULT 0,
  completed_stops INT NOT NULL DEFAULT 0,
  planned_distance_km NUMERIC(8,2),
  actual_distance_km  NUMERIC(8,2),
  status         TEXT NOT NULL DEFAULT 'PLANNED'
                 CHECK (status IN ('PLANNED','DISPATCHED','IN_PROGRESS','COMPLETED','ABANDONED')),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  CONSTRAINT chk_route_owner CHECK ((rider_id IS NULL) <> (technician_id IS NULL))
);
CREATE INDEX ix_routeplan ON logistics.route_plan (plan_date, zone, status);

CREATE TABLE logistics.route_stop (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_plan_id  UUID NOT NULL REFERENCES logistics.route_plan(id) ON DELETE CASCADE,
  sequence_no    INT NOT NULL,
  stop_type      TEXT NOT NULL CHECK (stop_type IN ('PICKUP','DELIVERY','QC_VISIT','HUB_DROP','HUB_COLLECT')),
  address_id     UUID NOT NULL REFERENCES identity.org_address(id),
  pickup_task_id UUID REFERENCES logistics.pickup_task(id),
  delivery_task_id UUID REFERENCES logistics.delivery_task(id),
  qc_visit_id    UUID REFERENCES qc.qc_visit(id),
  eta            TIMESTAMPTZ,
  arrived_at     TIMESTAMPTZ,
  departed_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','ARRIVED','COMPLETED','SKIPPED','FAILED')),
  skip_reason    TEXT,
  UNIQUE (route_plan_id, sequence_no)
);

CREATE TABLE logistics.delivery_attempt (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_task_id UUID NOT NULL REFERENCES logistics.delivery_task(id) ON DELETE CASCADE,
  attempt_no       INT NOT NULL,
  attempted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome          TEXT NOT NULL CHECK (outcome IN
                   ('DELIVERED','CONSIGNEE_UNAVAILABLE','ADDRESS_NOT_FOUND','REFUSED',
                    'GATE_PASS_MISSING','OFFICE_CLOSED','PARTIAL_ACCEPTED','RESCHEDULED')),
  reason_note      TEXT,
  next_attempt_on  DATE,
  photo_keys       TEXT[],
  geo_lat          NUMERIC(9,6),
  geo_lng          NUMERIC(9,6),
  UNIQUE (delivery_task_id, attempt_no)
);
COMMENT ON TABLE logistics.delivery_attempt IS
  'Three failed attempts triggers an RTO decision. Reasons are structured because "office closed" is our scheduling problem while "refused" is a commercial one.';

-- ==========================================================================
-- 13. ALTERATIONS TO logistics.shipment AND pickup_task
-- ==========================================================================
ALTER TABLE logistics.shipment
  ADD COLUMN route_type        public.route_type NOT NULL DEFAULT 'VIA_HUB',
  ADD COLUMN routing_rule_id   UUID REFERENCES logistics.routing_rule(id),
  ADD COLUMN seal_verified_at  TIMESTAMPTZ,
  ADD COLUMN seal_verified_by  UUID REFERENCES identity.user_account(id),
  ADD COLUMN quoted_freight    NUMERIC(14,2),
  ADD COLUMN rate_card_id      UUID REFERENCES logistics.carrier_rate_card(id),
  ADD COLUMN eta_from          TIMESTAMPTZ,
  ADD COLUMN eta_to            TIMESTAMPTZ;

COMMENT ON COLUMN logistics.shipment.route_type IS
  'DIRECT ships vendor to buyer without touching a hub — only possible because QC already happened at source. VIA_HUB is used when the seal is broken, the vendor is new, or the order spans several vendors.';

ALTER TABLE logistics.pickup_task
  ADD COLUMN expected_seals    TEXT[],
  ADD COLUMN scanned_seals     TEXT[],
  ADD COLUMN seals_intact      BOOLEAN,
  ADD COLUMN broken_seal_codes TEXT[],
  ADD COLUMN route_stop_id     UUID REFERENCES logistics.route_stop(id);

-- ==========================================================================
-- 14. INTEGRITY VIEWS
-- ==========================================================================

-- A unit is only sellable if every condition still holds. Drift here means
-- we are showing a buyer something we cannot actually ship.
CREATE OR REPLACE VIEW listing.v_sellability_drift AS
SELECT u.id AS unit_id, u.serial_number, u.listing_id, u.is_sellable,
       (u.status = 'LISTED')                       AS status_ok,
       (u.qc_passed_at IS NOT NULL)                AS qc_done,
       (u.qc_valid_until >= CURRENT_DATE)          AS qc_fresh,
       (s.status = 'APPLIED' OR s.status = 'INTACT') AS seal_ok
FROM listing.unit u
LEFT JOIN qc.qc_seal s ON s.id = u.seal_id
WHERE u.is_sellable <> (
        u.status = 'LISTED'
    AND u.qc_passed_at IS NOT NULL
    AND u.qc_valid_until >= CURRENT_DATE
    AND s.status IN ('APPLIED','INTACT')
);

-- Inspections that expire within 14 days, so we can re-visit before stock dies
CREATE OR REPLACE VIEW qc.v_expiring_qc AS
SELECT u.vendor_org_id, o.legal_name, u.listing_id,
       COUNT(*) AS units_expiring,
       MIN(u.qc_valid_until) AS earliest_expiry
FROM listing.unit u
JOIN identity.organization o ON o.id = u.vendor_org_id
WHERE u.is_sellable
  AND u.qc_valid_until <= CURRENT_DATE + 14
GROUP BY u.vendor_org_id, o.legal_name, u.listing_id;

-- The economics of every visit: cost per inspected unit
CREATE OR REPLACE VIEW qc.v_visit_economics AS
SELECT v.id, v.visit_number, v.vendor_org_id, v.scheduled_date,
       v.units_requested, v.units_inspected, v.units_passed, v.units_failed,
       COALESCE(SUM(e.amount), 0) AS total_expense,
       CASE WHEN v.units_inspected > 0
            THEN ROUND(COALESCE(SUM(e.amount),0) / v.units_inspected, 2)
       END AS cost_per_unit,
       EXTRACT(EPOCH FROM (v.completed_at - v.started_at))/3600 AS hours_on_site
FROM qc.qc_visit v
LEFT JOIN qc.qc_visit_expense e ON e.visit_id = v.id
WHERE v.status = 'COMPLETED'
GROUP BY v.id;

-- ==========================================================================
-- 15. SEED DATA
-- ==========================================================================
INSERT INTO qc.qc_tool_provider
  (code, name, vendor_company, integration_type, report_format, field_map_json,
   supports_wipe, wipe_standard, cost_per_scan_paise, is_active) VALUES
  ('PHONECHECK','Phonecheck Laptop Diagnostics','Phonecheck LLC','API','JSON',
   '{"serial":"device.serial","ram_gb":"specs.memory_gb","storage_gb":"specs.storage_gb","battery_health_pct":"battery.health","cycle_count":"battery.cycles","smart_status":"storage.smart"}',
   TRUE,'NIST_800_88_PURGE', 4500, TRUE),
  ('BLANCCO','Blancco Drive Eraser + Diagnostics','Blancco Technology Group','FILE_IMPORT','XML',
   '{"serial":"Report.Serial","ram_gb":"Report.Memory","storage_gb":"Report.Disk.Capacity","battery_health_pct":"Report.Battery.Health"}',
   TRUE,'NIST_800_88_PURGE', 6200, TRUE),
  ('TT_AGENT','TrueTech in-house USB agent','TrueTech','API','JSON',
   '{"serial":"hw.serial","ram_gb":"hw.ram_gb","storage_gb":"hw.storage_gb","battery_health_pct":"battery.health_pct"}',
   TRUE,'NIST_800_88_PURGE', 0, FALSE);

INSERT INTO qc.qc_sampling_rule
  (vendor_tier, min_units_inspected, min_pass_rate, min_grade_accuracy, sample_pct, always_full_above_value) VALUES
  ('WATCHLIST',    0,  NULL, NULL, 100, 0),
  ('BRONZE',       0,  NULL, NULL, 100, 0),
  ('SILVER',     500, 95.0, 96.0,  100, 0),
  ('GOLD',      2000, 97.0, 98.0,   50, 5000000),
  ('PLATINUM',  5000, 98.5, 99.0,   25, 5000000);

INSERT INTO logistics.routing_rule
  (priority, name, from_is_ncr, to_is_ncr, same_city, min_units, max_units,
   min_value, max_value, min_vendor_tier, seal_must_be_intact, multi_vendor_order,
   route_type, carrier_code, fallback_carrier_code) VALUES
  (10,'Broken seal always goes through the hub',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, NULL,
      'VIA_HUB','INHOUSE','BLUEDART'),
  (20,'Multi-vendor order consolidates at the hub',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, TRUE, TRUE,
      'CONSOLIDATED','INHOUSE','BLUEDART'),
  (30,'New or watchlist vendor ships through the hub',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'BRONZE', TRUE, FALSE,
      'VIA_HUB','INHOUSE','BLUEDART'),
  (40,'High value goes through the hub regardless',
      NULL, NULL, NULL, NULL, NULL, 2000000, NULL, NULL, TRUE, FALSE,
      'VIA_HUB','INHOUSE','BLUEDART'),
  (50,'Both ends in NCR: our own field executives, direct',
      TRUE, TRUE, NULL, NULL, NULL, NULL, NULL, 'SILVER', TRUE, FALSE,
      'DIRECT','INHOUSE','PORTER'),
  (60,'Same city, bulk: Porter',
      NULL, NULL, TRUE, 20, NULL, NULL, NULL, 'SILVER', TRUE, FALSE,
      'DIRECT','PORTER','INHOUSE'),
  (70,'Everything else: courier, direct',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'SILVER', TRUE, FALSE,
      'DIRECT','BLUEDART','PORTER'),
  (99,'Catch-all: via hub',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, TRUE, NULL,
      'VIA_HUB','INHOUSE','BLUEDART');

INSERT INTO platform.platform_config (key, value_json) VALUES
  ('qc.location_model',            '"VENDOR_SITE"'),
  ('qc.report_validity_days',      '90'),
  ('qc.min_units_per_visit',       '25'),
  ('qc.visit_fee_inr',             '1500'),
  ('qc.visit_fee_waived_above',    '50'),
  ('qc.reverification_method',     '"SEAL_CHECK"'),
  ('qc.geo_variance_alert_metres', '500'),
  ('qc.audit_recheck_pct',         '5'),
  ('qc.grade_correction_auto_days','2'),
  ('dispatch.direct_allowed',      'true'),
  ('dispatch.rto_after_attempts',  '3'),
  ('logistics.max_stops_per_route','8');

COMMIT;

-- ##########################################################################
-- POST-MIGRATION CHECKS
--
--   -- No sellable unit without a current, unexpired QC report and an intact seal
--   SELECT COUNT(*) FROM listing.v_sellability_drift;          -- expect 0
--
--   -- Exactly one current QC report per unit
--   SELECT unit_id, COUNT(*) FROM qc.qc_report WHERE is_current
--   GROUP BY unit_id HAVING COUNT(*) > 1;                      -- expect 0 rows
--
--   -- Routing rules must end with a catch-all
--   SELECT * FROM logistics.routing_rule
--   WHERE priority = 99 AND is_active;                         -- expect 1 row
-- ##########################################################################
