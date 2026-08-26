# RETROFIT — bring completed Phase 0 and Phase 1 up to the current decisions

**Paste everything between the `═══` markers into Claude Code before starting Phase 2.**
**Estimated size:** 1 engineer, 3–4 days. Nothing here is a rewrite; it is rename, restyle, and add.

**Why this exists.** Phase 0 and Phase 1 were built against the pack as it stood on 25 August. Six decisions have been made since. Applying them now costs days. Applying them after Phase 5 costs a month, because by then the brand is in schema seeds, invoice series, notification templates and the certificate face.

---

═══════════════════════════════════════════════════════════════════

You have completed Phase 0 (foundation, schema hardening, design system) and Phase 1 (identity, RBAC, onboarding engine) of this project. Six decisions have been made since those phases were written. Apply them all before Phase 2 begins.

**Read these first, in this order:**
- `docs/_CONTEXT.md` — updated; the model section and the stack table have both changed
- `docs/08_BRAND_SYSTEM.md` — **new.** The name is decided and the entire design system is replaced
- `docs/06_AMENDMENT_R2.md` — multi-vendor comparison, warranty stacking, QR-coded QC
- `docs/07_DEVICESURE_INTEGRATION.md` — the QC tool is a product with its own tenancy, not a file parser
- `docs/02_ARCHITECTURE.md` §1.2 — the console framework has changed

Work through the six changes below in order. **Change 1 touches the most files, so do it first while the codebase is still small.**

---

## Change 1 — Rename: gorefurbo → Trugrade

The brand is decided: **Trugrade**. Legal entity remains TrueTech Services Pvt. Ltd. The QC product keeps its own name, **DeviceSure**.

1. Create `packages/config/src/brand.ts` exactly as specified in `docs/08_BRAND_SYSTEM.md` §2.
2. Replace **every** literal `gorefurbo` / `Gorefurbo` / `GOREFURBO` across the monorepo with a reference to `BRAND`. Search the whole tree including: package names, workspace scope (`@gorefurbo/*` → `@trugrade/*`), Docker service and volume names, database name, S3 bucket names, seed data, notification templates, email `from` addresses, page titles, meta tags, README, CI workflow names, `.env.example`.
3. **Do not hard-code a brand string in any component.** A grep for `Trugrade` inside `apps/` or `packages/ui/` should return zero results outside `brand.ts`.
4. Rename the repo root and the git remote if you control them.

**Verify:** `grep -ri "gorefurbo" .` excluding `node_modules` and `docs/legacy/` returns nothing.

---

## Change 2 — Replace the design system

`docs/08_BRAND_SYSTEM.md` supersedes Part 1 of `docs/03_UX_SPEC.md` and the token section of `_CONTEXT.md`. The palette, the typefaces and the radii have all changed. **This is a replacement, not a merge — do not leave the old navy/cyan/orange tokens in place alongside the new ones.**

1. **Tokens.** Replace the `:root` block in `packages/ui/src/globals.css` with §4 of the brand doc verbatim — light, `prefers-color-scheme: dark`, and `[data-theme="dark"]`, all three. Regenerate `tailwind.config.ts` from it.
   - Gone: navy `#191F2E`, cyan `#17AFC5`, orange `#FE9D00`.
   - New: graphite `#14181D`, calibration `#EFF1EE`, **signal blue `#1F3CE0`**.
   - **Add the spacing scale** (2·4·8·12·16·20·24·32·40·48·64·80). It did not exist in the old system — spacing was hard-coded inline everywhere.
   - **Radii get flatter**: 3/5/7/10/14, replacing 6/10/14/20/28.
2. **Fonts.** Poppins and Inter are out. Load **Instrument Sans** (display), **IBM Plex Sans** (body), **IBM Plex Mono** (data) — §5 has the exact `<link>`. Add **IBM Plex Sans Devanagari** for Hindi.
3. **Components to change:**
   - `Button` — primary is now signal blue with white text. There is no orange in this system.
   - `GradeBadge` — **strip the colour.** Neutral surface, neutral border, ink text. A+/A/B are all sellable; colour is reserved for verdicts.
   - `StatusPill` — semantic only: PASS, WARN, FAIL, NOT MEASURED, SEALED.
   - `ScoreRing` — signal blue, `--warn` below 80. Replaces the tri-arc ring.
   - Focus ring — signal blue, 2px, 3px offset. **The old cyan focus ring failed contrast at 2.64:1; do not reproduce it.**
