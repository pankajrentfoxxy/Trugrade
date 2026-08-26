# TrueTech Schema — Addendum A
## Customer and Vendor registration, profile and account management

**Status:** extends the main schema document. 23 new tables + 4 altered tables.
**Why this addendum exists:** the main schema modelled *what a verified org is*. It did not model *how a person becomes one, what they fill in, who else in their company can act, and what they change afterwards*. That is roughly 40% of the real product surface — signup, profile, team, preferences, approvals — and all of it was missing.

---

## A.0 What was missing, stated plainly

| Gap | Consequence if we shipped without it | New table |
|---|---|---|
| No contact persons beyond the signup user | Rider calls the owner at midnight because there is no warehouse contact | `org_contact` |
| No step-by-step onboarding state | "Save and finish later" is impossible; a half-finished application is invisible to the sales team | `onboarding_progress` |
| No record of each verification attempt | We cannot prove we checked a GSTIN on a given date, or tell a support agent why it failed twice | `verification_check` |
| No team invitation flow | Every firm shares one login; every audit trail becomes useless | `user_invitation` |
| No spend limits or approval rules for buyers | A junior procurement assistant can place a ₹40 lakh order | `buyer_approval_policy`, `order_approval` |
| No vendor capability declaration | We cannot route an RFQ to vendors who actually deal in that brand | `vendor_capability` |
| No facility/warehouse detail | Pickups arrive when the warehouse is shut | `vendor_facility`, `facility_hours` |
| No certification records | The trust badges on listings have nothing behind them | `vendor_certification` |
| No trade references | High-value vendor underwriting has no input | `trade_reference` |
| No credit application | Buyer credit terms were a column with no process behind it | `credit_application` |
| No tax declarations | TDS lower-deduction certificates and MSME status had nowhere to live | `tax_declaration` |
| No notification or communication preferences | We spam people, or fail to reach them, and DPDP consent is unprovable | `org_preference`, `consent_record` |
| No profile change control | A vendor silently edits their legal name after approval and the invoice breaks | `profile_change_request` |
| No email/mobile change protection | Account takeover's easiest path | `contact_change_request` |
| No saved searches or buying preferences | Repeat buyers restart from zero every time | `saved_search`, `buyer_preference` |
| No signup attribution | We will not know which channel brings good vendors | `registration_lead` |

---

# A.1 Signup and onboarding (5 tables)

## A.1.1 `registration_lead`

**Why:** a person who starts signup and abandons at step 3 is the most valuable follow-up the sales team has. Without this table they are invisible, because `organization` is only created after step 2.

**Grain:** one row = one signup attempt, from the first form submission.

| Column | Type | Key | Null | Why this column exists |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `intended_org_type` | `org_type` | IX | N | `VENDOR` or `BUYER`. The two funnels have different drop-off patterns and different follow-up scripts. |
| `company_name_raw` | TEXT | N | As typed, before any verification. Used for fuzzy duplicate detection against existing orgs. |
| `contact_name` | TEXT | N | — |
| `mobile` | TEXT | IX | N | Normalised `+91XXXXXXXXXX`. The primary follow-up channel in India. |
| `email` | CITEXT | IX | Y | — |
| `city` / `state_code` | TEXT / CHAR(2) | Y | Territory assignment for the sales team. |
| `expected_monthly_volume` | INT | Y | Self-declared units. Prioritises follow-up. |
| `categories_dealt` | TEXT[] | Y | Vendor-side: which brands or segments they handle. |
| `source` | TEXT | IX | N | `ORGANIC` / `GOOGLE_ADS` / `WHATSAPP` / `REFERRAL` / `FIELD_SALES` / `TRADE_FAIR`. |
| `utm_source` / `utm_medium` / `utm_campaign` | TEXT | Y | Channel attribution. Without it we spend on the wrong channel for a year. |
| `referred_by_org_id` | UUID | FK→`organization` | Y | Vendor and buyer referral programme. |
| `referral_code` | TEXT | IX | Y | — |
| `status` | TEXT | IX | N | `NEW` / `OTP_SENT` / `VERIFIED` / `CONVERTED` / `ABANDONED` / `DISQUALIFIED`. |
| `converted_org_id` | UUID | FK→`organization`, UQ | Y | Set when the lead becomes a real org. Null while in the funnel. |
| `abandoned_at_step` | TEXT | Y | Which step they dropped at. This one column tells the product team where the form is broken. |
| `assigned_to` | UUID | FK→`user_account` | Y | Sales owner. |
| `last_contacted_at` | TIMESTAMPTZ | Y | — |
| `ip` / `user_agent` / `device_fingerprint` | INET / TEXT / TEXT | Y | Velocity checks — twenty signups from one device is a fraud pattern. |
| `created_at` / `updated_at` | TIMESTAMPTZ | N | — |

---

## A.1.2 `onboarding_progress`

**Why:** onboarding is 7 steps for a vendor and 5 for a buyer, spread over days. We need to render the stepper, resume where they left off, and report where applications stall.

**Grain:** one row = one step of one org's onboarding.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, UQ(org_id,step_code) | N | — |
| `step_code` | TEXT | N | `ACCOUNT` / `BUSINESS_PROFILE` / `STATUTORY` / `CONTACTS` / `ADDRESSES` / `DOCUMENTS` / `BANK` / `CAPABILITY` / `AGREEMENT` / `REVIEW`. Superset covering both flows; which steps apply is derived from `org_type` and `constitution`. |
| `step_order` | INT | N | Display order. Stored rather than hardcoded so the flow can be reordered without a release. |
| `is_required` | BOOLEAN | N | A proprietorship skips `INCORPORATION`; an LLP does not. |
| `status` | TEXT | IX | N | `NOT_STARTED` / `IN_PROGRESS` / `SUBMITTED` / `NEEDS_FIX` / `COMPLETE`. |
| `completion_pct` | INT | N | Within-step progress, for the 62% bar on the sidebar. |
| `blocking_reason` | TEXT | Y | Shown verbatim: "Address proof is older than three months." Vague blockers create support tickets. |
| `first_started_at` / `completed_at` | TIMESTAMPTZ | Y | Time-per-step reporting shows which step is the bottleneck. |
| `last_saved_at` | TIMESTAMPTZ | Y | Powers "Draft saved 30 seconds ago". |
| `draft_json` | JSONB | Y | **Partially filled form data.** This is what makes "save and finish later" real. Cleared once the step is `COMPLETE` and the data has moved to its proper tables. |

