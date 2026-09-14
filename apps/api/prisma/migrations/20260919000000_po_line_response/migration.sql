-- Per-line vendor response on purchase orders, partial PO status, dispatch consignment.

DO $$ BEGIN
  CREATE TYPE identity.po_line_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE identity.po_status ADD VALUE 'PARTIAL';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE identity.po_status ADD VALUE 'REJECTED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE procurement.purchase_order_line
  ADD COLUMN IF NOT EXISTS line_status identity.po_line_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL;

ALTER TABLE procurement.purchase_order
  ADD COLUMN IF NOT EXISTS consignment_carrier TEXT NULL,
  ADD COLUMN IF NOT EXISTS consignment_awb TEXT NULL,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ NULL;

UPDATE procurement.purchase_order_line l
   SET line_status = 'ACCEPTED'
  FROM procurement.purchase_order po
 WHERE l.po_id = po.id
   AND po.status IN ('ACKNOWLEDGED', 'DISPATCH_READY', 'DISPATCHED', 'RECEIVED',
                     'INVOICED', 'MATCHED', 'PAYABLE', 'PAID');
