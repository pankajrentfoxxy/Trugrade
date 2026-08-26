# Architecture — gorefurbo B2B platform

**Version 1.0 · 25 August 2026 · supersedes the earlier TrueTech 28-day architecture note**

This document is the technical contract. Every phase prompt in this pack assumes it. Where it disagrees with an older document in the folder, this one wins.

---

## 0. What changed, and why it matters

The earlier plan in your folder designed a **marketplace**: vendors sell, the platform facilitates, money is split, and the buyer sees the seller. You have now chosen a different business: **the platform buys and sells on its own account**. That is not a cosmetic change. It moves five things:

| | Marketplace (old plan) | Principal / merchant-of-record (now) |
|---|---|---|
| Who is the seller | The vendor | **The platform** |
| Invoice to the buyer | Vendor's invoice | **Platform's invoice** |
| Vendor identity to buyer | Legally **must** be shown (CP e-Comm Rules r.5(3)(a)) | **Not required** — Rule 5 is marketplace-only; you fall under r.4 + r.7 |
| Money movement | Buyer → escrow → split to vendor (needs an RBI-licensed PA; escrow is a PA privilege) | Buyer → **your receivable**; vendor → **your payable**. Ordinary trade. No PA question. |
| Tax collection | GST TCS u/s 52 + GSTR-8 + TDS u/s 194-O | **None of those.** Instead: TDS on *your purchases* u/s 393(1) Sl.8(ii) (ex-194Q), 0.1% above ₹50 L/vendor/yr |
| Liability | Largely the vendor's; you route claims | **Yours, non-delegable** (r.7(4) take-back, r.7(5) authenticity) |

**Read that last row twice.** The anonymity you wanted is free under this model — but it is paid for with liability. Your "we opened it and sealed it" claim is simultaneously the product, the marketing, and the thing a regulator or a buyer will sue on. That is why the QC subsystem in this architecture is not a feature; it is the load-bearing wall.

There is also a new domain that did not exist in the old plan: **procurement**. When a customer order is confirmed, the system must automatically raise a purchase order to the vendor, receive the vendor's invoice, three-way match it, accrue the payable, withhold TDS, and pay out. That is Phase 7, and it is the module most likely to be under-scoped.

---

## 1. Shape of the system

### 1.1 Modular monolith with service-shaped seams

One deployable API. One database, twelve schemas. Internally organised exactly as the services you would eventually split into, with boundaries enforced by tooling rather than good intentions.

```
gorefurbo/
├── apps/
│   ├── api/                      # NestJS — the whole backend
│   │   ├── src/modules/
│   │   │   ├── identity/         # auth, users, RBAC, sessions, OTP, orgs, addresses
│   │   │   ├── kyc/              # documents, verification checks, review queue, consents
│   │   │   ├── customer/         # buyer org, preferences, approval policy, credit
│   │   │   ├── vendor/           # vendor org, capability, facility, payout prefs
│   │   │   ├── catalog/          # brand→series→model→sku, condition image library
│   │   │   ├── listing/          # listings, units, serials, stock, grade corrections
│   │   │   ├── qc/               # visits, technicians, tool runs, reports, seals
│   │   │   ├── ordering/         # cart, order, sub-order, allocation, approvals
│   │   │   ├── procurement/      # ★ NEW: PO, vendor invoice, 3-way match, payable, payout
│   │   │   ├── payment/          # customer invoice, e-way bill, collections, ledger
│   │   │   ├── logistics/        # carriers, shipments, routing, tasks, tracking
│   │   │   └── platform/         # returns, warranty, tickets, config, notifications
│   │   ├── src/shared/           # db, config, event bus, errors, guards, decorators
│   │   └── src/platform/         # migrations, jobs, seeds, health, telemetry
│   ├── storefront/               # Next.js 15 — public marketplace + customer portal
│   ├── console/                  # Next.js 15 — vendor portal + admin portal
│   ├── technician/               # Expo — QC field app
│   └── rider/                    # Expo — delivery app
├── packages/
│   ├── ui/                       # shadcn/ui + the gorefurbo design system
│   ├── contracts/                # zod schemas + generated TS types — the API contract
│   ├── config/                   # eslint, tsconfig, tailwind preset
│   └── qc-report-schema/         # the signed QC report contract (shared with the .exe)
└── infra/                        # docker-compose, terraform, github actions
```

**Four rules make this an architecture and not just folders:**

1. **Each module owns its own Postgres schema.** `identity.`, `procurement.`, `qc.` … One database, twelve schemas.
2. **A module may only read another module's data through that module's public service interface.** Never a cross-schema `JOIN`. Enforced by a custom ESLint rule in CI (`no-cross-module-import`), not by discipline.
3. **Cross-module communication goes through a typed in-process event bus**, using the exact event names a real queue would use later: `order.confirmed`, `qc.report.completed`, `po.raised`, `vendor.verified`, `payment.captured`, `shipment.delivered`.
4. **Every module exposes an explicit `I<Module>Service` interface.** That interface is the future network contract. When you extract `qc` into its own service, you move the folder, swap the in-process bus for SQS, and replace the direct call with an HTTP client. The interfaces do not change.

