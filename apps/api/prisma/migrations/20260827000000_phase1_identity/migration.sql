-- ##########################################################################
-- PHASE 1 — identity, RBAC and the onboarding engine.
--
-- The adopted schema is in good shape here; this closes the gaps the phase
-- prompt names and adds what a data-driven stepper needs.
-- ##########################################################################

-- ==========================================================================
-- 1. verification_check.org_id is NOT NULL, but the org does not exist yet.
--
-- The bug PHASE_01 Task 5 calls out: GSTIN and PAN are verified at step 3, but
-- `organization` is only created at step 2 — and a *lead* can be verified before
-- any org exists at all. A NOT NULL org_id means those checks have nowhere to
-- attach, so they either get dropped or get an org invented for them.
--
-- Both halves matter: nullable org_id, plus a lead_id to attach to instead, plus
-- a CHECK so a check can never be an orphan belonging to nobody.
-- ==========================================================================

ALTER TABLE kyc.verification_check
  ALTER COLUMN org_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES kyc.registration_lead(id);

DO $$ BEGIN
  ALTER TABLE kyc.verification_check ADD CONSTRAINT chk_verification_has_subject
    CHECK (org_id IS NOT NULL OR lead_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_verification_lead ON kyc.verification_check (lead_id)
  WHERE lead_id IS NOT NULL;

-- The retry policy needs to count attempts per input, per day, cheaply.
CREATE INDEX IF NOT EXISTS ix_verification_hash_recent
  ON kyc.verification_check (input_hash, checked_at DESC);

COMMENT ON COLUMN kyc.verification_check.status IS
  'PASS | FAIL | MISMATCH | PROVIDER_ERROR | TIMEOUT. PROVIDER_ERROR is deliberately separate from FAIL: the first is OUR problem and retries automatically without consuming an attempt, the second is the applicant''s. Conflating them makes people re-upload documents pointlessly, and it is the most common onboarding-UX failure in Indian KYC.';

-- ==========================================================================
-- 2. OTP — the purposes the platform actually issues.
--
-- VR-055: an OTP issued for LOGIN cannot verify a BANK_CHANGE. The adopted enum
-- was missing the payout, password-reset and QC-signoff purposes, which would
-- have meant reusing LOGIN for them — exactly the scope confusion the rule exists
-- to prevent.
-- ==========================================================================

ALTER TABLE identity.otp_request DROP CONSTRAINT IF EXISTS otp_request_purpose_check;
ALTER TABLE identity.otp_request ADD CONSTRAINT otp_request_purpose_check
  CHECK (purpose = ANY (ARRAY[
    'REGISTRATION','LOGIN','REGISTER','CONTACT_CHANGE_OLD','CONTACT_CHANGE_NEW',
    'CONTACT_CHANGE','BANK_CHANGE','PAYOUT_CHANGE','QC_VISIT_SIGNOFF',
    'PICKUP','DELIVERY','TICKET_CLOSE','PASSWORD_RESET'
  ]));

-- Resend accounting. The sliding window lives in Redis for the hot path, but the
-- durable count is what survives a Redis flush and what an abuse investigation
-- reads six weeks later.
ALTER TABLE identity.otp_request
  ADD COLUMN IF NOT EXISTS resend_of_id UUID REFERENCES identity.otp_request(id),
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'SMS',
  ADD COLUMN IF NOT EXISTS burned_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE identity.otp_request ADD CONSTRAINT chk_otp_channel
    CHECK (channel = ANY (ARRAY['SMS','EMAIL','WHATSAPP']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- VR-054: verification consumes an OTP atomically. A partial index makes
-- `WHERE consumed_at IS NULL` the fast path it needs to be.
CREATE INDEX IF NOT EXISTS ix_otp_live
  ON identity.otp_request (target, purpose, created_at DESC)
  WHERE consumed_at IS NULL AND burned_at IS NULL;

-- ==========================================================================
-- 3. Password history (VR-047) and rotation (VR-049).
--
-- Append-only: the point of history is that it cannot be edited away.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS identity.password_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_password_history_user
  ON identity.password_history (user_id, created_at DESC);

COMMENT ON TABLE identity.password_history IS
  'Argon2id hashes of the last N passwords per user, so VR-047 (must differ from the last 5) is enforceable. Never read for authentication — only compared against on change.';

ALTER TABLE identity.user_account
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  -- VR-049: admin and vendor-owner passwords expire every 180 days.
  ADD COLUMN IF NOT EXISTS password_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;

-- ==========================================================================
-- 4. The onboarding engine.
--
-- `onboarding_progress` exists per org, but a *step definition* did not — so
-- "which steps does an LLP need?" lived in code. PHASE_01 Task 2 is explicit that
-- `is_required` derives from org_type AND constitution, and that the derivation
-- must be "an explicit, tested table".
--
-- This is that table. A proprietorship skipping the incorporation fields is then
-- a data question, not a conditional buried in a service.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS kyc.onboarding_step_definition (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_type       org_type NOT NULL,
  step_code      TEXT NOT NULL,
  step_order     INT NOT NULL,
  title          TEXT NOT NULL,
  /** The right-rail copy: why we are asking, and what happens next. */
  purpose_note   TEXT,
  estimated_minutes INT,
  is_required    BOOLEAN NOT NULL DEFAULT TRUE,
  /**
   * Constitutions this step applies to. NULL = all of them.
   * This is the LLP-versus-proprietorship rule, as data.
   */
  applies_to_constitutions TEXT[],
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (org_type, step_code)
);

CREATE INDEX IF NOT EXISTS ix_step_definition_order
  ON kyc.onboarding_step_definition (org_type, step_order) WHERE is_active;

-- `step_order` is stored on progress too, so steps can be reordered without a
-- release; the definition is the source, progress is the snapshot.
COMMENT ON TABLE kyc.onboarding_step_definition IS
  'The stepper, as data. One generic engine drives both the vendor 7-step and the buyer 5-step flow — PHASE_01 Task 2: "do not hard-code two separate flows".';

INSERT INTO kyc.onboarding_step_definition
  (org_type, step_code, step_order, title, purpose_note, estimated_minutes, is_required, applies_to_constitutions)
VALUES
  -- Vendor, 7 steps
  ('VENDOR','ACCOUNT',            1,'Contact',              'We verify your mobile and email before anything else, so nobody can register a business in your name.', 3, TRUE, NULL),
  ('VENDOR','BUSINESS_PROFILE',   2,'Business',             'Your legal name and registered address go on every purchase order we raise to you.', 6, TRUE, NULL),
  ('VENDOR','STATUTORY',          3,'Statutory',            'GSTIN and PAN decide how we invoice you and whether TDS applies. We check them against the source, not against what you type.', 5, TRUE, NULL),
  ('VENDOR','CAPABILITY',         4,'Capability',           'What you deal in and how much you can handle. This is what routes stock enquiries to you.', 5, TRUE, NULL),
  ('VENDOR','FACILITY_CONTACTS',  5,'Facility and contacts','The exact dispatch address becomes "Dispatch From" on the e-way bill for every unit you sell.', 8, TRUE, NULL),
  ('VENDOR','DOCUMENTS_BANK',     6,'Documents and bank',   'A one-rupee test transfer confirms the payout account is yours. It is refunded.', 10, TRUE, NULL),
  ('VENDOR','AGREEMENT',          7,'Agreement and payout', 'The vendor agreement, the grading policy and the data-wipe undertaking, e-signed.', 6, TRUE, NULL),
  -- Buyer, 5 steps
  ('BUYER','ACCOUNT',             1,'Account',              'We verify your work email and mobile so only you can place orders on this account.', 3, TRUE, NULL),
  ('BUYER','BUSINESS_PROFILE',    2,'Company',              'Your legal name as it should appear on the tax invoice.', 4, TRUE, NULL),
  ('BUYER','STATUTORY',           3,'Statutory',            'Your GSTIN decides whether we charge IGST or CGST+SGST, and what input credit you can claim.', 4, TRUE, NULL),
  ('BUYER','CONTACTS_ADDRESSES',  4,'Contacts and delivery','Where machines are delivered, who signs for them, and what hours your dock is open.', 6, TRUE, NULL),
  ('BUYER','DOCUMENTS',           5,'Documents and preferences','Your GST certificate and PAN, plus how you want to be notified.', 5, TRUE, NULL)
ON CONFLICT (org_type, step_code) DO NOTHING;

/**
 * Incorporation is a FIELD-LEVEL requirement inside STATUTORY, gated by
 * constitution — not a separate step.
 *
 * PHASE_01 Task 2 notes the source document references an `INCORPORATION` step
 * code that is not in its own enumerated list. Resolving it as a field keeps the
 * step count at the 7 and 5 the flows are specified as, and keeps a proprietor
 * from seeing a step that will always be empty for them.
 */
CREATE TABLE IF NOT EXISTS kyc.onboarding_field_requirement (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_type     org_type NOT NULL,
  step_code    TEXT NOT NULL,
  field_code   TEXT NOT NULL,
  label        TEXT NOT NULL,
  /** NULL = required for every constitution. */
  required_for_constitutions TEXT[],
  /** Constitutions where the field must NOT be collected at all. */
  forbidden_for_constitutions TEXT[],
  help_text    TEXT,
  UNIQUE (org_type, step_code, field_code)
);

INSERT INTO kyc.onboarding_field_requirement
  (org_type, step_code, field_code, label, required_for_constitutions, forbidden_for_constitutions, help_text)
VALUES
  ('VENDOR','STATUTORY','cin','CIN',
    ARRAY['PRIVATE_LIMITED','PUBLIC_LIMITED','OPC'],
    ARRAY['PROPRIETORSHIP','PARTNERSHIP','HUF','TRUST','SOCIETY'],
    '21 characters, from your certificate of incorporation.'),
  ('VENDOR','STATUTORY','llpin','LLPIN',
    ARRAY['LLP'], ARRAY['PROPRIETORSHIP','PRIVATE_LIMITED','PUBLIC_LIMITED','OPC','HUF'],
    'Format AAB-1234.'),
  ('VENDOR','STATUTORY','incorporation_date','Date of incorporation',
    ARRAY['PRIVATE_LIMITED','PUBLIC_LIMITED','OPC','LLP'],
    ARRAY['PROPRIETORSHIP'], NULL),
  ('VENDOR','STATUTORY','udyam_number','Udyam registration', NULL, NULL,
    'Optional. If you provide it we show the MSME badge on your profile.'),
  ('VENDOR','DOCUMENTS_BANK','board_resolution','Board resolution',
    ARRAY['PRIVATE_LIMITED','PUBLIC_LIMITED'],
    ARRAY['PROPRIETORSHIP','PARTNERSHIP','HUF'],
    'Authorising the signatory to contract on the company''s behalf.'),
  ('BUYER','STATUTORY','cin','CIN',
    ARRAY['PRIVATE_LIMITED','PUBLIC_LIMITED','OPC'],
    ARRAY['PROPRIETORSHIP','PARTNERSHIP','HUF'], NULL)
ON CONFLICT (org_type, step_code, field_code) DO NOTHING;

-- ==========================================================================
-- 5. Onboarding SLA.
--
-- 48 working hours for a vendor, 24 for a buyer. An SLA nobody can see is an
-- SLA nobody meets, so the deadline is a column rather than a calculation
-- somebody remembers to do.
-- ==========================================================================

ALTER TABLE identity.organization
  ADD COLUMN IF NOT EXISTS submitted_for_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_org_review_queue
  ON identity.organization (review_sla_due_at)
  WHERE status IN ('KYC_SUBMITTED','UNDER_REVIEW','INFO_REQUESTED');

-- ==========================================================================
-- 6. Document age (VR-072).
--
-- Only *some* document types are age-limited. A GST certificate has no age
-- limit; a bank statement dated eight months ago is not proof of anything.
-- Storing the type list as data means adding a type is a row, not a release.
-- ==========================================================================

ALTER TABLE kyc.kyc_document
  ADD COLUMN IF NOT EXISTS document_date DATE,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  -- VR-065: EXIF is stripped on ingest. Recording that it happened is what lets
  -- us answer "did we ever store this person's GPS coordinates?" with evidence.
  ADD COLUMN IF NOT EXISTS exif_stripped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS av_scanned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS av_verdict TEXT;

DO $$ BEGIN
  ALTER TABLE kyc.kyc_document ADD CONSTRAINT chk_document_date_sane
    CHECK (document_date IS NULL OR (document_date >= DATE '1990-01-01' AND document_date <= CURRENT_DATE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- VR-061: 5 MiB, enforced at the database as well as at the edge. A cap that
-- lives only in the upload handler is a cap one new code path bypasses.
DO $$ BEGIN
  ALTER TABLE kyc.kyc_document ADD CONSTRAINT chk_document_size
    CHECK (size_bytes > 0 AND size_bytes <= 5242880);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS kyc.document_type_rule (
  doc_type       TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  /** NULL = not age-limited. */
  max_age_days   INT,
  requires_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  max_files      INT NOT NULL DEFAULT 3,
  is_sensitive   BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO kyc.document_type_rule (doc_type, label, max_age_days, requires_expiry, is_sensitive) VALUES
  ('GST_CERTIFICATE',    'GST registration certificate', NULL, FALSE, FALSE),
  ('PAN_CARD',           'PAN card',                     NULL, FALSE, TRUE),
  ('INCORPORATION',      'Certificate of incorporation', NULL, FALSE, FALSE),
  ('UDYAM_CERTIFICATE',  'Udyam registration',           NULL, FALSE, FALSE),
  ('CANCELLED_CHEQUE',   'Cancelled cheque',             90,   FALSE, TRUE),
  ('BANK_STATEMENT',     'Bank statement',               90,   FALSE, TRUE),
  ('ADDRESS_PROOF',      'Address proof',                90,   FALSE, FALSE),
  ('UTILITY_BILL',       'Utility bill',                 90,   FALSE, FALSE),
  ('RENT_AGREEMENT',     'Rent agreement',               NULL, TRUE,  FALSE),
  ('SIGNATORY_ID',       'Authorised signatory ID',      NULL, FALSE, TRUE),
  ('BOARD_RESOLUTION',   'Board resolution',             NULL, FALSE, FALSE),
  ('CPCB_EWASTE',        'CPCB e-waste registration',    NULL, TRUE,  FALSE),
  ('ISO_CERTIFICATE',    'ISO certificate',              NULL, TRUE,  FALSE),
  ('PO_TEMPLATE',        'Purchase order template',      NULL, FALSE, FALSE)
ON CONFLICT (doc_type) DO NOTHING;

COMMENT ON TABLE kyc.document_type_rule IS
  'VR-072. Registration certificates are not age-limited; proof-of-current-state documents are. The rule is data so ops can add a document type without a release.';

-- ==========================================================================
-- 7. Consent (DPDP Act 2023).
--
-- Rows are NEVER deleted — `withdrawn_at` is itself the compliance artifact, and
-- the grant it withdraws is the evidence that consent existed. So: no DELETE,
-- and a partial unique index so one purpose has one live grant.
-- ==========================================================================

DO $$ BEGIN
  ALTER TABLE kyc.consent_record ADD CONSTRAINT chk_consent_purpose
    CHECK (purpose = ANY (ARRAY[
      'KYC_VERIFICATION','TRANSACTIONAL_COMMS','MARKETING','WHATSAPP_BUSINESS',
      'CREDIT_CHECK','DATA_SHARING_LOGISTICS'
    ]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_live
  ON kyc.consent_record (org_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), purpose)
  WHERE withdrawn_at IS NULL AND granted;

COMMENT ON TABLE kyc.consent_record IS
  'DPDP Act 2023. Itemised and purpose-specific — blanket consent is not valid consent. Rows are never deleted: withdrawn_at is the compliance artifact. Transactional messages ignore these flags; only marketing and digests respect them.';

-- ==========================================================================
-- 8. Blacklist screening.
--
-- Checked at step 1 AND again at approval, on GSTIN, PAN, mobile, email and bank
-- account. Twice, because the gap between the two is exactly where a value gets
-- changed.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS kyc.blacklist_hit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES kyc.registration_lead(id),
  org_id       UUID REFERENCES identity.organization(id),
  entity_type  TEXT NOT NULL,
  value_hash   TEXT NOT NULL,
  blacklist_entry_id UUID NOT NULL REFERENCES kyc.blacklist_entry(id),
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  stage        TEXT NOT NULL CHECK (stage IN ('REGISTRATION','APPROVAL','PERIODIC')),
  CONSTRAINT chk_blacklist_hit_subject CHECK (lead_id IS NOT NULL OR org_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_blacklist_hit_org ON kyc.blacklist_hit (org_id, checked_at DESC);

-- ==========================================================================
-- 9. Append-only, extended.
-- ==========================================================================

CREATE OR REPLACE FUNCTION ops.apply_append_only_grants(p_role TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
  v_role TEXT := COALESCE(p_role, current_user);
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('identity','audit_log'),
      ('identity','password_history'),
      ('payment','ledger_entry'),
      ('listing','stock_movement'),
      ('logistics','custody_event'),
      ('kyc','consent_record'),
      ('kyc','verification_check'),
      ('kyc','blacklist_hit')
    ) AS t(sch, tbl)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = r.sch AND table_name = r.tbl) THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON %I.%I FROM %I', r.sch, r.tbl, v_role);
    END IF;
  END LOOP;
  RETURN v_role;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.apply_append_only_grants IS
  'Re-applies the append-only REVOKEs. verification_check joins the list in Phase 1: an attempt history you can edit is not a history, and it is what a fraud pattern is read from. procurement.tds_ledger joins in Phase 7.';

-- Attach updated_at triggers to anything new that has the column.
SELECT ops.attach_updated_at_triggers();
