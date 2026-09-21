-- Consignments a vendor acknowledged before the acknowledgement moved anything.
--
-- `OrderPropagationService.propagate` was wired into the vendor's response on
-- 16 Sep 2026 (78d7c25). Every purchase order acknowledged before that day had
-- its `procurement.purchase_order` row moved to ACKNOWLEDGED and a
-- `PO_VENDOR_RESPONSE` event written, and nothing else: `ordering.sub_order`
-- stayed at its CONFIRMED default, its order lines with it, and the order never
-- rolled up. To the buyer that read as "we have not started", and to the
-- buyer's own delivery confirmation it read as "never dispatched", for
-- machines a vendor had agreed to supply days earlier.
--
-- This applies, once, exactly what `propagate` would have done for a full
-- acceptance: the consignment and its lines become VENDOR_ACCEPTED, the order
-- rolls up when every live consignment has, and the timeline gets the
-- transition at the instant the vendor actually acknowledged, not at the
-- instant this ran. Partial responses are not touched — `propagate` also
-- cancels refused slots and releases their machines, and there is no PARTIAL
-- purchase order older than the fix to do that for.
--
-- A purchase order that has since been DISPATCHED is carried to DISPATCHED
-- the same way, because `dispatchPo` only began moving the consignment on the
-- same day this file was written.

-- 1. The consignments, remembered so the later steps agree on the set.
CREATE TEMP TABLE repaired_consignment AS
SELECT so.id            AS sub_order_id,
       so.order_id,
       so.status::text  AS from_status,
       CASE WHEN po.status IN ('DISPATCHED', 'RECEIVED', 'INVOICED', 'MATCHED', 'PAYABLE', 'PAID')
            THEN 'DISPATCHED' ELSE 'VENDOR_ACCEPTED' END AS to_status,
       po.acknowledged_at,
       po.dispatched_at
  FROM ordering.sub_order so
  JOIN procurement.purchase_order po ON po.id = so.purchase_order_id
 WHERE po.status IN ('ACKNOWLEDGED', 'DISPATCH_READY', 'DISPATCHED', 'RECEIVED', 'INVOICED', 'MATCHED', 'PAYABLE', 'PAID')
   AND (
        so.status = 'CONFIRMED'::public.order_status
     OR (so.status = 'VENDOR_ACCEPTED'::public.order_status
         AND po.status IN ('DISPATCHED', 'RECEIVED', 'INVOICED', 'MATCHED', 'PAYABLE', 'PAID'))
   );

-- 2. The consignment. `accepted_at` is the vendor's instant, as `propagate` stamps it.
UPDATE ordering.sub_order so
   SET status      = r.to_status::public.order_status,
       accepted_at = COALESCE(so.accepted_at, r.acknowledged_at)
  FROM repaired_consignment r
 WHERE so.id = r.sub_order_id;

-- 3. Its lines, as `propagate` does: everything not already cancelled.
UPDATE ordering.order_line ol
   SET status = r.to_status::public.order_status
  FROM repaired_consignment r
 WHERE ol.sub_order_id = r.sub_order_id
   AND ol.status <> 'CANCELLED'::public.order_status;

-- 4. The timeline. Scoped to the consignment and dated when it happened, so
--    the buyer's tracking page shows the acknowledgement on the day the vendor
--    made it. The note says this row was reconstructed.
INSERT INTO ordering.order_event
       (order_id, sub_order_id, event_type, from_status, to_status, note, occurred_at, actor_id)
SELECT r.order_id,
       r.sub_order_id,
       'ORDER_STATUS',
       r.from_status,
       r.to_status,
       CASE WHEN r.to_status = 'DISPATCHED'
            THEN 'Dispatched from the supply point. Recorded on 21 Sep 2026 for a dispatch made before consignments were updated automatically.'
            ELSE 'The supply point has confirmed it will supply this consignment. Recorded on 21 Sep 2026 for an acknowledgement made before consignments were updated automatically.'
       END,
       COALESCE(CASE WHEN r.to_status = 'DISPATCHED' THEN r.dispatched_at END, r.acknowledged_at, now()),
       NULL
  FROM repaired_consignment r;

-- 5. The order rolls up on the same rule as `rollUpOrder`: every live
--    consignment accepted means the order is accepted; every live consignment
--    gone means the order has gone.
UPDATE ordering."order" o
   SET status = 'VENDOR_ACCEPTED'::public.order_status
 WHERE o.id IN (SELECT DISTINCT order_id FROM repaired_consignment)
   AND o.status = 'CONFIRMED'::public.order_status
   AND NOT EXISTS (
     SELECT 1 FROM ordering.sub_order s
      WHERE s.order_id = o.id
        AND s.status NOT IN ('VENDOR_ACCEPTED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'));

UPDATE ordering."order" o
   SET status = 'DISPATCHED'::public.order_status
 WHERE o.id IN (SELECT DISTINCT order_id FROM repaired_consignment)
   AND o.status IN ('CONFIRMED', 'VENDOR_ACCEPTED')
   AND NOT EXISTS (
     SELECT 1 FROM ordering.sub_order s
      WHERE s.order_id = o.id
        AND s.status NOT IN ('DISPATCHED', 'DELIVERED', 'CANCELLED'));

DROP TABLE repaired_consignment;