**Why not microservices now.** Three of your flows must be atomic across four modules each (see §4). Inside one database that is `BEGIN…COMMIT`. Across five services it is a saga with compensating transactions, and a botched saga means you either oversell a laptop or pay a vendor twice. You would be trading a guarantee you get for free for a distributed-systems problem the team would be solving for the first time, under deadline. Split when a module needs independent scaling (QC report ingestion, most likely), when the team passes six engineers, or when one module's deployment risk is materially different. None of those is true yet.

### 1.2 Two web apps, not one, not three

| App | Framework | Serves | Why |
|---|---|---|---|
| `apps/storefront` | **Next.js 15, App Router** | Public marketplace + customer portal | Needs SSR/ISR for SEO on model, brand and category pages. The only app exposed to anonymous traffic, and it has a completely different threat model |
| `apps/console` | **Vite + React + React Router** | Vendor portal + admin portal | Authenticated-only, zero SEO value, heavy tables and forms. SSR is pure overhead here, and the Vite dev server is materially faster to work against |

**Revised 26 Aug 2026, after reading the DeviceSure repo.** The console was originally specified as Next.js for uniformity. Change it to Vite + React, because DeviceSure's `apps/web` is already exactly this — Vite, React, React Router, Vitest — and the team has built it once. Reusing a pattern they have working beats a second Next.js app whose server-component and caching model they would be learning under deadline, for a dashboard that renders nothing to a search engine.

`packages/ui` is plain React, so both apps consume it unchanged. Two build tools is a real cost; a small team fighting App Router caching on an authenticated admin grid is a larger one.

Vendor and admin stay in **one** console app. They share ~80% of their component surface and 100% of their data-grid infrastructure, and the real boundary is RBAC at the API, not the bundle.

**Never** put admin code in the storefront bundle. The console must not be reachable from the public origin.

### 1.3 Stack, decided

| Layer | Choice | Why this, not the alternative |
|---|---|---|
| Backend | **NestJS 10 + TypeScript** | Its module system enforces §1.1 natively. Plain Express leaves boundaries as convention, and conventions do not survive a deadline. Your team knows Node. |
| Database | **PostgreSQL 16**, schema-per-module | Every correctness constraint you have needs real transactions, real `EXCLUDE` constraints, and real partial unique indexes. |
| ORM | **Prisma** with `multiSchema` | Type-safe; the generated types become the shared contract between API and web. Use raw SQL through `$queryRaw` for the three hot paths in §4 — do not fight the ORM there. |
| Cache / locks | **Redis 7** | Stock reservation locks, sessions, rate limits, idempotency keys. |
| Jobs | **BullMQ** on the same Redis | Verification calls, notifications, carrier polling, partition creation, drift checks, QC expiry sweeps. |
| Web | **Next.js 15 (storefront) + Vite/React (console)**, Tailwind + shadcn/ui, in a **Turborepo** | One design system, two apps, shared `packages/ui` and `packages/contracts`. SSR where SEO pays for it; Vite where it does not. Mirrors DeviceSure's existing `apps/web`. |
| Mobile | **Expo / React Native** | Changed from the earlier Flutter plan **because your team knows React**. One language across five apps beats a marginally better mobile runtime nobody on the team can debug. |
| Files | **S3 (ap-south-1) + CloudFront** | Signed URLs only. Magic-byte validation, EXIF strip, virus scan on upload. |
| Auth | JWT access 15 min + rotating refresh in an httpOnly cookie, session record in Redis | Revocability. TOTP MFA mandatory for admin roles and the vendor owner role — that login can change where money is paid. |
| Search | Postgres `tsvector` + GIN + faceted filter queries | 200 SKUs does not need OpenSearch. Revisit at ~50k SKUs or when facet latency exceeds the budget. |
| Infra | AWS **ap-south-1**, Docker, ECS Fargate | Data residency (DPDP). A single EC2 is acceptable at pilot; the container boundary is what matters. |
| CI/CD | GitHub Actions → staging on merge to `main`, production on tag | |
| Observability | Sentry + OpenTelemetry → CloudWatch | Trace IDs propagated into the event bus so a cross-module flow is one trace. |

### 1.4 Every external integration sits behind an adapter with a mock, from day one

GSTIN verification, PAN, penny-drop, Razorpay, Delhivery, Blue Dart, DTDC, Shiprocket, Porter, SMS, WhatsApp, e-invoice IRN, e-way bill. **All of them.** Each is `I<Thing>Adapter` with a `Real` and a `Fake` implementation selected by config.

This is not tidiness. Third-party onboarding lead times are the single most common cause of a missed deadline on a project like this — Blue Dart requires a review-gated credential process, DTDC has no public documentation at all, Razorpay KYC takes weeks, and SMS DLT registration is measured in weeks. **Start every application on day 1, before any code.** The mocks mean nothing blocks.

