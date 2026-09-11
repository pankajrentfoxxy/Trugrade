-- The buyer order names a SKU + grade slot. The serial is written when the
-- vendor attaches a machine to the matching purchase order.
ALTER TABLE ordering.order_line_unit
  ALTER COLUMN unit_id DROP NOT NULL,
  ALTER COLUMN serial_number DROP NOT NULL;
