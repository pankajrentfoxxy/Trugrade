-- A purchase order is a vendor's stock at ONE pickup address, not a vendor's
-- stock on an order.
--
-- `uq_po_order_vendor` pinned it to one PO per vendor per order, so a vendor
-- holding machines in two warehouses received one document covering both. That
-- document cannot be acted on: the Pune stock cannot be dispatched on the
-- Gurugram acknowledgement, the two consignments are two lanes with two freight
-- quotes and two dispatch clocks, and where the vendor holds more than one
-- GSTIN they are two places of supply.
--
-- `ordering.sub_order` was never pinned that way — it is indexed on
-- (vendor_org_id, status) only — so the sub-order split could already be finer
-- than the PO split, and was computed separately from the same data. The unique
-- index below and `purchase_order_id` make the two one thing: one sub-order,
-- one PO, walked in either direction.
--
-- Column names here are the ones `identity.org_address` actually has: `org_id`,
-- `type` (an address_type enum, PICKUP among its members) and `is_default`.

ALTER TABLE procurement.purchase_order
  ADD COLUMN pickup_address_id uuid NULL REFERENCES identity.org_address(id),
  ADD COLUMN supply_point_label text NULL;

COMMENT ON COLUMN procurement.purchase_order.supply_point_label IS
  'What a BUYER may see for this consignment: "Supply Point A - Gurugram". Sequenced per order, so the same warehouse is A on one order and B on another and nothing correlates across orders. Never the vendor''s name.';

ALTER TABLE ordering.sub_order
  ADD COLUMN pickup_address_id uuid NULL REFERENCES identity.org_address(id),
  ADD COLUMN purchase_order_id uuid NULL REFERENCES procurement.purchase_order(id);

-- Back-fill: every existing PO is its vendor's primary pickup address. Rows
-- whose vendor has no pickup address on file stay NULL rather than pointing at
-- an address that is not theirs — the new unique constraint treats NULL as
-- distinct, which preserves exactly the behaviour those rows have today.
UPDATE procurement.purchase_order po
   SET pickup_address_id = (
     SELECT a.id
       FROM identity.org_address a
      WHERE a.org_id = po.vendor_org_id
        AND a.type = 'PICKUP'
        AND a.is_active
      ORDER BY a.is_default DESC, a.created_at ASC
      LIMIT 1);

UPDATE ordering.sub_order so
   SET pickup_address_id = po.pickup_address_id,
       purchase_order_id = po.id
  FROM procurement.purchase_order po
 WHERE po.order_id = so.order_id
   AND po.vendor_org_id = so.vendor_org_id;

ALTER TABLE procurement.purchase_order
  DROP CONSTRAINT uq_po_order_vendor,
  ADD CONSTRAINT uq_po_order_vendor_pickup
    UNIQUE (order_id, vendor_org_id, pickup_address_id);

CREATE UNIQUE INDEX uq_suborder_order_vendor_pickup
  ON ordering.sub_order (order_id, vendor_org_id, pickup_address_id);

CREATE INDEX ix_suborder_po ON ordering.sub_order (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;
