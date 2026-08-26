-- Phase 7 — Procurement, invoicing, payments and vendor payouts.
--
-- "This phase is tax architecture wearing a software costume." Everything here
-- is a constraint rather than a convention, because the failures are silent:
-- a wrong tax head produces a correct-looking invoice, and the discovery is a
-- notice months later.

-- ---------------------------------------------------------------------------
-- 1. TCS is not part of this model, and the column that invites it
-- ---------------------------------------------------------------------------
-- An exit criterion reads: "No code anywhere implements GST TCS u/s 52, GSTR-8,
-- s.206C(1H), s.206AB or s.206CCA." GST TCS u/s 52 binds marketplace
-- facilitators, which the merchant-of-record model means we are not; s.206C(1H)
-- was OMITTED with effect from 1 April 2025, along with s.206AB and s.206CCA.
--
-- ordering.order nonetheless carries tcs_amount, defaulted to 0 and referenced
-- by no code -- a leftover from the marketplace shape. Left as-is it is an
-- invitation: the column exists, so eventually somebody populates it. Pinning it
-- at zero turns the exit criterion into something the database enforces.
ALTER TABLE ordering."order" ADD CONSTRAINT chk_no_tcs CHECK (tcs_amount = 0);

COMMENT ON COLUMN ordering."order".tcs_amount IS
  'VESTIGIAL, pinned at 0 by chk_no_tcs. GST TCS u/s 52 applies to marketplace facilitators and we are the merchant of record; s.206C(1H) was omitted w.e.f. 1 April 2025. If a requirement to collect tax at source ever appears, it needs a new column and a new discussion, not this one.';

-- ---------------------------------------------------------------------------
-- 2. An invoice is single-channel, structurally
-- ---------------------------------------------------------------------------
-- Rule 32(5) margin-scheme value is (sale price - purchase price) PER SERIAL,
-- with no ITC on the purchase. A REGULAR line charges 18% on full value with ITC
-- claimed. Mixing them on one invoice makes the document indefensible.
--
-- "Enforce it with a constraint, not a code comment" -- so this is done with a
-- composite foreign key rather than a trigger. A line references its invoice AND
-- that invoice's channel together, so a line whose channel differs from its
-- parent simply has no parent to point at. No trigger to disable, no ordering
-- concern, and it holds under concurrency for free.
ALTER TABLE payment.invoice
  ADD COLUMN IF NOT EXISTS valuation_method TEXT NOT NULL DEFAULT 'REGULAR';

ALTER TABLE payment.invoice
  ADD CONSTRAINT chk_invoice_valuation CHECK (valuation_method IN ('REGULAR','MARGIN')),
  ADD CONSTRAINT uq_invoice_id_valuation UNIQUE (id, valuation_method);

ALTER TABLE payment.invoice_line
  ADD COLUMN IF NOT EXISTS valuation_method TEXT NOT NULL DEFAULT 'REGULAR',
  -- Rule 32(5) needs the purchase price PER SERIAL. Pooled or weighted-average
  -- costing breaks the scheme outright, which is why this sits on the line and
  -- not on the invoice.
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS margin_value   NUMERIC(14,2);

ALTER TABLE payment.invoice_line
  ADD CONSTRAINT fk_line_matches_invoice_channel
    FOREIGN KEY (invoice_id, valuation_method)
    REFERENCES payment.invoice (id, valuation_method) ON DELETE CASCADE,
  -- A margin line has to show its working; a regular line must not pretend to.
  ADD CONSTRAINT chk_margin_line_complete CHECK (
    (valuation_method = 'REGULAR' AND purchase_price IS NULL AND margin_value IS NULL) OR
    (valuation_method = 'MARGIN'  AND purchase_price IS NOT NULL AND margin_value IS NOT NULL)
  ),
  -- "negative margins ignored": a loss-making resale contributes zero taxable
  -- value, never a negative one that would offset another serial's margin.
  ADD CONSTRAINT chk_margin_non_negative CHECK (margin_value IS NULL OR margin_value >= 0);

COMMENT ON COLUMN payment.invoice_line.margin_value IS
  'Rule 32(5) taxable value for this serial: max(sale - purchase, 0). Stored, never recomputed at render -- an invoice that disagrees with itself between the screen and the PDF is a support ticket and eventually a GST notice.';

