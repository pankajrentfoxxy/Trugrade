-- ##########################################################################
-- `vendor_profile.business_category` refused two of the five answers the
-- vendor registration form offers.
--
-- The baseline CHECK allows REFURBISHER, DEALER, ITAD, CORPORATE_LIQUIDATOR
-- and OEM_PARTNER. Step 2 of the vendor flow offers REFURBISHER, ITAD,
-- LEASING, TRADER and OEM_PARTNER — its picklist was written believing the
-- column was free text, and nothing ever wrote to it, so the disagreement was
-- invisible until step promotion started writing the answer.
--
-- Widened rather than mapped. "Leasing company — we sell off-lease returns"
-- is not a CORPORATE_LIQUIDATOR and a trader is only approximately a DEALER;
-- silently rewriting a supplier's answer into the nearest allowed value would
-- put a description on their application that they did not give.
--
-- Nothing is removed: the two unused baseline values stay, because a
-- constraint that drops values is a constraint that fails on existing rows.
-- ##########################################################################

ALTER TABLE vendor.vendor_profile DROP CONSTRAINT IF EXISTS vendor_profile_business_category_check;

ALTER TABLE vendor.vendor_profile ADD CONSTRAINT vendor_profile_business_category_check
  CHECK (business_category IN
    ('REFURBISHER','DEALER','ITAD','CORPORATE_LIQUIDATOR','OEM_PARTNER','LEASING','TRADER'));

COMMENT ON COLUMN vendor.vendor_profile.business_category IS
  'What the supplier is, in their own words from vendor registration step 2. The seven values are the union of the baseline set and the five the form offers; they belong in platform_config beside the other option lists.';