**Design note:** draft data lives in JSONB deliberately. Writing half-valid data into `gst_profile` would mean every downstream query has to defend against incomplete rows. Drafts stay in one place until they are valid, then they are promoted.

---

## A.1.3 `verification_check`

**Why:** every external verification — GSTIN, PAN, penny-drop, IFSC, Udyam, CIN — is a paid API call with a pass/fail outcome and a cost. We need the attempt history for four reasons: proving we checked, letting support explain a failure, controlling spend, and detecting someone brute-forcing GSTINs through our form.

**Grain:** one row = one call to one verification provider for one org.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `check_type` | TEXT | IX | N | `GSTIN` / `PAN` / `PAN_GSTIN_LINK` / `BANK_PENNY_DROP` / `IFSC` / `UDYAM` / `CIN` / `AADHAAR_ESIGN` / `OEM_WARRANTY`. |
| `input_value_masked` | TEXT | N | `06AAEC****1ZP`. Masked, because this table will be read by support staff who do not need the full value. |
| `input_hash` | TEXT | IX | N | For matching and rate limiting without exposing the value. |
| `provider` | TEXT | N | Which vendor API. We will switch providers; the history must say which one answered. |
| `status` | TEXT | IX | N | `PASS` / `FAIL` / `MISMATCH` / `PROVIDER_ERROR` / `TIMEOUT`. **`PROVIDER_ERROR` is separated from `FAIL` deliberately** — the first is our problem, the second is the applicant's, and confusing them makes people re-upload documents for no reason. |
| `response_summary` | JSONB | Y | Structured extract: returned legal name, status, state. Not the raw payload. |
| `match_score` | NUMERIC(5,2) | Y | For fuzzy name matches. |
| `failure_reason` | TEXT | Y | Human-readable, shown to the applicant. |
| `cost_paise` | INT | Y | API calls cost money. Aggregated, this is a real monthly line item. |
| `latency_ms` | INT | Y | Provider SLA monitoring. |
| `attempt_no` | INT | N | Third attempt on the same GSTIN with different values is a signal, not a coincidence. |
| `triggered_by` | UUID | FK→`user_account` | Y | Null for automated re-verification jobs. |
| `checked_at` | TIMESTAMPTZ | IX | N | — |

---

## A.1.4 `user_invitation`

**Why:** a firm's owner signs up, then needs to add their accounts person and warehouse supervisor. Without an invitation flow they share the owner's password, and every audit trail becomes meaningless.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `email` | CITEXT | Y | One of email or mobile is required. |
| `mobile` | TEXT | Y | Warehouse staff often have no work email. |
| `full_name` | TEXT | N | — |
| `role_id` | UUID | FK→`role` | N | The role is decided at invitation, not after acceptance. |
| `invited_by` | UUID | FK→`user_account` | N | — |
| `token_hash` | TEXT | UQ | N | Single-use invitation link, hashed. |
| `status` | TEXT | IX | N | `PENDING` / `ACCEPTED` / `EXPIRED` / `REVOKED`. |
| `expires_at` | TIMESTAMPTZ | N | 7 days. An invitation link that never expires is a permanent back door. |
| `accepted_at` | TIMESTAMPTZ | Y | — |
| `accepted_user_id` | UUID | FK→`user_account` | Y | — |

---

## A.1.5 `contact_change_request`

**Why:** changing the registered email or mobile is the standard first move in an account takeover. It must not be a simple `UPDATE`.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `user_id` | UUID | FK, IX | N | — |
| `field` | TEXT | N | `EMAIL` or `MOBILE`. |
| `old_value_masked` / `new_value` | TEXT | N | — |
| `otp_old_verified_at` | TIMESTAMPTZ | Y | **Both the old and the new address must be verified.** Verifying only the new one lets an attacker who already has session access lock the owner out. |
| `otp_new_verified_at` | TIMESTAMPTZ | Y | — |
| `status` | TEXT | IX | N | `PENDING` / `COMPLETED` / `EXPIRED` / `CANCELLED`. |
| `notified_old_at` | TIMESTAMPTZ | Y | The old address is always told, even after success, so a real owner learns immediately. |
| `ip` / `user_agent` | INET / TEXT | Y | — |
| `created_at` / `completed_at` | TIMESTAMPTZ | N / Y | — |

---

# A.2 Shared profile tables (6 tables — apply to both buyer and vendor)

## A.2.1 `org_contact` — the table whose absence hurts most operationally

**Why:** the signup user is not the person a rider should call at a warehouse, nor the person finance should chase for a GST mismatch. Real firms have four to six functional contacts, and some of them are not platform users at all.

**Grain:** one row = one named contact for one purpose in one org.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `contact_type` | TEXT | IX | N | `OWNER` / `AUTHORISED_SIGNATORY` / `PROCUREMENT` / `FINANCE` / `WAREHOUSE` / `LOGISTICS` / `IT_ADMIN` / `ESCALATION` / `GRIEVANCE`. Different events notify different types — a pickup notifies `WAREHOUSE`, a payment reminder notifies `FINANCE`. |
| `full_name` | TEXT | N | — |
| `designation` | TEXT | Y | Shown on tickets so our agent knows who they are speaking to. |
| `mobile` | TEXT | N | The one field a rider actually needs. |
| `alternate_mobile` | TEXT | Y | India-specific reality: the first number is often unreachable at a warehouse. |
| `email` | CITEXT | Y | — |
| `whatsapp_number` | TEXT | Y | Frequently different from the calling number. WhatsApp is our primary notification channel. |
| `user_id` | UUID | FK→`user_account` | Y | **Nullable and important.** A warehouse supervisor is a contact but may never log in. Forcing every contact to be a user would either block onboarding or create dormant accounts. |
| `address_id` | UUID | FK→`org_address` | Y | Which site this person is responsible for. A vendor with three warehouses has three warehouse contacts. |
| `is_primary` | BOOLEAN | N | One primary per `contact_type`, enforced by a partial unique index. |
| `is_escalation` | BOOLEAN | N | Included in escalation chains when the primary does not respond. |
| `available_from` / `available_to` | TIME | Y | "Do not call before 10:00." Riders and agents see this. |
| `preferred_language` | TEXT | N | Default `hi` for warehouse contacts. Calling a warehouse supervisor in English wastes both people's time. |
| `is_active` | BOOLEAN | N | — |

