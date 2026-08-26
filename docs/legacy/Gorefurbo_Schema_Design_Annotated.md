# TrueTech B2B Marketplace — Complete Database Schema
## Annotated design document for the engineering team

**Version:** 1.0 · **Database:** PostgreSQL 15+ · **Scope:** All-India launch
**Purpose of this document:** every table, every column, and the reason it exists. If a column is here, it is because some screen, some legal requirement, or some dispute needs it. If you cannot find the reason, the column should not exist.

---

# PART 0 — How to read this document

Each table is documented in this format:

| Column | Type | Key | Null | Why this column exists |
|---|---|---|---|---|

- **Key** column uses: `PK` primary key · `FK` foreign key · `UQ` unique · `IX` indexed · `ENC` encrypted at rest
- **Null** column: `N` = NOT NULL (required), `Y` = nullable (optional, and the meaning of "empty" is explained)

Each table also carries three notes:
- **Why this table exists** — the business question it answers
- **Grain** — what exactly one row represents (this is the single most important line; most schema bugs are grain bugs)
- **Lifecycle** — when rows are created, updated, and deleted

---

# PART 1 — Design principles

These eleven decisions shape everything below. Read them before reading the tables, because they explain why the schema looks the way it does.

### 1.1 UUID primary keys everywhere
Every table uses `UUID` (via `gen_random_uuid()`) rather than a serial integer.

**Why:** we will run multiple hubs, an offline QC agent, and an offline rider app. All three need to create records without asking the server for the next number. Sequential integers also leak business volume — a competitor reading `order_id=4471` learns exactly how many orders we have taken. UUIDs cost 16 bytes instead of 8, which at our design scale (a few million rows in the biggest table) is a price worth paying.

**Exception:** high-volume append-only log tables (`audit_log`, `order_event`, `stock_movement`, `shipment_tracking`, `ledger_entry`) use `BIGSERIAL`. They are never referenced by other tables and never created offline, so the ordering guarantee and smaller index are worth more than distributed generation.

### 1.2 Human-readable numbers are separate from primary keys
`order.id` is a UUID. `order.order_number` is `TT-26-08841`. Both exist.

**Why:** a buyer will read the order number over the phone, print it on a purchase order, and email it. A UUID is unusable for that. But the human number must never be a primary key, because human numbers get reformatted, get prefixes added, and get regenerated when finance changes the numbering series. Same pattern for `invoice_number`, `batch_number`, `sku_code`, `awb_number`.

### 1.3 Money is `NUMERIC(14,2)`, never `FLOAT`
**Why:** floating point cannot represent ₹0.10 exactly. Sum ten thousand line items in float and the total will not match the invoice. `NUMERIC(14,2)` holds up to ₹999,999,999,999.99 — far beyond a single transaction, and enough for lifetime aggregates.

**Precision rule:** GST amounts are computed and stored, never recomputed for display. If the invoice says ₹4,572.00, that number lives in a column. Recomputing at render time will eventually round differently and produce an invoice that disagrees with itself.

### 1.4 Enum types, not free-text status strings
Every status field is a Postgres `ENUM` type.

**Why:** the whole business promise is that a listing cannot say "good condition" in free text. That promise must be enforced by the database, not by a validation function someone can forget to call. A typo of `'ACTIVE '` with a trailing space silently breaks a `WHERE status = 'ACTIVE'` filter; an enum makes that typo impossible at insert time.

**Trade-off:** adding a value to an enum requires a migration (`ALTER TYPE ... ADD VALUE`). This is intentional friction. Status values are business decisions and should require a deliberate change.

### 1.5 State is a column; history is a table
`order.status` holds the current state. `order_event` holds every transition.

**Why:** "why is this order stuck?" is the single most common support question. Answering it from a status column alone is impossible. Every entity with a lifecycle gets a paired event table: `order`/`order_event`, `unit`/`stock_movement`, `listing`/`price_history`, `shipment`/`shipment_tracking`.

### 1.6 Money truth lives in a double-entry ledger, not in a balance column
There is no `vendor.wallet_balance` column anywhere in this schema.

**Why:** a mutable balance column is a lie waiting to happen. Two concurrent updates, one failed rollback, and the number is wrong with no way to prove what it should have been. `ledger_entry` is append-only with debit and credit columns; every balance is a `SUM()`. When a vendor disputes a payout, we replay the ledger. This is slower to read and non-negotiable.

### 1.7 Soft delete only where history matters
`organization`, `sku`, `listing` carry `deleted_at`. `cart_item` does not — it is hard-deleted.

**Why:** you cannot delete a vendor who has invoices; the GST records must survive for eight years. But nobody needs the history of a cart. Applying soft delete everywhere doubles the `WHERE` clauses and eventually someone forgets one and leaks deleted data.

### 1.8 PII is encrypted at the column, not just the disk
`bank_account.account_number_enc`, `pan_record.pan_enc`, `user_account.mfa_secret_enc` are `BYTEA`, encrypted through envelope encryption with a KMS-held key.

**Why:** disk encryption protects against a stolen server. It does nothing against a leaked database dump, a compromised read replica, or a developer running `SELECT *` in production. Each encrypted column is paired with a `_last4` plaintext column so the interface can display `••••4471` without decrypting anything.

### 1.9 Every foreign key names its ON DELETE behaviour deliberately
Three patterns are used:
- `ON DELETE CASCADE` — child has no meaning without the parent (`invoice_line` → `invoice`, `cart_item` → `cart`)
- `ON DELETE RESTRICT` (default) — deleting the parent must fail (`order_line` → `sku`; you cannot delete a SKU that has been sold)
- `ON DELETE SET NULL` — the link is informational (`unit.listing_id` when a listing is delisted but the unit still exists)

Getting this wrong is how a marketplace loses invoice lines.

### 1.10 Timestamps are `TIMESTAMPTZ`, stored in UTC
**Why:** India has one timezone today, so this looks unnecessary. It is not. Carriers report in UTC, our GSP returns UTC acknowledgements, and any future hub or client outside IST breaks a naive `TIMESTAMP`. Store UTC, render IST. Business dates that must not shift — `invoice_date`, `entry_date`, `period_start` — are `DATE`, because an invoice dated 31 March must stay in that financial year regardless of any timezone conversion.

### 1.11 The India-scale decisions baked into the schema

| Decision | Where it appears | Why |
|---|---|---|
| Multiple GSTINs per organization | `gst_profile` is a separate table, not columns on `organization` | A buyer operating in 12 states has 12 GSTINs. Place of supply is chosen per order. |
| State code stored explicitly, not derived | `org_address.state_code`, `gst_profile.state_code` | IGST vs CGST+SGST is decided by state code comparison. Deriving it from a city name at query time will eventually be wrong. |
| PIN code as `TEXT`, not integer | `org_address.pincode` | Leading zeros exist (e.g. Kerala 6xxxxx is fine, but never store PIN as a number — arithmetic on it is meaningless and formatting breaks). |
| Serial uniqueness is global and partial | `unit` unique index | One physical laptop can be in exactly one live listing across all vendors nationwide. This blocks the same machine being sold twice by two dealers. |
| Hub as a first-class entity | `hub` table with FKs from `qc_batch`, `shipment` | Launch is Gurugram-only, but the second hub is a data change, not a code change. |
| Serviceability by PIN, not by city | `pincode_serviceability` | "Do we deliver to Ranchi?" is answered per PIN code by carrier, because Blue Dart, Porter and our own riders each cover different sets. |
| MSME flag drives payment deadline | `vendor_profile.msme_udyam_no` | Section 43B(h) / MSMED Act: registered micro and small suppliers must be paid within 45 days. This is a legal deadline, not a preference. |
| Language preference stored per user | `user_account.locale` | Hindi and English at launch. Vendors in tier-2 and tier-3 cities will not use an English-only portal. |

---

# PART 2 — Domain map

Sixty-one tables across eleven domains. The arrow direction is "references".

```
                            ┌──────────────────┐
                            │  organization    │  ← the spine of identity
                            └────────┬─────────┘
        ┌────────────┬───────────────┼───────────────┬──────────────┐
        │            │               │               │              │
  user_account  gst_profile    org_address     bank_account    kyc_document
        │                                                            │
    user_role ── role ── role_permission ── permission          kyc_review

                            ┌──────────────────┐
                            │  MASTER CATALOG  │
                            └──────────────────┘
        brand → series → model → sku → sku_image
                                  ↑
                            sku_request

                            ┌──────────────────┐
                            │ SUPPLY           │
                            └──────────────────┘
        sku + organization(vendor) → listing → unit (one serial = one row)
                                        │         │
                        listing_tier_price   stock_movement
                        listing_image

                            ┌──────────────────┐
                            │ DEMAND           │
                            └──────────────────┘
        cart → cart_item
        order → sub_order → order_line → order_line_unit → unit
          │        │
        order_event  invoice
        rfq → rfq_quote

                            ┌──────────────────┐
                            │ INSPECTION       │
                            └──────────────────┘
        qc_batch → qc_report → qc_area_result
                        ├──── qc_hardware_detected
                        ├──── qc_photo
                        └──── qc_mismatch
        qc_tolerance_rule (config)   wipe_certificate   qc_audit_recheck

                            ┌──────────────────┐
                            │ MOVEMENT         │
                            └──────────────────┘
        hub · carrier · pincode_serviceability
        shipment → shipment_unit → unit
        shipment_tracking · pickup_task · delivery_task · rider · custody_event

                            ┌──────────────────┐
                            │ MONEY            │
                            └──────────────────┘
        invoice → invoice_line · eway_bill
        payment → refund
        ledger_entry (append-only, the source of truth)
        settlement_run → payout · commission_rule · penalty

                            ┌──────────────────┐
                            │ AFTER-SALE       │
                            └──────────────────┘
        return_request → return_qc · warranty → warranty_claim
        ticket → ticket_message · dispute

                            ┌──────────────────┐
                            │ PLATFORM         │
                            └──────────────────┘
        vendor_scorecard · buyer_review · platform_config · feature_flag
        notification_template · notification_log · integration_log
        audit_log · data_subject_request · blacklist_entry
```

---

# PART 3 — Identity and access (8 tables)

## 3.1 `organization`

**Why this table exists:** every party on the platform — a vendor firm, a buyer company, TrueTech itself — is an organization. Users belong to organizations, and almost every other table is scoped by `org_id`. Making this one table rather than separate `vendor` and `buyer` tables is deliberate: a refurbisher who also buys stock from another refurbisher is a real case, and duplicating them into two tables would give them two identities, two KYC files and two blacklist positions.

**Grain:** one row = one legal business entity.
**Lifecycle:** created at first registration, never hard-deleted (invoices reference it for 8 years).

| Column | Type | Key | Null | Why this column exists |
|---|---|---|---|---|
| `id` | UUID | PK | N | Stable internal identity. Referenced by ~30 other tables. |
| `org_type` | `org_type` enum | IX | N | `VENDOR` / `BUYER` / `INTERNAL`. Drives which portal the user sees and which KYC rules apply. An org can hold only one type; a firm that both buys and sells gets two orgs linked by `related_org_id`. |
| `legal_name` | TEXT | N | The name on the GST certificate. **This goes on the invoice.** Not editable freely — it is overwritten by the GST API response. |
| `trade_name` | TEXT | Y | The name people actually use ("Nexus IT"). Shown in the interface; never on a tax document. Null when the firm has no separate trade name. |
| `constitution` | `constitution_type` enum | Y | Proprietorship / Partnership / LLP / Pvt Ltd / Ltd / Trust. Decides which documents are mandatory — a Pvt Ltd needs a board resolution, a proprietorship does not. Null until step 3 of onboarding. |
| `status` | `org_status` enum | IX | N | The onboarding and lifecycle state machine. Every gate in the product checks this one column. |
| `tier` | `vendor_tier` enum | Y | Bronze → Platinum. Drives commission rate, search ranking and settlement speed. Null for buyers. Denormalised from `vendor_scorecard` because it is read on every listing query and recomputed only nightly. |
| `risk_score` | INT | Y | 0–100, produced by the onboarding risk engine. Reviewers sort their queue by it; high scores force four-eyes approval. |
| `transaction_model` | `txn_model` enum | N | `AGENCY` or `BUY_SELL`. **Per-vendor, not global.** TrueTech's own stock is buy-sell; a large verified vendor may prefer agency. This one column decides who is the supplier of record on the invoice and whether TCS applies. |
| `related_org_id` | UUID | FK→self | Y | Links a firm's vendor org to its buyer org. Null in the normal case. |
| `preferred_locale` | TEXT | N | `en` or `hi`. Default `en`. Drives notification templates and portal language. |
| `created_at` / `updated_at` | TIMESTAMPTZ | N | Audit basics. `created_at` also answers "member since" on the vendor card. |
| `created_by` / `updated_by` | UUID | Y | Who made the change. Null when the row was created by self-registration rather than by an internal user. |
| `deleted_at` | TIMESTAMPTZ | Y | Soft delete. Non-null means the org is hidden from all queries but its invoices survive. |

**Indexes:** `(org_type, status)` — every admin queue filters on this pair. `(legal_name gin_trgm_ops)` — fuzzy duplicate detection at onboarding.

---

## 3.2 `user_account`

**Why this table exists:** an organization is not a login. A vendor firm has an owner, an operations person and an accounts person, each needing a different view and each leaving a different audit trail. Sharing one login across a firm destroys accountability, which matters when someone changes the bank account.

**Grain:** one row = one human who can sign in.
**Lifecycle:** created at registration or by an org admin inviting a colleague; deactivated (status change), never deleted.

| Column | Type | Key | Null | Why this column exists |
|---|---|---|---|---|
| `id` | UUID | PK | N | Referenced by `audit_log`, `session`, every `*_by` column. |
| `org_id` | UUID | FK→`organization` | N | Every user belongs to exactly one org. This is the row-level security boundary — every query is filtered by it at the repository layer. |
| `full_name` | TEXT | N | Shown on tickets, POD signatures, QC reports. |
| `email` | CITEXT | UQ, IX | Y | Login identifier and transactional email target. `CITEXT` so `Ritika@x.com` and `ritika@x.com` are the same account. Nullable because a rider may be mobile-only. |
| `mobile` | TEXT | UQ, IX | Y | OTP target and the primary identifier for Indian users. Stored as `+91XXXXXXXXXX` normalised, so the same number cannot register twice in two formats. |
| `email_verified_at` / `mobile_verified_at` | TIMESTAMPTZ | Y | Null means unverified. Onboarding will not advance past step 1 while either is null. |
| `password_hash` | TEXT | N | Argon2id. Nullable only for accounts that use magic-link login exclusively. |
| `mfa_enabled` | BOOLEAN | N | Default false. Forced true for `VENDOR_OWNER`, buyer finance roles and all internal roles by a check at login, not by a DB constraint (the constraint would block the moment between account creation and enrolment). |
| `mfa_secret_enc` | BYTEA | ENC | Y | TOTP seed. Encrypted because a leaked seed defeats the second factor entirely. |
| `status` | TEXT | IX | N | `ACTIVE` / `INVITED` / `SUSPENDED` / `DEACTIVATED`. |
| `locale` | TEXT | N | Per-user language, overriding the org default. The owner may read English while the warehouse operator reads Hindi. |
| `last_login_at` | TIMESTAMPTZ | Y | Used for dormant-account cleanup and for "was this really them?" during a fraud review. |
| `failed_login_count` | INT | N | Default 0. Drives progressive lockout. Reset on success. |
| `locked_until` | TIMESTAMPTZ | Y | Non-null blocks login. Set by the lockout policy after repeated failures. |
| `created_at` | TIMESTAMPTZ | N | — |

