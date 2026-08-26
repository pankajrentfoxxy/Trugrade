# Amendment R2 — multi-vendor comparison, warranty stacking, QR-coded QC

**25 August 2026.** Supersedes the affected passages in `_CONTEXT.md`, `PHASE_03`, `PHASE_04`, `PHASE_05`, `PHASE_07` and `PHASE_09`. Those files have already been patched — this document explains what changed and why, so you can check my reading rather than re-read six files.

---

## 1. What you said, and how I read it

> *"We are not purchasing laptop from vendor, we have to show customer that example: a laptop model Dell Latitude 5320 listed by 10 vendor at different prices. Customer has an option to check price with avg QC Result of that laptop with that seller and city. On the basis of that customer will decide from whom he will purchase. Vendor will also give the warranty and we will also cover — seller has given 3 month but we gave 6 month overall warranty to gain trust of customer. We are sending price of decided product after our charge."*

Four separate things in there. Three were already built. One was not.

| What you described | Status |
|---|---|
| Ten vendors listing the same model at different prices, compared on one screen | **Already built** — Phase 5, Task 4 |
| Selling price = vendor's price + our charge | **Already built** — Phase 3, Task 5 |
| No purchasing / no stock | **Already how it works** — the PO is raised at the moment of order, goods ship vendor→customer, we never hold a laptop |
| Average QC result per vendor as a comparison column | **New** — added to Phases 4 and 5 |
| Vendor 3 months, we sell 6 | **New** — added to Phases 3, 7 and 9 |
| QC report with a QR code | **New** — added to Phase 4 |

---

## 2. The one thing I had to assume

You said *"customer will decide from whom he will purchase"*. That sentence reads two ways, and the two readings are different businesses.

**I have assumed you meant: the customer chooses which vendor's machine to buy, but buys it from us.** That is the back-to-back model — we hold no stock and tie up no capital, but we are the seller of record and our name is on the invoice.

I assumed it because three other things you said only work under that reading:
- *"We are sending price of decided product after our charge"* — we set the price and mark it up. A commission facilitator doesn't do that.
- *"We will also give the warranty"* — we can only warrant a machine we sold.
- Vendor anonymity, which you've now asked for twice.

**If instead you meant the customer contracts with the vendor and we take a commission, tell me and I'll rewrite Phases 5–7.** Be aware of what comes back with it:

| | Back-to-back (assumed) | Commission marketplace |
|---|---|---|
| Vendor anonymity | Lawful | **Illegal** — r.5(3)(a) forces vendor name, address and phone pre-purchase |
| GST TCS u/s 52 | None | 0.5%, plus monthly GSTR-8 |
| TDS as an operator | None | 0.1% u/s 393(1) Sl.8(v) |
| Money | Ordinary receivables and payables | Split settlement through a licensed PA (Razorpay Route) |
| Our warranty | Natural — we sold it | Awkward — warranting someone else's sale |
| Capital tied up in stock | **Zero, either way** | Zero |

Both models hold zero inventory. The difference is not capital — it is who the customer's contract is with, and therefore which regulations apply.

---

## 3. The comparison grid — what a customer now sees

Ten vendors, one Latitude 5320, one screen.

| Column | What it is |
|---|---|
| Supply point · city | `Supply Point A · Gurugram` — a dispatch location, not a legal seller |
| **Our price, landed** | Vendor's ask + our charge + freight + GST. One figure; break-up one click away. The vendor's number is never shown |
| **Avg QC score, this model** | Mean QC score across that supply point's units of this exact SKU |
| **Grade accuracy** | How often that supply point's declared grade survived our inspection, with the denominator shown |
| Battery health range | e.g. 88–94% |
| **Total warranty** | The total months the customer gets. Never the split |
| Units available · dispatch · inspection date | as before |

**A deliberate change from the last draft.** Buyers now *do* see quality metrics per supply point, because choosing between supply points is the entire purpose of this screen. What stays hidden is **identity**, not **performance**. A number describing how well a supply point's machines test is not a route back to who they are.

**Small samples get no headline number.** A supply point with 3 inspected units shows `New supplier · 3 units inspected`, not a 100% accuracy badge. Threshold configurable, suggested 10. Under CP e-Comm r.7(2) and the CCPA Misleading Advertisements Guidelines 2022, an authoritative-looking average computed on two machines is **our** misrepresentation, not the vendor's.

**Where it is computed:** `qc.vendor_sku_quality` and `qc.vendor_quality`, materialised in Phase 4, refreshed on `qc.report.completed` and nightly. Not calculated live — the grid has a 500 ms budget and already touches six tables. The API serves them keyed by `supply_point_code`; the vendor `org_id` never crosses the DTO boundary.

---

## 4. Warranty stacking — how the 3-becomes-6 works

The customer sees **one number: 6 months.** Internally it is two layers.

