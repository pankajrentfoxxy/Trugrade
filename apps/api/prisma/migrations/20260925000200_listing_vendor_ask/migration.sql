-- The vendor's ask gets a column of its own.
--
-- It used to live on the units (`unit.vendor_ask_price`) and, for a draft with
-- no units yet, in `listing.unit_price` until the pricing engine overwrote that
-- column with our selling price. A listing now goes live with no units at all,
-- so the moment it was priced the ask would have been gone — and the next
-- reprice would have margined our own margin, and the purchase order would have
-- had nothing honest to pay the vendor from.
ALTER TABLE listing.listing ADD COLUMN vendor_ask_price NUMERIC(14,2) CHECK (vendor_ask_price > 0);

UPDATE listing.listing l
   SET vendor_ask_price = COALESCE(
         (SELECT max(u.vendor_ask_price) FROM listing.unit u WHERE u.listing_id = l.id),
         l.unit_price);

COMMENT ON COLUMN listing.listing.vendor_ask_price IS
  'The net payout the vendor asked for per machine. Vendor-facing and PO-facing; never in a buyer payload. unit_price is OUR selling price once the listing is priced.';