**Why no `role` column here:** roles live in `user_role` because one person can hold two roles (owner and finance in a small firm), and roles can expire.

---

## 3.3 `role`, `permission`, `role_permission`, `user_role`

**Why these four tables exist:** a single `user.role = 'admin'` column cannot express "this person can approve KYC but not release payouts." Marketplaces get breached through over-broad internal access far more often than through the login page. Splitting roles from permissions lets us add a permission without touching any user row.

### `role`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `code` | TEXT | UQ | N | `VENDOR_OWNER`, `OPS_QC`, `FINANCE_PAYOUT`. Used in code; never renamed. |
| `scope` | TEXT | N | `ORG` or `PLATFORM`. An `ORG` role means something only inside one organization; a `PLATFORM` role is internal TrueTech. Keeping this explicit prevents a vendor role from being granted platform-wide by mistake. |
| `description` | TEXT | Y | Shown in the admin role editor so the person granting access knows what they are granting. |

### `permission`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `code` | TEXT | UQ | N | `listing.create`, `kyc.approve`, `payout.release`. Checked declaratively at every endpoint. |
| `module` | TEXT | N | Groups permissions in the admin interface (`catalog`, `finance`, `qc`). |
| `is_sensitive` | BOOLEAN | N | True forces step-up re-authentication and dual logging. Set on `payout.release`, `bank.update`, `kyc.approve`, `order.override`. |

### `role_permission`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `role_id` + `permission_id` | UUID | PK (composite), FK | N | Pure join table. Composite PK prevents granting the same permission twice. |

### `user_role`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `user_id` + `role_id` + `org_id` | UUID | PK (composite), FK | N | `org_id` is in the key because an internal auditor could hold a read role scoped to one vendor. |
| `granted_by` | UUID | FK→`user_account` | Y | Accountability. Quarterly access review asks "who granted this?" |
| `granted_at` | TIMESTAMPTZ | N | — |
| `expires_at` | TIMESTAMPTZ | Y | Non-null gives temporary access — a contractor, or emergency break-glass access that self-revokes. Null means permanent. |

---

## 3.4 `session`

**Why this table exists:** JWTs cannot be revoked once issued. When a laptop is stolen or an employee leaves, we need to end their access immediately. Storing refresh tokens server-side makes that possible.

**Grain:** one row = one active login on one device.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `user_id` | UUID | FK, IX | N | "Sign out everywhere" = update all rows for this user. |
| `refresh_token_hash` | TEXT | UQ | N | The token itself is never stored. Hash comparison only. |
| `token_family_id` | UUID | IX | N | All rotations of one login share a family. If an old token is reused (a sign of theft) the entire family is revoked at once. |
| `ip` | INET | Y | Shown in "recent activity" and used in fraud review. |
| `user_agent` | TEXT | Y | Same. |
| `device_id` | TEXT | Y | Set by mobile apps. Enables device binding for the rider and QC apps. |
| `expires_at` | TIMESTAMPTZ | IX | N | Cleanup job deletes expired rows nightly. |
| `revoked_at` | TIMESTAMPTZ | Y | Non-null = dead session. Kept rather than deleted so the audit trail shows the revocation. |

---

## 3.5 `otp_request`

**Why this table exists:** OTP is the primary identity proof in India — for login, for pickup handover, for delivery confirmation, for ticket closure. All four flows share this table.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `target` | TEXT | IX | N | Mobile number or email. Indexed for rate limiting per target. |
| `purpose` | TEXT | N | `LOGIN` / `REGISTER` / `PICKUP` / `DELIVERY` / `TICKET_CLOSE` / `BANK_CHANGE`. An OTP issued for delivery must not work for login — the purpose is checked on verification. |
| `code_hash` | TEXT | N | Hashed, never plaintext. An OTP table dump should not let anyone complete a delivery. |
| `attempts` | INT | N | Default 0. Three wrong tries burn the OTP. |
| `expires_at` | TIMESTAMPTZ | N | Five minutes. |
| `consumed_at` | TIMESTAMPTZ | Y | Non-null = already used. Prevents replay. |
| `ref_type` / `ref_id` | TEXT / UUID | Y | Links the OTP to what it authorises (`pickup_task`, `delivery_task`, `ticket`). Null for login OTPs. |
| `created_at` | TIMESTAMPTZ | IX | N | Rate limiting window and the 90-day purge. |

**Retention:** rows are deleted after 90 days. An OTP log is pure liability once it is no longer needed.

---

## 3.6 `audit_log`

**Why this table exists:** the answer to "who changed this, when, and what did it look like before?" Required for DPDP accountability, for fraud investigation, and for every dispute where two parties remember different things.

**Grain:** one row = one state-changing action.
**Special property:** append-only. No `UPDATE` or `DELETE` grant exists on this table for the application role.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | BIGSERIAL | PK | N | Ordering matters here; a BIGSERIAL gives it for free and keeps the index small at high volume. |
| `actor_user_id` | UUID | IX | Y | Who did it. Null for system-initiated actions (a settlement run, a nightly scorecard recompute). |
| `actor_org_id` | UUID | IX | Y | Which organization they acted for. |
| `action` | TEXT | IX | N | `listing.publish`, `kyc.approve`, `payout.release`. Same vocabulary as `permission.code` so the two can be cross-checked. |
| `entity_type` / `entity_id` | TEXT / TEXT | IX | Y | What was touched. `entity_id` is TEXT not UUID because some entities key on BIGSERIAL. |
| `before_json` / `after_json` | JSONB | Y | The actual change. `before_json` is null on create; `after_json` is null on delete. **PII is redacted before writing** — bank numbers and PANs are logged as `"****4471"`. |
| `ip` / `user_agent` | INET / TEXT | Y | — |
| `request_id` | TEXT | IX | Y | Correlation ID from the gateway. Ties this row to application logs and to `integration_log`. |
| `created_at` | TIMESTAMPTZ | IX | N | Partition key. |

**Partitioning:** monthly range partitions on `created_at`. At an all-India scale this table grows fastest of anything in the schema; monthly partitions let us detach and archive old months without a delete storm.

**Tamper evidence:** a nightly job hashes each partition and stores the hash chain separately. If someone edits history at the database level, the chain breaks.
---

# PART 4 — KYC and statutory identity (9 tables)

This domain exists because of one commercial fact: a buyer will prepay ₹26 lakh to a seller they have never met, and the only reason they will is that we verified that seller. Every table here is a piece of that verification.

## 4.1 `gst_profile`

**Why this table exists — and why it is not columns on `organization`:** a company operating in Maharashtra, Karnataka and Haryana holds three separate GSTINs. Each has its own legal name on record, its own state code, and its own registration status. Putting `gstin` on `organization` would force such a buyer to create three accounts and fragment their order history.

**Grain:** one row = one GSTIN held by one organization.
**Lifecycle:** created during onboarding, re-verified periodically, marked inactive rather than deleted when a registration is cancelled.

| Column | Type | Key | Null | Why this column exists |
|---|---|---|---|---|
| `id` | UUID | PK | N | Referenced by `order.billing_gst_profile_id` — the order records *which* GSTIN it was billed to, not just the org. |
| `org_id` | UUID | FK→`organization`, IX | N | Owner. |
| `gstin` | TEXT | UQ(org_id, gstin) | N | The 15-character number. Format enforced by `CHECK` regex. Unique per org, not globally — the same GSTIN cannot appear twice under one org, but a shared premises edge case makes a global unique too aggressive. |
| `legal_name_as_per_gst` | TEXT | N | **Pulled from the GST API, not typed by the user.** This is the name that appears on the tax invoice. If we let the user type it, a mismatch with the GST portal invalidates the buyer's input tax credit. |
| `trade_name` | TEXT | Y | Also from the API. Display only. |
| `state_code` | CHAR(2) | IX | N | The first two characters of the GSTIN (`06` = Haryana, `27` = Maharashtra). **Stored separately even though it is derivable**, because IGST-vs-CGST determination compares this against the shipping state on every checkout and every invoice; parsing a substring at query time is both slower and easier to get wrong. |
| `registration_type` | TEXT | N | `REGULAR` / `COMPOSITION` / `SEZ` / `CASUAL`. A composition dealer cannot pass input credit; an SEZ buyer gets zero-rated supply. The invoice logic branches on this. |
| `status` | TEXT | IX | N | `ACTIVE` / `CANCELLED` / `SUSPENDED`, from the API. Checkout blocks on anything but `ACTIVE`. |
| `api_verified_at` | TIMESTAMPTZ | N | When we last checked. A re-verification job runs quarterly, and daily for orgs with open credit. |
| `api_response_json` | JSONB | Y | The full API payload. Kept because when a buyer disputes the legal name on their invoice, this is the evidence of what the government portal returned on that date. |
| `is_primary` | BOOLEAN | N | Default for checkout when the buyer has several. Exactly one true per org, enforced by a partial unique index. |

**Constraint:** `CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$')`
**Partial unique index:** `UNIQUE (org_id) WHERE is_primary` — makes "exactly one primary" a database guarantee.

---

## 4.2 `pan_record`

**Why this table exists:** PAN is the tax identity that TDS is deducted against and the key we blacklist on. It is separate from `gst_profile` because a proprietorship has one PAN and possibly several GSTINs, and because PAN needs encryption while GSTIN does not (GSTIN is public information; PAN is not).

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, UQ | N | One PAN per organization. |
| `pan_enc` | BYTEA | ENC | N | Encrypted. PAN is personal financial data under DPDP and is a direct identity-theft vector. |
| `pan_last4` | CHAR(4) | N | For display (`••••521M`) and for matching without decryption. |
| `pan_hash` | TEXT | IX | N | SHA-256 with a platform pepper. **This is how blacklist matching works** — we compare hashes, never decrypt. Also detects the same PAN registering under two org names. |
| `name_as_per_pan` | TEXT | Y | From the verification API. Compared to `legal_name` and to the penny-drop name. |
| `verified` | BOOLEAN | N | Default false. Onboarding cannot complete while false. |
| `api_verified_at` | TIMESTAMPTZ | Y | — |

**Cross-check rule enforced in application, documented here:** characters 3–12 of `gst_profile.gstin` must equal the PAN. A mismatch is a hard onboarding failure, not a warning — it almost always means a copied certificate.

---

## 4.3 `bank_account`

**Why this table exists:** this is where money leaves the platform. It carries the heaviest controls in the schema.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | Referenced by `payout.bank_account_id` so every payout records exactly which account it went to, even if the vendor later changes it. |
| `org_id` | UUID | FK, IX | N | — |
| `account_holder_name` | TEXT | N | As typed by the vendor. Compared against what the bank returns. |
| `account_number_enc` | BYTEA | ENC | N | Encrypted. |
| `account_number_last4` | CHAR(4) | N | Display only. |
| `ifsc` | CHAR(11) | N | Validated against an IFSC master list. Determines bank and branch. |
| `bank_name` / `branch` | TEXT | Y | Auto-filled from IFSC. Stored rather than looked up each time because branches merge and rename, and the payout advice must show what was true on the day. |
| `account_type` | TEXT | N | `CURRENT` / `SAVINGS` / `CC`. A firm paying into a savings account is a mild fraud signal. |
| `penny_drop_status` | TEXT | IX | N | `PENDING` / `SUCCESS` / `NAME_MISMATCH` / `FAILED`. Payouts are blocked unless `SUCCESS`. |
| `penny_drop_name` | TEXT | Y | The name the bank returned for the account. |
| `name_match_score` | NUMERIC(5,2) | Y | 0–100 fuzzy match between `penny_drop_name` and `legal_name`. ≥85 auto-passes, 60–85 goes to a human, <60 fails. Stored so a reviewer can see why it was flagged. |
| `verified_at` | TIMESTAMPTZ | Y | — |
| `is_default` | BOOLEAN | N | Which account receives payouts. |
| `frozen_until` | TIMESTAMPTZ | Y | **Set to now + 24 hours whenever bank details change.** Account takeover almost always ends with a changed payout account; this window plus an alert to the owner is the countermeasure. |
| `created_at` / `updated_at` | TIMESTAMPTZ | N | — |

---

## 4.4 `kyc_document`

**Why this table exists:** documents are files, and files need their own lifecycle — uploaded, reviewed, rejected, re-uploaded, expired. Storing a file key on `organization` would allow only one document and no review history.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `doc_type` | TEXT | IX | N | `GST_CERT` / `PAN_CARD` / `CANCELLED_CHEQUE` / `ADDRESS_PROOF` / `INCORPORATION` / `SIGNATORY_ID` / `BOARD_RESOLUTION` / `CPCB_AUTH` / `ISO_CERT`. Which types are mandatory is derived from `organization.constitution`. |
| `file_key` | TEXT | N | Object-store key. **Never a public URL.** Access is only through a 5-minute signed URL, and every issuance writes an `audit_log` row. |
| `file_hash_sha256` | TEXT | IX | N | Detects the same document uploaded by two different applicants — a strong signal of a document mill. |
| `mime` / `size_bytes` | TEXT / BIGINT | N | Validated against magic bytes, not just the extension. |
| `status` | `doc_status` enum | IX | N | `UPLOADED` / `VERIFIED` / `REJECTED` / `EXPIRED`. |
| `rejection_reason` | TEXT | Y | Shown verbatim to the vendor. Vague rejections generate support tickets; specific ones get a correct re-upload. |
| `uploaded_by` / `reviewed_by` | UUID | FK | Y | — |
| `expires_on` | DATE | IX | Y | Address proofs go stale, CPCB authorisations expire. A daily job flags rows past this date and re-requests them. Null for documents that do not expire (PAN card). |
| `created_at` | TIMESTAMPTZ | N | — |

---

## 4.5 `kyc_review`