**Partial unique index:** `UNIQUE (org_id, contact_type) WHERE is_primary AND is_active`

---

## A.2.2 `org_preference`

**Why:** notification preferences, communication channels and operational defaults are org-level settings that would otherwise be twenty nullable columns on `organization`.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `org_id` | UUID | PK, FK | N | One-to-one. |
| `notify_email` / `notify_sms` / `notify_whatsapp` / `notify_push` | BOOLEAN | N | Channel opt-in. **Transactional messages ignore these** (a dispatch notice is not optional); only marketing and digest messages respect them. |
| `notify_email_address` | CITEXT | Y | Often a shared `orders@company.com` rather than a person. |
| `digest_frequency` | TEXT | N | `REALTIME` / `DAILY` / `WEEKLY` / `OFF`. A vendor with 200 orders a week does not want 200 emails. |
| `quiet_hours_from` / `quiet_hours_to` | TIME | Y | Non-urgent notifications are held. |
| `preferred_language` | TEXT | N | `en` / `hi`. |
| `invoice_delivery_email` | CITEXT | Y | Accounts departments want invoices at a separate address. |
| `auto_accept_orders` | BOOLEAN | N | Vendor-side. Skips the manual accept step for trusted vendors. |
| `auto_resource_on_qc_fail` | BOOLEAN | N | Buyer-side. The stored answer to "if a unit fails, re-source or refund?" — asked once at onboarding rather than in the middle of every failure. |
| `default_shipping_address_id` | UUID | FK | Y | — |
| `default_billing_gst_profile_id` | UUID | FK | Y | Multi-state buyers pick a default and override at checkout. |
| `po_required` | BOOLEAN | N | Some buyers cannot process an invoice without their PO number. If true, checkout makes it mandatory. |
| `updated_at` | TIMESTAMPTZ | N | — |

---

## A.2.3 `consent_record`

