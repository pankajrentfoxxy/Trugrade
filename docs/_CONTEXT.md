# SHARED CONTEXT — Gorefurbo B2B Platform (read before writing anything)

## The business

India-based B2B platform for **refurbished laptops**, extensible to other refurbished IT products and spare parts.
Legal entity: **TrueTech Services Pvt. Ltd.** Operating brand: **Trugrade** (decided 26 Aug 2026 — supersedes "gorefurbo"). QC product: **DeviceSure**. Group: RentFoxxy.
Pilot: Delhi NCR. Target: all-India.

**Read `08_BRAND_SYSTEM.md` before writing any UI.** It supersedes the design-token section at the end of this file and Part 1 of `03_UX_SPEC.md`: new palette ("Anodised" — graphite, calibration paper, one signal blue meaning *measured*), new typefaces (Instrument Sans / IBM Plex Sans / IBM Plex Mono), flatter radii, and a new signature component, the **tolerance band**. The brand is a single token in `packages/config` — never hard-code a brand string in a component.

## THE MODEL — this is the single most important fact

**The platform is the PRINCIPAL / MERCHANT OF RECORD, operating BACK-TO-BACK. It is NOT a marketplace facilitator, and it NEVER holds stock.**

Say both halves of that out loud, because they are easy to confuse:
- **We never buy inventory.** No stock, no warehouse, no capital tied up in laptops. Nothing is purchased until a customer has committed to buy it.
- **We are still the seller.** At the instant a customer orders, we buy that specific serial from the vendor and sell it to the customer on our own invoice. The goods go vendor → customer directly and never touch us.

Flow:
1. Vendor (supplier) onboards and lists units against the platform's master catalog with a **declared grade**, an **expected net payout price**, and the **warranty they are willing to stand behind** (e.g. 3 months). Vendors upload **no photographs** — the platform owns a condition-image library and uses its own images per grade/condition.
2. Platform's QC runs **at the vendor's premises** (QC-at-source) using the platform's own QC platform. Units that FAIL are never listed.
3. Passed units are **sealed** with a numbered tamper-evident seal, photographed, graded, and given a 90-day-valid QC report **carrying a QR code that resolves to the public verification page for that serial**.
4. Platform sets the **selling price** = vendor's asking price + platform charge. **Buyers never see the vendor's price, only ours.**
5. **The same model is offered by many vendors at once.** A Dell Latitude 5320 may be listed by ten vendors at ten prices. The customer compares them on one screen — **our price, that vendor's average QC score for this model, that vendor's grade accuracy, warranty, dispatch speed and city** — and picks the offer they want. The vendor choice is the customer's; the contract is with us.
6. Customer buys **from the platform**. Platform issues the tax invoice (Invoice-2) to the customer.
7. Platform raises a **Purchase Order to the chosen vendor** *inside the order-confirmation transaction*; vendor invoices the platform (Invoice-1).
8. Goods move **vendor → customer directly** (drop-ship) under **GST Bill-To-Ship-To**, s.10(1)(b) IGST Act. **One e-way bill, Case 2** — the platform generates it, Dispatch-From = vendor address, so the vendor's price never travels with the goods.
9. Platform pays the vendor the agreed amount after delivery + the inspection window closes.
10. **The platform warrants the machine for longer than the vendor does.** Vendor offers 3 months; we sell 6. We are the sole warrantor to the customer for the whole term and recover the vendor's portion internally. See "Warranty stacking" below.

### What this model buys us
- **Vendor anonymity is lawful and native.** Consumer Protection (E-Commerce) Rules 2020 **Rule 5(3)(a)** (mandatory pre-purchase seller name/address/phone) applies only to a *marketplace* e-commerce entity. As an **inventory e-commerce entity** we are governed by **Rule 4 + Rule 7**, which contain no supplier-disclosure duty. There is no third-party seller to disclose — we are the seller. Buyers see **"Supply Point A · Gurugram"**, which is a *dispatch location*, not a concealed legal seller.
- **No GST TCS u/s 52, no GSTR-8, no TCS credit reconciliation** — s.52 covers supplies made "through it by other suppliers"; own-account supply is out of scope (CBIC e-commerce FAQ Q24/Q25).
- **No TDS u/s 194-O / s.393(1) Sl.8(v)** on us as an ECO.
- **No RBI Payment Aggregator problem.** We collect our own receivables and pay our own trade payables. There is no third-party settlement, so no PA licence question, no escrow mandate, no Razorpay-Route dependency.

