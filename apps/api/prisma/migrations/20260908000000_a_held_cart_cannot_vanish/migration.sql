-- Deleting a cart used to leak reserved stock, permanently.
--
-- `checkout_hold.cart_id` was ON DELETE CASCADE, so removing a cart deleted the
-- hold row with it — silently, and without `HoldService.release` ever running.
-- The units it was holding stay RESERVED with nothing left pointing at them:
-- not sellable, not ordered, and not reachable by the expiry job, which walks
-- `checkout_hold` rows that no longer exist. Stock simply disappears from the
-- platform.
--
-- It is not hypothetical. A crashed screenshot run did exactly this during T16
-- and the next run was refused on screen for want of units.
--
-- CASCADE is the right instinct for a child row that is only bookkeeping. A hold
-- is not bookkeeping: it is the record that something in the physical world is
-- set aside, and the row is what gives it back.
--
-- So the delete is refused while the hold is LIVE, and allowed once it is not.
-- A trigger rather than ON DELETE RESTRICT because "live" is a question about
-- `expires_at`, which a foreign key cannot ask — RESTRICT would also refuse to
-- tidy a cart whose hold expired days ago, which is a chore nobody would thank
-- us for.

CREATE OR REPLACE FUNCTION ordering.refuse_delete_of_held_cart() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_expires TIMESTAMPTZ;
BEGIN
  SELECT h.expires_at INTO v_expires
    FROM ordering.checkout_hold h
   WHERE h.cart_id = OLD.id AND h.expires_at > now()
   LIMIT 1;

  IF v_expires IS NOT NULL THEN
    RAISE EXCEPTION
      'Cart % is holding stock until %. Release the hold before deleting it, or the machines it reserved stay reserved with nothing left to give them back.',
      OLD.id, v_expires
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN OLD;
END $fn$;

COMMENT ON FUNCTION ordering.refuse_delete_of_held_cart IS
  'Refuses to delete a cart while a live checkout_hold points at it. The hold row is what returns reserved units to sale; deleting it without releasing strands them.';

DROP TRIGGER IF EXISTS trg_refuse_delete_of_held_cart ON ordering.cart;
CREATE TRIGGER trg_refuse_delete_of_held_cart
  BEFORE DELETE ON ordering.cart
  FOR EACH ROW EXECUTE FUNCTION ordering.refuse_delete_of_held_cart();

-- ---------------------------------------------------------------------------
-- The detective control, and the repair
-- ---------------------------------------------------------------------------
-- Units already stranded by the old behaviour: RESERVED, with no order line and
-- no live hold. Nothing else in the system can distinguish these from units
-- legitimately reserved a moment ago, which is why they were invisible.
CREATE OR REPLACE VIEW ordering.v_stranded_reserved_unit AS
  SELECT u.id AS unit_id, u.serial_number, u.listing_id, u.created_at
    FROM listing.unit u
   WHERE u.status = 'RESERVED'
     AND NOT EXISTS (SELECT 1 FROM ordering.order_line_unit olu WHERE olu.unit_id = u.id)
     AND NOT EXISTS (
       SELECT 1 FROM ordering.checkout_hold h
        WHERE h.expires_at > now()
          AND h.cart_id IN (SELECT ci.cart_id FROM ordering.cart_item ci
                             JOIN listing.unit u2 ON u2.listing_id = ci.listing_id
                            WHERE u2.id = u.id));

COMMENT ON VIEW ordering.v_stranded_reserved_unit IS
  'RESERVED units with neither an order line nor a live hold. Must return zero rows: a row here is stock the platform has taken off sale and forgotten about.';
