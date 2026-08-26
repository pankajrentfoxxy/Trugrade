-- ##########################################################################
-- RETROFIT — six decisions made after Phases 0 and 1 were written.
-- PHASE_00_01_RETROFIT.md changes 4, 5 and 6.
--
-- Applied now rather than after Phase 5, when the brand and the pricing basis
-- would be in schema seeds, the invoice series, notification templates and the
-- certificate face.
-- ##########################################################################

-- ==========================================================================
-- CHANGE 5 — The payout basis, and the freeze rule.
--
-- Decided: **the vendor names their net payout and we add our charge.** Not a
-- discount off our listed price. Three concrete reasons the alternative breaks:
--
--   * Freight varies by destination, so a vendor's payout would depend on where
--     the buyer happens to be. They will never accept that.
--   * Discounting to win a large order either cuts the vendor's payout or eats
--     the whole margin.
--   * Rule 32(5) margin computation needs a fixed purchase price per serial. A
--     floating payout makes the tax position indefensible.
-- ==========================================================================

ALTER TABLE vendor.vendor_payout_preference
  ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'NET_PAYOUT';

DO $$ BEGIN
  ALTER TABLE vendor.vendor_payout_preference ADD CONSTRAINT chk_pricing_mode
    CHECK (pricing_mode IN ('NET_PAYOUT', 'COMMISSION'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN vendor.vendor_payout_preference.pricing_mode IS
  'NET_PAYOUT: the vendor names the rupee amount they want; we derive the selling price. COMMISSION: the vendor names an expected sale price and a rate, and the system derives and IMMEDIATELY FREEZES the net payout. Both converge on the same stored rupee value — COMMISSION is a presentation layer over the same contract, because vendors think in percentages.';

/**
 * The freeze rule, and it is not optional.
 *
 * `purchase_price` is written when the PO is raised and is immutable thereafter.
 * Nothing that happens to the retail price afterwards — a promotion, a grade
 * correction, a price match — may change what we owe a vendor.
 *
 * Mirrors lock_valuation_method(). Both exist because the alternative is a
 * dispute the vendor is right to raise.
 */
CREATE OR REPLACE FUNCTION listing.lock_purchase_price() RETURNS trigger AS $$
BEGIN
  IF OLD.purchase_price IS NOT NULL AND NEW.purchase_price IS DISTINCT FROM OLD.purchase_price THEN
    RAISE EXCEPTION
      'purchase_price is immutable once set (unit %). What we owe a vendor is fixed when the purchase order is raised; a later change to the retail price does not touch it.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lock_purchase_price ON listing.unit;
CREATE TRIGGER trg_lock_purchase_price BEFORE UPDATE ON listing.unit
  FOR EACH ROW EXECUTE FUNCTION listing.lock_purchase_price();

-- ==========================================================================
-- CHANGE 4 — Four vendor-onboarding captures later phases depend on.
-- ==========================================================================

-- 4a. The exact address goods leave from. Becomes `Dispatch From` on every
--     e-way bill (Case 2), and it is NOT always the registered address.
--     Nullable so it falls back to the facility address; the API resolves it.
ALTER TABLE vendor.vendor_facility
  ADD COLUMN IF NOT EXISTS dispatch_address_id UUID REFERENCES identity.org_address(id);

COMMENT ON COLUMN vendor.vendor_facility.dispatch_address_id IS
  'Where goods physically leave from. Becomes Dispatch From on the e-way bill. NULL falls back to address_id. Distinct because the registered address and the loading dock are frequently different, and correcting it at scale is expensive.';

-- 4b. Can this vendor dispatch straight to a buyer rather than to a hub?
--     In this model that IS the default flow, so a vendor who cannot do it is a
--     materially different vendor. NOT NULL with no default would break existing
--     rows, so it defaults TRUE and the wizard makes it an explicit choice.
ALTER TABLE vendor.vendor_capability
  ADD COLUMN IF NOT EXISTS can_dropship BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN vendor.vendor_capability.can_dropship IS
  'Whether this vendor can dispatch directly to a buyer address rather than to a hub. Shown in the admin review queue: under the merchant-of-record model drop-ship is the default flow.';

-- 4c. The vendor's default warranty commitment. Set here, applied per listing.
ALTER TABLE vendor.vendor_profile
  ADD COLUMN IF NOT EXISTS default_warranty_months INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_warranty_scope JSONB;

DO $$ BEGIN
  ALTER TABLE vendor.vendor_profile ADD CONSTRAINT chk_default_warranty_months
    CHECK (default_warranty_months BETWEEN 0 AND 24);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN vendor.vendor_profile.default_warranty_months IS
  'A commercial commitment, not a note. We sell a LONGER total term than the vendor offers and carry the difference ourselves — the onboarding screen says so plainly, because nobody should discover it during a claim. Also a pricing input: a vendor offering 6 months costs us nothing to top up; one offering 1 costs us five.';

-- ==========================================================================
-- CHANGE 6.1 — Warranty stacking.
--
-- The customer sees ONE number. Internally the term is two layers, and the
-- split never leaves the API.
-- ==========================================================================

ALTER TABLE platform.warranty
  ADD COLUMN IF NOT EXISTS total_months           INT NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS vendor_backed_months   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_backed_months INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vendor_org_id          UUID REFERENCES identity.organization(id),
  ADD COLUMN IF NOT EXISTS reserve_amount         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS reserve_released_at    TIMESTAMPTZ;

-- Existing rows default to 0+0=0 against a total of 6, which the CHECK would
-- reject. Reconcile them before adding it.
UPDATE platform.warranty
   SET platform_backed_months = total_months
 WHERE vendor_backed_months + platform_backed_months <> total_months;

DO $$ BEGIN
  ALTER TABLE platform.warranty ADD CONSTRAINT chk_warranty_split
    CHECK (vendor_backed_months + platform_backed_months = total_months);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/**
 * The customer-visible `provider` column goes.
 *
 * We are the sole warrantor for the entire term. A customer-facing `provider`
 * field defeats both the trust play and the anonymity model — the customer
 * deals only with us, for the whole term, and never learns there was a split.
 */
ALTER TABLE platform.warranty DROP COLUMN IF EXISTS provider;

COMMENT ON COLUMN platform.warranty.vendor_org_id IS
  'INTERNAL. Never leaves the API. A claim inside the vendor-backed window is settled with the customer immediately and recovered from this vendor afterwards; the two never touch in time.';
COMMENT ON COLUMN platform.warranty.reserve_amount IS
  'Accrued at sale from margin, banded by grade — a Grade B machine claims materially more often than an A+. Drawn on for a platform-backed claim, released to margin on expiry. Without it the longer term is an unpriced liability that grows with every sale.';

-- ==========================================================================
-- CHANGE 6.2 — The warranty the vendor stands behind, per listing.
-- ==========================================================================

ALTER TABLE listing.listing
  ADD COLUMN IF NOT EXISTS vendor_warranty_months INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vendor_warranty_scope  JSONB;

DO $$ BEGIN
  ALTER TABLE listing.listing ADD CONSTRAINT chk_vendor_warranty_months
    CHECK (vendor_warranty_months BETWEEN 0 AND 24);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ==========================================================================
-- CHANGE 6.3 — Vendor quality aggregates.
--
-- The supply-point comparison grid sells on these two numbers, so they are
-- computed where the data lives (Phase 4) and served from a read model — never
-- calculated live in a grid query that already touches six tables against a
-- 500 ms budget.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS qc.vendor_sku_quality (
  vendor_org_id      UUID NOT NULL REFERENCES identity.organization(id),
  sku_id             UUID NOT NULL REFERENCES catalog.sku(id),
  grade              grade_type NOT NULL,
  units_inspected    INT NOT NULL DEFAULT 0,
  avg_qc_score       NUMERIC(5,2),
  median_qc_score    NUMERIC(5,2),
  battery_health_min INT,
  battery_health_max INT,
  grade_corrections  INT NOT NULL DEFAULT 0,
  grade_accuracy_pct NUMERIC(5,2),
  last_inspected_at  TIMESTAMPTZ,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_org_id, sku_id, grade)
);

CREATE TABLE IF NOT EXISTS qc.vendor_quality (
  vendor_org_id      UUID PRIMARY KEY REFERENCES identity.organization(id),
  units_inspected    INT NOT NULL DEFAULT 0,
  avg_qc_score       NUMERIC(5,2),
  median_qc_score    NUMERIC(5,2),
  battery_health_min INT,
  battery_health_max INT,
  grade_corrections  INT NOT NULL DEFAULT 0,
  grade_accuracy_pct NUMERIC(5,2),
  last_inspected_at  TIMESTAMPTZ,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE qc.vendor_sku_quality IS
  'Refreshed on qc.report.completed and nightly. Served keyed by supply_point_code — the vendor org_id never crosses the DTO boundary. Below platform_config quality.min_sample_for_headline the storefront shows "New supplier - N units inspected" rather than a percentage: an authoritative-looking average on two machines is OUR misrepresentation under CP e-Comm r.7(2), not the vendor''s.';

-- ==========================================================================
-- CHANGE 6.4 — Margin rules.
--
-- The table itself belongs to Phase 3; creating it now with the warranty
-- columns already on it means Phase 3 does not migrate against live data.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS procurement.margin_rule (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable predicates mean "don't care", exactly like the routing rules.
  -- Evaluated first-match-wins by priority, so ops tunes margin without a release.
  priority               INT NOT NULL,
  category               TEXT,
  brand_id               UUID REFERENCES catalog.brand(id),
  grade                  grade_type,
  value_from             NUMERIC(14,2),
  value_to               NUMERIC(14,2),
  target_margin_pct      NUMERIC(6,3) NOT NULL,
  floor_margin_pct       NUMERIC(6,3) NOT NULL,
  -- We sell a longer term than the vendor offers; months 4-6 are ours to fund.
  warranty_top_up_months INT NOT NULL DEFAULT 3,
  -- {"A_PLUS":0.8,"A":1.2,"B":2.0} as a % of payout. A Grade B machine claims
  -- materially more often than an A+, so the reserve is banded by grade.
  reserve_pct_by_grade   JSONB,
  effective_from         DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to           DATE,
  approved_by            UUID REFERENCES identity.user_account(id),
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_margin_validity CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT chk_margin_floor CHECK (floor_margin_pct <= target_margin_pct)
);

CREATE INDEX IF NOT EXISTS ix_margin_rule_priority
  ON procurement.margin_rule (priority) WHERE is_active;

-- ==========================================================================
-- CHANGE 6.5 — DeviceSure licence lifecycle.
--
-- Under the self-serve QC model (Q15) the vendor runs the tool that sets their
-- own payout. Revoking their licence on suspension is the enforcement mechanism
-- the entire quality model rests on.
-- ==========================================================================

ALTER TABLE vendor.vendor_profile
  ADD COLUMN IF NOT EXISTS devicesure_org_id      TEXT,
  ADD COLUMN IF NOT EXISTS devicesure_licence_key TEXT,
  ADD COLUMN IF NOT EXISTS devicesure_status      TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS devicesure_issued_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS devicesure_revoked_at  TIMESTAMPTZ,
  -- Q15: our expert attends the first listing; the vendor self-serves after.
  ADD COLUMN IF NOT EXISTS qc_mode                TEXT NOT NULL DEFAULT 'SUPERVISED',
  ADD COLUMN IF NOT EXISTS first_supervised_visit_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE vendor.vendor_profile ADD CONSTRAINT chk_devicesure_status
    CHECK (devicesure_status IN ('NONE','PENDING','ACTIVE','SUSPENDED','REVOKED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE vendor.vendor_profile ADD CONSTRAINT chk_qc_mode
    CHECK (qc_mode IN ('SUPERVISED','VENDOR_SELF_SERVE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN vendor.vendor_profile.qc_mode IS
  'Q15. SUPERVISED until our QC expert has attended the first listing in person; VENDOR_SELF_SERVE thereafter, on a DeviceSure activation key and a USB agent. A vendor whose audit rechecks diverge goes back to SUPERVISED.';
COMMENT ON COLUMN vendor.vendor_profile.devicesure_status IS
  'A suspended vendor must lose the ability to certify machines. vendor.suspended revokes the licence; vendor.verified issues one. This is the enforcement mechanism the whole quality model rests on.';

CREATE INDEX IF NOT EXISTS ix_vendor_devicesure_active
  ON vendor.vendor_profile (devicesure_status) WHERE devicesure_status = 'ACTIVE';

-- Re-apply the append-only grants and updated_at triggers to anything new.
SELECT ops.attach_updated_at_triggers();
