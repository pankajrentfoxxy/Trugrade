-- The tier-price overlap guard rejects the most useful tier there is.
--
-- Split out of 20260830000000_phase3_listings rather than appended to it:
-- that migration had already been applied and its checksum recorded, and
-- editing an applied migration is how a team ends up with two databases that
-- disagree about what ran.

-- ---------------------------------------------------------------------------
-- 8. The tier-price guard rejects the most useful tier there is
-- ---------------------------------------------------------------------------
-- PHASE_03_LISTINGS.md quotes the existing constraint verbatim and says to keep
-- it. As written it cannot be kept, because it does not work:
--
--   int4range(min_qty, COALESCE(max_qty, 2147483647), '[]')
--
-- An inclusive upper bound is stored by converting it to the exclusive bound one
-- above, so COALESCE's sentinel becomes 2147483648 and int4 overflows. Every
-- open-ended band -- "50 or more, this price", the top tier of essentially every
-- real price list -- fails on INSERT with 22003, before the exclusion is even
-- consulted. The overlap guard was never wrong; it was simply unreachable for
-- the one row shape that matters most.
--
-- int4range treats a NULL bound as unbounded, which is exactly what "no maximum"
-- means, so max_qty + 1 says it directly: NULL stays NULL and becomes infinity,
-- and a real max_qty + 1 as an exclusive bound is the same closed band as before
-- with no sentinel to overflow.
ALTER TABLE listing.listing_tier_price DROP CONSTRAINT excl_tier_overlap;
ALTER TABLE listing.listing_tier_price ADD CONSTRAINT excl_tier_overlap
  EXCLUDE USING gist (
    listing_id WITH =,
    int4range(min_qty, max_qty + 1) WITH &&
  );
