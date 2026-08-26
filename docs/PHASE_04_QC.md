# PHASE 4 — QC at source, the technician app, and your QC executable

**Prerequisite:** Phase 3 exit criteria green.
**Estimated size:** 2 engineers + 1 mobile, 10–12 days. **This is the highest-risk phase in the project.**
**Covers your requirement #13.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. Read `docs/_CONTEXT.md` and `docs/02_ARCHITECTURE.md` if not in context, and read **§5.3 (the QC executable contract) carefully** — it is the interface this whole phase is built on.

Additional reading: `docs/legacy/truetech_schema_migration_v3_qc_at_source.sql` (the 17 QC/logistics tables already exist — adopt them), `docs/legacy/truetech-operations-journeys.html` Journey 2 (the field inspection visit, 11 steps), `docs/03_UX_SPEC.md` §3D (technician app), `docs/04_TEST_PLAN.md` §3.7.

## Objective

A technician arrives at a vendor's warehouse, inspects 40 machines in a day using the platform's QC executable, grades them against objective thresholds, applies numbered tamper seals, photographs each seal on the machine, gets the vendor's OTP sign-off, and the passed units go live — **while the failed units never appear on the storefront at all.**

## Why this phase is the highest risk

Three things stack: it runs on a mobile device, it must work offline in a warehouse with no signal, and it is the product's entire promise. If it slips, the fallback is a web-based QC form on a tablet — build the web console (Task 8) *first* so that fallback exists from day one, then build the mobile app.

## Task 1 — Adopt the v3 QC schema

The tables exist. Do not redesign them. Confirm and wire:

`qc_tool_provider`, `qc_technician`, `technician_availability`, `qc_visit`, `qc_visit_unit`, `qc_visit_expense`, `qc_tool_run`, `qc_seal`, `qc_reverification`, `qc_sampling_rule`, `listing.grade_correction`, plus the existing `qc_report`, `qc_area_result`, `qc_hardware_detected`, `qc_photo`, `qc_mismatch`, `qc_tolerance_rule`, `wipe_certificate`, `qc_audit_recheck`.

**Fixes required in this phase:**
- `qc_sampling_rule` has no unique constraint — add `UNIQUE (vendor_tier, effective_from)` plus a partial unique on `is_active` so two active rules per tier are impossible
- Mark `qc.qc_batch` (the old hub-QC path) deprecated per Phase 0 Task 5.6. **Vendor-site QC is canonical.** Two live QC models with nothing marking which is authoritative is the most dangerous ambiguity in the existing schema
- `qc_report.technician_id` currently points at `identity.user_account` while `qc_seal.applied_by` points at `qc.qc_technician` — two different technician identities on the same inspection. Resolve to `qc.qc_technician` everywhere and migrate

## Task 2 — Integrate DeviceSure

**Read `docs/07_DEVICESURE_INTEGRATION.md` before starting this task. It replaces `02_ARCHITECTURE.md` §5.3 in full.**

**DeviceSure is a separate product, not a tool to absorb.** It is a pnpm/Turborepo monorepo with its own NestJS API at `/api/v1`, its own Postgres, multi-tenancy on `organization_id`, `INTERNAL`/`VENDOR` licensing with feature flags, a Tauri desktop agent with native Rust collectors for Windows and macOS, offline sync, a device passport with component history, and a public `/verify/:certificateId` page. Keep it separate — different release cadence, different risk profile, and a plausible licensing business of its own.

The integration is therefore **tenancy plus API**, not file parsing:

```
DeviceSure (Gorefurbo Ops = INTERNAL license)
   each vendor = a VENDOR-mode organization under a license we issue
        │
        ├─ POST /api/v1/qc/sessions        ← we push declared_spec + seal range
        └─ webhook qc.session.certified    → POST /qc/tool-runs on Gorefurbo
```

`qc_tool_provider` row: `code = 'DEVICESURE'`, `integration_type = 'API'` + `'WEBHOOK'`, `report_format = 'JSON'`, `supports_wipe = true`. The `field_map_json` abstraction stays exactly as designed — a second diagnostic tool later is configuration, not a code release.

