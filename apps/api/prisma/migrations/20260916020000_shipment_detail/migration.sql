-- Why this shipment went by this carrier, kept on the shipment.
--
-- `RoutingService` answers with the carrier it chose AND the carriers it
-- excluded with the reason for each. "Why did this go by DTDC" is a question ops
-- asks about a consignment that has already moved, and an answer reconstructed
-- afterwards from today's rate cards is not an answer about yesterday's booking:
-- the cards change, the serviceability table is re-synced, and the reasoning is
-- gone. It is also where a booking that FAILED keeps the carrier's error, which
-- is a fact ops needs to see rather than an absence.
ALTER TABLE logistics.shipment
  ADD COLUMN detail jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN logistics.shipment.detail IS
  'Routing reasoning at booking time: chosen carrier, excluded carriers with reasons, and any booking error. Written once, never a working column.';

-- One OUTBOUND shipment per consignment. `ix_shipment_sub` already indexes the
-- pair; this makes the retry safe rather than merely fast, because an AWB
-- created twice is a second real invoice from the carrier.
CREATE UNIQUE INDEX uq_shipment_sub_leg
  ON logistics.shipment (sub_order_id, leg)
  WHERE sub_order_id IS NOT NULL;
