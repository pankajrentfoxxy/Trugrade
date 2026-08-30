-- ==========================================================================
-- T24 — returns inside the 48-hour window.
--
-- `platform.return_request` has never had a writer, so three things it needs
-- before it gets one were never noticed.
--
-- 1. A SEAL BROKEN ON ARRIVAL IS ITS OWN REASON. `03_UX_SPEC.md` §3A.4 lists six
--    return reasons and the CHECK holds six codes, but they are not the same six:
--    the spec's "seal broken on arrival" had nowhere to go, and the nearest fit
--    (TRANSIT_DAMAGE) already means "physical damage". Folding them together
--    would lose the one distinction that decides who pays — a broken seal is a
--    custody failure between the supply point and the door, and it is the reason
--    Rule 7(4) take-back is ours and non-delegable. It is also the code the
--    buyer's own seal check raises automatically, so it must exist before that
--    button does.
--
-- 2. NOTHING STOPPED TWO OPEN RETURNS ON ONE MACHINE. The delivery screen opens
--    a discrepancy automatically when a seal is found broken, which is a button a
--    person can press twice and a request the browser can retry. Making that
--    idempotent in the service alone is the shape T23 found on `platform.warranty`
--    — a uniqueness rule enforced only in application code, on a table whose only
--    caller is a button. Partial, on the states that are still live: a machine
--    whose return was rejected last month may of course be returned again.
--
-- 3. EVERY QUERY ON THIS TABLE IS ORG-SCOPED AND THERE WAS NO INDEX FOR IT.
-- ==========================================================================

DO $$
DECLARE existing text;
BEGIN
  SELECT conname INTO existing
    FROM pg_constraint
   WHERE conrelid = 'platform.return_request'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%reason_code%';
  IF existing IS NOT NULL THEN
    EXECUTE format('ALTER TABLE platform.return_request DROP CONSTRAINT %I', existing);
  END IF;
END $$;

ALTER TABLE platform.return_request
  ADD CONSTRAINT chk_return_request_reason_code CHECK (reason_code IN
    ('DOA','SPEC_MISMATCH','GRADE_MISMATCH','TRANSIT_DAMAGE','WRONG_ITEM',
     'SHORT_SHIPMENT','SEAL_BROKEN'));

COMMENT ON COLUMN platform.return_request.reason_code IS
  'The six reasons 03_UX_SPEC.md §3A.4 offers the buyer, mapped one to one: '
  'not as described = GRADE_MISMATCH, physical damage = TRANSIT_DAMAGE, '
  'functional failure = DOA, wrong model or spec = SPEC_MISMATCH or WRONG_ITEM, '
  'seal broken on arrival = SEAL_BROKEN, short shipment = SHORT_SHIPMENT.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_return_open_per_unit
  ON platform.return_request (order_line_unit_id)
  WHERE status NOT IN ('REJECTED','CANCELLED','REFUNDED','REPLACED','RETURNED_TO_BUYER');

CREATE INDEX IF NOT EXISTS ix_return_buyer
  ON platform.return_request (buyer_org_id, raised_at DESC);