**Why:** DPDP requires provable, itemised, purpose-specific consent — and provable withdrawal. A boolean on a user row cannot show what they agreed to, when, or in which language.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` / `user_id` | UUID | FK, IX | N / Y | — |
| `purpose` | TEXT | IX | N | `KYC_VERIFICATION` / `TRANSACTIONAL_COMMS` / `MARKETING` / `WHATSAPP_BUSINESS` / `CREDIT_CHECK` / `DATA_SHARING_LOGISTICS`. Itemised, because blanket consent is not valid consent. |
| `granted` | BOOLEAN | N | — |
| `notice_version` | TEXT | N | Which privacy notice they saw. |
| `notice_language` | TEXT | N | **Consent given against a Hindi notice must be provable as such.** DPDP requires the notice in the language the person chose. |
| `channel` | TEXT | N | `WEB` / `APP` / `FIELD_AGENT` / `WHATSAPP`. |
| `ip` / `user_agent` | INET / TEXT | Y | — |
| `granted_at` | TIMESTAMPTZ | N | — |
| `withdrawn_at` | TIMESTAMPTZ | Y | Non-null stops the relevant processing. The row is never deleted — proof of the withdrawal is itself a compliance artifact. |

---

## A.2.4 `profile_change_request`

**Why:** after verification, some fields cannot be freely edited. If a vendor changes their legal name post-approval, every future invoice is wrong and the GST mismatch is ours to explain.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `entity_type` / `entity_id` | TEXT / UUID | N | Which record. |
| `field` | TEXT | N | `legal_name`, `gstin`, `constitution`, `bank_account`, `pickup_address`. |
| `old_value` / `new_value` | TEXT | N | — |
| `reason` | TEXT | N | Required from the requester. |
| `supporting_doc_id` | UUID | FK→`kyc_document` | Y | A legal name change needs an amended GST certificate, not a form entry. |
| `status` | TEXT | IX | N | `PENDING` / `APPROVED` / `REJECTED` / `AUTO_APPROVED`. |
| `requires_reverification` | BOOLEAN | N | True re-triggers the relevant API check. Changing a GSTIN always does. |
| `reviewed_by` / `reviewed_at` / `review_note` | UUID / TIMESTAMPTZ / TEXT | Y | — |
| `created_at` | TIMESTAMPTZ | N | — |

**Which fields are locked after verification:** `legal_name`, `gstin`, `pan`, `constitution`, `bank_account`. Everything else — contacts, addresses, preferences, capabilities — is freely editable.

---

## A.2.5 `tax_declaration`

**Why:** TDS lower-deduction certificates, MSME status and TCS applicability all change what we withhold. They have expiry dates and supporting certificates, so they cannot be booleans.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `declaration_type` | TEXT | IX | N | `MSME_UDYAM` / `TDS_LOWER_DEDUCTION` / `TDS_NIL` / `TCS_EXEMPT` / `SEZ` / `EXPORT_ORIENTED`. |
| `reference_number` | TEXT | N | The Udyam number or the 197 certificate number. |
| `rate_pct` | NUMERIC(5,2) | Y | The reduced TDS rate where applicable. **Read by the settlement job**, which is why it must be a number and not a scanned PDF. |
| `valid_from` / `valid_to` | DATE | IX | N | Certificates expire, usually at financial year end. An expired certificate silently under-deducting TDS is a tax exposure. |
| `document_id` | UUID | FK→`kyc_document` | N | The certificate itself. |
| `status` | TEXT | IX | N | `PENDING` / `VERIFIED` / `REJECTED` / `EXPIRED`. |
| `verified_by` / `verified_at` | UUID / TIMESTAMPTZ | Y | — |

---

## A.2.6 `trade_reference`

**Why:** for a vendor expecting high volume or a buyer asking for credit, two trade references are the cheapest underwriting available.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `company_name` / `contact_person` / `mobile` / `email` | TEXT | N / N / N / Y | — |
| `relationship` | TEXT | N | `CUSTOMER` / `SUPPLIER` / `BANKER`. |
| `years_associated` | INT | Y | — |
| `monthly_business_value` | NUMERIC(14,2) | Y | Self-declared, verified on the call. |
| `verification_status` | TEXT | IX | N | `PENDING` / `CONTACTED` / `POSITIVE` / `NEGATIVE` / `UNREACHABLE`. |
| `verification_notes` | TEXT | Y | Internal only. |
| `verified_by` / `verified_at` | UUID / TIMESTAMPTZ | Y | — |

---

# A.3 Buyer-specific tables (5 tables)

## A.3.1 `buyer_approval_policy`

**Why:** in a real company, a procurement executive raises the order and a manager approves it. Without this, either everyone can spend without limit (unacceptable to the buyer's finance team) or only the owner can order (unacceptable to everyone).

**This is a genuine B2B differentiator.** Consumer checkout has no concept of it.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `user_id` | UUID | FK→`user_account` | Y | Null means the rule applies to a role rather than a person. |
| `role_id` | UUID | FK→`role` | Y | Exactly one of `user_id` or `role_id` is set. |
| `max_order_value` | NUMERIC(14,2) | Y | Above this, approval is required. Null = unlimited. |
| `max_monthly_value` | NUMERIC(14,2) | Y | Rolling 30-day cap. |
| `max_units_per_order` | INT | Y | — |
| `allowed_payment_modes` | `payment_mode[]` | N | A junior buyer may use prepaid but not the company credit line. |
| `requires_approval_above` | NUMERIC(14,2) | Y | The threshold that triggers `order_approval`. |
| `approver_user_id` | UUID | FK | Y | Who approves. Null falls back to the org owner. |
| `cost_centres_allowed` | TEXT[] | Y | Restricts which budget they can draw on. |
| `is_active` | BOOLEAN | N | — |

## A.3.2 `order_approval`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `order_id` | UUID | FK, IX | N | — |
| `requested_by` / `approver_user_id` | UUID | FK | N | — |
| `status` | TEXT | IX | N | `PENDING` / `APPROVED` / `REJECTED` / `EXPIRED`. **The order sits at `CREATED` and stock is held but not confirmed while pending.** |
| `order_value` | NUMERIC(14,2) | N | Snapshot at request time. |
| `policy_id` | UUID | FK→`buyer_approval_policy` | N | Which rule triggered this. |
| `comment` | TEXT | Y | — |
| `requested_at` / `decided_at` | TIMESTAMPTZ | N / Y | — |
| `expires_at` | TIMESTAMPTZ | N | Stock cannot be held indefinitely waiting for a manager. |

## A.3.3 `credit_application`

**Why:** `buyer_profile.credit_limit` was a number with no process. This is the process.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `requested_limit` / `requested_terms_days` | NUMERIC(14,2) / INT | N | — |
| `annual_turnover` | NUMERIC(14,2) | Y | Self-declared, checked against financials. |
| `years_in_business` | INT | Y | — |
| `financials_doc_id` | UUID | FK→`kyc_document` | Y | Audited financials or ITR. |
| `bank_statement_doc_id` | UUID | FK→`kyc_document` | Y | — |
| `security_deposit_amount` | NUMERIC(14,2) | Y | Reduces our exposure for a thin-file buyer. |
| `pdc_or_bg_details` | TEXT | Y | Post-dated cheque or bank guarantee reference — still standard in Indian B2B. |
| `credit_bureau_score` | INT | Y | If we pull a commercial bureau report. |
| `internal_risk_grade` | TEXT | Y | `LOW` / `MEDIUM` / `HIGH`. |
| `status` | TEXT | IX | N | `SUBMITTED` / `UNDER_REVIEW` / `APPROVED` / `APPROVED_REDUCED` / `REJECTED`. **`APPROVED_REDUCED` is separate** — approving ₹5 lakh against a ₹20 lakh request is the common outcome and the buyer must be told clearly. |
| `approved_limit` / `approved_terms_days` | NUMERIC(14,2) / INT | Y | — |
| `reviewed_by` / `reviewed_at` / `review_notes` | UUID / TIMESTAMPTZ / TEXT | Y | — |
| `valid_until` | DATE | Y | Credit limits are reviewed annually, not granted forever. |

## A.3.4 `buyer_preference`

**Why:** a repeat buyer purchasing the same three configurations quarterly should not re-specify them each time. This also feeds demand forecasting to the catalog and sourcing teams.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `org_id` | UUID | PK, FK | N | — |
| `preferred_brands` | TEXT[] | Y | Many corporates are standardised on one brand for support reasons. |
| `preferred_grades` | `grade_type[]` | Y | Some buyers will never accept grade B; showing it wastes their time. |
| `min_qc_score` | INT | Y | Filters applied by default on every search. |
| `min_battery_band` | `battery_band` | Y | — |
| `typical_ram_gb` / `typical_storage_gb` | INT | Y | Pre-fills search. |
| `budget_min` / `budget_max` | NUMERIC(14,2) | Y | Per unit. |
| `typical_order_qty` | INT | Y | Drives which tier price is shown first. |
| `buying_frequency` | TEXT | Y | `MONTHLY` / `QUARTERLY` / `ANNUAL` / `AD_HOC`. Times our outreach. |
| `requires_warranty_min` | `warranty_duration` | Y | — |
| `requires_data_wipe_cert` | BOOLEAN | N | Regulated industries always do. |
| `updated_at` | TIMESTAMPTZ | N | — |

## A.3.5 `saved_search`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` / `user_id` | UUID | FK, IX | N | — |
| `name` | TEXT | N | "Latitude 5420 16GB under ₹26k". |
| `filters_json` | JSONB | N | The full filter state. |
| `alert_enabled` | BOOLEAN | N | Notify when a matching listing appears below the target price. **This is how we convert a buyer who did not find what they wanted today** — the alternative is they leave and do not come back. |
| `alert_price_below` | NUMERIC(14,2) | Y | — |
| `last_alerted_at` | TIMESTAMPTZ | Y | Rate limits the alerts. |