---

## 2. Data architecture

### 2.1 Twelve schemas

You already have 109 tables across 11 schemas in `truetech_complete_schema.sql`, plus 17 more in the v3 QC-at-source migration. **Reuse them.** This architecture adds one schema and fixes ten defects.

| Schema | Tables (approx) | Status |
|---|---|---|
| `identity` | 17 | Exists — reuse |
| `kyc` | 13 | Exists — reuse |
| `customer` | 6 | Exists — reuse |
| `vendor` | 8 | Exists — reuse |
| `catalog` | 7 | Exists — **extend** with the condition-image library |
| `listing` | 7 | Exists — **extend** with `valuation_method`, `purchase_price`, `vendor_ask_price` |
| `qc` | 19 | Exists (v3) — reuse; deprecate the hub-batch path |
| `ordering` | 11 | Exists — reuse |
| **`procurement`** | **9** | **NEW — build in Phase 7** |
| `payment` | 10 | Exists — **rework** for principal-model invoicing |
| `logistics` | 17 | Exists (v3) — reuse |
| `platform` | 15 | Exists — reuse; add CHECK constraints to nine status columns |

### 2.2 The new `procurement` schema

This is the module the old plan did not need. It is where the merchant-of-record model actually lives.

```sql
CREATE SCHEMA procurement;

-- What we agreed to pay a vendor for a unit, before any order exists.
procurement.price_book          -- vendor_org_id, sku_id, grade, agreed_net_payout,
                                -- margin_pct, effective_from/to, approved_by
procurement.margin_rule         -- category/brand/grade/value-band → target margin %,
                                -- floor margin %, priority; evaluated first-match-wins

-- Raised automatically inside the order-confirmation transaction.
procurement.purchase_order      -- po_number (human), vendor_org_id, order_id,
                                -- status, total_net, tds_rate_pct, expected_dispatch_at,
                                -- valuation_method, terms_days
procurement.purchase_order_line -- po_id, unit_id (UNIQUE), sku_id, agreed_net_payout,
                                -- grade_at_po, qc_report_id
procurement.vendor_invoice      -- po_id, vendor_invoice_no, invoice_date, taxable_value,
                                -- cgst/sgst/igst, total, document_id, match_status
procurement.goods_receipt       -- po_id, unit_id, received_by (carrier pickup ack),
                                -- seal_verified, received_at   -- virtual: goods never
                                --                                 touch our warehouse
procurement.vendor_payable      -- po_id, gross, tds_amount, penalty_amount,
                                -- adjustment_amount, net_payable, due_on, status
procurement.payout_run          -- run_number, period_from/to, total_net, executed_at
procurement.payout              -- run_id, vendor_org_id, amount, utr, bank_ref, status
procurement.tds_ledger          -- vendor_org_id, fy, cumulative_purchase_value,
                                -- threshold_crossed_at, tds_deducted, challan_ref
```

**The rules that matter here:**

- `purchase_order_line.unit_id` is **UNIQUE**. A physical laptop can be on exactly one PO, ever. This is the mirror of `ordering.order_line_unit.unit_id UNIQUE`, and together they make double-selling structurally impossible.
- A PO is raised **inside the order-confirmation transaction**, not by a job afterwards. If the PO cannot be raised, the order does not confirm.
- **Three-way match** = purchase order ↔ vendor invoice ↔ goods receipt (seal-verified pickup). No payable accrues without all three. `match_status` ∈ `PENDING | MATCHED | PRICE_VARIANCE | QTY_VARIANCE | MISSING_GRN | DISPUTED`.
- **`tds_ledger` is per vendor per financial year.** TDS at 0.1% applies only on the amount *exceeding* ₹50 lakh in the year, and only if our own turnover exceeded ₹10 crore in the preceding year. 5% if the vendor has no valid PAN. Withhold at credit or payment, **whichever is earlier** — which in this design is at payable accrual, not at payout. Get this wrong and you get a 30% expenditure disallowance.
- Deduction stack order on a payout, and it must be a first-class data model, not arithmetic in a query: **gross → TDS → penalties → adjustments/credit notes → net.** Retrofitting this is brutal; build it in Phase 7 or don't build Phase 7.

### 2.3 Changes to existing tables

