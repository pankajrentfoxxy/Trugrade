# PHASE 3 — Vendor listings, units, serials and pricing

**Prerequisite:** Phase 2 exit criteria green.
**Estimated size:** 2 engineers, 6–8 days.
**Covers your requirement #6, and sets up #13.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. Read `docs/_CONTEXT.md` and `docs/02_ARCHITECTURE.md` if not in context.

Additional reading: `docs/legacy/Gorefurbo_Schema_Design_Annotated.md` Part 7, `docs/legacy/truetech-operations-journeys.html` Journey 1 (Listing stock), `docs/03_UX_SPEC.md` §3B (vendor listing wizard), `docs/04_TEST_PLAN.md` §3.6.

## Objective

A verified vendor lists 50 real laptops with serial numbers in under 10 minutes, declares a grade and an expected net payout per unit, and submits — **and the listing does not go live.** It requests an inspection. That last sentence is the whole design.

## Task 1 — The listing model

`listing.listing` is a vendor's offer of *n* units of one SKU at one grade from one facility.
`listing.unit` is **one physical laptop**, with a serial number.

The relationship matters: a buyer browses listings, but a buyer *receives* units, and every promise you make is about a specific unit. Reserve, allocate, ship, warrant and dispute all happen at unit level.

**Existing constraints to preserve:**

```sql
CONSTRAINT chk_qty_nonneg  CHECK (qty_available >= 0 AND qty_reserved >= 0 AND qty_total >= 0),
CONSTRAINT chk_qty_balance CHECK (qty_available + qty_reserved + qty_awaiting_qc
                                  + qty_qc_failed <= qty_total),
CONSTRAINT chk_price_pos   CHECK (unit_price > 0),
CONSTRAINT chk_sellable    CHECK (functional_status <> 'NON_FUNCTIONAL')
```

**And the most important index in the entire database:**

```sql
CREATE UNIQUE INDEX uq_unit_active_serial ON listing.unit (serial_number)
  WHERE status NOT IN ('RETURNED_TO_VENDOR','SCRAPPED');
```

A serial can be live in exactly one place, nationwide, across all vendors. This is what stops the same laptop being listed by two vendors, or re-listed while it is already on a truck. It is a **partial** unique index because a returned or scrapped unit's serial must be re-listable later — test both directions (`LST-005`, `LST-006`, `LST-007`, `LST-010`).

## Task 2 — Add the merchant-of-record columns

Apply the `listing.unit` migration from `02_ARCHITECTURE.md` §2.3: `vendor_ask_price`, `purchase_price`, `valuation_method`, `itc_eligible`, `retail_price`, `margin_rule_id`, `supply_point_code`. Include the `lock_valuation_method()` trigger.

**What each means in this phase:**
- `vendor_ask_price` — what the vendor says they want, **net of everything**, entered in the wizard. This is the vendor-facing number.
- `purchase_price` — what we actually agree to pay. Set in Phase 7 when the PO is raised. Null now.
- `retail_price` — what the customer pays. Computed by the pricing engine in Task 5.
- `valuation_method` — derived from the vendor's GST registration status at listing time, `REGULAR` or `MARGIN`. **Immutable once `purchase_price` is set.**
- `supply_point_code` — the anonymised label (`A`, `B`, `C`) assigned per vendor per city. Assign it here, at listing time, so it is stable.

## Task 3 — The listing wizard, four steps

Follow Journey 1 in the operations blueprint.

**Step 1 · Pick the machine.** Search the catalog, select a SKU. Show the SKU's declared specification. If not found, hand off to the Phase 2 SKU-request flow without losing the wizard state.

**Step 2 · Declare the condition and the warranty.** Grade `A_PLUS | A | B`, functional status, battery condition band, any known defects, accessories included (charger, bag), OS and licence status. Show `catalog.grade_definition.customer_description` inline so the vendor grades against the same definition the QC engine will use.

**Plus — the warranty the vendor will stand behind.** Add `listing.vendor_warranty_months` (integer, 0–24) and `listing.vendor_warranty_scope` (a structured coverage object matching `platform.warranty.coverage_json`). This is a **commercial commitment, not a note** — it is captured here, priced in Task 5, and becomes a recoverable obligation in Phase 9.

Two things the screen must make plain to the vendor:
- **What they offer is not what the customer sees.** We sell a longer total term than they offer and carry the difference ourselves. Tell them that here, in one sentence, so nobody discovers it during a claim.
- **A longer vendor warranty earns a better price.** It costs us less to top up. Show the effect live in Task 5's payout preview — this is the cleanest incentive you have for pushing vendors toward standing behind their own machines.

**The screen must say, plainly: "We will check this."** The vendor is declaring, not deciding. Show the grade-correction consequence up front — this is the single biggest source of vendor disputes, and disclosure at declaration time is worth more than an appeals process later.

