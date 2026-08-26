# 04 — TEST PLAN & VALIDATION CONTRACT
## gorefurbo (TrueTech Services Pvt. Ltd.) — B2B refurbished laptop platform

**Status:** authoritative QA contract. Nothing ships that is not covered here.
**Scope:** NestJS 10 modular monolith (12 modules / 12 Postgres schemas), Next.js 15 `apps/storefront` + `apps/console`, Expo Technician and Rider apps, the QC `.exe` ingestion contract, and every external adapter.
**Governing fact:** the platform is the **principal / merchant of record**, not a marketplace facilitator. Every test below assumes that. Tests that would only make sense for a facilitator (TCS u/s 52, GSTR-8, seller-disclosure under Rule 5(3)(a), PA/escrow settlement) are **out of scope by design** and are listed in §1.6 so that nobody re-adds them.

**ID conventions**
| Prefix | Meaning |
|---|---|
| `VR-nnn` | Validation rule (Part 2) |
| `IDN / KYC / CUS / VEN / CAT / LST / QC / ORD / PRC / PAY / LOG / PLT -nnn` | Module test case (Part 3) |
| `PERF-nn` `SEC-nn` `A11Y-nn` `DATA-nn` | Non-functional (Part 4) |
| `UAT-x-nn` | UAT script step (Part 5) |
| `GATE-Pn-nn` | Release gate assertion (Part 6) |

Priorities: **P0** blocks release (money, stock, tax, anonymity, safety-of-data). **P1** blocks the phase. **P2** tracked, may ship with a known-issue note.

---

# PART 1 — TEST STRATEGY

## 1.1 The pyramid

| L | Layer | Tooling | What lives here | Target volume | Max wall-clock | Runs on |
|---|---|---|---|---|---|---|
| L0 | Static | `tsc --strict`, ESLint (incl. custom `no-cross-module-import` + `no-cross-schema-join` rules), Prisma `validate`, `sqlfluff`, `depcruise` | Module seam enforcement, type safety, dead imports, raw-SQL cross-schema JOIN detection | n/a | 90 s | every push |
| L1 | Unit | **Jest 29** + `ts-jest`, no I/O, no DB, no clock | Pure domain logic: grade computation, tolerance rules, tax split, TDS, margin-scheme valuation, rounding, price guard rails, state-machine transition tables, validators/regexes, DTO whitelists, NDR action legality, rate-card selection, retry/backoff maths | ~2,400 cases | 120 s | every push |
| L2 | Integration | **Supertest** + **Testcontainers** (Postgres 16, Redis 7), real Prisma, real BullMQ in-process worker | Module service interfaces, HTTP controllers with real auth guards, transactions, DB constraints/indexes, partial unique indexes, ledger balance, Redis locks, event-bus fan-out, migrations up+down | ~1,100 cases | 12 min | every push |
| L3 | Contract | Pact-style consumer contracts + **recorded fixture replay** (`nock` / WireMock-style JSON cassettes) | Every external adapter: Delhivery, Blue Dart, DTDC, Shiprocket, Porter, Razorpay, Razorpay Smart Collect, GSTIN lookup, PAN lookup, penny-drop, e-way bill/IRP, DLT SMS, email | ~260 cases | 4 min | every push + nightly against real sandboxes |
| L4 | E2E | **Playwright** (storefront, console — Chromium + WebKit, desktop + mobile viewport); **Maestro** flows for the Expo Technician and Rider apps | Whole journeys across modules and apps, seeded DB per worker, real Postgres/Redis, all external adapters on mocks | ~180 web + ~40 mobile | 25 min | PR (smoke subset ~35), full on merge to `main` |
| L5 | Load / soak | **k6** | Throughput and latency targets, lock contention, connection-pool behaviour, 4-hour soak | 9 scenarios | 45 min | nightly + pre-tag |

**Ratio target** across L1/L2/L4 ≈ **70 / 25 / 5**. A ratio drifting past 60/30/10 for two consecutive weeks is a build-health defect, not a preference.

**Rules of placement**
1. If it can be decided with data in memory, it is L1. No exceptions for "it feels integration-y".
2. If the assertion is *about a database guarantee* (constraint, index, isolation level, transaction atomicity), it must be L2 — proving it in the service layer only is explicitly insufficient (see LST-014, LST-015, ORD-021).
3. If the assertion is about an external wire format, it is L3 and must run against a **recorded fixture captured from the real sandbox**, checked into `test/fixtures/carriers/<carrier>/<endpoint>.<case>.json` with a capture date. Hand-written fixtures are not permitted for a provider we have sandbox access to.
4. L4 exists to prove the seams hold end-to-end, not to re-test rules. An E2E test that asserts a regex is a misplaced test.

## 1.2 Coverage gates

| Scope | Lines | Branches | Functions | Enforcement |
|---|---|---|---|---|
| Global (`apps/api/src`) | 85% | 80% | 85% | `jest --coverage` threshold, PR-blocking |
| `payment/**`, `procurement/**` (money, tax, TDS, ledger) | **95%** | **95%** | 100% | PR-blocking |
| `qc/**` (grading, tolerance, verdict, seal) | **95%** | 92% | 100% | PR-blocking |
| `listing/**` stock arithmetic, `ordering/**` confirmation transaction | **95%** | 92% | 100% | PR-blocking |
| DTO whitelist / serializer layer (`**/dto/**`, `**/serializers/**`) | **100%** | 100% | 100% | PR-blocking — anonymity is a legal control |
| `identity/**` guards, policies, RBAC | 92% | 90% | 95% | PR-blocking |
| `logistics/**` adapters | 88% | 85% | 90% | PR-blocking |
| `catalog/**`, `customer/**`, `vendor/**`, `kyc/**`, `platform/**` | 85% | 80% | 85% | PR-blocking |
| Next.js `apps/*` components | 70% | 65% | 70% | warn only; E2E carries the weight |
| Expo apps | 70% | 65% | 70% | warn only; Maestro carries the weight |

**Mutation testing** — Stryker runs weekly on `payment`, `procurement`, `qc/grading`, `listing/stock`. Gate: **mutation score ≥ 60%**, no surviving mutant in tax split, TDS, ledger balance or grade computation. A surviving mutant there is a P0 test-quality defect.

**Migration coverage** — every migration must have at least one L2 test that runs `up`, asserts the constraint/index it claims to add actually rejects bad data, and runs `down`. Migrations without such a test fail CI.

## 1.3 What is deliberately NOT automated, and why

| Not automated | Why | Compensating control |
|---|---|---|
| Live calls to carrier **production** APIs | Real money, real pickups, wallet debits, unrepeatable | L3 fixture replay in CI + a **nightly sandbox conformance job** (non-blocking, alerts on drift) that re-captures fixtures and diffs them |
| Live NIC **e-way bill / IRP production** endpoints | Legally-registered documents; a test EWB is a real EWB | Sandbox in nightly job; production path exercised once per release in a manual smoke with a same-day cancellation, recorded in the release log |
| Real **Razorpay** card/UPI collect on production keys | Money movement, PCI surface | Sandbox in L3; production verified by a ₹1 live transaction + refund at release, signed off by Finance |
| **DLT-registered SMS and WhatsApp delivery** | Telecom carrier is outside our control; template approval is a manual regulatory workflow | Adapter contract tested; delivery receipts monitored in `platform.notification_log` with an alert on <95% 24h delivery |
| Physical **tamper-evident seal** integrity | Physical property of an adhesive | Process control: seal roll serial ranges issued per technician, reconciled monthly; software tests cover only the *lifecycle states* |
| The **QC `.exe`** internals | Third-party binary owned by the client; we do not own its source | We test the **signed JSON report contract** exhaustively (QC-001…QC-020), including malformed, replayed, and adversarial payloads, and pin the report `schema_version` |
| **Print fidelity** of tax invoice / PO / e-way bill PDFs | Pixel rendering across printers | Golden-PDF text-extraction assertions in L2 (all mandatory fields present, MARGIN narration present, vendor price absent) + one manual visual check per release |
| Screen-reader **semantic quality** | axe cannot judge whether a label is *meaningful* | Manual NVDA + VoiceOver checklist, Part 4 §4.4 |
| **Visual regression** of the full design system | High flake cost at pilot scale | Deferred to Phase 9; token-level unit tests assert the canonical "New_plan" palette values are the only ones referenced |
| FDI / GST fixed-establishment / margin-scheme **legal positions** | Legal opinions, not code | Counsel + CA sign-off gates in Part 6 (GATE-P6-05, GATE-P10-07) |
| Actual **credit decisioning judgement** | Human underwriting | We test the *workflow and limits*, not the decision |

## 1.4 Test data strategy

### 1.4.1 Layers of data

| Mechanism | Used at | Contents | Determinism |
|---|---|---|---|
| **Reference seed** (`prisma/seed/reference.ts`) | L2, L4, load, UAT | Pincode master (Delhi NCR full + 200 sampled all-India), state codes, HSN 8471, GST rate table, brands/series/models/SKUs (~120 SKUs), condition image library, roles/permissions matrix, `platform_config`, notification templates, `qc_tolerance_rule`, `qc_sampling_rule`, carrier + rate cards, routing rules | Fixed, versioned, hash-asserted |
| **Persona seed** (`prisma/seed/personas.ts`) | L2, L4, load, UAT | The personas in §1.4.2 | Fixed IDs (UUIDv5 from a namespace + slug), so tests can reference `V_ALPHA_ID` as a constant |
| **Factories** (`test/factories/*.ts`) | L1, L2 | `makeVendor()`, `makeUnit()`, `makeListing()`, `makeOrder()`, `makeQcReport()`, `makeLedgerPair()`, `makeShipment()` — each takes a deep partial override and produces a valid aggregate by default | Seeded PRNG, `seed = 1337` per worker, printed on failure |
| **Cassettes** (`test/fixtures/**`) | L3 | Recorded external responses with capture date + provider API version | Byte-exact replay |
| **Clock** | all | `@nestjs/testing` clock provider; **no test may call `Date.now()` directly**. Time travel via `clock.advanceTo()` — mandatory for the 90-day QC expiry, 2-day grade auto-apply, 240h Shiprocket token, resend cooldowns, partition runway | Deterministic |

Every L2 test runs inside a transaction that is rolled back, **except** tests that assert on transaction behaviour itself (isolation, deadlock, partial rollback), which get a dedicated database per worker via Testcontainers.

### 1.4.2 Synthetic personas

**Vendors**
| ID | Name (internal only) | City / state | GST | Valuation | Tier | Purpose |
|---|---|---|---|---|---|---|
| `V_ALPHA` | Alpha Systems Pvt Ltd | Gurugram, Haryana (06) | Registered, valid GSTIN | REGULAR | GOLD | Happy path; displayed to buyers as **"Supply Point A · Gurugram"** |
| `V_BETA` | Beta Infotech LLP | Noida, Uttar Pradesh (09) | Registered | REGULAR | SILVER | Second vendor — every IDOR/anonymity test pairs A against B; **"Supply Point B · Noida"** |
| `V_GAMMA` | (individual proprietor, no entity) | Faridabad, Haryana (06) | **Unregistered** | **MARGIN** | BRONZE | Rule 32(5) margin scheme, **no PAN** → 5% TDS path |
| `V_DELTA` | Delta Traders | Delhi (07) | Registered, GSTIN **cancelled** | REGULAR | — | Blacklist, cancelled-GSTIN, suspension paths |
| `V_EPSILON` | Epsilon Refurb | Ghaziabad, UP (09) | Registered | REGULAR | — | Stuck mid-onboarding at step 4, `NEEDS_FIX`, draft resume |
| `V_ZETA` | Zeta Systems | Bengaluru, Karnataka (29) | Registered | REGULAR | SILVER | Cross-state IGST + out-of-NCR routing + fixed-establishment scenarios |
| `V_OMEGA` | Omega Bulk | Gurugram, Haryana (06) | Registered | REGULAR | GOLD | Load testing: 5,000 units, 50 concurrent serial uploads |

**Buyers (customer organizations)**
| ID | Org | Bill-To state | Ship-To state | Terms | Purpose |
|---|---|---|---|---|---|
| `B_ORG1` | Nimbus Solutions Pvt Ltd | Delhi (07) | Delhi | Prepaid | Happy path |
| `B_ORG2` | Cobalt Enterprises Ltd | Haryana (06) | Haryana | Credit ₹5,00,000, 30 days, 2-step approval | Credit limit, approval policy, PO-required buyer |
| `B_ORG3` | Harit Industries | Haryana (06) | Haryana | Prepaid | **Intra-state → CGST+SGST** (vendor V_ALPHA also Haryana) |
| `B_ORG4` | Meridian Technologies | Maharashtra (27) | Karnataka (29) | Credit ₹20,00,000 | **Bill-To ≠ Ship-To**, three-state IGST case |
| `B_ORG5` | Vector Labs | Delhi (07) | Delhi | Suspended | Blocked-buyer paths |
| `B_ORG6` | Sunrise Retail LLP | Tamil Nadu (33) | Tamil Nadu (33) | Prepaid | Long-haul logistics, non-serviceable pincode variants |

**Technicians / operations / riders**
| ID | Role | Purpose |
|---|---|---|
| `T_ONE` | Technician, NCR, certified | Happy-path visits |
| `T_TWO` | Technician, certification **expired** | Blocked-assignment path |
| `T_THREE` | Technician, **auditor** flag | 5% audit recheck, divergence |
| `T_FOUR` | Technician, Bengaluru | Geo-variance and multi-region |
| `OPS_ONE` | Ops executive | Approvals, NDR, exceptions |
| `FIN_ONE` | Finance | Payout runs, credit notes, TDS |
| `ADMIN_ONE` | Platform admin (TOTP enrolled) | Full visibility |
| `RO_ONE` | Read-only analyst | Negative-write matrix |
| `RIDER_ONE` | In-house rider, Delhi NCR | Rider app, custody, OTP delivery |
| `SUPPORT_ONE` | Support agent | Tickets, disputes, no money powers |

### 1.4.3 External-integration fakes

**Rule: every external integration sits behind a NestJS provider interface with a mock implementation from day one.** The mock is written in the same PR as the interface; a real implementation may not merge before its mock exists. Selection is by `INTEGRATION_MODE=mock|fixture|sandbox|live` per adapter, defaulting to `mock`. `live` is impossible in CI — the config loader throws if `NODE_ENV !== 'production'`.

| Integration | Interface | Mock behaviour | Deterministic triggers (input → outcome) |
|---|---|---|---|
| **GSTIN verification** | `GstinVerificationPort` | Returns a synthetic taxpayer record | GSTIN ending `…Z1` → ACTIVE + name match; `…Z2` → ACTIVE + **name mismatch**; `…Z3` → **CANCELLED**; `…Z4` → not found (`FAIL`); `…Z9` → HTTP 503 (`PROVIDER_ERROR`); `…Z8` → timeout after 30 s |
| **PAN verification** | `PanVerificationPort` | Synthetic name/status | 4th char `C` → company, `P` → individual; `AAAPZ0000Z` → INVALID; `AAAPZ9999Z` → provider 500 |
| **Bank penny-drop** | `BankVerificationPort` | Returns beneficiary name + ₹1 credit ref | Account ending `0000` → name **exact match**; `0001` → **fuzzy match 0.82** (needs review); `0002` → name mismatch → FAIL; `0009` → provider error; `0008` → account closed |
| **Razorpay payments** | `PaymentGatewayPort` | Order/payment/refund lifecycle + signed webhooks | Amount `₹1.11` → failure; `₹2.22` → pending→captured after 5 s; `₹3.33` → captured then **late webhook duplicate**; `₹4.44` → signature-invalid webhook; refunds mirror the same suffix rules |
| **Razorpay Smart Collect (VA + TPV)** | `VirtualAccountPort` | Allocates a VA number, emits NEFT/RTGS credit events | Credit with **unmatched UTR** → unallocated bucket; credit from **non-TPV account** → rejected; partial credit → part-payment path |
| **e-Way bill / IRP** | `EwayBillPort` | Returns EBN + validity + Part-B updates | Distance >1,000 km → multi-day validity; invalid pincode pair → error code `325`; cancel-after-24h → refusal |
| **Delhivery** | `CarrierPort` (`delhivery`) | Form-encoded `format=json&data=` echo | See LOG-030…LOG-045 |
| **Blue Dart** | `CarrierPort` (`bluedart`) | JWT issue/expire | Token TTL configurable; forced 401 on demand |
| **DTDC** | `CarrierPort` (`dtdc`) | Basic happy/reject | |
| **Shiprocket** | `CarrierPort` (`shiprocket`) | 240 h token, 429 with `Retry-After` | |
| **Porter** | `CarrierPort` (`porter`) | 1 req/min tracking budget, webhooks incl. `order_reopened` | |
| **S3 / CloudFront** | `ObjectStorePort` | In-memory store + signed-URL stub | Object key `poison/*` → returns a file whose magic bytes contradict its MIME |
| **SMS (DLT) / Email / WhatsApp** | `NotificationPort` | Captures to an in-memory outbox assertable as `outbox.last('OTP')` | Mobile ending `99` → permanent failure; `98` → delayed 60 s |
| **QC `.exe` ingestion** | inbound, not a port | Fixture report generator with a **valid Ed25519 signature** and a knob for every adversarial case | see QC-001…QC-020 |
| **Clock / calendar** | `ClockPort` | Controllable | Holidays and cut-offs seeded |

Every mock must additionally support **injected fault modes** — `latency(ms)`, `http(status)`, `malformed()`, `disconnect()` — so that `PROVIDER_ERROR` handling is testable everywhere (see KYC-030…KYC-036).

## 1.5 CI gating rules

**Pipeline on every PR** (GitHub Actions, all required):
1. `lint` — ESLint incl. module-boundary rule, Prettier check, `tsc --strict --noEmit`. **Any cross-module import or cross-schema JOIN fails the build.**
2. `unit` — Jest L1 with coverage thresholds.
3. `integration` — L2 with Testcontainers, sharded 4×.
4. `contract` — L3 fixture replay.
5. `e2e-smoke` — Playwright tagged `@smoke` (~35 cases) + Maestro `@smoke`.
6. `db` — migrations up/down on a clean Postgres 16, then `prisma migrate diff` must be empty against the schema; **the four drift views must return zero rows against the seeded database**.
7. `security` — `npm audit --audit-level=high`, `gitleaks`, `semgrep` (OWASP + custom rule: no `PrismaClient.$queryRawUnsafe` outside an allow-list; no `select: undefined` on a customer-facing serializer).
8. `a11y` — axe-core on 12 key storefront/console routes; zero **critical** or **serious** violations.

**Merge to `main`** additionally runs full E2E, full Maestro, and deploys to staging. **Tag** additionally runs k6 (all scenarios must meet targets), the nightly sandbox conformance suite, and the release-gate checklist for the phase.

**Blocking rules**
- A red required check cannot be merged; there is no override role.
- Coverage below a gate is a failure, not a warning.
- A new file under `payment/`, `procurement/`, or `qc/` with zero test references fails the `coverage-newfile` check.
- **Flake policy:** a test that fails then passes on retry is auto-quarantined after 2 occurrences in 7 days, tagged `@quarantine`, excluded from gating, and assigned an owner with a 5-working-day fix SLA. More than 10 quarantined tests blocks the next tag.
- Retries: L1 zero retries; L2 zero retries; L4 one retry (Playwright `retries: 1`) — a test needing the retry is counted as a flake.
- **Test-code review parity:** a PR touching `payment`, `procurement`, `qc`, `listing/stock`, or any DTO whitelist requires a second reviewer.

## 1.6 Explicitly out of scope (do not add tests for these)

| Not built | Authority |
|---|---|
| GST TCS u/s 52, GSTR-8, TCS credit reconciliation | s.52 covers supplies by *other* suppliers; own-account supply out of scope (CBIC e-commerce FAQ Q24/Q25) |
| TDS u/s 194-O / s.393(1) Sl.8(v) on us as an ECO | We are not an ECO for third-party supply |
| s.206C(1H) seller TCS | **Omitted from 1 Apr 2025** |
| s.206AB / s.206CCA non-filer higher-rate checks | Omitted |
| Rule 5(3)(a) seller name/address/phone disclosure | Applies to *marketplace* entities only; we are an inventory entity under Rules 4 + 7 |
| Payment-aggregator escrow, Razorpay Route split settlements | No third-party settlement exists |
| `qc_batch` hub-batch QC model | **Deprecated** — vendor-site QC is canonical |

A test asserting any of the above is a defect in the test suite and must be deleted with a reference to this table.

---

# PART 2 — VALIDATION RULE CATALOGUE

Every field-level rule the platform enforces. **Enforced at** codes: **C** = client (shared Zod schema, `packages/validation`), **D** = DTO (`class-validator` on the NestJS boundary), **S** = domain service rule, **DB** = database constraint / index / trigger.

The shared Zod schema and the DTO decorators are generated from **one source of truth** (`packages/validation/rules.ts`); test `VR-META-01` asserts that for every rule below, the client regex and the DTO regex are the *same string instance*, so they cannot drift.

## 2.1 Statutory identifiers

| ID | Field | Rule / bound | Error message shown to user | Enforced at |
|---|---|---|---|---|
| VR-001 | `kyc.gst_record.gstin` | `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`, uppercased, 15 chars | "Enter a valid 15-character GSTIN (e.g. 06ABCDE1234F1Z5)." | C, D, DB (`CHECK`) |
| VR-002 | `gstin` checksum | 15th char must equal the computed mod-36 check digit over chars 1–14 | "This GSTIN fails its check-digit test. Please re-enter." | C, D, S |
| VR-003 | `gstin` state code | Chars 1–2 ∈ seeded state-code master (01–38, 97, 99) | "The first two digits of the GSTIN are not a valid state code." | C, D, S |
| VR-004 | `gstin` ↔ address | GSTIN state code must equal the state of the registered address it is attached to | "The GSTIN state (Haryana) does not match the registered address state (Delhi)." | S |
| VR-005 | `gstin` uniqueness | One ACTIVE GST record per GSTIN across all organizations | "This GSTIN is already registered with gorefurbo." | S, DB (partial unique index) |
| VR-006 | `gstin` embedded PAN | Chars 3–12 must equal the organization's PAN | "The PAN inside this GSTIN does not match the PAN you provided." | S |
| VR-007 | `kyc.pan` | `^[A-Z]{5}[0-9]{4}[A-Z]$` | "Enter a valid 10-character PAN (e.g. ABCDE1234F)." | C, D, DB |
| VR-008 | `pan` 4th character | ∈ `{C,P,H,F,A,T,B,L,J,G}`; must be consistent with `organization.entity_type` (`C`→company, `P`→individual, `F`→partnership, `A`/`T`→trust/AOP, `H`→HUF, `L`→local authority) | "This PAN belongs to an individual but you selected 'Private Limited Company'." | C, D, S |
| VR-009 | `pan` uniqueness | One verified PAN per organization; a PAN already verified on another live org blocks | "This PAN is already in use on another gorefurbo account." | S, DB |
| VR-010 | `kyc.cin` | `^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$` (21 chars) | "Enter a valid 21-character CIN (e.g. U72900HR2021PTC098765)." | C, D, DB |
| VR-011 | `cin` internal consistency | Chars 7–8 = state code consistent with registered address state; chars 9–12 = year of incorporation ≤ current year and ≥ 1857 | "The CIN's state/year does not match the company details supplied." | S |
| VR-012 | `cin` requiredness | Mandatory when `entity_type ∈ {PRIVATE_LIMITED, PUBLIC_LIMITED, OPC}`; forbidden otherwise | "CIN is required for a Private Limited company." / "CIN does not apply to a sole proprietorship." | C, D, S |
| VR-013 | `kyc.llpin` | `^[A-Z]{3}-[0-9]{4}$` | "Enter a valid LLPIN (e.g. AAB-1234)." | C, D |
| VR-014 | `kyc.udyam_number` | `^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$` | "Enter a valid Udyam registration number (e.g. UDYAM-HR-05-0001234)." | C, D, DB |
| VR-015 | `udyam` state code | Chars 7–8 ∈ state-abbreviation master | "The state code in the Udyam number is not recognised." | C, S |
| VR-016 | `udyam` optionality | Optional; if present, the MSME classification field becomes mandatory | "Select your MSME classification (Micro / Small / Medium)." | D, S |
| VR-017 | `kyc.tan` | `^[A-Z]{4}[0-9]{5}[A-Z]$` | "Enter a valid TAN (e.g. DELT12345E)." | C, D, DB |
| VR-018 | `tan` requiredness | Mandatory for the platform entity's own tax profile; optional for vendors; **required** for a vendor that deducts TDS on us (not our case) | "TAN is required to file Form 26Q." | S |
| VR-019 | `kyc.aadhaar_last4` | `^[0-9]{4}$`; **full Aadhaar is never stored, never logged, never accepted** | "Enter the last 4 digits only." | C, D, S, DB (`CHECK length = 4`) |
| VR-020 | `kyc.msme_declaration` | Boolean; if `true`, Udyam number mandatory | "Provide your Udyam number to claim MSME status." | D, S |

## 2.2 Banking

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-021 | `kyc.bank_record.ifsc` | `^[A-Z]{4}0[A-Z0-9]{6}$` (5th char is a literal zero) | "Enter a valid 11-character IFSC (e.g. HDFC0001234)." | C, D, DB |
| VR-022 | `ifsc` bank master | First 4 chars must exist in the seeded bank master | "We don't recognise this bank code. Please check the IFSC." | S |
| VR-023 | `account_number` | `^[0-9]{9,18}$`, no spaces, stored encrypted (AES-GCM), masked on read to last 4 | "Account number must be 9–18 digits." | C, D, DB |
| VR-024 | `account_number` confirm | Must equal the re-typed confirmation field; paste into the confirm field is blocked | "The two account numbers do not match." | C |
| VR-025 | `account_holder_name` | 3–120 chars, `^[A-Za-z0-9 .,&'()\-\/]+$` | "Use letters, numbers and . , & ' ( ) - / only." | C, D |
| VR-026 | Penny-drop name match | Similarity to the legal name ≥ 0.90 → auto-pass; 0.70–0.90 → `NEEDS_REVIEW`; < 0.70 → `FAIL` | "The bank account name does not match your registered business name." | S |
| VR-027 | `account_type` | ∈ `{SAVINGS, CURRENT, CC, OD}`; vendors with `entity_type != PROPRIETORSHIP` must use CURRENT/CC/OD | "A company payout account must be a Current account." | D, S, DB |
| VR-028 | Primary payout account | Exactly one `is_primary = true` per vendor | "You must have exactly one primary payout account." | S, DB (partial unique index) |
| VR-029 | `upi_vpa` (optional) | `^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$` | "Enter a valid UPI ID (e.g. name@bank)." | C, D |

