-- A purchase-order number was made mandatory by a card that asked nothing.
--
-- The buyer profile's Documents card wrote `poRequired: true` from a DEFAULTS
-- block the buyer never saw, and `CheckoutFlow` refuses the REFERENCE step when
-- the preference is on. Most Indian SMEs do not raise purchase orders, so the
-- default was wrong for the majority and invisible to all of them.
--
-- The value never reached `customer.org_preference`: the DOCUMENTS step has no
-- promotion, so the column has been FALSE for every organisation throughout and
-- no live checkout was ever blocked by this. What exists is the stale draft,
-- which would have become true the moment anybody wired that promotion. This
-- clears the landmine rather than a live setting.
--
-- Kept for any organisation that has actually raised a purchase order with us:
-- their answer was right even if nobody asked them for it.

UPDATE kyc.onboarding_progress p
   SET draft_json = jsonb_set(p.draft_json::jsonb, '{poRequired}', 'false'::jsonb)
 WHERE p.step_code = 'DOCUMENTS'
   AND p.draft_json IS NOT NULL
   AND (p.draft_json::jsonb ->> 'poRequired') = 'true'
   AND NOT EXISTS (
     SELECT 1
       FROM ordering."order" o
      WHERE o.buyer_org_id = p.org_id
        AND o.buyer_po_number IS NOT NULL
        AND btrim(o.buyer_po_number) <> ''
   );

-- Same rule for any preference row that had been switched on, so the two halves
-- can never disagree. None are true today; this is written so a re-run on a
-- database where one is says the same thing.
UPDATE customer.org_preference c
   SET po_required = FALSE
 WHERE c.po_required
   AND NOT EXISTS (
     SELECT 1
       FROM ordering."order" o
      WHERE o.buyer_org_id = c.org_id
        AND o.buyer_po_number IS NOT NULL
        AND btrim(o.buyer_po_number) <> ''
   );
