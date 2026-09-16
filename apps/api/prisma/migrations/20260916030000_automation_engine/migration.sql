-- The automation engine: rules as rows, runs as evidence.
--
-- Two things make "it happens by itself" real rather than a claim. The first is
-- that an operator can SEE what fires, what it checks, what it does and what
-- happens when it cannot — so those four are columns, not comments in a service.
-- The second is that every attempt leaves a row whether it worked or not: a rule
-- that silently does nothing is worse than no rule, because nobody goes looking
-- for the order it skipped.
--
-- `failure_note` is NOT NULL on purpose. A rule with no failure path fails
-- silently, and the schema is where that gets refused.

CREATE TABLE platform.automation_rule (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  -- order.confirmed, po.dispatch_ready, carrier.webhook, clock.hourly, ...
  trigger_event   text NOT NULL CHECK (length(btrim(trigger_event)) > 0),
  condition_note  text NOT NULL CHECK (length(btrim(condition_note)) > 0),
  action_note     text NOT NULL CHECK (length(btrim(action_note)) > 0),
  failure_note    text NOT NULL CHECK (length(btrim(failure_note)) > 0),
  -- AUTO fires. SUGGEST prepares and leaves it for a human. MANUAL never fires
  -- itself and is here so the screen can show the step exists and who owns it.
  mode            text NOT NULL CHECK (mode IN ('AUTO', 'SUGGEST', 'MANUAL')),
  enabled         boolean NOT NULL DEFAULT true,
  updated_by      uuid REFERENCES identity.user_account(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.automation_run (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     text NOT NULL REFERENCES platform.automation_rule(id),
  -- What it ran against, in the operator's own vocabulary: an order number, a
  -- PO number, an AWB. Not a uuid, because the run log is read by people.
  object_ref  text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  duration_ms int,
  status      text NOT NULL CHECK (status IN ('OK', 'FAILED', 'SKIPPED')),
  error       text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX ix_autorun_rule ON platform.automation_run (rule_id, started_at DESC);
CREATE INDEX ix_autorun_failed ON platform.automation_run (status, started_at DESC)
  WHERE status = 'FAILED';

COMMENT ON COLUMN platform.automation_rule.failure_note IS
  'What happens when the rule cannot do its job. NOT NULL because a rule with no failure path fails silently.';

-- The twelve hand-offs this platform is removing. Seeded here rather than in the
-- seed script because the rule ids are referenced by code: `R2` is the booking
-- rule whether or not anyone has run a seed.
INSERT INTO platform.automation_rule
  (id, name, trigger_event, condition_note, action_note, failure_note, mode) VALUES
  ('R1', 'Raise purchase orders on a confirmed order', 'order.confirmed',
   'Payment captured, or credit reserved',
   'One purchase order per supply point, sent to the vendor hub',
   'Ops task raised and the order is held at Placed', 'AUTO'),
  ('R2', 'Book a carrier when a PO is packed', 'po.dispatch_ready',
   'Lane is serviceable and a rate card matches',
   'Shipment, AWB, pickup task and delivery task',
   'Ops task BOOKING_FAILED, blocker; the PO stays on the dispatch board', 'AUTO'),
  ('R3', 'Assign an in-house rider to a pickup', 'pickup.created',
   'Carrier is in-house and a rider is on shift in the zone',
   'Rider assigned and the manifest pushed to their app',
   'The pickup stays unassigned on the board for a human', 'AUTO'),
  ('R4', 'Close a delivery on the carrier webhook', 'carrier.webhook',
   'Signature verified and the raw status maps to DELIVERED',
   'Shipment, order and delivery task all marked delivered',
   'The raw event is stored and no status changes', 'AUTO'),
  ('R5', 'Open the return window at delivery', 'shipment.delivered',
   'Always',
   'vendor_payable.eligible_at is set to delivery plus 168 hours',
   'Nothing to fail: the timestamp is derived from the delivery', 'AUTO'),
  ('R6', 'Sweep eligible payables into a payout run', 'clock.hourly',
   'eligible_at has passed, not on hold, and the PO is received',
   'The payable joins the next payout run',
   'The payable waits for the next sweep and says why on the board', 'AUTO'),
  ('R7', 'Raise an NDR task on a failed delivery', 'carrier.webhook',
   'The raw status maps to FAILED',
   'Ops task carrying only the actions this carrier will accept',
   'The attempt is recorded even when the action list cannot be read', 'AUTO'),
  ('R8', 'Quarantine a consignment with a broken seal', 'pickup.completed',
   'Any expected seal was scanned broken',
   'Units quarantined, payable put ON_HOLD, blocker raised',
   'The pickup cannot complete, so nothing moves', 'AUTO'),
  ('R9', 'Schedule a QC visit for a submitted listing', 'listing.submitted',
   'A licensed technician has capacity in the zone',
   'The visit is scheduled at the next free slot',
   'The visit stays unscheduled for a human to place', 'SUGGEST'),
  ('R10', 'Instruct escrow on an approved payout', 'payout.approved',
   'The maker and the checker are different people',
   'Escrow instructed and the ledger batch posted',
   'Refused at the database constraint before anything moves', 'AUTO'),
  ('R11', 'Retry a failed e-invoice', 'einvoice.failed',
   'The failure is transient rather than a dead GSTIN',
   'Retried with backoff, five attempts',
   'A tax task is raised after the fifth attempt', 'AUTO'),
  ('R12', 'Route a high-exposure order to approval', 'order.placed',
   'The reservation takes credit utilisation past 90%',
   'The order goes to approval and finance is notified',
   'Nothing to fail: the order is held rather than confirmed', 'AUTO');
