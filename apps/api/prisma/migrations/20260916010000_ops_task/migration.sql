-- The worklist, and the one order status that was missing.
--
-- `ordering.order_event` is an append-only narrative of what happened, written
-- for the buyer's tracking page: it has no assignee, no status and no
-- resolution. A worklist needs all three, so this is a second table rather than
-- a widening of that one. Every "raise an ops task" in the build plan is a row
-- here, and the Today screen is a read of it.
--
-- `PARTIALLY_CONFIRMED` is added in its own migration because Postgres will not
-- let a value added to an enum be USED in the transaction that adds it. Nothing
-- in this file uses it; the propagation code does, on a later connection.
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'PARTIALLY_CONFIRMED' AFTER 'CONFIRMED';

CREATE TABLE ordering.ops_task (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- PO_PARTIAL_REJECT | PO_REJECTED | BOOKING_FAILED | NDR | SEAL_BROKEN | ...
  kind             text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('BLOCKER', 'ATTENTION', 'FYI')),
  order_id         uuid NULL REFERENCES ordering."order"(id) ON DELETE CASCADE,
  purchase_order_id uuid NULL REFERENCES procurement.purchase_order(id),
  -- No FK: `logistics.shipment` rows are written by a module that cannot be
  -- imported from here, and a task about a shipment must survive a shipment
  -- that was never booked — which is exactly what BOOKING_FAILED is.
  shipment_id      uuid NULL,
  subject          text NOT NULL CHECK (length(btrim(subject)) >= 3),
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_role    text NULL,
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  resolved_by      uuid NULL REFERENCES identity.user_account(id),
  resolved_at      timestamptz NULL,
  resolution_note  text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- A resolution is a claim about who and when. Half of it is not a resolution.
  CONSTRAINT chk_ops_task_resolved CHECK (
    (status = 'OPEN' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status <> 'OPEN' AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX ix_ops_task_open ON ordering.ops_task (status, severity, created_at DESC);
CREATE INDEX ix_ops_task_order ON ordering.ops_task (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX ix_ops_task_po ON ordering.ops_task (purchase_order_id) WHERE purchase_order_id IS NOT NULL;

COMMENT ON TABLE ordering.ops_task IS
  'The operator worklist: what somebody must DO. ordering.order_event stays the append-only record of what happened.';
