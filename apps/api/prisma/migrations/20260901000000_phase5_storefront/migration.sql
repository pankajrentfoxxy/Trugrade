-- Phase 5 — Storefront, search, and the anonymised supply-point grid.

-- ---------------------------------------------------------------------------
-- 1. One definition of "sellable", used by everything
-- ---------------------------------------------------------------------------
-- PHASE_05 Task 3: "Never compute sellability in a query -- one place, one
-- definition." Today there are already two: recompute_is_sellable() writes the
-- flag, and v_sellability_drift re-states the same predicate to detect
-- disagreement. Adding a third for the storefront is how the definitions drift.
--
-- There is also a real hole. is_sellable is computed on WRITE, so a unit whose
-- qc_valid_until passes at midnight stays TRUE until something happens to touch
-- the row. Between midnight and the expiry job, an expired machine is sellable,
-- and two exit criteria ("a unit whose QC expired yesterday does not appear in
-- search", "a unit with a broken seal does not appear in search") would pass in
-- test and fail at 00:05.
--
-- So: extract the predicate into ONE function and have the trigger, the drift
-- view and the new storefront view all call it. STABLE rather than IMMUTABLE
-- because it reads CURRENT_DATE -- which is precisely the part that goes stale.
CREATE OR REPLACE FUNCTION listing.unit_is_sellable(
  p_status         unit_status,
  p_qc_passed_at   TIMESTAMPTZ,
  p_qc_valid_until DATE,
  p_seal_status    seal_status
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
  SELECT p_status = 'LISTED'
     AND p_qc_passed_at IS NOT NULL
     AND COALESCE(p_qc_valid_until >= CURRENT_DATE, FALSE)
     AND COALESCE(p_seal_status IN ('APPLIED','INTACT'), FALSE)
$fn$;

COMMENT ON FUNCTION listing.unit_is_sellable IS
  'THE definition of sellable. The trigger that writes listing.unit.is_sellable, listing.v_sellability_drift and listing.v_sellable_unit all call this and nothing re-states it. Changing what sellable means is a change to this function alone.';

CREATE OR REPLACE FUNCTION listing.recompute_is_sellable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_seal seal_status;
BEGIN
  SELECT s.status INTO v_seal FROM qc.qc_seal s WHERE s.id = NEW.seal_id;
  NEW.is_sellable := listing.unit_is_sellable(
    NEW.status, NEW.qc_passed_at, NEW.qc_valid_until, v_seal);
  RETURN NEW;
END $fn$;

CREATE OR REPLACE VIEW listing.v_sellability_drift AS
  SELECT u.id AS unit_id,
         u.serial_number,
         u.listing_id,
         u.is_sellable,
         u.status = 'LISTED' AS status_ok,
         u.qc_passed_at IS NOT NULL AS qc_done,
         u.qc_valid_until >= CURRENT_DATE AS qc_fresh,
         COALESCE(s.status IN ('APPLIED','INTACT'), FALSE) AS seal_ok
    FROM listing.unit u
    LEFT JOIN qc.qc_seal s ON s.id = u.seal_id
   WHERE u.is_sellable IS DISTINCT FROM
         listing.unit_is_sellable(u.status, u.qc_passed_at, u.qc_valid_until, s.status);

-- Everything buyer-facing reads this and never listing.unit directly.
--
-- The stored flag is kept in the predicate on purpose: it is what the partial
-- index can use, so it carries the selectivity. The function call is what makes
-- the answer true *now* rather than true when the row was last written. A stale
-- TRUE (expired overnight) is therefore excluded, and a stale FALSE stays
-- excluded, which is the safe direction to be wrong in.
CREATE OR REPLACE VIEW listing.v_sellable_unit AS
  SELECT u.*
    FROM listing.unit u
    LEFT JOIN qc.qc_seal s ON s.id = u.seal_id
   WHERE u.is_sellable
     AND listing.unit_is_sellable(u.status, u.qc_passed_at, u.qc_valid_until, s.status);

COMMENT ON VIEW listing.v_sellable_unit IS
  'The only unit source a customer-facing query may read. Combines the stored flag (for index selectivity) with the live predicate (for time correctness), so a unit whose QC expired at midnight stops being sellable at midnight rather than whenever the expiry job next runs.';

CREATE INDEX IF NOT EXISTS ix_unit_sellable_sku_grade
  ON listing.unit (sku_id, grade_actual, vendor_org_id)
  WHERE is_sellable;

-- ---------------------------------------------------------------------------
-- 2. Supply points — the anonymity label, assigned once and centrally
-- ---------------------------------------------------------------------------
-- Phase 3 stores supply_point_code on listing.unit. Nothing said where the code
-- comes from, which means every insert path is free to invent one, and two
-- units from the same vendor in the same city can end up labelled differently.
-- That is not a cosmetic bug: the label IS the anonymity boundary, and a vendor
-- who appears as both "Supply Point A" and "Supply Point D" in one city has had
-- their unit count leaked.
--
-- PHASE_05 Task 1 sets three rules, and this table is what makes each of them
-- enforceable rather than aspirational:
--   stable for the life of the vendor in that city  -> UNIQUE (vendor_org_id, city)
--   not derivable from the vendor UUID              -> the code is stored, never computed
--   ordering must not leak count or identity        -> assignment picks at random
CREATE TABLE IF NOT EXISTS listing.supply_point (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_org_id  UUID NOT NULL REFERENCES identity.organization(id),
  city           TEXT NOT NULL,
  code           TEXT NOT NULL CHECK (code ~ '^[A-Z]{1,2}$'),
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_supply_point_vendor_city UNIQUE (vendor_org_id, city),
  CONSTRAINT uq_supply_point_city_code   UNIQUE (city, code)
);

COMMENT ON TABLE listing.supply_point IS
  'The anonymised label a buyer sees: "Supply Point A - Gurugram". One row per vendor per city, assigned once and never changed. listing.unit.supply_point_code is a denormalised copy of code; listing.v_supply_point_drift catches any disagreement.';

/**
 * Assign a label, or return the one already held.
 *
 * The label is chosen at RANDOM from those still free in that city, never as
 * "the next letter". Sequential assignment would make A the oldest vendor and
 * the highest letter the newest, which publishes both the join order and the
 * number of vendors in the city -- the exact thing Task 1 forbids.
 */
CREATE OR REPLACE FUNCTION listing.assign_supply_point(p_vendor UUID, p_city TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $fn$
DECLARE
  v_code TEXT;
BEGIN
  SELECT code INTO v_code
    FROM listing.supply_point WHERE vendor_org_id = p_vendor AND city = p_city;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  SELECT c INTO v_code
    FROM (SELECT chr(65 + g) AS c FROM generate_series(0, 25) g) letters
   WHERE NOT EXISTS (
     SELECT 1 FROM listing.supply_point sp WHERE sp.city = p_city AND sp.code = letters.c)
   ORDER BY random()
   LIMIT 1;

  IF v_code IS NULL THEN
    -- 26 vendors in one city is a good problem. Fail loudly rather than reusing
    -- a label, because a reused label merges two vendors into one identity.
    RAISE EXCEPTION 'No free supply-point label left in %. Widen the code space before onboarding another vendor there.', p_city;
  END IF;

  INSERT INTO listing.supply_point (vendor_org_id, city, code) VALUES (p_vendor, p_city, v_code);
  RETURN v_code;
END $fn$;

CREATE OR REPLACE VIEW listing.v_supply_point_drift AS
  SELECT u.id AS unit_id, u.vendor_org_id, u.supply_point_code, sp.code AS assigned_code, sp.city
    FROM listing.unit u
    JOIN listing.supply_point sp ON sp.vendor_org_id = u.vendor_org_id
   WHERE u.supply_point_code IS DISTINCT FROM sp.code;

COMMENT ON VIEW listing.v_supply_point_drift IS
  'Units whose denormalised supply_point_code disagrees with the assignment. Must return zero rows: a vendor showing under two labels in one city has had their unit count leaked.';

-- ---------------------------------------------------------------------------
-- 3. Named carts
-- ---------------------------------------------------------------------------
-- Task 6: "support multiple named carts for procurement teams running parallel
-- requirements". A procurement head sourcing for three departments at once needs
-- three carts, and they need names, or they are indistinguishable.
ALTER TABLE ordering.cart
  ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE ordering.cart SET name = 'Cart' WHERE name IS NULL;

ALTER TABLE ordering.cart
  ALTER COLUMN name SET DEFAULT 'Cart',
  ALTER COLUMN name SET NOT NULL,
  ADD CONSTRAINT chk_cart_name_present CHECK (length(btrim(name)) > 0);

-- Two open carts may share a name only if they belong to different buyers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_active_name
  ON ordering.cart (buyer_org_id, user_id, lower(btrim(name)))
  WHERE status = 'OPEN';

COMMENT ON COLUMN ordering.cart.name IS
  'Buyer-supplied label so a procurement team can run parallel requirements. Unique per buyer among OPEN carts only, so a closed cart never blocks reusing its name.';