```sql
-- listing.unit: the merchant-of-record and GST-valuation fields
ALTER TABLE listing.unit
  ADD COLUMN vendor_ask_price   NUMERIC(14,2),           -- what the vendor wants, net
  ADD COLUMN purchase_price     NUMERIC(14,2),           -- what we agreed to pay, per serial
  ADD COLUMN valuation_method   TEXT NOT NULL DEFAULT 'REGULAR'
      CHECK (valuation_method IN ('REGULAR','MARGIN')),  -- IMMUTABLE after purchase
  ADD COLUMN itc_eligible       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN retail_price       NUMERIC(14,2),           -- what the customer pays
  ADD COLUMN margin_rule_id     UUID,
  ADD COLUMN supply_point_code  TEXT;                    -- 'A','B','C' — the anonymised label

-- The immutability guarantee. valuation_method decides GST treatment for the life
-- of the unit; a later flip would retrospectively destroy the tax position.
CREATE OR REPLACE FUNCTION listing.lock_valuation_method() RETURNS trigger AS $$
BEGIN
  IF OLD.purchase_price IS NOT NULL AND NEW.valuation_method <> OLD.valuation_method THEN
    RAISE EXCEPTION 'valuation_method is immutable once purchase_price is set (unit %)', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_lock_valuation BEFORE UPDATE ON listing.unit
  FOR EACH ROW EXECUTE FUNCTION listing.lock_valuation_method();

-- payment.invoice: we are now the supplier on the customer-facing invoice
ALTER TABLE payment.invoice
  ADD COLUMN valuation_method TEXT NOT NULL DEFAULT 'REGULAR'
      CHECK (valuation_method IN ('REGULAR','MARGIN')),
  ADD COLUMN margin_base      NUMERIC(14,2),   -- sale − purchase, for MARGIN invoices
  ADD COLUMN irn              TEXT,            -- e-invoice reference number
  ADD COLUMN irn_ack_no       TEXT,
  ADD COLUMN irn_generated_at TIMESTAMPTZ,
  ADD COLUMN signed_qr        TEXT;

-- catalog: the condition image library — vendors upload no photographs
CREATE TABLE catalog.condition_image (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id        UUID REFERENCES catalog.sku(id),   -- null = applies to whole model/series
  model_id      UUID REFERENCES catalog.model(id),
  grade         grade_type NOT NULL,
  view_code     TEXT NOT NULL,   -- LID_TOP, PALMREST, KEYBOARD, SCREEN_ON, PORTS_LEFT,
                                 -- PORTS_RIGHT, BASE, HINGE, CORNER_WEAR, SCREEN_DEFECT
  s3_key        TEXT NOT NULL,
  alt_text      TEXT NOT NULL,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INT NOT NULL DEFAULT 0,
  created_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, grade, view_code, sort_order)
);
CREATE UNIQUE INDEX uq_condition_primary
  ON catalog.condition_image (COALESCE(sku_id, model_id), grade) WHERE is_primary;
```

**On the condition image library — a warning worth taking seriously.** You are showing a buyer a *representative* image of a grade, not the machine they will receive, while simultaneously vouching for that machine's condition under Rule 7(5). Two controls make that defensible and you must build both:

1. Every listing image carries a visible, non-dismissible label: **"Representative image of Grade A condition. Your unit's actual inspection report and photographs are on the unit passport."**
2. The **unit passport** — the per-serial QC report with the six real photographs the technician took — must be reachable **before purchase**, not only after. That is what converts a representative image from a misrepresentation risk into an honest illustration.

### 2.4 The ten schema defects, and the fix for each

| # | Defect | Fix | Phase |
|---|---|---|---|
| 1 | **Partitions expire 2026-10-01** (`order_event`, `shipment_tracking`, `notification_log`, `integration_log`) and 2026-11-01 (`audit_log`). No DEFAULT partition, no creation job. **Inserts will start failing.** | `pg_partman` or a BullMQ job creating 3 months ahead, nightly; plus a monitor that alerts if runway < 30 days | **0 — do this first** |
| 2 | Zero triggers, zero functions. Every prose invariant is app-enforced. | Add DB triggers for `updated_at`, `is_sellable` recomputation, `qc_report.is_current`, visit counters, `listing.qty_*`. Keep status-transition legality in the app state machine but assert it in tests. | 0 and per-module |
| 3 | `listing.v_sellability_drift` misses seal-less units — `LEFT JOIN` makes the comparison NULL and the row vanishes | `COALESCE(s.status IN ('APPLIED','INTACT'), FALSE)` | 0 |
| 4 | `platform_config.key` has no UNIQUE | `UNIQUE (key, effective_from)` + a `current_config` view taking the latest | 0 |
| 5 | Nine free-text status columns with no CHECK, all on the after-sale and money tables | Convert to enums or add CHECKs | 0 |
| 6 | `routing_rule.carrier_code` is TEXT, not an FK | FK to `logistics.carrier(code)` | 8 |
| 7 | `carrier_rate_card` has no overlap exclusion (unlike `listing_tier_price`, which does) | `EXCLUDE USING gist` on carrier + zones + weight range + date range | 8 |
| 8 | `qc_sampling_rule` allows multiple active rules per tier | `UNIQUE (vendor_tier, effective_from)` + partial unique on `is_active` | 4 |
| 9 | Two QC models coexist (hub-batch and vendor-site) with nothing marking which is canonical | **Vendor-site is canonical.** Mark `qc_batch` deprecated, keep the columns for history, block new writes | 4 |
| 10 | `tt_app` / `tt_readonly` ship with password `CHANGE_ME_IN_PRODUCTION` | Secrets Manager, rotated, never in a `.sql` file | 0 |

### 2.5 Append-only enforcement is a privilege, not a constraint