---

# A.4 Vendor-specific tables (6 tables)

## A.4.1 `vendor_capability`

**Why:** RFQ routing, sourcing requests and catalog gap analysis all need to know what a vendor actually deals in. Guessing from their listing history only works after they have listed, which is too late.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `brand_id` | UUID | FK→`brand` | Y | Null means "any brand". |
| `category` | TEXT | N | `BUSINESS_LAPTOP` / `WORKSTATION` / `CONSUMER` / `MACBOOK` / `CHROMEBOOK`. |
| `monthly_capacity_units` | INT | N | **The number that decides whether we route a 500-unit RFQ to them.** |
| `typical_grade_mix` | JSONB | Y | `{"A_PLUS":20,"A":50,"B":30}` as percentages. Sets our expectation and flags a vendor who suddenly declares 100% A+. |
| `avg_price_band_min` / `avg_price_band_max` | NUMERIC(14,2) | Y | — |
| `sourcing_channels` | TEXT[] | N | `CORPORATE_BUYBACK` / `LEASE_RETURN` / `IMPORT` / `AUCTION` / `RETAIL_EXCHANGE` / `OEM_REFURB`. **Provenance matters** — it is our first defence against stolen stock and it determines whether the margin scheme applies for GST. |
| `can_provide_serials_upfront` | BOOLEAN | N | Decides whether they get serial-first or quantity-only listing rights. |
| `has_inhouse_testing` | BOOLEAN | N | Vendors who test before shipping have measurably higher QC pass rates. |
| `has_inhouse_repair` | BOOLEAN | N | Relevant for warranty repair partnerships later. |
| `lead_time_days` | INT | N | Realistic dispatch commitment. |
| `is_active` | BOOLEAN | N | — |

## A.4.2 `vendor_facility`

**Why:** `org_address` says where the warehouse is. It does not say whether a truck can reach the dock, whether they are open on Sunday, or how many machines they can hold.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `address_id` | UUID | FK→`org_address`, UQ | N | — |
| `facility_type` | TEXT | N | `WAREHOUSE` / `OFFICE` / `REFURB_UNIT` / `RETAIL`. |
| `storage_capacity_units` | INT | Y | Capacity planning for bulk deals. |
| `has_loading_dock` | BOOLEAN | N | Decides whether a mini-truck or a bike is dispatched. |
| `vehicle_access` | TEXT | N | `TRUCK` / `TEMPO` / `BIKE_ONLY`. A narrow-lane market address cannot take a tempo, and finding that out on the day costs a failed pickup. |
| `lift_available` | BOOLEAN | N | A third-floor pickup without a lift needs two riders. |
| `staff_count` | INT | Y | — |
| `testing_stations` | INT | Y | Capacity signal for vendors who pre-test. |
| `is_pickup_enabled` | BOOLEAN | N | — |
| `special_instructions` | TEXT | Y | "Entry from the rear gate only." Printed on the rider's task. |

## A.4.3 `facility_hours`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `facility_id` | UUID | FK CASCADE, UQ(facility_id,day_of_week) | N | — |
| `day_of_week` | INT | N | 0–6. |
| `open_time` / `close_time` | TIME | Y | Null on both = closed that day. |
| `is_closed` | BOOLEAN | N | Explicit rather than inferred from nulls, so a closure is unambiguous. |

**Plus `facility_holiday`** — `facility_id`, `holiday_date`, `reason`. India has a long and regionally variable holiday list. Scheduling a pickup on Diwali wastes a rider slot and annoys the vendor.

## A.4.4 `vendor_certification`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `cert_type` | TEXT | IX | N | `CPCB_EWASTE` / `ISO_9001` / `ISO_14001` / `R2` / `EPR` / `OEM_AUTHORISED_PARTNER`. |
| `issuing_body` / `certificate_number` | TEXT | N | — |
| `valid_from` / `valid_to` | DATE | IX | N | Certifications expire; an expired badge on a live listing is a false claim we made. |
| `document_id` | UUID | FK→`kyc_document` | N | — |
| `verification_status` | TEXT | IX | N | `PENDING` / `VERIFIED` / `REJECTED` / `EXPIRED`. |
| `shows_badge` | BOOLEAN | N | Only a verified, unexpired certificate displays a badge to buyers. |

## A.4.5 `vendor_payout_preference`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `org_id` | UUID | PK, FK | N | — |
| `preferred_cycle` | TEXT | N | `WEEKLY` / `T_PLUS_2` / `MONTHLY`. Requested by the vendor; granted based on tier. |
| `preferred_day_of_week` | INT | Y | Small vendors plan cash flow around a fixed day. |
| `min_payout_threshold` | NUMERIC(14,2) | N | Below this, the balance rolls to the next cycle. Avoids ₹400 NEFT transfers. |
| `auto_reinvest` | BOOLEAN | N | Reserved for a future feature; harmless to carry now. |
| `invoice_upload_required` | BOOLEAN | N | Under the agency model, some vendors raise their own invoice rather than using our self-billing. |

## A.4.6 `vendor_sourcing_declaration`