**Step 3 · Serial numbers.** Three input methods, all of which must work:
- Paste a block of serials, one per line
- CSV upload with dry-run + per-row error report
- Barcode scan (Phase 4's technician app; here, a web camera scanner using `zxing-js`)

Validation on entry, per serial:
- Format check per brand where a pattern is known (Dell service tags are 7 alphanumeric; HP, Lenovo and Apple have their own shapes). Warn, do not block, on an unrecognised pattern — you will meet machines whose labels are worn
- **Global uniqueness check against `uq_unit_active_serial`, live, as they type** — showing "already listed" before submission, not after
- Blacklist check against `kyc.blacklist_entry` on serial
- Duplicate-within-paste detection

**Test the label scanning on real machines in week one, not week three.** Worn and reprinted asset labels are the most common cause of a scanning feature that works in the office and fails at a warehouse. Manual entry is always available as the fallback.

**Step 4 · Price.** The vendor enters an expected **net payout per unit**. Show them, live:
- What they will receive per unit and for the batch
- Which deductions apply (QC visit fee if applicable, TDS if their cumulative purchases cross ₹50 lakh this financial year, any standing penalties)
- Their expected payout date given their `vendor_payout_preference` cycle
- **Do not show them the retail price.** Your margin is not their business, and showing it invites a negotiation you do not want to have per unit.

**Tier pricing** (`listing.listing_tier_price`) with the existing overlap guard:

```sql
EXCLUDE USING gist (
  listing_id WITH =,
  int4range(min_qty, COALESCE(max_qty, 2147483647), '[]') WITH &&
)
```

## Task 4 — On submit, the listing does NOT go live

This is the pivot of the whole model.

```
On submit:
  listing.status      := 'AWAITING_QC'
  unit.status         := 'AWAITING_QC'   for every unit
  unit.is_sellable    := FALSE
  listing.qty_awaiting_qc := n
  → create a qc.qc_visit in status REQUESTED   (Phase 4 schedules it)
  → notify the vendor: "Inspection requested. We'll confirm a slot within X hours."
```

Nothing is visible to a buyer. `qty_available` stays zero. **Write the test that proves a buyer-facing search returns zero results for a listing in `AWAITING_QC`** (`LST-030`).

Minimum units per visit is `qc.min_units_per_visit` (default 25) and the visit fee is `qc.visit_fee_inr` (default ₹1,500, waived above 50 units) — both from `platform_config`, both confirmable by the client. If a vendor submits fewer than the minimum, offer to hold the units until they reach it, or accept the fee. Do not silently reject.

## Task 5 — The pricing engine

`procurement.margin_rule` and `procurement.price_book` are created here (the tables live in the `procurement` schema; the *engine* is used from listing).

**Margin rules**, evaluated first-match-wins by `priority`:

```
priority | category | brand | grade | value_from | value_to | target_margin_pct | floor_margin_pct
```

Nullable predicate columns mean "don't care", exactly like the routing rules in Phase 8. Ops tunes margins without a code release.

### The payout basis — decided, and it is not the obvious one

Two models were considered. **Build model A.**

| | **A · Vendor names their net payout** ✅ | B · Discount off our listed price ❌ |
|---|---|---|
| Mechanic | Vendor says "₹28,000". We add our charge → ₹32,100 | We list at ₹32,100 and pay ₹32,100 less an agreed % |
| Vendor certainty | Known at listing time, unchangeable | Floats with every pricing decision we make |

**Why B breaks, concretely:**
- **Freight varies by destination.** The landed price to Chennai differs from Gurugram. Under B a vendor's payout would depend on where the buyer happens to be — they will never accept it.
- **Discounting becomes a negotiation.** Drop a price to win a large order and either the vendor's payout drops (they refuse to be discounted) or our margin absorbs all of it.
- **Grade corrections turn into pricing arguments.** We correct A→B and reprice; under B the vendor's payout changes because of *our* decision, so every correction is disputed as a pricing trick rather than a finding about the machine.
- **Tax needs a fixed purchase price per serial.** Rule 32(5) margin computation and the immutable `valuation_method` both require it. A floating payout makes the position indefensible.

**The reconciliation — build this, it is what makes A acceptable to vendors.** Present A in B's language. The vendor enters ₹28,000; the wizard shows them *"Trugrade commission: 12.8%"* live. They get the percentage conversation they expect; the contract stays anchored to a fixed rupee amount.

Add `vendor.vendor_payout_preference.pricing_mode ∈ ('NET_PAYOUT','COMMISSION')`, default `NET_PAYOUT`. In `COMMISSION` mode the vendor names an expected sale price and an agreed rate, and the system **derives and immediately freezes** the net payout. Both modes converge on the same stored value.

**The non-negotiable rule in either mode:** `unit.purchase_price` is written when the PO is raised (Phase 6) and is **immutable thereafter** — same guarantee as `valuation_method`, enforced by trigger. Nothing that happens to the retail price afterwards touches what we owe.

**Selling price computation.** The customer's price is the vendor's asking price plus our charge — that is the whole formula, and the vendor's number is never shown to a buyer.

```
selling_price = vendor_ask_price
              × (1 + margin_pct)
              + logistics_allowance(from_pincode, to_zone, weight)
              + qc_cost_allocation
              + warranty_reserve(grade, platform_top_up_months)
              , rounded to the configured rounding rule
```

**`warranty_reserve` is new and it must not be skipped.** We sell 6 months against a vendor's 3, so months 4–6 are ours to fund. Accrue a per-unit reserve at sale, funded from margin, banded by grade — a Grade B machine claims more often than an A+. `margin_rule` gains `warranty_top_up_months` and `reserve_pct_by_grade`, so a vendor offering 6 months costs less to carry than one offering 1, and the price reflects it. Phase 9 releases the reserve on expiry and draws it on claims.

Then the **landed price** shown to a buyer for a specific delivery pincode adds freight and GST:

```
landed = retail_price + freight(to_pincode) + GST(18%, IGST or CGST+SGST by state)
```

**Guard rails that must exist:**
- A floor margin below which the listing cannot go live without an ops override, and the override is logged with a reason
- A price-band sanity check against the trailing 30-day median for the same `(sku, grade)` — a listing 60% below median is either a data-entry error or a fraud signal. Flag it for review, do not auto-reject
- `listing.price_history` records every price change, with actor and reason
- Rounding is `NUMERIC(14,2)` throughout, and the rounding rule is applied **once**, at the end. Test that a 500-line order shows zero drift (`PAY-017`)

## Task 6 — Stock movement and drift

`listing.stock_movement` is append-only (`REVOKE UPDATE, DELETE`), records every `from_status → to_status` transition per unit with a reason and an actor.

`listing.v_stock_drift` compares listing counters against actual unit counts and must return zero rows nightly. If it does not, the counter triggers from Phase 0 have a bug — and a counter bug is how you oversell.

## Task 7 — Vendor portal screens

- Dashboard: units awaiting QC, live, sold this month, expiring QC, payouts due, open grade corrections
- Listing wizard (Task 3)
- Listing management: filter, bulk pause/resume, reprice, view per-unit status
- **Per-unit view** showing the full lifecycle: declared → inspected → graded → sealed → listed → reserved → dispatched → delivered
- Bulk CSV upload with dry-run
- QC-expiry warnings — 14 days ahead, per `qc.v_expiring_qc`

## Task 8 — Sourcing declaration

`vendor.vendor_sourcing_declaration` per listing or batch: `source_type` (corporate buyback, lease returns, auction, imports, retail exchange), source organisation name, acquisition invoice number and date, a supporting document above a configurable value threshold, and the **named person** who declared it.

This does two jobs. It is your anti-theft control — a stolen-laptop claim against a machine you sold is a criminal matter, not a refund. And it is the **GST margin-scheme determinant**: whether the vendor is registered, and whether ITC was available, decides `valuation_method`. Capture the vendor's GST status **at the declaration date**, verified against the GSTN API, not self-declared (`02_ARCHITECTURE.md` §2.3, `01_DECISIONS_AND_COMPLIANCE.md` §2.3).

Define the value threshold in `platform_config` — the source schema says "configurable" and never gives a number. Suggest ₹50,000 per unit; confirm with the client.

## Exit criteria

- [ ] A vendor lists 50 units with serials in **under 10 minutes**, timed, on a real device
- [ ] A duplicate live serial is rejected **at the database**, not just the application (`LST-005`) — prove it by attempting a direct SQL insert
- [ ] A serial on a `RETURNED_TO_VENDOR` unit can be re-listed (`LST-007`)
- [ ] Submitting a listing puts it in `AWAITING_QC` and creates a `qc_visit`; a buyer search returns zero results for it
- [ ] Tier-price bands cannot overlap — the `EXCLUDE` constraint fires
- [ ] `valuation_method` is set from verified vendor GST status and cannot be changed once `purchase_price` is set
- [ ] A margin rule change alters the retail price of new listings without a deploy
- [ ] A listing priced 60% below the 30-day median is flagged, not blocked
- [ ] `listing.v_stock_drift` returns zero rows after a 500-unit seed with concurrent status changes
- [ ] Barcode scanning works on **real laptop labels**, on a real device, tested this week
- [ ] The vendor never sees the retail price anywhere in the vendor portal — assert it in the API response test

═══════════════════════════════════════════════════════════════════