Keep and extend what the existing schema does:

```sql
REVOKE UPDATE, DELETE ON identity.audit_log        FROM app_role;
REVOKE UPDATE, DELETE ON payment.ledger_entry      FROM app_role;
REVOKE UPDATE, DELETE ON listing.stock_movement    FROM app_role;
REVOKE UPDATE, DELETE ON logistics.custody_event   FROM app_role;
REVOKE UPDATE, DELETE ON kyc.consent_record        FROM app_role;
REVOKE UPDATE, DELETE ON procurement.tds_ledger    FROM app_role;   -- add this
REVOKE ALL ON kyc.pan_record, kyc.bank_account FROM readonly_role;
```

An engineer cannot "just fix" a ledger row in production. That is the point.

---

## 3. The anonymity architecture

Requirement #9 — buyers see "Seller 1, Seller 2 with City" — is now **lawful**, because there is no third-party seller to disclose. But it must be built as a **server-side guarantee**, not a frontend omission.

### 3.1 The rule

| Audience | Sees |
|---|---|
| Anonymous visitor / customer | `Supply Point A · Gurugram`, dispatch commitment, stock depth, landed price, inspection date and expiry, grade, QC score |
| Customer, post-delivery | The same. Plus the platform's invoice — on which **the platform is the seller**, and the vendor appears nowhere |
| Vendor | Only their own data. Never another vendor's existence, count, or price |
| Admin / ops | Everything |

`supply_point_code` is assigned **per vendor per city**, stable for the life of the vendor, and stored on `listing.unit`. It is a label, not a key — never derive it from a vendor UUID in a reversible way, and never expose an ordering that leaks vendor count across a city.

### 3.2 How it is enforced

**Three layers, and all three are required:**

1. **DTO whitelist at the controller boundary.** Customer-facing endpoints return explicitly constructed response objects built from an allow-list of fields. Never `return listing` and never a `@Exclude()` blacklist — blacklists fail open when someone adds a column.
2. **A serialization guard in CI.** A test that walks every customer-facing endpoint's serialized JSON and asserts the payload contains no vendor legal name, GSTIN, PAN, address line, contact number, or vendor UUID **anywhere in the tree, at any depth**. This is test suite `IDN-080…IDN-094` in the test plan.
3. **A repository-layer org scope.** Every vendor-scoped query is filtered by the caller's `org_id` at the repository, not the service. A missing `where` clause in a service must not be able to leak another vendor's rows.

**The failure mode to design against** is not the obvious field. It is the vendor name leaking through a PDF filename, a tracking URL, an S3 key, an e-way bill dispatch address rendered to the customer, an error message, or a sort order that reveals which supply point is cheapest. Test for all of those.

### 3.3 And the document that *does* have to carry a vendor address

The e-way bill under **Case 2** has `Dispatch From = the vendor's address`. That document travels with the goods and the buyer's receiving staff will see it. There is no way around this — the law requires the actual dispatch location.

What you *can* control, and must: **choose Case 2 so that the vendor's invoice value never travels.** Under Case 1 the vendor generates the e-way bill on their invoice to you, and your purchase price is printed on the paperwork the buyer receives. Under Case 2 you generate it on your invoice at your price, and the vendor appears only as a dispatch address. Hard-code Case 2. Assert it in a test (`PAY-060…PAY-064`).

---

## 4. The transactional core

Three flows must each be a single `BEGIN…COMMIT`. This is the entire reason for one database.

### 4.1 Order confirmation

```
BEGIN
  validate cart, buyer status, approval policy
  acquire Redis lock per listing_id           -- lock ordering: ascending listing_id, always
  re-read qty_available FOR UPDATE
  assert qty_available >= requested
  decrement listing.qty_available, increment qty_reserved
  INSERT ordering.order
  INSERT ordering.sub_order per vendor        -- internal grouping; never shown to the buyer
  INSERT ordering.order_line
  SELECT specific units ... FOR UPDATE SKIP LOCKED   -- allocate serials
  INSERT ordering.order_line_unit             -- unit_id is UNIQUE: a unit can be on one line
  UPDATE listing.unit SET status = 'RESERVED'
  INSERT listing.stock_movement
  ★ INSERT procurement.purchase_order + purchase_order_line per vendor
  ★ accrue procurement.vendor_payable with TDS computed against tds_ledger
  INSERT ordering.order_event
  emit order.confirmed, po.raised
COMMIT
```

If the PO cannot be raised — no price book entry, vendor suspended, TDS ledger locked — **the order does not confirm.** Better a failed checkout than an order you cannot source.

**Lock discipline:** always acquire listing locks in ascending `listing_id` order. A multi-vendor cart that locks in cart order will deadlock under concurrency. Redis lock TTL 10 s, and the **DB constraint `qty_available + qty_reserved + qty_awaiting_qc + qty_qc_failed <= qty_total` is the real guarantee** — the lock is an optimisation that prevents wasted work, not the correctness mechanism. Test the lock-expiry path explicitly.