**Why:** the single most serious risk in used electronics is stolen stock. A per-batch declaration of where the machines came from creates both a deterrent and a paper trail if law enforcement ever asks.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `listing_id` | UUID | FK | Y | Per listing where declared at listing time. |
| `source_type` | TEXT | N | `CORPORATE_BUYBACK` / `LEASE_RETURN` / `AUCTION` / `IMPORT` / `RETAIL_EXCHANGE` / `OEM_REFURB`. |
| `source_org_name` | TEXT | Y | Which company the stock came from. |
| `acquisition_invoice_no` | TEXT | Y | Their purchase invoice reference. |
| `acquisition_date` | DATE | Y | — |
| `supporting_doc_id` | UUID | FK→`kyc_document` | Y | Required above a configurable value threshold. |
| `declared_by` / `declared_at` | UUID / TIMESTAMPTZ | N | The named person who attested to it. |

---

# A.5 Alterations to existing tables

| Table | Add | Why |
|---|---|---|
| `user_account` | `job_title TEXT`, `department TEXT`, `is_org_owner BOOLEAN`, `profile_photo_key TEXT`, `timezone TEXT DEFAULT 'Asia/Kolkata'`, `onboarding_completed_at TIMESTAMPTZ`, `terms_accepted_version TEXT` | Team management screens need role context; the owner flag decides who receives security alerts. |
| `organization` | `website TEXT`, `year_established INT`, `annual_turnover_band TEXT`, `employee_count_band TEXT`, `logo_key TEXT`, `about TEXT`, `profile_completeness_pct INT`, `first_order_at TIMESTAMPTZ`, `lifetime_gmv NUMERIC(14,2)` | The public vendor card and the internal account view both need these. `profile_completeness_pct` drives the nudge to finish a profile, which correlates directly with first order. |
| `org_address` | `is_pickup_enabled BOOLEAN`, `is_billing_enabled BOOLEAN`, `google_place_id TEXT`, `verified_at TIMESTAMPTZ` | An address a rider has actually reached once is worth marking as verified. |
| `bank_account` | `purpose TEXT` (`PAYOUT` / `REFUND`), `is_verified_by_document BOOLEAN` | Buyers need a refund account too; the same table now serves both, distinguished by purpose. |

---

# A.6 DDL for the addendum