### What this model costs us — build for these
- **Rule 7(4): take-back and refund are non-delegable.** Defective, deficient, spurious, not-as-described, or late = our obligation, directly. Force majeure is the only out on lateness.
- **Rule 7(5): authenticity liability.** "QC-tested and sealed by us" is explicit vouching. Our core marketing claim is our principal liability trigger. Grades must be objectively defined and tested to.
- **No intermediary safe harbour.** We author every listing. All misleading-advertisement exposure (CPA 2019 + CCPA Misleading Advertisements Guidelines 2022) sits on us.
- **CCPA Dark Patterns Guidelines 2023** apply — no scarcity counters, drip pricing, confirm-shaming, forced continuity. Review checkout.
- **Product-seller liability** under CPA 2019 s.86.
- **TDS on our purchases**: s.393(1) Table Sl. No. 8(ii) (formerly s.194Q) — 0.1% above ₹50 lakh per vendor per year, if our turnover > ₹10 crore in the preceding year. 5% if the vendor has no PAN. Deduct at credit or payment, whichever is earlier, on value excluding GST. Form 26Q, section code 1031.
- **s.206C(1H) seller TCS is OMITTED from 1 Apr 2025.** Do not build it. Also omitted: s.206AB / s.206CCA non-filer checks.
- **FDI**: inventory-model e-commerce is barred from FDI, but the bar is drafted against B2C retail; genuine B2B is the cash-and-carry wholesale route (100% automatic, with a 25% cap on sales to group companies). Structural reading — needs counsel before any term sheet.
- **GST fixed-establishment risk** from QC-at-vendor-premises in other states. Mitigate: use the vendor's people and space under a services contract with our protocol + sampled supervision; no dedicated leased space; rotating, non-exclusive engagements. Needs CA sign-off before multi-state scale.

### Dual GST valuation channels — build both, never mix on one invoice
| Channel | Vendor | ITC | Output GST | Flag |
|---|---|---|---|---|
| REGULAR | GST-registered vendor, we claim ITC | Yes | 18% on full value | `valuation_method = 'REGULAR'` |
| MARGIN | Unregistered vendor / individual | No | 18% on (sale − purchase), Rule 32(5) CGST | `valuation_method = 'MARGIN'` |

`valuation_method` is set **per unit at purchase**, is **immutable**, and requires per-serial purchase price. Margin-scheme purchases must be blocked from the ITC ledger and reconciled monthly against GSTR-2B. Invoice narration for MARGIN: *"Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase."* In B2B the margin scheme usually gives the buyer thinner ITC — treat MARGIN as a distinct SKU pool with its own pricing.

## Confirmed technology stack

