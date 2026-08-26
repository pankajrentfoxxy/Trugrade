-- Phase 6 — Checkout, orders, approvals and allocation.
--
-- The ordering schema already carries order, sub_order, order_line,
-- order_line_unit (with its UNIQUE unit_id), order_approval and order_event, and
-- order_status already has all 24 values. What is missing is the whole
-- vendor-facing half: procurement holds only margin_rule today.

CREATE TYPE po_status AS ENUM (
  'RAISED', 'ACKNOWLEDGED', 'DISPATCH_READY', 'DISPATCHED', 'RECEIVED',
  'INVOICED', 'MATCHED', 'PAYABLE', 'PAID', 'CANCELLED', 'DISPUTED'
);

-- ---------------------------------------------------------------------------
-- 1. The purchase order — our half of the merchant-of-record model
-- ---------------------------------------------------------------------------
CREATE TABLE procurement.purchase_order (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number            TEXT UNIQUE NOT NULL,
  vendor_org_id        UUID NOT NULL REFERENCES identity.organization(id),
  order_id             UUID NOT NULL REFERENCES ordering."order"(id),
  status               po_status NOT NULL DEFAULT 'RAISED',

  total_net            NUMERIC(14,2) NOT NULL CHECK (total_net > 0),
  tds_rate_pct         NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (tds_rate_pct >= 0),
  tds_amount           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),

  -- Frozen from listing.unit at PO time. GST Rule 32(5) margin-scheme treatment
  -- is decided per unit and must not drift after the purchase is committed.
  valuation_method     TEXT NOT NULL CHECK (valuation_method IN ('REGULAR','MARGIN')),
  terms_days           INT NOT NULL DEFAULT 15 CHECK (terms_days >= 0),
  expected_dispatch_at TIMESTAMPTZ,

  acknowledged_at      TIMESTAMPTZ,
  rejected_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  cancelled_at         TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One PO per vendor per order. Two would split a vendor's view of the same
  -- customer order and make the three-way match in Phase 7 ambiguous.
  CONSTRAINT uq_po_order_vendor UNIQUE (order_id, vendor_org_id),
  -- A rejection has to say why: the vendor portal offers "reject with a reason"
  -- and the reason drives re-allocation.
  CONSTRAINT chk_po_rejection_reason CHECK (rejected_at IS NULL OR rejection_reason IS NOT NULL)
);

COMMENT ON TABLE procurement.purchase_order IS
  'Our purchase order TO a vendor. Never visible to the buyer: PHASE_06 Task 6 distinguishes three documents, and this is the only one the customer must never see. It carries agreed_net_payout only -- no retail price, no buyer identity, and no delivery address until pickup is scheduled.';

COMMENT ON COLUMN procurement.purchase_order.total_net IS
  'The sum of agreed_net_payout across lines. What we owe the vendor. Nothing that happens to the retail price afterwards touches it.';

CREATE INDEX ix_po_vendor_status ON procurement.purchase_order (vendor_org_id, status);
CREATE INDEX ix_po_order ON procurement.purchase_order (order_id);

