-- Phase 3 — Vendor listings, units, serials and pricing.
--
-- Most of Phase 3's DDL already landed in 20260828000000_retrofit: the seven
-- merchant-of-record columns on listing.unit, both immutability triggers,
-- margin_rule with its warranty columns, price_history, stock_movement,
-- v_stock_drift, the tier-price EXCLUDE, and vendor_warranty_months/scope.
-- This migration closes what is left.

-- ---------------------------------------------------------------------------
-- 1. The counter hole
-- ---------------------------------------------------------------------------
-- The retrofit widened chk_qty_balance to include qty_awaiting_qc and
-- qty_qc_failed but left chk_qty_nonneg naming only the original three. A
-- negative value in either new counter therefore passes BOTH checks and makes
-- the balance inequality easier to satisfy -- which is precisely how a counter
-- bug turns into an oversell. Same class of failure as a partial index that
-- never matches: the constraint is present and accepts the bad row.
ALTER TABLE listing.listing DROP CONSTRAINT chk_qty_nonneg;
ALTER TABLE listing.listing ADD CONSTRAINT chk_qty_nonneg CHECK (
  qty_available    >= 0 AND
  qty_reserved     >= 0 AND
  qty_total        >= 0 AND
  qty_awaiting_qc  >= 0 AND
  qty_qc_failed    >= 0
);

-- ---------------------------------------------------------------------------
-- 2. price_history gains a reason
-- ---------------------------------------------------------------------------
-- Phase 3 Task 5: "records every price change, with actor and reason".
-- changed_by was already the actor; the reason was missing, which made the
-- floor-override audit trail unprovable.
ALTER TABLE listing.price_history
  ADD COLUMN IF NOT EXISTS reason        TEXT,
  ADD COLUMN IF NOT EXISTS change_source TEXT NOT NULL DEFAULT 'VENDOR_REPRICE';

UPDATE listing.price_history SET reason = '(migrated: reason not recorded)' WHERE reason IS NULL;

ALTER TABLE listing.price_history
  ALTER COLUMN reason SET NOT NULL,
  ADD CONSTRAINT chk_ph_source CHECK (
    change_source IN ('VENDOR_REPRICE','MARGIN_RULE','FLOOR_OVERRIDE','GRADE_CORRECTION','QC_CORRECTION')
  ),
  ADD CONSTRAINT chk_ph_reason_meaningful CHECK (length(btrim(reason)) >= 3);

COMMENT ON COLUMN listing.price_history.reason IS
  'Free text, min 3 chars. For change_source=FLOOR_OVERRIDE this is the ops justification required by Phase 3 Task 5.';

-- ---------------------------------------------------------------------------
-- 3. Floor override — durable authorisation, not just a log line
-- ---------------------------------------------------------------------------
-- "A floor margin below which the listing cannot go live without an ops
-- override, and the override is logged with a reason." The log row lives in
-- price_history; the *authorisation* has to be state on the listing, because
-- activation reads it. Storing only the log would mean re-deriving consent by
-- scanning history, and a scan that returns the wrong row silently
-- re-authorises.
ALTER TABLE listing.listing
  ADD COLUMN IF NOT EXISTS floor_override_by     UUID REFERENCES identity.user_account(id),
  ADD COLUMN IF NOT EXISTS floor_override_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS floor_override_reason TEXT;

ALTER TABLE listing.listing ADD CONSTRAINT chk_floor_override_complete CHECK (
  num_nonnulls(floor_override_by, floor_override_at, floor_override_reason) IN (0, 3)
);

-- ---------------------------------------------------------------------------
-- 4. Price-band flag — flag, never block
-- ---------------------------------------------------------------------------
-- "A listing priced 60% below the 30-day median is flagged, not blocked."
-- The median is stored alongside the flag so the reviewer sees what the
-- comparison actually was at flag time; recomputing it later gives a different
-- answer as the window slides, and then nobody can tell why it fired.
ALTER TABLE listing.listing
  ADD COLUMN IF NOT EXISTS price_band_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_band_median     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS price_band_ratio      NUMERIC(6,4);

