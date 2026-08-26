-- PHASE_01 exit criterion: "A bank-account change triggers penny-drop, a 24-hour
-- freeze, and an owner alert." (docs/PHASE_01_IDENTITY_ONBOARDING.md line 183,
-- and the change-control matrix at line 155.)
--
-- The penny-drop existed. The freeze and the alert did not exist anywhere — the
-- `kyc.bank_account.frozen_until` column has been in the baseline since day one
-- with nothing on either side of it: nothing writes it, and nothing reads it
-- before moving money. A column that is never enforced is documentation, not a
-- control.
--
-- This migration supplies the reading half. `VerificationService.changeBankAccount`
-- supplies the writing half.
--
-- WHY A TRIGGER RATHER THAN A CHECK IN THE PAYOUT RUN
--
-- This is an account-takeover control. The threat is an attacker who has a
-- session, redirects the payout account to their own, and collects the next run.
-- The freeze exists so a human has a day to notice. A guard living in the payout
-- service would be a guard the payout service can forget — and there is no payout
-- service yet, so it would be a guard written for a caller that does not exist
-- and then quietly dropped when that caller is finally written by someone who
-- never read this file. A trigger binds whoever writes the row, including a
-- console session and a repair script at 3am, which are the two paths most likely
-- to move money past a control.

-- ---------------------------------------------------------------------------
-- 1. How long the freeze lasts
-- ---------------------------------------------------------------------------
-- Effective-dated like every other tunable number, so raising it during an
-- incident is a config row rather than a deploy, and the old value stays
-- readable when someone later asks why a payout on the 4th went out in 24 hours.
INSERT INTO platform.platform_config (key, value_json, description, effective_from)
VALUES (
  'kyc.bank_change_freeze_hours',
  '24'::jsonb,
  'PHASE_01 — payouts to a bank account are refused for this many hours after it is changed, so the owner has time to react to a change they did not make. Raise it, never lower it below the time it takes support to answer a phone.',
  now()
)
ON CONFLICT (key, effective_from) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The refusal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kyc.reject_payout_to_frozen_account() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_frozen_until TIMESTAMPTZ;
  v_last4        TEXT;
BEGIN
  -- INSERT is always a new payout. On UPDATE only the transitions that actually
  -- move money are refused: a run must still be allowed to mark a payout FAILED
  -- or attach a failure reason while the account is frozen, and refusing that
  -- would leave rows stuck mid-run for a day for no security benefit.
  IF TG_OP = 'UPDATE'
     AND NOT (NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL)
     AND NOT (NEW.utr IS NOT NULL AND NEW.utr IS DISTINCT FROM OLD.utr)
  THEN
    RETURN NEW;
  END IF;

  SELECT frozen_until, account_number_last4
    INTO v_frozen_until, v_last4
    FROM kyc.bank_account
   WHERE id = NEW.bank_account_id;

  IF v_frozen_until IS NOT NULL AND v_frozen_until > now() THEN
    RAISE EXCEPTION
      'Payout refused: the account ending % was changed recently and is frozen until %. A changed payout account is held so the account owner can react to a change they did not make; releasing it early is a support decision, not a retry.',
      v_last4, v_frozen_until
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION kyc.reject_payout_to_frozen_account IS
  'Refuses to pay a bank account inside its post-change freeze window (kyc.bank_account.frozen_until). PHASE_01 account-takeover control: the attacker who redirects the account must not also be able to collect on it before the owner sees the alert.';

DROP TRIGGER IF EXISTS trg_payout_frozen_account ON payment.payout;
CREATE TRIGGER trg_payout_frozen_account
  BEFORE INSERT OR UPDATE ON payment.payout
  FOR EACH ROW EXECUTE FUNCTION kyc.reject_payout_to_frozen_account();
