# PHASE 1 — Identity, RBAC, and the onboarding engine

**Prerequisite:** Phase 0 exit criteria all green.
**Estimated size:** 2 engineers, 8–10 days. This is the largest schema surface in the project.
**Covers your requirements #2, #3, #5.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. Read `docs/_CONTEXT.md` and `docs/02_ARCHITECTURE.md` again if they are not in your context.

Additional reading for this phase:
- `docs/legacy/TrueTech_Schema_Addendum_Customer_Vendor.md` — the definitive field inventory for vendor (7 steps, 58 fields) and buyer (5 steps, 34 fields) onboarding
- `docs/03_UX_SPEC.md` §3A (customer registration) and §3B (vendor registration)
- `docs/04_TEST_PLAN.md` §3.1 (identity) and §3.2 (kyc)
- `docs/legacy/truetech-onboarding-journey.html` — the annotated journey with every failure branch

## Objective

A real vendor completes all 7 onboarding steps and a real business buyer completes all 5, both with save-and-resume, both with real external verification (behind mocks), and an ops reviewer approves or rejects each from the admin console within a tracked SLA.

**Build onboarding before the catalog.** Nothing else can be tested with real people until real accounts exist, and this is the module with the most schema surface — so building it first surfaces schema problems while they are still cheap to fix.

## Task 1 — Identity module

Implement against the existing `identity` schema:

- `organization` — with `org_type` ∈ `VENDOR | BUYER | PLATFORM`, `org_status` ∈ `LEAD | REGISTERED | PROFILE_SUBMITTED | KYC_SUBMITTED | UNDER_REVIEW | INFO_REQUESTED | VERIFIED | REJECTED | SUSPENDED | DEACTIVATED | BLACKLISTED`
- `user_account`, `role`, `permission`, `role_permission`, `user_role`, `session`
- `otp_request` — length 6, TTL 10 minutes, max 5 verify attempts, resend cooldown 60 s with exponential backoff on repeat, hashed at rest, single-use
- `org_address` — with `chk_pincode CHECK (pincode ~ '^[1-9][0-9]{5}$')`
- `org_contact` — types `OWNER | AUTHORISED_SIGNATORY | PROCUREMENT | FINANCE | WAREHOUSE | LOGISTICS | IT_ADMIN | ESCALATION | GRIEVANCE`. Note `user_id` is **deliberately nullable** — a warehouse supervisor is a contact who never logs in. Partial unique: `(org_id, contact_type) WHERE is_primary AND is_active`
- `user_invitation` — role fixed **at invitation time**, single-use hashed token, 7-day expiry, `CHECK (email IS NOT NULL OR mobile IS NOT NULL)`, revocable
- `contact_change_request` — email/mobile changes are an account-takeover vector, so they are **not** a plain UPDATE. Requires **dual OTP** (old address and new address), and the old address is notified **even on success**
- `audit_log` — append-only, partitioned, every privileged action
- `pincode_master`

Seed the sixteen roles from `02_ARCHITECTURE.md` §6 with their permission sets. **Enforce TOTP MFA** for `PLATFORM_SUPERADMIN`, `OPS_MANAGER`, `FINANCE`, and `VENDOR_OWNER` — the last because that login can change where money is paid.

## Task 2 — The onboarding engine

This is a generic, data-driven stepper. Do not hard-code two separate flows.

**`kyc.registration_lead`** — one row per signup attempt, created on the *first* form submit, **before `organization` exists**. It captures abandoners and gives you a funnel. Status `NEW → OTP_SENT → VERIFIED → CONVERTED` (setting `converted_org_id`), with terminal branches `ABANDONED` (recording `abandoned_at_step`) and `DISQUALIFIED`. Source ∈ `ORGANIC | GOOGLE_ADS | WHATSAPP | REFERRAL | FIELD_SALES | TRADE_FAIR`. Mobile normalised to `+91XXXXXXXXXX`. Capture UTM parameters and a device fingerprint for velocity checks.

