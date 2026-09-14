-- Vendor team: facility assignments on members, invite facility scope, PO fulfillment site.

CREATE TABLE identity.user_facility (
  user_id     UUID NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL,
  org_id      UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, facility_id)
);

CREATE INDEX ix_user_facility_org ON identity.user_facility (org_id, facility_id);

ALTER TABLE identity.user_invitation
  ADD COLUMN IF NOT EXISTS facility_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE procurement.purchase_order
  ADD COLUMN IF NOT EXISTS fulfillment_facility_id UUID NULL;

CREATE INDEX ix_po_fulfillment_facility
  ON procurement.purchase_order (vendor_org_id, fulfillment_facility_id)
  WHERE fulfillment_facility_id IS NOT NULL;
