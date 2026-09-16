-- Maker-checker as a table, and the authority that decides who may check.
--
-- **The database refuses self-approval.** `ck_maker_is_not_checker` is the whole
-- point of this table: a control that lives only in a service is a control one
-- bug away from not existing, and the customer side already states the same rule
-- as VR-123 — an approver may never approve their own order. It has to read the
-- same on both sides of the house.

CREATE TABLE identity.approval_request (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- JOURNAL | PAYOUT_RUN | CREDIT_NOTE | VENDOR_BANK | PRICE_OVERRIDE |
  -- KYC_APPLICATION | PERIOD_CLOSE | GST_RETURN | WRITE_OFF | REFUND
  doc_type            text NOT NULL,
  doc_id              uuid NOT NULL,
  amount              numeric(14,2) NULL,
  maker_id            uuid NOT NULL REFERENCES identity.user_account(id),
  made_at             timestamptz NOT NULL DEFAULT now(),
  checker_id          uuid NULL REFERENCES identity.user_account(id),
  checked_at          timestamptz NULL,
  decision            text NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reason              text NULL,
  -- The permission the checker had to hold. Recorded rather than looked up
  -- later: role bundles change, and an audit asks what was required that day.
  required_permission text NOT NULL,
  status              text NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT ck_maker_is_not_checker CHECK (checker_id IS NULL OR checker_id <> maker_id),
  -- A decision is a claim about who, when and what. A third of it is not one.
  CONSTRAINT ck_approval_decided CHECK (
    (status = 'PENDING' AND checker_id IS NULL AND checked_at IS NULL AND decision IS NULL)
    OR (status = 'WITHDRAWN')
    OR (status IN ('APPROVED', 'REJECTED')
        AND checker_id IS NOT NULL AND checked_at IS NOT NULL AND decision IS NOT NULL)
  )
);

-- One open request per document. A second one is two people approving halves of
-- the same thing and each believing the other saw all of it.
CREATE UNIQUE INDEX uq_approval_open ON identity.approval_request (doc_type, doc_id)
  WHERE status = 'PENDING';
CREATE INDEX ix_approval_pending ON identity.approval_request (status, made_at DESC);

/*
 * Delegation of authority.
 *
 * Amount decides who may approve, because a Rs 5,000 credit note and a
 * Rs 5,00,000 credit note are not the same decision. Bands are data so the
 * ladder is an ops change behind `platform.config.write` rather than a deploy.
 */
CREATE TABLE identity.authority_band (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type                text NOT NULL,
  min_amount              numeric(14,2) NOT NULL DEFAULT 0,
  -- NULL is "no ceiling", which is what the top band of every ladder needs.
  max_amount              numeric(14,2) NULL,
  required_role           text NOT NULL,
  requires_second_checker boolean NOT NULL DEFAULT false,
  effective_from          date NOT NULL DEFAULT CURRENT_DATE,
  effective_to            date NULL,
  CONSTRAINT ck_band_range CHECK (max_amount IS NULL OR max_amount > min_amount)
);

CREATE INDEX ix_authority_band ON identity.authority_band (doc_type, min_amount);

-- A starting ladder. Deliberately conservative at the top: a second checker on
-- anything above five lakh is cheap, and the alternative is one signature on a
-- number nobody else saw.
INSERT INTO identity.authority_band
  (doc_type, min_amount, max_amount, required_role, requires_second_checker) VALUES
  ('PAYOUT_RUN',     0,       500000,  'CONTROLLER', false),
  ('PAYOUT_RUN',     500000,  NULL,    'CONTROLLER', true),
  ('CREDIT_NOTE',    0,       50000,   'CONTROLLER', false),
  ('CREDIT_NOTE',    50000,   NULL,    'CONTROLLER', true),
  ('REFUND',         0,       50000,   'CONTROLLER', false),
  ('REFUND',         50000,   NULL,    'CONTROLLER', true),
  ('WRITE_OFF',      0,       25000,   'CONTROLLER', false),
  ('WRITE_OFF',      25000,   NULL,    'PLATFORM_SUPERADMIN', true),
  ('JOURNAL',        0,       NULL,    'CONTROLLER', false),
  ('VENDOR_BANK',    0,       NULL,    'CONTROLLER', false),
  ('PRICE_OVERRIDE', 0,       NULL,    'CONTROLLER', false),
  ('KYC_APPLICATION', 0,      NULL,    'OPS_MANAGER', false),
  ('PERIOD_CLOSE',   0,       NULL,    'CONTROLLER', false),
  ('GST_RETURN',     0,       NULL,    'CONTROLLER', false);

/*
 * Time-boxed access.
 *
 * `identity.user_role.expires_at` has existed since the baseline and **nothing
 * has ever read it** — `IdentityService.getUser` aggregates every grant a user
 * has with no date filter, so an engagement that ended on Tuesday was still a
 * live login on Wednesday. The query is fixed in this migration's companion
 * commit; this index is what keeps that filter cheap.
 */
CREATE INDEX ix_user_role_live ON identity.user_role (user_id)
  WHERE expires_at IS NULL;

COMMENT ON COLUMN identity.user_role.expires_at IS
  'When this grant stops. Read by IdentityService.getUser: an expired grant is not a role. A CA engagement defaults to 90 days.';

/*
 * The seat expiry, as distinct from the grant expiry above.
 *
 * The spec asked for `identity.org_member.access_expires_at`; there is no
 * org_member table on this schema — membership is `user_account.org_id` plus
 * rows in `user_role` — so the column goes where membership actually lives.
 * Both are needed and they are not the same statement: `user_role.expires_at`
 * ends one grant and leaves the login alive, `access_expires_at` ends the
 * engagement. A CA whose audit finished should not be able to sign in at all,
 * not sign in to an empty console.
 *
 * It is carried in the access token as `axp` so `AuthGuard` can refuse without
 * a database round trip on every request; the window in which a token outlives
 * the expiry is bounded by JWT_ACCESS_TTL_SECONDS, and refresh re-reads the row.
 */
ALTER TABLE identity.user_account ADD COLUMN access_expires_at timestamptz NULL;

COMMENT ON COLUMN identity.user_account.access_expires_at IS
  'When this person stops having a login at all. NULL is a permanent seat. Refused at AuthGuard via the axp claim, and at login. External seats (CA) default to 90 days.';

CREATE INDEX ix_user_account_access_expiry ON identity.user_account (access_expires_at)
  WHERE access_expires_at IS NOT NULL;