4. **Two new components:**
   - **`ToleranceBand`** — the signature device. Full spec in §6, including the three states. **The third state is the one that matters: when a value was not measured, render no dot at all.** A missing value must never read as a passing one.
   - **`Evidence`** — renders any percentage with its denominator beneath it (`98%` / `412 units`). Every statistic in the product uses it.
5. **New `Mark` component** — the tolerance-gauge logo SVG from §3.
6. Update every Storybook story. Re-run axe; the contrast pairs in §9 are verified, so violations mean an implementation slip, not a token problem.

---

## Change 3 — Console moves from Next.js to Vite + React

`apps/console` was scaffolded as Next.js. Change it to **Vite + React + React Router + Vitest**.

**Why:** the console is authenticated-only with zero SEO value, so SSR is pure overhead — and DeviceSure's `apps/web` is already exactly this stack, so the team has built it once. A small team fighting App Router caching on an admin data grid under deadline is the worse trade.

- `apps/storefront` **stays Next.js 15 App Router** — it genuinely needs SSR/ISR for model and brand pages.
- `packages/ui` is plain React and is consumed unchanged by both.
- Move the admin KYC review queue built in Phase 1 into the Vite app.
- Keep the routing structure and RBAC guards; only the framework changes.

---

## Change 4 — Vendor onboarding: four new captures

Phase 1 built the 7-step vendor flow. Four fields are missing, all of which later phases depend on.

**Step 2 · Business — per facility:**
- **`dispatch_address`** — the exact address goods leave from. This becomes `Dispatch From` on every e-way bill. It is not always the registered address, and getting it wrong at scale is expensive to correct.

**Step 4 · Capability:**
- **`can_dropship`** (boolean, required) — can this vendor dispatch directly to a buyer's address rather than to a hub? In this model that is the default flow, so a vendor who cannot do it is a materially different vendor. Show it in the admin review queue.