ALTER TABLE listing.listing ADD CONSTRAINT chk_price_band_flag_complete CHECK (
  num_nonnulls(price_band_flagged_at, price_band_median, price_band_ratio) IN (0, 3)
);

CREATE INDEX IF NOT EXISTS ix_listing_price_flagged
  ON listing.listing (price_band_flagged_at)
  WHERE price_band_flagged_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Sourcing declaration — GST status AT the declaration date
-- ---------------------------------------------------------------------------
-- Task 8: "Capture the vendor's GST status at the declaration date, verified
-- against the GSTN API, not self-declared." This is the margin-scheme
-- determinant, so a self-declared value is worthless -- it must point at the
-- verification that produced it.
ALTER TABLE vendor.vendor_sourcing_declaration
  ADD COLUMN IF NOT EXISTS vendor_gst_status  TEXT,
  ADD COLUMN IF NOT EXISTS itc_available      BOOLEAN,
  ADD COLUMN IF NOT EXISTS gst_verified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gst_verification_check_id UUID REFERENCES kyc.verification_check(id);

ALTER TABLE vendor.vendor_sourcing_declaration
  ADD CONSTRAINT chk_vsd_gst_status CHECK (
    vendor_gst_status IS NULL OR vendor_gst_status IN ('REGULAR','COMPOSITION','UNREGISTERED')
  ),
  -- All four move together. A status without the verification behind it is the
  -- self-declaration Task 8 forbids.
  ADD CONSTRAINT chk_vsd_gst_verified CHECK (
    num_nonnulls(vendor_gst_status, itc_available, gst_verified_at, gst_verification_check_id) IN (0, 4)
  );

COMMENT ON COLUMN vendor.vendor_sourcing_declaration.itc_available IS
  'Whether input tax credit was available to the vendor on acquisition. With vendor_gst_status this decides unit.valuation_method: MARGIN when UNREGISTERED or ITC was not available, else REGULAR (GST Rule 32(5)).';

-- ---------------------------------------------------------------------------
-- 6. price_history is append-only too
-- ---------------------------------------------------------------------------
-- An audit trail you can UPDATE is not an audit trail. stock_movement was
-- already in this list; price_history belongs beside it.
CREATE OR REPLACE FUNCTION ops.apply_append_only_grants(p_role text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $fn$
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
      ('listing','price_history'),
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
END $fn$;

-- ---------------------------------------------------------------------------
-- 7. Which price is authoritative
-- ---------------------------------------------------------------------------
-- listing.unit_price predates the merchant-of-record retrofit and sits in the
-- hot offers index. unit.retail_price arrived with it, per serial. Two columns
-- holding "the price the customer pays" is the divergence this codebase keeps
-- producing, so the authority is written down rather than left to be inferred.
COMMENT ON COLUMN listing.listing.unit_price IS
  'Buyer-facing list price for the listing as a whole; what the offers grid ranks on. Derived from the pricing engine at activation. unit.retail_price is authoritative per serial and MUST equal this except where a unit was individually repriced after a grade correction.';
COMMENT ON COLUMN listing.unit.vendor_ask_price IS
  'The vendor net payout per unit, entered in the wizard. Never shown to a buyer. Frozen into purchase_price when the PO is raised (Phase 6).';

-- Deliberately NOT created: procurement.price_book. Phase 3 Task 5 names it
-- alongside margin_rule, but every input the selling-price formula needs is
-- already on margin_rule (target/floor margin, warranty_top_up_months,
-- reserve_pct_by_grade) and the freight component is a Phase 8 rate card.
-- An empty table with one implementation is the abstraction to skip; add it if
-- ops ever needs per-SKU price overrides that a first-match rule cannot express.