### 4.2 QC verdict

```
BEGIN
  INSERT qc.qc_tool_run          -- raw payload + hash + signature + nonce, verbatim
  assert nonce unused, signature valid, (tool_provider_id, tool_run_id) unique
  assert serial_from_tool = manifest serial   -- FALSE is an immediate stop
  parse via qc_tool_provider.field_map_json → qc.qc_hardware_detected
  score → qc.qc_area_result (one row per inspection area)
  evaluate against qc.qc_tolerance_rule → verdict
  INSERT qc.qc_report (valid_until = today + 90d, is_current = TRUE)
  UPDATE any prior report SET is_current = FALSE, superseded_by_id = new
  IF declared_grade <> detected_grade:
     INSERT listing.grade_correction   -- vendor has 2 days to respond, then auto-applies
  UPDATE listing.unit SET status, grade_actual, qc_score, battery_health_pct,
                          qc_passed_at, qc_valid_until, is_sellable
  IF pass: INSERT qc.qc_seal (applied_photo_key NOT NULL)
  UPDATE qc.qc_visit_unit SET outcome
  emit qc.report.completed
COMMIT
```

`uq_qcrep_current ON qc.qc_report (unit_id) WHERE is_current` guarantees exactly one live report per machine. Re-inspections **supersede**; they never overwrite. History is the evidence you will need if a buyer disputes a grade.

### 4.3 Payout run

```
BEGIN
  SELECT eligible vendor_payable rows
     -- eligible = PO matched three ways AND delivered AND inspection window closed
  FOR each vendor:
     gross      = SUM(agreed_net_payout)
     tds        = compute against procurement.tds_ledger (0.1% above ₹50L, 5% if no PAN)
     penalties  = SUM(platform.penalty WHERE unsettled)
     adjustments= SUM(credit notes, grade-correction repricing)
     net        = gross − tds − penalties + adjustments
     INSERT balanced payment.ledger_entry pairs      -- one side per row
     INSERT procurement.payout
     UPDATE procurement.tds_ledger (append-only)
  ASSERT SUM(debit) = SUM(credit) FOR this batch_id   -- inside the transaction
  UPDATE procurement.payout_run SET executed_at
COMMIT
```

The batch-sums-to-zero assertion runs **inside** the transaction. `payment.v_ledger_imbalance` is the nightly detective control that proves nothing slipped past.

---

## 5. Integration architecture

### 5.1 Logistics — one canonical model, five adapters

Never let a carrier's schema leak upward. Define your own `ShipFromLocation`, `Consignee`, `Package`, `Shipment`, `ServiceOption`, `TrackingMilestone`, `Surcharge`, `ProofOfDelivery`, and map marketplace → canonical → carrier.

| Carrier | Auth | Sandbox | Tracking | Use it for |
|---|---|---|---|---|
| **Delhivery** | Static token, never expires. `Authorization: Token <t>` | **Yes** — `staging-express.delhivery.com` | Push webhook + pull (750 req / 5 min / IP) | **The anchor integration. Build this first.** Best public docs, real sandbox, documented NDR API |
| **Blue Dart** | JWT from Consumer Key+Secret, **TTL undocumented**, plus LicenceKey + LoginID on every call — four secrets | Exists, URL not published; credentials are review-gated | **Polling only, no webhook** | Where a customer contracts it. **No rate-quote API** — hold your own rate card |
| **Shiprocket** | Bearer, **240 h / 10-day expiry**. API user's email must differ from the account email | **None.** Test against production | Webhooks. 429 with an unpublished limit | Long-tail pincodes and carriers you will not integrate directly |
| **DTDC** | `api-key` + `customerId` headers (Shipsy platform) | Yes, on request | Polling + webhook | **Reach via Shiprocket** unless contractually required. No public docs at all |
| **Porter** | Not publicly documented; form-gated credentials | Not documented | Webhooks. **Tracking capped at 1 req/min** | **Intra-city, 2-wheeler only, prepaid only, single pickup + single drop.** Architecturally unsuited to B2B freight |
| **In-house** | — | — | Own rider app | NCR pilot. Full control |

**Non-negotiables in the adapter layer:**

- **Idempotency key on every shipment creation.** If a carrier accepts and the connection then times out, a naive retry produces a duplicate label and a duplicate billed shipment.
- **Retain the raw carrier status code alongside your normalised milestone.** Delhivery's NDR API keys off raw codes (`EOD-74`, `ST-108`, …) to decide which actions are even legal. A pure normalisation that discards carrier codes breaks NDR handling.
- **Distinguish transient from business failures.** Timeouts and 5xx → exponential backoff. Validation failures → an operator work queue, never a silent retry. Delhivery's ₹500 wallet minimum and case-sensitive warehouse name are exactly this class.
- **Delhivery quirks to encode:** payload must be form-encoded as `format=json&data=<json>`, not a raw JSON body; five characters are rejected outright — `& \ % # ;`; `pickup_location` must match the registered warehouse **exactly, case-sensitive**; multi-piece shipments require pre-fetched waybills per box; e-way bill goes in the `ewbn` field; `seller_gst_tin` and `hsn_code` are mandatory.
- **Event sequencing and dedup.** Carrier scans arrive out of order and duplicated.
- **NDR is a first-class flow, not an edge case.** Indian norm: 2–3 attempts, a **36-hour** seller response window, deferral capped at 6 days on Delhivery, 3 failures → RTO. Reverse logistics costs ₹180–240 per order with no revenue. Build buyer-contact automation into the loop, because the binding constraint is reaching the buyer, not calling the API.