```sql
-- ============ SIGNUP & ONBOARDING ============
CREATE TABLE registration_lead (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intended_org_type org_type NOT NULL,
  company_name_raw TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email CITEXT,
  city TEXT, state_code CHAR(2),
  expected_monthly_volume INT,
  categories_dealt TEXT[],
  source TEXT NOT NULL DEFAULT 'ORGANIC',
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
  referred_by_org_id UUID REFERENCES organization(id),
  referral_code TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  converted_org_id UUID UNIQUE REFERENCES organization(id),
  abandoned_at_step TEXT,
  assigned_to UUID REFERENCES user_account(id),
  last_contacted_at TIMESTAMPTZ,
  ip INET, user_agent TEXT, device_fingerprint TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_lead_funnel ON registration_lead (intended_org_type, status, created_at DESC);
CREATE INDEX idx_lead_mobile ON registration_lead (mobile);

CREATE TABLE onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  step_code TEXT NOT NULL,
  step_order INT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  completion_pct INT NOT NULL DEFAULT 0,
  blocking_reason TEXT,
  first_started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, last_saved_at TIMESTAMPTZ,
  draft_json JSONB,
  UNIQUE (org_id, step_code)
);

CREATE TABLE verification_check (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id),
  check_type TEXT NOT NULL,
  input_value_masked TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  response_summary JSONB,
  match_score NUMERIC(5,2),
  failure_reason TEXT,
  cost_paise INT, latency_ms INT,
  attempt_no INT NOT NULL DEFAULT 1,
  triggered_by UUID REFERENCES user_account(id),
  checked_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_vcheck_org ON verification_check (org_id, check_type, checked_at DESC);
CREATE INDEX idx_vcheck_hash ON verification_check (input_hash);

CREATE TABLE user_invitation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email CITEXT, mobile TEXT, full_name TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES role(id),
  invited_by UUID NOT NULL REFERENCES user_account(id),
  token_hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_user_id UUID REFERENCES user_account(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (email IS NOT NULL OR mobile IS NOT NULL)
);

CREATE TABLE contact_change_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_account(id),
  field TEXT NOT NULL CHECK (field IN ('EMAIL','MOBILE')),
  old_value_masked TEXT NOT NULL, new_value TEXT NOT NULL,
  otp_old_verified_at TIMESTAMPTZ, otp_new_verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING',
  notified_old_at TIMESTAMPTZ,
  ip INET, user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
);

-- ============ SHARED PROFILE ============
CREATE TABLE org_contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL,
  full_name TEXT NOT NULL, designation TEXT,
  mobile TEXT NOT NULL, alternate_mobile TEXT,
  email CITEXT, whatsapp_number TEXT,
  user_id UUID REFERENCES user_account(id),
  address_id UUID REFERENCES org_address(id),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_escalation BOOLEAN NOT NULL DEFAULT FALSE,
  available_from TIME, available_to TIME,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX uq_primary_contact ON org_contact (org_id, contact_type)
  WHERE is_primary AND is_active;

CREATE TABLE org_preference (
  org_id UUID PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  notify_email BOOLEAN NOT NULL DEFAULT TRUE,
  notify_sms BOOLEAN NOT NULL DEFAULT TRUE,
  notify_whatsapp BOOLEAN NOT NULL DEFAULT TRUE,
  notify_push BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email_address CITEXT,
  digest_frequency TEXT NOT NULL DEFAULT 'REALTIME',
  quiet_hours_from TIME, quiet_hours_to TIME,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  invoice_delivery_email CITEXT,
  auto_accept_orders BOOLEAN NOT NULL DEFAULT FALSE,
  auto_resource_on_qc_fail BOOLEAN NOT NULL DEFAULT TRUE,
  default_shipping_address_id UUID REFERENCES org_address(id),
  default_billing_gst_profile_id UUID REFERENCES gst_profile(id),
  po_required BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE consent_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id),
  user_id UUID REFERENCES user_account(id),
  purpose TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  notice_version TEXT NOT NULL, notice_language TEXT NOT NULL,
  channel TEXT NOT NULL,
  ip INET, user_agent TEXT,
  granted_at TIMESTAMPTZ DEFAULT now(), withdrawn_at TIMESTAMPTZ
);
CREATE INDEX idx_consent ON consent_record (org_id, purpose, granted_at DESC);

CREATE TABLE profile_change_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id),
  entity_type TEXT NOT NULL, entity_id UUID NOT NULL,
  field TEXT NOT NULL, old_value TEXT, new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  supporting_doc_id UUID REFERENCES kyc_document(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  requires_reverification BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by UUID REFERENCES user_account(id),
  reviewed_at TIMESTAMPTZ, review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tax_declaration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id),
  declaration_type TEXT NOT NULL,
  reference_number TEXT NOT NULL,
  rate_pct NUMERIC(5,2),
  valid_from DATE NOT NULL, valid_to DATE NOT NULL,
  document_id UUID REFERENCES kyc_document(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  verified_by UUID REFERENCES user_account(id), verified_at TIMESTAMPTZ,
  CHECK (valid_to > valid_from)
);
CREATE INDEX idx_taxdecl_active ON tax_declaration (org_id, declaration_type, valid_to)
  WHERE status = 'VERIFIED';

CREATE TABLE trade_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL, contact_person TEXT NOT NULL,
  mobile TEXT NOT NULL, email CITEXT,
  relationship TEXT NOT NULL, years_associated INT,
  monthly_business_value NUMERIC(14,2),
  verification_status TEXT NOT NULL DEFAULT 'PENDING',
  verification_notes TEXT,
  verified_by UUID REFERENCES user_account(id), verified_at TIMESTAMPTZ
);

-- ============ BUYER ============
CREATE TABLE buyer_approval_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_account(id),
  role_id UUID REFERENCES role(id),
  max_order_value NUMERIC(14,2),
  max_monthly_value NUMERIC(14,2),
  max_units_per_order INT,
  allowed_payment_modes payment_mode[] NOT NULL DEFAULT ARRAY['PREPAID']::payment_mode[],
  requires_approval_above NUMERIC(14,2),
  approver_user_id UUID REFERENCES user_account(id),
  cost_centres_allowed TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK ((user_id IS NULL) <> (role_id IS NULL))
);

CREATE TABLE order_approval (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES user_account(id),
  approver_user_id UUID NOT NULL REFERENCES user_account(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  order_value NUMERIC(14,2) NOT NULL,
  policy_id UUID REFERENCES buyer_approval_policy(id),
  comment TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(), decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE credit_application (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id),
  requested_limit NUMERIC(14,2) NOT NULL,
  requested_terms_days INT NOT NULL,
  annual_turnover NUMERIC(14,2), years_in_business INT,
  financials_doc_id UUID REFERENCES kyc_document(id),
  bank_statement_doc_id UUID REFERENCES kyc_document(id),
  security_deposit_amount NUMERIC(14,2),
  pdc_or_bg_details TEXT,
  credit_bureau_score INT, internal_risk_grade TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  approved_limit NUMERIC(14,2), approved_terms_days INT,
  reviewed_by UUID REFERENCES user_account(id),
  reviewed_at TIMESTAMPTZ, review_notes TEXT,
  valid_until DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE buyer_preference (
  org_id UUID PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  preferred_brands TEXT[], preferred_grades grade_type[],
  min_qc_score INT, min_battery_band battery_band,
  typical_ram_gb INT, typical_storage_gb INT,
  budget_min NUMERIC(14,2), budget_max NUMERIC(14,2),
  typical_order_qty INT, buying_frequency TEXT,
  requires_warranty_min warranty_duration,
  requires_data_wipe_cert BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE saved_search (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_account(id),
  name TEXT NOT NULL, filters_json JSONB NOT NULL,
  alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  alert_price_below NUMERIC(14,2),
  last_alerted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============ VENDOR ============
CREATE TABLE vendor_capability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES brand(id),
  category TEXT NOT NULL,
  monthly_capacity_units INT NOT NULL,
  typical_grade_mix JSONB,
  avg_price_band_min NUMERIC(14,2), avg_price_band_max NUMERIC(14,2),
  sourcing_channels TEXT[] NOT NULL,
  can_provide_serials_upfront BOOLEAN NOT NULL DEFAULT TRUE,
  has_inhouse_testing BOOLEAN NOT NULL DEFAULT FALSE,
  has_inhouse_repair BOOLEAN NOT NULL DEFAULT FALSE,
  lead_time_days INT NOT NULL DEFAULT 2,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_vcap_routing ON vendor_capability (category, brand_id, is_active);

CREATE TABLE vendor_facility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  address_id UUID UNIQUE NOT NULL REFERENCES org_address(id),
  facility_type TEXT NOT NULL,
  storage_capacity_units INT,
  has_loading_dock BOOLEAN NOT NULL DEFAULT FALSE,
  vehicle_access TEXT NOT NULL DEFAULT 'TEMPO',
  lift_available BOOLEAN NOT NULL DEFAULT TRUE,
  staff_count INT, testing_stations INT,
  is_pickup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  special_instructions TEXT
);

CREATE TABLE facility_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES vendor_facility(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time TIME, close_time TIME,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (facility_id, day_of_week)
);

CREATE TABLE facility_holiday (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES vendor_facility(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL, reason TEXT,
  UNIQUE (facility_id, holiday_date)
);

CREATE TABLE vendor_certification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  cert_type TEXT NOT NULL,
  issuing_body TEXT NOT NULL, certificate_number TEXT NOT NULL,
  valid_from DATE NOT NULL, valid_to DATE NOT NULL,
  document_id UUID REFERENCES kyc_document(id),
  verification_status TEXT NOT NULL DEFAULT 'PENDING',
  shows_badge BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE vendor_payout_preference (
  org_id UUID PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  preferred_cycle TEXT NOT NULL DEFAULT 'WEEKLY',
  preferred_day_of_week INT,
  min_payout_threshold NUMERIC(14,2) NOT NULL DEFAULT 1000,
  auto_reinvest BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_upload_required BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE vendor_sourcing_declaration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organization(id),
  listing_id UUID REFERENCES listing(id),
  source_type TEXT NOT NULL,
  source_org_name TEXT,
  acquisition_invoice_no TEXT, acquisition_date DATE,
  supporting_doc_id UUID REFERENCES kyc_document(id),
  declared_by UUID NOT NULL REFERENCES user_account(id),
  declared_at TIMESTAMPTZ DEFAULT now()
);

-- ============ ALTERATIONS ============
ALTER TABLE user_account
  ADD COLUMN job_title TEXT,
  ADD COLUMN department TEXT,
  ADD COLUMN is_org_owner BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN profile_photo_key TEXT,
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN terms_accepted_version TEXT;

ALTER TABLE organization
  ADD COLUMN website TEXT,
  ADD COLUMN year_established INT,
  ADD COLUMN annual_turnover_band TEXT,
  ADD COLUMN employee_count_band TEXT,
  ADD COLUMN logo_key TEXT,
  ADD COLUMN about TEXT,
  ADD COLUMN profile_completeness_pct INT NOT NULL DEFAULT 0,
  ADD COLUMN first_order_at TIMESTAMPTZ,
  ADD COLUMN lifetime_gmv NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE org_address
  ADD COLUMN is_pickup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN is_billing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN google_place_id TEXT,
  ADD COLUMN verified_at TIMESTAMPTZ;

ALTER TABLE bank_account
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'PAYOUT',
  ADD COLUMN is_verified_by_document BOOLEAN NOT NULL DEFAULT FALSE;
```