```
platform.warranty
  total_months            6      -- what the customer bought
  vendor_backed_months    3      -- what the vendor stands behind
  platform_backed_months  3      -- our top-up
  vendor_org_id                  -- INTERNAL, never leaves the API
  reserve_amount                 -- accrued at sale, from margin
  CHECK (vendor_backed + platform_backed = total)
```

**Four rules:**

1. **We are the sole warrantor for the whole term.** The customer never learns there was a split, never chases a vendor, never waits on our recovery. I removed the old customer-visible `provider` field — it defeated both the trust play and the anonymity model.
2. **A claim in month 2 is settled with the customer immediately**, and recovered from the vendor afterwards as a line on their next payout statement, naming the serial and the claim number. The two never touch in time.
3. **A claim in month 5 is ours alone** and draws on the warranty reserve.
4. **The top-up is a priced cost, not a marketing promise.** A per-unit reserve accrues at sale from margin, banded by grade — a Grade B machine claims materially more often than an A+. Released to margin on expiry. Without this, the 6-month promise is an unpriced liability growing with every sale.

**The incentive worth noticing:** a vendor offering 6 months costs us nothing to top up; one offering 1 month costs us five. So `vendor_warranty_months` is now a **pricing input** — captured in the listing wizard, fed into `margin_rule`, and shown to the vendor live in their payout preview. It is the cleanest lever you have for pushing vendors to stand behind their own machines.

**Watch claim-rate against reserve weekly from launch.** It is the number that says whether the extra three months is a trust investment or a slow leak, and it only becomes visible after about ninety days — by which point you have sold a lot of warranties.

**⚠ SIGN-OFF:** selling cover that outlasts the supplier's is ordinary commercial practice. Check with counsel whether a *separately priced* extended warranty would be characterised as an insurance contract. Bundling it into the sale price — as this design does — is the conservative structure.

---

## 5. The QC platform and the QR code

You are building a full QC platform producing a report with a QR code. The plan now treats that as the canonical inspection tool.

- The QR code resolves to **`/qc/verify/:verification_code`** — the public per-serial verification page. `qc_report.verification_code` already exists in your schema and is `UNIQUE`
- The page must work for someone standing next to the machine with a phone and **no account**: serial and grade above the fold, a large PASS state, photographs that zoom, and the seal code big enough to check against the sticker in front of them
- The report is printed and **ships with the machine**, so the buyer's receiving staff can scan and verify before they sign — which is also the moment the tamper seal earns its keep
- `verification_code` must be **unguessable** — 12+ random characters, never a sequence. It is a public URL, and an enumerable one leaks your entire inventory to a scraper. Rate-limit it, and keep it out of `robots.txt`

**Still needed from you:** the report format, the signing method, and whether the tool reads the serial from SMBIOS. `02_ARCHITECTURE.md` §5.3 proposes a contract. When your real one arrives, we change the contract and `qc_tool_provider.field_map_json` — never your tool. **Nothing in Phases 0–3 or 5–10 is blocked by this**; only Phase 4's ingestion layer waits on it, and it has a working mock in the meantime.

The report you mentioned sending did not arrive with your message — send it whenever it is ready.

---

## 6. Files changed

| File | Change |
|---|---|
| `_CONTEXT.md` | Model restated as **back-to-back, zero stock**. New sections: supply-point comparison grid, warranty stacking, the QC platform and QR code |
| `PHASE_03_LISTINGS.md` | Vendor declares `vendor_warranty_months` in the wizard; warranty reserve added to the pricing formula; "selling price" language replaces "retail price" |
| `PHASE_04_QC.md` | QR code on the report and the public verification page hardened; new Task 11 building `qc.vendor_sku_quality` aggregates with the small-sample rule |
| `PHASE_05_STOREFRONT.md` | Comparison grid rebuilt around the ten-vendor scenario with avg QC score, grade accuracy and total warranty; exit criteria now test ten supply points |
| `PHASE_07_PROCUREMENT_PAYMENTS.md` | Warranty recovery added to the payout deduction stack, naming serial and claim |
| `PHASE_09_AFTERSALE.md` | Warranty stacking schema and the four rules; customer-visible `provider` field removed; reserve accrual and release |

---

## 7. Still open

**Q21 (new, and it blocks Phase 5).** Confirm the assumption in §2 — customer contracts with **us**, not the vendor. One line either way.

**Q22 (new).** What is the platform top-up rule? A flat "always 6 months total", or "vendor's term + 3", or by grade (A+ gets 12, B gets 6)? It changes the reserve model and the margin rule.

**Q23 (new).** Small-sample threshold for showing a headline QC average — I have assumed 10 inspected units. Confirm or change.

The twenty questions in `01_DECISIONS_AND_COMPLIANCE.md` Part 4 still stand. **Q14 and Q15 remain the highest-value ones** — the QC tool's real output contract, and whether your staff or the vendor's staff physically run the inspection.