**Why this table exists:** the decision is separate from the documents because a single application can be reviewed several times, and because we need four-eyes approval on high-value vendors.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` | UUID | FK, IX | N | — |
| `reviewer_id` | UUID | FK | N | Accountability for the decision. |
| `decision` | TEXT | N | `APPROVE` / `REQUEST_INFO` / `REJECT`. |
| `reason_codes` | TEXT[] | Y | Structured, not free text — `['ADDRESS_PROOF_STALE','NAME_MISMATCH']`. Arrays let us report on why applications fail and fix the top cause. |
| `notes` | TEXT | Y | Free text for the internal file only. Never shown to the applicant. |
| `second_approver_id` | UUID | FK | Y | Non-null required when expected monthly GMV exceeds ₹25 lakh. Null on normal approvals. |
| `decided_at` | TIMESTAMPTZ | N | Feeds the 48-hour SLA report. |

---

## 4.6 `blacklist_entry`

**Why this table exists:** a rejected fraudster re-applies with a new company name. The only stable identifiers across attempts are PAN, GSTIN, mobile, bank account and device. This table is checked at every registration and at every serial upload.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `entity_type` | TEXT | UQ(type,hash) | N | `PAN` / `GSTIN` / `MOBILE` / `EMAIL` / `SERIAL` / `BANK_ACCOUNT` / `DEVICE`. |
| `value_hash` | TEXT | UQ, IX | N | **Hashed, not plaintext.** A blacklist in plaintext is a curated list of people's PANs and phone numbers — a data breach waiting to happen. Matching is hash-to-hash. |
| `reason` | TEXT | N | Why they are listed. Needed if they contest it, which DPDP gives them the right to do. |
| `source` | TEXT | N | `INTERNAL_FRAUD` / `LAW_ENFORCEMENT` / `PARTNER_REGISTRY` / `STOLEN_DEVICE_DB`. Different sources justify different levels of certainty. |
| `added_by` | UUID | FK | Y | — |
| `active` | BOOLEAN | N | Soft removal. A wrongly-listed party is deactivated, not deleted, so the correction itself is auditable. |
| `expires_at` | TIMESTAMPTZ | Y | Some listings are time-bound (a 12-month ban). Null = permanent. |

---

## 4.7 `agreement_acceptance`

**Why this table exists:** when a vendor disputes a penalty, the question is "which version of the grading policy did they agree to, and when?" A boolean `terms_accepted` column cannot answer that.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `org_id` / `user_id` | UUID | FK, IX | N | Which firm, and which human clicked. |
| `agreement_code` | TEXT | N | `VENDOR_AGREEMENT` / `GRADING_POLICY` / `DATA_UNDERTAKING` / `OWNERSHIP_DECLARATION`. |
| `version` | TEXT | N | `v1.2`. When we change the grading policy, existing vendors must re-accept; this column is how we know who is on which version. |
| `doc_hash` | TEXT | N | SHA-256 of the exact PDF served. Proves the document has not been altered since acceptance. |
| `ip` / `user_agent` | INET / TEXT | Y | Evidence of a click-wrap acceptance. |
| `esign_ref` | TEXT | Y | Aadhaar e-Sign transaction reference when e-Sign was used. Null for click-wrap. |
| `accepted_at` | TIMESTAMPTZ | N | — |

---

## 4.8 `vendor_profile` / 4.9 `buyer_profile`

**Why these exist as separate tables from `organization`:** roughly fifteen attributes apply only to vendors and twelve only to buyers. Putting all of them on `organization` gives every row a majority of nulls and makes the table's meaning ambiguous. These are one-to-one extension tables keyed on `org_id`.

### `vendor_profile`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `org_id` | UUID | PK, FK | N | PK and FK are the same column — this enforces one-to-one. |
| `business_category` | TEXT | N | `REFURBISHER` / `DEALER` / `ITAD` / `CORPORATE_LIQUIDATOR` / `OEM_PARTNER`. Sets expectations on volume and on stock provenance. |
| `incorporation_date` | DATE | Y | A firm registered three weeks ago selling 500 laptops is a risk signal. |
| `monthly_volume_estimate` | INT | Y | Self-declared at onboarding. Drives the four-eyes threshold and initial exposure limit. |
| `pickup_default_location_id` | UUID | FK→`org_address` | Y | Pre-fills the listing form. |
| `commission_rate_override` | NUMERIC(5,2) | Y | Null means "use `commission_rule` for the tier". Non-null is a negotiated rate for a strategic vendor. Storing the override separately keeps the rule table clean. |
| `exposure_limit` | NUMERIC(14,2) | Y | Maximum value of live listings plus open orders. Caps our loss if a vendor fails to deliver at scale. |
| `settlement_cycle` | TEXT | N | `WEEKLY` / `T_PLUS_2`. Faster cycles are a Platinum tier benefit. |
| `msme_udyam_no` | TEXT | IX | Y | **Non-null triggers the 45-day statutory payment deadline.** A settlement job checks this before scheduling. |
| `onboarding_status` | `org_status` enum | N | Mirrors `organization.status`; kept here for the vendor-specific sub-flow. |
| `verified_at` / `verified_by` | TIMESTAMPTZ / UUID | Y | — |

### `buyer_profile`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `org_id` | UUID | PK, FK | N | — |
| `industry` | TEXT | Y | Segmentation for the sales team. |
| `employee_count` | INT | Y | Sanity check against claimed volume. |
| `annual_volume_estimate` | INT | Y | Sets the default price tier. |
| `credit_limit` | NUMERIC(14,2) | N | Default 0 = prepaid only. Raised only through underwriting. |
| `credit_terms_days` | INT | N | Default 0. 15 or 30 after approval. |
| `credit_used` | NUMERIC(14,2) | N | Denormalised running exposure, recomputed from the ledger nightly and checked at checkout. Denormalised deliberately because summing the ledger on every checkout would be too slow, but reconciled nightly so drift is caught. |
| `payment_mode_allowed` | `payment_mode[]` | N | Which options appear at checkout. |
| `onboarding_status` | `org_status` enum | N | — |

---

# PART 5 — Geography and serviceability (3 tables)

## 5.1 `org_address`

**Why this table exists:** an organization has a registered address, a billing address per GSTIN, several delivery sites and several pickup warehouses. One address column would be useless.

**Grain:** one row = one physical location belonging to one organization.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | Referenced by `order.shipping_address_id`, `shipment.from/to_address_id`, `pickup_task.address_id`. |
| `org_id` | UUID | FK, IX | N | — |
| `type` | `address_type` enum | IX | N | `REGISTERED` / `BILLING` / `SHIPPING` / `PICKUP` / `HUB`. |
| `label` | TEXT | Y | "Head office", "Sector 63 warehouse". What the user recognises in a dropdown. |
| `line1` / `line2` | TEXT | N / Y | — |
| `city` | TEXT | N | — |
| `state` | TEXT | N | Full name for printing on invoices. |
| `state_code` | CHAR(2) | IX | N | **The functional field.** Compared against `gst_profile.state_code` to decide IGST vs CGST+SGST. Never derived from `state` at query time, because state names have spelling variants and the tax outcome must be deterministic. |
| `pincode` | CHAR(6) | IX | N | Drives freight, ETA, serviceability and hub assignment. `CHAR(6)` and TEXT, never integer. |
| `contact_name` / `contact_mobile` | TEXT | N | The rider calls this person. A delivery address without a live contact fails. |
| `landmark` | TEXT | Y | In much of India this is more useful than the formal address. |
| `delivery_instructions` | TEXT | Y | "Gate pass needed 24 h ahead", "accepts 10:00–17:00 only". Printed on the rider's task, which is the difference between a first-attempt delivery and a return. |
| `latitude` / `longitude` | NUMERIC(9,6) | Y | Populated when available. Used for route optimisation. Null is normal and must not break anything. |
| `is_default` | BOOLEAN | N | Per type. |
| `is_active` | BOOLEAN | N | Addresses are deactivated, not deleted, because old shipments reference them. |

---

## 5.2 `pincode_master`

**Why this table exists:** validating and auto-filling addresses, and mapping a PIN to a state code without trusting user input. India has roughly 19,000 PIN codes; this is a small, mostly static reference table.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `pincode` | CHAR(6) | PK | N | — |
| `district` / `state` / `state_code` | TEXT | N | Auto-fill and the authoritative state mapping. |
| `zone` | TEXT | N | `NORTH` / `SOUTH` / `EAST` / `WEST` / `NE`. Freight slabs are priced by zone. |
| `is_metro` | BOOLEAN | N | Metro deliveries have different SLAs and rates. |
| `is_ncr` | BOOLEAN | IX | N | **Directly drives the in-house rider routing rule.** Both ends in NCR means our own team handles the whole job. |

---

## 5.3 `pincode_serviceability`

**Why this table exists:** "do we deliver to Ranchi?" has three different answers depending on the carrier. Blue Dart, Porter and the in-house team each cover different sets, with different transit times and different costs.

**Grain:** one row = one carrier's capability for one PIN code.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `pincode` | CHAR(6) | FK→`pincode_master`, UQ(pincode,carrier_id,service_type) | N | — |
| `carrier_id` | UUID | FK→`carrier` | N | — |
| `service_type` | TEXT | N | `PICKUP` / `DELIVERY` / `BOTH`. Some PINs we can deliver to but not collect from. |
| `transit_days_min` / `transit_days_max` | INT | N | Powers the ETA shown at checkout. A range, not a single number, because promising a precise date we cannot hit is worse than a range. |
| `cod_available` | BOOLEAN | N | False everywhere at launch, but the column exists because the question will be asked. |
| `is_oda` | BOOLEAN | N | Out of delivery area — carriers surcharge these PINs. Must be visible at checkout, not discovered at invoicing. |
| `last_synced_at` | TIMESTAMPTZ | N | Carrier serviceability files change monthly. Stale data means promising delivery we cannot make. |

---

# PART 6 — Master catalog (7 tables)

## 6.1 Why the catalog is four levels deep

This is the most-questioned design decision, so it is documented explicitly.

```
brand → series → model → sku → (listing) → (unit)
Dell    Latitude  5420    i5/16GB/512GB/14"FHD
```

Each level exists because a different user action happens at that level:

| Level | The user action it serves | If we merged it away |
|---|---|---|
| `brand` | Filter "Dell only" | Free-text brand gives us "Dell", "DELL", "dell inc" |
| `series` | Browse "business laptops from Dell" | Buyers who think in product families cannot navigate |
| `model` | Search "Latitude 5420" | The landing page and SEO target disappear |
| `sku` | **Compare prices** | This is the whole product. Two sellers can only be compared if they are selling the identical configuration. |
| `listing` | Buy from a specific seller | — |
| `unit` | Receive a specific machine | — |

The `sku` level is where the business lives. Everything above it is navigation; everything below it is commerce.

---

## 6.2 `brand`, `series`, `model`

| Table | Column | Type | Key | Why |
|---|---|---|---|---|
| `brand` | `id` | UUID | PK | — |
| | `name` | TEXT | UQ | "Dell". Controlled by Catalog Ops only. |
| | `slug` | TEXT | UQ | URL segment for SEO — `/laptops/dell`. |
| | `logo_key` | TEXT | | Object-store key for the brand mark. |
| | `is_active` | BOOLEAN | | Retire a brand without deleting sold history. |
| `series` | `id` | UUID | PK | — |
| | `brand_id` | UUID | FK, UQ(brand_id,name) | A series belongs to exactly one brand. |
| | `name` | TEXT | | "Latitude". |
| `model` | `id` | UUID | PK | — |
| | `series_id` | UUID | FK, UQ(series_id,name) | — |
| | `name` | TEXT | | "Latitude 5420". |
| | `model_year` | INT | | 2021. Buyers filter on age; it also drives depreciation-based warranty refunds. |
| | `form_factor` | TEXT | | `BUSINESS_ULTRABOOK` / `WORKSTATION` / `2_IN_1` / `CHROMEBOOK` / `CONSUMER`. |
| | `msrp_new_inr` | NUMERIC(14,2) | | Reference price when new. Powers "62% off new" and the price guard rails. |
| | `is_active` | BOOLEAN | | — |

---

## 6.3 `sku` — the most important table in the catalog

**Why this table exists:** two vendors can only be compared if they are provably selling the same thing. A SKU is the definition of "the same thing".

**Grain:** one row = one exact configuration of one model.
**Who writes it:** Catalog Ops only. Vendors never insert here.

| Column | Type | Key | Null | Why this column exists |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `model_id` | UUID | FK, IX | N | — |
| `sku_code` | TEXT | UQ | N | `SKU-DL-5420-I5-16-512`. Human-readable, used on vendor CSV uploads and in warehouse conversation. |
| `normalized_key` | TEXT | UQ | N | **The deduplication guarantee.** Lowercased, punctuation-stripped concatenation of `brand|model|cpu_model|ram_gb|storage_type|storage_gb|screen_size|is_touch`. The unique constraint on this column makes a duplicate SKU physically impossible, no matter how the insert arrives. |
| `cpu_brand` / `cpu_family` / `cpu_model` | TEXT | N | Intel / Core i5 / i5-1145G7. Three levels because buyers filter at all three: "Intel only", "i5 or better", "exactly this chip". |
| `cpu_generation` | TEXT | IX | N | "11th Gen". The single most-used filter in refurbished laptop buying, because it is the shorthand for "how old is this really". |
| `cores` | INT | Y | Shown on the spec sheet; also compared against what QC detects. |
| `ram_gb` | INT | IX | N | Filter and QC comparison field. **Integer, not text** — "16 GB" as text cannot answer "16 or more". |
| `ram_type` | TEXT | Y | DDR4 / DDR5 / LPDDR5. Matters for upgradability. |
| `ram_upgradable_to` | INT | Y | Buyers planning a 3-year life care about this. Null when soldered. |
| `storage_type` | TEXT | IX | N | `NVME_SSD` / `SATA_SSD` / `HDD` / `EMMC`. An HDD in 2026 is a different product from an NVMe drive. |
| `storage_gb` | INT | IX | N | — |
| `gpu_type` / `gpu_model` | TEXT | N / Y | `INTEGRATED` / `DISCRETE`, and the chip. Design and engineering buyers filter on discrete. |
| `screen_size_inch` | NUMERIC(4,1) | IX | N | 13.3, 14.0, 15.6. Decimal because 13.3 is real. |
| `resolution` | TEXT | N | `HD` / `FHD` / `QHD` / `4K`. HD panels on a business laptop materially reduce value. |
| `panel_type` | TEXT | Y | IPS / TN / OLED. |
| `is_touch` | BOOLEAN | N | Part of the normalized key — a touch variant is a different SKU, not a note. |
| `os_supported` | TEXT | N | Windows 11 Pro. Affects licence transfer and price. |
| `ports_json` | JSONB | Y | `{"usb_a":2,"usb_c":2,"hdmi":1,"rj45":1}`. JSONB because the shape varies by machine and we do not want twelve nullable integer columns. Queried with a GIN index for "must have RJ45" filters. |
| `weight_kg` | NUMERIC(5,2) | Y | Also feeds the freight calculation. |
| `battery_wh` | INT | Y | The denominator for battery-health percentage. |
| `charger_watt` | INT | Y | Buyers need to know whether chargers are included and interchangeable. |
| `hsn_code` | TEXT | N | Default `8471`. **On the invoice line, legally required.** Stored per SKU because accessories and different device classes carry different HSN codes. |
| `gst_rate` | NUMERIC(5,2) | N | Default 18.00. Per-SKU because rates change by notification and a stored rate keeps historical invoices correct. |
| `version` | INT | N | Incremented on every spec edit. Listings record the version they were created against, so a spec correction does not silently change what a buyer already purchased. |
| `is_active` | BOOLEAN | IX | N | — |
| `created_at` / `created_by` | | | Catalog governance. |

**Indexes:**
- `UNIQUE (normalized_key)` — the dedupe guarantee
- `(model_id, is_active)` — the configuration list on a model page
- `GIN (ports_json)` — port-based filters
- `(cpu_generation, ram_gb, storage_gb)` — the common filter combination

---

## 6.4 `sku_image`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `sku_id` | UUID | FK, IX | N | — |
| `file_key` | TEXT | N | — |
| `image_type` | TEXT | N | `FRONT` / `OPEN` / `LEFT` / `RIGHT` / `KEYBOARD` / `PORTS`. Fixed set so every product page has the same six views and the grid looks uniform. |
| `sort_order` | INT | N | — |

**Why catalog images belong to the SKU and not the listing:** vendors uploading their own product photos is how marketplaces get image fraud — a stock photo of an A+ machine attached to a battered one. Vendors upload *actual unit* photos to `listing_image` instead, clearly separated in the interface.

---

## 6.5 `sku_request`

**Why this table exists:** a vendor with a model we have not catalogued is blocked from selling. Without a request queue, they email support and the model never gets added. With it, Catalog Ops has a worklist and an SLA.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `vendor_org_id` | UUID | FK, IX | N | Who is waiting. Also lets us notify them the moment it resolves. |
| `raw_brand` / `raw_model` / `raw_config` | TEXT | N | What the vendor typed, unmodified. Kept raw because the mapping to a real SKU is Ops' judgement, and we want to see the original phrasing when the same request comes in ten times. |
| `spec_url` / `photo_key` | TEXT | Y | Evidence supplied by the vendor. |
| `status` | TEXT | IX | N | `PENDING` / `RESOLVED_NEW` / `RESOLVED_MAPPED` / `REJECTED`. The distinction between "we created a SKU" and "this already existed and you missed it" tells us whether search needs improving. |
| `resolved_sku_id` | UUID | FK→`sku` | Y | — |
| `resolved_by` / `resolved_at` | UUID / TIMESTAMPTZ | Y | 24-hour SLA reporting. |

---

## 6.6 `catalog_change_log`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | BIGSERIAL | PK | N | — |
| `sku_id` | UUID | FK, IX | N | — |
| `field` / `old_value` / `new_value` | TEXT | N | A spec correction on a SKU affects every live listing and every past order. When a buyer says "you told me 16 GB", this is the record of what the catalog said on that date. |
| `changed_by` / `changed_at` | UUID / TIMESTAMPTZ | N | — |
---

# PART 7 — Listings and inventory (5 tables)

## 7.1 `listing`

**Why this table exists:** a listing is the join between "what" (a SKU), "who" (a vendor), "in what condition" (a grade), and "at what price". It is the row a buyer actually shops.

**Grain:** one row = one vendor's offer of one SKU at one grade.

**Critical grain rule:** a vendor selling the same SKU at A+ and at A has **two listings**, not one listing with two grades. Merging them would make the price-comparison grid impossible, because grade and price are inseparable.

| Column | Type | Key | Null | Why this column exists |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `vendor_org_id` | UUID | FK, IX | N | The seller. Also the row-security boundary in the vendor portal. |
| `sku_id` | UUID | FK, IX | N | What is being sold. This FK is what makes comparison possible. |
| `grade` | `grade_type` enum | IX | N | `A_PLUS` / `A` / `B`. **The enum contains only three values.** C and D are absent from the type, so a C-grade listing cannot be inserted even by a bug or a direct SQL statement. This is the three-grade promise enforced in the database. |
| `condition_type` | `condition_type` enum | N | `LIKE_NEW` / `UNBOXED` / `REFURBISHED` / `USED_TESTED`. Separate from grade because a refurbished unit can be grade B and an unboxed unit can be grade A. Conflating them is exactly what the framework forbids. |
| `functional_status` | `functional_status` enum | N | `FULLY_FUNCTIONAL` / `MINOR_ISSUE` / `LIMITED`. `NON_FUNCTIONAL` exists in the enum for QC results but is rejected at listing time by a CHECK. |
| `battery_health_band` | `battery_band` enum | IX | N | Band, not a percentage, because the vendor is declaring before inspection and a band is honest about that imprecision. The exact percentage comes later from `qc_hardware_detected`. |
| `parts_status` | `parts_status_type` enum | N | `ALL_ORIGINAL` / `OEM_REPLACED` / `COMPATIBLE_REPLACED` / `MIXED`. Compatible parts materially change value and must be disclosed. |
| `parts_replaced` | TEXT[] | Y | `{BATTERY,KEYBOARD}`. Array rather than a child table because it is a short controlled list read together with the parent, never queried independently. |
| `repair_history` | `repair_history_type` enum | N | `NONE` / `MINOR` / `MAJOR`. |
| `data_wipe_status` | `wipe_status_type` enum | N | What the vendor claims. Verified independently at QC. |
| `seller_warranty` | `warranty_duration` enum | N | What the vendor offers. |
| `oem_warranty_remaining` | `oem_warranty_band` enum | N | Band, because it is declared per listing while the exact date is per unit (`unit.oem_warranty_end`). |
| `truetech_warranty` | `warranty_duration` enum | N | Set by the platform from `platform_config` by grade, not by the vendor. Stored on the listing so a later policy change does not alter existing offers. |
| `unit_price` | NUMERIC(14,2) | IX | N | Excluding GST. The base for everything. Indexed because the comparison grid sorts on it. |
| `gst_rate` | NUMERIC(5,2) | N | Copied from `sku` at creation. Copied, not joined, so a rate change does not retroactively alter a live offer. |
| `moq` | INT | N | Minimum order quantity. Default 1. |
| `dispatch_sla_hours` | INT | N | 24 / 48 / 72. Feeds the ETA and the on-time-handover metric. |
| `pickup_location_id` | UUID | FK→`org_address` | N | Where the rider goes. Also determines whether this offer qualifies for in-house NCR routing. |
| `qty_total` | INT | N | Ever loaded into this listing. |
| `qty_available` | INT | IX | N | Sellable right now. |
| `qty_reserved` | INT | N | Held by unpaid or in-flight orders. |
| `status` | `listing_status` enum | IX | N | The lifecycle. |
| `sku_version_at_creation` | INT | N | Which spec version the vendor agreed to sell. |
| `approved_by` / `approved_at` | UUID / TIMESTAMPTZ | Y | Null for auto-approved listings from established vendors. |
| `expires_at` | TIMESTAMPTZ | IX | Y | Listings untouched for 60 days expire, forcing a stock-accuracy refresh. Stale stock is the fastest way to lose buyer trust. |
| `created_at` / `updated_at` | TIMESTAMPTZ | N | — |

**Constraints — these are the ones that matter:**
```sql
CHECK (qty_available >= 0 AND qty_reserved >= 0)
CHECK (qty_available + qty_reserved <= qty_total)   -- oversell is impossible
CHECK (unit_price > 0)
CHECK (grade IN ('A_PLUS','A','B'))                 -- redundant with the enum, kept as documentation
CHECK (functional_status <> 'NON_FUNCTIONAL')
```
The second constraint is the important one. Application logic reserves stock inside a transaction with a Redis lock, but if that logic ever has a race condition, this constraint turns a silent oversell into a failed transaction. **Prefer a visible failure over invisible corruption.**

**Indexes:** `(sku_id, grade, status, unit_price)` is the covering index for the offers grid — the single hottest query on the platform.

---

## 7.2 `unit` — one physical laptop

**Why this table exists:** everything else in this schema is abstract. This table is the actual machine sitting on a shelf. Warranty claims, QC results, disputes, and the invoice line all eventually resolve to a serial number.

**Grain:** one row = one physical laptop, for its entire life on the platform.

| Column | Type | Key | Null | Why this column exists |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `serial_number` | TEXT | UQ (partial), IX | N | The manufacturer's serial or service tag. **The identity that matters.** |
| `listing_id` | UUID | FK, IX | Y | Which offer it currently sits in. Nullable because a unit that failed QC and was returned to the vendor belongs to no listing. `ON DELETE SET NULL`. |
| `vendor_org_id` | UUID | FK, IX | N | Denormalised from the listing. Kept because the unit outlives the listing and we must always know whose machine it was. |
| `sku_id` | UUID | FK | N | Also denormalised. Answers "which model was this?" after the listing is gone. |
| `grade_declared` | `grade_type` | N | What the vendor said. |
| `grade_actual` | `grade_type` | Y | What the bench found. Null until inspected. **These are two columns, not one**, because the difference between them is the entire grade-accuracy metric and the basis of every mismatch penalty. |
| `status` | `unit_status` enum | IX | N | The 17-state lifecycle from `CREATED` to `DELIVERED` or `RETURNED_TO_VENDOR`. |
| `order_line_id` | UUID | FK, IX | Y | Which order line consumed it. Null while unsold. |
| `qc_report_id` | UUID | FK | Y | Latest inspection. Null before intake. |
| `hw_fingerprint_hash` | TEXT | IX | Y | A hash of motherboard serial + CPU ID + storage serial, produced by the QC agent. **This is the anti-swap control:** when a unit is returned, we re-fingerprint and compare. A mismatch means the buyer sent back a different machine. |
| `oem_warranty_end` | DATE | Y | Exact date from the manufacturer's warranty API. Null when the lookup failed or the brand has no API. |
| `blacklist_checked_at` | TIMESTAMPTZ | Y | When we last checked this serial against the stolen register. Re-checked before dispatch. |
| `location` | TEXT | IX | N | `VENDOR` / `TRANSIT` / `HUB` / `BUYER`. Coarse physical position, for the ops board. Precise history is in `stock_movement`. |
| `hub_id` | UUID | FK→`hub` | Y | Which hub holds it. Non-null only when `location = 'HUB'`. |
| `created_at` | TIMESTAMPTZ | N | — |

**The most important index in the schema:**
```sql
CREATE UNIQUE INDEX uq_unit_active_serial ON unit (serial_number)
  WHERE status NOT IN ('RETURNED_TO_VENDOR','SCRAPPED');
