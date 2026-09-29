-- The order-first inspection flow.
--
-- A vendor now lists a QUANTITY, not serials. Nothing is inspected until a
-- buyer orders; ops then sends a technician to the vendor, the technician names
-- one serial per ordered machine, ops verifies each one, and only then does the
-- buyer pay and the vendor see a purchase order. Four consequences for the
-- schema, each below.

-- --- 1. Availability is a declared count, owned by ordering -----------------
-- `qty_available` and `qty_reserved` used to be recounted from `listing.unit`
-- on every unit change. Under the new flow a listing goes live with NO units,
-- so a trigger that derives availability from units would zero every live
-- listing the moment a technician created its first machine. The two counters
-- are now written by exactly two places: listing approval (available = total)
-- and the ordering module's hold and order transactions. The trigger keeps the
-- two counters that are still genuinely a property of the units.
CREATE OR REPLACE FUNCTION listing.recompute_listing_counters() RETURNS trigger AS $$
DECLARE
  v_listing UUID := COALESCE(NEW.listing_id, OLD.listing_id);
BEGIN
  IF v_listing IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE listing.listing l
     SET qty_awaiting_qc = c.awaiting_qc,
         qty_qc_failed   = c.qc_failed
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE u.status IN ('AWAITING_QC','QC_SCHEDULED','QC_SEALED')) AS awaiting_qc,
        COUNT(*) FILTER (WHERE u.status IN ('QC_FAILED','QC_EXPIRED','SEAL_BROKEN'))   AS qc_failed
      FROM listing.unit u WHERE u.listing_id = v_listing
    ) c
   WHERE l.id = v_listing;

  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION listing.recompute_listing_counters IS
  'Maintains qty_awaiting_qc and qty_qc_failed from the units. qty_available and qty_reserved are a declared count owned by listing approval and the ordering module, because a listing is live before any unit exists.';

-- --- 2. The checkout hold holds a quantity, not serials ---------------------
-- There are no serials to hold before an order is placed. The twenty-minute
-- hold now decrements the listing's declared availability and remembers how
-- much to give back.
CREATE TABLE ordering.checkout_hold_line (
  hold_id    UUID NOT NULL REFERENCES ordering.checkout_hold(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listing.listing(id),
  qty        INT  NOT NULL CHECK (qty > 0),
  PRIMARY KEY (hold_id, listing_id)
);
COMMENT ON TABLE ordering.checkout_hold_line IS
  'How many of each listing a live checkout hold has taken off listing.qty_available. Released by the same code that took it, or consumed by the order transaction.';

-- --- 3. The order carries its verification and its payment deadline ---------
ALTER TABLE ordering."order"
  ADD COLUMN verified_at TIMESTAMPTZ,
  ADD COLUMN pay_by      TIMESTAMPTZ,
  ADD COLUMN paid_at     TIMESTAMPTZ;
CREATE INDEX ix_order_pay_by ON ordering."order" (pay_by) WHERE pay_by IS NOT NULL;
COMMENT ON COLUMN ordering."order".pay_by IS
  'Set when ops verifies the last machine. The buyer pays by this instant or the order is cancelled and the stock released.';

ALTER TABLE ordering.order_line_unit
  ADD COLUMN inspected_at TIMESTAMPTZ,
  ADD COLUMN verified_at  TIMESTAMPTZ,
  ADD COLUMN verified_by  UUID REFERENCES identity.user_account(id);
COMMENT ON COLUMN ordering.order_line_unit.verified_at IS
  'Ops confirmed this machine against its inspection. The buyer reads "Device verified" from this column and nothing else.';

-- --- 4. A QC visit can belong to an order ------------------------------------
-- The technician is sent for a specific order's machines rather than for a
-- vendor's whole batch. The visit still happens at the vendor's facility.
ALTER TABLE qc.qc_visit ADD COLUMN order_id UUID REFERENCES ordering."order"(id);
CREATE INDEX ix_visit_order ON qc.qc_visit (order_id) WHERE order_id IS NOT NULL;
