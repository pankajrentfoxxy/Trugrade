-- ##########################################################################
-- BASELINE (1/2) — the existing TrueTech schema, adopted not replaced.
--
-- Source: docs/legacy/truetech_complete_schema.sql (120 tables, 11 schemas).
--
-- ONE DELIBERATE OMISSION: section 13 "DATABASE ROLES" is not here.
-- It shipped two LOGIN roles with a hard-coded placeholder password committed to
-- the repository, which is schema defect #10. Roles are provisioned by Terraform with
-- credentials in AWS Secrets Manager; the append-only REVOKEs that section
-- also carried are re-applied, and extended, in the hardening migration.
-- ##########################################################################

-- ##########################################################################
-- TrueTech B2B Refurbished Laptop Marketplace
-- COMPLETE POSTGRESQL SCHEMA — v2.0
--
-- One database. Eleven schemas. 107 tables.
-- Target: PostgreSQL 15+
--
-- Deployment:
--   createdb truetech_prod
--   psql -d truetech_prod -f truetech_complete_schema.sql
--
-- Schema map:
--   identity      auth, users, roles, sessions, audit
--   customer      buyer orgs, profiles, addresses, approvals
--   vendor        vendor orgs, capability, facilities, payouts
--   kyc           documents, verification, onboarding, consent
--   catalog       brand -> series -> model -> sku
--   listing       listings, units (serials), stock
--   ordering      cart, orders, sub-orders, RFQ
--   qc            inspection batches, reports, certificates
--   logistics     hubs, carriers, shipments, riders
--   payment       invoices, ledger, settlements, payouts
--   platform      config, notifications, scorecards, DPDP
--
-- NOTE: `organization`, `org_address`, `org_contact` live in `identity`
--       because both customer and vendor modules read them. They are the
--       only genuinely shared entities; everything else is module-owned.
-- ##########################################################################

-- ==========================================================================
-- 0. EXTENSIONS AND SCHEMAS
-- ==========================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- fuzzy name matching
CREATE EXTENSION IF NOT EXISTS "citext";        -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS "btree_gist";    -- exclusion constraints

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS customer;
CREATE SCHEMA IF NOT EXISTS vendor;
CREATE SCHEMA IF NOT EXISTS kyc;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS listing;
CREATE SCHEMA IF NOT EXISTS ordering;
CREATE SCHEMA IF NOT EXISTS qc;
CREATE SCHEMA IF NOT EXISTS logistics;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS platform;

COMMENT ON SCHEMA identity  IS 'Auth, users, RBAC, organizations, addresses, contacts, audit';
COMMENT ON SCHEMA customer  IS 'Buyer organisations: profile, preferences, approval policies, credit';
COMMENT ON SCHEMA vendor    IS 'Vendor organisations: profile, capability, facilities, payout preferences';
COMMENT ON SCHEMA kyc       IS 'Documents, statutory identity, verification calls, onboarding progress, consent';
COMMENT ON SCHEMA catalog   IS 'Master product catalog. TrueTech-owned; vendors never write here';
COMMENT ON SCHEMA listing   IS 'Vendor offers and individual physical units identified by serial number';
COMMENT ON SCHEMA ordering  IS 'Cart, orders, sub-orders per vendor, line items, serial allocation, RFQ';
COMMENT ON SCHEMA qc        IS 'Physical inspection: batches, reports, hardware detection, certificates';
COMMENT ON SCHEMA logistics IS 'Hubs, carriers, shipments, pickup and delivery tasks, chain of custody';
COMMENT ON SCHEMA payment   IS 'Invoices, GST, double-entry ledger, settlements, payouts, penalties';
COMMENT ON SCHEMA platform  IS 'Config, feature flags, notifications, scorecards, DPDP requests';

SET search_path = identity, public;

-- ==========================================================================
-- 1. ENUM TYPES  (created in `public` so every schema can use them)
-- ==========================================================================
CREATE TYPE public.org_type            AS ENUM ('VENDOR','BUYER','INTERNAL');
CREATE TYPE public.org_status          AS ENUM (
  'LEAD','REGISTERED','PROFILE_SUBMITTED','KYC_SUBMITTED','UNDER_REVIEW',
  'INFO_REQUESTED','VERIFIED','REJECTED','SUSPENDED','DEACTIVATED','BLACKLISTED');
CREATE TYPE public.constitution_type   AS ENUM (
  'PROPRIETORSHIP','PARTNERSHIP','LLP','PVT_LTD','LTD','TRUST','SOCIETY','OTHER');
CREATE TYPE public.vendor_tier         AS ENUM ('WATCHLIST','BRONZE','SILVER','GOLD','PLATINUM');
CREATE TYPE public.txn_model           AS ENUM ('AGENCY','BUY_SELL');
CREATE TYPE public.address_type        AS ENUM ('REGISTERED','BILLING','SHIPPING','PICKUP','HUB');
CREATE TYPE public.doc_status          AS ENUM ('UPLOADED','UNDER_REVIEW','VERIFIED','REJECTED','EXPIRED');

-- The three-grade promise, enforced by the type system itself.
CREATE TYPE public.grade_type          AS ENUM ('A_PLUS','A','B');

CREATE TYPE public.condition_type      AS ENUM ('LIKE_NEW','UNBOXED','REFURBISHED','USED_TESTED');
CREATE TYPE public.functional_status   AS ENUM ('FULLY_FUNCTIONAL','MINOR_ISSUE','LIMITED','NON_FUNCTIONAL');
CREATE TYPE public.battery_band        AS ENUM ('EXCELLENT_90_PLUS','GOOD_80_89','FAIR_70_79','LOW_BELOW_70','UNKNOWN');
CREATE TYPE public.parts_status_type   AS ENUM ('ALL_ORIGINAL','OEM_REPLACED','COMPATIBLE_REPLACED','MIXED');
CREATE TYPE public.repair_history_type AS ENUM ('NONE','MINOR','MAJOR');
CREATE TYPE public.wipe_status_type    AS ENUM ('VERIFIED_WIPED','CERTIFICATE_AVAILABLE','NOT_APPLICABLE');
CREATE TYPE public.warranty_provider   AS ENUM ('OEM','SELLER','TRUETECH','EXTENDED','NONE');
CREATE TYPE public.warranty_duration   AS ENUM ('NONE','D7','D30','M3','M6','M12');
CREATE TYPE public.oem_warranty_band   AS ENUM ('NONE','LT_3M','M3_6','M6_12','M12_PLUS');
CREATE TYPE public.listing_status      AS ENUM (
  'DRAFT','PENDING_APPROVAL','ACTIVE','PAUSED','OUT_OF_STOCK','REJECTED',
  'SUSPENDED','EXPIRED','DELISTED');
CREATE TYPE public.unit_status         AS ENUM (
  'CREATED','LISTED','RESERVED','PICKUP_SCHEDULED','PICKED_UP','RECEIVED_AT_HUB',
  'QC_IN_PROGRESS','QC_PASSED','QC_MISMATCH','QC_FAILED','PACKED','DISPATCHED',
  'DELIVERED','RETURN_REQUESTED','RETURN_IN_TRANSIT','RETURN_QC',
  'RETURNED_TO_VENDOR','SCRAPPED');
CREATE TYPE public.order_status        AS ENUM (
  'CREATED','AWAITING_APPROVAL','PAYMENT_PENDING','CONFIRMED','VENDOR_ACCEPTED',
  'VENDOR_REJECTED','PICKUP_SCHEDULED','PICKED_UP','AT_HUB','QC_IN_PROGRESS',
  'QC_HOLD','QC_CLEARED','INVOICED','PACKED','DISPATCHED','IN_TRANSIT',
  'OUT_FOR_DELIVERY','DELIVERED','PARTIALLY_FULFILLED','COMPLETED','CANCELLED',
  'RTO','RETURNED','REFUNDED');
CREATE TYPE public.payment_status      AS ENUM (
  'PENDING','AUTHORIZED','PAID','PARTIALLY_PAID','FAILED','REFUNDED','CREDIT');
CREATE TYPE public.payment_mode        AS ENUM ('PREPAID','PARTIAL_ADVANCE','CREDIT');
CREATE TYPE public.qc_verdict          AS ENUM ('PASS','PASS_WITH_NOTE','MISMATCH','FAIL');
CREATE TYPE public.shipment_leg        AS ENUM ('INBOUND','OUTBOUND','RETURN');
CREATE TYPE public.shipment_status     AS ENUM (
  'CREATED','SCHEDULED','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED',
  'FAILED','RTO','CANCELLED');
CREATE TYPE public.invoice_type        AS ENUM ('PROFORMA','TAX','COMMISSION','CREDIT_NOTE','DEBIT_NOTE');
CREATE TYPE public.penalty_type        AS ENUM (
  'LATE_DISPATCH','QC_MISMATCH','CANCELLATION','SHORT_SUPPLY','GRADE_INFLATION','OTHER');

-- ==========================================================================
-- 2. SCHEMA: identity
-- ==========================================================================