| Layer | Choice |
|---|---|
| Backend | **NestJS 10 + TypeScript**, modular monolith with enforced module seams |
| Database | **PostgreSQL 16**, schema-per-module (12 schemas) |
| ORM | **Prisma** (multiSchema preview feature) |
| Cache / locks / queue | **Redis 7** + **BullMQ** |
| Frontend | **TypeScript + Tailwind + shadcn/ui**, in a **Turborepo** |
| Frontend apps | `apps/storefront` — **Next.js 15 App Router**, public + customer portal, SSR/ISR for SEO · `apps/console` — **Vite + React + React Router**, vendor portal + admin portal in one role-routed app, no SEO so no SSR. *(Console revised 26 Aug 2026 to match DeviceSure's existing `apps/web`, which the team has already built.)* |
| Mobile | **Expo / React Native** — Technician (QC) app + Rider app. *(Changed from the earlier Flutter plan because the team knows React.)* |
| QC desktop tool | Client's existing **QC .exe** — integrated via a signed JSON report contract + ingestion API |
| Files | **S3 (ap-south-1) + CloudFront**, signed URLs only, magic-byte validation, EXIF strip |
| Auth | JWT access 15 min + rotating refresh in httpOnly cookie; server-side session in Redis; TOTP MFA mandatory for admin and vendor-owner roles |
| Search | Postgres `tsvector` + GIN + faceted filters. OpenSearch deferred. |
| Payments | Razorpay (cards/UPI/netbanking) · Razorpay Smart Collect virtual accounts with TPV for NEFT/RTGS · cheque + PDC module · internal credit terms |
| Logistics | Adapter layer: **Delhivery (anchor, real sandbox)**, Blue Dart, DTDC, Shiprocket (aggregator fallback), Porter (intra-city 2-wheeler only), In-house fleet |
| Infra | AWS **ap-south-1**, Docker, ECS Fargate (single EC2 acceptable at pilot), RDS Postgres, ElastiCache Redis |
| CI/CD | GitHub Actions → staging on merge to `main`, production on tag |
| Observability | Sentry + OpenTelemetry + CloudWatch |
| Testing | Jest (unit) · Supertest (integration) · Testcontainers (DB) · Playwright (E2E) · k6 (load) · Pact-style contract tests for carrier/payment adapters |

## Module map (NestJS module ↔ Postgres schema)

| Module | Schema | Owns |
|---|---|---|
| `identity` | `identity` | organizations, users, roles, permissions, sessions, OTP, addresses, contacts, audit log, pincode master |
| `kyc` | `kyc` | registration leads, onboarding progress, GST/PAN/bank records, documents, verification checks, reviews, blacklist, agreements, consents, tax declarations |
| `customer` | `customer` | buyer profiles, preferences, approval policies, credit applications, saved searches |
| `vendor` | `vendor` | vendor profiles, capability, facilities, hours, certifications, payout preferences, sourcing declarations |
| `catalog` | `catalog` | brand → series → model → SKU, **condition image library**, SKU requests, change log |
| `listing` | `listing` | listings, units (serials), tier prices, stock movements, price history, grade corrections |
| `qc` | `qc` | tool providers, technicians, availability, visits, visit units, tool runs, reports, area results, hardware detected, photos, seals, mismatches, re-verifications, sampling rules, wipe certificates, audit rechecks |
| `ordering` | `ordering` | cart, order, order approval, sub-order, order line, order line unit, order events, RFQ |
| **`procurement`** | **`procurement`** | **NEW for MoR:** purchase orders, PO lines, vendor invoices, goods receipts, vendor payables, payout runs, margin rules, price books |
| `payment` | `payment` | customer invoices, invoice lines, e-way bills, payments, refunds, ledger entries, settlements, penalties, credit notes |
| `logistics` | `logistics` | hubs, carriers, serviceability, riders, vehicles, shipments, shipment units, tracking, pickup/delivery tasks, routing rules, rate cards, route plans, route stops, delivery attempts, custody events |
| `platform` | `platform` | returns, warranty, warranty claims, tickets, disputes, vendor scorecards, reviews, config, feature flags, notification templates/log, integration log, data-subject requests |

**Boundary rules (enforced by an ESLint rule in CI, not by convention):**
1. A module may only read another module's data through that module's public service interface. **No cross-schema JOINs.**
2. Cross-module communication uses a typed in-process event bus with the names a queue would use later: `order.confirmed`, `qc.report.completed`, `vendor.verified`, `po.raised`, `payment.captured`.
3. Every module exposes an explicit service interface — that interface is the future network contract.

## The three flows that must be one database transaction

1. **Order confirmation** — validate cart → check `qty_available` under a Redis lock → decrement stock → create `order` + `sub_order` + `order_line` → allocate specific `unit` rows into `order_line_unit` → set units `RESERVED` → **raise `purchase_order` to each vendor** → write `order_event` → emit `order.confirmed`. All or nothing.
2. **QC verdict** — write `qc_report` + area results + hardware detected + photos → compute verdict against `qc_tolerance_rule` → update `unit.status`, `grade_actual`, `is_sellable` → on mismatch create `grade_correction` and notify vendor → apply seal → emit `qc.report.completed`.
3. **Vendor payout run** — for each eligible PO: gross → TDS (0.1%) → penalties → adjustments → net → write balanced `ledger_entry` pairs → create `payout` → mark run executed. Batch-sums-to-zero assertion inside the same transaction.

## Existing assets in the client's folder (reuse, do not rebuild)

- `truetech_complete_schema.sql` — 109 tables across 11 schemas, PostgreSQL 15+
- `truetech_schema_migration_v3_qc_at_source.sql` — 17 tables, QC-at-source model, routing rules, seals
- `Gorefurbo_Schema_Design_Annotated.md` — annotated design doc, 61 core tables
- `TrueTech_Schema_Addendum_Customer_Vendor.md` — vendor 7-step + buyer 5-step onboarding, 23 tables
- HTML prototypes: `home_1.html`, `New_plan/index.html`, `customer-login/register.html`, `seller-login/register.html`, `screens.html`
- Journey blueprints: `truetech-onboarding-journey.html`, `truetech-operations-journeys.html`

### Known schema gaps that MUST be fixed
1. **Partition runway expires 2026-10-01** (`order_event`, `shipment_tracking`, `notification_log`, `integration_log`) and 2026-11-01 (`audit_log`). No DEFAULT partition, no auto-creation job. Inserts will start failing. **Highest severity.**
2. **Zero triggers, zero functions.** Every invariant the schema asserts in prose is application-enforced: `is_sellable`, `qc_report.valid_until`, `is_current`, visit counters, listing `qty_*`, all `updated_at`, ledger balance, status-transition legality.
3. `listing.v_sellability_drift` silently misses seal-less units — needs `COALESCE(s.status IN ('APPLIED','INTACT'), FALSE)`.
4. `platform_config.key` has no UNIQUE constraint.
5. Free-text status columns with no CHECK on the after-sale and money tables: `delivery_task.status`, `eway_bill.status`, `refund.status`, `payout.status`, `return_request.status`, `ticket.status`, `warranty_claim.status`, `dispute.status`, `data_subject_request.status`.
6. `routing_rule.carrier_code` is TEXT, not an FK to `carrier(code)`.
7. `carrier_rate_card` has no overlap-exclusion constraint (unlike `listing_tier_price`, which does).
8. `qc_sampling_rule` has no unique constraint on `(vendor_tier, effective_from)`.
9. Two QC models coexist (hub-batch and vendor-site) with nothing marking which is canonical. **Vendor-site is canonical.** Deprecate `qc_batch`.
10. `tt_app` / `tt_readonly` roles ship with password `CHANGE_ME_IN_PRODUCTION`.

### Design system — three incompatible token sets exist; consolidate to ONE
**Canonical = the "New_plan" set:**
- Brand: navy `#191F2E`, navy-2 `#232B3D`, navy-3 `#2E374C`, cyan `#17AFC5`, cyan-dk `#0E8DA0`, cyan-wash `#E6F7FA`, orange `#FE9D00`, orange-dk `#D97F00`, orange-wash `#FFF4E2`, grey `#5B5B5B`
- Neutrals: paper `#F4F6F8`, surface `#FFFFFF`, rule `#E2E7EC`, rule-2 `#EEF1F4`, ink `#1B2333`, muted `#697586`, muted-2 `#94A1B2`
- Semantic: good `#12945F` / wash `#E6F5EE`, warn `#E08B3C` / `#FDF2E3`, bad `#D24A3A` / `#FCEDEB`
- Radii: xs 6 · sm 10 · base 14 · lg 20 · xl 28
- Shadows: sh-1 `0 1px 2px rgba(25,31,46,.05), 0 2px 6px rgba(25,31,46,.05)` · sh-2 `0 2px 6px rgba(25,31,46,.06), 0 10px 28px rgba(25,31,46,.08)` · sh-3 `0 20px 50px rgba(25,31,46,.16)` · sh-cta `0 4px 14px rgba(254,157,0,.32)`
- Type: display **Poppins**, body **Inter**, mono **JetBrains Mono**; container max-width 1240px
- **Orange is reserved for the primary action.** Nothing else uses it.
- Logo: tri-arc ring (cyan / orange / grey), reused as the QC score ring and the grade badge. "One shape, used twice."
- **A spacing scale is missing everywhere — define one:** 2·4·8·12·16·20·24·32·40·48·64·80.
- Discard the `home_1.html` dark "Midnight Lab" tokens and the teal/Archivo journey-blueprint tokens.

## Grades
`A_PLUS` (near-new) · `A` (excellent) · `B` (good, visible use). **Nothing worse than B is sold.** Grades must be objectively defined against measurable QC outputs (cosmetic area scores, battery health %, cycle count) — this is a liability control under Rule 7(5), not marketing copy.

## Vendor anonymity display rule
Buyers see **"Supply Point A · Gurugram"**, **"Supply Point B · Noida"** — a dispatch location and city, plus the comparison metrics below. Never a vendor legal name, address, GSTIN, or contact. Admin sees everything. This is a **display-layer rule enforced by a DTO whitelist in the API**, never by hiding fields in the frontend.

**One deliberate change from the earlier draft:** buyers now *do* see quality metrics per supply point, because choosing between supply points is the whole point of the comparison grid. What stays hidden is *identity*, not *performance*. A number that describes how well a supply point's machines test is not a route back to who they are.

## Supply-point comparison — the core buying screen

One SKU, one grade, many vendors. The customer picks a vendor on evidence, not on a name they wouldn't recognise anyway.

| Column | Source | Note |
|---|---|---|
| Supply point · city | `unit.supply_point_code` + `org_address.city` | `Supply Point A · Gurugram` |
| **Our landed price** | pricing engine + freight + GST | Vendor's ask + our charge. One figure, break-up one click away |
| **Avg QC score, this model** | mean `unit.qc_score` for that vendor × this SKU | The headline quality number |
| **Grade accuracy** | 1 − (corrections ÷ units inspected) for that vendor | How often their declared grade survived our inspection |
| Battery health range | min–max `unit.battery_health_pct` | e.g. 88–94% |
| **Total warranty** | `vendor_warranty_months` + platform top-up | Always shows the *total* the customer gets, never the split |
| Units available | sellable units only | |
| Inspection date · expires | `qc_report` | Flag anything expiring within 14 days |
| Dispatch | vendor lead time | "ships in 24 h" |

**Sort default:** landed price ascending, tie-broken by average QC score, then by a stable hash of the unit ID. Never by vendor ID or creation order — that leaks identity through ordering.

**The aggregates are computed, cached and versioned**, not calculated live in the grid query. See the 500 ms budget.

**Small-sample honesty.** A vendor with 3 inspected units of a model does not get a headline average — show `New supplier · 3 units inspected` instead of a number that looks authoritative. Threshold in `platform_config`, suggest 10 units. Publishing a 100% grade-accuracy score computed on two machines is the kind of claim the CCPA Misleading Advertisements Guidelines 2022 exist for.

## Warranty stacking

The vendor stands behind the machine for one term; **we sell a longer one.** Vendor says 3 months, we sell 6.

- **We are the sole warrantor to the customer for the entire term.** The customer never learns there was a split, never chases a vendor, and never waits on our recovery. This is the trust play and it only works if it is seamless.
- Internally the term is two layers: `VENDOR_BACKED` months and `PLATFORM_BACKED` months, both stored on `platform.warranty`, both invisible to the buyer.
- A claim inside the vendor-backed window creates a **recovery** against that vendor's payable — asynchronously. **We refund or repair the customer first, always.**
- The platform top-up is a **cost that must be priced**. A per-unit warranty reserve, funded from margin, accrued at sale and released on expiry, by grade band. Claim rates differ sharply between A+ and B.
- The vendor's offered term is captured at listing time (`listing.vendor_warranty_months`) and is a **pricing input** — a vendor offering 6 months costs us less to top up than one offering 1, and the margin rule should reflect that.
- **Never display the split.** The grid, the product page, the invoice and the certificate all say one number: the total the customer gets.

## The QC platform and the QR-coded report

The client is building a full QC platform of his own, producing a QC report with a **QR code**. Treat this as the canonical inspection tool.

- The QR code resolves to `/qc/verify/:verification_code` — the public per-serial verification page. `qc_report.verification_code` already exists and is `UNIQUE`.
- That page must be readable by someone standing next to the machine with a phone, and must work for a person who has no account.
- Its content is the **unit passport**: model, serial, grade, score, inspection date and validity, detected hardware, area-by-area results, the technician's photographs, the seal code and status, and the wipe certificate.
- The report is also printed and shipped with the machine, so the buyer's receiving staff can scan and verify before signing.
- **The full report format, signing method and integration contract are still to come from the client.** `02_ARCHITECTURE.md` §5.3 proposes a contract; when the real one arrives, change the contract and `qc_tool_provider.field_map_json`, never the tool.
