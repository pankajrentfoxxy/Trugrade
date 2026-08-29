-- T16 — the order-confirmation transaction needs two human-readable numbers.
--
-- Sequences, not `MAX(...) + 1`. The latter needs a table lock to be correct
-- under concurrency, and the whole point of PHASE_06 Task 3 is that two buyers
-- run this transaction at the same instant.
--
-- These numbers MAY gap. A rolled-back checkout burns one, and that is the right
-- trade: an order number is an identifier, not a statutory series. Gapless
-- numbering is required for `payment.invoice` (VR-146) and is done there with
-- `pg_advisory_xact_lock`, which costs a serialisation point this path must not
-- pay.
CREATE SEQUENCE IF NOT EXISTS ordering.order_number_seq  AS BIGINT START 1;
CREATE SEQUENCE IF NOT EXISTS procurement.po_number_seq  AS BIGINT START 1;

COMMENT ON SEQUENCE ordering.order_number_seq IS
  'Feeds order_number TT-YY-NNNNN. Gaps are expected and are not a defect: a rolled-back checkout consumes a value.';
COMMENT ON SEQUENCE procurement.po_number_seq IS
  'Feeds po_number PO-YY-NNNNN. Same gap semantics as ordering.order_number_seq.';

-- The buyer-facing purchase-order reference. `org_preference.po_required` makes
-- it mandatory, and Indian corporates will not process an invoice without it,
-- so it is on the order and it prints. `ordering."order".buyer_po_number`
-- already exists; what was missing is a bound, so a paste of a whole email
-- cannot land in a field that goes on an invoice.
ALTER TABLE ordering."order"
  ADD CONSTRAINT chk_buyer_po_number
  CHECK (buyer_po_number IS NULL OR length(btrim(buyer_po_number)) BETWEEN 1 AND 40);

-- A held order has a deadline, and an order with no deadline holds stock for
-- ever. The hold is the only reason `CREATED` and `AWAITING_APPROVAL` keep
-- units out of `qty_available`, so a row in one of those states without an
-- expiry is a silent inventory leak. Made structural rather than remembered.
ALTER TABLE ordering."order"
  ADD CONSTRAINT chk_held_order_has_expiry
  CHECK (status NOT IN ('CREATED','AWAITING_APPROVAL','PAYMENT_PENDING')
         OR stock_hold_expires_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- The twenty-minute checkout hold
-- ---------------------------------------------------------------------------
-- PHASE_06 Task 3: "Stock hold at checkout entry is 20 minutes, released by a
-- job on expiry." PHASE_05 Task 6 is equally clear that a CART reserves nothing.
-- So the hold begins where the buyer leaves the cart, and it needs somewhere to
-- live that is neither of those two things.
--
-- It is not an order. An order that exists only because somebody opened a page
-- would put half-finished rows in front of every report that counts orders, and
-- `ordering."order"` has six NOT NULL columns the buyer has not chosen yet.
--
-- What the hold IS: the set of exact machines taken off sale for one cart, with
-- a deadline. `unit_id UNIQUE` means one machine can be held for one cart, which
-- is the same structural guarantee `order_line_unit.unit_id` gives an order.
-- Releasing deletes the rows; the audit trail of what happened to each machine
-- is `listing.stock_movement`, which is append-only and is the right place for
-- it.
CREATE TABLE ordering.checkout_hold (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One live hold per cart. A second checkout tab must join the first hold, not
  -- take a second one against the same lines.
  cart_id      UUID NOT NULL UNIQUE REFERENCES ordering.cart(id) ON DELETE CASCADE,
  buyer_org_id UUID NOT NULL REFERENCES identity.organization(id),
  user_id      UUID NOT NULL REFERENCES identity.user_account(id),
  -- Mandatory. A hold with no deadline is an inventory leak with a nice name.
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_hold_expiry ON ordering.checkout_hold (expires_at);

CREATE TABLE ordering.checkout_hold_unit (
  hold_id    UUID NOT NULL REFERENCES ordering.checkout_hold(id) ON DELETE CASCADE,
  unit_id    UUID NOT NULL UNIQUE REFERENCES listing.unit(id),
  listing_id UUID NOT NULL REFERENCES listing.listing(id),
  PRIMARY KEY (hold_id, unit_id)
);

COMMENT ON TABLE ordering.checkout_hold IS
  'The twenty-minute hold taken when a buyer enters checkout. Released by ordering.HoldExpiryService on expiry, by the buyer leaving checkout, or by the order transaction consuming it. Deleted on release -- listing.stock_movement is the permanent record.';