### 5.2 Payments — much simpler than the old plan

Because you are the principal, **there is no escrow requirement and no PA licence question.** You are collecting your own receivables.

| Rail | Product | Use |
|---|---|---|
| Cards / UPI / netbanking | **Razorpay** standard checkout | Smaller orders, first-time buyers |
| NEFT / RTGS / IMPS | **Razorpay Smart Collect** — a virtual account per buyer, with **TPV** so only the buyer's own verified account can pay in | The main B2B rail. Auto-reconciles by webhook; no manual UTR entry |
| Cheque / PDC | Internal module | Received → deposited → in clearing → realised / **returned**. Model return properly: dishonour has s.138 NI Act consequences (30-day notice, 15 days to pay). Retain the return memo. Note cheques now clear same-day under RBI's continuous clearing (Phase 2 live 3 Jan 2026), and Positive Pay is mandatory bank-side from ₹50,000 |
| Credit terms | Internal `credit_application` + limit + ageing | **You are extending your own trade credit — that is not lending and does not make you an LSP.** Do not build a third-party credit product without reading the RBI Digital Lending Directions 2025 first |

**Optional, and only if a large buyer demands it:** a bank-operated escrow via Castler or Decentro for a single high-value order. Tripartite agreement, the bank is the custodian. Do not make it the default rail — it adds a compliance surface you do not currently need.

**What you must build regardless:** an open-items ledger per buyer (invoice → allocations → residual), bank-statement ingestion with auto-match, and a **reconciliation exception queue with a human workflow**. In B2B, 5–15% of receipts will not auto-match. The three hard cases are part payments, consolidated payments across many invoices, and **payments net of TDS your buyer withheld** — a naive matcher treats the last as a permanent short payment.

### 5.3 The QC executable contract

Your existing `.exe` is the highest-value asset in this system and the integration must be defensive. Define the contract in `packages/qc-report-schema` and share it with the tool.

```jsonc
{
  "schema_version": "1.0",
  "tool": { "provider_code": "GF_AGENT", "version": "2.3.1", "device_cert_id": "..." },
  "run":  { "run_id": "uuid", "nonce": "uuid", "started_at": "...", "completed_at": "..." },
  "serial": { "detected": "5CD1234ABC", "source": "SMBIOS", "confidence": 1.0 },
  "hardware": {
    "cpu": {...}, "ram_gb": 16, "ram_slots": [...], "storage": [...],
    "battery": { "health_pct": 91, "cycle_count": 148, "design_wh": 53, "full_wh": 48 },
    "display": {...}, "gpu": {...}, "ports": [...], "wifi": {...}, "bluetooth": {...}
  },
  "tests": [ { "area": "KEYBOARD", "result": "PASS", "detail": "..." }, ... ],
  "wipe":  { "performed": true, "standard": "NIST SP 800-88 Purge", "certificate_id": "..." },
  "signature": "base64(ed25519 over the canonicalised payload)"
}
```

**Rules:**
- The **raw payload is stored verbatim** (`qc_tool_run.raw_report_json` + `raw_report_hash`) before any interpretation. You will need the original when a grade is disputed.
- **Signature + nonce = replay protection.** `UNIQUE (tool_provider_id, tool_run_id)` makes ingestion idempotent.
- **`serial_matches = FALSE` is an immediate stop.** The label does not belong to the laptop. Do not grade it, do not seal it, escalate it.
- Field mapping lives in `qc_tool_provider.field_map_json` — **swapping or adding a diagnostic tool is configuration, not a code release.**
- Parse failures go to `parse_status = 'PARSE_FAILED'` with the raw payload retained and a manual-entry fallback. The technician's day does not stop because a parser regressed.

---

## 6. Security and compliance controls, as architecture

