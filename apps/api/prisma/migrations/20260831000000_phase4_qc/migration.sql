-- Phase 4 — QC at source.
--
-- The v3 QC schema is adopted, not redesigned: 19 tables already carry the
-- inspection model, and Task 1's listed "fixes required" are mostly already in
-- place (uq_sampling_tier_from, uq_sampling_active_per_tier, uq_qcrep_current,
-- the nonce uniques, UNIQUE (tool_provider_id, tool_run_id), chk_override_reason,
-- qc_area_result's UNIQUE (qc_report_id, area), grade_correction's
-- chk_actually_different). This migration closes what genuinely remains.

-- ---------------------------------------------------------------------------
-- 1. One technician identity, not two
-- ---------------------------------------------------------------------------
-- Task 1: "qc_report.technician_id currently points at identity.user_account
-- while qc_seal.applied_by points at qc.qc_technician -- two different
-- technician identities on the same inspection."
--
-- It is the divergence pattern again: the report says technician U inspected the
-- machine, the seal says technician T sealed it, and nothing in the schema
-- requires U and T to be the same person. Any query joining an inspection to its
-- sealer has to know which identity it is holding, and the one that guesses
-- wrong produces a divergence dashboard measuring nobody.
--
-- qc.qc_technician.user_id is UNIQUE, so the mapping is 1:1 and the migration is
-- deterministic rather than a best guess.
ALTER TABLE qc.qc_report DROP CONSTRAINT IF EXISTS qc_report_technician_id_fkey;

UPDATE qc.qc_report r
   SET technician_id = t.id
  FROM qc.qc_technician t
 WHERE t.user_id = r.technician_id;

-- A report whose technician has no qc_technician row would now hold a dangling
-- user id. There are none today, but failing loudly beats carrying one forward.
DO $$
DECLARE v_orphans INT;
BEGIN
  SELECT COUNT(*) INTO v_orphans
    FROM qc.qc_report r
   WHERE NOT EXISTS (SELECT 1 FROM qc.qc_technician t WHERE t.id = r.technician_id);
  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      '% qc_report row(s) reference a user with no qc_technician record. Create the technician rows before migrating.',
      v_orphans;
  END IF;
END $$;

ALTER TABLE qc.qc_report
  ADD CONSTRAINT qc_report_technician_id_fkey
  FOREIGN KEY (technician_id) REFERENCES qc.qc_technician(id);

COMMENT ON COLUMN qc.qc_report.technician_id IS
  'qc.qc_technician.id -- the SAME identity as qc_seal.applied_by. Join through qc_technician.user_id to reach the login account.';

-- qc_seal.verified_by deliberately still points at identity.user_account: a seal
-- is verified at pickup (Phase 8, method SEAL_CHECK) by whoever is at the door,
-- which is a driver or a hub operator, not necessarily a QC technician. Task 1's
-- "resolve to qc_technician everywhere" is about the inspecting identity.
COMMENT ON COLUMN qc.qc_seal.verified_by IS
  'identity.user_account.id, on purpose: seal verification at pickup is done by logistics staff who are not QC technicians. Contrast applied_by, which is a qc_technician.';

-- ---------------------------------------------------------------------------
-- 2. Vendor-site QC is canonical; hub batch QC is deprecated
-- ---------------------------------------------------------------------------
-- Phase 4 Task 1 asks for this, but 20260826000200_hardening already did it:
-- qc.qc_batch already carries chk_qc_batch_deprecated as CHECK (false) NOT VALID,
-- which is exactly the right shape: existing rows stay readable while every new
-- INSERT or UPDATE fails loudly, so nobody can build against it by accident.
-- What was missing is the prose saying which model won, since "two live QC models
-- with nothing marking which is authoritative is the most dangerous ambiguity in
-- the existing schema".
COMMENT ON TABLE qc.qc_batch IS
  'DEPRECATED (Phase 0 Task 5.6, Phase 4 Task 1). The hub-QC batch path is superseded by vendor-site QC via qc.qc_visit. Retained read-only for historical rows; new rows are refused by chk_qc_batch_deprecated. Do not build against it.';


COMMENT ON COLUMN qc.qc_report.batch_id IS
  'DEPRECATED alongside qc.qc_batch. Nullable and left null on the vendor-site path; visit_id is the live linkage.';

-- ---------------------------------------------------------------------------
-- 3. Two columns the DeviceSure field map needs
-- ---------------------------------------------------------------------------
-- 07_DEVICESURE_INTEGRATION.md section 5.4 maps session.rulesVersion to
-- qc_report.rules_version and calls it "already present -- good". It is not
-- present; the doc is wrong on that row. Grading is a liability control under
-- CP e-Comm r.7(5) and must be reproducible against the rule version in force on
-- the inspection date, so without this column a grade cannot be re-derived and
-- therefore cannot be defended.
ALTER TABLE qc.qc_report
  ADD COLUMN IF NOT EXISTS rules_version      TEXT,
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;

COMMENT ON COLUMN qc.qc_report.rules_version IS
  'The tolerance/grade rule set in force when this report was produced. Required to re-derive the grade later; a grade that cannot be reproduced cannot be defended under CP e-Comm r.7(5).';
COMMENT ON COLUMN qc.qc_report.device_fingerprint IS
  'DeviceSure device.fingerprint -- the passport link that ties repeat inspections of one physical machine together across re-listings.';

-- ---------------------------------------------------------------------------
-- 4. A public verification code has to be unguessable
-- ---------------------------------------------------------------------------
-- Task 10: "verification_code must be unguessable (a 12+ character random code,
-- not a sequence) -- it is a public URL and an enumerable one leaks your whole
-- inventory." UNIQUE was already there; nothing stopped a caller writing '1'.
-- The generator lives in application code, so this is the backstop that catches
-- the day someone reaches for a counter.
ALTER TABLE qc.qc_report ADD CONSTRAINT chk_verification_code_unguessable
  CHECK (verification_code IS NULL OR length(verification_code) >= 12);

COMMENT ON COLUMN qc.qc_report.verification_code IS
  'Public, unguessable. Minimum 12 characters of randomness -- never a sequence. Reachable at /qc/verify/:verification_code by someone with no account, so an enumerable value would publish the whole inventory.';