-- 2.1 organization -- every party on the platform
CREATE TABLE identity.organization (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_type              public.org_type NOT NULL,
  legal_name            TEXT NOT NULL,
  trade_name            TEXT,
  constitution          public.constitution_type,
  status                public.org_status NOT NULL DEFAULT 'LEAD',
  tier                  public.vendor_tier DEFAULT 'BRONZE',
  risk_score            INT CHECK (risk_score BETWEEN 0 AND 100),
  transaction_model     public.txn_model NOT NULL DEFAULT 'AGENCY',
  related_org_id        UUID REFERENCES identity.organization(id),
  preferred_locale      TEXT NOT NULL DEFAULT 'en',
  website               TEXT,
  year_established      INT,
  annual_turnover_band  TEXT,
  employee_count_band   TEXT,
  logo_key              TEXT,
  about                 TEXT,
  profile_completeness_pct INT NOT NULL DEFAULT 0,
  first_order_at        TIMESTAMPTZ,
  lifetime_gmv          NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID,
  updated_by            UUID,
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX ix_org_type_status ON identity.organization (org_type, status);
CREATE INDEX ix_org_name_trgm   ON identity.organization USING gin (legal_name gin_trgm_ops);
COMMENT ON TABLE identity.organization IS 'One row = one legal business entity (vendor, buyer, or TrueTech itself)';

-- 2.2 user_account
CREATE TABLE identity.user_account (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES identity.organization(id),
  full_name             TEXT NOT NULL,
  email                 CITEXT UNIQUE,
  mobile                TEXT UNIQUE,
  email_verified_at     TIMESTAMPTZ,
  mobile_verified_at    TIMESTAMPTZ,
  password_hash         TEXT,
  mfa_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_enc        BYTEA,
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','INVITED','SUSPENDED','DEACTIVATED')),
  locale                TEXT NOT NULL DEFAULT 'en',
  job_title             TEXT,
  department            TEXT,
  is_org_owner          BOOLEAN NOT NULL DEFAULT FALSE,
  profile_photo_key     TEXT,
  timezone              TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  onboarding_completed_at TIMESTAMPTZ,
  terms_accepted_version  TEXT,
  last_login_at         TIMESTAMPTZ,
  failed_login_count    INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_identifier CHECK (email IS NOT NULL OR mobile IS NOT NULL)
);
CREATE INDEX ix_user_org ON identity.user_account (org_id, status);

-- 2.3 RBAC
CREATE TABLE identity.role (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,
  scope       TEXT NOT NULL CHECK (scope IN ('ORG','PLATFORM')),
  description TEXT
);

CREATE TABLE identity.permission (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT UNIQUE NOT NULL,
  module       TEXT NOT NULL,
  description  TEXT,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE identity.role_permission (
  role_id       UUID NOT NULL REFERENCES identity.role(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES identity.permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE identity.user_role (
  user_id    UUID NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES identity.role(id),
  org_id     UUID NOT NULL REFERENCES identity.organization(id),
  granted_by UUID REFERENCES identity.user_account(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, role_id, org_id)
);

-- 2.4 session
CREATE TABLE identity.session (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
  refresh_token_hash TEXT UNIQUE NOT NULL,
  token_family_id    UUID NOT NULL,
  ip                 INET,
  user_agent         TEXT,
  device_id          TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_session_user   ON identity.session (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_session_family ON identity.session (token_family_id);
CREATE INDEX ix_session_expiry ON identity.session (expires_at);

-- 2.5 otp_request  -- serves login, pickup, delivery, ticket closure, bank change
CREATE TABLE identity.otp_request (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target      TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN
              ('LOGIN','REGISTER','PICKUP','DELIVERY','TICKET_CLOSE','BANK_CHANGE','CONTACT_CHANGE')),
  code_hash   TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ref_type    TEXT,
  ref_id      UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_otp_target ON identity.otp_request (target, purpose, created_at DESC);

-- 2.6 org_address
CREATE TABLE identity.org_address (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  type                  public.address_type NOT NULL,
  label                 TEXT,
  line1                 TEXT NOT NULL,
  line2                 TEXT,
  city                  TEXT NOT NULL,
  state                 TEXT NOT NULL,
  state_code            CHAR(2) NOT NULL,
  pincode               CHAR(6) NOT NULL,
  contact_name          TEXT NOT NULL,
  contact_mobile        TEXT NOT NULL,
  landmark              TEXT,
  delivery_instructions TEXT,
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),
  google_place_id       TEXT,
  is_default            BOOLEAN NOT NULL DEFAULT FALSE,
  is_pickup_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  is_billing_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_pincode CHECK (pincode ~ '^[1-9][0-9]{5}$')
);
CREATE INDEX ix_addr_org     ON identity.org_address (org_id, type) WHERE is_active;
CREATE INDEX ix_addr_pincode ON identity.org_address (pincode);

-- 2.7 org_contact -- functional contacts; NOT every contact is a login user
CREATE TABLE identity.org_contact (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  contact_type       TEXT NOT NULL CHECK (contact_type IN
                     ('OWNER','AUTHORISED_SIGNATORY','PROCUREMENT','FINANCE','WAREHOUSE',
                      'LOGISTICS','IT_ADMIN','ESCALATION','GRIEVANCE')),
  full_name          TEXT NOT NULL,
  designation        TEXT,
  mobile             TEXT NOT NULL,
  alternate_mobile   TEXT,
  email              CITEXT,
  whatsapp_number    TEXT,
  user_id            UUID REFERENCES identity.user_account(id),
  address_id         UUID REFERENCES identity.org_address(id),
  is_primary         BOOLEAN NOT NULL DEFAULT FALSE,
  is_escalation      BOOLEAN NOT NULL DEFAULT FALSE,
  available_from     TIME,
  available_to       TIME,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  is_active          BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX uq_primary_contact
  ON identity.org_contact (org_id, contact_type) WHERE is_primary AND is_active;

-- 2.8 user_invitation
CREATE TABLE identity.user_invitation (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  email            CITEXT,
  mobile           TEXT,
  full_name        TEXT NOT NULL,
  role_id          UUID NOT NULL REFERENCES identity.role(id),
  invited_by       UUID NOT NULL REFERENCES identity.user_account(id),
  token_hash       TEXT UNIQUE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED')),
  expires_at       TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ,
  accepted_user_id UUID REFERENCES identity.user_account(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_invite_target CHECK (email IS NOT NULL OR mobile IS NOT NULL)
);

-- 2.9 contact_change_request -- dual-OTP protection against account takeover
CREATE TABLE identity.contact_change_request (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES identity.user_account(id),
  field               TEXT NOT NULL CHECK (field IN ('EMAIL','MOBILE')),
  old_value_masked    TEXT NOT NULL,
  new_value           TEXT NOT NULL,
  otp_old_verified_at TIMESTAMPTZ,
  otp_new_verified_at TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','COMPLETED','EXPIRED','CANCELLED')),
  notified_old_at     TIMESTAMPTZ,
  ip                  INET,
  user_agent          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

-- 2.10 audit_log -- append-only, monthly partitions
CREATE TABLE identity.audit_log (
  id             BIGSERIAL,
  actor_user_id  UUID,
  actor_org_id   UUID,
  action         TEXT NOT NULL,
  entity_type    TEXT,
  entity_id      TEXT,
  before_json    JSONB,
  after_json     JSONB,
  ip             INET,
  user_agent     TEXT,
  request_id     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE identity.audit_log_2026_08 PARTITION OF identity.audit_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE identity.audit_log_2026_09 PARTITION OF identity.audit_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE identity.audit_log_2026_10 PARTITION OF identity.audit_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE INDEX ix_audit_actor  ON identity.audit_log (actor_user_id, created_at DESC);
CREATE INDEX ix_audit_entity ON identity.audit_log (entity_type, entity_id);
CREATE INDEX ix_audit_req    ON identity.audit_log (request_id);

-- 2.11 pincode reference data
CREATE TABLE identity.pincode_master (
  pincode    CHAR(6) PRIMARY KEY,
  district   TEXT NOT NULL,
  state      TEXT NOT NULL,
  state_code CHAR(2) NOT NULL,
  zone       TEXT NOT NULL CHECK (zone IN ('NORTH','SOUTH','EAST','WEST','NE','CENTRAL')),
  is_metro   BOOLEAN NOT NULL DEFAULT FALSE,
  is_ncr     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ix_pincode_ncr ON identity.pincode_master (is_ncr) WHERE is_ncr;

-- ==========================================================================
-- 3. SCHEMA: kyc
-- ==========================================================================

-- 3.1 registration_lead -- captured BEFORE an organization exists
CREATE TABLE kyc.registration_lead (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intended_org_type       public.org_type NOT NULL,
  company_name_raw        TEXT NOT NULL,
  contact_name            TEXT NOT NULL,
  mobile                  TEXT NOT NULL,
  email                   CITEXT,
  city                    TEXT,
  state_code              CHAR(2),
  expected_monthly_volume INT,
  categories_dealt        TEXT[],
  source                  TEXT NOT NULL DEFAULT 'ORGANIC',
  utm_source              TEXT,
  utm_medium              TEXT,
  utm_campaign            TEXT,
  referred_by_org_id      UUID REFERENCES identity.organization(id),
  referral_code           TEXT,
  status                  TEXT NOT NULL DEFAULT 'NEW'
                          CHECK (status IN ('NEW','OTP_SENT','VERIFIED','CONVERTED','ABANDONED','DISQUALIFIED')),
  converted_org_id        UUID UNIQUE REFERENCES identity.organization(id),
  abandoned_at_step       TEXT,
  assigned_to             UUID REFERENCES identity.user_account(id),
  last_contacted_at       TIMESTAMPTZ,
  ip                      INET,
  user_agent              TEXT,
  device_fingerprint      TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_lead_funnel ON kyc.registration_lead (intended_org_type, status, created_at DESC);
CREATE INDEX ix_lead_mobile ON kyc.registration_lead (mobile);

-- 3.2 onboarding_progress -- powers the stepper and "save and finish later"
CREATE TABLE kyc.onboarding_progress (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  step_code        TEXT NOT NULL,
  step_order       INT NOT NULL,
  is_required      BOOLEAN NOT NULL DEFAULT TRUE,
  status           TEXT NOT NULL DEFAULT 'NOT_STARTED'
                   CHECK (status IN ('NOT_STARTED','IN_PROGRESS','SUBMITTED','NEEDS_FIX','COMPLETE')),
  completion_pct   INT NOT NULL DEFAULT 0,
  blocking_reason  TEXT,
  first_started_at TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  last_saved_at    TIMESTAMPTZ,
  draft_json       JSONB,
  UNIQUE (org_id, step_code)
);

-- 3.3 gst_profile -- one org can hold many GSTINs (one per state)
CREATE TABLE kyc.gst_profile (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  gstin                 CHAR(15) NOT NULL,
  legal_name_as_per_gst TEXT NOT NULL,
  trade_name            TEXT,
  state_code            CHAR(2) NOT NULL,
  registration_type     TEXT NOT NULL DEFAULT 'REGULAR'
                        CHECK (registration_type IN ('REGULAR','COMPOSITION','SEZ','CASUAL','ISD')),
  status                TEXT NOT NULL CHECK (status IN ('ACTIVE','CANCELLED','SUSPENDED','PROVISIONAL')),
  api_verified_at       TIMESTAMPTZ NOT NULL,
  api_response_json     JSONB,
  is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, gstin),
  CONSTRAINT chk_gstin_format CHECK
    (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$')
);
CREATE UNIQUE INDEX uq_primary_gst ON kyc.gst_profile (org_id) WHERE is_primary;
CREATE INDEX ix_gst_state ON kyc.gst_profile (state_code);

-- 3.4 pan_record -- encrypted; matched by hash, never decrypted for comparison
CREATE TABLE kyc.pan_record (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID UNIQUE NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  pan_enc         BYTEA NOT NULL,
  pan_last4       CHAR(4) NOT NULL,
  pan_hash        TEXT NOT NULL,
  name_as_per_pan TEXT,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  api_verified_at TIMESTAMPTZ
);
CREATE INDEX ix_pan_hash ON kyc.pan_record (pan_hash);

-- 3.5 bank_account
CREATE TABLE kyc.bank_account (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  purpose                   TEXT NOT NULL DEFAULT 'PAYOUT' CHECK (purpose IN ('PAYOUT','REFUND')),
  account_holder_name       TEXT NOT NULL,
  account_number_enc        BYTEA NOT NULL,
  account_number_last4      CHAR(4) NOT NULL,
  ifsc                      CHAR(11) NOT NULL,
  bank_name                 TEXT,
  branch                    TEXT,
  account_type              TEXT NOT NULL DEFAULT 'CURRENT'
                            CHECK (account_type IN ('CURRENT','SAVINGS','CC','OD')),
  penny_drop_status         TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (penny_drop_status IN ('PENDING','SUCCESS','NAME_MISMATCH','FAILED')),
  penny_drop_name           TEXT,
  name_match_score          NUMERIC(5,2),
  verified_at               TIMESTAMPTZ,
  is_default                BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified_by_document   BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_until              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ifsc CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$')
);
CREATE INDEX ix_bank_org ON kyc.bank_account (org_id, purpose);

-- 3.6 kyc_document
CREATE TABLE kyc.kyc_document (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  doc_type         TEXT NOT NULL,
  file_key         TEXT NOT NULL,
  file_hash_sha256 TEXT NOT NULL,
  mime             TEXT NOT NULL,
  size_bytes       BIGINT NOT NULL CHECK (size_bytes <= 5242880),
  status           public.doc_status NOT NULL DEFAULT 'UPLOADED',
  rejection_reason TEXT,
  uploaded_by      UUID REFERENCES identity.user_account(id),
  reviewed_by      UUID REFERENCES identity.user_account(id),
  review_note      TEXT,
  expires_on       DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_doc_org    ON kyc.kyc_document (org_id, doc_type, status);
CREATE INDEX ix_doc_hash   ON kyc.kyc_document (file_hash_sha256);
CREATE INDEX ix_doc_expiry ON kyc.kyc_document (expires_on) WHERE expires_on IS NOT NULL;

-- 3.7 verification_check -- every external API call, with cost and latency
CREATE TABLE kyc.verification_check (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  check_type         TEXT NOT NULL CHECK (check_type IN
                     ('GSTIN','PAN','PAN_GSTIN_LINK','BANK_PENNY_DROP','IFSC','UDYAM',
                      'CIN','AADHAAR_ESIGN','OEM_WARRANTY','BLACKLIST')),
  input_value_masked TEXT NOT NULL,
  input_hash         TEXT NOT NULL,
  provider           TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN
                     ('PASS','FAIL','MISMATCH','PROVIDER_ERROR','TIMEOUT')),
  response_summary   JSONB,
  match_score        NUMERIC(5,2),
  failure_reason     TEXT,
  cost_paise         INT,
  latency_ms         INT,
  attempt_no         INT NOT NULL DEFAULT 1,
  triggered_by       UUID REFERENCES identity.user_account(id),
  checked_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_vcheck_org  ON kyc.verification_check (org_id, check_type, checked_at DESC);
CREATE INDEX ix_vcheck_hash ON kyc.verification_check (input_hash);

-- 3.8 kyc_review
CREATE TABLE kyc.kyc_review (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  reviewer_id        UUID NOT NULL REFERENCES identity.user_account(id),
  decision           TEXT NOT NULL CHECK (decision IN ('APPROVE','REQUEST_INFO','REJECT')),
  reason_codes       TEXT[],
  notes              TEXT,
  second_approver_id UUID REFERENCES identity.user_account(id),
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_kycrev_org ON kyc.kyc_review (org_id, decided_at DESC);

-- 3.9 blacklist_entry -- hashed values only
CREATE TABLE kyc.blacklist_entry (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN
              ('PAN','GSTIN','MOBILE','EMAIL','SERIAL','BANK_ACCOUNT','DEVICE')),
  value_hash  TEXT NOT NULL,
  reason      TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN
              ('INTERNAL_FRAUD','LAW_ENFORCEMENT','PARTNER_REGISTRY','STOLEN_DEVICE_DB')),
  added_by    UUID REFERENCES identity.user_account(id),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, value_hash)
);

-- 3.10 agreement_acceptance
CREATE TABLE kyc.agreement_acceptance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES identity.user_account(id),
  agreement_code TEXT NOT NULL,
  version        TEXT NOT NULL,
  doc_hash       TEXT NOT NULL,
  ip             INET,
  user_agent     TEXT,
  esign_ref      TEXT,
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.11 consent_record -- DPDP: itemised, purpose-specific, language-aware
CREATE TABLE kyc.consent_record (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES identity.user_account(id),
  purpose         TEXT NOT NULL CHECK (purpose IN
                  ('KYC_VERIFICATION','TRANSACTIONAL_COMMS','MARKETING','WHATSAPP_BUSINESS',
                   'CREDIT_CHECK','DATA_SHARING_LOGISTICS')),
  granted         BOOLEAN NOT NULL,
  notice_version  TEXT NOT NULL,
  notice_language TEXT NOT NULL,
  channel         TEXT NOT NULL,
  ip              INET,
  user_agent      TEXT,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at    TIMESTAMPTZ
);
CREATE INDEX ix_consent ON kyc.consent_record (org_id, purpose, granted_at DESC);

-- 3.12 profile_change_request -- locked fields need approval after verification
CREATE TABLE kyc.profile_change_request (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  entity_type             TEXT NOT NULL,
  entity_id               UUID NOT NULL,
  field                   TEXT NOT NULL,
  old_value               TEXT,
  new_value               TEXT NOT NULL,
  reason                  TEXT NOT NULL,
  supporting_doc_id       UUID REFERENCES kyc.kyc_document(id),
  status                  TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','APPROVED','REJECTED','AUTO_APPROVED')),
  requires_reverification BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by             UUID REFERENCES identity.user_account(id),
  reviewed_at             TIMESTAMPTZ,
  review_note             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.13 tax_declaration -- MSME, TDS lower deduction, SEZ
CREATE TABLE kyc.tax_declaration (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  declaration_type TEXT NOT NULL CHECK (declaration_type IN
                   ('MSME_UDYAM','TDS_LOWER_DEDUCTION','TDS_NIL','TCS_EXEMPT','SEZ','EXPORT_ORIENTED')),
  reference_number TEXT NOT NULL,
  rate_pct         NUMERIC(5,2),
  valid_from       DATE NOT NULL,
  valid_to         DATE NOT NULL,
  document_id      UUID REFERENCES kyc.kyc_document(id),
  status           TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  verified_by      UUID REFERENCES identity.user_account(id),
  verified_at      TIMESTAMPTZ,
  CONSTRAINT chk_tax_validity CHECK (valid_to > valid_from)
);
CREATE INDEX ix_taxdecl_active ON kyc.tax_declaration (org_id, declaration_type, valid_to)
  WHERE status = 'VERIFIED';

-- 3.14 trade_reference
CREATE TABLE kyc.trade_reference (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  company_name           TEXT NOT NULL,
  contact_person         TEXT NOT NULL,
  mobile                 TEXT NOT NULL,
  email                  CITEXT,
  relationship           TEXT NOT NULL CHECK (relationship IN ('CUSTOMER','SUPPLIER','BANKER')),
  years_associated       INT,
  monthly_business_value NUMERIC(14,2),
  verification_status    TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (verification_status IN ('PENDING','CONTACTED','POSITIVE','NEGATIVE','UNREACHABLE')),
  verification_notes     TEXT,
  verified_by            UUID REFERENCES identity.user_account(id),
  verified_at            TIMESTAMPTZ
);
-- ==========================================================================
-- 4. SCHEMA: customer  (buyer organisations)
-- ==========================================================================

CREATE TABLE customer.buyer_profile (
  org_id               UUID PRIMARY KEY REFERENCES identity.organization(id) ON DELETE CASCADE,
  industry             TEXT,
  employee_count       INT,
  annual_volume_estimate INT,
  credit_limit         NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_terms_days    INT NOT NULL DEFAULT 0,
  credit_used          NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_mode_allowed public.payment_mode[] NOT NULL DEFAULT ARRAY['PREPAID']::public.payment_mode[],
  onboarding_status    public.org_status NOT NULL DEFAULT 'REGISTERED',
  verified_at          TIMESTAMPTZ,
  CONSTRAINT chk_credit CHECK (credit_used <= credit_limit OR credit_limit = 0)
);

CREATE TABLE customer.org_preference (
  org_id                        UUID PRIMARY KEY REFERENCES identity.organization(id) ON DELETE CASCADE,
  notify_email                  BOOLEAN NOT NULL DEFAULT TRUE,
  notify_sms                    BOOLEAN NOT NULL DEFAULT TRUE,
  notify_whatsapp               BOOLEAN NOT NULL DEFAULT TRUE,
  notify_push                   BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email_address          CITEXT,
  digest_frequency              TEXT NOT NULL DEFAULT 'REALTIME'
                                CHECK (digest_frequency IN ('REALTIME','DAILY','WEEKLY','OFF')),
  quiet_hours_from              TIME,
  quiet_hours_to                TIME,
  preferred_language            TEXT NOT NULL DEFAULT 'en',
  invoice_delivery_email        CITEXT,
  auto_accept_orders            BOOLEAN NOT NULL DEFAULT FALSE,
  auto_resource_on_qc_fail      BOOLEAN NOT NULL DEFAULT TRUE,
  default_shipping_address_id   UUID REFERENCES identity.org_address(id),
  default_billing_gst_profile_id UUID REFERENCES kyc.gst_profile(id),
  po_required                   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE customer.org_preference IS 'Applies to buyers AND vendors; lives here to avoid a twelfth schema';

CREATE TABLE customer.buyer_preference (
  org_id                  UUID PRIMARY KEY REFERENCES identity.organization(id) ON DELETE CASCADE,
  preferred_brands        TEXT[],
  preferred_grades        public.grade_type[],
  min_qc_score            INT CHECK (min_qc_score BETWEEN 0 AND 100),
  min_battery_band        public.battery_band,
  typical_ram_gb          INT,
  typical_storage_gb      INT,
  budget_min              NUMERIC(14,2),
  budget_max              NUMERIC(14,2),
  typical_order_qty       INT,
  buying_frequency        TEXT CHECK (buying_frequency IN ('MONTHLY','QUARTERLY','ANNUAL','AD_HOC')),
  requires_warranty_min   public.warranty_duration,
  requires_data_wipe_cert BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer.buyer_approval_policy (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  user_id                 UUID REFERENCES identity.user_account(id),
  role_id                 UUID REFERENCES identity.role(id),
  max_order_value         NUMERIC(14,2),
  max_monthly_value       NUMERIC(14,2),
  max_units_per_order     INT,
  allowed_payment_modes   public.payment_mode[] NOT NULL DEFAULT ARRAY['PREPAID']::public.payment_mode[],
  requires_approval_above NUMERIC(14,2),
  approver_user_id        UUID REFERENCES identity.user_account(id),
  cost_centres_allowed    TEXT[],
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_policy_target CHECK ((user_id IS NULL) <> (role_id IS NULL))
);

CREATE TABLE customer.credit_application (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  requested_limit       NUMERIC(14,2) NOT NULL,
  requested_terms_days  INT NOT NULL,
  annual_turnover       NUMERIC(14,2),
  years_in_business     INT,
  financials_doc_id     UUID REFERENCES kyc.kyc_document(id),
  bank_statement_doc_id UUID REFERENCES kyc.kyc_document(id),
  security_deposit_amount NUMERIC(14,2),
  pdc_or_bg_details     TEXT,
  credit_bureau_score   INT,
  internal_risk_grade   TEXT CHECK (internal_risk_grade IN ('LOW','MEDIUM','HIGH')),
  status                TEXT NOT NULL DEFAULT 'SUBMITTED'
                        CHECK (status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','APPROVED_REDUCED','REJECTED')),
  approved_limit        NUMERIC(14,2),
  approved_terms_days   INT,
  reviewed_by           UUID REFERENCES identity.user_account(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,
  valid_until           DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer.saved_search (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES identity.user_account(id),
  name              TEXT NOT NULL,
  filters_json      JSONB NOT NULL,
  alert_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  alert_price_below NUMERIC(14,2),
  last_alerted_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- 5. SCHEMA: vendor
-- ==========================================================================

CREATE TABLE vendor.vendor_profile (
  org_id                    UUID PRIMARY KEY REFERENCES identity.organization(id) ON DELETE CASCADE,
  business_category         TEXT NOT NULL CHECK (business_category IN
                            ('REFURBISHER','DEALER','ITAD','CORPORATE_LIQUIDATOR','OEM_PARTNER')),
  incorporation_date        DATE,
  monthly_volume_estimate   INT,
  pickup_default_location_id UUID REFERENCES identity.org_address(id),
  commission_rate_override  NUMERIC(5,2),
  exposure_limit            NUMERIC(14,2),
  settlement_cycle          TEXT NOT NULL DEFAULT 'WEEKLY'
                            CHECK (settlement_cycle IN ('WEEKLY','T_PLUS_2','MONTHLY')),
  msme_udyam_no             TEXT,
  onboarding_status         public.org_status NOT NULL DEFAULT 'REGISTERED',
  verified_at               TIMESTAMPTZ,
  verified_by               UUID REFERENCES identity.user_account(id)
);
CREATE INDEX ix_vendor_msme ON vendor.vendor_profile (msme_udyam_no) WHERE msme_udyam_no IS NOT NULL;

CREATE TABLE vendor.vendor_capability (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  brand_id                   UUID,   -- FK added after catalog.brand exists
  category                   TEXT NOT NULL CHECK (category IN
                             ('BUSINESS_LAPTOP','WORKSTATION','CONSUMER','MACBOOK','CHROMEBOOK')),
  monthly_capacity_units     INT NOT NULL,
  typical_grade_mix          JSONB,
  avg_price_band_min         NUMERIC(14,2),
  avg_price_band_max         NUMERIC(14,2),
  sourcing_channels          TEXT[] NOT NULL,
  can_provide_serials_upfront BOOLEAN NOT NULL DEFAULT TRUE,
  has_inhouse_testing        BOOLEAN NOT NULL DEFAULT FALSE,
  has_inhouse_repair         BOOLEAN NOT NULL DEFAULT FALSE,
  lead_time_days             INT NOT NULL DEFAULT 2,
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ix_vcap_routing ON vendor.vendor_capability (category, brand_id) WHERE is_active;

CREATE TABLE vendor.vendor_facility (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  address_id             UUID UNIQUE NOT NULL REFERENCES identity.org_address(id),
  facility_type          TEXT NOT NULL CHECK (facility_type IN
                         ('WAREHOUSE','OFFICE','REFURB_UNIT','RETAIL')),
  storage_capacity_units INT,
  has_loading_dock       BOOLEAN NOT NULL DEFAULT FALSE,
  vehicle_access         TEXT NOT NULL DEFAULT 'TEMPO'
                         CHECK (vehicle_access IN ('TRUCK','TEMPO','BIKE_ONLY')),
  lift_available         BOOLEAN NOT NULL DEFAULT TRUE,
  staff_count            INT,
  testing_stations       INT,
  is_pickup_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  special_instructions   TEXT
);

CREATE TABLE vendor.facility_hours (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES vendor.vendor_facility(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time   TIME,
  close_time  TIME,
  is_closed   BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (facility_id, day_of_week)
);

CREATE TABLE vendor.facility_holiday (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id  UUID NOT NULL REFERENCES vendor.vendor_facility(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  reason       TEXT,
  UNIQUE (facility_id, holiday_date)
);

CREATE TABLE vendor.vendor_certification (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  cert_type           TEXT NOT NULL CHECK (cert_type IN
                      ('CPCB_EWASTE','ISO_9001','ISO_14001','R2','EPR','OEM_AUTHORISED_PARTNER')),
  issuing_body        TEXT NOT NULL,
  certificate_number  TEXT NOT NULL,
  valid_from          DATE NOT NULL,
  valid_to            DATE NOT NULL,
  document_id         UUID REFERENCES kyc.kyc_document(id),
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  shows_badge         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE vendor.vendor_payout_preference (
  org_id                  UUID PRIMARY KEY REFERENCES identity.organization(id) ON DELETE CASCADE,
  preferred_cycle         TEXT NOT NULL DEFAULT 'WEEKLY',
  preferred_day_of_week   INT CHECK (preferred_day_of_week BETWEEN 0 AND 6),
  min_payout_threshold    NUMERIC(14,2) NOT NULL DEFAULT 1000,
  auto_reinvest           BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_upload_required BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE vendor.vendor_sourcing_declaration (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  listing_id             UUID,   -- FK added after listing.listing exists
  source_type            TEXT NOT NULL CHECK (source_type IN
                         ('CORPORATE_BUYBACK','LEASE_RETURN','AUCTION','IMPORT','RETAIL_EXCHANGE','OEM_REFURB')),
  source_org_name        TEXT,
  acquisition_invoice_no TEXT,
  acquisition_date       DATE,
  supporting_doc_id      UUID REFERENCES kyc.kyc_document(id),
  declared_by            UUID NOT NULL REFERENCES identity.user_account(id),
  declared_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- 6. SCHEMA: catalog   (TrueTech-owned; vendors never write here)
-- ==========================================================================

CREATE TABLE catalog.brand (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT UNIQUE NOT NULL,
  slug      TEXT UNIQUE NOT NULL,
  logo_key  TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE vendor.vendor_capability
  ADD CONSTRAINT fk_vcap_brand FOREIGN KEY (brand_id) REFERENCES catalog.brand(id);

CREATE TABLE catalog.series (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id  UUID NOT NULL REFERENCES catalog.brand(id),
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (brand_id, name)
);

CREATE TABLE catalog.model (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id    UUID NOT NULL REFERENCES catalog.series(id),
  name         TEXT NOT NULL,
  model_year   INT,
  form_factor  TEXT CHECK (form_factor IN
               ('BUSINESS_ULTRABOOK','WORKSTATION','2_IN_1','CHROMEBOOK','CONSUMER','GAMING')),
  msrp_new_inr NUMERIC(14,2),
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (series_id, name)
);

CREATE TABLE catalog.sku (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id          UUID NOT NULL REFERENCES catalog.model(id),
  sku_code          TEXT UNIQUE NOT NULL,
  normalized_key    TEXT UNIQUE NOT NULL,
  cpu_brand         TEXT NOT NULL,
  cpu_family        TEXT NOT NULL,
  cpu_model         TEXT NOT NULL,
  cpu_generation    TEXT NOT NULL,
  cores             INT,
  threads           INT,
  ram_gb            INT NOT NULL,
  ram_type          TEXT,
  ram_upgradable_to INT,
  storage_type      TEXT NOT NULL CHECK (storage_type IN ('NVME_SSD','SATA_SSD','HDD','EMMC')),
  storage_gb        INT NOT NULL,
  gpu_type          TEXT NOT NULL CHECK (gpu_type IN ('INTEGRATED','DISCRETE')),
  gpu_model         TEXT,
  screen_size_inch  NUMERIC(4,1) NOT NULL,
  resolution        TEXT NOT NULL CHECK (resolution IN ('HD','FHD','QHD','4K','RETINA')),
  panel_type        TEXT,
  is_touch          BOOLEAN NOT NULL DEFAULT FALSE,
  os_supported      TEXT NOT NULL,
  ports_json        JSONB,
  weight_kg         NUMERIC(5,2),
  battery_wh        INT,
  charger_watt      INT,
  hsn_code          TEXT NOT NULL DEFAULT '8471',
  gst_rate          NUMERIC(5,2) NOT NULL DEFAULT 18.00,
  version           INT NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES identity.user_account(id)
);
CREATE INDEX ix_sku_model  ON catalog.sku (model_id) WHERE is_active;
CREATE INDEX ix_sku_filter ON catalog.sku (cpu_generation, ram_gb, storage_gb);
CREATE INDEX ix_sku_ports  ON catalog.sku USING gin (ports_json);
COMMENT ON COLUMN catalog.sku.normalized_key IS
  'lower(brand|model|cpu_model|ram|storage_type|storage_gb|screen|touch) — the dedupe guarantee';

CREATE TABLE catalog.sku_image (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id     UUID NOT NULL REFERENCES catalog.sku(id) ON DELETE CASCADE,
  file_key   TEXT NOT NULL,
  image_type TEXT NOT NULL CHECK (image_type IN
             ('FRONT','OPEN','LEFT','RIGHT','KEYBOARD','PORTS')),
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE catalog.sku_request (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_org_id   UUID NOT NULL REFERENCES identity.organization(id),
  raw_brand       TEXT NOT NULL,
  raw_model       TEXT NOT NULL,
  raw_config      TEXT NOT NULL,
  spec_url        TEXT,
  photo_key       TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','RESOLVED_NEW','RESOLVED_MAPPED','REJECTED')),
  resolved_sku_id UUID REFERENCES catalog.sku(id),
  resolved_by     UUID REFERENCES identity.user_account(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_skureq_queue ON catalog.sku_request (status, created_at);

CREATE TABLE catalog.catalog_change_log (
  id         BIGSERIAL PRIMARY KEY,
  sku_id     UUID NOT NULL REFERENCES catalog.sku(id),
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  changed_by UUID REFERENCES identity.user_account(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- 7. SCHEMA: listing   (vendor offers + individual physical units)
-- ==========================================================================

CREATE TABLE listing.listing (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_org_id          UUID NOT NULL REFERENCES identity.organization(id),
  sku_id                 UUID NOT NULL REFERENCES catalog.sku(id),
  grade                  public.grade_type NOT NULL,
  condition_type         public.condition_type NOT NULL,
  functional_status      public.functional_status NOT NULL DEFAULT 'FULLY_FUNCTIONAL',
  battery_health_band    public.battery_band NOT NULL,
  parts_status           public.parts_status_type NOT NULL,
  parts_replaced         TEXT[],
  repair_history         public.repair_history_type NOT NULL DEFAULT 'NONE',
  data_wipe_status       public.wipe_status_type NOT NULL DEFAULT 'VERIFIED_WIPED',
  seller_warranty        public.warranty_duration NOT NULL DEFAULT 'NONE',
  oem_warranty_remaining public.oem_warranty_band NOT NULL DEFAULT 'NONE',
  truetech_warranty      public.warranty_duration NOT NULL DEFAULT 'NONE',
  unit_price             NUMERIC(14,2) NOT NULL,
  gst_rate               NUMERIC(5,2) NOT NULL DEFAULT 18.00,
  moq                    INT NOT NULL DEFAULT 1,
  dispatch_sla_hours     INT NOT NULL DEFAULT 48,
  pickup_location_id     UUID NOT NULL REFERENCES identity.org_address(id),
  qty_total              INT NOT NULL DEFAULT 0,
  qty_available          INT NOT NULL DEFAULT 0,
  qty_reserved           INT NOT NULL DEFAULT 0,
  status                 public.listing_status NOT NULL DEFAULT 'DRAFT',
  sku_version_at_creation INT NOT NULL DEFAULT 1,
  approved_by            UUID REFERENCES identity.user_account(id),
  approved_at            TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The constraints that make overselling structurally impossible
  CONSTRAINT chk_qty_nonneg  CHECK (qty_available >= 0 AND qty_reserved >= 0 AND qty_total >= 0),
  CONSTRAINT chk_qty_balance CHECK (qty_available + qty_reserved <= qty_total),
  CONSTRAINT chk_price_pos   CHECK (unit_price > 0),
  CONSTRAINT chk_sellable    CHECK (functional_status <> 'NON_FUNCTIONAL')
);
-- The hottest query on the platform: the offers grid
CREATE INDEX ix_listing_offers ON listing.listing (sku_id, grade, status, unit_price);
CREATE INDEX ix_listing_vendor ON listing.listing (vendor_org_id, status);
CREATE INDEX ix_listing_expiry ON listing.listing (expires_at) WHERE status = 'ACTIVE';

ALTER TABLE vendor.vendor_sourcing_declaration
  ADD CONSTRAINT fk_vsd_listing FOREIGN KEY (listing_id) REFERENCES listing.listing(id);

CREATE TABLE listing.listing_tier_price (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listing.listing(id) ON DELETE CASCADE,
  min_qty    INT NOT NULL,
  max_qty    INT,
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price > 0),
  CONSTRAINT chk_tier_range CHECK (max_qty IS NULL OR max_qty >= min_qty)
);
-- Prevent overlapping quantity bands on one listing
ALTER TABLE listing.listing_tier_price ADD CONSTRAINT excl_tier_overlap
  EXCLUDE USING gist (
    listing_id WITH =,
    int4range(min_qty, COALESCE(max_qty, 2147483647), '[]') WITH &&
  );

CREATE TABLE listing.listing_image (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES listing.listing(id) ON DELETE CASCADE,
  file_key    TEXT NOT NULL,
  image_type  TEXT NOT NULL DEFAULT 'ACTUAL_UNIT'
              CHECK (image_type IN ('ACTUAL_UNIT','DEFECT')),
  hash        TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_limg_hash ON listing.listing_image (hash);

-- listing.unit -- ONE PHYSICAL LAPTOP
CREATE TABLE listing.unit (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number        TEXT NOT NULL,
  listing_id           UUID REFERENCES listing.listing(id) ON DELETE SET NULL,
  vendor_org_id        UUID NOT NULL REFERENCES identity.organization(id),
  sku_id               UUID NOT NULL REFERENCES catalog.sku(id),
  grade_declared       public.grade_type NOT NULL,
  grade_actual         public.grade_type,
  status               public.unit_status NOT NULL DEFAULT 'CREATED',
  order_line_id        UUID,   -- FK added after ordering.order_line exists
  qc_report_id         UUID,   -- FK added after qc.qc_report exists
  hw_fingerprint_hash  TEXT,
  oem_warranty_end     DATE,
  blacklist_checked_at TIMESTAMPTZ,
  location             TEXT NOT NULL DEFAULT 'VENDOR'
                       CHECK (location IN ('VENDOR','TRANSIT','HUB','BUYER')),
  hub_id               UUID,   -- FK added after logistics.hub exists
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- THE most important index: a serial can be live in exactly one place, nationwide
CREATE UNIQUE INDEX uq_unit_active_serial ON listing.unit (serial_number)
  WHERE status NOT IN ('RETURNED_TO_VENDOR','SCRAPPED');
CREATE INDEX ix_unit_listing ON listing.unit (listing_id, status);
CREATE INDEX ix_unit_vendor  ON listing.unit (vendor_org_id, status);
CREATE INDEX ix_unit_fp      ON listing.unit (hw_fingerprint_hash);

CREATE TABLE listing.stock_movement (
  id            BIGSERIAL PRIMARY KEY,
  unit_id       UUID NOT NULL REFERENCES listing.unit(id),
  from_status   public.unit_status,
  to_status     public.unit_status NOT NULL,
  from_location TEXT,
  to_location   TEXT,
  reason        TEXT,
  actor_id      UUID REFERENCES identity.user_account(id),
  ref_type      TEXT,
  ref_id        UUID,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_stockmv_unit ON listing.stock_movement (unit_id, occurred_at DESC);

CREATE TABLE listing.price_history (
  id         BIGSERIAL PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listing.listing(id) ON DELETE CASCADE,
  old_price  NUMERIC(14,2),
  new_price  NUMERIC(14,2) NOT NULL,
  changed_by UUID REFERENCES identity.user_account(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_pricehist ON listing.price_history (listing_id, changed_at DESC);
-- ==========================================================================
-- 8. SCHEMA: ordering
-- ==========================================================================

CREATE TABLE ordering.cart (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id UUID NOT NULL REFERENCES identity.organization(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES identity.user_account(id),
  status       TEXT NOT NULL DEFAULT 'OPEN'
               CHECK (status IN ('OPEN','CONVERTED','ABANDONED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_cart_org ON ordering.cart (buyer_org_id, status);

CREATE TABLE ordering.cart_item (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id             UUID NOT NULL REFERENCES ordering.cart(id) ON DELETE CASCADE,
  listing_id          UUID NOT NULL REFERENCES listing.listing(id),
  qty                 INT NOT NULL CHECK (qty > 0),
  unit_price_snapshot NUMERIC(14,2) NOT NULL,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, listing_id)
);

CREATE TABLE ordering."order" (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number           TEXT UNIQUE NOT NULL,
  buyer_org_id           UUID NOT NULL REFERENCES identity.organization(id),
  buyer_user_id          UUID NOT NULL REFERENCES identity.user_account(id),
  billing_gst_profile_id UUID NOT NULL REFERENCES kyc.gst_profile(id),
  billing_address_id     UUID NOT NULL REFERENCES identity.org_address(id),
  shipping_address_id    UUID NOT NULL REFERENCES identity.org_address(id),
  buyer_po_number        TEXT,
  cost_centre            TEXT,
  subtotal               NUMERIC(14,2) NOT NULL,
  gst_total              NUMERIC(14,2) NOT NULL,
  freight_total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  tcs_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total            NUMERIC(14,2) NOT NULL,
  payment_mode           public.payment_mode NOT NULL DEFAULT 'PREPAID',
  payment_status         public.payment_status NOT NULL DEFAULT 'PENDING',
  status                 public.order_status NOT NULL DEFAULT 'CREATED',
  placed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  stock_hold_expires_at  TIMESTAMPTZ
);
CREATE INDEX ix_order_buyer ON ordering."order" (buyer_org_id, status, placed_at DESC);
CREATE INDEX ix_order_hold  ON ordering."order" (stock_hold_expires_at)
  WHERE status IN ('CREATED','PAYMENT_PENDING','AWAITING_APPROVAL');

CREATE TABLE ordering.order_approval (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES ordering."order"(id) ON DELETE CASCADE,
  requested_by     UUID NOT NULL REFERENCES identity.user_account(id),
  approver_user_id UUID NOT NULL REFERENCES identity.user_account(id),
  status           TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  order_value      NUMERIC(14,2) NOT NULL,
  policy_id        UUID REFERENCES customer.buyer_approval_policy(id),
  comment          TEXT,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at       TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE ordering.sub_order (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES ordering."order"(id) ON DELETE CASCADE,
  sub_order_number    TEXT UNIQUE NOT NULL,
  vendor_org_id       UUID NOT NULL REFERENCES identity.organization(id),
  subtotal            NUMERIC(14,2) NOT NULL,
  gst_total           NUMERIC(14,2) NOT NULL,
  freight             NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  status              public.order_status NOT NULL DEFAULT 'CONFIRMED',
  dispatch_sla_due_at TIMESTAMPTZ,
  accepted_at         TIMESTAMPTZ,
  rejected_at         TIMESTAMPTZ,
  invoice_id          UUID   -- FK added after payment.invoice exists
);
CREATE INDEX ix_suborder_vendor ON ordering.sub_order (vendor_org_id, status);
CREATE INDEX ix_suborder_sla    ON ordering.sub_order (dispatch_sla_due_at)
  WHERE status IN ('CONFIRMED','VENDOR_ACCEPTED','PICKUP_SCHEDULED');

CREATE TABLE ordering.order_line (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_order_id  UUID NOT NULL REFERENCES ordering.sub_order(id) ON DELETE CASCADE,
  listing_id    UUID NOT NULL REFERENCES listing.listing(id),
  sku_id        UUID NOT NULL REFERENCES catalog.sku(id),
  grade         public.grade_type NOT NULL,
  qty           INT NOT NULL CHECK (qty > 0),
  unit_price    NUMERIC(14,2) NOT NULL,
  gst_rate      NUMERIC(5,2) NOT NULL,
  gst_amount    NUMERIC(14,2) NOT NULL,
  line_total    NUMERIC(14,2) NOT NULL,
  status        public.order_status NOT NULL DEFAULT 'CONFIRMED',
  fulfilled_qty INT NOT NULL DEFAULT 0,
  cancelled_qty INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_line_qty CHECK (fulfilled_qty + cancelled_qty <= qty)
);
ALTER TABLE listing.unit
  ADD CONSTRAINT fk_unit_orderline FOREIGN KEY (order_line_id) REFERENCES ordering.order_line(id);

CREATE TABLE ordering.order_line_unit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_line_id UUID NOT NULL REFERENCES ordering.order_line(id) ON DELETE CASCADE,
  unit_id       UUID UNIQUE NOT NULL REFERENCES listing.unit(id),
  serial_number TEXT NOT NULL,
  qc_report_id  UUID,   -- FK added after qc.qc_report exists
  status        public.unit_status NOT NULL DEFAULT 'RESERVED'
);
CREATE INDEX ix_olu_serial ON ordering.order_line_unit (serial_number);

CREATE TABLE ordering.order_event (
  id           BIGSERIAL,
  order_id     UUID,
  sub_order_id UUID,
  event_type   TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  actor_id     UUID,
  note         TEXT,
  payload_json JSONB,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE ordering.order_event_2026_08 PARTITION OF ordering.order_event
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE ordering.order_event_2026_09 PARTITION OF ordering.order_event
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE INDEX ix_oevent_order ON ordering.order_event (order_id, occurred_at DESC);

CREATE TABLE ordering.rfq (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number        TEXT UNIQUE NOT NULL,
  buyer_org_id      UUID NOT NULL REFERENCES identity.organization(id),
  sku_id            UUID NOT NULL REFERENCES catalog.sku(id),
  grade             public.grade_type,
  qty               INT NOT NULL CHECK (qty > 0),
  target_price      NUMERIC(14,2),
  delivery_pincode  CHAR(6) NOT NULL,
  needed_by         DATE,
  status            TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','QUOTED','AWARDED','EXPIRED','CANCELLED')),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ordering.rfq_quote (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id        UUID NOT NULL REFERENCES ordering.rfq(id) ON DELETE CASCADE,
  vendor_org_id UUID NOT NULL REFERENCES identity.organization(id),
  unit_price    NUMERIC(14,2) NOT NULL,
  qty_committed INT NOT NULL,
  dispatch_days INT NOT NULL,
  validity      TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'SUBMITTED'
                CHECK (status IN ('SUBMITTED','ACCEPTED','REJECTED','EXPIRED')),
  message       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, vendor_org_id)
);

-- ==========================================================================
-- 9. SCHEMA: logistics
-- ==========================================================================

CREATE TABLE logistics.hub (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   TEXT UNIQUE NOT NULL,
  name                   TEXT NOT NULL,
  address_id             UUID NOT NULL REFERENCES identity.org_address(id),
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  capacity_units_per_day INT,
  serves_zones           TEXT[]
);
ALTER TABLE listing.unit ADD CONSTRAINT fk_unit_hub
  FOREIGN KEY (hub_id) REFERENCES logistics.hub(id);

CREATE TABLE logistics.carrier (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  adapter_key   TEXT NOT NULL,
  config_json   JSONB,
  supports_leg  TEXT[] NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  priority      INT NOT NULL DEFAULT 100
);

CREATE TABLE logistics.pincode_serviceability (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pincode           CHAR(6) NOT NULL REFERENCES identity.pincode_master(pincode),
  carrier_id        UUID NOT NULL REFERENCES logistics.carrier(id),
  service_type      TEXT NOT NULL CHECK (service_type IN ('PICKUP','DELIVERY','BOTH')),
  transit_days_min  INT NOT NULL,
  transit_days_max  INT NOT NULL,
  cod_available     BOOLEAN NOT NULL DEFAULT FALSE,
  is_oda            BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pincode, carrier_id, service_type)
);
CREATE INDEX ix_serviceability ON logistics.pincode_serviceability (pincode, carrier_id);

CREATE TABLE logistics.rider (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID UNIQUE NOT NULL REFERENCES identity.user_account(id),
  phone        TEXT NOT NULL,
  zone         TEXT NOT NULL,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('BIKE','TEMPO','VAN','TRUCK')),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE logistics.shipment (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leg               public.shipment_leg NOT NULL,
  sub_order_id      UUID REFERENCES ordering.sub_order(id),
  carrier_id        UUID NOT NULL REFERENCES logistics.carrier(id),
  from_address_id   UUID NOT NULL REFERENCES identity.org_address(id),
  to_address_id     UUID NOT NULL REFERENCES identity.org_address(id),
  awb_number        TEXT UNIQUE,
  mode              TEXT NOT NULL CHECK (mode IN ('SURFACE','AIR','TRUCK','BIKE')),
  declared_value    NUMERIC(14,2) NOT NULL,
  weight_kg         NUMERIC(8,2),
  boxes             INT NOT NULL DEFAULT 1,
  freight_cost      NUMERIC(14,2),
  seal_id           TEXT,
  status            public.shipment_status NOT NULL DEFAULT 'CREATED',
  pickup_slot_from  TIMESTAMPTZ,
  pickup_slot_to    TIMESTAMPTZ,
  dispatched_at     TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  label_key         TEXT,
  pod_key           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_shipment_sub ON logistics.shipment (sub_order_id, leg);
CREATE INDEX ix_shipment_st  ON logistics.shipment (status, created_at DESC);

CREATE TABLE logistics.shipment_unit (
  shipment_id   UUID NOT NULL REFERENCES logistics.shipment(id) ON DELETE CASCADE,
  unit_id       UUID NOT NULL REFERENCES listing.unit(id),
  serial_number TEXT NOT NULL,
  PRIMARY KEY (shipment_id, unit_id)
);

CREATE TABLE logistics.shipment_tracking (
  id          BIGSERIAL,
  shipment_id UUID NOT NULL,
  status_code TEXT NOT NULL,
  description TEXT,
  location    TEXT,
  raw_payload JSONB,
  occurred_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE logistics.shipment_tracking_2026_08 PARTITION OF logistics.shipment_tracking
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE logistics.shipment_tracking_2026_09 PARTITION OF logistics.shipment_tracking
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE logistics.pickup_task (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_order_id      UUID NOT NULL REFERENCES ordering.sub_order(id),
  vendor_org_id     UUID NOT NULL REFERENCES identity.organization(id),
  address_id        UUID NOT NULL REFERENCES identity.org_address(id),
  expected_serials  TEXT[] NOT NULL,
  scanned_serials   TEXT[],
  otp_hash          TEXT,
  assigned_rider_id UUID REFERENCES logistics.rider(id),
  slot_from         TIMESTAMPTZ,
  slot_to           TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','ASSIGNED','IN_PROGRESS','COMPLETED','FAILED','CANCELLED')),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX ix_pickup_rider ON logistics.pickup_task (assigned_rider_id, status);

CREATE TABLE logistics.delivery_task (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id  UUID NOT NULL REFERENCES logistics.shipment(id),
  rider_id     UUID REFERENCES logistics.rider(id),
  otp_hash     TEXT,
  attempts     INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  photo_keys   TEXT[],
  delivered_at TIMESTAMPTZ
);

CREATE TABLE logistics.custody_event (
  id          BIGSERIAL PRIMARY KEY,
  unit_id     UUID NOT NULL REFERENCES listing.unit(id),
  from_party  TEXT NOT NULL,
  to_party    TEXT NOT NULL,
  actor_id    UUID REFERENCES identity.user_account(id),
  scan_type   TEXT NOT NULL CHECK (scan_type IN ('BARCODE','MANUAL','OTP')),
  geo_lat     NUMERIC(9,6),
  geo_lng     NUMERIC(9,6),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_custody_unit ON logistics.custody_event (unit_id, occurred_at);

-- ==========================================================================
-- 10. SCHEMA: qc
-- ==========================================================================

CREATE TABLE qc.qc_batch (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number   TEXT UNIQUE NOT NULL,
  hub_id         UUID NOT NULL REFERENCES logistics.hub(id),
  source_type    TEXT NOT NULL CHECK (source_type IN ('VENDOR_PICKUP','FIRST_PARTY','RETURN')),
  vendor_org_id  UUID REFERENCES identity.organization(id),
  expected_units INT NOT NULL,
  received_units INT NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'OPEN'
                 CHECK (status IN ('OPEN','IN_PROGRESS','CLOSED','EXCEPTION')),
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ
);

CREATE TABLE qc.qc_tolerance_rule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field           TEXT NOT NULL,
  comparison      TEXT NOT NULL CHECK (comparison IN
                  ('EXACT','GTE','WITHIN_PCT','WITHIN_BAND','ONE_BAND_DOWN')),
  tolerance_value TEXT,
  severity        TEXT NOT NULL CHECK (severity IN ('BLOCKING','MAJOR','MINOR')),
  is_blocking     BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE qc.qc_report (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id               UUID NOT NULL REFERENCES listing.unit(id),
  batch_id              UUID NOT NULL REFERENCES qc.qc_batch(id),
  technician_id         UUID NOT NULL REFERENCES identity.user_account(id),
  device_cert_id        TEXT NOT NULL,
  agent_version         TEXT NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL,
  completed_at          TIMESTAMPTZ,
  qc_score              INT CHECK (qc_score BETWEEN 0 AND 100),
  verdict               public.qc_verdict,
  grade_proposed        public.grade_type,
  grade_final           public.grade_type,
  grade_override_reason TEXT,
  report_pdf_key        TEXT,
  signature             TEXT NOT NULL,
  nonce                 TEXT UNIQUE NOT NULL,
  verification_code     TEXT UNIQUE,
  CONSTRAINT chk_override_reason CHECK
    (grade_proposed IS NULL OR grade_final IS NULL
     OR grade_proposed = grade_final OR grade_override_reason IS NOT NULL)
);
CREATE INDEX ix_qcrep_unit  ON qc.qc_report (unit_id);
CREATE INDEX ix_qcrep_batch ON qc.qc_report (batch_id, verdict);

ALTER TABLE listing.unit ADD CONSTRAINT fk_unit_qcreport
  FOREIGN KEY (qc_report_id) REFERENCES qc.qc_report(id);
ALTER TABLE ordering.order_line_unit ADD CONSTRAINT fk_olu_qcreport
  FOREIGN KEY (qc_report_id) REFERENCES qc.qc_report(id);

CREATE TABLE qc.qc_area_result (
  id           BIGSERIAL PRIMARY KEY,
  qc_report_id UUID NOT NULL REFERENCES qc.qc_report(id) ON DELETE CASCADE,
  area         TEXT NOT NULL CHECK (area IN
               ('DISPLAY','KEYBOARD','BATTERY','STORAGE','MEMORY_CPU','PORTS',
                'CONNECTIVITY','CAMERA_AUDIO','THERMAL','BIOS_SECURITY','DATA_SECURITY','PHYSICAL')),
  score        NUMERIC(5,2) NOT NULL,
  max_score    NUMERIC(5,2) NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('PASS','WARN','FAIL')),
  details_json JSONB,
  UNIQUE (qc_report_id, area)
);

CREATE TABLE qc.qc_hardware_detected (
  qc_report_id        UUID PRIMARY KEY REFERENCES qc.qc_report(id) ON DELETE CASCADE,
  hw_serial           TEXT NOT NULL,
  hw_model            TEXT,
  bios_version        TEXT,
  bios_date           DATE,
  cpu_detected        TEXT,
  cores               INT,
  threads             INT,
  ram_detected_gb     INT NOT NULL,
  ram_modules         INT,
  ram_type            TEXT,
  ram_speed_mhz       INT,
  storage_type        TEXT,
  storage_detected_gb INT,
  storage_model       TEXT,
  smart_status        TEXT CHECK (smart_status IN ('OK','WARNING','FAILING')),
  power_on_hours      INT,
  tbw_gb              INT,
  gpu_detected        TEXT,
  panel_id            TEXT,
  screen_size         NUMERIC(4,1),
  battery_design_wh   INT,
  battery_full_wh     INT,
  battery_health_pct  NUMERIC(5,2),
  cycle_count         INT,
  wifi_chip           TEXT,
  bt_present          BOOLEAN,
  tpm_version         TEXT,
  secure_boot         BOOLEAN,
  bios_locked         BOOLEAN NOT NULL DEFAULT FALSE,
  mdm_locked          BOOLEAN NOT NULL DEFAULT FALSE,
  computrace_active   BOOLEAN NOT NULL DEFAULT FALSE,
  raw_json            JSONB
);

CREATE TABLE qc.qc_photo (
  id           BIGSERIAL PRIMARY KEY,
  qc_report_id UUID NOT NULL REFERENCES qc.qc_report(id) ON DELETE CASCADE,
  angle        TEXT NOT NULL CHECK (angle IN
               ('LID','PALMREST','SCREEN_ON','BASE','PORTS','WORST_DEFECT')),
  file_key     TEXT NOT NULL,
  hash         TEXT NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE qc.qc_mismatch (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_report_id      UUID NOT NULL REFERENCES qc.qc_report(id) ON DELETE CASCADE,
  field             TEXT NOT NULL,
  declared_value    TEXT NOT NULL,
  actual_value      TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('BLOCKING','MAJOR','MINOR')),
  resolution        TEXT CHECK (resolution IN ('DISCOUNT','SWAP','CANCEL','ACCEPT_AS_IS')),
  discount_amount   NUMERIC(14,2),
  buyer_notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  buyer_decision_at TIMESTAMPTZ,
  penalty_id        UUID   -- FK added after payment.penalty exists
);

CREATE TABLE qc.wipe_certificate (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id             UUID NOT NULL REFERENCES listing.unit(id),
  method              TEXT NOT NULL,
  standard            TEXT NOT NULL DEFAULT 'NIST_800_88_PURGE',
  passes              INT NOT NULL DEFAULT 1,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('VERIFIED','FAILED')),
  certificate_key     TEXT,
  hash                TEXT,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE qc.qc_audit_recheck (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_report_id UUID NOT NULL REFERENCES qc.qc_report(id),
  recheck_report_id  UUID NOT NULL REFERENCES qc.qc_report(id),
  divergence_json    JSONB,
  auditor_id         UUID NOT NULL REFERENCES identity.user_account(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- 11. SCHEMA: payment
-- ==========================================================================

CREATE TABLE payment.invoice (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number      TEXT UNIQUE NOT NULL,
  type                public.invoice_type NOT NULL,
  issuer_org_id       UUID NOT NULL REFERENCES identity.organization(id),
  recipient_org_id    UUID NOT NULL REFERENCES identity.organization(id),
  sub_order_id        UUID REFERENCES ordering.sub_order(id),
  invoice_date        DATE NOT NULL,
  place_of_supply     CHAR(2) NOT NULL,
  taxable_value       NUMERIC(14,2) NOT NULL,
  cgst                NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst                NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst                NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess                NUMERIC(14,2) NOT NULL DEFAULT 0,
  total               NUMERIC(14,2) NOT NULL,
  irn                 TEXT UNIQUE,
  ack_no              TEXT,
  ack_date            TIMESTAMPTZ,
  signed_qr           TEXT,
  irp_status          TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (irp_status IN ('PENDING','GENERATED','FAILED','CANCELLED','NOT_APPLICABLE')),
  pdf_key             TEXT,
  original_invoice_id UUID REFERENCES payment.invoice(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- exactly one of (cgst+sgst) or igst must be non-zero
  CONSTRAINT chk_tax_split CHECK (
    (igst > 0 AND cgst = 0 AND sgst = 0) OR
    (igst = 0 AND cgst >= 0 AND sgst >= 0)
  )
);
CREATE INDEX ix_invoice_recipient ON payment.invoice (recipient_org_id, invoice_date DESC);
CREATE INDEX ix_invoice_irp       ON payment.invoice (irp_status) WHERE irp_status = 'PENDING';

ALTER TABLE ordering.sub_order ADD CONSTRAINT fk_suborder_invoice
  FOREIGN KEY (invoice_id) REFERENCES payment.invoice(id);

CREATE TABLE payment.invoice_line (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID NOT NULL REFERENCES payment.invoice(id) ON DELETE CASCADE,
  sku_id         UUID REFERENCES catalog.sku(id),
  description    TEXT NOT NULL,
  hsn            TEXT NOT NULL,
  qty            INT NOT NULL,
  unit_price     NUMERIC(14,2) NOT NULL,
  taxable_value  NUMERIC(14,2) NOT NULL,
  gst_rate       NUMERIC(5,2) NOT NULL,
  gst_amount     NUMERIC(14,2) NOT NULL,
  serial_numbers TEXT[]
);

CREATE TABLE payment.eway_bill (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID UNIQUE NOT NULL REFERENCES payment.invoice(id),
  ewb_number     TEXT,
  ewb_date       TIMESTAMPTZ,
  valid_upto     TIMESTAMPTZ,
  transporter_id TEXT,
  vehicle_no     TEXT,
  awb_number     TEXT,
  distance_km    INT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE INDEX ix_ewb_expiry ON payment.eway_bill (valid_upto) WHERE status = 'ACTIVE';

CREATE TABLE payment.payment (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES ordering."order"(id),
  buyer_org_id  UUID NOT NULL REFERENCES identity.organization(id),
  gateway       TEXT NOT NULL,
  gateway_ref   TEXT NOT NULL,
  method        TEXT NOT NULL CHECK (method IN
                ('UPI','NEFT','RTGS','NETBANKING','CARD','VIRTUAL_ACCOUNT','MANUAL')),
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status        public.payment_status NOT NULL DEFAULT 'PENDING',
  captured_at   TIMESTAMPTZ,
  raw_payload   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gateway, gateway_ref)
);

CREATE TABLE payment.refund (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    UUID NOT NULL REFERENCES payment.payment(id),
  order_line_id UUID REFERENCES ordering.order_line(id),
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  gateway_ref   TEXT,
  processed_at  TIMESTAMPTZ
);

-- The financial source of truth. Append-only, double-entry.
CREATE TABLE payment.ledger_entry (
  id           BIGSERIAL PRIMARY KEY,
  entry_date   DATE NOT NULL,
  account_code TEXT NOT NULL,
  org_id       UUID REFERENCES identity.organization(id),
  debit        NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit       NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency     CHAR(3) NOT NULL DEFAULT 'INR',
  ref_type     TEXT NOT NULL,
  ref_id       UUID,
  narration    TEXT NOT NULL,
  batch_id     UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ledger_signs  CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT chk_ledger_single CHECK ((debit > 0) <> (credit > 0))
);
CREATE INDEX ix_ledger_org   ON payment.ledger_entry (org_id, entry_date);
CREATE INDEX ix_ledger_batch ON payment.ledger_entry (batch_id);
CREATE INDEX ix_ledger_ref   ON payment.ledger_entry (ref_type, ref_id);
COMMENT ON TABLE payment.ledger_entry IS
  'APPEND ONLY. Application role has INSERT and SELECT only. Every batch_id must sum to zero.';

CREATE TABLE payment.commission_rule (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_tier    public.vendor_tier,
  sku_category   TEXT,
  min_value      NUMERIC(14,2),
  max_value      NUMERIC(14,2),
  rate_pct       NUMERIC(5,2) NOT NULL,
  effective_from DATE NOT NULL
);

CREATE TABLE payment.settlement_run (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_start      DATE NOT NULL,
  cycle_end        DATE NOT NULL,
  run_date         DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','APPROVED','EXECUTED','FAILED')),
  total_gross      NUMERIC(14,2),
  total_commission NUMERIC(14,2),
  total_tds        NUMERIC(14,2),
  total_net        NUMERIC(14,2),
  executed_by      UUID REFERENCES identity.user_account(id)
);

CREATE TABLE payment.payout (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_run_id  UUID NOT NULL REFERENCES payment.settlement_run(id),
  vendor_org_id      UUID NOT NULL REFERENCES identity.organization(id),
  bank_account_id    UUID NOT NULL REFERENCES kyc.bank_account(id),
  gross              NUMERIC(14,2) NOT NULL,
  commission         NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_gst     NUMERIC(14,2) NOT NULL DEFAULT 0,
  logistics_recovery NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalties          NUMERIC(14,2) NOT NULL DEFAULT 0,
  tds_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustments        NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount         NUMERIC(14,2) NOT NULL,
  utr                TEXT UNIQUE,
  status             TEXT NOT NULL DEFAULT 'PENDING',
  paid_at            TIMESTAMPTZ,
  advice_key         TEXT
);
CREATE INDEX ix_payout_vendor ON payment.payout (vendor_org_id, status);

CREATE TABLE payment.penalty (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_org_id UUID NOT NULL REFERENCES identity.organization(id),
  order_line_id UUID REFERENCES ordering.order_line(id),
  type          public.penalty_type NOT NULL,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  reason        TEXT NOT NULL,
  waived_by     UUID REFERENCES identity.user_account(id),
  waived_reason TEXT,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE qc.qc_mismatch ADD CONSTRAINT fk_mismatch_penalty
  FOREIGN KEY (penalty_id) REFERENCES payment.penalty(id);

-- ==========================================================================
-- 12. SCHEMA: platform  (after-sale, config, notifications, DPDP)
-- ==========================================================================

CREATE TABLE platform.return_request (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number      TEXT UNIQUE NOT NULL,
  order_line_unit_id UUID NOT NULL REFERENCES ordering.order_line_unit(id),
  buyer_org_id       UUID NOT NULL REFERENCES identity.organization(id),
  reason_code        TEXT NOT NULL CHECK (reason_code IN
                     ('DOA','SPEC_MISMATCH','GRADE_MISMATCH','TRANSIT_DAMAGE','WRONG_ITEM','SHORT_SHIPMENT')),
  description        TEXT,
  evidence_keys      TEXT[] NOT NULL,
  status             TEXT NOT NULL DEFAULT 'RAISED',
  raised_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by        UUID REFERENCES identity.user_account(id),
  resolution         TEXT CHECK (resolution IN ('REFUND','REPLACE','REPAIR','REJECT'))
);

CREATE TABLE platform.return_qc (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID UNIQUE NOT NULL REFERENCES platform.return_request(id),
  qc_report_id      UUID NOT NULL REFERENCES qc.qc_report(id),
  fingerprint_match BOOLEAN NOT NULL,
  verdict           TEXT NOT NULL CHECK (verdict IN ('CLAIM_VALID','CLAIM_INVALID','UNIT_SWAPPED')),
  liable_party      TEXT NOT NULL CHECK (liable_party IN ('VENDOR','CARRIER','TRUETECH','BUYER')),
  notes             TEXT
);

CREATE TABLE platform.warranty (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       UUID NOT NULL REFERENCES listing.unit(id),
  provider      public.warranty_provider NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  terms_version TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','EXPIRED','VOID')),
  CONSTRAINT chk_warranty_dates CHECK (end_date > start_date)
);
CREATE INDEX ix_warranty_unit ON platform.warranty (unit_id, status);

CREATE TABLE platform.warranty_claim (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_id   UUID NOT NULL REFERENCES platform.warranty(id),
  unit_id       UUID NOT NULL REFERENCES listing.unit(id),
  buyer_org_id  UUID NOT NULL REFERENCES identity.organization(id),
  issue_type    TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN',
  resolution    TEXT CHECK (resolution IN ('REPAIR','REPLACE','REFUND','REJECT')),
  cost          NUMERIC(14,2),
  qc_report_ref UUID REFERENCES qc.qc_report(id),
  closed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform.ticket (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number     TEXT UNIQUE NOT NULL,
  org_id            UUID NOT NULL REFERENCES identity.organization(id),
  category          TEXT NOT NULL,
  priority          TEXT NOT NULL DEFAULT 'NORMAL'
                    CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  subject           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'OPEN',
  assigned_to       UUID REFERENCES identity.user_account(id),
  sla_due_at        TIMESTAMPTZ,
  closure_otp_hash  TEXT,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ticket_sla ON platform.ticket (status, sla_due_at);

CREATE TABLE platform.ticket_message (
  id          BIGSERIAL PRIMARY KEY,
  ticket_id   UUID NOT NULL REFERENCES platform.ticket(id) ON DELETE CASCADE,
  sender_id   UUID REFERENCES identity.user_account(id),
  body        TEXT NOT NULL,
  attachments TEXT[],
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform.dispute (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES ordering."order"(id),
  raised_by_org_id   UUID NOT NULL REFERENCES identity.organization(id),
  against_org_id     UUID NOT NULL REFERENCES identity.organization(id),
  category           TEXT NOT NULL,
  amount_disputed    NUMERIC(14,2),
  status             TEXT NOT NULL DEFAULT 'OPEN',
  committee_decision TEXT,
  decided_at         TIMESTAMPTZ
);

CREATE TABLE platform.vendor_scorecard (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_org_id     UUID NOT NULL REFERENCES identity.organization(id),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  qc_pass_rate      NUMERIC(5,2),
  grade_accuracy    NUMERIC(5,2),
  ontime_dispatch   NUMERIC(5,2),
  acceptance_rate   NUMERIC(5,2),
  return_rate       NUMERIC(5,2),
  dispute_rate      NUMERIC(5,2),
  buyer_rating_avg  NUMERIC(3,2),
  listing_hygiene   NUMERIC(5,2),
  units_in_period   INT NOT NULL,
  composite_score   NUMERIC(5,2),
  tier              public.vendor_tier,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_org_id, period_end)
);

CREATE TABLE platform.buyer_review (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES ordering."order"(id),
  buyer_org_id  UUID NOT NULL REFERENCES identity.organization(id),
  vendor_org_id UUID NOT NULL REFERENCES identity.organization(id),
  rating        INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  is_published  BOOLEAN NOT NULL DEFAULT FALSE,
  moderated_by  UUID REFERENCES identity.user_account(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, vendor_org_id)
);

CREATE TABLE platform.platform_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key            TEXT NOT NULL,
  value_json     JSONB NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by     UUID REFERENCES identity.user_account(id),
  version        INT NOT NULL DEFAULT 1
);
CREATE INDEX ix_config_key ON platform.platform_config (key, effective_from DESC);

CREATE TABLE platform.feature_flag (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_pct INT NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  org_scope   UUID[]
);

CREATE TABLE platform.notification_template (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT NOT NULL,
  channel              TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP','PUSH','IN_APP')),
  locale               TEXT NOT NULL DEFAULT 'en',
  subject              TEXT,
  body                 TEXT NOT NULL,
  provider_template_id TEXT,
  version              INT NOT NULL DEFAULT 1,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (code, channel, locale, version)
);

CREATE TABLE platform.notification_log (
  id            BIGSERIAL,
  org_id        UUID,
  user_id       UUID,
  channel       TEXT NOT NULL,
  template_code TEXT NOT NULL,
  payload_json  JSONB,
  status        TEXT NOT NULL,
  provider_ref  TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, sent_at)
) PARTITION BY RANGE (sent_at);
CREATE TABLE platform.notification_log_2026_08 PARTITION OF platform.notification_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE platform.notification_log_2026_09 PARTITION OF platform.notification_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE platform.integration_log (
  id             BIGSERIAL,
  provider       TEXT NOT NULL,
  endpoint       TEXT NOT NULL,
  request_hash   TEXT,
  status_code    INT,
  latency_ms     INT,
  error          TEXT,
  correlation_id TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE platform.integration_log_2026_08 PARTITION OF platform.integration_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE platform.integration_log_2026_09 PARTITION OF platform.integration_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
COMMENT ON COLUMN platform.integration_log.request_hash IS
  'A hash, never the request body. These calls carry PAN, bank and GSTIN data.';

CREATE TABLE platform.data_subject_request (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES identity.organization(id),
  user_id       UUID REFERENCES identity.user_account(id),
  type          TEXT NOT NULL CHECK (type IN ('ACCESS','CORRECTION','ERASURE','GRIEVANCE')),
  status        TEXT NOT NULL DEFAULT 'RECEIVED',
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  handled_by    UUID REFERENCES identity.user_account(id),
  outcome_notes TEXT
);

-- [section 13 DATABASE ROLES removed — see header]

-- ==========================================================================
-- 14. INTEGRITY JOBS  (run nightly; page on failure)
-- ==========================================================================

-- Every double-entry batch must sum to zero. A non-zero result is corruption.
CREATE OR REPLACE VIEW payment.v_ledger_imbalance AS
SELECT batch_id,
       SUM(debit)  AS total_debit,
       SUM(credit) AS total_credit,
       SUM(debit) - SUM(credit) AS imbalance
FROM payment.ledger_entry
GROUP BY batch_id
HAVING SUM(debit) <> SUM(credit);

-- Listing quantities must match the actual unit counts.
CREATE OR REPLACE VIEW listing.v_stock_drift AS
SELECT l.id AS listing_id, l.vendor_org_id,
       l.qty_available, l.qty_reserved,
       COUNT(*) FILTER (WHERE u.status = 'LISTED')   AS actual_available,
       COUNT(*) FILTER (WHERE u.status = 'RESERVED') AS actual_reserved
FROM listing.listing l
LEFT JOIN listing.unit u ON u.listing_id = l.id
WHERE l.status = 'ACTIVE'
GROUP BY l.id, l.vendor_org_id, l.qty_available, l.qty_reserved
HAVING l.qty_available <> COUNT(*) FILTER (WHERE u.status = 'LISTED')
    OR l.qty_reserved  <> COUNT(*) FILTER (WHERE u.status = 'RESERVED');

-- Documents and certificates that have expired or expire within 30 days.
CREATE OR REPLACE VIEW kyc.v_expiring_documents AS
SELECT org_id, doc_type, expires_on, 'KYC_DOCUMENT' AS kind
FROM kyc.kyc_document
WHERE expires_on IS NOT NULL AND expires_on <= CURRENT_DATE + 30 AND status = 'VERIFIED'
UNION ALL
SELECT org_id, cert_type, valid_to, 'CERTIFICATION'
FROM vendor.vendor_certification
WHERE valid_to <= CURRENT_DATE + 30 AND verification_status = 'VERIFIED'
UNION ALL
SELECT org_id, declaration_type, valid_to, 'TAX_DECLARATION'
FROM kyc.tax_declaration
WHERE valid_to <= CURRENT_DATE + 30 AND status = 'VERIFIED';

-- ==========================================================================
-- 15. SEED: roles and permissions
-- ==========================================================================
INSERT INTO identity.role (code, scope, description) VALUES
  ('VENDOR_OWNER',      'ORG',      'Full control of a vendor organisation'),
  ('VENDOR_OPS',        'ORG',      'Listings, stock and order fulfilment'),
  ('VENDOR_FINANCE',    'ORG',      'Payouts, ledger and invoices'),
  ('BUYER_OWNER',       'ORG',      'Full control of a buyer organisation'),
  ('BUYER_PROCUREMENT', 'ORG',      'Search, cart and order placement within limits'),
  ('BUYER_FINANCE',     'ORG',      'Invoices, payments and approvals'),
  ('BUYER_VIEWER',      'ORG',      'Read-only access'),
  ('OPS_ONBOARDING',    'PLATFORM', 'KYC review queue'),
  ('OPS_CATALOG',       'PLATFORM', 'Master catalog governance'),
  ('OPS_QC',            'PLATFORM', 'Inspection bench'),
  ('OPS_LOGISTICS',     'PLATFORM', 'Shipments and riders'),
  ('FINANCE',           'PLATFORM', 'Invoices, settlements and payouts'),
  ('SUPPORT',           'PLATFORM', 'Tickets and disputes'),
  ('RIDER',             'PLATFORM', 'Pickup and delivery tasks'),
  ('PLATFORM_ADMIN',    'PLATFORM', 'RBAC, configuration and audit');

INSERT INTO identity.permission (code, module, description, is_sensitive) VALUES
  ('listing.create',   'listing',  'Create a listing',                    FALSE),
  ('listing.publish',  'listing',  'Publish a listing',                   FALSE),
  ('listing.approve',  'listing',  'Approve a listing for sale',          FALSE),
  ('unit.serial.add',  'listing',  'Add serial numbers',                  FALSE),
  ('order.place',      'ordering', 'Place an order',                      FALSE),
  ('order.approve',    'ordering', 'Approve an order above a limit',      TRUE),
  ('order.override',   'ordering', 'Manually change order state',         TRUE),
  ('kyc.review',       'kyc',      'Open the KYC queue',                  FALSE),
  ('kyc.approve',      'kyc',      'Approve an organisation',             TRUE),
  ('kyc.document.view','kyc',      'Open a KYC document',                 TRUE),
  ('bank.update',      'kyc',      'Change a bank account',               TRUE),
  ('qc.report.create', 'qc',       'Record an inspection',                FALSE),
  ('qc.verdict.override','qc',     'Override an automated verdict',       TRUE),
  ('catalog.sku.write','catalog',  'Create or edit a SKU',                FALSE),
  ('payout.release',   'payment',  'Release money to a vendor',           TRUE),
  ('invoice.issue',    'payment',  'Issue a tax invoice',                 TRUE),
  ('config.write',     'platform', 'Change platform configuration',       TRUE),
  ('audit.read',       'platform', 'Read the audit log',                  TRUE);

-- ==========================================================================
-- 16. SEED: platform configuration
-- ==========================================================================
INSERT INTO platform.platform_config (key, value_json) VALUES
  ('warranty.default.A_PLUS',        '"M6"'),
  ('warranty.default.A',             '"M3"'),
  ('warranty.default.B',             '"D30"'),
  ('qc.min_sellable_score',          '70'),
  ('return.window_hours',            '48'),
  ('eway.threshold_inr',             '50000'),
  ('price.guardrail_upper_multiple', '3.0'),
  ('price.guardrail_lower_multiple', '0.3'),
  ('listing.stale_days',             '60'),
  ('serial.deadline_hours',          '12'),
  ('kyc.four_eyes_gmv_threshold',    '2500000'),
  ('stock.hold_minutes',             '20'),
  ('grade_b.min_photos',             '4'),
  ('msme.max_payment_days',          '45'),
  ('tds.section_194o_rate',          '1.0');

INSERT INTO qc.qc_tolerance_rule (field, comparison, tolerance_value, severity, is_blocking) VALUES
  ('ram_detected_gb',    'EXACT',        NULL,   'BLOCKING', TRUE),
  ('storage_detected_gb','EXACT',        NULL,   'BLOCKING', TRUE),
  ('cpu_detected',       'EXACT',        NULL,   'BLOCKING', TRUE),
  ('bios_locked',        'EXACT',        'false','BLOCKING', TRUE),
  ('mdm_locked',         'EXACT',        'false','BLOCKING', TRUE),
  ('computrace_active',  'EXACT',        'false','BLOCKING', TRUE),
  ('smart_status',       'EXACT',        'OK',   'BLOCKING', TRUE),
  ('battery_health_pct', 'ONE_BAND_DOWN', '1',   'MAJOR',    FALSE),
  ('grade',              'ONE_BAND_DOWN', '1',   'MAJOR',    FALSE),
  ('screen_size',        'WITHIN_PCT',   '0',    'MAJOR',    FALSE),
  ('cycle_count',        'GTE',          '0',    'MINOR',    FALSE);

INSERT INTO payment.commission_rule (vendor_tier, rate_pct, effective_from) VALUES
  ('WATCHLIST', 8.0, CURRENT_DATE),
  ('BRONZE',    7.0, CURRENT_DATE),
  ('SILVER',    6.0, CURRENT_DATE),
  ('GOLD',      5.5, CURRENT_DATE),
  ('PLATINUM',  4.5, CURRENT_DATE);

INSERT INTO logistics.carrier (code, name, adapter_key, supports_leg, priority) VALUES
  ('INHOUSE',  'TrueTech in-house team', 'inhouse',  ARRAY['INBOUND','OUTBOUND','RETURN'], 10),
  ('BLUEDART', 'Blue Dart',              'bluedart', ARRAY['INBOUND','OUTBOUND','RETURN'], 20),
  ('PORTER',   'Porter',                 'porter',   ARRAY['INBOUND'],                     30);

-- ##########################################################################
-- END OF SCHEMA
--
-- Verify with:
--   SELECT table_schema, COUNT(*) FROM information_schema.tables
--   WHERE table_schema IN ('identity','customer','vendor','kyc','catalog',
--     'listing','ordering','qc','logistics','payment','platform')
--   GROUP BY table_schema ORDER BY table_schema;
-- ##########################################################################