## 2.3 Contact, address, identity

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-030 | `identity.contact.mobile` | Stored E.164 as `+91XXXXXXXXXX`; input accepted as 10 digits, `0`-prefixed, `91`-prefixed or `+91`-prefixed and normalised; final regex `^\+91[6-9][0-9]{9}$` | "Enter a valid 10-digit Indian mobile number starting 6–9." | C, D, DB |
| VR-031 | `mobile` uniqueness | Unique per active user | "This mobile number is already registered." | S, DB (partial unique) |
| VR-032 | `email` | RFC-5322 practical subset, ≤ 254 chars, lower-cased domain, MX-existence check async (non-blocking), disposable-domain blocklist for vendor/buyer owners | "Enter a valid email address." / "Please use your business email — temporary mailboxes aren't accepted." | C, D, S, DB |
| VR-033 | `email` uniqueness | Unique per active user (case-insensitive) | "This email is already registered." | S, DB (unique on `lower(email)`) |
| VR-034 | `identity.address.pincode` | `^[1-9][0-9]{5}$` | "Enter a valid 6-digit PIN code." | C, D, DB |
| VR-035 | `pincode` master | Must exist in `identity.pincode` master; city/state auto-filled and read-only thereafter | "We don't recognise this PIN code." | S |
| VR-036 | `pincode` serviceability | For a delivery address, must be serviceable by ≥ 1 active carrier | "We don't deliver to 796001 yet. Add a different delivery address or contact us." | S |
| VR-037 | `address_line1` | 5–150 chars | "Address line 1 must be at least 5 characters." | C, D |
| VR-038 | `address_line2` | ≤ 150 chars, optional | — | C, D |
| VR-039 | `state_code` | ∈ state master, must match the pincode's state | "The state doesn't match the PIN code." | C, D, S, DB (FK) |
| VR-040 | `gps_lat` / `gps_lng` | lat ∈ [6.0, 37.5], lng ∈ [68.0, 97.5] (India bounding box), `NUMERIC(9,6)` | "The captured location is outside India." | D, S, DB |
| VR-041 | Address immutability | An address referenced by a confirmed order, shipment, invoice or e-way bill is **copy-on-write** — edits create a new version | "This address is used on a live order and can't be edited. We've created an updated copy." | S, DB |
| VR-042 | `full_name` | 2–100 chars, `^[\p{L} .'\-]+$` (Unicode letters) | "Enter your full name." | C, D |
| VR-043 | `gstin` on customer org | Optional for buyers; if absent, invoice is B2C-format and ITC narration omitted; if present, all GSTIN rules apply | "Add your GSTIN to receive a B2B tax invoice with input tax credit." | C, D, S |

## 2.4 Authentication, OTP, sessions

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-044 | `password` length | 12–128 chars | "Password must be at least 12 characters." | C, D |
| VR-045 | `password` composition | ≥ 1 lower, ≥ 1 upper, ≥ 1 digit, ≥ 1 of `!@#$%^&*()_+-=[]{};':",./<>?` | "Include an uppercase letter, a lowercase letter, a number and a symbol." | C, D |
| VR-046 | `password` blocklist | Not in the top-100k breached list (`zxcvbn` score ≥ 3); must not contain the email local-part, mobile, or brand words `gorefurbo`/`truetech` | "That password is too easy to guess. Try something less predictable." | C, D, S |
| VR-047 | `password` history | Must differ from the last 5 hashes | "You've used this password before. Choose a new one." | S, DB |
| VR-048 | `password` hashing | Argon2id, m=64 MiB, t=3, p=1; never logged, never returned | (n/a) | S |
| VR-049 | `password` rotation | Admin and vendor-owner roles: forced change every 180 days | "Your password has expired. Set a new one to continue." | S |
| VR-050 | `otp.code` | Exactly 6 digits, `^[0-9]{6}$`, CSPRNG, stored as a SHA-256 hash + salt, never logged | "Enter the 6-digit code we sent you." | C, D, S, DB |
| VR-051 | `otp` TTL | **300 seconds** from issue; expiry enforced server-side against `ClockPort`, never client clock | "That code has expired. Tap 'Resend' for a new one." | S, DB |
| VR-052 | `otp` attempt cap | **5** verification attempts per OTP; on the 5th failure the OTP is burned | "Too many incorrect attempts. Request a new code." | S, DB |
| VR-053 | `otp` resend cooldown | **60 seconds** between resends; max **5** resends per identifier per rolling hour; max **20** per 24 h | "Please wait 43 seconds before requesting another code." | C (countdown), S |
| VR-054 | `otp` single-use | Verifying an OTP consumes it atomically (`UPDATE … WHERE consumed_at IS NULL RETURNING`) | "That code has already been used." | S, DB |
| VR-055 | `otp` scope binding | An OTP issued for `LOGIN` cannot verify `DELIVERY`, `PAYOUT_CHANGE`, or `BANK_CHANGE` | "This code isn't valid for this action." | S, DB (`CHECK` on purpose enum) |
| VR-056 | `totp` | RFC 6238, 6 digits, 30 s step, ±1 step drift window, secret encrypted at rest; **mandatory** for `ADMIN` and `VENDOR_OWNER` | "Enter the 6-digit code from your authenticator app." | S, DB |
| VR-057 | `totp` replay | A consumed TOTP step cannot be reused within its window | "That code has already been used." | S, DB |
| VR-058 | JWT access | TTL **15 min**, `RS256`, claims `sub, org_id, roles[], scope[], jti, sid` | (n/a) | S |
| VR-059 | Refresh token | Rotating, httpOnly + Secure + SameSite=Strict cookie, TTL 30 days; **reuse of a rotated token revokes the whole family** | "For your security we've signed you out. Please sign in again." | S, DB |
| VR-060 | Login throttle | 5 failures per (email) per 15 min and 20 per IP per 15 min → 15 min lockout with a fixed-duration message (no drip) | "Too many sign-in attempts. Try again in 15 minutes." | S |

