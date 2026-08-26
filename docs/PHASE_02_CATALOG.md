# PHASE 2 — Master catalog and the condition image library

**Prerequisite:** Phase 1 exit criteria green.
**Estimated size:** 1 engineer + 1 ops person for data, 5–6 days.
**Covers your requirements #6, #7.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. Read `docs/_CONTEXT.md` and `docs/02_ARCHITECTURE.md` if not in context.

Additional reading: `docs/legacy/Gorefurbo_Schema_Design_Annotated.md` Part 6 (catalog, 7 tables), `docs/03_UX_SPEC.md` §3C (admin — catalog and the condition image library), `docs/04_TEST_PLAN.md` §3.5.

## Objective

A four-level master catalog with 200 real SKUs seeded, plus **the platform-owned condition image library** — the thing that lets you say to a vendor "just list the model and the serial, we'll handle the photographs". By the end of this phase a vendor can select a machine from a real catalog and the storefront can render it with correct per-grade imagery, before any listing exists.

## Task 1 — Why the catalog is four levels deep

`brand → series → model → sku`. Do not flatten it.

- **brand** — Dell, Lenovo, HP, Apple, Asus, Acer, Microsoft, MSI
- **series** — Latitude, ThinkPad, EliteBook, MacBook Air
- **model** — Latitude 5420, ThinkPad T14 Gen 2
- **sku** — the *configuration*: Latitude 5420 · i5-1145G7 · 16 GB · 512 GB NVMe · 14" FHD

A buyer searches at model level and buys at SKU level. A vendor lists against a SKU. QC verifies against the SKU's declared specification. Collapsing model and SKU makes the QC mismatch check impossible, because there is nothing to compare the detected hardware *to*.

## Task 2 — `catalog.sku` and the dedupe guarantee

`sku.normalized_key` is `UNIQUE NOT NULL` and is the single most important column in this module. Generate it deterministically:

```
lower(brand) | lower(model) | cpu_family | cpu_model | ram_gb | storage_gb |
storage_type | screen_size_in | screen_res | gpu | os
```

with a documented normalisation function (strip punctuation, collapse whitespace, canonicalise `i5-1145G7` → `i5_1145g7`, `512GB`/`512 GB`/`0.5TB` → `512`). **Write it once, in `packages/contracts`, and use the same function on ingest, on vendor listing creation, on CSV import, and on the SKU-request path.** Two paths generating different keys for the same machine is how a catalog rots.

Write property-based tests: 200 spelling variants of the same machine must all produce one key.

## Task 3 — SKU fields

The SKU carries the **declared** specification. QC produces the **detected** specification. The delta between them is the entire trust proposition, so the SKU's fields must line up 1:1 with what the QC tool reports.

Minimum: `brand_id`, `series_id`, `model_id`, `sku_code` (human-readable, e.g. `DEL-LAT5420-I5-16-512`), `normalized_key`, `cpu_brand`, `cpu_family`, `cpu_model`, `cpu_generation`, `cpu_cores`, `ram_gb`, `ram_type`, `ram_slots`, `ram_max_gb`, `storage_gb`, `storage_type`, `storage_slots`, `gpu_type`, `gpu_model`, `screen_size_in`, `screen_resolution`, `screen_panel`, `touchscreen`, `os`, `os_licence_type`, `weight_kg`, `battery_design_wh`, `ports_json`, `wifi_standard`, `bluetooth_version`, `keyboard_layout`, `backlit_keyboard`, `fingerprint_reader`, `webcam_mp`, `year_released`, `hsn_code` (default `84713010`), `gst_rate_pct` (default 18), `is_active`.

`hsn_code` and `gst_rate_pct` live here because Phase 7 needs them on every invoice line and Phase 8 needs the HSN on every Delhivery shipment payload (it is a mandatory field there).

## Task 4 — The condition image library

**This is your requirement #7 and the thing that makes vendor onboarding fast.** Vendors never upload photographs. The platform owns a library of images per model, per grade, per view.

Build `catalog.condition_image` exactly as specified in `02_ARCHITECTURE.md` §2.3.

**View codes:** `LID_TOP`, `PALMREST`, `KEYBOARD`, `SCREEN_ON`, `PORTS_LEFT`, `PORTS_RIGHT`, `BASE`, `HINGE`, `CORNER_WEAR`, `SCREEN_DEFECT`.

**Resolution order** when the storefront asks for images for `(sku_id, grade)`:
1. Images for that exact `sku_id` and grade
2. Falling back to the `model_id` and grade
3. Falling back to a generic per-grade set for the series
4. Falling back to a placeholder that is explicitly labelled as such

Never silently show a Grade A image on a Grade B listing. Assert the resolution order in tests.