**Build the vendor-licence lifecycle in this phase.** A `vendor.suspended` event in Gorefurbo must revoke that vendor's DeviceSure licence, and their agents must stop certifying. That is the enforcement mechanism the whole quality model rests on, and it is cheap to build now and awkward to retrofit.

**Eight things DeviceSure must add before it can carry a commercial certificate** — tracked in `07_DEVICESURE_INTEGRATION.md` §4, mocked here until they land: `valid_until` (+90 days) · `seal_code` and seal photograph · six unit photographs · wipe certificate · a `declared_spec` input and a structured declared-vs-detected diff · inspection location and check-in geo · an `UNSUPPORTED` count on the certificate face · an explicit grade-scale mapping, because **DeviceSure grades A+/A/B/C/D/FAIL while Gorefurbo lists A+/A/B only** and C/D/FAIL must map to *not listable*.

**Two defects in DeviceSure v0.1.0 that would corrupt this phase's data if ingested as-is** — do not work around them here, get them fixed upstream and assert against them:
- A certificate graded **A+ with a failed USB port** (`07_DEVICESURE_INTEGRATION.md` §3.1). Weighted averaging swallows a single component failure. Gorefurbo must **reject any certificate whose grade is inconsistent with a `FAIL` component** rather than trust it — grade is a legal claim under CP e-Comm r.7(5).
- **RAM reported as 15 GB for a 16 GB machine** (§3.4), because Windows `TotalPhysicalMemory` reports usable rather than installed. Left unfixed, the grade-correction engine fires a false mismatch on **every single unit**.

Build the ingestion against the contract below and the mock; swap to the real payload when `@devicesure/contracts` arrives.

Ingestion endpoint `POST /qc/tool-runs`:

1. **Store the raw payload verbatim first** — `raw_report_json`, `raw_report_key` (S3), `raw_report_hash` — *before* any parsing or interpretation. When a buyer disputes a grade in four months, the original is your evidence. Do not store only the parsed form.
2. **Verify the signature** over the canonicalised payload. Reject unsigned reports in production; allow them only when `parse_status = 'MANUAL_ENTRY'` with an explicit reason and a named actor.
3. **Reject a replayed nonce.** `nonce` is `UNIQUE`. `UNIQUE (tool_provider_id, tool_run_id)` makes ingestion idempotent — the same run submitted twice is one row and a `200`, not a duplicate and not a `500` (`QC-001`…`QC-008`).
4. **Compare `serial_from_tool` against the visit manifest.** `serial_matches = FALSE` is an **immediate hard stop**: the label does not belong to the laptop. Do not grade it, do not seal it, do not list it. Raise an exception to the QC manager and mark the `qc_visit_unit` outcome `UNTESTABLE` pending investigation (`QC-012`).
5. **Parse via `field_map_json`** into `qc.qc_hardware_detected`.
6. On a parse failure: `parse_status = 'PARSE_FAILED'`, retain the raw payload, alert engineering, and **offer the technician a manual-entry path**. The technician's day does not stop because a parser regressed.

## Task 3 — The tolerance engine and the verdict

Read `catalog.grade_definition` (Phase 2) and `qc.qc_tolerance_rule`. **Do not hard-code thresholds** — grading is a liability control under CP e-Comm r.7(5), and it must be reproducible against the rule version in force on the inspection date.

```
detected hardware  ×  SKU declared specification  →  mismatches
mismatches         ×  qc_tolerance_rule            →  within tolerance? material?
cosmetic areas     ×  grade_definition             →  cosmetic grade
battery health     ×  grade_definition             →  battery grade
                                                    ↓
                              verdict ∈ PASS | PASS_WITH_NOTE | MISMATCH | FAIL
                              grade_actual
                              qc_score 0–100
```

Twelve inspection areas into `qc_area_result`, `UNIQUE (qc_report_id, area)`, each `PASS | WARN | FAIL`: chassis, lid, palmrest, keyboard, trackpad, screen, hinges, ports, battery, storage, memory, thermals.

**Existing constraint to honour:** a proposed grade may only differ from the final grade if a written reason is given —
```sql
CONSTRAINT chk_override_reason CHECK (grade_proposed IS NULL OR grade_final IS NULL
  OR grade_proposed = grade_final OR grade_override_reason IS NOT NULL)
```