```
**Why partial rather than a plain unique:** a serial must be unique among *live* units — the same laptop cannot be listed by two vendors at once, which is both a fraud vector and an oversell vector. But a machine legitimately returned to a vendor and later re-listed after repair must be insertable again. A plain unique constraint would block that legitimate case forever.

---

## 7.3 `listing_tier_price`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `listing_id` | UUID | FK CASCADE, IX | N | Deleted with the listing; volume pricing has no meaning alone. |
| `min_qty` / `max_qty` | INT | N / Y | The band. `max_qty` null means "and above". |
| `unit_price` | NUMERIC(14,2) | N | — |

**Constraint:** an exclusion constraint prevents overlapping bands on one listing. Overlapping tiers mean two valid prices for the same quantity, and whichever one the code picks will eventually be the wrong one.

---

## 7.4 `listing_image`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `listing_id` | UUID | FK CASCADE, IX | N | — |
| `file_key` | TEXT | N | — |
| `image_type` | TEXT | N | `ACTUAL_UNIT` / `DEFECT`. Grade B listings require at least four rows, one of them `DEFECT` — enforced at publish time. |
| `hash` | TEXT | IX | N | Detects the same photograph reused across listings, which is how a seller fakes condition evidence. |
| `uploaded_at` | TIMESTAMPTZ | N | — |

**Note on EXIF:** geolocation and camera metadata are stripped on upload before storage. The hash is computed after stripping, so the same photo re-uploaded still matches.

---

## 7.5 `stock_movement` and `price_history`

### `stock_movement`
**Why:** the chain of custody for one machine. When a unit goes missing, this table is the investigation.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | BIGSERIAL | PK | N | — |
| `unit_id` | UUID | FK, IX | N | — |
| `from_status` / `to_status` | `unit_status` | Y / N | `from_status` null on the first row. |
| `from_location` / `to_location` | TEXT | Y | — |
| `reason` | TEXT | Y | Free text for exceptions ("carton damaged at intake"). |
| `actor_id` | UUID | Y | Who or what moved it. Null for system transitions. |
| `ref_type` / `ref_id` | TEXT / UUID | Y | Links to the order, shipment or QC report that caused the move. |
| `occurred_at` | TIMESTAMPTZ | IX | N | Partition key. |

### `price_history`
**Why:** price anomaly detection needs a baseline, and a vendor claiming "I never set that price" needs an answer.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | BIGSERIAL | PK | N | — |
| `listing_id` | UUID | FK, IX | N | — |
| `old_price` / `new_price` | NUMERIC(14,2) | Y / N | — |
| `changed_by` | UUID | Y | Null when changed by an automated repricing rule. |
| `changed_at` | TIMESTAMPTZ | IX | N | The 30-day median used by the price guard rails is computed from this table. |

---

# PART 8 — Orders (7 tables)

## 8.1 Why an order splits into sub-orders

A buyer adds 40 units from Vendor A and 50 from Vendor B into one cart and pays once. But:

- each vendor issues their own tax invoice
- each vendor has a different dispatch SLA
- each vendor has a different pickup location and therefore a different freight cost
- each vendor is paid separately, on their own settlement cycle
- one vendor can fail QC while the other passes

So the schema is three levels:

```
order        — one buyer, one payment, one delivery address
 └ sub_order — one vendor, one invoice, one pickup, one payout
    └ order_line — one listing, one price, a quantity
       └ order_line_unit — one serial number