CREATE TABLE procurement.purchase_order_line (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id             UUID NOT NULL REFERENCES procurement.purchase_order(id) ON DELETE CASCADE,

  -- THE constraint that makes double-selling structurally impossible. It mirrors
  -- ordering.order_line_unit.unit_id UNIQUE: one physical laptop can be on
  -- exactly one purchase order line and exactly one customer order line, ever.
  -- Together they mean a double-sell is a 23505 rather than a discovery made by
  -- a customer who received nothing.
  unit_id           UUID NOT NULL UNIQUE REFERENCES listing.unit(id),

  sku_id            UUID NOT NULL REFERENCES catalog.sku(id),
  agreed_net_payout NUMERIC(14,2) NOT NULL CHECK (agreed_net_payout > 0),
  grade_at_po       grade_type NOT NULL,
  qc_report_id      UUID REFERENCES qc.qc_report(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN procurement.purchase_order_line.grade_at_po IS
  'The inspected grade at the moment of purchase. Kept even if the unit is later re-graded, because what we agreed to pay was agreed against this grade.';

CREATE INDEX ix_pol_po ON procurement.purchase_order_line (po_id);

-- ---------------------------------------------------------------------------
-- 2. The TDS ledger — one authority for "purchases this financial year"
-- ---------------------------------------------------------------------------
-- s.194Q charges 0.1% on the value of purchases from a vendor above Rs 50 lakh
-- in a financial year, on credit OR payment, WHICHEVER IS EARLIER.
--
-- That last clause is why this table exists. Phase 3's payout preview currently
-- derives the year-to-date figure from payment.payout.paid_at -- money actually
-- paid out. Payouts lag purchases by the credit terms, so a vendor can cross
-- Rs 50 lakh in purchases while the paid-out total still reads below it, and we
-- under-deduct. Under-deducting TDS is our liability, not the vendor's.
--
-- So the ledger accrues at PO time, and everything that needs the year-to-date
-- number reads v_vendor_fy_purchases rather than computing its own.
CREATE TABLE procurement.tds_ledger (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_org_id     UUID NOT NULL REFERENCES identity.organization(id),
  -- Indian FY, e.g. '2026-27'. Stored rather than derived so a late adjustment
  -- lands in the year it belongs to, not the year it was entered.
  financial_year    TEXT NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  purchase_order_id UUID REFERENCES procurement.purchase_order(id),
  entry_type        TEXT NOT NULL CHECK (entry_type IN ('ACCRUAL','REVERSAL','ADJUSTMENT')),

  -- Signed. A reversal (cancelled PO, rejected line) is negative, so the running
  -- total is a plain SUM and no reader has to know which rows to subtract.
  gross_amount      NUMERIC(14,2) NOT NULL,
  tds_rate_pct      NUMERIC(5,2)  NOT NULL CHECK (tds_rate_pct >= 0),
  tds_amount        NUMERIC(14,2) NOT NULL,

  reason            TEXT NOT NULL CHECK (length(btrim(reason)) >= 3),
  actor_id          UUID,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- An accrual adds, a reversal subtracts. Getting these the wrong way round
  -- silently mis-states the threshold, so the sign is a constraint.
  CONSTRAINT chk_tds_sign CHECK (
    (entry_type = 'ACCRUAL'  AND gross_amount >= 0) OR
    (entry_type = 'REVERSAL' AND gross_amount <= 0) OR
    (entry_type = 'ADJUSTMENT')
  )
);

COMMENT ON TABLE procurement.tds_ledger IS
  'Append-only. The single authority for a vendor year-to-date purchase value under s.194Q. Accrued when the PO is raised (credit), NOT when the payout is made -- the section says credit or payment, whichever is earlier.';

CREATE INDEX ix_tds_vendor_fy ON procurement.tds_ledger (vendor_org_id, financial_year);

CREATE OR REPLACE VIEW procurement.v_vendor_fy_purchases AS
  SELECT vendor_org_id,
         financial_year,
         SUM(gross_amount) AS gross_to_date,
         SUM(tds_amount)   AS tds_to_date
    FROM procurement.tds_ledger
   GROUP BY vendor_org_id, financial_year;

COMMENT ON VIEW procurement.v_vendor_fy_purchases IS
  'THE year-to-date purchase figure. Anything deciding whether a vendor has crossed the s.194Q threshold reads this and does not compute its own -- two answers to "how much have we bought from them" is how the deduction goes wrong.';

-- ---------------------------------------------------------------------------
-- 3. What we owe, per purchase order
-- ---------------------------------------------------------------------------
CREATE TABLE procurement.vendor_payable (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_org_id     UUID NOT NULL REFERENCES identity.organization(id),
  purchase_order_id UUID NOT NULL UNIQUE REFERENCES procurement.purchase_order(id),

  gross             NUMERIC(14,2) NOT NULL CHECK (gross > 0),
  tds               NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tds >= 0),
  penalties         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (penalties >= 0),
  qc_fee            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (qc_fee >= 0),
  net_payable       NUMERIC(14,2) NOT NULL,

  status            TEXT NOT NULL DEFAULT 'ACCRUED'
                      CHECK (status IN ('ACCRUED','ELIGIBLE','IN_RUN','PAID','ON_HOLD','CANCELLED')),
  hold_reason       TEXT,
  eligible_at       TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The deduction stack has to add up. This is the same class of guard as the
  -- listing counters: without it, two code paths can each write a plausible
  -- number and the vendor statement silently stops reconciling.
  CONSTRAINT chk_payable_arithmetic CHECK (net_payable = gross - tds - penalties - qc_fee),
  -- A payable can go negative only if the deductions genuinely exceed the
  -- purchase, which is a situation a human must look at rather than a run pay.
  CONSTRAINT chk_payable_hold_reason CHECK (status <> 'ON_HOLD' OR hold_reason IS NOT NULL)
);

COMMENT ON TABLE procurement.vendor_payable IS
  'One row per purchase order. net_payable is constrained to equal gross minus the deduction stack, so a statement that does not reconcile cannot be written in the first place.';

CREATE INDEX ix_payable_vendor_status ON procurement.vendor_payable (vendor_org_id, status);

-- ---------------------------------------------------------------------------
-- 4. Append-only where it is evidence
-- ---------------------------------------------------------------------------
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
      ('catalog','catalog_change_log'),
      ('procurement','tds_ledger')
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