On `PASS`: `qc_report.valid_until = completed_at + 90 days`, `is_current = TRUE`, and `uq_qcrep_current ON qc.qc_report (unit_id) WHERE is_current` guarantees exactly one live report per machine. **Re-inspections supersede via `superseded_by_id`; they never overwrite.** History is the evidence.

**The named test:** declare 16 GB, present an 8 GB machine. The verdict must be `MISMATCH`, a `grade_correction` must be created, the vendor must be notified, and the unit must not become sellable until resolved (`QC-025`).

## Task 4 — Grade correction

`listing.grade_correction` with `CHECK (grade_declared <> grade_corrected)`.

Vendor has **2 days** (`qc.grade_correction_auto_days`) to respond:
- `ACCEPT_NEW_GRADE` — repriced automatically at the new grade's price band
- `ACCEPT_AND_REPRICE` — vendor supplies a new `vendor_ask_price`
- `WITHDRAW_UNIT` — unit is not listed, returns to the vendor
- `DISPUTE` — routed to the QC manager, triggers a `qc_reverification` with `method = 'FULL_RESCAN'`

No response in 2 days → **auto-applies** the corrected grade. `counts_against_accuracy` defaults TRUE and feeds the vendor scorecard; set it FALSE only when a dispute is upheld.

Notify the vendor **immediately** on correction, not in a daily digest. This is money.

## Task 5 — Visit scheduling

`qc_visit` is one technician, one vendor site, one day.

**Scheduling engine inputs:** technician `zones` (GIN-indexed), `certified_tools`, `technician_availability`, `daily_capacity_units` (default 40), `max_sites_per_day` (default 3), `qc_tool_provider.licence_seats` (a hard cap on concurrent technicians), vendor facility operating hours (`facility_hours`) and holidays (`facility_holiday`).

**Sampling is earned by tier**, per `qc_sampling_rule`:

| Tier | Sample % | Requires |
|---|---|---|
| WATCHLIST, BRONZE | 100% | — |
| SILVER | 100% | ≥500 units, 95% pass rate, 96% grade accuracy |
| GOLD | 50% | ≥2000 units, 97% / 98%, full inspection above ₹50,00,000 |
| PLATINUM | 25% | ≥5000 units, 98.5% / 99%, full inspection above ₹50,00,000 |

Status flow: `REQUESTED → QUOTED → SCHEDULED → TECH_ASSIGNED → EN_ROUTE → IN_PROGRESS → COMPLETED | PARTIALLY_COMPLETED`, with `CANCELLED`, `NO_SHOW_VENDOR`, `NO_SHOW_TECH`, `RESCHEDULED`.

**Anti-fraud on arrival:** capture `arrival_geo_lat/lng` and compute `geo_variance_metres` against the registered facility address. Alert above `qc.geo_variance_alert_metres` (default 500 m). A technician checking in from somewhere other than the warehouse is a signal.

## Task 6 — Sealing

On `PASS`, a numbered tamper-evident seal is applied and **photographed on the machine**. `qc_seal.applied_photo_key` is `NOT NULL` — there is no seal without a photograph.

`seal_code` is `UNIQUE`. Status `APPLIED → INTACT | BROKEN | MISSING | REPLACED`, with `replaced_by_seal_id` self-referencing for the replacement chain.

**The seal is what makes the 12-minute inspection meaningful three weeks later**, because the machine stays with the vendor between inspection and sale. Verified at pickup, printed on the invoice, checkable by the buyer at the door. A broken seal stops the unit and forces it back through QC and through the hub (routing rule priority 10 in Phase 8).

Order a supply of numbered, tamper-evident seals now — 2–3 week lead time.

## Task 7 — Closing the visit