**Step 2 · Condition declaration** *(this field lives on the listing, but the vendor's default is set here)*:
- **`default_warranty_months`** (integer 0–24) and **`warranty_scope`** (structured coverage, matching `platform.warranty.coverage_json`). The vendor is making a commercial commitment, not a note. Tell them plainly on this screen that **we sell a longer total term than they offer and carry the difference ourselves** — nobody should discover that during a claim.

**Step 7 · Payout preferences:**
- **`pricing_mode ∈ ('NET_PAYOUT','COMMISSION')`**, default `NET_PAYOUT`. See Change 5.

Add all four to `kyc.onboarding_progress` step validation, the admin review screen, and the post-approval change-control matrix (`can_dropship` and warranty terms are freely editable; dispatch address is audit-logged).

---

## Change 5 — The payout basis, and the freeze rule

**Decided: the vendor names their net payout. We add our charge.** Not a discount off our listed price.

Add `vendor.vendor_payout_preference.pricing_mode ∈ ('NET_PAYOUT','COMMISSION')`, default `NET_PAYOUT`:
- **`NET_PAYOUT`** — vendor enters the rupee amount they want to receive. We derive the selling price.
- **`COMMISSION`** — vendor enters an expected sale price and an agreed rate; the system **derives and immediately freezes** the net payout.

Both modes converge on the same stored rupee value. `COMMISSION` exists because vendors think in percentages; it is a presentation layer over the same contract.

**Build the live commission readout in the listing wizard** (Phase 3, but the preference is captured here): the vendor enters ₹28,000 and the screen shows *"Trugrade commission: 12.8%"*. They get the percentage conversation they expect while the contract stays anchored to a fixed amount.

**The freeze rule, and it is not optional.** `listing.unit.purchase_price` is written when the purchase order is raised and is **immutable thereafter**. Add a trigger mirroring `listing.lock_valuation_method()`:

```sql
CREATE OR REPLACE FUNCTION listing.lock_purchase_price() RETURNS trigger AS $$
BEGIN
  IF OLD.purchase_price IS NOT NULL AND NEW.purchase_price IS DISTINCT FROM OLD.purchase_price THEN
    RAISE EXCEPTION 'purchase_price is immutable once set (unit %)', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_lock_purchase_price BEFORE UPDATE ON listing.unit
  FOR EACH ROW EXECUTE FUNCTION listing.lock_purchase_price();
```

Nothing that happens to the retail price afterwards — a promotion, a grade correction, a price match — may change what we owe a vendor. Write the test that proves it.

---

## Change 6 — Schema additions

Add these now so later phases do not need a migration against live data.

**6.1 — Warranty stacking** (`platform.warranty`, consumed in Phase 9):
```sql
ALTER TABLE platform.warranty
  ADD COLUMN total_months           INT NOT NULL DEFAULT 6,
  ADD COLUMN vendor_backed_months   INT NOT NULL DEFAULT 0,
  ADD COLUMN platform_backed_months INT NOT NULL DEFAULT 0,
  ADD COLUMN vendor_org_id          UUID,          -- INTERNAL. Never leaves the API.
  ADD COLUMN reserve_amount         NUMERIC(14,2),
  ADD COLUMN reserve_released_at    TIMESTAMPTZ,
  ADD CONSTRAINT chk_warranty_split
    CHECK (vendor_backed_months + platform_backed_months = total_months);
```
**Drop the customer-visible `provider` column** if Phase 0 created one. A customer-facing `provider` field defeats both the trust play and the anonymity model — the customer deals only with us, for the whole term.

**6.2 — Listing warranty and pricing** (`listing.listing`):
```sql
ALTER TABLE listing.listing
  ADD COLUMN vendor_warranty_months INT NOT NULL DEFAULT 0,
  ADD COLUMN vendor_warranty_scope  JSONB;
```

**6.3 — Vendor quality aggregates** (`qc` schema, populated in Phase 4, read by Phase 5):
```sql
CREATE TABLE qc.vendor_sku_quality (
  vendor_org_id      UUID NOT NULL,
  sku_id             UUID NOT NULL,
  grade              grade_type NOT NULL,
  units_inspected    INT NOT NULL DEFAULT 0,
  avg_qc_score       NUMERIC(5,2),
  median_qc_score    NUMERIC(5,2),
  battery_health_min INT, battery_health_max INT,
  grade_corrections  INT NOT NULL DEFAULT 0,
  grade_accuracy_pct NUMERIC(5,2),
  last_inspected_at  TIMESTAMPTZ,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_org_id, sku_id, grade)
);
```
Plus `qc.vendor_quality` with the same shape rolled up across all SKUs.

Add `platform_config` key `quality.min_sample_for_headline` **default 10** — below this many inspected units, the storefront shows "New supplier · N units inspected" instead of a percentage.

**6.4 — Margin rule extensions** (`procurement.margin_rule`):
```sql
ALTER TABLE procurement.margin_rule
  ADD COLUMN warranty_top_up_months INT NOT NULL DEFAULT 3,
  ADD COLUMN reserve_pct_by_grade   JSONB;   -- {"A_PLUS":0.8,"A":1.2,"B":2.0} as % of payout
```

**6.5 — DeviceSure licence lifecycle:**
```sql
ALTER TABLE vendor.vendor_profile
  ADD COLUMN devicesure_org_id      TEXT,
  ADD COLUMN devicesure_licence_key TEXT,
  ADD COLUMN devicesure_status      TEXT
    CHECK (devicesure_status IN ('NONE','PENDING','ACTIVE','SUSPENDED','REVOKED'));
```
Subscribe the `vendor` module to its own `vendor.suspended` and `vendor.verified` events: verification issues a DeviceSure `VENDOR` licence, suspension revokes it. **A suspended vendor must lose the ability to certify machines** — that is the enforcement mechanism the entire quality model rests on, and it is cheap now and awkward to retrofit.

---

## Verify before starting Phase 2

- [ ] `grep -ri "gorefurbo"` returns nothing outside `docs/legacy/`
- [ ] `grep -r "Trugrade"` inside `apps/` and `packages/ui/` returns nothing — the brand comes only from `BRAND`
- [ ] No `#191F2E`, `#17AFC5` or `#FE9D00` anywhere in the codebase
- [ ] Storybook builds; every component renders in both themes; axe reports zero violations
- [ ] `ToleranceBand` renders all three states, and the not-measured state renders **no dot**
- [ ] `GradeBadge` is neutral in every variant
- [ ] `apps/console` runs under Vite; `apps/storefront` still runs under Next.js; both consume `packages/ui`
- [ ] A vendor completing onboarding supplies dispatch address, `can_dropship`, default warranty months and scope, and pricing mode
- [ ] `lock_purchase_price` raises on an attempt to change a set `purchase_price`
- [ ] `chk_warranty_split` rejects a warranty whose parts do not sum to the total
- [ ] `platform.warranty` has no customer-visible `provider` column
- [ ] Verifying a vendor issues a DeviceSure licence; suspending one revokes it
- [ ] Migrations still run clean on an empty database
- [ ] Every Phase 0 and Phase 1 test still passes

═══════════════════════════════════════════════════════════════════
