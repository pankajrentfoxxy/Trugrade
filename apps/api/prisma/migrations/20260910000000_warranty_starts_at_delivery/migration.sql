-- ===========================================================================
-- T23 — a warranty is a per-serial fact that begins when the buyer takes
-- delivery, and a claim is a numbered thing they quote at us.
--
-- The warranty TERM was already modelled and the retrofit got it right: one
-- number to the customer, `vendor_backed_months + platform_backed_months`
-- internally, `provider` deliberately dropped because we are the sole warrantor
-- for the whole term. Nothing here reopens any of that. What was missing was
-- everything around it.
--
-- 1. NOTHING RECORDED DELIVERY. `logistics.shipment` and
--    `logistics.delivery_task` are both empty and neither has a writer, so there
--    was no instant on the database from which a warranty could start or a
--    48-hour inspection window could run. `sub_order.delivered_at` is that
--    instant, per sub-order because the spec reckons the window per sub-order:
--    three consignments arriving on three days open three windows, and a single
--    order-level timestamp would silently close two of them early.
--
--    It is deliberately NOT a claim that a rider took a proof of delivery. When
--    `logistics` grows a POD writer, that becomes the source and this column is
--    what it stamps. Until then it is written by one operator endpoint and by
--    nothing else, which is at least an honest provenance rather than an
--    inferred one.
--
-- 2. A WARRANTY COULD BE OPENED TWICE. `platform.warranty` has no uniqueness at
--    all, so re-running the delivery writer would give one machine two
--    overlapping covers with different end dates — and the screen would then
--    have to pick one. `provider` is gone, so the cover is genuinely one row per
--    machine and the index says so.
--
-- 3. A CLAIM COULD NOT BE INSERTED AT ALL, AND HAD NO NUMBER.
--    `warranty_claim.status` defaults to 'OPEN', which is not in its own CHECK
--    constraint's eleven-state set — so every insert that did not name a status
--    explicitly failed. Zero rows had ever been written, which is why nobody had
--    hit it. The default becomes 'RAISED', the entry state the set actually
--    contains. The claim also gains the number a buyer quotes at us on the
--    phone, the evidence keys a claim is refused without, and the order line it
--    is answerable against.
-- ===========================================================================

ALTER TABLE ordering.sub_order
  ADD COLUMN delivered_at TIMESTAMPTZ;

COMMENT ON COLUMN ordering.sub_order.delivered_at IS
  'Proof of delivery for this consignment. The 48-hour inspection window and every warranty on its serials are reckoned from here, so it is written once from the injected clock and never from a client-supplied time. A logistics POD writer supersedes this endpoint, not this column.';

-- One cover per machine. `platform.warranty` is materialised at delivery, and a
-- writer that ran twice must be a no-op rather than a doubling.
CREATE UNIQUE INDEX uq_warranty_unit ON platform.warranty (unit_id);

ALTER TABLE platform.warranty_claim
  ADD COLUMN claim_number       TEXT,
  ADD COLUMN order_line_unit_id UUID REFERENCES ordering.order_line_unit(id),
  ADD COLUMN evidence_keys      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

-- The table is empty on every database this has run against, so there is
-- nothing to backfill and the NOT NULL goes on immediately.
ALTER TABLE platform.warranty_claim
  ALTER COLUMN claim_number SET NOT NULL;

CREATE UNIQUE INDEX uq_warranty_claim_number ON platform.warranty_claim (claim_number);
CREATE INDEX ix_warranty_claim_org ON platform.warranty_claim (buyer_org_id, created_at DESC);

-- 'OPEN' is not one of the eleven states `chk_warranty_claim_status_status`
-- allows. The constraint was right and the default was wrong.
ALTER TABLE platform.warranty_claim
  ALTER COLUMN status SET DEFAULT 'RAISED';

COMMENT ON COLUMN platform.warranty_claim.order_line_unit_id IS
  'The order line the claimed machine was sold on. A claim is answerable only against a serial this organisation actually bought, and this is that link — the unit id alone would let a claim outlive the sale it came from.';
