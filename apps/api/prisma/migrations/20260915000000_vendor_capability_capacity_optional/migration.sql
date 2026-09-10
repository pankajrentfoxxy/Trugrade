-- Monthly laptop capacity is no longer collected on vendor registration.
ALTER TABLE vendor.vendor_capability
  ALTER COLUMN monthly_capacity_units DROP NOT NULL;