## 2.5 File upload

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-061 | Upload size | ≤ **5 MB** per file (5,242,880 bytes); enforced by Content-Length pre-check **and** streamed byte counter (a lying header must not win) | "Files must be 5 MB or smaller." | C, D, S |
| VR-062 | Allowed MIME | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` only | "Upload a JPG, PNG, WEBP or PDF." | C, D, S |
| VR-063 | **Magic-byte check** | Sniffed signature must match the declared MIME **and** the file extension: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WEBP `RIFF….WEBP`, PDF `%PDF-`. Mismatch → reject, quarantine, audit-log | "This file doesn't look like a valid JPG/PNG/WEBP/PDF." | S |
| VR-064 | Polyglot / embedded script | PDF must not contain `/JavaScript`, `/OpenAction`, `/Launch`, or embedded files; SVG is not an allowed type at all | "This PDF contains active content and can't be accepted." | S |
| VR-065 | **EXIF strip** | All EXIF/IPTC/XMP removed on ingest, including GPS; the stored object must have zero EXIF segments. **QC photo GPS is captured separately in `qc.photo.gps_lat/lng` before stripping** | (silent) | S |
| VR-066 | Image bounds | 200×200 px min, 8,000×8,000 px max, decompression-bomb guard (pixel count ≤ 40 MP, ratio ≤ 100:1) | "That image is too small / too large to process." | S |
| VR-067 | Filename | Sanitised to `^[A-Za-z0-9._-]{1,120}$`; stored under a generated UUID key; original name kept only as metadata | "Rename the file using letters, numbers, dots, dashes or underscores." | S |
| VR-068 | Virus scan | ClamAV scan before the object leaves quarantine; infected → delete + audit + notify | "This file failed our security scan and wasn't saved." | S |
| VR-069 | Access | Every read via a **CloudFront signed URL**, TTL 300 s, single-use nonce; no public bucket object | (n/a) | S |
| VR-070 | Documents per KYC type | ≤ 3 files per document type, ≤ 25 files per onboarding | "You can upload up to 3 files for this document." | D, S, DB |
| VR-071 | QC photo count | 6 mandatory angles + ≥ 1 seal photo per unit; max 20 | "Capture all 6 required photos before submitting." | S, DB |

## 2.6 Document age and validity

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-072 | **Document-age rule** | For an "age-sensitive" document type (bank statement, cancelled cheque image, utility bill, rent agreement proof of address, GST return acknowledgement), `document_date` must be **within 90 days** of the submission date. Registration certificates (GST, CIN, Udyam, PAN card, MSME) are **not** age-limited | "This document is dated 12 Jan 2026 — we need one issued in the last 90 days." | C, D, S, DB (`CHECK` via generated column) |
| VR-073 | `document_date` bounds | Not in the future (tolerance: 0 days); not before 1990-01-01 | "The document date can't be in the future." | C, D, DB |
| VR-074 | `expiry_date` | If present, must be > today at submission; a document expiring within 30 days raises a warning and appears in `v_expiring_documents` | "This document expires on 03 Sep 2026. Please upload a current one." | D, S |
| VR-075 | Re-verification cadence | GSTIN re-checked every 180 days; bank re-verified on any change; a vendor with a document expired > 30 days is auto-suspended from new listings | "Your GST certificate needs re-verification before you can list more stock." | S |

## 2.7 Catalog, listing, units, pricing

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-076 | **`listing.unit.serial_number`** | `^[A-Z0-9]{5,25}$` after upper-casing and stripping spaces/hyphens; must not be all-identical characters; must not be in the seeded "known placeholder" blocklist (`0123456789`, `TOBEFILLEDBYOEM`, `SYSTEMSERIALNUMBER`, `DEFAULTSTRING`, `NONE`, `NA`, `123456789`) | "Enter the laptop's real serial number as printed on the chassis." | C, D, S, DB |
| VR-077 | **Serial global uniqueness** | `CREATE UNIQUE INDEX uq_unit_active_serial ON listing.unit (serial_number) WHERE status NOT IN ('RETURNED_TO_VENDOR','SCRAPPED')` — one live unit per serial **platform-wide, across vendors** | "Serial number XYZ123 is already registered on gorefurbo." | S, **DB (authoritative)** |
| VR-078 | Serial ↔ brand plausibility | Warn (not block) if the serial does not match the seeded pattern for the SKU's brand (e.g. Dell service tag = 7 alphanumerics) | "This doesn't look like a Dell service tag. Double-check before submitting." | C, S |
| VR-079 | Serial ↔ QC detection | `qc_report.serial_matches` must be TRUE; FALSE stops the unit (see QC-006) | "The serial detected by the QC tool doesn't match the declared serial." | S, DB |
| VR-080 | `listing.qty_total` | Integer ≥ 1, ≤ 5,000 per listing | "Quantity must be between 1 and 5,000." | C, D, DB |
| VR-081 | **Stock identity** | `CHECK (qty_available + qty_reserved + qty_awaiting_qc + qty_qc_failed <= qty_total)` and each component ≥ 0 | "Stock update rejected — the quantities don't add up." (internal; user sees "Couldn't update stock, please retry") | S, **DB (authoritative)** |
| VR-082 | Cart line quantity | 1 ≤ qty ≤ min(`qty_available`, 500); MOQ from the listing if set | "Only 3 units are available at this price." | C, D, S |
| VR-083 | `expected_net_payout` (vendor) | `NUMERIC(14,2)`, ≥ ₹1,000.00, ≤ ₹5,00,000.00 per unit, > 0 | "Expected payout must be between ₹1,000 and ₹5,00,000." | C, D, DB |
| VR-084 | Retail price bound | `NUMERIC(14,2)`, ≥ ₹1,000.00, ≤ ₹10,00,000.00 | "Price must be between ₹1,000 and ₹10,00,000." | C, D, DB |
| VR-085 | **Margin guard rail (floor)** | `retail_price >= vendor_net_payout + logistics_estimate + min_margin` where `min_margin = max(₹500, 4% of payout)`. Violation blocks publish | "This price is below our minimum margin. Minimum sellable price is ₹34,200." | S |
| VR-086 | **Price-jump guard rail** | A single price change of > ±25% vs the current live price requires a reason code and manager approval | "That's a 38% change. Add a reason and it will go to your manager for approval." | C, S |
| VR-087 | **Price-vs-market guard rail** | Warn if outside ±35% of the trailing-30-day median for the SKU+grade; block if outside ±60% | "This price is 71% below the recent market for this model — blocked pending review." | S |
| VR-088 | MARGIN pricing | For `valuation_method = 'MARGIN'`, `retail_price > purchase_price` strictly (a non-positive margin makes Rule 32(5) meaningless) | "For margin-scheme stock the selling price must exceed the purchase price." | S, DB (`CHECK`) |
| VR-089 | **Tier-price band overlap** | `listing_tier_price` uses `EXCLUDE USING gist (listing_id WITH =, int4range(min_qty, COALESCE(max_qty, 2147483647), '[]') WITH &&)` — no two tiers for a listing may overlap in quantity | "Tier 2 (10–20 units) overlaps tier 1 (1–15 units)." | C, D, DB (authoritative) |
| VR-090 | Tier monotonicity | Unit price must be non-increasing as `min_qty` increases | "A larger quantity can't cost more per unit than a smaller one." | C, D, S |
| VR-091 | Tier coverage | Tier bands must start at 1 and be contiguous (no gaps) | "Quantities 6–9 have no price. Add a tier covering them." | S |
| VR-092 | `min_qty` / `max_qty` | 1 ≤ `min_qty` ≤ `max_qty` ≤ 5,000; `max_qty` NULL means open-ended | "Maximum quantity must be at least the minimum." | C, D, DB |
| VR-093 | `grade_declared` / `grade_actual` | ∈ `{A_PLUS, A, B}` only. **Nothing worse than B is sellable** — a computed grade below B sets `is_sellable = FALSE` and status `QC_FAILED` | "Only grades A+, A and B can be listed." | C, D, S, DB (enum + `CHECK`) |
| VR-094 | Battery health | 0 ≤ `battery_health_pct` ≤ 100; grade A+ requires ≥ 85%, A ≥ 75%, B ≥ 60%; < 60% → not sellable | "Battery health of 54% is below our minimum for a listed unit." | S, DB |
| VR-095 | Cycle count | 0 ≤ cycles ≤ 5,000; A+ ≤ 300, A ≤ 700, B ≤ 1,200 | (internal grading input) | S, DB |
| VR-096 | RAM / storage declared | ∈ SKU-permitted values; a declared value not offered on the SKU is rejected | "This model doesn't come with 96 GB RAM. Choose a valid configuration." | C, D, S |
| VR-097 | `catalog.sku` uniqueness | Unique `(model_id, cpu, ram_gb, storage_gb, storage_type, gpu, screen_size, os)` | "An identical SKU already exists." | S, DB (unique) |
| VR-098 | HSN | `^[0-9]{8}$`, default `84713010` for laptops; must exist in the seeded HSN master with a GST rate | "Enter a valid 8-digit HSN code." | D, S, DB |
| VR-099 | Vendor anonymity payload | Customer-facing serializers must emit only `supply_point_label` (`^Supply Point [A-Z]( ?[0-9]+)? · [A-Za-z ]{2,40}$`), dispatch city, dispatch SLA, stock depth. Any vendor legal name, GSTIN, PAN, address line, phone, email, rating or internal ID in a customer-facing response is a **P0 defect** | (n/a — invisible to the user by design) | S (DTO whitelist), tested at API layer |

## 2.8 Seals

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-100 | `qc.seal.code` | `^GRF-[0-9]{2}[A-Z]{2}-[0-9]{7}$` (e.g. `GRF-26HR-0004821`): 2-digit year, 2-letter state, 7-digit sequence | "Enter the seal code exactly as printed (GRF-26HR-0004821)." | C, D, DB |
| VR-101 | Seal uniqueness | Globally unique across all seals, ever | "Seal GRF-26HR-0004821 has already been used." | S, DB (unique) |
| VR-102 | Seal issuance | Code must fall inside a roll range issued to the acting technician and not be `VOID` | "This seal isn't from your issued roll." | S |
| VR-103 | Seal lifecycle | `APPLIED → INTACT → BROKEN`; also `APPLIED → VOID` (misapplication, ≤ 15 min, reason required). No other transition. `BROKEN` is terminal for that seal | "A broken seal can't be marked intact." | S, DB (`CHECK` + transition table) |
| VR-104 | Seal ↔ unit | Exactly one non-`VOID` seal per unit at a time; a unit with no `APPLIED`/`INTACT` seal is **not sellable** | "This unit has no active seal and can't be listed." | S, DB (partial unique) |
| VR-105 | Broken seal → routing | `seal.status = 'BROKEN'` forces `routing_decision = 'VIA_HUB'`; direct dispatch is refused | "Seal broken — this unit must be re-inspected at the hub before dispatch." | S, DB |

## 2.9 QC report

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-106 | `qc.tool_run` idempotency | `UNIQUE (tool_provider_id, tool_run_id)` | "This QC run has already been ingested." | S, **DB** |
| VR-107 | Report signature | Ed25519 signature over the canonical JSON body using the tool provider's registered public key; invalid → 401, audit-logged | (machine-facing) | S |
| VR-108 | Report nonce | `nonce` unique per provider within a 24 h window; replay → 409 | (machine-facing) | S, DB |
| VR-109 | Report freshness | `generated_at` within ±10 min of server time | (machine-facing) | S |
| VR-110 | `schema_version` | Must be a supported version; unsupported → 422 with the supported list | (machine-facing) | D, S |
| VR-111 | `qc_report.valid_until` | `= completed_at + 90 days`, computed server-side, immutable | "This QC report expired on 14 Jun 2026." | S, DB (generated column) |
| VR-112 | Exactly one current report | `CREATE UNIQUE INDEX uq_qcrep_current ON qc.qc_report (unit_id) WHERE is_current` | (internal) | S, **DB** |
| VR-113 | Area scores | Each cosmetic area score ∈ [0, 10] integer; all mandatory areas present for the SKU's form factor | (machine-facing) | D, S, DB |
| VR-114 | Geo variance | Distance between the visit's declared facility GPS and the photo/report GPS ≤ **500 m**; beyond that raises a `GEO_VARIANCE` alert and flags the visit for review | "Your location is 1.4 km from the registered facility. This visit has been flagged." | S |
| VR-115 | Grade correction auto-apply | A `grade_correction` not disputed by the vendor within **2 days** (48 h from notification) auto-applies | "Grade correction applied automatically after 2 days without a response." | S |

## 2.10 Orders, credit, approvals

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-116 | Order line quantity | 1 ≤ qty ≤ 500 per line; ≤ 1,000 units per order | "You can order up to 500 units of one item." | C, D, S, DB |
| VR-117 | Order lines per order | 1 ≤ lines ≤ 500 | "An order can contain up to 500 line items." | D, S |
| VR-118 | Order total | > ₹0 and ≤ ₹5,00,00,000 (₹5 crore) per order | "Orders above ₹5 crore need to go through our enterprise desk." | S |
| VR-119 | **Credit limit** | `outstanding_exposure + order_value <= credit_limit`; exposure = unpaid invoices + confirmed unbilled orders + open credit holds. Evaluated **inside** the confirmation transaction with `SELECT … FOR UPDATE` on the credit record | "This order takes you ₹42,000 over your ₹5,00,000 credit limit. Reduce the order or pay down your balance." | S, DB |
| VR-120 | Credit limit value | `NUMERIC(14,2)` ≥ 0, ≤ ₹10,00,00,000; change requires FIN role + audit reason | "Credit limit must be between ₹0 and ₹10 crore." | D, S, DB |
| VR-121 | Credit terms days | ∈ {0, 7, 15, 30, 45, 60} | "Choose a standard payment term." | D, DB |
| VR-122 | Approval policy | If the buyer org has an approval policy, an order above the threshold enters `PENDING_APPROVAL` and cannot be confirmed by its creator | "This order needs approval from Priya Sharma before it's placed." | S, DB |
| VR-123 | Self-approval | The order creator may never be the approver, even if they hold the approver role | "You can't approve your own order." | S, DB (`CHECK created_by <> approved_by`) |
| VR-124 | Reservation TTL | Cart-stage soft reservation 15 min; confirmed reservation until dispatch or cancellation | "Your held stock expired. We've refreshed availability." | S |
| VR-125 | RFQ validity | `valid_to > valid_from`; `valid_to` ≤ `valid_from` + 30 days | "The quote validity end date must be after the start date." | C, D, DB |

## 2.11 Tax and money

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-126 | Money type | Every monetary column is `NUMERIC(14,2)`. **No floats anywhere in the money path** — a `float`/`double` in `payment/**` or `procurement/**` fails a semgrep rule | (n/a) | S, DB, CI |
| VR-127 | Rounding | Half-up to 2 dp at each *line*; invoice total = Σ rounded lines; a single `round_off` line ∈ [−0.99, +0.99] reconciles to the rupee if configured | (n/a) | S |
| VR-128 | **GST split exclusivity** | `CHECK ( (igst_amount > 0 AND cgst_amount = 0 AND sgst_amount = 0) OR (igst_amount = 0 AND cgst_amount > 0 AND sgst_amount > 0) OR (igst_amount = 0 AND cgst_amount = 0 AND sgst_amount = 0 AND is_exempt) )` — **exactly one of IGST or CGST+SGST** | (internal) | S, **DB** |
| VR-129 | CGST = SGST | `cgst_amount = sgst_amount` and each = `taxable_value * rate / 2` | (internal) | S, DB (`CHECK`) |
| VR-130 | Place of supply | For Bill-To-Ship-To, POS on Invoice-1 (vendor→platform) is determined by s.10(1)(b) IGST Act = the **Bill-To** party's location; POS on Invoice-2 (platform→customer) = the **Ship-To** location | (internal) | S |
| VR-131 | GST rate | 18% on laptops (HSN 8471) from the seeded rate table, effective-dated; no hard-coded 18 in code | (internal) | S, DB |
| VR-132 | **MARGIN scheme** | `valuation_method = 'MARGIN'` → taxable value = `max(sale_price − purchase_price, 0)`; **no ITC row may ever reference a MARGIN unit**; invoice must carry the narration *"Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase."* | (internal) | S, DB (`CHECK` + FK guard on ITC ledger) |
| VR-133 | `valuation_method` immutability | Set per unit at purchase; any `UPDATE` changing it is rejected | "The valuation method of a purchased unit can't be changed." | S, DB (trigger) |
| VR-134 | No mixing on one invoice | An invoice may not contain both REGULAR and MARGIN lines | "Margin-scheme items are invoiced separately." | S, DB |
| VR-135 | **e-Way bill threshold** | An EWB is required when the consignment value **exceeds ₹50,000** (`> 50000.00`, exclusive; ₹50,000.00 exactly does **not** require one). Value basis = invoice value incl. GST, excluding exempt-goods value | "This consignment is ₹64,900 — an e-way bill is required before dispatch." | S, DB |
| VR-136 | EWB one-per-movement | **One** e-way bill per physical movement even though two invoices exist (Case 2). A second EWB for the same movement is refused | "An e-way bill already exists for this shipment." | S, DB (unique on `shipment_id`) |
| VR-137 | EWB Part-B | Vehicle number `^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$`; mandatory before movement unless distance ≤ 50 km and transport is by the consignor | "Enter a valid vehicle number (e.g. HR26DK8337)." | C, D, S |
| VR-138 | **TDS threshold** | s.393(1) Table Sl. 8(ii): **0.1%** on the amount **exceeding ₹50,00,000** per vendor per financial year, on value **excluding GST**, deducted at credit or payment whichever is earlier. **5%** if the vendor has no PAN | (internal; shown on the payout advice) | S |
| VR-139 | TDS applicability switch | Applies only if our turnover in the preceding FY > ₹10 crore (`platform_config.tds_applicable`) | (internal) | S |
| VR-140 | **Ledger double entry** | `CHECK ((debit > 0) <> (credit > 0))` — every ledger row is exactly one of debit or credit, strictly positive | (internal) | S, **DB** |
| VR-141 | Batch balance | Σ debit = Σ credit per `batch_id`, asserted **inside** the writing transaction; `v_ledger_imbalance` must return zero rows | (internal) | S, DB (view + nightly job) |
| VR-142 | Payment amount | > ₹0, ≤ invoice outstanding + configured overpayment tolerance (₹1) | "The payment is more than the outstanding amount." | D, S |
| VR-143 | Refund amount | > ₹0 and ≤ (captured − already refunded) for the referenced payment | "You can't refund more than was collected." | D, S, DB |
| VR-144 | Credit note | ≤ the referenced invoice value; must reference an existing invoice; cannot post to a cancelled invoice | "A credit note can't exceed the invoice value." | D, S, DB |
| VR-145 | Payout net | `net = gross − tds − penalties − adjustments`; `net ≥ 0`; a computed negative net becomes a carried-forward debit balance, never a negative payout | "Deductions exceed this payout. The balance carries to the next run." | S, DB (`CHECK net_amount >= 0`) |
| VR-146 | Invoice number | Per-series, gapless, monotonic, financial-year scoped: `^GRF/2026-27/[A-Z]{2}/[0-9]{6}$`; allocation under an advisory lock | (internal) | S, DB (unique) |
| VR-147 | Currency | `INR` only at pilot; a non-INR value is rejected | "We currently trade in INR only." | D, DB |

## 2.12 Dates, windows, state

| ID | Field | Rule / bound | Error message | Enforced at |
|---|---|---|---|---|
| VR-148 | **Generic validity range** | For every `(valid_from, valid_to)` pair — tier prices, rate cards, price books, margin rules, sampling rules, agreements, coupons — `CHECK (valid_to IS NULL OR valid_to > valid_from)` | "The end date must be after the start date." | C, D, DB |
| VR-149 | **Warranty period** | `warranty_end > warranty_start`; `warranty_start = delivery_date`; duration ∈ {3, 6, 12} months from `platform_config`; end computed server-side | "Warranty end must be after the start date." | C, D, S, DB |
| VR-150 | Rate-card overlap | `carrier_rate_card` gains an `EXCLUDE` constraint on `(carrier_id, zone, weight_slab, daterange(valid_from, valid_to))` — overlapping active cards are impossible (schema gap #7) | "This rate card overlaps an existing one for the same zone and weight." | DB |
| VR-151 | Sampling-rule uniqueness | `UNIQUE (vendor_tier, effective_from)` on `qc_sampling_rule` (schema gap #8) | "A sampling rule already exists for this tier from that date." | DB |
| VR-152 | `platform_config.key` | `UNIQUE` (schema gap #4), `^[a-z0-9_.]{3,80}$` | "Configuration key already exists." | D, DB |
| VR-153 | Return window | A return request is admissible only within the **inspection window** (default 5 days from delivery, per `platform_config`), computed from `delivered_at`, inclusive of the last day to 23:59:59 IST | "The 5-day inspection window for this order closed on 20 Aug 2026." | S, DB |
| VR-154 | Rule 7(4) take-back | Defective / deficient / spurious / not-as-described / late claims are admissible **regardless of the inspection window** and cannot be routed to the vendor as the responsible party for the customer's remedy | (n/a — always accepted) | S |
| VR-155 | Payout eligibility date | A PO becomes payable only after `delivered_at + inspection_window` has elapsed with no open return/dispute | "This PO becomes payable on 22 Aug 2026." | S, DB |
| VR-156 | Status enums | Every status column named in schema gap #5 (`delivery_task`, `eway_bill`, `refund`, `payout`, `return_request`, `ticket`, `warranty_claim`, `dispute`, `data_subject_request`) has a `CHECK` against its enumerated set — no free text | (internal) | DB |
| VR-157 | Transition legality | Every status change goes through a declarative transition table; an illegal transition raises `IllegalStateTransition` and is audit-logged with actor, from, to | "That action isn't available from the current status." | S, DB (trigger) |
| VR-158 | `routing_rule.carrier_code` | FK to `logistics.carrier(code)` (schema gap #6) — an unknown carrier code cannot be saved | "Unknown carrier code." | D, DB (FK) |
| VR-159 | Partition runway | Every partitioned table (`order_event`, `shipment_tracking`, `notification_log`, `integration_log`, `audit_log`) must have partitions covering **today + 90 days**, plus a `DEFAULT` partition as a backstop | (internal alert) | DB + scheduled job |
| VR-160 | Timezone | All timestamps stored `TIMESTAMPTZ` in UTC; all business-day, cut-off and window arithmetic performed in **Asia/Kolkata**; a naive local-time comparison in business logic fails a lint rule | (n/a) | S, CI |

**Validation meta-tests**

| ID | Assertion |
|---|---|
| VR-META-01 | For every rule VR-001…VR-160 marked **C** and **D**, the client Zod schema and the DTO validator resolve to the identical exported constant. Any duplicated literal regex fails. |
| VR-META-02 | Every rule marked **DB** has a corresponding L2 test that inserts violating data directly via raw SQL (bypassing the service layer) and asserts the database rejects it. |
| VR-META-03 | Every error message in this catalogue exists in the i18n bundle (`en-IN`), contains no stack detail, no internal ID, no SQL, and no vendor identity. |
| VR-META-04 | No error message uses confirm-shaming, false urgency, or a countdown other than the OTP resend cooldown (CCPA Dark Patterns Guidelines 2023). |

---

# PART 3 — TEST CASES BY MODULE

Columns: **ID · Title · Precondition · Steps · Expected result · Type · Priority.**
Type: `U` unit (Jest) · `I` integration (Supertest + Testcontainers) · `E` E2E (Playwright/Maestro) · `C` contract · `L` load.

## 3.1 `identity` — organizations, users, roles, sessions, OTP, RBAC

### 3.1.1 Authentication and session

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| IDN-001 | Register with valid mobile issues OTP | No user for `+919000000001` | POST `/auth/register` with valid mobile + name | 202; outbox contains one 6-digit OTP; `otp` row with hashed code, TTL 300 s, `consumed_at` NULL | I | P0 |
| IDN-002 | OTP verify happy path | IDN-001 done | POST `/auth/otp/verify` with the code | 200; access JWT 15 min; refresh cookie httpOnly+Secure+SameSite=Strict; OTP `consumed_at` set | I | P0 |
| IDN-003 | OTP wrong code increments attempts | OTP issued | Verify with a wrong code | 401 `OTP_INVALID`; `attempt_count = 1`; OTP still usable | I | P0 |
| IDN-004 | OTP attempt cap burns the code | OTP issued | 5 wrong verifies, then the **correct** code | 5th returns 429 `OTP_ATTEMPTS_EXCEEDED`; the correct code afterwards returns 401 `OTP_INVALID`; row marked burned | I | P0 |
| IDN-005 | OTP expiry at 300 s | OTP issued | `clock.advance(301s)`; verify with the correct code | 401 `OTP_EXPIRED`, message "That code has expired." | I | P0 |
| IDN-006 | OTP valid at 299 s | OTP issued | `clock.advance(299s)`; verify | 200 | I | P1 |
| IDN-007 | Resend cooldown 60 s | OTP issued at t0 | Resend at t0+59s | 429 with `retry_after_seconds = 1`; no new SMS in outbox | I | P0 |
| IDN-008 | Resend allowed at 60 s | OTP issued | Resend at t0+60s | 202; new OTP; previous OTP invalidated | I | P1 |
| IDN-009 | Resend hourly cap | 5 resends done in the hour | 6th resend | 429 `OTP_RESEND_LIMIT`; audit-logged | I | P1 |
| IDN-010 | OTP single-use under race | Valid OTP | Two concurrent verifies with the same code | Exactly one 200, one 401; DB shows one `consumed_at` (atomic conditional update) | I | P0 |
| IDN-011 | OTP purpose binding | LOGIN OTP issued | Use it on `/delivery/confirm` | 401 `OTP_SCOPE_MISMATCH` | I | P0 |
| IDN-012 | OTP never logged | OTP flow | Capture app logs + Sentry breadcrumbs | The 6-digit code appears nowhere; only a hash prefix | I | P0 |
| IDN-013 | Password policy matrix | — | 24 candidate passwords across VR-044…VR-046 | Each accepted/rejected exactly per catalogue, with the catalogue's message | U | P0 |
| IDN-014 | Password history | User with 5 prior hashes | Set the 3rd-most-recent password again | 422 "You've used this password before." | I | P1 |
| IDN-015 | Argon2id parameters | — | Inspect the produced hash | `$argon2id$v=19$m=65536,t=3,p=1` | U | P1 |
| IDN-016 | Login throttling | — | 5 bad passwords for one email | 6th → 429, 15 min lockout, fixed message, no hint about whether the account exists | I | P0 |
| IDN-017 | User enumeration resistance | — | Login for an existing vs a non-existent email | Identical status, body and response-time band (±50 ms) | I | P0 |
| IDN-018 | Access token TTL | Logged in | `clock.advance(15m + 1s)`; call an API | 401 `TOKEN_EXPIRED` | I | P0 |
| IDN-019 | Refresh rotation | Logged in | Call `/auth/refresh` | New access + **new** refresh; old refresh `rotated_at` set | I | P0 |
| IDN-020 | **Refresh reuse revokes the family** | IDN-019 done | Replay the **old** refresh token | 401; **all** sessions in that token family revoked; Redis session keys deleted; audit event `SESSION_REUSE_DETECTED`; subsequent use of the new token also fails | I | P0 |
| IDN-021 | Logout revokes server-side | Logged in | POST `/auth/logout`; then use the still-unexpired access token | 401 — the Redis session is gone, so a live-but-unexpired JWT is refused | I | P0 |
| IDN-022 | TOTP mandatory for ADMIN | Admin without TOTP | Log in | 200 with `mfa_enrollment_required`; every non-enrolment endpoint returns 403 until enrolled | I | P0 |
| IDN-023 | TOTP mandatory for VENDOR_OWNER | Vendor owner without TOTP | Log in | Same as IDN-022 | I | P0 |
| IDN-024 | TOTP drift window | Enrolled | Submit codes for step −2, −1, 0, +1, +2 | −1, 0, +1 accepted; ±2 rejected | U | P1 |
| IDN-025 | TOTP replay | Enrolled | Use the same code twice inside one step | Second → 401 `TOTP_REUSED` | I | P0 |
| IDN-026 | Concurrent session cap | Ops user | Sign in on 6 devices (cap 5) | Oldest session evicted; user notified | I | P2 |
| IDN-027 | Password change kills other sessions | 3 active sessions | Change password on session 1 | Sessions 2 and 3 return 401 on next call | I | P1 |
| IDN-028 | Impersonation is audited and bounded | Admin with `SUPPORT_IMPERSONATE` | Impersonate a buyer | Banner in UI; every request tagged `impersonated_by`; max 30 min; **write** operations on money endpoints refused | I | P0 |
| IDN-029 | Audit log immutability | Any audited action | Attempt `UPDATE`/`DELETE` on `identity.audit_log` as `tt_app` | Permission denied; only INSERT and SELECT granted | I | P0 |
| IDN-030 | `tt_app` / `tt_readonly` default passwords | Fresh migration | Grep the migration set; attempt login with `CHANGE_ME_IN_PRODUCTION` | No such literal exists in any migration; roles are created without a password and credentials are injected from Secrets Manager (schema gap #10) | I | P0 |

### 3.1.2 RBAC — the role × resource matrix

Roles: `GUEST`, `BUYER_USER`, `BUYER_ADMIN`, `BUYER_APPROVER`, `VENDOR_STAFF`, `VENDOR_OWNER`, `TECHNICIAN`, `TECH_AUDITOR`, `RIDER`, `SUPPORT`, `OPS`, `FINANCE`, `ADMIN`, `READONLY`.

`IDN-040` is a **generated matrix test**: for every (role × endpoint × ownership) triple the suite asserts the expected outcome from the table below. Endpoints are enumerated from the Nest router at test time, so **a new endpoint with no matrix entry fails the test** — there is no way to ship an unguarded route.

| ID | Resource / endpoint group | GUEST | BUYER_USER | BUYER_ADMIN | VENDOR_STAFF | VENDOR_OWNER | TECHNICIAN | RIDER | SUPPORT | OPS | FINANCE | ADMIN | READONLY |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| IDN-041 | `GET /offers` (public grid) | ✔ anon | ✔ | ✔ | ✖ | ✖ | ✖ | ✖ | ✔ | ✔ | ✔ | ✔ | ✔ |
| IDN-042 | `POST /orders` | ✖ | ✔ own org | ✔ own org | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ on behalf | ✖ | ✔ | ✖ |
| IDN-043 | `POST /orders/:id/approve` | ✖ | ✖ | ✔ if approver & not creator | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ | ✔ | ✖ |
| IDN-044 | `GET /orders/:id` | ✖ | ✔ own org only | ✔ own org only | ✖ | ✖ | ✖ | ✖ | ✔ redacted | ✔ | ✔ | ✔ | ✔ |
| IDN-045 | `GET /vendor/listings` | ✖ | ✖ | ✖ | ✔ own vendor | ✔ own vendor | ✖ | ✖ | ✖ | ✔ | ✖ | ✔ | ✔ |
| IDN-046 | `POST /vendor/units/bulk` | ✖ | ✖ | ✖ | ✔ own vendor | ✔ own vendor | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ |
| IDN-047 | `GET /vendor/payouts` | ✖ | ✖ | ✖ | ✖ | ✔ own vendor | ✖ | ✖ | ✖ | ✖ | ✔ all | ✔ | ✔ |
| IDN-048 | `POST /payouts/run` | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✔ | ✖ |
| IDN-049 | `POST /qc/visits/:id/units/:uid/report` | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ assigned visit only | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ |
| IDN-050 | `POST /qc/audit-recheck` | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ (unless auditor) | ✖ | ✖ | ✔ | ✖ | ✔ | ✖ |
| IDN-051 | `POST /shipments/:id/deliver` | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ assigned task | ✖ | ✔ | ✖ | ✔ | ✖ |
| IDN-052 | `GET /admin/vendors/:id` (full identity) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✔ | ✔ | ✔ |
| IDN-053 | `POST /credit-limits/:orgId` | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✔ | ✖ |
| IDN-054 | `POST /refunds` | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ ≤ ₹25k | ✔ any | ✔ | ✖ |
| IDN-055 | `POST /platform/config` | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ | ✖ |
| IDN-056 | Any `POST`/`PATCH`/`DELETE` as READONLY | — | — | — | — | — | — | — | — | — | — | — | **✖ all, 403** |

### 3.1.3 IDOR and tenancy isolation

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| IDN-060 | **Vendor A cannot read Vendor B's listing** | V_ALPHA + V_BETA each own listings | As V_ALPHA, `GET /vendor/listings/{B_listing_id}` | **404** (not 403 — no existence disclosure); audit event `IDOR_ATTEMPT` | I | P0 |
| IDN-061 | Vendor A cannot read B's units, POs, invoices, payouts, scorecard, QC visits | Same | Sweep all 9 vendor-scoped resource types with B's IDs | 404 on every one | I | P0 |
| IDN-062 | Vendor A cannot mutate B's records | Same | PATCH/DELETE on B's listing, unit, bank record, address | 404, zero rows changed | I | P0 |
| IDN-063 | **Buyer cannot read another org's order** | B_ORG1 + B_ORG2 orders exist | As B_ORG1 user, `GET /orders/{ORG2_order}` | 404 | I | P0 |
| IDN-064 | Buyer cannot read another org's invoice, shipment, ticket, return, credit note, saved search | Same | Sweep 8 resource types | 404 each | I | P0 |
| IDN-065 | Buyer user cannot read a sibling user's cart | Two users in B_ORG1 | GET the sibling's cart id | 404 (carts are user-scoped, not org-scoped) | I | P0 |
| IDN-066 | Cross-tenant list endpoints never leak | Both orgs have data | `GET /orders?limit=1000` as each | Result sets are disjoint; total counts equal the org's own row count | I | P0 |
| IDN-067 | Sequential-ID probing | — | Attempt 200 sequential/adjacent UUIDs across resources | 100% 404; rate limiter trips at 50; alert raised | I | P0 |
| IDN-068 | Tenant id cannot be overridden by input | — | Send `org_id` of another tenant in body, query and `X-Org-Id` header | Ignored; org is derived from the JWT only; request scoped correctly | I | P0 |
| IDN-069 | Prisma tenancy middleware fail-closed | — | Call a repository method with no tenant context in a test harness | Throws `MissingTenantContext`; **no query is issued** | U | P0 |
| IDN-070 | Signed-URL isolation | Vendor B document in S3 | As Vendor A, request a signed URL for B's document key | 404; no URL minted | I | P0 |
| IDN-071 | Signed-URL expiry and single use | Valid URL | Use after 301 s; and use twice inside TTL | Expired → 403; second use → 403 (nonce consumed) | I | P1 |
| IDN-072 | Technician scope | T_ONE assigned visit 1 | Submit a report for visit 2 (T_TWO's) | 404 | I | P0 |
| IDN-073 | Rider scope | RIDER_ONE assigned task 1 | Mark task 2 delivered | 404 | I | P0 |
| IDN-074 | Support redaction | Support agent | `GET /orders/:id` as SUPPORT | Payment instrument, full bank details and vendor payout price are absent from the payload | I | P0 |
| IDN-075 | Deleted/suspended org access | B_ORG5 suspended | Any authenticated call | 403 `ORG_SUSPENDED` with an actionable message; read of past invoices still permitted | I | P1 |

### 3.1.4 **Vendor anonymity — DTO whitelist tested at the API layer**

These are the highest-value tests in the suite. They run against the **serialized HTTP response body**, not against a service return value, because the DTO whitelist is the control.

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| IDN-080 | **Forbidden-token sweep on every customer-facing endpoint** | Seeded data where V_ALPHA's legal name is `Alpha Systems Pvt Ltd`, GSTIN `06ABCDE1234F1Z5`, PAN `ABCDE1234F`, address `Plot 41, Udyog Vihar Phase IV`, phone `+919810000001`, email `ops@alphasystems.example`, internal id `V_ALPHA_ID`, bank `HDFC0001234 / 50200011112222` | Enumerate **every** route in the storefront/customer API surface from the Nest router; for each, call with a buyer JWT; deep-stringify the JSON body (including nested objects, arrays, and any `meta`/`debug` keys) and search case-insensitively for each forbidden token | Zero matches anywhere. A single match fails the build. The test enumerates routes dynamically, so a new customer endpoint is covered automatically | I | **P0** |
| IDN-081 | Offers grid payload whitelist | Live offers exist | `GET /offers` | Every object's key set is exactly the whitelist: `offer_id, sku, brand, model, spec, grade, qc_score, qc_valid_until, price, tier_prices, supply_point_label, dispatch_city, dispatch_sla_hours, stock_depth_band, images[]`. Any extra key fails | I | P0 |
| IDN-082 | Offer detail payload whitelist | — | `GET /offers/:id` | As IDN-081 plus `qc_report_public` (area scores, battery %, no serial, no technician name, no vendor facility name, no GPS) | I | P0 |
| IDN-083 | Supply-point label format and stability | V_ALPHA and V_BETA both live | Read labels | `"Supply Point A · Gurugram"`, `"Supply Point B · Noida"`; matches VR-099 regex; the letter is stable per vendor per buyer-visible mapping and does not reveal ordering by size or onboarding date | I | P0 |
| IDN-084 | Label mapping is not reversible across accounts | Two buyer orgs | Compare the letter assigned to the same vendor across buyer orgs and across time | Consistent within the platform, and carries no data (no vendor id derivable); mapping table is not exposed on any customer endpoint | I | P1 |
| IDN-085 | **Order and invoice payloads** | Delivered order from V_ALPHA | `GET /orders/:id`, `GET /invoices/:id`, `GET /invoices/:id/pdf` (text-extracted) | No vendor legal name/GSTIN/address/contact. Dispatch address on the customer's copy shows the **dispatch city and PIN** only where legally needed, never the vendor's registered name | I | P0 |
| IDN-086 | Tracking payload | Shipment in transit | `GET /shipments/:id/tracking` | Carrier name and scan locations allowed; **origin facility name and vendor contact must not appear**; carrier's own "sender name" field is replaced with `TrueTech Services Pvt. Ltd.` | I | P0 |
| IDN-087 | Search index leakage | Postgres `tsvector` index built | Search for `Alpha Systems`, `ABCDE1234F`, `Udyog Vihar` | Zero results; the customer-facing tsvector is built from catalog + grade fields only and contains no vendor columns | I | P0 |
| IDN-088 | Error messages and validation errors | Trigger 20 error paths on customer endpoints | Inspect bodies | No vendor identity, no internal ids, no SQL, no stack | I | P0 |
| IDN-089 | Webhook and notification templates | Trigger all customer-facing emails/SMS | Inspect rendered bodies in the outbox | No vendor identity token present in any customer template | I | P0 |
| IDN-090 | Admin still sees everything | ADMIN_ONE | `GET /admin/vendors/:id` | Full legal name, GSTIN, PAN, address, contacts, bank (masked to last 4), payout price all present | I | P0 |
| IDN-091 | Ops sees vendor identity, buyer never does | OPS_ONE and buyer | Same underlying order | Ops payload contains vendor identity; buyer payload does not; both derive from the same service call with different serializers | I | P0 |
| IDN-092 | Serializer default is deny | New DTO added without an explicit whitelist | Unit test on the serializer factory | Throws at module bootstrap: "customer-facing DTO must declare an explicit field whitelist" | U | P0 |
| IDN-093 | `@Exclude()`-by-default class-transformer config | — | Inspect global `ClassSerializerInterceptor` config | `excludeExtraneousValues: true` globally; a field without `@Expose()` cannot be emitted | U | P0 |
| IDN-094 | GraphQL/BFF absence | — | Scan for any pass-through raw-record endpoint (`/debug`, `/_dev`, `/internal` exposed on the public router) | None exist in a production build | I | P0 |

## 3.2 `kyc` — leads, onboarding, verification, documents, agreements

### 3.2.1 Vendor 7-step onboarding

Steps: **1** Business basics · **2** Statutory identifiers (GSTIN/PAN/CIN/Udyam) · **3** Addresses & facilities · **4** Bank & payout · **5** Documents · **6** Capability & sourcing declaration · **7** Agreement & consent.

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| KYC-001 | Lead capture → OTP → draft created | None | Submit mobile + email + business name | `registration_lead` row; OTP sent; `onboarding_progress` created at step 1 with empty `draft_json` | I | P0 |
| KYC-002 | Step 1 validation matrix | Lead verified | Submit each invalid variant of business name, entity type, turnover band | Field-level errors exactly per Part 2 | I | P1 |
| KYC-003 | Step 2 GSTIN happy path | Step 1 complete | Enter `06ABCDE1234F1Z5` | Provider mock returns ACTIVE + name match; `verification_check` row `PASS`, `attempt_no = 1`; step marked complete | I | P0 |
| KYC-004 | Step 2 GSTIN name mismatch | — | Enter a `…Z2` GSTIN | Check `NEEDS_REVIEW`; step blocked; message names the mismatch and offers "upload GST certificate instead" | I | P0 |
| KYC-005 | Step 2 GSTIN cancelled | — | `…Z3` | `FAIL`; blocking reason verbatim: "The GSTIN you entered is cancelled on the GST portal." Onboarding set `NEEDS_FIX` | I | P0 |
| KYC-006 | Step 2 PAN-inside-GSTIN mismatch (VR-006) | PAN `ABCDE1234F` entered | GSTIN embedding `ZZZZZ9999Z` | Blocked with the VR-006 message before any provider call is made | I | P0 |
| KYC-007 | Step 2 CIN required for Pvt Ltd | entity_type = PRIVATE_LIMITED | Submit without CIN | 422 "CIN is required for a Private Limited company." | I | P1 |
| KYC-008 | Step 2 CIN forbidden for proprietorship | entity_type = PROPRIETORSHIP | Submit a CIN | 422 per VR-012 | I | P2 |
| KYC-009 | Step 2 Udyam optional + classification pairing | — | Udyam without classification | 422 per VR-016 | I | P2 |
| KYC-010 | Step 3 pincode auto-fill and lock | — | Enter `122015` | City `Gurugram`, state `Haryana (06)` auto-filled, read-only | E | P1 |
| KYC-011 | Step 3 GSTIN-state vs address-state | GSTIN `06…` | Enter a Delhi address as the registered address | 422 VR-004 with both states named | I | P0 |
| KYC-012 | Step 3 facility GPS capture | — | Capture facility GPS outside India | 422 VR-040 | I | P2 |
| KYC-013 | Step 4 penny-drop exact match | — | Account ending `0000` | `PASS`; ₹1 credit reference stored; account masked to last 4 in every later read | I | P0 |
| KYC-014 | Step 4 penny-drop fuzzy 0.82 | Account `…0001` | Submit | `NEEDS_REVIEW`; queued to ops; vendor sees "We're verifying your bank details — usually within 4 hours" | I | P0 |
| KYC-015 | Step 4 penny-drop name mismatch | `…0002` | Submit | `FAIL`; verbatim blocking reason names the returned beneficiary name | I | P0 |
| KYC-016 | Step 4 account-number confirm mismatch | — | Mismatched confirm field | Client-side block; paste disabled on the confirm field | E | P2 |
| KYC-017 | Step 4 exactly one primary account | Two accounts added | Mark both primary | DB partial unique index rejects the second; UI switches the flag atomically | I | P1 |
| KYC-018 | Step 5 document-age rule | — | Upload a bank statement dated 95 days ago | 422 VR-072 with both dates in the message | I | P0 |
| KYC-019 | Step 5 registration cert not age-limited | — | Upload a GST certificate dated 2019 | Accepted | I | P1 |
| KYC-020 | Step 5 upload hardening | — | Upload a 5.1 MB file; a `.png` with PDF magic bytes; a PDF containing `/JavaScript`; an SVG; a 60 MP image | Each rejected with the VR-061…VR-066 message; each attempt audit-logged; nothing lands outside quarantine | I | P0 |
| KYC-021 | Step 5 EXIF strip | — | Upload a JPEG with GPS EXIF | Stored object has zero EXIF; a subsequent download contains no GPS | I | P0 |
| KYC-022 | Step 6 sourcing declaration required | — | Submit without the "goods lawfully acquired / not stolen" declaration | 422; the declaration text is stored verbatim with a timestamp | I | P1 |
| KYC-023 | Step 7 agreement + consent | All prior steps complete | Accept | `agreement` row with version, IP, UA, timestamp; consent rows per purpose; PDF generated and downloadable | I | P0 |
| KYC-024 | Step 7 cannot be reached early | Step 4 incomplete | Direct POST to step 7 | 409 `ONBOARDING_STEP_OUT_OF_ORDER` listing the missing steps | I | P0 |
| KYC-025 | **Save-and-resume from `draft_json`** | Mid-step-4 with partial data | Log out, log back in 3 days later | Every previously-entered field is restored from `draft_json`, including the un-submitted partial step; the wizard opens at step 4; **no sensitive value (account number, password) is restored from a client cache** — they come from the server draft, encrypted at rest | E, I | P0 |
| KYC-026 | Draft never contains raw secrets | Draft with a bank account | Read `draft_json` directly | Account number stored encrypted; password/OTP never present | I | P0 |
| KYC-027 | Draft expiry | Draft untouched 90 days | Resume | Draft purged; vendor restarts with lead intact; notified in advance at day 60 and 83 | I | P2 |
| KYC-028 | **`NEEDS_FIX` with a verbatim blocking reason** | Ops rejects step 5 with reason "Cancelled cheque image is illegible — the account number is not readable." | Vendor opens the portal | Status `NEEDS_FIX`; the reason string is rendered **verbatim, unmodified, un-truncated** next to the exact offending document; only that step is re-openable; other completed steps stay locked | E, I | P0 |
| KYC-029 | `NEEDS_FIX` resubmission | KYC-028 | Re-upload a legible cheque and resubmit | Status returns to `UNDER_REVIEW`; a new `verification_check` with `attempt_no = 2`; the prior attempt is retained, not overwritten | I | P0 |

### 3.2.2 Verification mechanics, retries, provider errors

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| KYC-030 | **`PROVIDER_ERROR` ≠ `FAIL`** | — | GSTIN `…Z9` (503) | `verification_check.result = 'PROVIDER_ERROR'`; onboarding **stays** `IN_PROGRESS`, **not** `NEEDS_FIX`; message: "We couldn't reach the GST portal just now — we'll retry automatically. You can continue with the next step." | I | **P0** |
| KYC-031 | Provider timeout | `…Z8` (30 s hang) | Submit | Client-side abort at 15 s; `PROVIDER_ERROR`; no duplicate charge/attempt recorded | I | P0 |
| KYC-032 | Automatic retry with backoff | KYC-030 | Advance the clock through the retry schedule (1m, 5m, 15m, 1h, 6h) | 5 attempts, each with an incrementing `attempt_no`, each logged in `integration_log`; on the 3rd the mock returns ACTIVE → `PASS` | I | P0 |
| KYC-033 | Retry exhaustion escalates to a human, not a rejection | Provider down for all attempts | Exhaust retries | Status `MANUAL_REVIEW`, assigned to ops with the provider's raw error; the vendor is never told they failed verification | I | P0 |
| KYC-034 | `attempt_no` monotonic per (entity, check_type) | Mixed passes/fails | 6 mixed attempts | `attempt_no` = 1..6 with no gaps and no reuse; unique constraint on `(subject_id, check_type, attempt_no)` | I | P1 |
| KYC-035 | Attempt cap per check type | — | 10 manual GSTIN attempts in 24 h | 11th → 429; ops notified of possible abuse | I | P1 |
| KYC-036 | Provider-error taxonomy is exhaustive | — | Table-driven over every mocked failure mode | Every mode maps to exactly one of `PASS / FAIL / NEEDS_REVIEW / PROVIDER_ERROR`; an unmapped code defaults to `PROVIDER_ERROR` (fail-safe, never a false `FAIL`) | U | P0 |
| KYC-037 | Idempotent verification calls | — | Submit the same GSTIN twice within 60 s | One outbound provider call (cached); one attempt row | I | P1 |
| KYC-038 | Blacklist check on approval | V_DELTA's PAN on the blacklist | Ops attempts approval | Blocked with the blacklist reason; audit-logged; approval impossible without an `ADMIN` override + reason | I | P0 |
| KYC-039 | Duplicate-entity detection | A vendor with the same PAN already approved | New vendor submits it | Flagged `POSSIBLE_DUPLICATE`; both records linked; ops must resolve before approval | I | P1 |
| KYC-040 | Approval emits `vendor.verified` | All checks PASS, ops approves | Approve | Event `vendor.verified` on the bus; vendor module creates the profile; listing becomes possible; audit trail complete | I | P0 |
| KYC-041 | GSTIN 180-day re-verification | Approved vendor, `clock.advance(181d)` | Nightly job | Re-check queued; on `CANCELLED` the vendor is suspended from new listings and ops is alerted; existing orders are unaffected | I | P1 |
| KYC-042 | Expiring documents surface | Document expiring in 25 days | Nightly job | Row appears in `v_expiring_documents`; vendor notified at 30/15/3 days | I | P1 |
| KYC-043 | Consent withdrawal | Consent given | Withdraw a non-essential consent | Recorded with timestamp; marketing notifications stop; transactional ones continue; contractual consents cannot be withdrawn while an agreement is live | I | P2 |

### 3.2.3 Buyer 5-step onboarding

Steps: **1** Account & OTP · **2** Business & GSTIN (optional) · **3** Addresses (billing + delivery) · **4** Users & approval policy · **5** Terms & consent.

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| KYC-050 | Buyer step 1 | None | Mobile + email + OTP | Account created, org in `DRAFT` | I | P0 |
| KYC-051 | Buyer step 2 with GSTIN | — | Enter a valid GSTIN | Verified; org marked B2B; ITC narration enabled on future invoices | I | P0 |
| KYC-052 | Buyer step 2 without GSTIN | — | Skip | Allowed; org marked non-ITC; a nudge explains the ITC consequence once, without dark-pattern pressure | I | P1 |
| KYC-053 | Buyer step 3 billing vs delivery | — | Add a Maharashtra billing address and a Karnataka delivery address | Both stored; the Bill-To/Ship-To case is derived at order time, not fixed here | I | P0 |
| KYC-054 | Buyer step 3 non-serviceable pincode | Pincode `796001` | Add as delivery | 422 VR-036 with an alternative-address prompt | I | P1 |
| KYC-055 | Buyer step 4 approval policy | — | Set threshold ₹1,00,000 and two approvers | Policy stored; orders above the threshold require approval (see ORD-030) | I | P0 |
| KYC-056 | Buyer step 4 invite users | — | Invite 3 users with roles | Invitations expire in 7 days, single-use, role-scoped | I | P1 |
| KYC-057 | Buyer step 5 terms | — | Accept | Versioned acceptance stored; buyer can transact | I | P0 |
| KYC-058 | Buyer save-and-resume | Mid-step 3 | Return later | Draft restored identically to KYC-025 | E | P1 |
| KYC-059 | Buyer `NEEDS_FIX` | Ops rejects the GST certificate | Buyer opens the portal | Verbatim reason shown; only that step re-opens | E | P1 |
| KYC-060 | Buyer instant activation without KYC docs | Prepaid buyer, no credit requested | Complete 5 steps | Can browse and buy immediately; credit application is a separate later flow | I | P1 |

## 3.3 `customer` — buyer profiles, preferences, credit, saved searches

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| CUS-001 | Profile update audit | B_ORG1 | Change billing contact | Old and new values in the audit log with actor | I | P2 |
| CUS-002 | Approval policy CRUD | BUYER_ADMIN | Create/edit/delete policies | Only BUYER_ADMIN may; changes do not retroactively affect in-flight approvals | I | P1 |
| CUS-003 | Approval policy threshold boundary | Threshold ₹1,00,000 | Orders of ₹99,999.99 / ₹1,00,000.00 / ₹1,00,000.01 | Third requires approval; second does not (threshold is exclusive, documented) | U, I | P0 |
| CUS-004 | Credit application submission | B_ORG2 | Submit with financials | `credit_application` created; documents follow VR-072 | I | P1 |
| CUS-005 | Credit limit set by FINANCE only | — | OPS attempts | 403; FINANCE succeeds with a mandatory reason | I | P0 |
| CUS-006 | Credit limit decrease below exposure | Exposure ₹4,00,000 | Set the limit to ₹3,00,000 | Allowed with a warning; **no new orders**; existing orders unaffected; buyer notified | I | P1 |
| CUS-007 | Exposure computation | 2 unpaid invoices, 1 confirmed unbilled order, 1 credit note | Read exposure | `Σ unpaid invoices + Σ unbilled confirmed orders − Σ open credit notes`, exact to the paisa | U, I | P0 |
| CUS-008 | Saved search notification | Saved search on "ThinkPad T14 grade A" | New matching listing goes live | Notification within the batch window; contains no vendor identity | I | P2 |
| CUS-009 | Preferences default | New org | Read preferences | Defaults from `platform_config`; no marketing opt-in pre-ticked (dark-pattern rule) | I | P1 |
| CUS-010 | Buyer user deactivation | User with an open cart and a pending approval | Deactivate | Sessions revoked; cart released; pending approvals reassigned to another approver, not silently dropped | I | P1 |

## 3.4 `vendor` — profiles, capability, facilities, payout preferences

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| VEN-001 | Profile created on `vendor.verified` | KYC-040 | Consume the event | Profile exists with tier BRONZE by default; no listing possible before this | I | P0 |
| VEN-002 | Facility add requires an address + hours | — | Add a facility | Address FK enforced; operating hours validated (`open < close`, overnight allowed with a flag) | I | P1 |
| VEN-003 | Facility GPS used for QC geo-variance | Facility at (28.4595, 77.0266) | Later used by QC-014 | The stored coordinate is the reference for the 500 m rule | I | P0 |
| VEN-004 | Payout preference change requires OTP | Vendor owner | Change the payout bank account | Step-up OTP with purpose `BANK_CHANGE` (VR-055); a new penny-drop is mandatory; payouts held for 24 h with a notification to the old and new contacts | I | P0 |
| VEN-005 | Capability declaration limits listing | Vendor declares "laptops only" | Attempt to list a spare part | 422 `CAPABILITY_NOT_DECLARED` | I | P2 |
| VEN-006 | Vendor tier affects QC sampling | GOLD vs BRONZE | Create visits | Sampling percentage resolves from `qc_sampling_rule` for the tier effective on the visit date | I | P1 |
| VEN-007 | Vendor suspension stops new listings | V_DELTA suspended | Attempt to publish | 403 with the suspension reason; existing confirmed orders proceed to fulfilment | I | P0 |
| VEN-008 | Vendor scorecard is internal-only | Scorecard exists | Sweep customer endpoints for the rating field | Never present (IDN-080 covers the token; this asserts the specific field name) | I | P0 |
| VEN-009 | Vendor sees only aggregate anonymised benchmarks | V_ALPHA | View the scorecard | Own metrics + percentile band; **no other vendor's identity or absolute numbers** | I | P1 |
| VEN-010 | Vendor cannot see buyer identity | V_ALPHA with a live PO | `GET /vendor/purchase-orders/:id` | Ship-To address is present (goods must reach it) but the buyer's legal name is replaced by the platform's consignee reference unless the delivery address inherently discloses it; buyer contact phone is a masked platform relay number | I | P0 |

## 3.5 `catalog` — brand/series/model/SKU, condition images

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| CAT-001 | SKU uniqueness | Existing SKU | Create an identical spec combination | 409 VR-097; DB unique index proven by raw insert | I | P0 |
| CAT-002 | SKU request workflow | Vendor needs a missing model | Submit a SKU request | Request queued to catalog ops; vendor may attach the unit to the request but cannot list until approved | I | P1 |
| CAT-003 | Model attribute validation | — | RAM 96 GB on a SKU that offers 8/16/32 | 422 VR-096 | I | P1 |
| CAT-004 | **No vendor photographs anywhere** | Vendor uploads attempted | POST any image to a listing endpoint as a vendor | 403 `VENDOR_IMAGES_NOT_ACCEPTED`; the endpoint does not exist on the vendor router | I | P0 |
| CAT-005 | Condition image library resolution | Grade A, chassis colour silver, 14" | Resolve images for an offer | Returns the platform's own library set for (form factor, grade, colour); deterministic; identical for two units of the same SKU+grade | I | P0 |
| CAT-006 | Condition image fallback | Missing colour variant | Resolve | Falls back to the neutral set; logs a gap for the content team; never renders a broken image | I | P1 |
| CAT-007 | Catalog change log | Edit a model spec | Read the change log | Before/after, actor, timestamp; live listings referencing the SKU are flagged for re-validation | I | P1 |
| CAT-008 | HSN mapping | SKU created | Read the tax attributes | HSN `84713010`, rate 18% resolved from the effective-dated table, not hard-coded | I | P0 |
| CAT-009 | Search index build | 120 SKUs seeded | Rebuild the tsvector | Index contains brand/series/model/spec terms only; **CAT-009b** asserts vendor columns are absent (see IDN-087) | I | P0 |
| CAT-010 | Faceted filter correctness | Mixed inventory | Filter brand=Lenovo, grade=A, RAM≥16, price 30k–60k | Result set equals the SQL ground truth computed independently in the test | I | P1 |

## 3.6 `listing` — listings, units, serials, tier prices, stock

### 3.6.1 Serial number uniqueness (DB-authoritative)

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LST-001 | Serial format matrix | — | 30 candidate serials across VR-076 | Accept/reject exactly per catalogue; placeholder blocklist enforced | U | P0 |
| LST-002 | Serial normalisation | — | Submit `abc-123 456` | Stored as `ABC123456`; the normalised form is what the unique index sees | U, I | P0 |
| LST-003 | Duplicate serial for the **same** vendor | V_ALPHA has live unit `SN00001` | Add `SN00001` again | 409 with VR-077 message | I | P0 |
| LST-004 | **Duplicate serial across vendors** | V_ALPHA has live `SN00001` | V_BETA adds `SN00001` | 409; V_BETA's error must **not** reveal which vendor holds it: "Serial number SN00001 is already registered on gorefurbo." | I | **P0** |
| LST-005 | **Duplicate live serial fails at the DB, not just the app** | V_ALPHA has live `SN00001` | Bypass the service entirely: raw `INSERT INTO listing.unit(...)` with the same serial and `status = 'LIVE'` | Postgres raises `unique_violation` on `uq_unit_active_serial`. The test asserts the constraint name in the error | I | **P0** |
| LST-006 | Index definition is exactly as specified | Fresh migration | Query `pg_indexes` | `uq_unit_active_serial` exists, is UNIQUE, on `listing.unit (serial_number)`, `WHERE status NOT IN ('RETURNED_TO_VENDOR','SCRAPPED')` — asserted by normalising `indexdef` | I | P0 |
| LST-007 | **Re-listing a returned unit succeeds** | `SN00001` set to `RETURNED_TO_VENDOR` | V_ALPHA creates a new unit row with `SN00001` | Succeeds — the old row is outside the partial index. Both rows coexist: one `RETURNED_TO_VENDOR`, one new | I | **P0** |
| LST-008 | Re-listing a scrapped unit succeeds | `SN00002` `SCRAPPED` | Re-add | Succeeds | I | P0 |
| LST-009 | Two returned rows plus one live | `SN00003` returned twice historically | Add a live one | Succeeds; exactly one row with a live status | I | P1 |
| LST-010 | Cannot un-return into a duplicate | `SN00001` live (from LST-007) | `UPDATE` the old returned row back to `LIVE` | `unique_violation` — the partial index catches the transition, not just the insert | I | P0 |
| LST-011 | Serial history is preserved | Unit returned and re-listed | Read the serial's history | Both lifecycles visible to ops with dates, vendor, QC reports; the buyer sees only the current one | I | P1 |
| LST-012 | Concurrent insert of the same serial | — | Two parallel transactions insert `SN99999` | Exactly one commits; the other gets `unique_violation` mapped to a 409, not a 500 | I | P0 |
| LST-013 | Bulk upload partial failure | CSV of 50 serials, #37 duplicates a live serial | Upload | Row-level result: 49 accepted, 1 rejected with the row number and reason; **no partial-aggregate corruption** — the accepted rows are committed, the rejected row is reported, and `qty_total` matches the accepted count | I | P0 |
| LST-014 | Serial ↔ SKU binding immutable after QC pass | Unit QC-passed | Change its SKU | 409 `UNIT_LOCKED_AFTER_QC` | I | P1 |
| LST-015 | Serial search by ops | — | Ops searches `SN00001` | Returns every historical row across vendors with full identity; the same search on the buyer API returns 404 | I | P0 |

### 3.6.2 Stock arithmetic and the quantity constraint

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LST-020 | **Constraint exists and is enforced** | Fresh migration | Raw `UPDATE listing.listing SET qty_available = qty_total + 1` | `check_violation` on the constraint implementing `qty_available + qty_reserved + qty_awaiting_qc + qty_qc_failed <= qty_total` | I | **P0** |
| LST-021 | Each component non-negative | — | Raw update setting `qty_reserved = -1` | `check_violation` | I | P0 |
| LST-022 | Reserve moves available→reserved | 10 available | Reserve 3 | available 7, reserved 3, sum unchanged, `stock_movement` row written with a reason and actor | I | P0 |
| LST-023 | QC intake moves total→awaiting_qc | 10 units added | Units await QC | `qty_awaiting_qc = 10`, `qty_available = 0`; not sellable | I | P0 |
| LST-024 | QC pass moves awaiting→available | 10 awaiting | 8 pass, 2 fail | available 8, qc_failed 2, awaiting 0, total 10 | I | P0 |
| LST-025 | Every mutation writes a movement row | 12 distinct mutation types | Execute each | 12 `stock_movement` rows; Σ signed deltas reconciles to the current quantities exactly | I | P0 |
| LST-026 | Stock arithmetic property test | — | 1,000 random legal operation sequences (fast-check) | The invariant holds after every step; totals reconcile to the movement ledger | U | P0 |
| LST-027 | Release on cancellation | 3 reserved | Cancel the order | reserved 0, available 3; units returned to `LIVE` | I | P0 |
| LST-028 | Dispatch decrements total | 3 reserved | Dispatch | reserved 0, total 7; units `DISPATCHED` | I | P0 |
| LST-029 | Cart soft reservation expiry | Cart holds 2 for 15 min | `clock.advance(15m 1s)`; sweeper runs | Released; buyer notified on the next page view; no double release if the sweeper runs twice | I | P1 |
| LST-030 | `v_stock_drift` zero rows | Seeded DB after a full journey | Query the view | Zero rows: `qty_*` on every listing equals the count of units in the corresponding statuses | I | P0 |
| LST-031 | Drift injected is detected | Raw update breaking the tie between units and counters (constraint still satisfied) | Query `v_stock_drift` | ≥ 1 row identifying the listing and both numbers | I | P0 |

### 3.6.3 Pricing, tiers, sellability

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LST-040 | Tier overlap rejected by the DB | Tier 1–15 exists | Raw insert of tier 10–20 | `exclusion_violation` on the GiST EXCLUDE constraint (VR-089) | I | P0 |
| LST-041 | Tier adjacency allowed | Tier 1–10 exists | Insert 11–20 | Accepted | I | P1 |
| LST-042 | Open-ended tier | Tier 21–NULL exists | Insert 25–30 | Rejected (overlaps the unbounded range) | I | P1 |
| LST-043 | Tier monotonicity | 1–10 @ ₹40,000 | Add 11–20 @ ₹41,000 | 422 VR-090 | U, I | P1 |
| LST-044 | Tier gap detection | 1–5 and 10–20 | Publish | 422 VR-091 naming quantities 6–9 | I | P1 |
| LST-045 | Tier price selection | Tiers 1–9 ₹40k, 10–19 ₹38k, 20+ ₹36k | Price a cart of 1, 9, 10, 19, 20, 100 | ₹40k, ₹40k, ₹38k, ₹38k, ₹36k, ₹36k | U | P0 |
| LST-046 | Margin floor guard rail | Payout ₹30,000, logistics ₹700 | Set retail ₹30,900 | Blocked; message states the computed minimum ₹32,000 (max(₹500, 4%)=₹1,200 → 30,000+700+1,200) | U, I | P0 |
| LST-047 | Price-jump guard rail | Live at ₹40,000 | Change to ₹55,000 (+37.5%) | Requires a reason + manager approval; stays live at the old price until approved | I | P0 |
| LST-048 | Market-band guard rail | 30-day median ₹40,000 | Set ₹14,000 (−65%) | Blocked pending review; ops alerted (possible fraud/typo) | I | P1 |
| LST-049 | MARGIN unit price must exceed purchase | V_GAMMA unit, purchase ₹25,000 | Set retail ₹25,000 | 422 VR-088; DB `CHECK` also proven by raw insert | I | P0 |
| LST-050 | Price history append-only | 5 price changes | Read history | 5 rows with actor, reason, effective range; no updates or deletes possible | I | P1 |
| LST-051 | **`v_sellability_drift` seal-less-unit bug fixed** | Unit QC-passed, `is_sellable = TRUE`, **no seal row** | Query `v_sellability_drift` | The unit **appears** as drift. The view uses `COALESCE(s.status IN ('APPLIED','INTACT'), FALSE)` so a NULL seal no longer silently passes (schema gap #3). Test asserts the view's SQL text contains the COALESCE and that the row is returned | I | **P0** |
| LST-052 | `is_sellable` composite rule | Vary QC pass, report validity, seal state, stock, vendor status, price presence | 24-case truth table | `is_sellable` matches the table on every combination; the offers grid shows exactly the sellable set | U, I | P0 |
| LST-053 | Expired QC removes from sale | Report `valid_until` = today | `clock.advance(1d)`; nightly job | `is_sellable = FALSE`, status `QC_EXPIRED`; disappears from the grid; a cart containing it warns the buyer | I | P0 |
| LST-054 | Grade correction updates price band | Grade corrected A→B | Apply | Listing re-priced per the price book for grade B, or unpublished if no B price exists; vendor notified | I | P0 |
| LST-055 | Publish requires everything | Missing seal / missing price / expired doc / unverified vendor | Attempt publish in each state | Blocked with the specific missing precondition named | I | P0 |

## 3.7 `qc` — visits, tool runs, reports, seals, sampling, audit

### 3.7.1 Tool-run ingestion, idempotency, replay

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| QC-001 | Signed report accepted | Registered tool provider with an Ed25519 key | POST a valid signed report | 201; `tool_run` + `qc_report` + area results + hardware detected persisted in one transaction | I | P0 |
| QC-002 | Invalid signature rejected | — | Flip one byte of the signature | 401 `SIGNATURE_INVALID`; nothing persisted; `integration_log` records the attempt with the payload hash (not the payload) | I | P0 |
| QC-003 | Unknown provider | — | Sign with an unregistered key id | 401; no provider enumeration in the message | I | P0 |
| QC-004 | Canonicalisation | — | Same payload with re-ordered keys and different whitespace | Signature still verifies (JCS canonical JSON); a semantically different payload does not | U | P0 |
| QC-005 | **Idempotency via `UNIQUE (tool_provider_id, tool_run_id)`** | Report `run-A1` ingested | POST byte-identical `run-A1` again | 200 (not 201) returning the **original** `qc_report_id`; exactly one `tool_run` row; no second report, no duplicate stock movement, no second `qc.report.completed` event | I | **P0** |
| QC-006 | Same `tool_run_id`, **different** provider | Provider P1 used `run-A1` | Provider P2 posts `run-A1` | Accepted — uniqueness is on the pair | I | P0 |
| QC-007 | Same `tool_run_id`, same provider, **different body** | `run-A1` ingested | POST `run-A1` with different results | 409 `TOOL_RUN_CONFLICT`; original preserved; ops alerted (indicates tampering or a tool bug) | I | P0 |
| QC-008 | DB-level idempotency | — | Raw insert duplicating `(tool_provider_id, tool_run_id)` | `unique_violation`; the constraint, not the service, is the guarantee | I | P0 |
| QC-009 | **Nonce replay protection** | Report with nonce `N1` ingested | Re-post with nonce `N1` and a *new* `tool_run_id` | 409 `NONCE_REPLAY`; audit event; the second report is not created | I | P0 |
| QC-010 | Nonce window | Nonce `N1` used | `clock.advance(24h 1s)`; reuse `N1` | Accepted (window elapsed); the nonce store is pruned; pruning does not open a replay hole inside the window | I | P1 |
| QC-011 | Timestamp freshness | — | `generated_at` at −11 min and +11 min | Both 422 `REPORT_STALE`; ±9 min accepted | I | P0 |
| QC-012 | Unsupported `schema_version` | — | Post `schema_version = "9.9"` | 422 listing supported versions; nothing persisted | I | P1 |
| QC-013 | Malformed / truncated / oversized payload | — | 8 adversarial bodies (truncated JSON, 20 MB body, deeply nested, NaN, duplicate keys, null area scores, negative battery %, unknown enum) | Each 400/422 with a machine-readable code; no 500; no partial persistence | I | P0 |
| QC-014 | Offline queue and late upload | Technician app offline | Queue 12 reports, reconnect, sync | All 12 ingested exactly once even with a mid-sync connection drop and retry; idempotency keys carry through | I, E | P0 |
| QC-015 | Ingestion is transactional | Force a failure while writing photos | Post a report | Whole ingestion rolls back; no orphan `tool_run`; a retry succeeds and produces exactly one report | I | P0 |

### 3.7.2 Verdict, grading, mismatch

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| QC-020 | **`serial_matches = FALSE` stops the unit** | Declared `SN00001`, tool detects `SN00777` | Ingest | Unit status `SERIAL_MISMATCH_HOLD`, `is_sellable = FALSE`; **no seal may be applied**; `qc_mismatch` row created; vendor and ops notified; the unit cannot be published by any path (verified by attempting publish → 409) | I | **P0** |
| QC-021 | Serial mismatch cannot be self-resolved by the vendor | QC-020 state | Vendor attempts to "confirm" the serial | 403 — only ops may resolve, and resolution requires a re-visit with a new tool run | I | P0 |
| QC-022 | Grade computation truth table | Tolerance rules seeded | 40 combinations of cosmetic area scores, battery health, cycle count, functional failures | Computed grade matches the table exactly; below-B → `QC_FAILED`, never listed | U | P0 |
| QC-023 | Grade boundaries | Battery 85/84.9, cycles 300/301 | Compute | A+ at 85 and 300; A at 84.9 and 301 — boundary direction documented and asserted | U | P0 |
| QC-024 | Functional failure overrides cosmetics | Perfect cosmetics, keyboard fault | Compute | `QC_FAILED` regardless of cosmetic scores | U | P0 |
| QC-025 | **Declared-vs-detected mismatch: 16 GB declared, 8 GB detected** | V_ALPHA declared 16 GB RAM, grade A, payout ₹32,000 | Ingest a report detecting 8 GB | (a) `qc_mismatch` row `RAM_MISMATCH` with declared/detected values; (b) the unit is re-bound to the **8 GB SKU** (or held if no such SKU exists); (c) `grade_correction` created with the recomputed grade and the recomputed payout per the price book; (d) the vendor is notified with both values, the new grade, the new payout and the 2-day response window; (e) the unit is **not sellable** until the correction applies or the vendor accepts; (f) the customer-facing spec, if it were ever published, shows 8 GB — never the declared 16 GB | I, E | **P0** |
| QC-026 | Mismatch categories | Storage, CPU, GPU, screen size, OS, RAM, battery, serial | One report per category | Each produces the correct `qc_mismatch` type and the correct downstream action per the mismatch policy table | I | P0 |
| QC-027 | Vendor disputes a correction | QC-025 within 48 h | Vendor disputes with a reason | Correction moves to `DISPUTED`; a re-verification visit is scheduled; auto-apply is suspended | I | P0 |
| QC-028 | **Grade correction auto-applies after 2 days** | Correction notified at T | `clock.advance(48h)`; run the scheduler | Correction status `AUTO_APPLIED`; `grade_actual` and payout updated; audit records "auto-applied after 2 days without vendor response"; vendor notified. At T+47h59m nothing happens | I | **P0** |
| QC-029 | Auto-apply is idempotent | QC-028 | Run the scheduler 3 more times | No further changes, no duplicate ledger or notification | I | P0 |
| QC-030 | Vendor accepts early | Correction pending | Vendor accepts at T+2h | Applied immediately; auto-apply job later finds nothing to do | I | P1 |
| QC-031 | Correction changes the sale price | Applied A→B | Read the offer | Retail re-priced per the grade-B band; margin floor re-validated; if the floor fails, the listing is unpublished and ops alerted | I | P0 |

### 3.7.3 Report validity, currency, expiry

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| QC-035 | `valid_until` = completed + 90 days | Report completed 2026-06-01 12:00 IST | Read | `valid_until` = 2026-08-30 12:00 IST; computed server-side; a client-supplied value is ignored | U, I | P0 |
| QC-036 | `valid_until` immutable | — | Attempt to update it | Rejected by trigger/service; audit-logged | I | P0 |
| QC-037 | **`QC_EXPIRED` transition at 90 days** | Unit live with a report expiring today | `clock.advance` past `valid_until`; run the nightly job | Unit status `QC_EXPIRED`, `is_sellable = FALSE`, removed from the grid, vendor notified, a re-QC visit suggested. A unit already `RESERVED` for a confirmed order is **not** expired out from under the order — it is flagged for ops instead | I | **P0** |
| QC-038 | Expiry at the boundary | `valid_until` = T | Job at T−1s and T+1s | No change, then expired | I | P0 |
| QC-039 | Re-QC restores sellability | Expired unit | New passing visit and report | New report `is_current = TRUE`, old one FALSE, new 90-day window, unit sellable again | I | P0 |
| QC-040 | **Exactly one current report per unit** | Unit with report R1 current | Raw insert of R2 with `is_current = TRUE` | `unique_violation` on `uq_qcrep_current`; the service path instead demotes R1 and promotes R2 inside one transaction | I | **P0** |
| QC-041 | Index definition assertion | Fresh migration | Query `pg_indexes` | `uq_qcrep_current` is UNIQUE on `qc.qc_report(unit_id) WHERE is_current` | I | P0 |
| QC-042 | Concurrent report promotion | Two reports promoted concurrently for one unit | Run in parallel | One succeeds, one fails cleanly with 409; never two current | I | P0 |
| QC-043 | Public QC report redaction | Current report | `GET /offers/:id/qc-report` | Area scores, battery %, grade, test date, validity present; serial, technician name, facility name, GPS, vendor id absent | I | P0 |

### 3.7.4 Seals

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| QC-050 | Seal format and roll ownership | T_ONE holds roll `GRF-26HR-0004800…0004899` | Apply `GRF-26HR-0004821` / `GRF-26HR-0005000` | First accepted; second 422 "This seal isn't from your issued roll." | I | P0 |
| QC-051 | Seal uniqueness | Seal used on unit 1 | Apply to unit 2 | 409; DB unique proven by raw insert | I | P0 |
| QC-052 | **Lifecycle APPLIED → INTACT → BROKEN** | Seal applied | Verify at pickup (→ INTACT), then report tamper (→ BROKEN) | Each transition allowed, timestamped, actor-attributed, photo-evidenced | I | P0 |
| QC-053 | Illegal transitions | Seal BROKEN | Attempt BROKEN→INTACT, BROKEN→APPLIED, INTACT→APPLIED, VOID→INTACT | All 409 `IllegalStateTransition`; asserted at both the service and the DB trigger | I | P0 |
| QC-054 | VOID window | Seal applied 10 min ago / 20 min ago | Void with a reason | First allowed, second refused (15 min cap) | I | P1 |
| QC-055 | **Broken seal forces VIA_HUB routing** | Unit sealed, seal reported BROKEN before dispatch | Compute routing | `routing_decision = 'VIA_HUB'`; the direct-dispatch path returns 409 `SEAL_BROKEN_REQUIRES_HUB`; a shipment cannot be created direct-to-customer; ops sees the reason on the exception queue | I | **P0** |
| QC-056 | Broken seal blocks sale | Live unit, seal broken | Read the offer / attempt to add to cart | `is_sellable = FALSE`; add-to-cart 409 | I | P0 |
| QC-057 | Seal-less unit is not sellable | QC-passed unit with no seal | Attempt publish; query the drift view | Publish 409 VR-104; `v_sellability_drift` returns the unit (LST-051) | I | P0 |
| QC-058 | Seal photo mandatory | Applying a seal | Submit without a seal photo | 422; seal not recorded | I | P1 |
| QC-059 | Seal verified at delivery | Delivered with an intact seal | Rider confirms | Custody event recorded; a broken seal at delivery opens a return under Rule 7(4) automatically | I | P0 |

### 3.7.5 Visits, sampling, audit recheck, geo

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| QC-065 | Visit assignment respects certification | T_TWO's certification expired | Assign a visit | 422 `TECHNICIAN_NOT_CERTIFIED`; ops sees why | I | P0 |
| QC-066 | Visit counters | 20 units scheduled | Complete 17, fail 2, skip 1 | `visit.units_planned/completed/failed/skipped` reconcile exactly; asserted after each step (schema gap #2 — application-enforced, so tested hard) | I | P0 |
| QC-067 | Visit cannot close with pending units | 3 units unreported | Close the visit | 409 listing the pending serials | I | P0 |
| QC-068 | **5% audit recheck sampling** | GOLD tier rule = 5%; 200 units passed in the period | Run the sampling job | 10 units selected (`ceil(200 × 0.05)`); selection is random but reproducible from a stored seed; the same unit is not selected twice in a period; `audit_recheck` rows created and assigned to `T_THREE` (auditor), never the original technician | I | **P0** |
| QC-069 | Sampling boundary | 1 unit, 5% | Run | `ceil(0.05) = 1` — at least one unit is always sampled when the population is non-empty | U | P0 |
| QC-070 | Sampling rule resolution | Rules for BRONZE 20%, SILVER 10%, GOLD 5%, effective-dated | Run for each vendor tier and two dates | Correct percentage per tier per effective date; `UNIQUE (vendor_tier, effective_from)` proven by raw insert (VR-151) | I | P0 |
| QC-071 | **Technician divergence** | Original: grade A, battery 88%. Auditor: grade B, battery 71% | Complete the recheck | `audit_recheck.divergence = TRUE` with a per-field diff; a `grade_correction` is raised from the auditor's result; the original technician's accuracy score drops; at 3 divergences in 30 days the technician is auto-suspended from new visits and ops is notified | I | **P0** |
| QC-072 | Divergence within tolerance | Original grade A, auditor grade A, battery 88 vs 86 | Complete | No divergence (battery tolerance ±3 pp from `qc_tolerance_rule`); no correction | I | P1 |
| QC-073 | Auditor cannot audit their own work | T_THREE performed the original | Assign the recheck | 422; reassigned to another auditor | I | P0 |
| QC-074 | **Geo-variance > 500 m alert** | Facility at (28.4595, 77.0266); report GPS at 1.4 km away | Ingest | `GEO_VARIANCE` alert with the computed distance (Haversine); the visit is flagged `NEEDS_REVIEW`; reports are still ingested (evidence is not destroyed) but units are held from sale pending ops clearance | I | **P0** |
| QC-075 | Geo boundary | 499 m / 500 m / 501 m | Ingest each | No alert, no alert, alert (strictly greater) | U | P0 |
| QC-076 | Missing GPS | Report with no GPS | Ingest | Treated as variance (fail-closed): flagged, held, ops notified | I | P0 |
| QC-077 | GPS spoofing heuristics | Identical GPS to 6 dp across 40 reports, or impossible travel between two visits 200 km apart 10 min apart | Ingest | `GPS_ANOMALY` flag; visits queued for review | I | P1 |
| QC-078 | Photo GPS captured before EXIF strip | QC photo with GPS EXIF | Ingest | `qc.photo.gps_lat/lng` populated; stored object EXIF-free (VR-065) | I | P0 |
| QC-079 | Wipe certificate | Unit with data-bearing storage | Complete QC | A wipe certificate (standard + method + timestamp + operator) is mandatory before sellability; missing → not sellable | I | P0 |
| QC-080 | Re-verification visit | Disputed correction (QC-027) | Schedule and complete | New tool run, new report becomes current, dispute resolved with the outcome recorded either way | I | P1 |

## 3.8 `ordering` — cart, order, approval, sub-orders, allocation

### 3.8.1 Cart and pricing

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| ORD-001 | Add to cart reserves softly | 5 available | Add 2 | Soft hold for 15 min; `qty_available` shown to others reflects the hold | I | P1 |
| ORD-002 | Cart re-prices on tier crossing | Tiers per LST-045 | Increase quantity 9 → 10 | Unit price drops to the tier-2 price; the change is shown explicitly before checkout (no drip pricing) | E | P0 |
| ORD-003 | Cart with a now-unsellable item | Item expires QC while in the cart | Open the cart | Item marked unavailable with the reason; checkout blocked until removed; **no silent substitution** | E | P0 |
| ORD-004 | Multi-vendor cart splits | Items from V_ALPHA and V_BETA | Checkout | One `order` and two `sub_order`s; the buyer sees one order and two dispatches from "Supply Point A" and "Supply Point B" | I, E | P0 |
| ORD-005 | Price shown = price charged | Any cart | Compare the grid, cart, checkout and invoice | Identical to the paisa; all charges (tax, freight, handling) shown before the pay button — **no drip pricing** (CCPA 2023) | E | P0 |
| ORD-006 | No dark patterns at checkout | Checkout page | Automated scan | No countdown timers, no "only 2 left!" scarcity counters, no pre-ticked add-ons, no confirm-shaming copy, no forced continuity; the cancel/back path is as prominent as the CTA | E | P0 |
| ORD-007 | Cart quantity bounds | — | Add 0, 501, 1,000,000, −1 | Each rejected per VR-082/VR-116 | I | P1 |

### 3.8.2 **Order confirmation transaction — concurrency and oversell**

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| ORD-010 | **Two buyers race for the last unit** | Listing with `qty_available = 1`; buyers B_ORG1 and B_ORG2 both at checkout | Fire both `POST /orders/confirm` simultaneously (barrier-synchronised threads, 20 repetitions) | Exactly **one** 201 and one 409 `INSUFFICIENT_STOCK`, every time. Final state: `qty_available = 0`, `qty_reserved = 1`, exactly one `order_line_unit`, exactly one unit `RESERVED`, exactly one PO raised, exactly one `order.confirmed` event. **Zero oversell in 20/20 runs** | I | **P0** |
| ORD-011 | Redis lock is per-listing and held for the whole check-decrement | — | Instrument the lock | The lock key is `lock:listing:{id}`, acquired before the availability read and released after the decrement commits; TTL 10 s; the lock is never released before commit | I | P0 |
| ORD-012 | Lock timeout does not oversell | Lock TTL forced to expire mid-transaction | Race | The DB constraint (LST-020) still prevents oversell; the losing transaction fails with `check_violation` mapped to 409 — the lock is an optimisation, **the constraint is the guarantee** | I | **P0** |
| ORD-013 | Redis unavailable | Redis down | Confirm an order | Falls back to `SELECT … FOR UPDATE` on the listing row; still no oversell; latency degrades; an alert fires. The system does **not** confirm orders unlocked | I | P0 |
| ORD-014 | 20 buyers, 5 units | `qty_available = 5` | 20 concurrent confirmations | Exactly 5 succeed, 15 get 409; sum of allocated units = 5; no deadlock; p99 under 3 s | I, L | P0 |
| ORD-015 | Race across two listings of the same SKU | Two listings, 1 unit each | 4 concurrent orders | Exactly 2 succeed; each takes a distinct unit; locks are acquired in a deterministic order (by listing id) to prevent deadlock | I | P0 |
| ORD-016 | Multi-line order locks in sorted order | Cart with 3 listings | Two mirrored concurrent orders with reversed cart order | No deadlock across 50 repetitions; both complete or one fails cleanly with 409 | I | P0 |
| ORD-017 | Deadlock is retried, not surfaced | Force a Postgres deadlock | Confirm | Retried up to 3 times with jitter; only after exhaustion does the buyer see a retryable error; never a 500 with a stack | I | P1 |
| ORD-018 | Isolation level | — | Inspect the transaction | `READ COMMITTED` with explicit row locks (documented), or `REPEATABLE READ` with serialization-failure retry — whichever is chosen is asserted so it cannot change silently | I | P0 |
| ORD-019 | **Constraint holds under sustained concurrency** | 500 units, 200 virtual buyers | k6 for 5 min | `qty_available + qty_reserved + qty_awaiting_qc + qty_qc_failed <= qty_total` verified after every 1,000 orders and at the end; units sold ≤ units available; zero constraint violations reaching the user as 500s | L, I | **P0** |
| ORD-020 | Idempotent confirmation | Client sends `Idempotency-Key: K1` | POST twice (including a simulated network retry after a successful commit) | One order created; the second returns the same order with 200; no double stock decrement, no duplicate PO | I | P0 |
| ORD-021 | **Partial-fail rollback of the confirmation transaction** | Cart valid; force each step to throw in turn: (a) stock decrement, (b) order insert, (c) `order_line_unit` allocation, (d) unit status update, (e) **PO creation**, (f) `order_event` write, (g) event emission | 7 separate runs, each injecting a failure at one step | In every run: **nothing** persists — no order, no sub-order, no lines, no allocations, no PO, no stock change, no event delivered to any subscriber. `qty_*` are byte-identical to the pre-state. The buyer receives a clean 500/409 with a retry token. A subsequent retry succeeds and creates exactly one of everything | I | **P0** |
| ORD-022 | Event emission is transactional | Force a crash after commit but before the in-process event fan-out | Confirm | The event is delivered via a transactional outbox on recovery — exactly once; **or**, if emitted in-transaction, subscribers see committed data only (asserted by a subscriber that reads the order back) | I | P0 |
| ORD-023 | Allocation picks specific units deterministically | 10 units, mixed QC dates | Order 3 | FIFO by QC completion date (oldest report first, to minimise expiry risk); documented and asserted; the allocated serials are recorded in `order_line_unit` | I | P0 |
| ORD-024 | Allocation never picks an unsellable unit | Mixed pool including expired-QC, broken-seal, serial-mismatch, awaiting-QC units | Order | Only sellable units allocated; asserted per unit | I | P0 |
| ORD-025 | Confirmation writes one PO per vendor | Cart from 2 vendors, 3 lines each | Confirm | Exactly 2 POs, each with 3 PO lines, each priced at the **vendor payout price** (not retail); linked to the sub-order | I | P0 |
| ORD-026 | Credit-limit check inside the transaction | B_ORG2 limit ₹5,00,000, exposure ₹4,80,000 | Two concurrent ₹30,000 orders | Exactly one succeeds; the credit row is locked `FOR UPDATE`; final exposure ≤ limit. **Concurrent orders cannot jointly breach the limit** | I | **P0** |
| ORD-027 | Credit-limit boundary | Exposure ₹4,70,000, limit ₹5,00,000 | Orders of ₹30,000.00 and ₹30,000.01 | First accepted, second 409 with the exact overage in the message | I | P0 |
| ORD-028 | Cancellation restores everything | Confirmed order | Cancel before dispatch | Stock restored, units `LIVE`, PO cancelled, event emitted, credit exposure released, ledger untouched (no money moved yet) | I | P0 |

### 3.8.3 Approvals, RFQ, events

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| ORD-030 | Approval required above the threshold | B_ORG2, threshold ₹1,00,000 | Place a ₹1,50,000 order | Status `PENDING_APPROVAL`; stock **is** reserved during the approval window (documented) with a 48 h TTL; approver notified | I | P0 |
| ORD-031 | Self-approval blocked | Creator is also an approver | Approve own order | 403 VR-123; DB `CHECK` proven by raw update | I | P0 |
| ORD-032 | Two-step approval | Policy requires 2 approvals | Approve once, then again by a second approver | Confirms only after the second; the same approver cannot count twice | I | P0 |
| ORD-033 | Approval expiry | Pending 48 h | `clock.advance` | Order expires, stock released, buyer and approver notified | I | P1 |
| ORD-034 | Rejection with a reason | Approver rejects | — | Reason stored and shown verbatim to the creator; stock released | I | P1 |
| ORD-035 | RFQ lifecycle | Buyer raises an RFQ for 200 units | Ops quotes, buyer accepts | Quote has `valid_from/valid_to` (VR-125); acceptance after expiry → 409; acceptance creates an order at the quoted price, bypassing the tier table | I | P1 |
| ORD-036 | Order event timeline | Full journey | Read `order_event` | Every state change present, ordered, actor-attributed, partition-routed correctly; the buyer-facing timeline contains no vendor identity | I | P0 |
| ORD-037 | Order status transition table | — | Attempt all 90 (from × to) pairs | Only the legal set succeeds; each illegal one raises `IllegalStateTransition` and is audit-logged | U, I | P0 |

## 3.9 `procurement` — POs, vendor invoices, goods receipts, payouts, price books

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PRC-001 | PO raised on `order.confirmed` | ORD-025 | — | PO in `RAISED`; number series gapless per FY; vendor notified; PDF generated | I | P0 |
| PRC-002 | **PO carries the payout price, the customer invoice carries retail** | Order ₹42,000 retail, payout ₹32,000 | Read the PO and the customer invoice | PO line ₹32,000; Invoice-2 line ₹42,000; neither document contains the other's number | I | P0 |
| PRC-003 | PO acknowledgement SLA | PO raised | Vendor does not acknowledge in 4 h | Escalation to ops; vendor scorecard penalty; the order is re-sourceable to another vendor with the buyer's price honoured | I | P1 |
| PRC-004 | Vendor invoice (Invoice-1) matching | PO ₹32,000 | Vendor uploads an invoice for ₹32,000 / ₹33,500 / ₹31,000 | Exact → 3-way match passes; over → mismatch queued to finance; under → accepted with a note; tolerance is config-driven and asserted at the boundary | I | P0 |
| PRC-005 | Invoice-1 GST validation | Vendor GSTIN Haryana, platform GSTIN Delhi | Vendor invoices with CGST+SGST | Rejected — the correct head for this movement is IGST (POS = Bill-To = platform's Delhi registration, s.10(1)(b)); reason explained to the vendor | I | P0 |
| PRC-006 | MARGIN vendor raises no GST | V_GAMMA (unregistered) | Upload an invoice | GST fields must be zero; a non-zero GST from an unregistered vendor is rejected; **no ITC row is created** | I | P0 |
| PRC-007 | Goods receipt on delivery | Delivered order | — | `goods_receipt` created against the PO; quantity reconciled with the shipped serials | I | P0 |
| PRC-008 | Payable created and aged | GRN done | — | `vendor_payable` with a due date = `delivered_at + inspection_window`; ageing buckets correct | I | P0 |
| PRC-009 | **Payout eligibility gate** | Delivered today, 5-day window | Attempt a payout run today; then at day 5 and day 6 | Not eligible, not eligible, eligible (VR-155); an open return or dispute holds it regardless of date | I | P0 |
| PRC-010 | **Payout run — full computation** | V_ALPHA: 3 eligible POs, gross ₹96,000; FY-to-date purchases ₹49,80,000; penalty ₹500 for a late pickup; adjustment ₹0 | Execute the run | Threshold crossing: only ₹46,000 of the ₹96,000 exceeds ₹50,00,000 → TDS = 0.1% × ₹46,000 = **₹46.00**; net = 96,000 − 46 − 500 = **₹95,454.00**; balanced ledger pairs written; `payout` row created; batch sums to zero inside the same transaction | I | **P0** |
| PRC-011 | **TDS threshold boundary** | FY purchases at ₹49,99,999 then a ₹2 purchase | Compute | TDS applies only to ₹1 (the amount exceeding ₹50,00,000) = ₹0.001 → rounded per policy to ₹0.00 with the residue carried; asserted to the paisa | U | P0 |
| PRC-012 | **TDS 5% with no PAN** | V_GAMMA, no PAN, ₹60,00,000 FY purchases, current bill ₹1,00,000 | Compute | 5% on the excess portion, not 0.1%; the payout advice states "TDS @5% — PAN not furnished (s.206AA)"; the vendor is warned at 3 earlier thresholds | I | **P0** |
| PRC-013 | TDS on value **excluding** GST | Invoice ₹1,00,000 + ₹18,000 GST | Compute | TDS base = ₹1,00,000 | U | P0 |
| PRC-014 | TDS switched off below the turnover test | `platform_config.tds_applicable = false` | Run | Zero TDS; the payout advice omits the TDS line entirely | I | P0 |
| PRC-015 | TDS at credit or payment, whichever is earlier | Payable credited in month 1, paid in month 2 | Run | Deducted in month 1; not deducted again in month 2; Form 26Q data for month 1 with section code **1031** | I | P0 |
| PRC-016 | Form 26Q extract | A quarter of payouts | Generate | One row per deductee per section with PAN, amount paid, TDS, dates; totals reconcile to the ledger exactly | I | P1 |
| PRC-017 | Payout run atomicity | Force a failure mid-run on vendor 7 of 12 | Execute | Whole run rolls back or is checkpointed per vendor (documented choice: **per-vendor sub-transaction**, so vendors 1–6 are paid and 7–12 are retried); the ledger stays balanced under either outcome; no partial payout for any single vendor | I | **P0** |
| PRC-018 | Payout run idempotency | Run executed | Re-run for the same period | Zero new payouts; the run is marked executed and is not re-executable | I | P0 |
| PRC-019 | Concurrent payout runs | Two operators trigger runs simultaneously | — | Advisory lock allows exactly one; the other gets 409 `PAYOUT_RUN_IN_PROGRESS` | I | P0 |
| PRC-020 | Negative net carries forward | Penalties ₹1,20,000 vs gross ₹96,000 | Run | Payout not created; a `vendor_debit_balance` of ₹24,000 carries to the next run; `net_amount >= 0` `CHECK` never violated (VR-145) | I | P0 |
| PRC-021 | Penalty application | Late pickup, failed QC-at-source rate, wrong item | Apply each | Each penalty has a rule id, a computed amount, an evidence link, and is disputable by the vendor within 7 days | I | P1 |
| PRC-022 | Price book resolution | Price books by SKU × grade × vendor tier, effective-dated | Resolve for 6 combinations, including a date boundary | Exactly one applicable row each; overlapping books rejected at write time (VR-148) | I | P0 |
| PRC-023 | Margin rule resolution | Rules by category/tier with floors | Compute retail from payout | Deterministic; matches LST-046; a change to a margin rule does not retroactively alter live orders | U, I | P0 |
| PRC-024 | Vendor payout statement anonymity (reverse direction) | V_ALPHA statement | Read | Contains own POs, own prices, own TDS; **contains no buyer legal name and no retail price** — the vendor must not learn the platform's margin | I | **P0** |
| PRC-025 | GSTR-2B reconciliation for REGULAR purchases | 10 REGULAR invoices, 8 present in the 2B fixture | Run monthly reconciliation | 8 matched, 2 flagged with the vendor named; ITC claimed only on matched; the report is exportable | I | P1 |
| PRC-026 | **MARGIN purchases excluded from the reconciliation and the ITC ledger** | 5 MARGIN purchases | Run reconciliation | Zero MARGIN rows in the ITC candidate set; a raw insert linking a MARGIN unit to an ITC ledger row is rejected by the DB guard (VR-132) | I | **P0** |
| PRC-027 | Per-serial purchase price for MARGIN | MARGIN intake of 10 units | Read | Each unit has its own `purchase_price`; a bulk average is impossible (NOT NULL per unit for MARGIN) | I | P0 |
| PRC-028 | `valuation_method` immutability | REGULAR unit | Raw `UPDATE … SET valuation_method = 'MARGIN'` | Rejected by trigger (VR-133); audit-logged | I | P0 |

## 3.10 `payment` — invoices, GST, e-way bills, ledger, refunds, credit notes

### 3.10.1 Double-entry ledger

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PAY-001 | **`chk_ledger_single` enforced** | Fresh migration | Raw inserts: (debit 100, credit 100), (debit 0, credit 0), (debit −5, credit 0), (debit 100, credit 0), (debit 0, credit 100) | First three rejected with `check_violation` on `chk_ledger_single CHECK ((debit > 0) <> (credit > 0))`; last two accepted | I | **P0** |
| PAY-002 | Constraint definition assertion | — | Read `pg_constraint.consrc` / `pg_get_constraintdef` | Matches the specified expression exactly | I | P0 |
| PAY-003 | **Batch sums to zero** | Any money event | Post a batch | `SUM(debit) = SUM(credit)` per `batch_id`, asserted **inside** the writing transaction; a deliberately unbalanced batch raises `LedgerImbalance` and rolls back the whole transaction | I | **P0** |
| PAY-004 | **`v_ledger_imbalance` returns zero rows** | Full seeded journey: 40 orders, payments, refunds, credit notes, payouts, penalties, write-offs | Query the view | **Zero rows.** Run after every L2 money test file as a global teardown assertion | I | **P0** |
| PAY-005 | Injected imbalance is detected | Raw insert of a single unpaired row with a new batch id | Query the view | Exactly one row naming the batch and the delta | I | P0 |
| PAY-006 | Ledger is append-only | Posted entry | Attempt `UPDATE`/`DELETE` | Denied at the role level; corrections are made by a reversing entry only | I | P0 |
| PAY-007 | Account taxonomy | — | Post one of each event type | Each hits the correct account pair (AR, revenue, output GST payable, input GST credit, AP, TDS payable, bank, refunds, penalties, round-off, margin-scheme output GST) per the chart-of-accounts fixture | U, I | P0 |
| PAY-008 | Reversal | Posted batch | Reverse it | Mirror-image batch; net balance zero; original preserved; both linked | I | P0 |
| PAY-009 | Trial balance | Full journey | Compute | Assets = Liabilities + Equity to ₹0.00; matches the independently computed fixture | I | P0 |
| PAY-010 | Concurrency | 50 concurrent money events | Execute | All batches balanced; no lost update; `v_ledger_imbalance` still zero | I, L | P0 |

### 3.10.2 Rounding and precision

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PAY-015 | No floats in the money path | — | semgrep + a runtime type assertion on every money field | All money values are `Prisma.Decimal` / `NUMERIC(14,2)`; a `number` reaching a money field throws | U, I | P0 |
| PAY-016 | Half-up rounding | Values ending .005, .015, .025, .125 | Round | Half-**up** at 2 dp, consistently (asserted so a library change cannot silently switch to banker's rounding) | U | P0 |
| PAY-017 | **500-line order with no drift** | Order with 500 lines, unit prices chosen to produce repeating decimals (e.g. ₹33,333.33 at 18%, quantities 1–7), mixed tiers | Compute the invoice | `Σ(rounded line taxable) = invoice taxable`; `Σ(rounded line tax) = invoice tax`; `taxable + tax + round_off = grand total`; `|round_off| ≤ ₹0.99`; and the ledger for the invoice balances to ₹0.00. **Total drift across all 500 lines = ₹0.00 beyond the single round-off line** | U, I | **P0** |
| PAY-018 | Rounding is line-level, not total-level | Same order | Compare against a total-level rounding implementation | The chosen convention (line-level) is asserted explicitly; the alternative produces a different number, proving the test is meaningful | U | P0 |
| PAY-019 | Percentage arithmetic | Discounts, TDS, margin | 30 cases | Computed in Decimal end-to-end; never via float multiplication | U | P0 |
| PAY-020 | Currency display | ₹1,00,000.50 | Render | Indian digit grouping (lakh/crore), 2 dp, ₹ symbol, consistent everywhere (grid, cart, invoice, PDF, email) | U, E | P1 |

### 3.10.3 GST computation and the Bill-To-Ship-To table

Platform holds GST registrations in **Delhi (07)** and **Haryana (06)**. Invoice-1 = vendor → platform. Invoice-2 = platform → customer. POS on Invoice-1 under **s.10(1)(b) IGST Act** = location of the third person (**Bill-To** = the platform registration on the PO). POS on Invoice-2 = **Ship-To** location.

| ID | Scenario | Vendor | Platform reg. on PO | Bill-To (customer) | Ship-To | Invoice-1 head | Invoice-2 head | Pri |
|---|---|---|---|---|---|---|---|---|
| PAY-025 | Both inter-state | V_ALPHA (HR 06) | Delhi (07) | B_ORG1 Delhi | Delhi | **IGST** (HR→DL) | **CGST+SGST** (DL→DL) | P0 |
| PAY-026 | Both intra-state | V_ALPHA (HR 06) | Haryana (06) | B_ORG3 Haryana | Haryana | **CGST+SGST** (HR→HR) | **CGST+SGST** (HR→HR) | P0 |
| PAY-027 | Intra then inter | V_ALPHA (HR 06) | Haryana (06) | B_ORG1 Delhi | Delhi | **CGST+SGST** (HR→HR) | **IGST** (HR→DL) | P0 |
| PAY-028 | Inter then inter | V_ZETA (KA 29) | Delhi (07) | B_ORG6 Tamil Nadu | Tamil Nadu | **IGST** (KA→DL) | **IGST** (DL→TN) | P0 |
| PAY-029 | **Three-state Bill-To ≠ Ship-To** | V_ALPHA (HR 06) | Delhi (07) | B_ORG4 **Maharashtra (27)** | **Karnataka (29)** | **IGST** (HR→DL) | **IGST**, POS = **Karnataka (29)** — POS follows Ship-To, not the customer's billing state; the invoice shows POS `29-Karnataka` while the recipient's GSTIN is a `27` GSTIN | P0 |
| PAY-030 | MARGIN channel | V_GAMMA (unregistered, HR) | Haryana (06) | B_ORG3 Haryana | Haryana | **No Invoice-1 GST** (unregistered supplier) | **CGST+SGST on the margin only** | P0 |

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PAY-031 | Split exclusivity at the DB | — | Raw inserts: IGST+CGST both > 0; all three > 0; CGST > 0 with SGST = 0 | Each rejected by `CHECK` (VR-128) | I | **P0** |
| PAY-032 | CGST = SGST exactly | Taxable ₹42,000 @18% | Compute | CGST ₹3,780.00, SGST ₹3,780.00, IGST ₹0.00, total tax ₹7,560.00 | U | P0 |
| PAY-033 | IGST full rate | Taxable ₹42,000 @18% | Compute | IGST ₹7,560.00, CGST ₹0.00, SGST ₹0.00 | U | P0 |
| PAY-034 | Odd-paisa half split | Taxable ₹1,000.05 @18% → ₹180.009 | Compute | Tax ₹180.01; CGST ₹90.01 and SGST ₹90.00 (documented allocation of the odd paisa to CGST); `cgst + sgst = total tax` exactly | U | **P0** |
| PAY-035 | Rate from the effective-dated table | Rate changes on a date | Invoice on either side of it | Correct rate each side; no hard-coded 18 anywhere (grep assertion) | U, I | P0 |
| PAY-036 | POS derived, never user-supplied | — | Send a POS in the request body | Ignored; server-derived; asserted for both invoices | I | P0 |
| PAY-037 | Reverse charge is not applicable | Unregistered vendor supply of goods | Compute | No RCM liability created for laptops from an unregistered supplier under the current law state; the code path exists but is config-gated off and asserted off | I | P1 |
| PAY-038 | Invoice mandatory particulars | Any Invoice-2 | Extract the PDF text | Supplier name/address/GSTIN (platform), invoice no. + date, recipient name/address/GSTIN, POS, HSN, description, qty, unit, taxable value, rate, tax amounts by head, total in figures and words, signature/DSC block, "Tax Invoice" title — all present | I | P0 |
| PAY-039 | Invoice numbering gapless | 200 invoices across two series and an FY rollover | Generate | Strictly monotonic, gapless per series per FY, correct FY prefix after 1 April, no duplicates under 20-way concurrency | I | P0 |
| PAY-040 | B2C-format invoice | Buyer without a GSTIN | Generate | No recipient GSTIN, no ITC narration; POS still present | I | P1 |

### 3.10.4 MARGIN vs REGULAR valuation

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PAY-045 | **MARGIN taxable value** | Purchase ₹25,000, sale ₹30,000, rate 18%, `margin_is_tax_inclusive = true` (default) | Compute | Margin ₹5,000.00 → taxable ₹4,237.29, GST ₹762.71 (CGST ₹381.36 / SGST ₹381.35 per PAY-034), invoice total ₹30,000.00. With the flag false: taxable ₹5,000.00, GST ₹900.00, total ₹30,900.00. The active convention is asserted, and switching it is a config change with its own test | U | **P0** |
| PAY-046 | Non-positive margin blocked | Purchase ₹25,000, sale ₹25,000 | Attempt | Blocked at listing (VR-088) and again at invoicing; `CHECK` proven by raw insert | I | P0 |
| PAY-047 | **Rule 32(5) narration present** | MARGIN invoice | Extract the PDF text and the JSON payload | Contains verbatim: *"Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase."* Byte-exact string comparison | I | **P0** |
| PAY-048 | Narration absent on REGULAR | REGULAR invoice | Extract | The Rule 32(5) string does not appear | I | P0 |
| PAY-049 | **MARGIN unit never enters the ITC ledger** | MARGIN purchase posted | (a) inspect the ledger for the batch; (b) raw-insert an ITC ledger row referencing the MARGIN unit; (c) run the GSTR-2B reconciliation | (a) no input-GST-credit account line exists; (b) rejected by the DB guard; (c) the unit is absent from the ITC candidate set (PRC-026) | I | **P0** |
| PAY-050 | No mixing on one invoice | Cart with one REGULAR and one MARGIN unit | Checkout | Two invoices generated (VR-134); the buyer sees one order, two tax invoices, with the reason explained; a forced single-invoice insert is rejected | I | P0 |
| PAY-051 | MARGIN pool is a distinct SKU pool | Same SKU, both channels live | Browse | Presented as separate offers with distinct prices and an ITC note; the tier/price logic does not mix pools | I, E | P1 |
| PAY-052 | ITC on REGULAR purchases | REGULAR purchase, Invoice-1 with IGST ₹5,760 | Post | Input-GST-credit account debited ₹5,760; appears in the 2B reconciliation set | I | P0 |
| PAY-053 | Margin scheme output GST account | MARGIN sale | Post | Output GST posted to the dedicated margin-scheme output account, distinguishable in the GSTR-1 extract | I | P1 |
| PAY-054 | GSTR-1 extract | A month of both channels | Generate | B2B, B2CL, B2CS and HSN summary tables reconcile to the ledger to ₹0.00; MARGIN rows appear at their margin taxable value, not their gross | I | P1 |

### 3.10.5 Bill-To-Ship-To documents and the e-way bill

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PAY-060 | **Two invoices, one movement** | Confirmed order, V_ALPHA → B_ORG4 | Complete the flow | Exactly two invoices exist for the movement: Invoice-1 (vendor→platform, ₹32,000 + tax) and Invoice-2 (platform→customer, ₹42,000 + tax). They are linked by `movement_id` | I | **P0** |
| PAY-061 | **One e-way bill, Case 2 field mapping** | PAY-060 | Generate the EWB | Exactly one EWB with: **Bill From = TrueTech Services Pvt. Ltd.** (platform GSTIN), **Dispatch From = V_ALPHA's address** (Gurugram, PIN 122015), **Bill To = B_ORG4** (Maharashtra GSTIN), **Ship To = the Karnataka delivery address**, **Document = Invoice-2**, **Value = Invoice-2 value (₹49,560)**. Each field asserted individually against the generated payload | I | **P0** |
| PAY-062 | **Vendor's purchase price never travels with the goods** | PAY-061 | Extract the text of every document accompanying the consignment — EWB payload + printout, Invoice-2 PDF, packing slip, shipping label, carrier manifest, carrier API payload, delivery-confirmation email/SMS | The string `32,000` / `32000` / the payout figure in any format appears **nowhere**; Invoice-1 is not in the accompanying set; the shipping label's "sender" is the platform with the dispatch address only. A generated-token sweep (as in IDN-080) covers vendor identity as well | I | **P0** |
| PAY-063 | Second EWB refused | EWB exists for the shipment | Generate again | 409 VR-136; unique on `shipment_id` proven by raw insert | I | P0 |
| PAY-064 | **₹50,000 threshold — exclusive boundary** | Consignment values ₹49,999.99, ₹50,000.00, ₹50,000.01 | Evaluate | No EWB, **no EWB**, EWB required. The exclusivity is asserted explicitly | U, I | **P0** |
| PAY-065 | Threshold basis | Invoice value ₹49,560 (₹42,000 + ₹7,560) | Evaluate | Basis is invoice value **including GST**; no EWB. A 2-unit order (₹99,120) requires one | U | P0 |
| PAY-066 | Dispatch blocked without a required EWB | Value ₹99,120, no EWB | Attempt dispatch | 409 `EWAY_BILL_REQUIRED`; ops queue entry | I | P0 |
| PAY-067 | Part-B and vehicle number | EWB generated | Update Part-B with `HR26DK8337` / `HR26DK83` | Accepted / rejected per VR-137 | I | P1 |
| PAY-068 | EWB validity and extension | Distance 1,850 km | Generate | Validity computed per the distance slab; an extension request inside the last 8 h is permitted, outside it is refused with the carrier's reason | C, I | P1 |
| PAY-069 | EWB cancellation window | EWB generated 25 h ago | Cancel | Refused with code `104` mapped to "An e-way bill can only be cancelled within 24 hours"; the order-cancellation flow handles this by raising a credit note instead | C, I | P0 |
| PAY-070 | EWB provider error | Provider 5xx | Generate | `PROVIDER_ERROR`, retried with backoff, ops alerted after 3 failures; dispatch stays blocked; the buyer sees "preparing for dispatch", not an error | I | P0 |
| PAY-071 | EWB on returns | Return pickup of a ₹99,120 consignment | Generate | A fresh EWB with the parties reversed and document type `Delivery Challan`/credit note as configured | I | P1 |
| PAY-072 | Multi-vendor order = multiple movements | Cart from V_ALPHA and V_BETA | Complete | Two movements, two Invoice-1s, **two** Invoice-2s (one per sub-order) or one Invoice-2 with two EWBs — the chosen design (**one Invoice-2 per sub-order**) is asserted, and each movement has exactly one EWB | I | P0 |

### 3.10.6 Payments, refunds, credit notes

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PAY-080 | Razorpay order creation | Confirmed order | Create the payment order | Amount in paise, integer, equals the invoice total × 100 exactly; receipt = our order number; notes carry no customer PII beyond the order id | C, I | P0 |
| PAY-081 | Webhook signature verification | — | Valid, tampered, and missing signatures | Only the valid one is processed; others 400 and are logged; the endpoint is constant-time comparing | I, C | P0 |
| PAY-082 | Webhook idempotency | Capture webhook `evt_1` | Deliver 5 times (mock's duplicate mode) | One payment row, one ledger batch, one confirmation email | I | P0 |
| PAY-083 | Out-of-order webhooks | `captured` arrives before `authorized` | Deliver | Final state correct; the earlier event is applied without regressing state; no negative balance | I | P0 |
| PAY-084 | Failed payment | Amount `₹1.11` | Pay | Order stays `PENDING_PAYMENT`; stock reservation held to its TTL then released; buyer can retry with a new attempt id | I | P0 |
| PAY-085 | Virtual account credit (TPV) | Smart Collect VA allocated | NEFT credit from the registered account | Matched by UTR and VA; invoice settled; ledger balanced | I, C | P0 |
| PAY-086 | Non-TPV credit rejected | Credit from an unregistered account | — | Held in an unallocated suspense account; ops notified; not applied to the invoice; refunded to source on instruction | I | P0 |
| PAY-087 | Partial credit | ₹30,000 against a ₹49,560 invoice | — | Part-payment recorded; invoice `PARTIALLY_PAID`; exposure recomputed | I | P1 |
| PAY-088 | Overpayment tolerance | ₹49,561 against ₹49,560 | — | Accepted (₹1 tolerance) with the excess to an advance account; ₹49,600 → held for ops decision | I | P1 |
| PAY-089 | Cheque / PDC | PDC recorded with a future date | Present on the date; then bounce | Bounce creates a penalty, reverses the settlement with a reversing batch, notifies the buyer, and blocks further credit orders | I | P1 |
| PAY-090 | Refund full | Captured ₹49,560 | Refund in full | Refund ≤ captured (VR-143); ledger reverses; credit note raised; GST reversed on the correct heads; customer notified | I | P0 |
| PAY-091 | Refund partial and repeated | Captured ₹49,560 | Refund ₹20,000 then ₹29,560 then ₹1 | First two succeed, third 422 "You can't refund more than was collected."; DB `CHECK` proven | I | P0 |
| PAY-092 | Refund idempotency | Refund request with a key | Retry after a timeout | One refund at the gateway and one locally; reconciled by the gateway refund id | I, C | P0 |
| PAY-093 | Credit note | Invoice ₹49,560 | Raise a ₹52,000 credit note | 422 VR-144; ₹49,560 accepted; GST reversed by head; the note carries the original invoice reference and appears in GSTR-1 | I | P0 |
| PAY-094 | Credit note on a MARGIN invoice | MARGIN invoice | Raise | Reverses the margin-scheme output GST only; carries the Rule 32(5) reference | I | P0 |
| PAY-095 | Refund SLA | Rule 7(4) refund approved | — | Initiated within the configured SLA; the timestamp chain (approved → initiated → gateway ack → credited) is recorded and reportable | I | P0 |
| PAY-096 | Settlement reconciliation | Gateway settlement file fixture | Import | Every captured payment reconciles to a settlement line; gateway fees and GST on fees posted; unmatched lines listed for finance; totals to ₹0.00 | I | P1 |

## 3.11 `logistics` — carriers, shipments, tracking, NDR, riders

### 3.11.1 Carrier adapter contract tests (recorded fixtures)

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LOG-001 | Adapter interface conformance | 6 carriers | Run the shared `CarrierPort` conformance suite against each adapter | Every adapter implements create, cancel, track, label, serviceability, rate, pickup and NDR-action with identical semantics; a missing method fails at compile time and the suite fails at runtime for unimplemented behaviour | C | P0 |
| LOG-002 | Canonical status mapping is total | Raw status-code fixtures from all 6 carriers (≈180 codes) | Map each | Every raw code maps to exactly one canonical status; **an unknown code maps to `UNKNOWN` and raises an alert — never silently to `IN_TRANSIT`** | U, C | P0 |
| LOG-003 | Fixture freshness | — | Check each cassette's capture date | Any fixture older than 180 days fails the nightly job (non-blocking) with a re-capture task | C | P2 |

**Delhivery**

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LOG-010 | **Form-encoded body shape** | — | Create a shipment | Request `Content-Type: application/x-www-form-urlencoded`, body is exactly `format=json&data=<url-encoded JSON>`; **not** a JSON body; asserted byte-wise against the recorded fixture | C | **P0** |
| LOG-011 | **Five rejected characters** | Address/name fields containing `&`, `\`, `%`, `#`, `;` | Create | Each character is stripped or substituted per the sanitiser policy **before** encoding; a round-trip test proves the delivered address remains legible and unambiguous; a raw unsanitised value is never sent | U, C | **P0** |
| LOG-012 | Sanitiser does not mangle Indian addresses | 40 real-shaped addresses (`H.No. 41/2, Sector-14`, `C/O`, `#`-prefixed house numbers common in Bengaluru) | Sanitise | `#12, 4th Cross` becomes `No.12, 4th Cross` (documented substitution), not `12, 4th Cross`; no information is lost | U | P0 |
| LOG-013 | **Case-sensitive warehouse name** | Warehouse registered as `GRF-GGN-01` | Create with `grf-ggn-01` | Carrier rejects (fixture); our adapter pre-validates against the stored exact-case name and fails fast with `WAREHOUSE_NAME_CASE_MISMATCH` before spending the call | C, I | **P0** |
| LOG-014 | Warehouse registration flow | New pickup location | Register | Exact-case name stored; a later create uses that stored string verbatim | C | P0 |
| LOG-015 | **₹500 wallet minimum** | Wallet balance ₹450 | Create a shipment | Carrier returns the low-balance error (fixture); our adapter surfaces `CARRIER_WALLET_LOW`, **fails over to the next carrier in the routing rule**, and raises a finance alert. A balance check runs every 15 min and alerts below ₹2,000 | C, I | **P0** |
| LOG-016 | **Duplicate `order_id`** | Waybill created for order `GRF-ORD-1001` | Create again with the same `order_id` | Carrier returns the duplicate error (fixture); the adapter treats it as **idempotent success**, re-fetches the existing waybill, and does not create a second shipment | C, I | **P0** |
| LOG-017 | Waybill fetch and pre-allocation | — | Fetch a waybill block | Waybills are pre-allocated and consumed exactly once; a crash between allocation and use leaves the waybill reusable, not orphaned | I | P1 |
| LOG-018 | Pickup request | — | Schedule | Cut-off honoured; a pickup after cut-off books for the next working day, accounting for the seeded holiday calendar | C, I | P1 |
| LOG-019 | Cancellation | Manifested shipment | Cancel | Succeeds pre-manifest; post-manifest returns the carrier's refusal, which is mapped to an RTO flow rather than a silent failure | C | P1 |

**Blue Dart**

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LOG-020 | **Four-secret auth assembled correctly** | Licence key, login id, API key, and the profile/area credentials | Any call | All four are present and in the right headers/body positions per the fixture; a missing one fails fast with a named error, not a 401 loop | C | P0 |
| LOG-021 | **JWT refresh on 401** | Cached JWT | Force a 401 mid-call | The adapter fetches a new JWT **once**, retries the original request, and succeeds; the new token is cached; the original request is not duplicated if it was non-idempotent (a create is retried only with the same idempotency key) | C, I | **P0** |
| LOG-022 | Refresh storm prevention | 20 concurrent calls all get 401 | — | Exactly one token refresh (single-flight); the other 19 wait and reuse it | I | P0 |
| LOG-023 | Persistent 401 | Refresh also 401 | — | Fails after one refresh attempt; `CARRIER_AUTH_FAILED`; carrier marked degraded; routing fails over; ops alerted. **No infinite retry loop** | C, I | P0 |
| LOG-024 | Token expiry pre-emption | Token expiring in 30 s | Call | Refreshed proactively; no user-visible 401 | I | P1 |

**Shiprocket**

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LOG-025 | **240 h token expiry** | Token issued at T | `clock.advance(239h)` then `(241h)` | Reused, then refreshed; the refresh is triggered by our own TTL bookkeeping, not by waiting for a 401 | C, I | **P0** |
| LOG-026 | **429 backoff** | Carrier returns 429 with `Retry-After: 30` | Call | Adapter waits per `Retry-After` (honoured exactly), then retries; without the header it uses exponential backoff with full jitter, capped at 5 attempts and 2 min total; the queue does not stall other carriers | C, I | **P0** |
| LOG-027 | 429 storm circuit breaker | 5 consecutive 429s | — | Circuit opens for 60 s; routing fails over; half-open probe restores service | I | P1 |
| LOG-028 | Aggregator courier selection | Multiple couriers returned | Create | Selection is by our routing rule (SLA then cost), not the aggregator's default; the chosen courier is recorded | C | P1 |

**Porter**

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LOG-029 | Intra-city only | Origin Gurugram, destination Bengaluru | Route | Porter is excluded by the routing rule; only intra-city 2-wheeler-eligible consignments (weight and dimension bounds asserted) may select it | U, I | P0 |
| LOG-030 | **1 request/minute tracking limit** | 10 active Porter trips | Run the tracking poller for 10 min | ≤ 10 tracking calls total (≤ 1/min globally per the documented limit); trips are polled round-robin so none starves > 12 min; webhooks are the primary source and polling is the backstop | I | **P0** |
| LOG-031 | Rate-limit budget is shared, not per-trip | — | Inspect the limiter | A single token-bucket keyed to the carrier, not to the trip | U | P0 |
| LOG-032 | **Webhook `order_reopened` moves a trip backwards** | Trip at `DELIVERED` | Receive `order_reopened` | The trip legally regresses to an active state; our canonical status moves back; **the order does not re-fire delivery side effects** — no second delivery notification, no second custody-close, no payout eligibility clock restart; an ops exception is raised; the event is recorded in the timeline as a regression with the carrier's raw payload | I, C | **P0** |
| LOG-033 | Other backward transitions | Carrier sends `OUT_FOR_DELIVERY` after `DELIVERED` without `order_reopened` | — | Rejected as out-of-order (LOG-041) and logged; only whitelisted regression events may move state backwards | I | P0 |

### 3.11.2 Shipments, idempotency, tracking

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LOG-040 | **Idempotency key on shipment creation** | Sub-order ready | Call create twice with the same key (and once with a simulated timeout after the carrier succeeded but before we recorded it) | Exactly one shipment and one waybill in all three cases; the reconciliation job detects the timeout case by querying the carrier with our `order_id` and adopts the existing waybill rather than creating a second one | I, C | **P0** |
| LOG-041 | **Out-of-order tracking events** | Events with timestamps T3, T1, T2 delivered in the order T3, T1, T2 | Ingest | Stored in full (all three rows), but the **current status** reflects the latest *event timestamp*, not the latest *arrival*; the timeline renders chronologically | I | **P0** |
| LOG-042 | **Duplicate tracking-event dedup** | The same scan delivered 4 times (same carrier event id) | Ingest | One `shipment_tracking` row; dedup key `(shipment_id, carrier_event_id)`, unique in the DB; a carrier without event ids falls back to a hash of `(status, scan_time, location)` | I | **P0** |
| LOG-043 | Near-duplicate is not dropped | Two genuine scans, same status, same minute, different locations | Ingest | Both retained | I | P1 |
| LOG-044 | Tracking partition routing | Events across a month boundary | Ingest | Rows land in the correct partition; a missing partition is created ahead of time (DATA-04) | I | P0 |
| LOG-045 | Webhook auth | Carrier webhook | Unsigned / wrong-IP / replayed | Rejected; signature or mTLS or IP allow-list per carrier; replay window 5 min | I | P0 |
| LOG-046 | Serviceability check before offer | Pincode `796001` | Read the offers grid | Offers still show but the delivery estimate says "not currently serviceable"; add-to-cart with that address is blocked with an actionable message | I, E | P1 |
| LOG-047 | Routing rule resolution | Rules by zone/weight/SLA/carrier | 12 scenarios incl. broken seal (VIA_HUB), fragile, high value, intra-city | Deterministic carrier + mode chosen; `routing_rule.carrier_code` is an FK so an unknown carrier cannot be configured (VR-158) | I | P0 |
| LOG-048 | Rate-card overlap prevented | Overlapping cards | Raw insert | `exclusion_violation` (VR-150); rate selection is therefore unambiguous | I | P0 |
| LOG-049 | Custody chain | Vendor → rider → hub → rider → customer | Complete | Every hand-off has a custody event with actor, timestamp, GPS and seal state; a gap in the chain raises an exception | I | P0 |
| LOG-050 | In-house fleet route plan | 12 stops | Plan | Stops sequenced; a rider can only act on their own assigned stops (IDN-073); re-planning mid-route preserves completed stops | I | P1 |

### 3.11.3 NDR, delivery attempts, RTO

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| LOG-055 | **NDR action legality against raw carrier codes** | NDR raised with each carrier's raw reason codes (customer unavailable, address incorrect, refused, office closed, out of delivery area, payment issue) | For each raw code, enumerate the permitted actions (reattempt, reschedule, update address, RTO, hold at hub) | The permitted set is derived from the **raw carrier code**, not from our canonical status; an action illegal for that code (e.g. "reattempt" on `OUT_OF_DELIVERY_AREA`) is refused with the carrier's own rule cited; a matrix test covers all 6 carriers × all codes | U, C, I | **P0** |
| LOG-056 | NDR action submission | Legal action chosen | Submit | Sent to the carrier in its own format; our record and the carrier's diverging is detected by the reconciliation job | C, I | P0 |
| LOG-057 | Address update during NDR | Customer supplies a new address in the same pincode / a different pincode | Submit | Same pincode allowed; different pincode requires the carrier's re-serviceability check and may force RTO; the e-way bill's Ship-To is re-validated and updated where the law requires | I | P0 |
| LOG-058 | **3 failed attempts → RTO** | Attempts 1 and 2 failed | Third attempt fails | Shipment auto-moves to `RTO_INITIATED`; no fourth attempt is possible; buyer and ops notified; the return leg is created with its own EWB where required; the order moves to the refund path under Rule 7(4) if the failure was ours | I | **P0** |
| LOG-059 | Attempt counting is per-carrier-truth | Carrier reports 3 attempts, we recorded 2 | Reconcile | The carrier's count wins for the RTO trigger; the discrepancy is logged; no double-counting of a duplicated attempt event | I | P0 |
| LOG-060 | Attempt at 2 does not trigger RTO | 2 failures | — | Still active; the buyer can reschedule | I | P0 |
| LOG-061 | RTO receipt and restock | RTO delivered back to the vendor/hub | Complete | Unit inspected, seal state recorded; if intact and QC still valid → back to `LIVE`; if broken → re-QC; stock counters reconcile; `v_stock_drift` stays empty | I | P0 |
| LOG-062 | Delivery OTP | Out for delivery | Rider requests delivery confirmation | OTP with purpose `DELIVERY` (VR-055); a LOGIN OTP does not work; 3 wrong attempts force a reschedule, not a forced delivery | I, E | P0 |
| LOG-063 | Proof of delivery | Delivered | — | Signature/photo + GPS + timestamp + seal-intact confirmation stored; the customer's copy omits vendor identity | I | P0 |
| LOG-064 | Lost in transit | Carrier declares lost | — | Claim raised, customer refunded under Rule 7(4) without waiting for the carrier claim, unit written off, ledger balanced, vendor payout unaffected (we bear it as principal) | I | P0 |

## 3.12 `platform` — returns, warranty, tickets, disputes, config, notifications, DSR

### 3.12.1 Returns and Rule 7(4)

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PLT-001 | Return **inside** the inspection window | Delivered day 0, window 5 days | Raise a "changed mind / not required" return on day 4 | Admissible per policy; reverse pickup created; refund on receipt and inspection; restocking terms applied per policy and shown before submission | I, E | P0 |
| PLT-002 | Return **outside** the window, non-Rule-7(4) reason | Day 6, "changed mind" | Raise | Refused with the exact window dates in the message (VR-153); a support ticket is offered instead; no dark-pattern friction on the refusal path | I | P0 |
| PLT-003 | Window boundary | Delivered 2026-08-20 10:00 IST, window 5 days | Raise at 2026-08-25 23:59:59 IST and 2026-08-26 00:00:00 IST | Admissible, then not — computed in Asia/Kolkata (VR-160), inclusive of the last day | U, I | **P0** |
| PLT-004 | **Rule 7(4) take-back is non-delegable and window-independent** | Delivered day 12 (window closed) | Raise a return for each of: defective, deficient, spurious, not-as-described, delivered late | **All five are accepted regardless of the window.** The platform is the responsible party on the customer's record; the resolution is our refund/replacement, and the vendor recovery is a **separate internal process invisible to the customer**. A test asserts the customer-facing payload never routes the customer to the vendor, never says "the seller will contact you", and offers no vendor contact | I, E | **P0** |
| PLT-005 | Rule 7(4) cannot be config-disabled | — | Attempt to set a config that blocks these reasons | The config key does not exist; a code path that would refuse them fails a unit test asserting the reason whitelist is a compile-time constant | U | P0 |
| PLT-006 | Late delivery = our liability | Promised SLA missed, not force majeure | Customer claims | Accepted; refund/compensation per policy; a force-majeure flag (declared by ops with evidence) is the **only** exemption, and using it requires a reason recorded in the audit log | I | P0 |
| PLT-007 | Seal broken on arrival | Delivery with a broken seal | Rider records it | An automatic Rule 7(4) return is opened without the customer needing to raise one; the customer is notified with the remedy options | I | P0 |
| PLT-008 | Return inspection outcome | Returned unit received | Inspect: (a) as sent, (b) damaged by the customer, (c) different serial returned | (a) full refund, restock after re-QC; (b) partial per policy with photographic evidence and an appeal path; (c) **fraud flow** — refund withheld, ops case opened, serial mismatch evidenced | I | P0 |
| PLT-009 | Refund timing | Return approved | — | Refund initiated within the SLA (PAY-095); the customer sees a status chain, not a black box | I | P0 |
| PLT-010 | Vendor recovery is separate | PLT-004 case | — | A vendor debit note / penalty is raised internally; its outcome does **not** gate the customer's refund | I | P0 |

### 3.12.2 Warranty

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PLT-015 | Warranty starts at delivery | Delivered 2026-08-20 | Read | `warranty_start = 2026-08-20`, `warranty_end = start + 6 months` per config (VR-149); computed server-side | I | P0 |
| PLT-016 | **Claim state machine** | In-warranty unit | Walk `RAISED → TRIAGE → APPROVED → IN_REPAIR → REPAIRED → CLOSED`; and the branches `TRIAGE → REJECTED`, `APPROVED → REPLACED → CLOSED`, `IN_REPAIR → IRREPARABLE → REFUNDED → CLOSED`, `RAISED → WITHDRAWN` | Every legal transition succeeds and is timestamped and actor-attributed; **all 40 illegal pairs** are refused with `IllegalStateTransition`; the status column has a `CHECK` (schema gap #5) proven by raw insert | U, I | **P0** |
| PLT-017 | Claim outside the warranty | Day after `warranty_end` | Raise | Refused with the end date; a paid-repair option is offered | I | P0 |
| PLT-018 | Claim on a boundary day | On `warranty_end` | Raise | Admissible (inclusive) | U | P0 |
| PLT-019 | Warranty voided by tampering | Broken seal + evidence of opening | Triage | Claim may be rejected with the evidence recorded; the customer has an appeal path; the rejection reason is shown verbatim | I | P1 |
| PLT-020 | Replacement unit inherits the remaining warranty | Replaced at day 60 of 180 | — | The new unit's warranty ends on the original end date (documented policy), and the new serial is bound to the order | I | P1 |
| PLT-021 | Warranty claim does not touch the ledger until money moves | Claim approved for repair | — | No ledger entry until a refund or a cost is booked; then balanced | I | P1 |

### 3.12.3 Tickets, disputes, config, notifications, DSR

| ID | Title | Precondition | Steps | Expected result | Type | Pri |
|---|---|---|---|---|---|---|
| PLT-025 | Ticket lifecycle and SLA | Ticket raised | Walk the state machine | `CHECK`-constrained statuses; SLA clocks by priority; breach escalation; no free-text status | I | P1 |
| PLT-026 | Dispute lifecycle | Vendor disputes a penalty | Walk | Evidence from both sides, an ops decision with a reason, and a ledger effect only on resolution | I | P1 |
| PLT-027 | `platform_config.key` uniqueness | — | Raw insert of a duplicate key | `unique_violation` (schema gap #4, VR-152) | I | P0 |
| PLT-028 | Config change audit and blast radius | Change `inspection_window_days` from 5 to 7 | — | Audited with actor and reason; **applies only to orders delivered after the change** — in-flight windows are pinned to the value captured at delivery | I | **P0** |
| PLT-029 | Feature flag isolation | Flag off | Call the gated endpoint | 404; flag state is server-side; a client-side override has no effect | I | P0 |
| PLT-030 | Notification template rendering | All templates | Render with fixture data | No unresolved placeholders, no vendor identity in customer templates (IDN-089), DLT template ids present for SMS, unsubscribe present on marketing but absent on transactional | I | P0 |
| PLT-031 | Notification log partitioning and dedup | 10,000 notifications | Send | Correct partitions; retries deduped by `(template, recipient, entity_id, idempotency_key)` | I | P1 |
| PLT-032 | Integration log redaction | All adapters | Trigger calls | Request/response bodies stored with secrets, tokens, OTPs, full account numbers and card data redacted; a fixture asserts each redaction pattern | I | P0 |
| PLT-033 | Data-subject request (access) | Buyer requests their data | Fulfil | Export contains their org's data only; contains no other tenant's data and no vendor identity; delivered via a signed, expiring link | I | P0 |
| PLT-034 | Data-subject request (erasure) vs statutory retention | Buyer requests erasure | Fulfil | Marketing/profile data erased; **invoices, e-way bills, ledger and audit rows are retained** under statutory retention with a documented legal basis, and the response says so explicitly; the DSR status column is `CHECK`-constrained | I | P0 |
| PLT-035 | Vendor scorecard computation | A quarter of activity | Compute | On-time pickup %, QC pass rate, mismatch rate, NDR contribution — each reproducible from source rows; visible to ops and to the vendor for itself only (VEN-009) | I | P1 |
| PLT-036 | Reviews moderation | Customer review submitted | Publish | No vendor identity solicited or displayed; profanity/PII filter; the platform is identified as the seller | I | P2 |

---

# PART 4 — NON-FUNCTIONAL TEST PLAN

## 4.1 Performance targets and the k6 scenarios that prove them

Environment for a gating run: staging on ECS Fargate (2 tasks × 1 vCPU / 2 GB), RDS `db.t4g.medium` Postgres 16, ElastiCache `cache.t4g.small`, seeded with **50,000 units, 8,000 listings, 120 SKUs, 6,000 orders of history**. Numbers are meaningless without that shape, so the seed hash is recorded with every run. Targets are measured **server-side** at the API edge (excluding client render) unless stated.

| ID | Target | Scenario | Load profile | Pass criteria | Pri |
|---|---|---|---|---|---|
| PERF-01 | **Offers grid < 500 ms p95** | `k6/offers-grid.js`: `GET /offers` with the default facets, then paginate 3 pages, then apply a brand + grade + price filter | 200 concurrent buyers, ramp 0→200 over 2 min, hold 10 min | p95 < 500 ms, p99 < 900 ms, error rate < 0.1%, zero 5xx | P0 |
| PERF-02 | **Search < 300 ms p95** | `k6/search.js`: `GET /search?q=` over a 500-term dictionary of real model names, misspellings and partials, with facets | 200 concurrent, 10 min | p95 < 300 ms, p99 < 600 ms; zero sequential scans on `catalog`/`listing` in `pg_stat_statements` for the search path | P0 |
| PERF-03 | **Order confirmation < 1 s p95** | `k6/order-confirm.js`: full add-to-cart → confirm, including the Redis lock, stock decrement, order + sub-order + lines + allocations, PO creation and event emission | 200 concurrent buyers over 5,000 units, 10 min | p95 < 1,000 ms, p99 < 2,000 ms; **zero oversell**; the stock constraint verified after the run; `v_stock_drift` and `v_ledger_imbalance` empty | P0 |
| PERF-04 | **200 concurrent buyers, mixed journey** | `k6/mixed-buyer.js`: 60% browse, 25% search, 10% cart, 5% confirm | 200 VUs, 30 min | All per-endpoint p95s met simultaneously; DB connections < 80% of the pool; no connection-pool exhaustion; CPU < 75% | P0 |
| PERF-05 | **50 vendors bulk-uploading serials** | `k6/vendor-bulk.js`: 50 VUs each uploading a 200-serial CSV (10,000 units total), overlapping in time, with 2% deliberate duplicates | 50 VUs, single burst | Every upload completes < 30 s p95; duplicates rejected per-row with correct row numbers; **zero serial-uniqueness violations escaping as 500s**; total accepted = 10,000 − duplicates, verified by count | P0 |
| PERF-06 | Lock contention at the last unit | `k6/last-unit.js`: 100 VUs racing for 5 units, repeated 50 times | burst | Exactly 5 succeed per round in 50/50 rounds; p95 of the losing 409 < 400 ms (fail fast, don't queue) | P0 |
| PERF-07 | QC ingestion throughput | `k6/qc-ingest.js`: signed reports with photos | 20 technicians × 30 units/hour sustained | p95 < 1.5 s per report; no ingestion backlog; idempotency holds under retry | P1 |
| PERF-08 | Payout run at scale | `k6/payout.js` (batch, not HTTP): 500 vendors × 20 POs | single run | Completes < 5 min; ledger balanced; `v_ledger_imbalance` empty; run is restartable | P1 |
| PERF-09 | 4-hour soak | `k6/soak.js`: PERF-04 profile at 60% load | 4 h | No memory growth > 10% after warm-up, no connection leak, no unbounded Redis key growth, no BullMQ queue depth growth, p95 stable within ±15% from hour 1 to hour 4 | P1 |
| PERF-10 | Cold-start and deploy | Rolling deploy under PERF-04 load | — | Zero failed requests during the deploy; drain honoured; in-flight transactions complete | P1 |
| PERF-11 | DB query budget | All gating scenarios | — | No endpoint issues > 25 queries per request; no N+1 (asserted by a query-count assertion in L2 for the 20 hottest endpoints) | P0 |
| PERF-12 | Payload budget | Offers grid | — | JSON response < 120 KB for 24 items; images served from CloudFront with correct cache headers; storefront LCP < 2.5 s on a simulated 4G Moto G4 | P1 |

## 4.2 Security test matrix — OWASP API Security Top 10 (2023)

| ID | OWASP | Concrete cases | Where | Pri |
|---|---|---|---|---|
| SEC-01 | **API1 Broken Object Level Authorization** | The full IDOR sweep IDN-060…IDN-075 plus a **generated** sweep: for every route with a path parameter, call it with an object belonging to another tenant and assert 404. New routes are enumerated from the router, so coverage cannot decay | I | P0 |
| SEC-02 | **API2 Broken Authentication** | IDN-001…IDN-030: OTP brute force, attempt caps, refresh reuse family revocation, JWT `alg:none` / `HS256`-signed-with-public-key forgery, expired and future `nbf` tokens, token from another environment's key, session fixation, logout revocation, TOTP replay | I | P0 |
| SEC-03 | **API3 Broken Object Property Level Authorization** | The anonymity whitelist suite IDN-080…IDN-094; **mass-assignment**: POST/PATCH every writable resource with extra fields (`role`, `org_id`, `credit_limit`, `valuation_method`, `is_sellable`, `grade_actual`, `price`, `status`) and assert each is ignored, not applied | I | P0 |
| SEC-04 | **API4 Unrestricted Resource Consumption** | Rate limits per identity/IP/endpoint class; pagination caps (`limit` > 200 clamped); CSV upload row cap (5,000); export job queueing; regex-DoS on search input; JSON depth/size caps; image decompression bombs (VR-066); concurrent-request caps per token | I | P0 |
| SEC-05 | **API5 Broken Function Level Authorization** | The IDN-040 role × endpoint matrix, including admin-only routes probed with every non-admin role, and HTTP-method confusion (`GET` on a `POST`-guarded route, `X-HTTP-Method-Override`) | I | P0 |
| SEC-06 | **API6 Unrestricted Access to Sensitive Business Flows** | Automated bulk-scraping of the offers grid (bot detection + rate limit + no bulk export endpoint), automated account creation (OTP + throttle), price-scraping via search pagination, order spam without payment (reservation TTL + per-org open-order cap) | I | P1 |
| SEC-07 | **API7 SSRF** | **Webhook URL fields** (carrier callback config, vendor notification URL, any admin-supplied URL): block `localhost`, `127.0.0.0/8`, `::1`, `169.254.169.254` (IMDS), `10/8`, `172.16/12`, `192.168/16`, `.internal`, non-`https` schemes, DNS names resolving to private IPs (**re-resolved at request time to defeat DNS rebinding**), redirects to private IPs (max 2 redirects, each re-validated), and a 5 s timeout with no response body echoed back | U, I | P0 |
| SEC-08 | **API8 Security Misconfiguration** | Security headers (HSTS, CSP without `unsafe-inline`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`); CORS allow-list is exact-origin, never `*`, credentials-aware; stack traces never returned; `/debug`, `/metrics`, `/actuator` not publicly routable; S3 buckets private with public-access-block on; RDS not publicly accessible; Redis requires auth + TLS; default DB role passwords absent (IDN-030); TLS 1.2+ only | I | P0 |
| SEC-09 | **API9 Improper Inventory Management** | Only one API version is routable; deprecated routes return 410; the OpenAPI spec is generated from code and a diff against the previous release is reviewed; no staging/dev host serves production data (asserted by an environment marker in every response header in non-prod) | I | P1 |
| SEC-10 | **API10 Unsafe Consumption of APIs** | Every adapter validates the provider's response against a schema before use; oversized/malformed provider responses are rejected (LOG-002, KYC-036); a provider cannot inject HTML/script into our stored data (carrier remarks, GSTIN trade name); provider redirects are not followed to private IPs; provider TLS is verified (no `rejectUnauthorized: false` anywhere — semgrep rule) | I, C | P0 |
| SEC-11 | **SQL injection via filter params** | For every list endpoint's filter, sort and search parameters (≈70 parameters), inject the standard payload set (`' OR 1=1--`, `'; DROP TABLE`, `UNION SELECT`, `pg_sleep(5)`, `%00`, unicode variants, second-order via a stored value): assert 400/422 or a literal-treated result, **never** an error revealing SQL, **never** a response-time > 2 s (blind-injection guard), and zero occurrences of the payload in `pg_stat_statements` as SQL text. Additionally: a semgrep rule forbids `$queryRawUnsafe`/string-concatenated SQL outside an audited allow-list, and every allow-listed use has a dedicated parameterisation test | I | P0 |
| SEC-12 | **XSS / content injection** | Stored XSS via vendor-entered business name, address, remarks, ticket text, review text, CSV cell (`=cmd|`, formula injection on export); reflected XSS via search terms and error echoes; CSP blocks inline execution; exported CSV cells beginning `= + - @` are prefixed | I, E | P0 |
| SEC-13 | **CSRF** | State-changing endpoints reject requests without the double-submit token; `SameSite=Strict` on the refresh cookie; JSON-only content-type enforcement rejects `text/plain` form-tricks | I | P0 |
| SEC-14 | **Upload hardening** | The whole VR-061…VR-069 set as an attack suite: 5 MB+1 byte, lying Content-Length, PDF/JS polyglot, GIFAR, SVG with script, EXIF GPS retention, zip bomb, path traversal in filename (`../../etc/passwd`), null-byte extension (`a.pdf%00.exe`), 40 MP decompression bomb, EICAR test file | I | P0 |
| SEC-15 | **JWT rotation and revocation** | Key rotation with overlapping `kid`s (old tokens valid until expiry, new tokens signed with the new key); revocation list honoured within 1 s; a revoked session's access token fails at the guard even before expiry (IDN-021); refresh family revocation (IDN-020); tokens are not accepted from the query string or a non-`Authorization` header | I | P0 |
| SEC-16 | **Secrets scanning** | `gitleaks` on every commit and on the full history; a semgrep rule for hard-coded keys, `CHANGE_ME`, `password =`, AWS key shapes, Razorpay key shapes, private-key PEM blocks; a test asserts no `.env` file is committed and that every secret is read from AWS Secrets Manager at boot with a fail-fast on a missing key | CI | P0 |
| SEC-17 | **PII and log hygiene** | A log-scrubber test drives 50 flows and greps the aggregated logs, Sentry payloads and OpenTelemetry attributes for: OTPs, passwords, JWTs, full account numbers, Aadhaar, card PANs, and vendor identity in customer-context spans. Zero matches | I | P0 |
| SEC-18 | **Encryption at rest and in transit** | Bank account numbers, TOTP secrets and tax declarations are encrypted (a raw DB read returns ciphertext); RDS and S3 encryption enabled; a test asserts the ciphertext is not the plaintext and that decryption round-trips | I | P0 |
| SEC-19 | **Dependency and container** | `npm audit` high/critical blocks; Trivy on the image (no high CVEs in the final layer); the container runs as non-root with a read-only root filesystem | CI | P1 |
| SEC-20 | **Authorization bypass via race** | Concurrent role change + privileged call; concurrent org suspension + order confirmation; concurrent credit-limit reduction + order (ORD-026) | I | P1 |

## 4.3 Accessibility — WCAG 2.2 AA

**Automated (axe-core, PR-gating, zero critical/serious):**

| ID | Surface | Routes |
|---|---|---|
| A11Y-01 | storefront public | home, offers grid, offer detail, search results, compare, static/legal |
| A11Y-02 | storefront authenticated | cart, checkout, order list, order detail, invoice view, return request, warranty claim |
| A11Y-03 | console vendor | onboarding wizard (all 7 steps), listings, bulk upload, POs, payouts, scorecard |
| A11Y-04 | console admin/ops | dashboard, vendor review queue, order exceptions, NDR queue, payout run, config |
| A11Y-05 | components | all shadcn/ui wrappers in isolation (Storybook + axe): dialog, combobox, data table, date picker, toast, tabs, stepper |

**Manual checklist, per release, recorded with pass/fail:**

| ID | Check | WCAG ref |
|---|---|---|
| A11Y-10 | Every interactive element reachable and operable by keyboard alone; no keyboard trap in the dialog, combobox, date picker or wizard | 2.1.1, 2.1.2 |
| A11Y-11 | Visible focus indicator on every focusable element, ≥ 2 px, ≥ 3:1 contrast, not obscured by sticky headers | 2.4.7, **2.4.11 Focus Not Obscured** |
| A11Y-12 | Focus order matches visual order; the wizard returns focus sensibly on step change; a dialog returns focus to its trigger on close | 2.4.3 |
| A11Y-13 | Text contrast ≥ 4.5:1, UI component contrast ≥ 3:1 — verified specifically for cyan `#17AFC5` on white, orange `#FE9D00` on white (**fails at small text — orange is CTA background only, never body text**), muted `#697586` on paper `#F4F6F8` | 1.4.3, 1.4.11 |
| A11Y-14 | Target size ≥ 24×24 CSS px with adequate spacing on all controls, including the grade badge and the QC score ring | **2.5.8 Target Size (Minimum)** |
| A11Y-15 | No drag-only interaction; the route-planning and image-comparison controls have a click/keyboard alternative | **2.5.7 Dragging Movements** |
| A11Y-16 | Authentication does not require a cognitive function test with no alternative — OTP paste is permitted, and the password field allows paste and a show/hide toggle | **3.3.8 Accessible Authentication (Minimum)** |
| A11Y-17 | Help (support contact) is in a consistent location across pages | **3.2.6 Consistent Help** |
| A11Y-18 | Previously entered information is auto-populated or selectable in multi-step forms (the onboarding wizard, checkout) | **3.3.7 Redundant Entry** |
| A11Y-19 | Screen-reader pass (NVDA/Chrome and VoiceOver/Safari): every form field has a programmatic label and error association; the error summary is announced; the offers grid announces result counts; live regions announce cart and price changes; tables have proper headers; the QC score ring has a text equivalent | 1.3.1, 4.1.3 |
| A11Y-20 | 200% zoom and 320 px reflow with no horizontal scrolling and no loss of function; tables scroll within their own container | 1.4.10 |
| A11Y-21 | `prefers-reduced-motion` honoured on every animation | 2.3.3 |
| A11Y-22 | Content is operable and readable in both light and dark rendering contexts with the canonical token set only | — |
| A11Y-23 | Expo apps: TalkBack/VoiceOver pass on the technician capture flow and the rider delivery flow; touch targets ≥ 44 pt; works in bright-sunlight high-contrast mode | — |

## 4.4 Data integrity

| ID | Assertion | Mechanism | Pri |
|---|---|---|---|
| DATA-01 | **`v_ledger_imbalance` returns zero rows** | Nightly job + a global L2 teardown after every money test file + a gating CI step against the seeded DB. Non-zero → P0 page to finance-eng, and the payout run is auto-blocked until cleared | I, job | **P0** |
| DATA-02 | **`v_stock_drift` returns zero rows** | Same cadence. A row means `listing.qty_*` disagrees with the unit-status counts. Non-zero → block new orders on the affected listing, alert ops | I, job | **P0** |
| DATA-03 | **`v_sellability_drift` returns zero rows — including the seal-less-unit fix** | Same cadence. The view must use `COALESCE(s.status IN ('APPLIED','INTACT'), FALSE)` so a unit with **no seal row** is caught (schema gap #3). Two tests: (a) the view text contains the COALESCE; (b) a seal-less `is_sellable = TRUE` unit is returned by the view (LST-051) | I, job | **P0** |
| DATA-04 | **`v_expiring_documents` returns zero rows** | Same cadence, with the definition "zero rows requiring action" — a row is expected when a document is genuinely expiring and must have an open task and a sent notification. The gating assertion is: **no expiring document exists without a corresponding open task**, and no vendor with an already-expired mandatory document is still able to publish | I, job | **P0** |
| DATA-05 | **Partitions exist ahead of the 2026-10-01 expiry** | A scheduled job (`partition_maintainer`, hourly) creates monthly partitions for `order_event`, `shipment_tracking`, `notification_log`, `integration_log` (runway to 2026-10-01) and `audit_log` (2026-11-01), maintaining **today + 90 days** of runway, plus a `DEFAULT` partition on each as a backstop | job | **P0** |
| DATA-06 | **A missing partition is detected** | Test: drop the partition covering `today + 45 days`; run the checker → it reports the gap with the table and range and exits non-zero; a monitoring alert fires. Second test: with the checker disabled, an insert dated into the gap lands in the `DEFAULT` partition **and** raises a `PARTITION_FALLBACK` warning (it must never fail the insert, and must never be silent) | I | **P0** |
| DATA-07 | Partition creation is idempotent and concurrent-safe | Run the maintainer 5× concurrently | No error; each partition created once | I | P0 |
| DATA-08 | Partition pruning works | Query with a date filter | `EXPLAIN` shows partition pruning; a query without the partition key on a large table is flagged in the query-budget test | I | P1 |
| DATA-09 | Every status column named in schema gap #5 has a `CHECK` | Raw insert of `'BANANA'` into each of the 9 columns | 9 × `check_violation` | I | P0 |
| DATA-10 | Referential integrity sweep | Nightly | Zero orphans across all FK-eligible relationships, including the newly-added `routing_rule.carrier_code` FK (VR-158) | job | P0 |
| DATA-11 | `updated_at` correctness | Every table | A trigger (or the ORM middleware, whichever is chosen) sets it on every update — asserted per table by a generated test, since schema gap #2 says nothing is trigger-enforced today | I | P0 |
| DATA-12 | Backup and restore | Weekly | A PITR restore into a scratch instance, then run DATA-01…DATA-04 against the restored copy; RTO < 1 h, RPO < 5 min, recorded | job | P0 |
| DATA-13 | Migration reversibility | Every migration | `up` then `down` then `up` on a seeded DB leaves the schema hash unchanged and the data intact for reversible migrations; irreversible ones are explicitly labelled and require a documented forward-fix plan | I | P0 |
| DATA-14 | Timezone integrity | Nightly | No `timestamp without time zone` column exists outside an allow-list; business-window arithmetic is Asia/Kolkata (VR-160) | I | P0 |
| DATA-15 | Reconciliation triangle | Nightly | Orders ↔ invoices ↔ ledger ↔ payments ↔ payouts all reconcile to ₹0.00 in aggregate for the previous day; a break produces a named report | job | P0 |

---

# PART 5 — UAT SCRIPTS

Plain-language scripts for a non-technical operations person. Run on the staging environment with the persona seed. Record the result in the **Pass / Fail** column and note anything unexpected in the margin. Do not skip a step because it "obviously works" — the point is to catch what the automated suite cannot see.

## UAT-A — Vendor onboarding and listing 50 units
Persona: sign in as the **Alpha Systems** vendor contact (credentials from the UAT sheet).

| # | Step | What you should see | Pass / Fail |
|---|---|---|---|
| UAT-A-01 | Go to the vendor sign-up page and enter the mobile number and business email from the sheet. | An OTP arrives within 30 seconds. The page shows a 60-second countdown before "Resend" becomes clickable. | ☐ |
| UAT-A-02 | Enter a wrong OTP once, then the right one. | The wrong one says the code is incorrect. The right one signs you in and opens **Step 1 of 7**. | ☐ |
| UAT-A-03 | Fill in the business name, entity type "Private Limited", and turnover band. Continue. | Step 1 turns green. Step 2 opens. | ☐ |
| UAT-A-04 | On Step 2 enter the GSTIN from the sheet. | Within a few seconds it shows "Verified" with the trade name pulled from the GST portal. | ☐ |
| UAT-A-05 | Enter a deliberately wrong GSTIN (change the last character). Try to continue. | It refuses with a clear message about the check digit — before it even tries to verify. | ☐ |
| UAT-A-06 | Put the correct GSTIN back. Enter the PAN and the CIN from the sheet. Continue. | All three verify. Step 3 opens. | ☐ |
| UAT-A-07 | On Step 3 enter PIN code **122015**. | The city (Gurugram) and state (Haryana) fill in automatically and cannot be edited. | ☐ |
| UAT-A-08 | Add the facility address and capture the location on the map. Continue. | Step 3 completes. | ☐ |
| UAT-A-09 | On Step 4 enter the bank account and IFSC from the sheet, re-typing the account number in the confirm box. | It refuses to let you paste into the confirm box. After you type it, a ₹1 test credit is sent and the name comes back matching. | ☐ |
| UAT-A-10 | On Step 5 upload a bank statement dated more than 3 months ago. | Rejected with a message naming the document date and the 90-day rule. | ☐ |
| UAT-A-11 | Upload the correct recent statement, the GST certificate, and the cancelled cheque. | All three accepted. Each shows a thumbnail. | ☐ |
| UAT-A-12 | Try to upload the 7 MB file from the sheet. | Rejected for size, with the 5 MB limit stated. | ☐ |
| UAT-A-13 | **Close the browser completely.** Wait 2 minutes. Sign back in. | You land back on Step 5 with everything you entered still there, including Step 4's bank details (masked). | ☐ |
| UAT-A-14 | Complete Step 6 (what you can supply) and Step 7 (agreement). | The agreement PDF is downloadable and shows today's date. Status becomes "Under review". | ☐ |
| UAT-A-15 | Switch to the **ops** login. Open the vendor review queue, reject the cancelled cheque with the reason "Cancelled cheque image is illegible — the account number is not readable." | The vendor's status becomes "Needs fix". | ☐ |
| UAT-A-16 | Switch back to the vendor. | The rejection reason appears **word for word**, next to the cheque. Only that upload can be changed; the other steps are locked. | ☐ |
| UAT-A-17 | Re-upload the legible cheque and resubmit. Then, as ops, approve the vendor. | Vendor status "Active". A welcome message arrives. | ☐ |
| UAT-A-18 | As the vendor, go to "Add stock", choose the ThinkPad T14 SKU, declare grade A, 16 GB RAM, and enter your expected payout of ₹32,000. | The form accepts it. There is **no option anywhere to upload a photograph**. | ☐ |
| UAT-A-19 | Download the serial CSV template. Fill in the 50 serial numbers from the sheet. Upload it. | Progress shown; 50 accepted; the listing shows "50 units awaiting QC". | ☐ |
| UAT-A-20 | Change one serial in the file to a duplicate of another vendor's live serial and upload just that row. | Rejected with the row number and a message that the serial is already registered — **without naming the other vendor**. | ☐ |
| UAT-A-21 | Try to set the retail price. | You cannot — the vendor only sets an expected payout. Price is the platform's. | ☐ |
| UAT-A-22 | Open "My listings" and try to view another vendor's listing by editing the web address. | "Not found". | ☐ |

## UAT-B — Technician completing a visit
Persona: the **technician mobile app**, signed in as T_ONE.

| # | Step | What you should see | Pass / Fail |
|---|---|---|---|
| UAT-B-01 | Open the app. Check today's visit list. | The Alpha Systems visit appears with 50 units planned and the facility address. | ☐ |
| UAT-B-02 | Tap "Start visit" while standing (or simulating) more than 1 km from the facility. | The app warns you are away from the registered location and flags the visit. | ☐ |
| UAT-B-03 | Move to the correct location and start the visit. | Started. Counters show 0 of 50 done. | ☐ |
| UAT-B-04 | Scan the first unit's serial. Run the QC tool on the laptop and let it upload. | The report arrives, the grade is calculated, and the six required photos are prompted for. | ☐ |
| UAT-B-05 | Try to finish the unit after taking only four photos. | Blocked until all six plus the seal photo are captured. | ☐ |
| UAT-B-06 | Complete the unit and apply seal `GRF-26HR-0004821`. | Seal recorded as "Applied". Unit shows "Passed, Grade A". | ☐ |
| UAT-B-07 | Try to apply a seal code from outside your issued roll. | Refused, with a message about your issued roll. | ☐ |
| UAT-B-08 | For unit 2, use the test laptop where the tool detects **8 GB** although 16 GB was declared. | The app shows the mismatch clearly with both figures, the grade is recalculated, and it tells you the vendor will be notified. The unit is **not** marked sellable. | ☐ |
| UAT-B-09 | For unit 3, use the test laptop whose serial does not match the label. | The unit is stopped. You cannot apply a seal to it. A reason is recorded. | ☐ |
| UAT-B-10 | Turn off mobile data. Complete units 4 to 8. | The app keeps working and queues the reports. | ☐ |
| UAT-B-11 | Turn data back on. | All five upload. The visit counters show 8 of 50 without any duplicates. | ☐ |
| UAT-B-12 | Try to close the visit with units still pending. | Refused, listing what is outstanding. | ☐ |
| UAT-B-13 | Complete the rest and close the visit. | Visit closed. Counters reconcile: passed + failed + skipped = 50. | ☐ |
| UAT-B-14 | Sign in as the **Alpha Systems** vendor. Open notifications. | A message about the 8 GB unit with the old grade, the new grade, the new payout, and a 2-day window to respond. | ☐ |

## UAT-C — Buyer registering, comparing and ordering
Persona: a new buyer, **Nimbus Solutions**.

| # | Step | What you should see | Pass / Fail |
|---|---|---|---|
| UAT-C-01 | Open the public site without signing in. Browse the laptops. | Prices, grades, QC scores and "Supply Point A · Gurugram" are shown. | ☐ |
| UAT-C-02 | Look anywhere on the page and in the page for a supplier's company name, address or GST number. | **Nothing of the sort anywhere.** Only "Supply Point A · Gurugram". | ☐ |
| UAT-C-03 | Search for "Alpha Systems". | No results. | ☐ |
| UAT-C-04 | Use the filters: brand Lenovo, grade A, 16 GB and above, ₹30,000–₹60,000. | Results narrow correctly and load quickly. | ☐ |
| UAT-C-05 | Open one laptop. Read the QC report. | Cosmetic scores, battery health, test date and validity are shown. No serial number, no technician name, no supplier details. | ☐ |
| UAT-C-06 | Add three different laptops to compare. | A side-by-side comparison appears. | ☐ |
| UAT-C-07 | Register: mobile, OTP, business details, GSTIN, billing and delivery addresses, accept the terms. | Five steps, each confirming as you go. Account active at the end. | ☐ |
| UAT-C-08 | Add 9 units of one model to the cart, then increase to 10. | The per-unit price drops at 10 and the change is shown plainly before checkout. | ☐ |
| UAT-C-09 | Go to checkout. Look at the price breakdown. | Item value, GST, freight and any handling are all visible **before** the pay button. Nothing is added later. | ☐ |
| UAT-C-10 | Look for countdown timers, "only 2 left!" warnings, pre-ticked boxes or guilt-worded cancel links. | None of these exist anywhere. | ☐ |
| UAT-C-11 | Add a laptop from a second supply point to the cart and check out. | One order is created with two dispatches, shown as Supply Point A and Supply Point B. | ☐ |
| UAT-C-12 | Pay using the test card from the sheet. | Payment succeeds. An order confirmation and a tax invoice arrive by email. | ☐ |
| UAT-C-13 | Open the tax invoice. | It is issued by **TrueTech Services Pvt. Ltd.**, shows the correct GST split for your state, and contains no supplier name, address or GST number. | ☐ |
| UAT-C-14 | Sign in as the **Cobalt Enterprises** buyer (credit account, ₹5,00,000 limit, approvals on). Place an order above ₹1,00,000. | It goes to "Pending approval" and names the approver. | ☐ |
| UAT-C-15 | Try to approve your own order. | Refused. | ☐ |
| UAT-C-16 | Sign in as the approver and approve it. | The order is confirmed and stock is committed. | ☐ |
| UAT-C-17 | Try to place a further order that would exceed the credit limit. | Refused, stating exactly how much over the limit it would be. | ☐ |
| UAT-C-18 | Try to open another company's order by editing the order number in the web address. | "Not found". | ☐ |

## UAT-D — Ops approving and dispatching

| # | Step | What you should see | Pass / Fail |
|---|---|---|---|
| UAT-D-01 | Sign in as **ops**. Open the new-orders queue. | Both orders from UAT-C appear with their supplier details visible to you. | ☐ |
| UAT-D-02 | Open the purchase order raised to Alpha Systems. | It shows the payout price (₹32,000), **not** the retail price. | ☐ |
| UAT-D-03 | Open the customer invoice for the same order. | It shows the retail price and no payout price. | ☐ |
| UAT-D-04 | Generate the e-way bill for the two-unit consignment. | One e-way bill. Bill From = TrueTech Services Pvt. Ltd. Dispatch From = the Gurugram supplier address. Bill To = the customer. Ship To = the delivery address. Value = the customer invoice value. | ☐ |
| UAT-D-05 | Look for the supplier's price on the e-way bill, the invoice, the packing slip and the shipping label. | It appears on none of them. | ☐ |
| UAT-D-06 | Try to generate a second e-way bill for the same consignment. | Refused. | ☐ |
| UAT-D-07 | Try to dispatch a ₹99,120 consignment without an e-way bill. | Blocked, with the reason. | ☐ |
| UAT-D-08 | Mark a unit's seal as broken and try to dispatch it directly. | Blocked. The system routes it via the hub for re-inspection. | ☐ |
| UAT-D-09 | Book the pickup with Delhivery. | Waybill created; the pickup is scheduled; the label prints. | ☐ |
| UAT-D-10 | Book the same pickup a second time by mistake. | No second shipment is created; the existing waybill is shown. | ☐ |
| UAT-D-11 | Open the exceptions queue. | Any geo-variance, mismatch, or wallet-balance warning from earlier is listed with a plain explanation. | ☐ |

## UAT-E — Rider delivering
Persona: the **rider mobile app**, signed in as RIDER_ONE.

| # | Step | What you should see | Pass / Fail |
|---|---|---|---|
| UAT-E-01 | Open today's route. | Your stops only, in order. | ☐ |
| UAT-E-02 | Try to open a stop assigned to another rider. | Not available. | ☐ |
| UAT-E-03 | Collect from the supplier. Check the seal and scan the units. | Custody transfers to you; the seal is recorded as intact. | ☐ |
| UAT-E-04 | Arrive at the customer. Ask for the delivery code. Enter a wrong code three times. | The app refuses to complete and offers to reschedule. It does not let you force the delivery. | ☐ |
| UAT-E-05 | Enter the correct code, capture the photo and signature, and confirm the seal is intact. | Delivery completes. The customer gets a confirmation. | ☐ |
| UAT-E-06 | On the next stop, record the seal as **broken** on arrival. | A return is opened automatically and the customer is told their options. You are not asked to argue with them. | ☐ |
| UAT-E-07 | On the third stop, fail the delivery (customer unavailable). Repeat twice more using the test data. | After the third failure the shipment moves to "Return to origin" on its own and no fourth attempt is offered. | ☐ |
| UAT-E-08 | Check the customer's order page. | The timeline shows each attempt with its reason and no supplier details. | ☐ |

## UAT-F — Payout run
Persona: **finance**.

| # | Step | What you should see | Pass / Fail |
|---|---|---|---|
| UAT-F-01 | Sign in as finance. Open "Payouts due". | Only orders delivered more than the inspection window ago, with no open return or dispute, are listed. | ☐ |
| UAT-F-02 | Try to include an order delivered yesterday. | Not selectable; it shows the date it becomes payable. | ☐ |
| UAT-F-03 | Preview the run for Alpha Systems. | Gross, TDS at 0.1% on the amount above ₹50 lakh for the year, penalties, adjustments and net — each on its own line and adding up. | ☐ |
| UAT-F-04 | Preview the run for the unregistered supplier with no PAN. | TDS shows **5%** with a note that PAN was not furnished. | ☐ |
| UAT-F-05 | Check a supplier whose year-to-date purchases are still under ₹50 lakh. | No TDS deducted. | ☐ |
| UAT-F-06 | Execute the run. | Payouts created; each supplier gets a payout advice; the run is marked executed. | ☐ |
| UAT-F-07 | Try to execute the same run again. | Refused. | ☐ |
| UAT-F-08 | Ask a colleague to start a payout run at the same moment you do. | Only one runs; the other is told a run is already in progress. | ☐ |
| UAT-F-09 | Open the accounting report for the run. | Debits equal credits exactly. The imbalance report is empty. | ☐ |
| UAT-F-10 | Open a supplier's payout statement. | Their own orders and prices only. **No customer names and no retail prices.** | ☐ |
| UAT-F-11 | Open a margin-scheme sale's invoice. | It carries the Rule 32(5) wording and no input tax credit is claimed on that purchase anywhere in the reports. | ☐ |
| UAT-F-12 | Process a refund for a returned unit. | The refund goes out, a credit note is raised, the GST is reversed on the right heads, and the books still balance. | ☐ |

---

# PART 6 — RELEASE GATES

Each gate is an assertion that is either true or false when checked. No gate is satisfied by an opinion. The phase does not close until every one of its assertions is demonstrably true in CI or in a recorded staging run, with the evidence link stored against the gate.

## Phase 0 — Foundations (repo, CI, schema baseline)

| ID | Exit assertion |
|---|---|
| GATE-P0-01 | `main` builds green on all 8 required checks, and a deliberately-broken PR (cross-module import) is demonstrably rejected by the ESLint boundary rule. |
| GATE-P0-02 | Testcontainers Postgres 16 + Redis 7 spin up in CI in < 60 s and the L2 harness runs a sample test against them. |
| GATE-P0-03 | All 12 Postgres schemas exist; `prisma migrate diff` against the schema file returns empty. |
| GATE-P0-04 | Every one of the 10 known schema gaps has a migration or a ticket with a phase assignment; gaps #1 (partitions), #3 (`v_sellability_drift`), #4 (`platform_config.key`), #5 (status CHECKs), #6 (carrier FK), #7 (rate-card EXCLUDE), #8 (sampling unique), #10 (default passwords) are **closed with a passing test each**. |
| GATE-P0-05 | `DATA-05`/`DATA-06` pass: the partition maintainer creates 90 days of runway, DEFAULT partitions exist on all 5 partitioned tables, and a deliberately dropped partition is detected. |
| GATE-P0-06 | `gitleaks` finds zero secrets in the full history; no `CHANGE_ME_IN_PRODUCTION` literal exists anywhere in the repo. |
| GATE-P0-07 | The design-token package exports exactly the canonical "New_plan" values (10 brand, 7 neutral, 6 semantic, 5 radii, 4 shadows, 12-step spacing scale) and a test fails if any `home_1.html` or journey-blueprint token appears in any app. |
| GATE-P0-08 | Every external integration has a `Port` interface and a mock implementation registered in the test module; a test enumerates the ports and fails if any lacks a mock. |

## Phase 1 — Identity, RBAC, sessions

| ID | Exit assertion |
|---|---|
| GATE-P1-01 | IDN-001…IDN-030 all pass; coverage on `identity/**` ≥ 92% lines. |
| GATE-P1-02 | The IDN-040 generated role × endpoint matrix covers 100% of routes registered in the Nest router — a synthetic unguarded route added in a test fails the suite. |
| GATE-P1-03 | The IDOR sweep IDN-060…IDN-075 passes with 100% 404s and zero 403/200 leaks. |
| GATE-P1-04 | Refresh-token reuse revokes the family within 1 s (IDN-020), proven in a staging run. |
| GATE-P1-05 | TOTP is enforced for `ADMIN` and `VENDOR_OWNER`; a non-enrolled user of those roles can reach only the enrolment endpoint. |
| GATE-P1-06 | SEC-02, SEC-05, SEC-13, SEC-15 pass with zero findings. |

## Phase 2 — KYC and onboarding (vendor 7-step, buyer 5-step)

| ID | Exit assertion |
|---|---|
| GATE-P2-01 | Every validation rule VR-001…VR-075 has a passing test, and VR-META-01…VR-META-04 pass. |
| GATE-P2-02 | KYC-001…KYC-060 all pass; save-and-resume (KYC-025) restores 100% of fields after a full browser restart in an E2E run. |
| GATE-P2-03 | `PROVIDER_ERROR` is distinguished from `FAIL` on every verification type (KYC-030…KYC-036); a provider outage never produces a `NEEDS_FIX` state. |
| GATE-P2-04 | `NEEDS_FIX` renders the ops reason verbatim and byte-identical, asserted for a 200-character reason containing punctuation and a rupee symbol. |
| GATE-P2-05 | Upload hardening SEC-14 passes all 11 attack cases; zero files with mismatched magic bytes reach the primary bucket. |
| GATE-P2-06 | The document-age rule (VR-072) is enforced at client, DTO and DB for all 5 age-sensitive types and enforced for none of the 5 registration types. |

## Phase 3 — Catalog and listing

| ID | Exit assertion |
|---|---|
| GATE-P3-01 | LST-001…LST-055 all pass; coverage on `listing/**` stock arithmetic ≥ 95%. |
| GATE-P3-02 | `uq_unit_active_serial` exists with exactly the specified predicate (LST-006), rejects a duplicate live serial on a raw insert (LST-005), and permits re-listing a `RETURNED_TO_VENDOR` serial (LST-007). |
| GATE-P3-03 | The quantity constraint rejects a raw over-allocation (LST-020) and a 1,000-step property test finds no violating sequence (LST-026). |
| GATE-P3-04 | `v_stock_drift` and `v_sellability_drift` return zero rows on the seeded database, and the seal-less-unit case is returned by the fixed view (LST-051 / DATA-03). |
| GATE-P3-05 | Tier-band overlap is impossible at the DB (LST-040); the tier price selection table (LST-045) passes for all 6 quantities. |
| GATE-P3-06 | No endpoint accepts a vendor-supplied image (CAT-004); the condition-image library resolves deterministically for every seeded SKU × grade. |
| GATE-P3-07 | PERF-02 (search < 300 ms p95) and PERF-05 (50 vendors × 200 serials) met on the reference environment. |

## Phase 4 — QC at source

| ID | Exit assertion |
|---|---|
| GATE-P4-01 | QC-001…QC-080 all pass; coverage on `qc/**` ≥ 95% lines / 92% branches. |
| GATE-P4-02 | `UNIQUE (tool_provider_id, tool_run_id)` makes a re-posted report a no-op returning the original id (QC-005), and a raw duplicate insert raises `unique_violation` (QC-008). |
| GATE-P4-03 | Nonce replay is refused (QC-009) and an unsigned or mis-signed report is refused (QC-002). |
| GATE-P4-04 | `serial_matches = FALSE` leaves the unit unsellable and unsealable by every code path (QC-020), proven by attempting publish. |
| GATE-P4-05 | A grade correction auto-applies at exactly 48 h and not before (QC-028), and is idempotent across repeated scheduler runs. |
| GATE-P4-06 | `valid_until` = completed + 90 days, `QC_EXPIRED` fires on the nightly job at the boundary (QC-037/QC-038), and `uq_qcrep_current` guarantees one current report (QC-040). |
| GATE-P4-07 | Seal lifecycle transitions match the specified state machine, all illegal pairs are refused, and a broken seal forces `VIA_HUB` with direct dispatch returning 409 (QC-055). |
| GATE-P4-08 | The 5% audit sample selects `ceil(n × rate)` units, never assigns a technician their own work, and a divergent recheck raises a correction and degrades the technician's score (QC-068/QC-071). |
| GATE-P4-09 | Geo-variance > 500 m raises an alert and holds the units; a missing GPS is treated as a variance (QC-074/QC-076). |
| GATE-P4-10 | The declared-16 GB / detected-8 GB scenario (QC-025) produces, in one staging run: a mismatch record, an SKU re-bind, a grade correction, a recomputed payout, a vendor notification, and a unit that is not sellable. |

## Phase 5 — Ordering and procurement

| ID | Exit assertion |
|---|---|
| GATE-P5-01 | ORD-001…ORD-037 and PRC-001…PRC-028 all pass. |
| GATE-P5-02 | The two-buyer race for the last unit yields exactly one success in **20 consecutive runs** (ORD-010), and 20-buyers-for-5-units yields exactly 5 (ORD-014). |
| GATE-P5-03 | With the Redis lock deliberately expired mid-transaction, the DB constraint still prevents oversell (ORD-012). |
| GATE-P5-04 | All 7 partial-fail injection points roll the confirmation transaction back completely, with `qty_*` byte-identical to the pre-state (ORD-021). |
| GATE-P5-05 | Two concurrent orders cannot jointly breach a credit limit (ORD-026). |
| GATE-P5-06 | PERF-03 (order confirmation < 1 s p95 at 200 concurrent) met, with zero oversell and `v_stock_drift` empty after the run. |
| GATE-P5-07 | The PO carries the payout price and the customer invoice carries retail, with neither leaking into the other (PRC-002). |
| GATE-P5-08 | TDS is 0.1% above the ₹50 lakh per-vendor-per-FY threshold on the GST-exclusive value, 5% with no PAN, and zero when `tds_applicable` is false — each proven to the paisa at the threshold boundary (PRC-010…PRC-015). |
| GATE-P5-09 | A payout run is not re-executable, cannot run concurrently, and leaves the ledger balanced under a mid-run failure (PRC-017…PRC-019). |
| GATE-P5-10 | A vendor payout statement contains no buyer name and no retail price (PRC-024). |

## Phase 6 — Payment, GST, invoicing, Bill-To-Ship-To

| ID | Exit assertion |
|---|---|
| GATE-P6-01 | PAY-001…PAY-096 all pass; coverage on `payment/**` ≥ 95% lines and branches; Stryker mutation score ≥ 60% with zero survivors in tax split, TDS, rounding and ledger balance. |
| GATE-P6-02 | `chk_ledger_single` rejects all three malformed row shapes (PAY-001) and `v_ledger_imbalance` returns zero rows after the full seeded journey (PAY-004). |
| GATE-P6-03 | The 500-line order produces zero rounding drift beyond a single round-off line of at most ₹0.99, and its ledger balances to ₹0.00 (PAY-017). |
| GATE-P6-04 | All six rows of the Bill-To-Ship-To table (PAY-025…PAY-030) produce the specified tax heads, including the three-state case where POS follows Ship-To. |
| GATE-P6-05 | A MARGIN unit produces: margin-only taxable value, the verbatim Rule 32(5) narration, zero ITC ledger rows (enforced at the DB), and exclusion from the GSTR-2B reconciliation set (PAY-045…PAY-049). **CA sign-off on the margin-scheme computation is recorded against this gate.** |
| GATE-P6-06 | One movement produces exactly two invoices and exactly one e-way bill with the Case 2 field mapping asserted field by field (PAY-060/PAY-061). |
| GATE-P6-07 | The vendor's purchase price appears in **none** of the 7 documents/payloads that travel with the goods (PAY-062), verified by a token sweep. |
| GATE-P6-08 | The ₹50,000 e-way bill threshold is exclusive at exactly ₹50,000.00 and inclusive of GST in its basis (PAY-064/PAY-065). |
| GATE-P6-09 | Refunds cannot exceed captured amounts, are idempotent under retry, and reverse GST on the correct heads (PAY-090…PAY-094). |
| GATE-P6-10 | DATA-15 reconciliation triangle closes at ₹0.00 for a full simulated day. |

## Phase 7 — Logistics

| ID | Exit assertion |
|---|---|
| GATE-P7-01 | LOG-001…LOG-064 all pass; every carrier adapter passes the shared `CarrierPort` conformance suite. |
| GATE-P7-02 | Every raw status code in the recorded fixtures (≈180) maps to exactly one canonical status, and an unknown code maps to `UNKNOWN` with an alert, never to `IN_TRANSIT` (LOG-002). |
| GATE-P7-03 | Delhivery: the request body is exactly `format=json&data=`, the five characters `& \ % # ;` never reach the wire unsanitised, the warehouse name is matched case-sensitively before the call, a low wallet fails over to another carrier, and a duplicate `order_id` is treated as idempotent success (LOG-010…LOG-016). |
| GATE-P7-04 | Blue Dart: a 401 triggers exactly one JWT refresh and one retry, 20 concurrent 401s trigger exactly one refresh, and a persistent 401 stops after one attempt with the carrier marked degraded (LOG-021…LOG-023). |
| GATE-P7-05 | Shiprocket: the token is refreshed on our own 240 h bookkeeping before expiry, and a 429 honours `Retry-After` exactly with a capped jittered backoff (LOG-025/LOG-026). |
| GATE-P7-06 | Porter: tracking never exceeds 1 request/minute across all trips, and `order_reopened` moves a trip backwards without re-firing any delivery side effect (LOG-030/LOG-032). |
| GATE-P7-07 | Shipment creation is idempotent across a duplicate call, a retry, and a post-success timeout (LOG-040). |
| GATE-P7-08 | Out-of-order tracking events resolve to the correct current status by event time, and a 4×-delivered duplicate scan produces exactly one row (LOG-041/LOG-042). |
| GATE-P7-09 | NDR action legality is derived from raw carrier codes for all 6 carriers, and an illegal action is refused (LOG-055). |
| GATE-P7-10 | The third failed attempt moves the shipment to RTO with no fourth attempt possible (LOG-058). |

## Phase 8 — Post-sale (returns, warranty, tickets, disputes)

| ID | Exit assertion |
|---|---|
| GATE-P8-01 | PLT-001…PLT-036 all pass. |
| GATE-P8-02 | The inspection-window boundary is exact to the second in Asia/Kolkata (PLT-003). |
| GATE-P8-03 | All five Rule 7(4) grounds are accepted **outside** the window, and no customer-facing payload, template or screen routes the customer to the vendor or offers vendor contact details (PLT-004). |
| GATE-P8-04 | The Rule 7(4) reason whitelist is a compile-time constant with no config key capable of disabling it (PLT-005). |
| GATE-P8-05 | The warranty claim state machine accepts every legal transition and refuses all 40 illegal pairs, with the status column `CHECK`-constrained (PLT-016). |
| GATE-P8-06 | A broken seal recorded at delivery opens a return automatically without customer action (PLT-007). |
| GATE-P8-07 | An erasure request preserves statutory records and says so explicitly (PLT-034). |
| GATE-P8-08 | All 9 free-text status columns from schema gap #5 reject an invalid value on a raw insert (DATA-09). |

## Phase 9 — Non-functional hardening

| ID | Exit assertion |
|---|---|
| GATE-P9-01 | PERF-01…PERF-12 all meet their targets on the reference environment with the recorded seed hash, in a run reproduced twice. |
| GATE-P9-02 | The 4-hour soak shows < 10% memory growth, no connection leak and p95 stable within ±15% (PERF-09). |
| GATE-P9-03 | SEC-01…SEC-20 pass with zero high or critical findings; an independent penetration test has been run and every high/critical finding is closed or has a signed-off, time-boxed compensating control. |
| GATE-P9-04 | SEC-11: all ≈70 filter/sort/search parameters survive the injection payload set with no SQL error, no timing signal and no unparameterised query outside the audited allow-list. |
| GATE-P9-05 | SEC-07: every URL-accepting field blocks private ranges, IMDS, non-HTTPS, and DNS-rebinding attempts, with re-resolution at request time. |
| GATE-P9-06 | axe reports zero critical/serious violations on all A11Y-01…A11Y-05 route sets, and the A11Y-10…A11Y-23 manual checklist is fully signed off for the release, including WCAG 2.2's new criteria (2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8). |
| GATE-P9-07 | DATA-01…DATA-15 pass; the four nightly drift views each return zero rows for 7 consecutive nights on staging. |
| GATE-P9-08 | A PITR restore meets RTO < 1 h / RPO < 5 min and the restored database passes the drift views (DATA-12). |
| GATE-P9-09 | Quarantined tests number ≤ 10 and none is in `payment`, `procurement`, `qc`, `listing` or a DTO whitelist. |

## Phase 10 — Pilot launch (Delhi NCR)

| ID | Exit assertion |
|---|---|
| GATE-P10-01 | Every P0 test case in Parts 3 and 4 passes on the release tag; zero P0 defects are open. |
| GATE-P10-02 | All six UAT scripts (UAT-A…UAT-F) have been executed end-to-end by an operations person on staging with every checkbox passed, and the signed sheets are attached to the release. |
| GATE-P10-03 | The anonymity sweep IDN-080 passes against the **production build** of the storefront, covering 100% of customer-facing routes enumerated from the production router. |
| GATE-P10-04 | One live production smoke has been completed and recorded: a ₹1 payment and its refund, one real e-way bill generated and cancelled the same day, and one Delhivery sandbox-to-production waybill created and cancelled. |
| GATE-P10-05 | Runbooks exist and have been rehearsed for: oversell suspicion, ledger imbalance, partition exhaustion, carrier outage, payment-gateway outage, QC tool outage, and a data-breach response. Each rehearsal is dated. |
| GATE-P10-06 | Monitoring is live: Sentry with release tagging, OpenTelemetry traces on the three transactional flows, and alerts wired for `v_ledger_imbalance`, `v_stock_drift`, `v_sellability_drift`, partition runway < 30 days, carrier wallet < ₹2,000, OTP failure spike, and 5xx rate > 0.5%. Each alert has been fired once in a test and reached a human. |
| GATE-P10-07 | Legal and tax sign-offs recorded against the build: (a) counsel on the inventory-model/Rule 4+7 position and the absence of a Rule 5(3)(a) duty; (b) CA on the dual REGULAR/MARGIN valuation channels and the GSTR-2B reconciliation; (c) CA on the s.393(1) Sl.8(ii) TDS computation and Form 26Q section code 1031; (d) counsel/CA note on the GST fixed-establishment position for QC-at-source before any state outside the pilot is opened. |
| GATE-P10-08 | A CCPA dark-patterns review of the checkout, cart, cancellation and refund flows is recorded, with the reviewer named and every finding closed. |
| GATE-P10-09 | The no-TCS / no-194-O position is asserted in code by the absence of those modules, and a test fails if a TCS field, a GSTR-8 export, or a 194-O deduction is ever introduced (§1.6). |
| GATE-P10-10 | Rollback has been demonstrated: the previous tag redeployed on staging under load with zero failed requests and no schema incompatibility. |

