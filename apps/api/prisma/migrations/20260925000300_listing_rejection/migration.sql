-- Ops can now refuse a listing, and the vendor is told why.
--
-- REJECTED has been in `listing_status` since the baseline and nothing ever
-- wrote it; the approval step that produces it exists now, and a refusal with
-- no reason on the row is a refusal the vendor cannot act on.
ALTER TABLE listing.listing
  ADD COLUMN rejected_at      TIMESTAMPTZ,
  ADD COLUMN rejection_reason TEXT,
  ADD CONSTRAINT chk_listing_rejection_complete
    CHECK ((rejected_at IS NULL) = (rejection_reason IS NULL));
