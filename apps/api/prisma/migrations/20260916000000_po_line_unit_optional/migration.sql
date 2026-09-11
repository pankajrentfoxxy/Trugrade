-- Vendor attaches a machine after the PO is raised. A line can exist as a
-- SKU + grade slot with no unit yet; Postgres UNIQUE already allows many NULLs.
ALTER TABLE procurement.purchase_order_line
  ALTER COLUMN unit_id DROP NOT NULL;

-- Open POs must be attached on the warehouse screen. Settled ones keep the
-- unit they were raised with.
UPDATE procurement.purchase_order_line l
   SET unit_id = NULL,
       qc_report_id = NULL
  FROM procurement.purchase_order po
 WHERE po.id = l.po_id
   AND po.status IN ('RAISED', 'ACKNOWLEDGED');