**Admin screens:**
- Bulk upload with drag-and-drop, auto-assigning `view_code` from the filename convention `<model>_<grade>_<view>_<n>.jpg`
- A grid showing coverage: rows = models, columns = grade × view, cells green when an image exists. **A model with gaps must be visible at a glance**, because the gap is what produces a placeholder on a live listing
- Set primary, reorder, replace, soft-delete
- Required `alt_text` per image — accessibility, and it is also what a search engine reads

**Two controls that make this defensible, and both are mandatory:**

1. Every rendered listing image carries a visible, non-dismissible caption: **"Representative image of Grade A condition. Your unit's actual inspection report and photographs are on the unit passport."** Build this into the `ListingCard` and product-detail components in `packages/ui` so it cannot be forgotten.
2. The **unit passport** — the per-serial QC report with the technician's six real photographs — must be reachable **before purchase**. Phase 4 builds it; Phase 5 links it. Design the route now: `/unit/:serial` and `/qc/verify/:verification_code`.

Under Consumer Protection (E-Commerce) Rules r.7(5) you bear liability for authenticity claims, and r.7(2) prohibits misrepresenting quality or features. A representative image with an honest label and a real per-unit report behind it is fine. A representative image presented as *the* machine is not.

## Task 5 — Grade definitions as data, not marketing

Grades are `A_PLUS`, `A`, `B`. **Nothing worse than B is sold.**

Create `catalog.grade_definition`:

```sql
grade                  grade_type PRIMARY KEY,
display_name           TEXT NOT NULL,      -- 'A+ · Near-new'
customer_description   TEXT NOT NULL,      -- shown on the storefront
min_battery_health_pct INT NOT NULL,       -- A+ 90, A 80, B 70
max_cycle_count        INT,
min_cosmetic_score     INT NOT NULL,       -- against qc_area_result
allowed_defects_json   JSONB NOT NULL,     -- e.g. B allows ≤3 scratches under 10 mm
screen_defects_allowed BOOLEAN NOT NULL,
effective_from         DATE NOT NULL
```

**Why this table exists:** Rule 7(5) makes your grading claim a liability trigger, and the CCPA Misleading Advertisements Guidelines 2022 test claims against reality. "Grade A" must be a threshold a machine either meets or does not, evaluated by the QC engine in Phase 4 against these numbers. It must not be a technician's opinion. Version it with `effective_from` so a report from six months ago can still be read against the rules that applied then.

## Task 6 — SKU requests

A vendor will always have a machine that is not in the catalog. `catalog.sku_request`:
- Vendor submits proposed specification
- The system computes `normalized_key` and **shows near-matches before submission** — most requests are a SKU that already exists under a slightly different name
- Admin queue: approve (creates the SKU), merge into an existing SKU, or reject with a reason
- SLA and notification back to the vendor

`catalog.catalog_change_log` records every catalog mutation with actor and reason. A SKU whose specification changes after units are listed against it is a live data-integrity problem — log it and alert.

## Task 7 — Bulk import

CSV import for SKUs with:
- A downloadable template with the exact columns and an example row
- Dry-run mode reporting per-row: `WILL_CREATE`, `WILL_MERGE (existing sku_code)`, `ERROR (reason)` — **before** anything is written
- Idempotent commit keyed on `normalized_key`
- A downloadable error report keyed by input row number

Seed **200 real SKUs** from the client's existing inventory data. This is a joint task with ops — the engineer builds the importer, ops supplies the rows.

## Task 8 — Search foundations

- `tsvector` column on `sku`, GIN-indexed, weighted: brand and model highest, then CPU and RAM, then everything else
- A materialised facet-count query for the filter rail: brand, series, CPU family, RAM, storage, screen size, grade availability
- Trigram index for typo tolerance on model names
- Benchmark now and record the baseline. Phase 5's budget is **search p95 < 300 ms** and **offers grid p95 < 500 ms**; if the catalog layer is already at 200 ms you have a problem to solve here, not in Phase 5

## Exit criteria

- [ ] 200 real SKUs seeded, each with a `normalized_key` that survives 200 spelling-variant property tests
- [ ] Every seeded model has a complete condition-image set for every grade it will be offered in, and the admin coverage grid shows zero gaps
- [ ] Requesting images for a `(sku, grade)` with no exact match falls back through model → series → labelled placeholder, in that order, proven by test
- [ ] Every rendered image carries the representative-image caption; a component test asserts it cannot be rendered without one
- [ ] `catalog.grade_definition` exists with numeric thresholds, and the Phase 4 QC engine will read it (not hard-coded constants)
- [ ] A duplicate SKU submitted through the request flow surfaces the existing SKU before submission
- [ ] CSV dry-run reports per-row outcomes and writes nothing; commit is idempotent on re-run
- [ ] Search p95 on the seeded catalog is recorded as a baseline
- [ ] `catalog.catalog_change_log` captures every mutation with an actor

═══════════════════════════════════════════════════════════════════