| Control | Where it lives |
|---|---|
| **RBAC** | Guards + a repository-layer org scope. Roles: `PLATFORM_SUPERADMIN`, `OPS_MANAGER`, `KYC_REVIEWER`, `CATALOG_ADMIN`, `QC_MANAGER`, `TECHNICIAN`, `LOGISTICS_MANAGER`, `RIDER`, `FINANCE`, `SUPPORT`, `VENDOR_OWNER`, `VENDOR_STAFF`, `CUSTOMER_OWNER`, `CUSTOMER_BUYER`, `CUSTOMER_APPROVER`, `CUSTOMER_FINANCE` |
| **PII encryption at the column** | PAN, Aadhaar reference, bank account number, personal mobile. `pgcrypto` or app-level AES-GCM with keys in KMS. Masked in every support-facing view (`06AAEC****1ZP`) |
| **Consent (DPDP Act 2023)** | `kyc.consent_record` — itemised, purpose-specific, with `notice_version` and `notice_language`. **Rows are never deleted**; `withdrawn_at` is itself the compliance artifact. Purposes: KYC_VERIFICATION, TRANSACTIONAL_COMMS, MARKETING, WHATSAPP_BUSINESS, CREDIT_CHECK, DATA_SHARING_LOGISTICS |
| **Data residency** | ap-south-1 only. No cross-region replication without a DPDP review |
| **Audit** | `identity.audit_log`, append-only, partitioned, every privileged action |
| **Grievance officer (CP e-Comm r.4(4)-(5))** | A real workflow: **acknowledge within 48 hours, redress within one month**, ticket number on every complaint (r.7(1)), officer name and contact displayed on every page |
| **Dark patterns (CCPA Guidelines 2023)** | No scarcity counters, no drip pricing, no confirm-shaming, no forced continuity, **no pre-ticked boxes** (r.4(9): explicit affirmative action only). Enforced in the design system, and reviewed at checkout |
| **Rate limiting** | Redis. Per IP, per user, per org. Tighter on OTP, verification APIs, and search |
| **Uploads** | Signed URL, 5 MB cap, MIME allow-list, **magic-byte validation** (not extension), EXIF strip, AV scan, served only through signed CloudFront URLs |
| **Secrets** | AWS Secrets Manager. Nothing in `.env` in the repo. Rotate the DB roles that currently ship with `CHANGE_ME_IN_PRODUCTION` |
| **Nightly integrity jobs** | `v_ledger_imbalance`, `v_stock_drift`, `v_sellability_drift` (with the COALESCE fix), `v_expiring_documents`, `v_expiring_qc`, partition runway. **Each must return zero rows; a non-zero result pages someone** |

---

## 7. Environments

| Environment | Purpose | Data | Third parties |
|---|---|---|---|
| Local | Docker Compose: Postgres, Redis, MinIO, Mailpit | Seeded synthetic | All adapters `Fake` |
| Staging | Auto-deploy on merge to `main` | Synthetic + anonymised | Delhivery staging, Razorpay test, rest `Fake` |
| Production | Deploy on tag | Real | Real. **No engineer has direct DB write access**; changes go through migrations |

---

## 8. What is deliberately deferred

Named here so the team builds *toward* them rather than against them.

| Deferred | Until | Why it is safe to defer |
|---|---|---|
| e-invoice IRN via GSP | Turnover approaches the ₹5 crore threshold, or Phase 9 | GSP onboarding is 2–3 weeks of paperwork. Invoice numbering and payload shape are built now so switching on is a config change |
| OpenSearch | ~50k SKUs or facet latency > budget | Postgres full-text handles the pilot comfortably |
| RFQ / bulk quotes | Post-pilot | Direct sales conversation covers pilot volume |
| Automated NDR buyer-contact bot | Phase 10 | Manual works below ~200 shipments/day |
| Blue Dart, DTDC, Porter | Phase 8 second half | Delhivery + in-house covers NCR |
| Vendor scorecard automation | 90 days of real data | A scorecard on 3 weeks of data is noise |
| Microservice extraction | A module needs independent scaling | See §1.1 |
| Bootable-USB automated diagnostics | After pilot | Your existing `.exe` is the Phase 4 path. A bootable agent is a 4–6 week project of its own |

---

## 9. The build sequence, at a glance

| Phase | Theme | Demonstrable outcome |
|---|---|---|
| **0** | Foundation, schema hardening, design system | `docker compose up` gives a working stack; migrations run clean; the ten schema defects are closed |
| **1** | Identity, RBAC, onboarding engine | A real vendor completes 7 steps and a real buyer completes 5; ops approves both |
| **2** | Catalog + condition image library | 200 real SKUs, with platform-owned images for every grade |
| **3** | Listings, units, serials, pricing | A vendor lists 50 units with serials in under 10 minutes |
| **4** | QC subsystem + technician app | A technician inspects, grades, seals and certifies a real machine offline; a deliberate 16 GB→8 GB mismatch corrects the grade |
| **5** | Storefront, search, anonymised offer grid | A buyer finds one model across three supply points with correct landed prices, and no vendor identity appears anywhere in the payload |
| **6** | Cart, checkout, orders, approvals | A multi-supply-point order allocates specific serials |
| **7** | **Procurement + payments + invoicing** | An order raises POs, three-way matches, accrues a payable with TDS, and issues both GST invoices with one e-way bill |
| **8** | Logistics | An order ships vendor→buyer with seal verification at pickup and OTP + POD at delivery |
| **9** | After-sale | A warranty claim and a within-window return complete end to end |
| **10** | Admin completion, hardening, launch | One real order, placed to delivered to paid, with no engineer intervening |