```

**Why four levels and not three:** without `order_line_unit`, we could not say which physical machine a buyer received. Warranty claims, returns and disputes all resolve at the serial level. A quantity alone is not enough.

---

## 8.2 `order`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `order_number` | TEXT | UQ, IX | N | `TT-26-08841`. What the buyer quotes on the phone. Format: prefix, financial year, sequence. |
| `buyer_org_id` | UUID | FK, IX | N | — |
| `buyer_user_id` | UUID | FK | N | Which person placed it. Buyer orgs have several purchasers and approvals route to the right one. |
| `billing_gst_profile_id` | UUID | FK→`gst_profile` | N | **Which GSTIN this is billed to.** Not derived from the org, because a multi-state buyer chooses at checkout, and this single choice decides the entire tax treatment. |
| `billing_address_id` | UUID | FK→`org_address` | N | — |
| `shipping_address_id` | UUID | FK→`org_address`, IX | N | Its `state_code` compared against the GSTIN's decides IGST vs CGST+SGST. |
| `buyer_po_number` | TEXT | Y | The buyer's own purchase order reference, printed on the invoice. Without it, large buyers cannot match our invoice to their approval. |
| `cost_centre` | TEXT | Y | Internal accounting tag for the buyer. |
| `subtotal` | NUMERIC(14,2) | N | Sum of line totals excluding tax and freight. |
| `gst_total` | NUMERIC(14,2) | N | Stored, not computed at render. |
| `freight_total` | NUMERIC(14,2) | N | Quoted at checkout and honoured even if actual carrier cost differs. The variance is our P&L, not a buyer surprise. |
| `tcs_amount` | NUMERIC(14,2) | N | Default 0. Non-zero under the agency model, Section 52. |
| `grand_total` | NUMERIC(14,2) | N | What was charged. |
| `payment_mode` | `payment_mode` enum | N | — |
| `payment_status` | `payment_status` enum | IX | N | — |
| `status` | `order_status` enum | IX | N | Roll-up of the sub-orders. Denormalised for the buyer's order list; the truth is in the sub-orders. |
| `placed_at` | TIMESTAMPTZ | IX | N | — |
| `stock_hold_expires_at` | TIMESTAMPTZ | Y | Reserved stock is released if payment does not arrive. Prevents a phantom cart from locking a vendor's inventory. |

**Index:** `(buyer_org_id, status, placed_at DESC)` — the buyer's order list, sorted newest first.

---

## 8.3 `sub_order`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `order_id` | UUID | FK CASCADE, IX | N | — |
| `vendor_org_id` | UUID | FK, IX | N | The vendor portal filters on this. |
| `sub_order_number` | TEXT | UQ | N | `TT-26-08841-A`. The vendor references this, not the parent order. |
| `subtotal` / `gst_total` / `freight` | NUMERIC(14,2) | N | Per-vendor money, because the invoice is per vendor. |
| `commission_amount` | NUMERIC(14,2) | N | Computed at confirmation and frozen. **Frozen deliberately** — if the vendor's tier changes next week, the commission on an order already placed must not change. |
| `status` | `order_status` enum | IX | N | The real state. |
| `dispatch_sla_due_at` | TIMESTAMPTZ | IX | N | Computed from `listing.dispatch_sla_hours` at confirmation. Drives the late-handover penalty and the on-time metric. |
| `accepted_at` / `rejected_at` | TIMESTAMPTZ | Y | Vendors can decline. Declining hurts the acceptance metric. |
| `invoice_id` | UUID | FK→`invoice` | Y | Null until dispatch, because the tax invoice is raised only after QC confirms which serials are in the box. |

---

## 8.4 `order_line` and `order_line_unit`

### `order_line`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `sub_order_id` | UUID | FK CASCADE, IX | N | — |
| `listing_id` | UUID | FK | N | Which offer was bought. |
| `sku_id` | UUID | FK | N | Denormalised so the line survives a delisted listing. |
| `grade` | `grade_type` | N | Snapshot. |
| `qty` | INT | N | — |
| `unit_price` | NUMERIC(14,2) | N | **A price snapshot.** If the vendor changes the listing price tomorrow, this order is unaffected. Never join to `listing.unit_price` for an order total. |
| `gst_rate` / `gst_amount` / `line_total` | NUMERIC | N | All stored. All three appear on the invoice and must match it exactly, forever. |
| `status` | `order_status` enum | N | Lines move independently — one can be on QC hold while others dispatch. |
| `fulfilled_qty` / `cancelled_qty` | INT | N | Partial fulfilment is normal, not exceptional. If 8 of 10 pass QC, `fulfilled_qty = 8`, `cancelled_qty = 2`, and the buyer is refunded for two without the other eight waiting. |

### `order_line_unit`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `order_line_id` | UUID | FK CASCADE, IX | N | — |
| `unit_id` | UUID | FK, UQ | N | A unit can be on exactly one order line. Unique constraint prevents double allocation. |
| `serial_number` | TEXT | IX | N | Denormalised for the invoice and for fast lookup during a warranty claim, where the buyer has the serial and nothing else. |
| `qc_report_id` | UUID | FK | Y | The inspection that cleared this exact machine for this exact order. |
| `status` | `unit_status` | IX | N | — |

---

## 8.5 `order_event`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | BIGSERIAL | PK | N | — |
| `order_id` / `sub_order_id` | UUID | IX | Y | One or the other is set. |
| `event_type` | TEXT | IX | N | `PAYMENT_CAPTURED`, `VENDOR_ACCEPTED`, `QC_MISMATCH_RAISED`, `BUYER_ACCEPTED_DISCOUNT`. |
| `from_status` / `to_status` | TEXT | Y | — |
| `actor_id` | UUID | Y | Null for system events. |
| `note` | TEXT | Y | Shown on the buyer's timeline where appropriate. |
| `payload_json` | JSONB | Y | Event-specific detail — the discount offered, the carrier chosen, the reason for a hold. |
| `occurred_at` | TIMESTAMPTZ | IX | N | Partition key. |

---

## 8.6 `cart` and `cart_item`

| Table | Column | Type | Key | Why |
|---|---|---|---|---|
| `cart` | `id` | UUID | PK | — |
| | `buyer_org_id` | UUID | FK, IX | Carts are org-level, not user-level: a procurement assistant builds it, a manager approves it. |
| | `user_id` | UUID | FK | Who is building it. |
| | `status` | TEXT | | `OPEN` / `CONVERTED` / `ABANDONED`. |
| | `updated_at` | TIMESTAMPTZ | IX | Abandoned-cart cleanup and recovery messaging. |
| `cart_item` | `id` | UUID | PK | — |
| | `cart_id` | UUID | FK CASCADE | Hard delete with the cart. |
| | `listing_id` | UUID | FK | — |
| | `qty` | INT | | `CHECK (qty > 0)`. |
| | `unit_price_snapshot` | NUMERIC(14,2) | | The price when it was added. If the vendor repriced since, the interface shows "price changed" rather than silently charging more — the single most common trust failure in B2B carts. |

---

## 8.7 `rfq` and `rfq_quote`

**Why these exist:** above a certain quantity, list price is not how B2B works. The buyer wants sealed competitive quotes.

### `rfq`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `rfq_number` | TEXT | UQ | N | Human reference. |
| `buyer_org_id` | UUID | FK, IX | N | — |
| `sku_id` | UUID | FK, IX | N | Anchored to a catalog SKU so quotes are comparable. |
| `grade` | `grade_type` | Y | Null means "quote me any grade" — a legitimate case when the buyer is price-led. |
| `qty` | INT | N | — |
| `target_price` | NUMERIC(14,2) | Y | Optional anchor. Hidden from vendors by default; showing it collapses all quotes to that number. |
| `delivery_pincode` | CHAR(6) | N | Vendors need it to quote a realistic date. |
| `needed_by` | DATE | Y | — |
| `status` | TEXT | IX | N | `OPEN` / `QUOTED` / `AWARDED` / `EXPIRED` / `CANCELLED`. |
| `expires_at` | TIMESTAMPTZ | N | Quotes must be time-bound or the buyer holds a free option on vendor stock. |

### `rfq_quote`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `rfq_id` | UUID | FK CASCADE, IX | N | — |
| `vendor_org_id` | UUID | FK, UQ(rfq_id,vendor_org_id) | N | One quote per vendor per RFQ; revisions update the row and log to history. |
| `unit_price` | NUMERIC(14,2) | N | — |
| `qty_committed` | INT | N | May be less than requested. Partial commitments are normal and the buyer can combine two vendors. |
| `dispatch_days` | INT | N | — |
| `validity` | TIMESTAMPTZ | N | — |
| `status` | TEXT | IX | N | `SUBMITTED` / `ACCEPTED` / `REJECTED` / `EXPIRED`. |
| `message` | TEXT | Y | **Scanned for phone numbers and email addresses before storage, which are redacted.** Vendors attempting to take the deal off-platform is the primary leakage risk in any B2B marketplace. |

**Privacy rule:** vendors cannot see each other's quotes or identities. Enforced by row-level filtering on `vendor_org_id` — never by hiding it in the interface alone.
---

# PART 9 — Inspection (8 tables)

This domain is the reason the business exists. Everything here answers one question: *is this machine what the vendor said it was?*

## 9.1 `qc_batch`

**Why this table exists:** units arrive at the hub in cartons, not one at a time. The batch is the intake unit — it is where "we expected 40, we received 38" is recorded, on the spot, rather than discovered three days later.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `batch_number` | TEXT | UQ | N | `GGN-26-0841`. Written on the carton label. |
| `hub_id` | UUID | FK, IX | N | Which hub. |
| `source_type` | TEXT | N | `VENDOR_PICKUP` / `FIRST_PARTY` / `RETURN`. Return batches follow different rules — they compare against a prior fingerprint. |
| `vendor_org_id` | UUID | FK, IX | Y | Null for first-party stock. |
| `expected_units` / `received_units` | INT | N | The difference is a shortage, recorded with a penalty and a buyer notification the same day. |
| `status` | TEXT | IX | N | `OPEN` / `IN_PROGRESS` / `CLOSED` / `EXCEPTION`. |
| `opened_at` / `closed_at` | TIMESTAMPTZ | N / Y | Hub dwell time is a headline operational metric; it is the gap between these two. |

---

## 9.2 `qc_report` — one inspection of one machine

**Grain:** one row = one complete inspection of one unit by one technician at one time. A unit inspected twice (audit re-check) has two rows.

| Column | Type | Key | Null | Why this column exists |
|---|---|---|---|---|
| `id` | UUID | PK | N | Referenced by `order_line_unit`, `unit`, `return_qc`. |
| `unit_id` | UUID | FK, IX | N | — |
| `batch_id` | UUID | FK, IX | N | — |
| `technician_id` | UUID | FK→`user_account` | N | **Named accountability.** Printed on the certificate. If a technician's error rate rises, we can see it. |
| `device_cert_id` | TEXT | N | The X.509 certificate of the QC USB device that produced the report. Reports from an unregistered device are rejected. |
| `agent_version` | TEXT | N | When a diagnostic bug is found, this tells us exactly which reports to re-run. |
| `started_at` / `completed_at` | TIMESTAMPTZ | N / Y | Throughput measurement, and an abandoned inspection is one where `completed_at` stays null. |
| `qc_score` | INT | IX | Y | 0–100, computed from `qc_area_result`. Null until complete. `CHECK (qc_score BETWEEN 0 AND 100)`. |
| `verdict` | `qc_verdict` enum | IX | Y | `PASS` / `PASS_WITH_NOTE` / `MISMATCH` / `FAIL`. The four-way split matters: PASS_WITH_NOTE ships with a disclosure, MISMATCH pauses the order and asks the buyer, FAIL returns to the vendor. Collapsing these into pass/fail would either ship undisclosed defects or reject sellable stock. |
| `grade_proposed` | `grade_type` | Y | What the checklist computed from the technician's cosmetic answers. |
| `grade_final` | `grade_type` | Y | What the technician confirmed. **Two columns because the override is the interesting event** — a high override rate means either the checklist is wrong or the technician is. |
| `grade_override_reason` | TEXT | Y | Required when `grade_final <> grade_proposed`. |
| `report_pdf_key` | TEXT | Y | The certificate that ships in the box and lives in the buyer's account. |
| `signature` | TEXT | N | The agent's cryptographic signature over the report payload. Prevents a forged report being posted to the API. |
| `nonce` | TEXT | UQ | N | Single-use. Blocks replay of a captured genuine report against a different machine. |
| `verification_code` | TEXT | UQ, IX | Y | The short code behind the QR on the certificate, for public verification without login. |

---

## 9.3 `qc_hardware_detected` — what the machine actually is

**Why this is a separate table from `qc_report`:** thirty-odd hardware fields would bloat the report table, and they are read together as a unit only on the detail screen. One-to-one, keyed on `qc_report_id`.

**Why this table is the heart of the product:** this is the column-by-column comparison against what the vendor declared. Spec fraud — 16 GB sold, 8 GB shipped — is invisible without it.

| Column | Type | Null | Why |
|---|---|---|---|
| `qc_report_id` | UUID | PK, FK CASCADE | One-to-one. |
| `hw_serial` | TEXT | N | Read from SMBIOS. **Must equal the scanned serial.** A mismatch is an immediate fraud flag, because it means the label does not belong to the machine. |
| `hw_model` / `bios_version` / `bios_date` | TEXT | Y | Identity and firmware age. |
| `cpu_detected` / `cores` / `threads` | TEXT / INT | Y | Compared to `sku.cpu_model`. |
| `ram_detected_gb` | INT | N | **Compared to `sku.ram_gb`. The single most common mismatch.** |
| `ram_modules` / `ram_type` / `ram_speed_mhz` | INT / TEXT / INT | Y | Two 8 GB sticks versus one 16 GB stick is a real difference for a buyer planning upgrades. |
| `storage_type` / `storage_detected_gb` / `storage_model` | TEXT / INT / TEXT | Y | Compared to the SKU. `storage_model` catches a branded SSD swapped for an unbranded one. |
| `smart_status` | TEXT | Y | `OK` / `WARNING` / `FAILING`. Failing is a hard stop. |
| `power_on_hours` | INT | Y | The honest measure of use. A machine graded A+ with 22,000 power-on hours is being misrepresented. |
| `tbw_gb` | INT | Y | Terabytes written — SSD wear. |
| `gpu_detected` / `panel_id` / `screen_size` | TEXT / NUMERIC | Y | Panel ID detects a replaced screen. |
| `battery_design_wh` / `battery_full_wh` | INT | Y | The two numbers whose ratio is battery health. Stored raw so the percentage can be recomputed if the formula changes. |
| `battery_health_pct` | NUMERIC(5,2) | Y | Compared against `listing.battery_health_band`. |
| `cycle_count` | INT | Y | 800 cycles at 90% health is a replaced battery. Two fields together tell a story neither tells alone. |
| `wifi_chip` / `bt_present` | TEXT / BOOLEAN | Y | — |
| `tpm_version` / `secure_boot` | TEXT / BOOLEAN | Y | Corporate buyers require TPM 2.0 for Windows 11 compliance. |
| `bios_locked` | BOOLEAN | N | **Hard fail.** A BIOS or supervisor password makes the machine unusable to the buyer. |
| `mdm_locked` | BOOLEAN | N | **Hard fail.** MDM, DEP or iCloud enrolment means the previous owner still controls it. |
| `computrace_active` | BOOLEAN | N | **Hard fail.** Absolute/Computrace can remotely brick the machine. |
| `raw_json` | JSONB | Y | The complete agent output. Kept because tomorrow's dispute will ask about a field we did not think to model today. |

---

## 9.4 `qc_area_result`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | BIGSERIAL | PK | N | — |
| `qc_report_id` | UUID | FK CASCADE, IX | N | — |
| `area` | TEXT | N | `DISPLAY` / `KEYBOARD` / `BATTERY` / `STORAGE` / `MEMORY_CPU` / `PORTS` / `CONNECTIVITY` / `CAMERA_AUDIO` / `THERMAL` / `BIOS_SECURITY` / `DATA_SECURITY` / `PHYSICAL`. Twelve rows per report. |
| `score` / `max_score` | NUMERIC(5,2) | N | Both stored, because weights are configurable and a historical report must still render with the weights that applied then. |
| `status` | TEXT | N | `PASS` / `WARN` / `FAIL`. Drives the segment colour on the meter in the interface. |
| `details_json` | JSONB | Y | Per-area specifics: which ports failed, how many dead pixels, peak temperature. |

**Why twelve rows rather than twelve columns:** the interface renders a twelve-segment meter by looping over these rows. Adding a thirteenth area later becomes a config change plus a data row, not a migration on a wide table.

---

## 9.5 `qc_mismatch`

**Why this table exists:** a mismatch is a decision point involving the buyer, the vendor and money. It needs its own record with its own state.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `qc_report_id` | UUID | FK CASCADE, IX | N | — |
| `field` | TEXT | N | `ram_gb`, `grade`, `battery_health`, `storage_gb`. |
| `declared_value` / `actual_value` | TEXT | N | Text because the fields have different types. This pair is shown side by side to the buyer, verbatim. |
| `severity` | TEXT | IX | N | `BLOCKING` / `MAJOR` / `MINOR`, resolved from `qc_tolerance_rule`. |
| `resolution` | TEXT | Y | `DISCOUNT` / `SWAP` / `CANCEL` / `ACCEPT_AS_IS`. Null while awaiting the buyer. |
| `discount_amount` | NUMERIC(14,2) | Y | Offered and, if accepted, flows to a credit note. |
| `buyer_notified_at` | TIMESTAMPTZ | N | Starts the 24-hour clock. |
| `buyer_decision_at` | TIMESTAMPTZ | Y | Null past the deadline triggers auto-cancel and refund. |
| `penalty_id` | UUID | FK→`penalty` | Y | The vendor charge raised for this mismatch. |

**A rule worth stating explicitly:** a *better* spec than declared is still a mismatch. If the buyer paid for 16 GB and the bench finds 32 GB, they still did not get what they configured, and the vendor may be dumping the wrong stock. The buyer may accept at the same price, or the unit is relisted correctly.

---

## 9.6 `qc_tolerance_rule` — business rules as data

**Why this table exists:** "is 88% battery against a declared 90%+ band acceptable?" is a business judgement that will be tuned dozens of times in the first year. It must not be a code deployment.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `field` | TEXT | IX | N | Which detected field the rule governs. |
| `comparison` | TEXT | N | `EXACT` / `GTE` / `WITHIN_PCT` / `WITHIN_BAND` / `ONE_BAND_DOWN`. |
| `tolerance_value` | TEXT | Y | The threshold. Text because it may be a number, a percentage or a band name. |
| `severity` | TEXT | N | What a breach is classified as. |
| `is_blocking` | BOOLEAN | N | True stops dispatch. Set for RAM, storage, BIOS lock, MDM lock, SMART failing. |
| `effective_from` | DATE | N | Rules are versioned by date. **A report is evaluated against the rules in force on its inspection date**, so tightening a rule does not retroactively make last month's shipments non-compliant. |

---

## 9.7 `qc_photo`, `wipe_certificate`, `qc_audit_recheck`

### `qc_photo`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | BIGSERIAL | PK | — |
| `qc_report_id` | UUID | FK CASCADE, IX | — |
| `angle` | TEXT | | `LID` / `PALMREST` / `SCREEN_ON` / `BASE` / `PORTS` / `WORST_DEFECT`. Six fixed angles under fixed lighting, so grade comparisons across units and dates are meaningful. |
| `file_key` / `hash` | TEXT | | Watermarked with serial and timestamp at capture. The watermark is burned in, not overlaid at render, so a downloaded photo stays attributable. |
| `captured_at` | TIMESTAMPTZ | | — |

### `wipe_certificate`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `unit_id` | UUID | FK, IX | — |
| `method` / `standard` | TEXT | | `NIST_800_88_PURGE` or `CLEAR`. Corporate IT and audit teams ask for this by name. |
| `passes` | INT | | — |
| `verification_status` | TEXT | | A wipe that was not verified is not a wipe. |
| `certificate_key` / `hash` | TEXT | | The PDF and its integrity hash. |
| `issued_at` | TIMESTAMPTZ | | — |

**Why a separate table rather than a field on the QC report:** the wipe certificate is a standalone legal artifact that a buyer's compliance team files independently, and it must survive even if the QC report is superseded by a re-inspection.

### `qc_audit_recheck`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `original_report_id` / `recheck_report_id` | UUID | FK | Roughly 5% of units are inspected a second time by a different technician. |
| `divergence_json` | JSONB | | Which fields disagreed. Rolled up per technician into a divergence rate. |
| `auditor_id` | UUID | FK | — |

**Why we audit ourselves:** without this, the inspection is only as good as its least careful technician, and we have no way to know who that is.

---

# PART 10 — Logistics (9 tables)

## 10.1 `hub` and `carrier`

### `hub`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `code` | TEXT | UQ | `GGN-01`. Appears in batch numbers and on labels. |
| `name` / `address_id` | TEXT / UUID | FK | — |
| `is_active` | BOOLEAN | | — |
| `capacity_units_per_day` | INT | | Capacity planning; also the input to "which hub can absorb this order". |
| `serves_zones` | TEXT[] | | Which geographic zones route here. At launch: everything. As hubs open, this array is how work redistributes without a code change. |

### `carrier`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `code` | TEXT | UQ | `BLUEDART` / `PORTER` / `INHOUSE`. |
| `adapter_key` | TEXT | | Which code adapter implements this carrier. Adding a courier is a row plus an adapter class, never a rewrite of the shipping logic. |
| `config_json` | JSONB | | Credentials reference, endpoints, weight limits, service codes. Secrets are referenced by name, never stored here. |
| `supports_leg` | TEXT[] | | `{INBOUND,OUTBOUND}`. Porter does not do the long outbound leg; the router must know. |
| `is_active` / `priority` | BOOLEAN / INT | | Priority orders the fallback chain when the first choice fails. |

---

## 10.2 `shipment`

**Why one table covers three different journeys:** inbound (vendor → hub), outbound (hub → buyer) and return all share the same shape — a carrier, two addresses, a set of units, a tracking number. The `leg` column distinguishes them. Three separate tables would triplicate the tracking, label and webhook logic.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `leg` | `shipment_leg` enum | IX | N | `INBOUND` / `OUTBOUND` / `RETURN`. |
| `sub_order_id` | UUID | FK, IX | Y | Null for a return that is not tied to a sub-order. |
| `carrier_id` | UUID | FK | N | — |
| `from_address_id` / `to_address_id` | UUID | FK | N | — |
| `awb_number` | TEXT | UQ, IX | Y | The carrier's tracking number. Null until the shipment is booked. |
| `mode` | TEXT | N | `SURFACE` / `AIR` / `TRUCK` / `BIKE`. |
| `declared_value` | NUMERIC(14,2) | N | Insurance basis. Equals invoice value. |
| `weight_kg` / `boxes` | NUMERIC / INT | N | Freight computation and carrier booking. |
| `freight_cost` | NUMERIC(14,2) | Y | Actual cost from the carrier, reconciled monthly against what we quoted. The difference is our margin or our loss. |
| `seal_id` | TEXT | Y | Tamper-evident seal number. If the seal at delivery does not match, the buyer knows before opening. |
| `status` | `shipment_status` enum | IX | N | — |
| `pickup_slot_from` / `pickup_slot_to` | TIMESTAMPTZ | Y | The window the vendor chose. |
| `dispatched_at` / `delivered_at` | TIMESTAMPTZ | Y | `delivered_at` **starts both the 48-hour inspection window and the warranty clock.** One of the most consequential timestamps in the schema. |
| `label_key` / `pod_key` | TEXT | Y | Shipping label and proof of delivery. |

---

## 10.3 `shipment_unit` — the anti-dispute join

| Column | Type | Key | Why |
|---|---|---|---|
| `shipment_id` + `unit_id` | UUID | PK (composite), FK | — |
| `serial_number` | TEXT | | Denormalised. |

**Why this table matters more than it looks:** it records exactly which serial numbers were inside which box. "You delivered the wrong unit" becomes an answerable question rather than an argument. Without it, a shipment is a quantity and every delivery dispute is unwinnable.

---

## 10.4 `shipment_tracking`, `pickup_task`, `delivery_task`, `rider`, `custody_event`

### `shipment_tracking`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | BIGSERIAL | PK | High volume — every carrier scan is a row. |
| `shipment_id` | UUID | FK, IX | — |
| `status_code` / `description` / `location` | TEXT | | Normalised from the carrier's own vocabulary into ours, so the buyer sees consistent language regardless of who is carrying it. |
| `raw_payload` | JSONB | | The carrier's original message. Kept for debugging their webhooks, which will misbehave. |
| `occurred_at` | TIMESTAMPTZ | IX | Carrier event time, not our receipt time. Webhooks arrive out of order. |

### `pickup_task`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `sub_order_id` | UUID | FK, IX | — |
| `vendor_org_id` / `address_id` | UUID | FK | Where the rider goes. |
| `expected_serials` | TEXT[] | | **The manifest.** The rider scans against this array. A serial not on it is refused at the door; a missing one is a shortage recorded on the spot with the vendor present. |
| `scanned_serials` | TEXT[] | | What was actually collected. The difference between the arrays is the shortage record. |
| `otp_hash` | TEXT | | The vendor's handover OTP, hashed. |
| `assigned_rider_id` | UUID | FK | Null when a courier handles it. |
| `slot_from` / `slot_to` | TIMESTAMPTZ | | — |
| `status` / `completed_at` | TEXT / TIMESTAMPTZ | | — |

### `delivery_task`
Same shape at the buyer end: `otp_hash`, `attempts` (three failures trigger an RTO decision), `photo_keys` (unboxing evidence for in-house deliveries), `delivered_at`.

### `rider`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `user_id` | UUID | FK, UQ | A rider is a user with a role, not a separate identity system. |
| `zone` | TEXT | IX | Which NCR sector they cover. |
| `vehicle_type` | TEXT | | Capacity constraint for route planning. |
| `is_active` | BOOLEAN | | — |

### `custody_event`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | BIGSERIAL | PK | — |
| `unit_id` | UUID | FK, IX | — |
| `from_party` / `to_party` | TEXT | | `VENDOR` → `RIDER` → `HUB` → `QC_BENCH` → `PACKING` → `CARRIER` → `BUYER`. |
| `actor_id` | UUID | | Who performed the scan. |
| `scan_type` | TEXT | | `BARCODE` / `MANUAL` / `OTP`. Manual entries are audited more closely. |
| `geo_lat` / `geo_lng` | NUMERIC(9,6) | | Where the scan happened. Null when GPS is unavailable — the rider app works offline and must not block on location. |
| `occurred_at` | TIMESTAMPTZ | IX | — |

**Why custody is tracked per unit rather than per shipment:** a shipment of forty machines that arrives with thirty-nine needs to identify *which one* is missing and at which handoff it disappeared.

---

# PART 11 — Money (11 tables)

## 11.1 `invoice`

**Why this table serves five document types:** proforma, tax invoice, commission invoice, credit note and debit note share a structure — issuer, recipient, lines, tax breakup, total. The `type` column distinguishes them, and a credit note points back through `original_invoice_id`.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `invoice_number` | TEXT | UQ, IX | N | **Legally required to be sequential and gapless within a series and financial year.** Generated from a dedicated sequence per issuer per year, never from a UUID or a timestamp. |
| `type` | `invoice_type` enum | IX | N | — |
| `issuer_org_id` | UUID | FK, IX | N | Under the agency model, the vendor. Under buy-sell, TrueTech. This one column carries the transaction model into every document. |
| `recipient_org_id` | UUID | FK, IX | N | — |
| `sub_order_id` | UUID | FK, IX | Y | Null on commission invoices, which are not tied to one sub-order. |
| `invoice_date` | DATE | IX | N | `DATE`, not timestamp — an invoice dated 31 March must stay in that financial year regardless of timezone. |
| `place_of_supply` | CHAR(2) | N | The state code that determines the tax split. Stored explicitly on the invoice because it must be printed and must never be recomputed later from data that has since changed. |
| `taxable_value` | NUMERIC(14,2) | N | — |
| `cgst` / `sgst` / `igst` / `cess` | NUMERIC(14,2) | N | Four separate columns, defaulting to 0. Exactly one of (cgst+sgst) or (igst) is non-zero. Storing a single "tax" column would make GSTR filing impossible. |
| `total` | NUMERIC(14,2) | N | — |
| `irn` | TEXT | UQ, IX | Y | The Invoice Reference Number from the government portal. **Dispatch is blocked while this is null** on a tax invoice above the e-invoicing threshold. |
| `ack_no` / `ack_date` | TEXT / TIMESTAMPTZ | Y | The IRP acknowledgement. |
| `signed_qr` | TEXT | Y | The signed QR payload, printed on the PDF. Legally required. |
| `irp_status` | TEXT | IX | N | `PENDING` / `GENERATED` / `FAILED` / `CANCELLED`. Failures go to a retry queue with an Ops alert. |
| `pdf_key` | TEXT | Y | — |
| `original_invoice_id` | UUID | FK→self | Y | Set on credit and debit notes. Links the correction to what it corrects. |
| `created_at` | TIMESTAMPTZ | N | — |

## 11.2 `invoice_line`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `invoice_id` | UUID | FK CASCADE, IX | N | — |
| `sku_id` | UUID | FK | Y | — |
| `description` | TEXT | N | The line text as printed. **Stored, not generated at render**, because the SKU description may change and a reprinted invoice must be byte-identical to the original. |
| `hsn` | TEXT | N | Legally required per line. |
| `qty` / `unit_price` / `taxable_value` / `gst_rate` / `gst_amount` | | N | All stored. |
| `serial_numbers` | TEXT[] | Y | **The serials on this line, printed on the invoice.** This is what makes the buyer's fixed-asset register match the physical machines, and what makes a warranty claim traceable years later. |

## 11.3 `eway_bill`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `invoice_id` | UUID | FK, UQ | N | One e-way bill per invoice. |
| `ewb_number` / `ewb_date` | TEXT / TIMESTAMPTZ | Y | — |
| `valid_upto` | TIMESTAMPTZ | IX | Y | E-way bills expire by distance. A monitoring job extends them on long transit; an expired bill in transit is a seizure risk. |
| `transporter_id` | TEXT | Y | The transporter's GSTIN. |
| `vehicle_no` / `awb_number` | TEXT | Y | Part-B, filled at dispatch. |
| `distance_km` | INT | N | Determines validity duration. |
| `status` | TEXT | N | — |

**Threshold rule:** required when consignment value exceeds ₹50,000. The threshold lives in `platform_config`, not in code, because state rules vary and change.

## 11.4 `ledger_entry` — the source of financial truth

**Why double-entry rather than a balance column:** already argued in Principle 1.6. Restating it here because it is the most-questioned table: every rupee movement is two rows, a debit and a credit, that must sum to zero within a `batch_id`. A balance is `SUM(credit) - SUM(debit)`. Nothing overwrites anything.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | BIGSERIAL | PK | N | — |
| `entry_date` | DATE | IX | N | The accounting date, which may differ from `created_at` for backdated corrections. |
| `account_code` | TEXT | IX | N | `VENDOR_PAYABLE` / `BUYER_RECEIVABLE` / `COMMISSION_INCOME` / `GST_PAYABLE` / `TDS_PAYABLE` / `FREIGHT_EXPENSE` / `PENALTY_INCOME` / `ESCROW`. |
| `org_id` | UUID | FK, IX | Y | Which party. Null for internal accounts. |
| `debit` / `credit` | NUMERIC(14,2) | N | Both default 0; exactly one is non-zero per row. `CHECK (debit >= 0 AND credit >= 0)`. |
| `ref_type` / `ref_id` | TEXT / UUID | IX | N | What caused it — an invoice, a payout, a refund, a penalty. |
| `narration` | TEXT | N | Human-readable line for the statement. |
| `batch_id` | UUID | IX | N | Groups the rows of one balanced transaction. **A nightly job asserts that every batch sums to zero.** A non-zero batch is a bug that has already corrupted the books and must page someone. |
| `created_at` | TIMESTAMPTZ | N | — |

**Grants:** the application role has `INSERT` and `SELECT` only. No `UPDATE`, no `DELETE`.

## 11.5 `payment`, `refund`

### `payment`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `order_id` | UUID | FK, IX | N | — |
| `buyer_org_id` | UUID | FK, IX | N | — |
| `gateway` / `gateway_ref` | TEXT | UQ(gateway,gateway_ref) | N | The unique pair prevents processing the same gateway callback twice — webhook duplicates are routine. |
| `method` | TEXT | N | `UPI` / `NEFT` / `RTGS` / `NETBANKING` / `CARD` / `VIRTUAL_ACCOUNT`. Large B2B payments arrive by RTGS into a virtual account far more often than by card. |
| `amount` | NUMERIC(14,2) | N | — |
| `status` | `payment_status` enum | IX | N | — |
| `captured_at` | TIMESTAMPTZ | Y | — |
| `raw_payload` | JSONB | Y | The gateway's full response, for reconciliation disputes. Card numbers are never present — the gateway does not send them and we would not store them. |

### `refund`
Mirrors payment, with `order_line_id` (refunds are usually partial, at the line or unit level, not whole-order), `reason`, and `gateway_ref`.

## 11.6 `settlement_run`, `payout`, `commission_rule`, `penalty`

### `settlement_run`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `cycle_start` / `cycle_end` / `run_date` | DATE | The period being settled. |
| `status` | TEXT | `DRAFT` / `APPROVED` / `EXECUTED` / `FAILED`. **A run is computed, reviewed, then executed.** Money never moves in the same step that computes it. |
| `total_gross` / `total_commission` / `total_tds` / `total_net` | NUMERIC(14,2) | Control totals, checked against the sum of payouts before execution. |
| `executed_by` | UUID | FK | Named human accountability for money leaving the company. |

### `payout`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `settlement_run_id` | UUID | FK, IX | N | — |
| `vendor_org_id` | UUID | FK, IX | N | — |
| `bank_account_id` | UUID | FK | N | **Which account it went to on that date**, even if the vendor changes it later. |
| `gross` | NUMERIC(14,2) | N | — |
| `commission` / `commission_gst` | NUMERIC(14,2) | N | — |
| `logistics_recovery` | NUMERIC(14,2) | N | Only charged on vendor-fault QC failures. Default 0. |
| `penalties` | NUMERIC(14,2) | N | Default 0. |
| `tds_amount` | NUMERIC(14,2) | N | Section 194-O. |
| `adjustments` | NUMERIC(14,2) | N | Returns and credit notes from earlier cycles. Can be negative. |
| `net_amount` | NUMERIC(14,2) | N | **Every one of the seven columns above is stored separately, not netted**, because the payout advice must itemise them. A vendor who sees only a net figure will open a ticket every single cycle. |
| `utr` | TEXT | UQ | Y | The bank's transaction reference. This is what a vendor quotes to their bank. |
| `status` | TEXT | IX | N | — |
| `paid_at` / `advice_key` | TIMESTAMPTZ / TEXT | Y | — |

### `commission_rule`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `vendor_tier` | `vendor_tier` enum | Rate by tier. |
| `sku_category` | TEXT | Optional narrowing. Null = all. |
| `min_value` / `max_value` | NUMERIC(14,2) | Value slabs — a ₹80,000 workstation should not carry the same percentage as a ₹16,000 machine. |
| `rate_pct` | NUMERIC(5,2) | — |
| `effective_from` | DATE | Versioned. **An order uses the rule in force on its confirmation date**, never the current one. |

### `penalty`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `vendor_org_id` | UUID | FK, IX | — |
| `order_line_id` | UUID | FK | What triggered it. |
| `type` | `penalty_type` enum | `LATE_DISPATCH` / `QC_MISMATCH` / `CANCELLATION` / `SHORT_SUPPLY`. |
| `amount` | NUMERIC(14,2) | — |
| `reason` | TEXT | Shown to the vendor verbatim. |
| `waived_by` / `waived_reason` | UUID / TEXT | Waivers are logged with a named approver, because an unlogged waiver is how favouritism starts. |
| `applied_at` | TIMESTAMPTZ | — |
---

# PART 12 — After-sale (7 tables)

## 12.1 `return_request`

**Grain:** one row = one buyer's claim about one specific serial number.

**Why per-unit and not per-order:** in a 90-unit delivery, two machines have a problem. A per-order return would force the buyer to return all ninety.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `return_number` | TEXT | UQ | N | Human reference for support calls. |
| `order_line_unit_id` | UUID | FK, IX | N | The exact machine. |
| `buyer_org_id` | UUID | FK, IX | N | — |
| `reason_code` | TEXT | IX | N | `DOA` / `SPEC_MISMATCH` / `GRADE_MISMATCH` / `TRANSIT_DAMAGE` / `WRONG_ITEM` / `SHORT_SHIPMENT`. Structured because the distribution of reasons tells us whether the problem is a vendor, a carrier or our own bench. |
| `description` | TEXT | Y | — |
| `evidence_keys` | TEXT[] | N | Photos or video. Required — a claim without evidence cannot be adjudicated and will become an argument. |
| `status` | TEXT | IX | N | `RAISED` / `APPROVED` / `PICKUP_SCHEDULED` / `IN_TRANSIT` / `UNDER_QC` / `RESOLVED` / `REJECTED`. |
| `raised_at` | TIMESTAMPTZ | N | **Checked against `shipment.delivered_at` + 48 hours.** Late claims are handled as warranty, not returns — a different process with different liability. |
| `approved_by` | UUID | FK | Y | — |
| `resolution` | TEXT | Y | `REFUND` / `REPLACE` / `REPAIR` / `REJECT`. |

## 12.2 `return_qc`

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `return_request_id` | UUID | FK, UQ | N | — |
| `qc_report_id` | UUID | FK | N | The returned machine is re-inspected exactly like a new one. |
| `fingerprint_match` | BOOLEAN | IX | N | **Compares `hw_fingerprint_hash` against the unit we dispatched.** False means a different machine came back. This is the single control that makes returns safe to offer at all. |
| `verdict` | TEXT | N | `CLAIM_VALID` / `CLAIM_INVALID` / `UNIT_SWAPPED`. |
| `liable_party` | TEXT | IX | N | `VENDOR` / `CARRIER` / `TRUETECH` / `BUYER`. Decides who pays: a vendor debit, an insurance claim, an internal QC error log, or a rejected claim. Recording this is how we learn where quality actually breaks. |
| `notes` | TEXT | Y | — |

## 12.3 `warranty` and `warranty_claim`

### `warranty`
**Why a row per provider:** one machine can carry an OEM warranty, a seller warranty and a TrueTech warranty simultaneously, with different end dates and different claim routes.

| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `unit_id` | UUID | FK, IX | N | — |
| `provider` | `warranty_provider` enum | N | `OEM` / `SELLER` / `TRUETECH` / `EXTENDED`. |
| `start_date` | DATE | N | Equals delivery date. |
| `end_date` | DATE | IX | N | — |
| `terms_version` | TEXT | N | Which version of the warranty terms applies. Terms change; a claim is judged against the version in force at purchase. |
| `status` | TEXT | N | `ACTIVE` / `EXPIRED` / `VOID`. Void when the buyer opens the machine or uses an unauthorised repairer. |

### `warranty_claim`
| Column | Type | Key | Null | Why |
|---|---|---|---|---|
| `id` | UUID | PK | N | — |
| `warranty_id` / `unit_id` | UUID | FK, IX | N | — |
| `buyer_org_id` | UUID | FK | N | — |
| `issue_type` | TEXT | N | Categorised for failure-pattern analysis by model. |
| `description` | TEXT | N | — |
| `status` | TEXT | IX | N | — |
| `resolution` | TEXT | Y | `REPAIR` / `REPLACE` / `REFUND` / `REJECT`. |
| `cost` | NUMERIC(14,2) | Y | Our actual cost. Summed per model, this tells us whether a grade's warranty length is priced correctly. |
| `qc_report_ref` | UUID | FK | Y | **Every claim is judged against the original inspection report.** If the report says all ports passed and a port is now dead, that is a warranty event. If the report disclosed it, it is not. This is the entire commercial reason the QC certificate exists. |
| `closed_at` | TIMESTAMPTZ | Y | — |

## 12.4 `ticket`, `ticket_message`, `dispute`

### `ticket`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `ticket_number` | TEXT | UQ | — |
| `org_id` | UUID | FK, IX | Buyer or vendor. |
| `category` / `priority` | TEXT | IX | Routing and SLA. |
| `subject` / `status` | TEXT | IX | — |
| `assigned_to` | UUID | FK | — |
| `sla_due_at` | TIMESTAMPTZ | IX | Computed from priority. Breaches are reported, not hidden. |
| `closure_otp_hash` | TEXT | **A ticket closes only when the raiser confirms with an OTP.** Agents closing their own tickets to hit a metric is a universal support pathology; this removes the option. |
| `closed_at` | TIMESTAMPTZ | — |

### `ticket_message`
`is_internal BOOLEAN` separates internal notes from customer-visible replies. A leaked internal note is a real incident, so the separation is a column, not a convention.

### `dispute`
| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `order_id` | UUID | FK, IX | — |
| `raised_by_org_id` / `against_org_id` | UUID | FK, IX | Both sides recorded. |
| `category` / `amount_disputed` | TEXT / NUMERIC | The money at stake. |
| `status` | TEXT | IX | — |
| `committee_decision` / `decided_at` | TEXT / TIMESTAMPTZ | Written back to both parties' scorecards. |

---

# PART 13 — Platform (10 tables)

## 13.1 `vendor_scorecard`

**Why a snapshot table rather than a live computation:** the score must be reproducible. A vendor demoted from Gold to Silver will ask why, and "run this query again and you will get a different answer because the 90-day window has moved" is not an acceptable reply.

**Grain:** one row = one vendor's score for one computed period.

| Column | Type | Null | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `vendor_org_id` | UUID | FK, IX | — |
| `period_start` / `period_end` | DATE | The 90-day rolling window. |
| `qc_pass_rate` | NUMERIC(5,2) | Weight 25. Units passing first time ÷ units sent. |
| `grade_accuracy` | NUMERIC(5,2) | Weight 20. `grade_actual = grade_declared` ÷ inspected. |
| `ontime_dispatch` | NUMERIC(5,2) | Weight 15. Handovers inside `dispatch_sla_due_at`. |
| `acceptance_rate` | NUMERIC(5,2) | Weight 10. |
| `return_rate` | NUMERIC(5,2) | Weight 10, inverted. |
| `dispute_rate` | NUMERIC(5,2) | Weight 8, inverted. |
| `buyer_rating_avg` | NUMERIC(3,2) | Weight 7. |
| `listing_hygiene` | NUMERIC(5,2) | Weight 5. Completeness, photo quality, stock accuracy. |
| `units_in_period` | INT | **The minimum-volume guard.** A vendor with three orders is not ranked against one with three hundred; below the threshold the tier is held rather than computed. |
| `composite_score` | NUMERIC(5,2) | The weighted sum. |
| `tier` | `vendor_tier` enum | The resulting tier, copied to `organization.tier`. |
| `computed_at` | TIMESTAMPTZ | — |

**All eight component metrics are stored, not just the composite**, because the vendor dashboard shows exactly which number is holding them back. A single score with no breakdown is not actionable, and an unactionable score does not change behaviour.

## 13.2 `buyer_review`

| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `order_id` | UUID | FK, UQ(order_id, vendor_org_id) | One review per order per vendor. Prevents review stuffing. |
| `buyer_org_id` / `vendor_org_id` | UUID | FK, IX | — |
| `rating` | INT | `CHECK (rating BETWEEN 1 AND 5)`. |
| `comment` | TEXT | — |
| `is_published` | BOOLEAN | Moderated before display. |
| `moderated_by` | UUID | FK | — |

**Rule:** only a buyer with a `DELIVERED` order can review. Enforced in application logic and backed by the FK to a real order.

## 13.3 `platform_config` — business rules as data

**Why this table exists:** commission caps, penalty amounts, QC tolerances, SLA hours, the e-way bill threshold, warranty defaults by grade, price guard-rail multipliers and freight slabs will all change repeatedly in the first year. None of them should require a deployment.

| Column | Type | Key | Why |
|---|---|---|---|
| `id` | UUID | PK | — |
| `key` | TEXT | IX | `warranty.default.A_PLUS`, `qc.min_sellable_score`, `return.window_hours`, `eway.threshold_inr`. |
| `value_json` | JSONB | Typed values without a column per setting. |
| `effective_from` | TIMESTAMPTZ | IX | **Versioned, never overwritten.** The value in force on a given date is recoverable, which is what makes a historical decision defensible. |
| `changed_by` | UUID | FK | — |
| `version` | INT | — |

**Read pattern:** `SELECT ... WHERE key = ? AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1`, cached in Redis with a short TTL.

## 13.4 `notification_template`, `notification_log`

### `notification_template`
| Column | Type | Why |
|---|---|---|
| `code` / `channel` / `locale` | TEXT | Composite unique. `(ORDER_CONFIRMED, WHATSAPP, hi)` is a distinct row from the English one. |
| `subject` / `body` | TEXT | — |
| `provider_template_id` | TEXT | WhatsApp templates must be pre-approved by Meta and are referenced by their approved ID. |
| `version` / `is_active` | INT / BOOLEAN | — |

### `notification_log`
| Column | Type | Why |
|---|---|---|
| `id` | BIGSERIAL | High volume. |
| `org_id` / `user_id` | UUID | IX | Answers "did you actually tell me?" — asked in most disputes. |
| `channel` / `template_code` | TEXT | — |
| `payload_json` | JSONB | The variables used. |
| `status` / `provider_ref` | TEXT | Delivery receipts from the provider. |
| `sent_at` | TIMESTAMPTZ | IX | Partition key. |

## 13.5 `integration_log`

| Column | Type | Why |
|---|---|---|
| `id` | BIGSERIAL | PK |
| `provider` | TEXT | IX | `GSTIN_API`, `GSP`, `BLUEDART`, `PENNY_DROP`. |
| `endpoint` / `status_code` / `latency_ms` | TEXT / INT | Per-integration reliability dashboards and vendor SLA conversations. |
| `request_hash` | TEXT | **A hash, never the request body.** These calls carry PANs, bank numbers and GSTINs. Logging the payload would recreate the PII we encrypted three tables ago. |
| `error` | TEXT | Message only, scrubbed. |
| `correlation_id` | TEXT | IX | Joins to `audit_log.request_id`. |
| `occurred_at` | TIMESTAMPTZ | IX | Partition key. |

## 13.6 `feature_flag` and `data_subject_request`

### `feature_flag`
`key`, `enabled`, `rollout_pct`, `org_scope UUID[]`. Lets a new flow go live for three friendly vendors before everyone.

### `data_subject_request`
| Column | Type | Why |
|---|---|---|
| `id` | UUID | PK |
| `org_id` / `user_id` | UUID | Who is asking. |
| `type` | TEXT | `ACCESS` / `CORRECTION` / `ERASURE` / `GRIEVANCE`. **A DPDP requirement, not a nice-to-have.** |
| `status` / `requested_at` / `completed_at` | | The 30-day clock. |
| `handled_by` | UUID | FK | Named accountability. |
| `outcome_notes` | TEXT | Including which data could not be erased because tax law requires retaining it for eight years — a lawful refusal that must be documented. |

---

# PART 14 — Cross-cutting design

## 14.1 The complete index list that matters

Indexes cost write throughput. These earn their keep:

| Index | Table | Query it serves |
|---|---|---|
| `(sku_id, grade, status, unit_price)` | `listing` | **The offers grid.** The hottest query on the platform. |
| `UNIQUE (serial_number) WHERE status NOT IN (...)` | `unit` | Serial uniqueness — a correctness guarantee, not a speed one. |
| `UNIQUE (normalized_key)` | `sku` | Catalog dedupe guarantee. |
| `(buyer_org_id, status, placed_at DESC)` | `order` | Buyer's order list. |
| `(vendor_org_id, status)` | `sub_order` | Vendor's order queue. |
| `(unit_id)` | `qc_report` | Certificate lookup during a warranty claim. |
| `(org_id, entry_date)` | `ledger_entry` | Statement generation. |
| `(status, sla_due_at)` | `ticket` | SLA breach monitor. |
| `(pincode, carrier_id)` | `pincode_serviceability` | Checkout serviceability check. |
| `GIN (ports_json)` | `sku` | Port-based filters. |
| `GIN (legal_name gin_trgm_ops)` | `organization` | Fuzzy duplicate detection at onboarding. |
| `(expires_at) WHERE status='ACTIVE'` | `listing` | The stale-listing job, scanning only live rows. |

## 14.2 Partitioning plan

Five tables are partitioned monthly by range on their timestamp:

| Table | Estimated rows/month at scale | Why partitioned |
|---|---|---|
| `audit_log` | 15–40 M | Largest table by far. Detach and archive old months. |
| `order_event` | 2–5 M | — |
| `shipment_tracking` | 3–8 M | Carrier scans are high-frequency. |
| `notification_log` | 5–15 M | — |
| `integration_log` | 10–25 M | — |

`stock_movement` and `ledger_entry` are candidates for year-two partitioning; they are large but not yet large enough to justify the operational overhead.

**Retention job:** partitions older than the retention period are detached, exported to cold storage, then dropped. Dropping a partition is instant; deleting 40 million rows is an outage.

## 14.3 Encryption and PII inventory

| Column | Table | Protection | Reason |
|---|---|---|---|
| `account_number_enc` | `bank_account` | Envelope encryption, KMS key | Direct financial fraud vector |
| `pan_enc` | `pan_record` | Envelope encryption | Identity theft; DPDP personal data |
| `mfa_secret_enc` | `user_account` | Envelope encryption | Leaked seed defeats MFA entirely |
| `password_hash` | `user_account` | Argon2id (one-way) | — |
| `code_hash` | `otp_request` | SHA-256 + pepper | An OTP dump must not enable a delivery |
| `otp_hash` | `pickup_task`, `delivery_task`, `ticket` | SHA-256 + pepper | Same |
| `value_hash` | `blacklist_entry` | SHA-256 + pepper | A plaintext blacklist is a curated PII file |
| `pan_hash` | `pan_record` | SHA-256 + pepper | Enables matching without decryption |
| `file_key` | `kyc_document` | Private bucket, 5-min signed URLs, access logged | Documents contain everything |

**Rule stated plainly for the team:** if a column would be damaging in a leaked CSV, it is encrypted or hashed. If we need to match on it, we hash it and match hashes. We decrypt only at the moment of use, and every decryption writes an audit row.

## 14.4 Retention schedule

| Data | Retention | Basis |
|---|---|---|
| Invoices, e-way bills, ledger, orders | 8 years from the end of the financial year | Income Tax Act and GST record-keeping |
| KYC documents and verification results | Relationship duration + 8 years | Same, plus contractual |
| QC reports and wipe certificates | Warranty end + 3 years | Warranty adjudication window |
| Audit log | 3 years | Investigation and DPDP accountability |
| Session records | 90 days after expiry | Security investigation |
| OTP records | 90 days | Pure liability afterwards |
| Notification and integration logs | 12 months | Debugging window |
| Marketing consent records | Withdrawal + 1 year | Proof of lawful basis |
| Abandoned carts | 90 days | No reason to keep them |

Erasure requests are honoured against everything except rows under statutory retention; those are documented as a lawful refusal in `data_subject_request.outcome_notes`.

## 14.5 Scaling to all of India

The schema is designed for roughly 500 vendors, 50,000 live listings, 200,000 units a year and 1,000 orders a day. Growing past that:

| Pressure point | First response | If that is not enough |
|---|---|---|
| Offers-grid read load | Read replica + Redis cache on `(sku_id, grade)` | Materialised view refreshed on listing change |
| Catalog search | OpenSearch index, already in the architecture | Shard by brand |
| `audit_log` growth | Monthly partitions, already planned | Move to a separate database instance |
| Multi-hub inventory | `hub_id` on `unit`, `serves_zones` on `hub` — already present | Hub-local read replicas |
| Analytics competing with transactions | Read replica for BI | CDC into a warehouse |
| Regional write latency | Not an issue in one country | — |

**Deliberately not built now:** sharding by region, multi-master writes, and eventual-consistency inventory. Each adds significant correctness risk for scale we do not have. The constraints in this schema — serial uniqueness, oversell prevention, ledger balance — depend on single-writer transactional guarantees, and giving those up early would trade a real guarantee for a hypothetical throughput need.

## 14.6 Data-quality jobs that must exist

These run nightly and page someone on failure. They are part of the schema design, not an afterthought:

1. **Ledger balance check** — every `batch_id` in `ledger_entry` sums to zero.
2. **Stock reconciliation** — for each listing, `qty_available + qty_reserved` equals the count of units in matching statuses.
3. **Orphan check** — no `order_line_unit` points to a unit allocated to a different order line.
4. **Serial duplicate scan** — belt and braces alongside the unique index, in case a status transition creates a window.
5. **Credit exposure recompute** — `buyer_profile.credit_used` re-derived from the ledger; any drift is logged and corrected.
6. **Document expiry sweep** — `kyc_document.expires_on` past due triggers re-request and, after grace, suspension.
7. **GSTIN re-verification** — quarterly for all, daily for orgs holding credit.
8. **E-way bill expiry monitor** — any bill expiring within 6 hours while its shipment is still in transit raises an alert.

---

# PART 15 — Appendices

## 15.1 Complete table list (61 tables)

| # | Table | Domain | Grain |
|---|---|---|---|
| 1 | `organization` | Identity | One legal business entity |
| 2 | `user_account` | Identity | One human who can sign in |
| 3 | `role` | Identity | One named role |
| 4 | `permission` | Identity | One granular capability |
| 5 | `role_permission` | Identity | One role-permission grant |
| 6 | `user_role` | Identity | One user's role in one org |
| 7 | `session` | Identity | One active login on one device |
| 8 | `otp_request` | Identity | One OTP issued |
| 9 | `audit_log` | Identity | One state-changing action |
| 10 | `gst_profile` | KYC | One GSTIN of one org |
| 11 | `pan_record` | KYC | One PAN of one org |
| 12 | `bank_account` | KYC | One payout account |
| 13 | `kyc_document` | KYC | One uploaded file |
| 14 | `kyc_review` | KYC | One review decision |
| 15 | `blacklist_entry` | KYC | One blocked identifier |
| 16 | `agreement_acceptance` | KYC | One agreement accepted by one user |
| 17 | `vendor_profile` | KYC | Vendor-specific extension of an org |
| 18 | `buyer_profile` | KYC | Buyer-specific extension of an org |
| 19 | `org_address` | Geography | One physical location |
| 20 | `pincode_master` | Geography | One Indian PIN code |
| 21 | `pincode_serviceability` | Geography | One carrier's capability for one PIN |
| 22 | `brand` | Catalog | One manufacturer |
| 23 | `series` | Catalog | One product family |
| 24 | `model` | Catalog | One model |
| 25 | `sku` | Catalog | One exact configuration |
| 26 | `sku_image` | Catalog | One catalog photograph |
| 27 | `sku_request` | Catalog | One vendor request for a missing model |
| 28 | `catalog_change_log` | Catalog | One SKU field change |
| 29 | `listing` | Supply | One vendor's offer of one SKU at one grade |
| 30 | `listing_tier_price` | Supply | One volume price band |
| 31 | `listing_image` | Supply | One actual-unit photograph |
| 32 | `unit` | Supply | One physical laptop |
| 33 | `stock_movement` | Supply | One unit status or location change |
| 34 | `price_history` | Supply | One price change |
| 35 | `cart` | Demand | One buyer's working cart |
| 36 | `cart_item` | Demand | One listing in a cart |
| 37 | `order` | Demand | One buyer's purchase |
| 38 | `sub_order` | Demand | One vendor's part of one order |
| 39 | `order_line` | Demand | One listing bought in one sub-order |
| 40 | `order_line_unit` | Demand | One serial allocated to one line |
| 41 | `order_event` | Demand | One order state transition |
| 42 | `rfq` | Demand | One bulk request |
| 43 | `rfq_quote` | Demand | One vendor's quote against one RFQ |
| 44 | `hub` | Inspection | One inspection facility |
| 45 | `qc_batch` | Inspection | One intake batch |
| 46 | `qc_report` | Inspection | One inspection of one unit |
| 47 | `qc_area_result` | Inspection | One of twelve areas in one report |
| 48 | `qc_hardware_detected` | Inspection | Detected hardware for one report |
| 49 | `qc_photo` | Inspection | One bench photograph |
| 50 | `qc_mismatch` | Inspection | One declared-vs-found discrepancy |
| 51 | `qc_tolerance_rule` | Inspection | One tolerance rule version |
| 52 | `wipe_certificate` | Inspection | One data wipe certificate |
| 53 | `qc_audit_recheck` | Inspection | One second-opinion inspection |
| 54 | `carrier` | Movement | One logistics provider |
| 55 | `shipment` | Movement | One leg of one physical movement |
| 56 | `shipment_unit` | Movement | One serial inside one shipment |
| 57 | `shipment_tracking` | Movement | One carrier scan |
| 58 | `pickup_task` | Movement | One collection job |
| 59 | `delivery_task` | Movement | One delivery job |
| 60 | `rider` | Movement | One in-house delivery executive |
| 61 | `custody_event` | Movement | One handover of one unit |

*(Money, after-sale and platform tables 62–83 follow the same conventions and are documented in Parts 11–13.)*

## 15.2 Every enum type and its values

| Enum | Values | Where used |
|---|---|---|
| `org_type` | VENDOR, BUYER, INTERNAL | `organization` |
| `org_status` | LEAD, REGISTERED, PROFILE_SUBMITTED, KYC_SUBMITTED, UNDER_REVIEW, INFO_REQUESTED, VERIFIED, REJECTED, SUSPENDED, DEACTIVATED, BLACKLISTED | `organization`, profiles |
| `constitution_type` | PROPRIETORSHIP, PARTNERSHIP, LLP, PVT_LTD, LTD, TRUST, OTHER | `organization` |
| `vendor_tier` | WATCHLIST, BRONZE, SILVER, GOLD, PLATINUM | `organization`, `vendor_scorecard`, `commission_rule` |
| `txn_model` | AGENCY, BUY_SELL | `organization` |
| `address_type` | REGISTERED, BILLING, SHIPPING, PICKUP, HUB | `org_address` |
| `doc_status` | UPLOADED, VERIFIED, REJECTED, EXPIRED | `kyc_document` |
| **`grade_type`** | **A_PLUS, A, B** | `listing`, `unit`, `order_line`, `qc_report` |
| `condition_type` | LIKE_NEW, UNBOXED, REFURBISHED, USED_TESTED | `listing` |
| `functional_status` | FULLY_FUNCTIONAL, MINOR_ISSUE, LIMITED, NON_FUNCTIONAL | `listing`, QC |
| `battery_band` | EXCELLENT_90_PLUS, GOOD_80_89, FAIR_70_79, LOW_BELOW_70, UNKNOWN | `listing` |
| `parts_status_type` | ALL_ORIGINAL, OEM_REPLACED, COMPATIBLE_REPLACED, MIXED | `listing` |
| `repair_history_type` | NONE, MINOR, MAJOR | `listing` |
| `wipe_status_type` | VERIFIED_WIPED, CERTIFICATE_AVAILABLE, NOT_APPLICABLE | `listing` |
| `warranty_provider` | OEM, SELLER, TRUETECH, EXTENDED, NONE | `warranty` |
| `warranty_duration` | NONE, D7, D30, M3, M6, M12 | `listing` |
| `oem_warranty_band` | NONE, LT_3M, M3_6, M6_12, M12_PLUS | `listing` |
| `listing_status` | DRAFT, PENDING_APPROVAL, ACTIVE, PAUSED, OUT_OF_STOCK, REJECTED, SUSPENDED, EXPIRED, DELISTED | `listing` |
| `unit_status` | CREATED, LISTED, RESERVED, PICKUP_SCHEDULED, PICKED_UP, RECEIVED_AT_HUB, QC_IN_PROGRESS, QC_PASSED, QC_MISMATCH, QC_FAILED, PACKED, DISPATCHED, DELIVERED, RETURN_REQUESTED, RETURN_IN_TRANSIT, RETURN_QC, RETURNED_TO_VENDOR, SCRAPPED | `unit` |
| `order_status` | CREATED … REFUNDED (21 values) | `order`, `sub_order`, `order_line` |
| `payment_status` | PENDING, AUTHORIZED, PAID, PARTIALLY_PAID, FAILED, REFUNDED, CREDIT | `order`, `payment` |
| `payment_mode` | PREPAID, PARTIAL_ADVANCE, CREDIT | `order`, `buyer_profile` |
| `qc_verdict` | PASS, PASS_WITH_NOTE, MISMATCH, FAIL | `qc_report` |
| `shipment_leg` | INBOUND, OUTBOUND, RETURN | `shipment` |
| `shipment_status` | CREATED, SCHEDULED, PICKED_UP, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, FAILED, RTO, CANCELLED | `shipment` |
| `invoice_type` | PROFORMA, TAX, COMMISSION, CREDIT_NOTE, DEBIT_NOTE | `invoice` |
| `penalty_type` | LATE_DISPATCH, QC_MISMATCH, CANCELLATION, SHORT_SUPPLY, OTHER | `penalty` |

## 15.3 The ten questions this schema is built to answer

If a change to the schema makes any of these harder to answer, the change is wrong.

1. **Which physical machine did this buyer receive?** → `order_line_unit.serial_number` → `unit` → `qc_report`
2. **Was it what the vendor said it was?** → `unit.grade_declared` vs `grade_actual`; `qc_hardware_detected` vs `sku`
3. **Who touched it, and when?** → `custody_event`, `stock_movement`
4. **Why is this order stuck?** → `order_event`, `sub_order.status`, `qc_mismatch`
5. **What exactly do we owe this vendor, and why?** → `ledger_entry` filtered by `org_id`, itemised in `payout`
6. **Is this invoice legally correct?** → `invoice` + `invoice_line` + `eway_bill`, place of supply from `gst_profile.state_code` vs `org_address.state_code`
7. **Should this vendor still be selling here?** → `vendor_scorecard` with all eight components
8. **Who approved this, and were they allowed to?** → `audit_log` joined to `user_role` and `permission`
9. **Can we deliver to this PIN code, by when, at what cost?** → `pincode_serviceability`
10. **What personal data do we hold on this person, and can we erase it?** → the PII inventory in 14.3, actioned through `data_subject_request`

## 15.4 Deliberate omissions and why

| Not in the schema | Why not |
|---|---|
| `vendor.wallet_balance` | Balances are derived from the ledger. A mutable balance column is a bug waiting for a race condition. |
| A generic `attributes JSONB` on `sku` | Spec fields must be queryable and comparable. A JSON bag makes "16 GB or more" impossible to index properly and lets two vendors describe the same machine differently. |
| Product categories beyond laptops | Deliberate scope discipline. Adding phones later means new SKU attributes and a new QC checklist, both of which are additive. Building the abstraction now would compromise the laptop experience for a product we do not sell. |
| A `messages` table for buyer-vendor chat | RFQ messaging goes through `rfq_quote.message` with redaction. General chat is a disintermediation channel and is not being built. |
| Soft delete on transactional tables | Orders and invoices are never deleted. Cancelled is a status, not a deletion. |
| Multi-currency columns | Single country, single currency. Adding currency later is a column plus a rate table; adding it now is complexity for nothing. |

---

## Document control

**Version 1.0** — first complete draft for team review.

**How to use this document:** each engineer owns one domain and reads Parts 0–2 plus their own domain in full. Changes to any table require an update to its section here in the same pull request. A column added without a "why" line will be rejected at review, because a column nobody can justify is a column nobody will maintain.

**Open items requiring a decision before implementation:**

1. **Transaction model default** — agency or buy-sell for third-party vendors. Affects `organization.transaction_model` default, `invoice.issuer_org_id` logic, and whether TCS applies. Needs the CA's sign-off.
2. **E-invoicing threshold** — confirm the current turnover threshold with the CA and set `platform_config['einvoice.threshold_inr']`.
3. **Margin scheme** — whether Rule 32(5) applies to any vendor. If yes, `invoice` needs a `margin_scheme` flag and a different taxable-value computation.
4. **Return window** — 48 hours is assumed throughout. Confirm before the constraint is written into the SLA jobs.
5. **Minimum units for scorecard ranking** — the value of `vendor_scorecard.units_in_period` below which the tier is held rather than computed.
