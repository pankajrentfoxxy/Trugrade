-- One cart per buyer.
--
-- Named, parallel carts are withdrawn: a person has exactly one OPEN cart, the
-- session identifies it, and nothing in the product asks them to pick one.
-- The rule is held by a partial unique index on (buyer_org_id, user_id) WHERE
-- status = 'OPEN', which replaces the per-name index and closes the same
-- two-tabs race that one did.
--
-- Existing data is collapsed first, in place: for each person the most recently
-- used open cart is kept (a cart with a live checkout hold wins outright, so a
-- checkout in flight is never orphaned), every other open cart's lines move
-- into it, and the emptied carts are marked ABANDONED. A line for the same
-- offer in two carts becomes one line at the larger quantity; the cart shows
-- the shortfall, if any, on its next read exactly as it does today.
--
-- `name` stays on the table. It is history on CONVERTED rows and it costs
-- nothing; only its default is ever written from here on.

CREATE TEMP TABLE cart_collapse AS
  WITH ranked AS (
    SELECT c.id,
           row_number() OVER (
             PARTITION BY c.buyer_org_id, c.user_id
             ORDER BY (h.cart_id IS NOT NULL) DESC, c.updated_at DESC, c.created_at DESC
           ) AS rn,
           first_value(c.id) OVER (
             PARTITION BY c.buyer_org_id, c.user_id
             ORDER BY (h.cart_id IS NOT NULL) DESC, c.updated_at DESC, c.created_at DESC
           ) AS keep_id
      FROM ordering.cart c
      LEFT JOIN ordering.checkout_hold h ON h.cart_id = c.id
     WHERE c.status = 'OPEN'
  )
  SELECT id, keep_id FROM ranked WHERE rn > 1;

-- The same offer in the kept cart and a losing one: the kept line takes the
-- larger quantity, then the losing line is dropped so the move below cannot
-- collide with UNIQUE (cart_id, listing_id).
UPDATE ordering.cart_item k
   SET qty = GREATEST(k.qty, l.qty)
  FROM ordering.cart_item l
  JOIN cart_collapse x ON l.cart_id = x.id
 WHERE k.cart_id = x.keep_id
   AND k.listing_id = l.listing_id;

DELETE FROM ordering.cart_item l
 USING cart_collapse x, ordering.cart_item k
 WHERE l.cart_id = x.id
   AND k.cart_id = x.keep_id
   AND k.listing_id = l.listing_id;

UPDATE ordering.cart_item l
   SET cart_id = x.keep_id
  FROM cart_collapse x
 WHERE l.cart_id = x.id;

UPDATE ordering.cart
   SET status = 'ABANDONED'
 WHERE id IN (SELECT id FROM cart_collapse);

DROP TABLE cart_collapse;

DROP INDEX IF EXISTS ordering.uq_cart_active_name;

CREATE UNIQUE INDEX uq_cart_one_open_per_buyer
    ON ordering.cart (buyer_org_id, user_id)
 WHERE status = 'OPEN';
