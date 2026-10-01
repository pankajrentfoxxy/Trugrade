-- The wishlist: machines a buyer has saved to come back to.
--
-- Shaped like the cart, and owned the same way: a row belongs to one person
-- inside one buyer organisation, so two people on the same team keep their
-- own lists, and the org column is what the repository scopes every read by.
--
-- One row per model and grade, not per listing: a card on the storefront is a
-- model at a grade, the thing a buyer saves is that card, and which supply
-- point fills it is decided at checkout, not when it was saved. The same pair
-- twice is the same save, so UNIQUE makes a second save a no-op.
--
-- A model taken out of the catalogue takes its saves with it (ON DELETE
-- CASCADE): a saved item that can no longer be named is not worth keeping.

CREATE TABLE ordering.wishlist_item (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id  uuid        NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES identity.user_account(id),
  sku_id        uuid        NOT NULL REFERENCES catalog.sku(id) ON DELETE CASCADE,
  grade         public.grade_type NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_wishlist_item UNIQUE (buyer_org_id, user_id, sku_id, grade)
);

-- Read newest-first, per person.
CREATE INDEX ix_wishlist_item_owner ON ordering.wishlist_item (buyer_org_id, user_id, added_at DESC);