---

# A.7 The two registration flows, field by field

## Buyer — 5 steps, 34 fields

| Step | Fields collected | Tables written |
|---|---|---|
| **1. Account** | Full name, work email, mobile, password, email OTP, mobile OTP, how they heard about us, referral code | `registration_lead`, `user_account`, `organization` (shell), `otp_request`, `consent_record` |
| **2. Company** | Legal name, trade name, constitution, industry, year established, employee band, website, annual laptop volume | `organization`, `buyer_profile`, `onboarding_progress` |
| **3. Statutory** | GSTIN (+ verify), additional GSTINs, PAN (+ verify), primary GSTIN choice | `gst_profile`, `pan_record`, `verification_check` |
| **4. Contacts & addresses** | Procurement contact, finance contact, IT contact, billing address per GSTIN, delivery addresses with contact, mobile, landmark, gate instructions, receiving hours | `org_contact`, `org_address` |
| **5. Documents & preferences** | GST certificate, PAN card, authorised purchaser ID, optional PO template, notification channels, language, PO-required flag, preferred brands and grades | `kyc_document`, `org_preference`, `buyer_preference`, `agreement_acceptance` |
| *Optional* | Credit application: turnover, financials, bank statement, references, security deposit | `credit_application`, `trade_reference` |

## Vendor — 7 steps, 58 fields

| Step | Fields collected | Tables written |
|---|---|---|
| **1. Contact** | Company name, contact person, mobile + OTP, email + OTP, city, monthly volume, brands dealt | `registration_lead`, `user_account`, `organization` (shell) |
| **2. Business** | Legal name, trade name, constitution, incorporation date, registered address, operating address, business category, website, staff count | `organization`, `vendor_profile`, `org_address` |
| **3. Statutory** | GSTIN (+ verify), PAN (+ verify), CIN/LLPIN, Udyam number, TAN | `gst_profile`, `pan_record`, `tax_declaration`, `verification_check` |
| **4. Capability** | Categories, brands, monthly capacity, typical grade mix, price bands, sourcing channels, serials-upfront capability, in-house testing, in-house repair, lead time | `vendor_capability`, `vendor_sourcing_declaration` |
| **5. Facility & contacts** | Per warehouse: address, type, capacity, loading dock, vehicle access, lift, testing stations, operating hours per day, holidays; owner / ops / finance / warehouse contacts with WhatsApp numbers and languages | `vendor_facility`, `facility_hours`, `facility_holiday`, `org_contact` |
| **6. Documents & bank** | GST certificate, PAN, cancelled cheque, address proof, incorporation document, signatory ID, board resolution, optional CPCB and ISO certificates; bank account with penny-drop | `kyc_document`, `vendor_certification`, `bank_account`, `verification_check` |
| **7. Agreement & payout** | Vendor agreement, grading policy, data undertaking, ownership declaration (e-Sign); payout cycle, threshold, notification preferences | `agreement_acceptance`, `vendor_payout_preference`, `org_preference`, `consent_record` |
| *Optional* | Two trade references | `trade_reference` |

---

# A.8 Post-approval account management — what each side can change

| Area | Buyer | Vendor | Control |
|---|---|---|---|
| Contacts, addresses, preferences, saved searches | ✅ free | ✅ free | Audit logged only |
| Team members and roles | ✅ | ✅ | Owner or admin role required |
| Capability, facility hours, holidays | — | ✅ free | Affects RFQ routing immediately |
| Approval policies and spend limits | ✅ | — | Owner only |
| Additional GSTIN | ✅ | ✅ | Triggers `verification_check` |
| Bank account | ✅ (refund) | ✅ (payout) | Penny-drop + 24 h freeze + owner alert |
| Legal name, PAN, constitution | ⚠️ request | ⚠️ request | `profile_change_request` + supporting document + Ops approval |
| Credit limit | ⚠️ request | — | New `credit_application` |
| Certifications | — | ⚠️ request | Verified before the badge shows |
| Email or mobile | ⚠️ dual OTP | ⚠️ dual OTP | `contact_change_request` |
| Delete account | ⚠️ request | ⚠️ request | `data_subject_request`; statutory records retained for 8 years |

**Running total after this addendum: 84 core tables + 23 new = 107 tables.**
