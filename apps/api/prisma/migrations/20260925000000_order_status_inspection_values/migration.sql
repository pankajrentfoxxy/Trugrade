-- Two order states the order-first inspection flow needs, in their own file.
--
-- A value added to an enum cannot be referenced inside the transaction that
-- added it, and `prisma migrate deploy` wraps each file in one. So the values
-- land here and the first statement that uses them lives in the next file.
--
-- AWAITING_INSPECTION: placed, stock held, no technician yet.
-- AWAITING_VERIFICATION: every machine has a serial and an inspection; ops has
-- not yet verified them. Between the two sits the existing QC_IN_PROGRESS.
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'AWAITING_INSPECTION';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'AWAITING_VERIFICATION';