- Vendor contact signs off by **OTP** (`vendor_otp_hash`, `vendor_signoff_at`, `vendor_signoff_name`) on what was found. This is the document that stops "you never told me it failed".
- Counters totalled onto `qc_visit`: presented, inspected, passed, grade-corrected, failed, absent.
- `qc_visit_expense` rows: travel, fuel, toll, parking, food, accommodation, tool licence, with receipts.
- `qc.v_visit_economics` gives cost per inspected unit and hours on site. **Watch this number** — it is the metric that tells you whether QC-at-source is economic.
- Visit → `COMPLETED` or `PARTIALLY_COMPLETED`.
- Listing → `ACTIVE`, or **`PARTIALLY_ACTIVE`** when only some units passed. Only `is_sellable` units are visible to buyers.

## Task 8 — The QC web console (build this FIRST)

In `apps/console`, for `QC_MANAGER` and `TECHNICIAN`:
- Visit board by status, technician, date, vendor
- Scheduling calendar with technician availability and licence-seat capacity
- Per-visit detail: manifest, per-unit outcomes, tool runs with the raw payload viewable, photographs, seals
- **A manual inspection form** covering every field the mobile app captures — this is the fallback if the mobile app slips, and it is also what an ops person uses to correct a bad record
- Grade-correction queue with vendor responses
- Sampling-rule administration
- Audit recheck queue and technician divergence dashboard
- Tool-provider administration including `field_map_json` editing with schema validation

## Task 9 — The technician app (Expo)

Scaffold `apps/technician`. **Offline-first is a requirement, not a feature** — warehouses have no signal.

Screens: login + device binding · today's route · kit check (tool version, seal roll range, device certificate) · site check-in with geo capture · unit manifest · per-unit flow (scan serial → run tool → review detected hardware → cosmetic grading with guided photographs → apply seal → photograph seal → confirm) · vendor OTP sign-off · expenses · sync status.

**Offline architecture:**
- SQLite queue with every action recorded locally, including photographs
- Serials, manifest and tolerance rules pre-downloaded at check-in
- Upload resumes on reconnect, in order, idempotently (the nonce and `(tool_provider_id, tool_run_id)` uniqueness make this safe)
- **The technician must be able to see, at all times, how many items are pending sync.** A silent queue is how a day's work gets lost
- Photographs compressed client-side, uploaded to signed S3 URLs, EXIF-stripped server-side

Six photographs per unit minimum: lid, palmrest, screen on, ports, base, seal applied.

## Task 10 — Ongoing controls

- **Re-verification at pickup** (`qc_reverification`, trigger `DISPATCH_PICKUP`, method `SEAL_CHECK`): scan seal + serial, confirm intact. Two minutes at the door decides whether it ships. Consumed by Phase 8.
- **90-day expiry:** `qc.v_expiring_qc` surfaces stock expiring within 14 days. A scheduled job warns the vendor at 14 days and moves units to `QC_EXPIRED` with `is_sellable = FALSE` on the day. This is the cost of inspecting stock that has not sold — surface it in the vendor dashboard so they act.
- **5% audit recheck** (`qc.audit_recheck_pct`) by a second technician into `qc_audit_recheck`, feeding `qc_technician.divergence_rate`. A technician whose divergence rises is a training problem before it is a fraud problem.
- **The unit passport and the QR code.** Public route `/unit/:serial` and `/qc/verify/:verification_code` (the `verification_code` column already exists and is `UNIQUE`). Shows grade, score, inspection date, validity, detected hardware, area results, the six photographs, the seal code, and the wipe certificate. **Reachable before purchase**, and by someone with no account.
  - **The QC report PDF carries a QR code encoding the `/qc/verify/:verification_code` URL.** Print it on the report, and ship the report with the machine so the buyer's receiving staff can scan and verify at the door, before signing.
  - Design the verification page for a phone held next to an open laptop: serial and grade above the fold, a large PASS/FAIL state, photographs that zoom, and the seal code prominent enough to check against the sticker in front of them.
  - `verification_code` must be **unguessable** (a 12+ character random code, not a sequence) — it is a public URL and an enumerable one leaks your whole inventory.
  - Rate-limit the endpoint and exclude it from `robots.txt`.

## Task 11 — Per-vendor QC aggregates

The supply-point comparison grid in Phase 5 sells on these two numbers, so they are computed here, where the data lives.

Create `qc.vendor_sku_quality`, refreshed on `qc.report.completed` and nightly:

```sql
vendor_org_id, sku_id, grade,
units_inspected, avg_qc_score, median_qc_score,
battery_health_min, battery_health_max,
grade_corrections, grade_accuracy_pct,   -- 1 − (corrections ÷ units inspected)
last_inspected_at, computed_at
```

Plus a vendor-wide rollup, `qc.vendor_quality`, for the same fields across all SKUs.

**Two rules that matter more than the arithmetic:**

1. **Suppress the headline number below the sample threshold.** A vendor with 3 inspected units of a model gets `New supplier · 3 units inspected`, not a 100% accuracy score. Threshold in `platform_config`, suggest 10. Publishing an authoritative-looking average computed on two machines is exactly the claim the CCPA Misleading Advertisements Guidelines 2022 exist to catch — and under CP e-Comm r.7(2) it is our claim, not the vendor's.
2. **Compute, cache, version — never calculate live in the grid query.** The offers grid has a 500 ms p95 budget and already touches six tables. Materialise these, refresh on the event, and serve them from the read model.

Expose them **without any vendor identifier attached**. The API returns the aggregates keyed by `supply_point_code`, and the vendor `org_id` never crosses the DTO boundary (Phase 5, Task 1).
- **Wipe certificate** (`wipe_certificate`) — standard, method, timestamp, technician, per unit. Buyers with data-security policies will ask for this on every machine.

## Exit criteria

- [ ] A technician completes an inspection on the app, **fully offline**, and it syncs correctly on reconnect with zero data loss
- [ ] The same tool run submitted twice produces one row and a `200` (`QC-001`)
- [ ] A replayed nonce is rejected (`QC-004`)
- [ ] `serial_matches = FALSE` stops the unit and raises an exception (`QC-012`)
- [ ] Declare 16 GB, inspect an 8 GB machine → `MISMATCH`, `grade_correction` created, vendor notified, unit not sellable (`QC-025`)
- [ ] A grade correction with no vendor response auto-applies on day 2 (`QC-031`)
- [ ] A passed unit gets a sealed record with a **non-null** photograph key; sealing without a photograph is impossible
- [ ] Exactly one `is_current` report per unit; a re-inspection supersedes and preserves the prior report (`QC-045`)
- [ ] A unit at 90 days moves to `QC_EXPIRED`, becomes unsellable, and the vendor was warned at 14 days
- [ ] Geo variance above 500 m raises an alert
- [ ] A listing with mixed outcomes goes `PARTIALLY_ACTIVE` and shows **only** the passed units to buyers
- [ ] The unit passport is reachable at `/unit/:serial` **before** purchase and renders the real photographs
- [ ] **The QC report PDF carries a scannable QR code that resolves to the public verification page for that serial**, and the page is usable on a phone with no account
- [ ] `verification_code` is unguessable and the endpoint is rate-limited and excluded from indexing
- [ ] `qc.vendor_sku_quality` returns an average QC score and a grade-accuracy percentage per vendor per SKU
- [ ] A vendor below the sample threshold shows "New supplier · N units inspected", **not** a percentage
- [ ] The aggregate API response carries **no** vendor identifier
- [ ] `qc.v_visit_economics` reports a cost per inspected unit
- [ ] The web QC console can complete an entire inspection without the mobile app

- [ ] A `vendor.suspended` event revokes that vendor's DeviceSure licence and their agent stops certifying
- [ ] A certificate arriving with grade A+ and a `FAIL` component is **rejected**, not ingested
- [ ] C, D and FAIL grades from DeviceSure map to *not listable* and never reach the storefront

## The one thing that will go wrong

DeviceSure's real payload will not match the contract in `07_DEVICESURE_INTEGRATION.md` §5.4. **That is expected and fine** — it is at v0.1.0 and actively being built. Change `field_map_json` and the parser, never the tool. Do not let DeviceSure's format leak past the parser into `qc_hardware_detected`; the whole point of the mapping layer is that a second diagnostic tool can be added later without touching anything downstream.

**And do not paper over upstream defects in the parser.** If DeviceSure reports 15 GB for a 16 GB machine, the fix is in the Windows collector, not a `+1` in the field map. A parser that quietly corrects its source is a parser nobody can reason about six months later.

═══════════════════════════════════════════════════════════════════