-- ---------------------------------------------------------------------------
-- 3. A MARGIN purchase can never enter the ITC ledger
-- ---------------------------------------------------------------------------
-- "A single accidental credit claim destroys the position retrospectively", and
-- the exit criterion requires this "enforced at the database, not in application
-- code" (PAY-045…PAY-049). A CHECK cannot see another table, so this is the one
-- place a trigger is the right instrument.
CREATE TABLE payment.itc_entry (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_order_line_id  UUID NOT NULL UNIQUE REFERENCES procurement.purchase_order_line(id),
  unit_id                 UUID NOT NULL UNIQUE REFERENCES listing.unit(id),
  gst_amount              NUMERIC(14,2) NOT NULL CHECK (gst_amount > 0),
  gstr2b_matched          BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_in_period       TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payment.itc_entry IS
  'Input tax credit claimed on a purchase. REGULAR-channel units only: trg_block_margin_itc refuses a MARGIN unit outright. Reconciled monthly against GSTR-2B.';

CREATE OR REPLACE FUNCTION payment.block_margin_itc()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_method TEXT;
BEGIN
  SELECT u.valuation_method INTO v_method FROM listing.unit u WHERE u.id = NEW.unit_id;
  IF v_method = 'MARGIN' THEN
    RAISE EXCEPTION
      'Unit % is a MARGIN-scheme purchase; no input tax credit may be availed on it (Rule 32(5) CGST Rules). Claiming it destroys the margin position for that serial retrospectively.',
      NEW.unit_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_block_margin_itc
  BEFORE INSERT OR UPDATE ON payment.itc_entry
  FOR EACH ROW EXECUTE FUNCTION payment.block_margin_itc();

-- ---------------------------------------------------------------------------
-- 4. A gapless invoice series, per GSTIN, per financial year
-- ---------------------------------------------------------------------------
-- "A gap in a GST invoice series is a question you will be asked in an audit."
-- The counter is a row that the allocating transaction locks, so two concurrent
-- invoices serialise on it and neither can skip a number.
CREATE TABLE payment.invoice_series (
  gstin          TEXT NOT NULL,
  financial_year TEXT NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  prefix         TEXT NOT NULL,
  last_number    INT  NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (gstin, financial_year)
);

/**
 * Allocate the next invoice number.
 *
 * FOR UPDATE on the counter row is the whole mechanism: concurrent callers queue
 * behind it rather than both reading the same last_number. Because the lock is
 * held to COMMIT, a rolled-back invoice releases its number back -- which is the
 * behaviour a gapless series needs, and the opposite of what a sequence gives.
 */
CREATE OR REPLACE FUNCTION payment.next_invoice_number(p_gstin TEXT, p_fy TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $fn$
DECLARE
  v_prefix TEXT;
  v_next   INT;
BEGIN
  SELECT prefix, last_number + 1 INTO v_prefix, v_next
    FROM payment.invoice_series
   WHERE gstin = p_gstin AND financial_year = p_fy
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No invoice series configured for GSTIN % in %. Configure it before invoicing.', p_gstin, p_fy;
  END IF;

  UPDATE payment.invoice_series SET last_number = v_next
   WHERE gstin = p_gstin AND financial_year = p_fy;

  RETURN format('%s/%s/%s', v_prefix, p_fy, lpad(v_next::text, 5, '0'));
END $fn$;

-- ---------------------------------------------------------------------------
-- 5. Every ledger batch sums to zero
-- ---------------------------------------------------------------------------
-- payment.v_ledger_imbalance is the nightly detective control. A detective
-- control finds an imbalance the morning after it was written; a DEFERRABLE
-- constraint trigger refuses to let the transaction commit at all, which is the
-- difference between an accounting problem and an accounting incident.
CREATE OR REPLACE FUNCTION payment.assert_batch_balances()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_diff NUMERIC(14,2);
BEGIN
  SELECT COALESCE(SUM(debit) - SUM(credit), 0) INTO v_diff
    FROM payment.ledger_entry WHERE batch_id = NEW.batch_id;

  IF v_diff <> 0 THEN
    RAISE EXCEPTION
      'Ledger batch % does not balance: debits minus credits = %. Double entry is not a convention here, it is the invariant.',
      NEW.batch_id, v_diff
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $fn$;

-- DEFERRABLE INITIALLY DEFERRED so the check runs once at COMMIT, when both
-- halves of the entry exist. Checked per row on insert it would fail on the
-- first leg of every balanced pair.
CREATE CONSTRAINT TRIGGER trg_ledger_batch_balances
  AFTER INSERT ON payment.ledger_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payment.assert_batch_balances();

-- ---------------------------------------------------------------------------
-- 6. The vendor side: invoice, goods receipt, payout run
-- ---------------------------------------------------------------------------
CREATE TABLE procurement.vendor_invoice (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES procurement.purchase_order(id),
  vendor_org_id     UUID NOT NULL REFERENCES identity.organization(id),
  invoice_number    TEXT NOT NULL,
  invoice_date      DATE NOT NULL,
  taxable_value     NUMERIC(14,2) NOT NULL CHECK (taxable_value > 0),
  gst_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gst_amount >= 0),
  total             NUMERIC(14,2) NOT NULL CHECK (total > 0),
  document_key      TEXT,
  -- TRUE where the vendor agreement lets us raise the invoice on their behalf.
  self_billed       BOOLEAN NOT NULL DEFAULT FALSE,
  match_status      TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (match_status IN ('PENDING','MATCHED','PRICE_VARIANCE','QTY_VARIANCE','MISSING_GRN','DISPUTED')),
  variance_amount   NUMERIC(14,2),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One vendor cannot issue the same invoice number twice.
  CONSTRAINT uq_vendor_invoice_number UNIQUE (vendor_org_id, invoice_number),
  CONSTRAINT chk_vendor_invoice_total CHECK (total = taxable_value + gst_amount)
);

-- The goods never touch our warehouse, so the receipt is the SEAL-VERIFIED
-- PICKUP at the vendor's door (Phase 8). Until this row exists the match is
-- MISSING_GRN and no payable accrues -- which is the control that stops us
-- paying for machines nobody confirmed were handed over.
CREATE TABLE procurement.goods_receipt (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES procurement.purchase_order(id),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by       UUID REFERENCES identity.user_account(id),
  units_expected    INT NOT NULL CHECK (units_expected > 0),
  units_confirmed   INT NOT NULL CHECK (units_confirmed >= 0),
  seals_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,
  CONSTRAINT uq_grn_po UNIQUE (purchase_order_id),
  CONSTRAINT chk_grn_not_over CHECK (units_confirmed <= units_expected)
);

COMMENT ON TABLE procurement.goods_receipt IS
  'The virtual goods receipt. Written by the seal-verified pickup in Phase 8, not by a warehouse scan -- in this model the goods go vendor to buyer and never reach us.';

CREATE TABLE procurement.payout_run (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number    TEXT UNIQUE NOT NULL,
  cycle         TEXT NOT NULL CHECK (cycle IN ('WEEKLY','T_PLUS_2','MONTHLY','ADHOC')),
  status        TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','PREVIEWED','APPROVED','EXECUTING','COMPLETED','FAILED','CANCELLED')),
  total_net     NUMERIC(14,2) NOT NULL DEFAULT 0,
  vendor_count  INT NOT NULL DEFAULT 0,
  approved_by   UUID REFERENCES identity.user_account(id),
  approved_at   TIMESTAMPTZ,
  executed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Two-person approval above a configured amount: an approved run must name who
  -- approved it and when, or neither.
  CONSTRAINT chk_run_approval CHECK (num_nonnulls(approved_by, approved_at) IN (0, 2))
);

CREATE TABLE procurement.payout_line (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES procurement.payout_run(id) ON DELETE CASCADE,
  vendor_org_id UUID NOT NULL REFERENCES identity.organization(id),
  payable_id    UUID NOT NULL REFERENCES procurement.vendor_payable(id),
  net_amount    NUMERIC(14,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','SENT','PAID','FAILED','ROLLED_FORWARD')),
  utr           TEXT,
  failure_reason TEXT,
  paid_at       TIMESTAMPTZ,
  -- A payable is paid once. Without this a retried run pays a vendor twice.
  CONSTRAINT uq_payout_payable UNIQUE (payable_id),
  CONSTRAINT chk_payout_utr CHECK (status <> 'PAID' OR utr IS NOT NULL)
);

COMMENT ON CONSTRAINT uq_payout_payable ON procurement.payout_line IS
  'One payable, one payout line, ever. A run that is retried after a partial failure must not be able to pay the same payable a second time.';

CREATE INDEX ix_payout_line_run ON procurement.payout_line (run_id);
CREATE INDEX ix_payout_line_vendor ON procurement.payout_line (vendor_org_id, status);
