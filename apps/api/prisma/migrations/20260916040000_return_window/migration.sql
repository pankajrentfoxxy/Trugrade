-- The return window, and the payout run that has never run.
--
-- **Two windows, deliberately not one.** `ordering.inspection_window_hours` is
-- 48 and answers "the buyer may dispute the grade"; this key answers "the buyer
-- may send it back". Payment waits for the longer of the two — the return window
-- — but overloading the inspection key would mean changing one changes the
-- other, and they will not move together: the inspection window is a QC promise
-- and the return window is a commercial one.
-- No ON CONFLICT: `platform_config` is versioned by `effective_from` and `key`
-- carries no unique constraint — `platform.v_current_config` is what resolves a
-- key to its live row. A guarded insert is therefore the idempotent form.
INSERT INTO platform.platform_config (key, value_json, description)
SELECT 'ordering.return_window_hours', '168'::jsonb,
       'Seven days from delivery. A vendor payable is not eligible until it closes.'
 WHERE NOT EXISTS (
   SELECT 1 FROM platform.platform_config WHERE key = 'ordering.return_window_hours'
 );

-- `vendor_payable` already carries `eligible_at`; nothing has ever written it.
-- What it lacked was a reason for a hold, which the return path needs: a payable
-- that goes back to null has to say why, or the vendor's screen shows a clock
-- that silently stopped.
ALTER TABLE procurement.vendor_payable
  ADD COLUMN IF NOT EXISTS hold_reason text;

COMMENT ON COLUMN procurement.vendor_payable.eligible_at IS
  'Delivery + ordering.return_window_hours. Written by the one delivery path; null while a return is open.';

-- A payout run needs a maker and a checker, and the two may not be the same
-- person. The CHECK is the control: a bug in a service cannot produce a
-- self-approved run, because the database refuses the row.
ALTER TABLE procurement.payout_run
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES identity.user_account(id),
  ADD COLUMN IF NOT EXISTS released_by uuid REFERENCES identity.user_account(id),
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

ALTER TABLE procurement.payout_run
  ADD CONSTRAINT ck_payout_maker_is_not_checker
    CHECK (approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by);

CREATE INDEX IF NOT EXISTS ix_payout_run_status ON procurement.payout_run (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_payout_line_run ON procurement.payout_line (run_id);
CREATE INDEX IF NOT EXISTS ix_payable_eligible
  ON procurement.vendor_payable (eligible_at)
  WHERE eligible_at IS NOT NULL AND status NOT IN ('PAID', 'ON_HOLD', 'CANCELLED');