**`kyc.onboarding_progress`** — one row per step per org. `UNIQUE (org_id, step_code)`. Status `NOT_STARTED → IN_PROGRESS → SUBMITTED → (NEEDS_FIX → IN_PROGRESS)* → COMPLETE`.
- `draft_json` (JSONB) holds partial form data and is **cleared on COMPLETE** once promoted to the real tables. This is deliberate: never write half-valid rows into `gst_profile`.
- `step_order` is stored, so steps can be reordered without a release.
- `is_required` is derived from `org_type` **and** `constitution` — a proprietorship skips the incorporation step, an LLP does not. **Write that derivation as an explicit, tested table**; the source document asserts it exists but never gives it.
- `blocking_reason` is shown to the applicant **verbatim**. "Address proof is older than three months." Not "Validation failed."

**Step codes:** `ACCOUNT | BUSINESS_PROFILE | STATUTORY | CAPABILITY | FACILITY_CONTACTS | DOCUMENTS_BANK | AGREEMENT | CONTACTS | ADDRESSES | DOCUMENTS | REVIEW`. (The source document's example references an `INCORPORATION` code that is not in its own enumerated list — resolve this by making incorporation a *field-level* requirement inside `STATUTORY`, gated by constitution, not a separate step.)

## Task 3 — Vendor onboarding, 7 steps

| Step | Collects | Writes to |
|---|---|---|
| 1 · Contact | Company name, contact person, mobile + OTP, email + OTP, city, monthly volume, brands dealt | `registration_lead`, `user_account`, `organization` (shell) |
| 2 · Business | Legal name, trade name, constitution, incorporation date, registered address, operating address, business category, website, staff count | `organization`, `vendor_profile`, `org_address` |
| 3 · Statutory | GSTIN (+ verify), PAN (+ verify), CIN/LLPIN, Udyam, TAN | `gst_profile`, `pan_record`, `tax_declaration`, `verification_check` |
| 4 · Capability | Categories, brands, monthly capacity, typical grade mix, price bands, sourcing channels, serials-upfront capability, in-house testing, in-house repair, lead time | `vendor_capability`, `vendor_sourcing_declaration` |
| 5 · Facility & contacts | Per warehouse: address, type, capacity, loading dock, vehicle access, lift, testing stations, operating hours per day, holidays. Plus owner / ops / finance / warehouse contacts with WhatsApp numbers and preferred languages | `vendor_facility`, `facility_hours`, `facility_holiday`, `org_contact` |
| 6 · Documents & bank | GST certificate, PAN, cancelled cheque, address proof, incorporation document, signatory ID, board resolution; optional CPCB e-waste and ISO certificates. Bank account with ₹1 penny-drop | `kyc_document`, `vendor_certification`, `bank_account`, `verification_check` |
| 7 · Agreement & payout | Vendor agreement, grading policy, data-wipe undertaking, ownership declaration — all e-Signed. Payout cycle, threshold, notification preferences | `agreement_acceptance`, `vendor_payout_preference`, `org_preference`, `consent_record` |

Optional: two `trade_reference` rows.

**Step 4 is more important than it looks** — it is your RFQ and sourcing routing data. Index `vendor_capability` on `(category, brand_id, is_active)`.

**On step 5:** default `preferred_language` to `hi` for warehouse contacts and `en` for everyone else.

**⚠ Merchant-of-record addition, not in the source document:** step 4 must also capture **`can_dropship`** — whether the vendor can dispatch directly to a buyer's address rather than to a hub. In this model that is the default flow, so a vendor who cannot do it is a materially different vendor. And step 6 must capture **the exact dispatch address per facility**, because it becomes `Dispatch From` on every e-way bill.

## Task 4 — Buyer onboarding, 5 steps

| Step | Collects | Writes to |
|---|---|---|
| 1 · Account | Full name, work email, mobile, password, email OTP, mobile OTP, how they heard about us, referral code | `registration_lead`, `user_account`, `organization` (shell), `otp_request`, `consent_record` |
| 2 · Company | Legal name, trade name, constitution, industry, year established, employee band, website, annual laptop volume | `organization`, `buyer_profile`, `onboarding_progress` |
| 3 · Statutory | GSTIN (+ verify), additional GSTINs, PAN (+ verify), primary GSTIN choice | `gst_profile`, `pan_record`, `verification_check` |
| 4 · Contacts & addresses | Procurement, finance and IT contacts; billing address per GSTIN; delivery addresses with contact, mobile, landmark, gate instructions, receiving hours | `org_contact`, `org_address` |
| 5 · Documents & preferences | GST certificate, PAN card, authorised-purchaser ID, optional PO template. Notification channels, language, PO-required flag, preferred brands and grades | `kyc_document`, `org_preference`, `buyer_preference`, `agreement_acceptance` |

Optional: `credit_application` — turnover, financials, bank statement, references, security deposit.

**Step 3 is the single field that decides how they are invoiced.** `uq_primary_gst ON kyc.gst_profile (org_id) WHERE is_primary`. Gate the whole checkout on it in Phase 6.

**Note the UX correction:** the existing `customer-register.html` prototype shows a **4**-step flow. The confirmed flow is **5 steps / 34 fields**. Build 5.

## Task 5 — Verification

Every external check writes exactly one `kyc.verification_check` row per attempt.

| `check_type` | Checks | Where used |
|---|---|---|
| `GSTIN` | Validity; captures returned legal name, status, state; fuzzy name match scored into `match_score` | Vendor 3, Buyer 3 |
| `PAN` | Validity | Vendor 3, Buyer 3 |
| `PAN_GSTIN_LINK` | Same entity behind both | Vendor 3 |
| `BANK_PENNY_DROP` | Account ownership, ₹1 credit | Vendor 6 |
| `IFSC` | Branch validity, `^[A-Z]{4}0[A-Z0-9]{6}$` | Vendor 6 |
| `UDYAM` | MSME registration | Vendor 3 → also a `tax_declaration` |
| `CIN` | CIN/LLPIN, required by constitution | Vendor 3 |
| `AADHAAR_ESIGN` | E-signature of the four agreements | Vendor 7 |

**Design rules that matter:**

- **`outcome` ∈ `PASS | FAIL | MISMATCH | PROVIDER_ERROR | TIMEOUT`.** `PROVIDER_ERROR` is deliberately separate from `FAIL` — **the first is our problem, the second is the applicant's.** Conflating them makes people re-upload documents pointlessly, and it is the most common onboarding-UX failure in Indian KYC flows. Show the applicant something different in each case: on `PROVIDER_ERROR`, "We couldn't reach the GST portal. We'll retry automatically — nothing for you to do."
- `input_value_masked` (`06AAEC****1ZP`) plus `input_hash`, so support staff never see full values and you can still rate-limit on the hash.
- `attempt_no` increments per attempt. **Define the retry policy the source document leaves open:** max 5 attempts per `input_hash` per 24 hours, 15-minute cooldown after 3, and a fraud flag at attempt 3 with three *different* input values — "a third attempt on the same GSTIN with different values is a signal, not a coincidence."
- `PROVIDER_ERROR` retries automatically with exponential backoff (30 s, 2 m, 10 m, 1 h) and does **not** consume an attempt.
- Record `provider`, `cost_paise`, `latency_ms` per call. You will switch providers and the history must say which one answered.
- `triggered_by` is null for automated re-verification jobs.

**Fix the schema bug:** `verification_check.org_id` is `NOT NULL` FK to `organization`, but the org is only created after step 2 — so pre-org checks have nowhere to attach. Make it nullable and add `lead_id` FK to `registration_lead`, with a `CHECK (org_id IS NOT NULL OR lead_id IS NOT NULL)`.

## Task 6 — Documents

- Signed S3 upload URLs, 5 MB cap enforced at the DB (`CHECK size_bytes <= 5242880`) **and** at the edge
- MIME allow-list, **magic-byte validation** (never trust the extension), EXIF strip, AV scan
- Document types per the addendum, with `doc_status ∈ UPLOADED | UNDER_REVIEW | VERIFIED | REJECTED | EXPIRED`
- **Document age rules** — the source document mentions "older than three months" only as an example error string, never as a specification. Define them explicitly in `platform_config` (address proof ≤ 90 days, bank statement ≤ 90 days, GST certificate no limit, incorporation document no limit) and enforce them
- `kyc.v_expiring_documents` already unions `kyc_document`, `vendor_certification` and `tax_declaration` at 30 days — wire a notification job to it

## Task 7 — Consent (DPDP Act 2023)

`kyc.consent_record`, itemised and purpose-specific. Purposes: `KYC_VERIFICATION | TRANSACTIONAL_COMMS | MARKETING | WHATSAPP_BUSINESS | CREDIT_CHECK | DATA_SHARING_LOGISTICS`. **Blanket consent is not valid consent.**

- Capture `notice_version` and `notice_language` — consent given against a Hindi notice must be provable as such
- Capture channel, IP, user agent, `granted_at`
- **Rows are never deleted.** `withdrawn_at` non-null stops processing and is itself the compliance artifact
- **Transactional messages ignore the `notify_*` preference flags.** Only marketing and digests respect them
- **No pre-ticked boxes anywhere** — Consumer Protection (E-Commerce) Rules r.4(9) requires explicit affirmative action

## Task 8 — Ops review console

Admin screens for the review queue:
- Queue filtered by org type, status, age against SLA — **48 working hours for vendors, 24 for buyers**
- Side-by-side document viewer with the extracted field values and the verification-check history
- Actions: **Approve · Reject · Request information**. "Request information" sets the relevant step to `NEEDS_FIX` with a **verbatim, applicant-facing** `blocking_reason`
- A **named person** decides. Record who, when, and why. `kyc.kyc_review`
- `kyc.blacklist_entry` checked on GSTIN, PAN, mobile, email and bank account at step 1 and again at approval, matched on `(entity_type, value_hash)`
- On approval: `organization.status = VERIFIED`, emit `vendor.verified` or `buyer.verified`

## Task 9 — Post-approval change control

Not everything stays editable. Implement the matrix:

| Area | Buyer | Vendor | Control |
|---|---|---|---|
| Contacts, addresses, preferences, saved searches | free | free | audit-logged only |
| Team members and roles | ✓ | ✓ | owner or admin role |
| Capability, facility hours, holidays | — | free | affects routing immediately |
| Additional GSTIN | ✓ | ✓ | triggers a `verification_check` |
| **Bank account** | ✓ (refund) | ✓ (payout) | **penny-drop + 24-hour freeze + alert to the owner** |
| Legal name, PAN, constitution | request | request | `profile_change_request` + supporting doc + ops approval |
| Credit limit | request | — | a new `credit_application` |
| Certifications | — | request | verified before the badge shows |
| Email / mobile | dual OTP | dual OTP | `contact_change_request` |
| Delete account | request | request | `data_subject_request`; statutory records kept 8 years |

**Locked fields** requiring `profile_change_request`: `legal_name`, `gstin`, `pan`, `constitution`, `bank_account`. A GSTIN change **always** sets `requires_reverification`.

**`vendor_certification.shows_badge` may only be true when the certificate is `VERIFIED` and unexpired.** An expired badge on a live listing is a false claim *we* made. Add a scheduled job to expire `tax_declaration` and `vendor_certification` rows on `valid_to` — the source schema implies this job exists but never describes it.

## Task 10 — Frontend

In `apps/storefront`: buyer registration (5 steps), login (OTP-first, password secondary), pending-approval and rejected states, password recovery.
In `apps/console`: vendor registration (7 steps), login (**password-first** — vendors log in daily), the mandatory second factor for owner accounts, application status, and the admin review queue.

Both stepper flows must support **save and finish later** from `draft_json`, resume at the right step, and show a right-rail explaining *why* each piece of information is being asked for and what happens after submission. That rail is in the prototypes and it is doing real work — keep it.

## Exit criteria

- [ ] A vendor completes all 7 steps, abandons at step 4, returns 2 days later and resumes at step 4 with the form repopulated
- [ ] A buyer completes all 5 steps
- [ ] Ops approves both from the admin console; both reach `VERIFIED`; the SLA clock is tracked and breaches are visible
- [ ] Every verification attempt appears in `verification_check` with masked input, hash, provider, cost and latency
- [ ] `PROVIDER_ERROR` is displayed differently from `FAIL`, retries automatically, and does not consume an attempt (`KYC-041`…`KYC-048`)
- [ ] Attempt 3 with three different GSTIN values raises a fraud flag
- [ ] A `NEEDS_FIX` step shows the reviewer's `blocking_reason` verbatim to the applicant
- [ ] **RBAC test matrix passes: vendor A cannot read any of vendor B's data through any endpoint** — tested, not assumed (`IDN-050`…`IDN-079`)
- [ ] A bank-account change triggers penny-drop, a 24-hour freeze, and an owner alert
- [ ] Email/mobile change requires both OTPs and notifies the old address
- [ ] A proprietorship's stepper omits the incorporation fields; an LLP's does not
- [ ] MFA is enforced for all four required roles
- [ ] Migrations still run clean on an empty database

═══════════════════════════════════════════════════════════════════
