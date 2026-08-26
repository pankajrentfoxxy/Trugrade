# PHASE 5 — Storefront, search, and the anonymised supply-point grid

**Prerequisite:** Phase 4 exit criteria green.
**Estimated size:** 2 engineers, 8–10 days.
**Covers your requirements #8, #9.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. Read `docs/_CONTEXT.md` — **especially §"Vendor anonymity display rule"** — and `docs/02_ARCHITECTURE.md` §3 (the anonymity architecture) in full before writing a line of this phase.

Additional reading: `docs/03_UX_SPEC.md` §3A, `docs/04_TEST_PLAN.md` §3.1 (the anonymity whitelist sweep, `IDN-080`…`IDN-094`), `docs/legacy/New_plan/index.html` and `home_1.html` for the visual direction, `docs/legacy/truetech-operations-journeys.html` Journey 3 part 1.

**Brand token:** by this phase you must know whether the brand is `gorefurbo` or one of the names in `docs/05_NAMING.md`. Set `BRAND_NAME`, `BRAND_DOMAIN` and `LEGAL_ENTITY` in `packages/config` and reference them everywhere — never hard-code a brand string in a component.

## Objective

A buyer searches for a laptop, filters it down, opens a product page, compares three supply points on one screen, reads the actual inspection report for a specific serial, and adds units to a cart — **and no vendor legal name, address, GSTIN, contact number or vendor UUID appears anywhere in any API response the buyer can reach.**

## Task 1 — The anonymity guarantee, built server-side

Do this first. Everything else in this phase depends on it, and retrofitting it is how leaks happen.

**Three layers, all mandatory:**

1. **DTO allow-lists at the controller boundary.** Every customer-facing endpoint constructs its response object explicitly from a permitted field list. **Never `return listing`. Never a `@Exclude()` blacklist** — a blacklist fails open the moment someone adds a column.

2. **A CI serialization sweep.** Write a test that hits every customer-facing endpoint with seeded data and asserts the serialized JSON contains, **at any depth**, none of: the vendor's legal name, trade name, GSTIN, PAN, any address line, any contact number, any contact email, or the vendor `org_id`. Assert on the raw JSON string, not on typed properties — a leak through an untyped `metadata` blob is exactly what this catches (`IDN-080`…`IDN-094`).

3. **Repository-level org scope.** Already built in Phase 0. Confirm it covers every read path added here.

**Supply-point labels.** `supply_point_code` is assigned per vendor per city and stored on `listing.unit` in Phase 3. Rules:
- The label is stable for the life of the vendor in that city
- It is **not** derivable from the vendor UUID by any reversible transform
- The ordering of labels must not leak vendor count or identity — do not assign `A` to the oldest vendor and `B` to the next
- Display format: **`Supply Point A · Gurugram`**

**The leaks that are not the obvious field.** Test all of these:
- A PDF filename containing a vendor name
- An S3 key path revealing a vendor slug
- A tracking URL or carrier reference embedding a vendor account code
- An error message echoing an internal entity
- The e-way bill's `Dispatch From` (which lawfully *must* carry the vendor address — that document travels with the goods and there is no way around it; what you control is that under **Case 2** the vendor's *price* never travels. See `01_DECISIONS_AND_COMPLIANCE.md` §2.4)
- A sort order that reveals which supply point is cheapest when prices are equal
- GraphQL-style field expansion or an `include=` query parameter

## Task 2 — Homepage

Take the information architecture from `New_plan/index.html`, which is the more commerce-shaped of the two prototypes. Discard the `home_1.html` dark token set (see Phase 0 Task 7) but keep its editorial ideas where they earn their place — the five-stage process explainer is genuinely good and it explains a model buyers will not have seen before.

Sections, in order:
1. Topbar — a live inspection counter (real number from the database, **not** a fake scarcity device; CCPA Dark Patterns Guidelines 2023 prohibit invented urgency)
2. Nav — Browse, Brands, Grades, How inspection works, Bulk enquiry, Help · Sign in / Create buyer account
3. Hero — search with a category selector, text input, and a **requirement-list upload** (a procurement head has a spreadsheet, not a search query)
4. Trust strip — opened not just described · sealed until it reaches you · GST invoice with serials · inspection window to reject
5. Shop by brand, with real counts
6. Shop by use case — office, developer, design, field
7. Grade explainer, pulling `catalog.grade_definition.customer_description` from the database so it can never drift from what QC actually enforces
8. Moving fastest right now — real listings, real filters
9. Bulk enquiry — three steps
10. Two doors — buyer panel / vendor panel
11. Footer with **Rule 4(2) mandatory disclosures**: legal name, principal geographic address of HQ and all branches, website details, customer-care contacts, and the **grievance officer's name, designation and contact**. This is a legal requirement on every page, not a footer nicety

**Search suggestions** grouped by Models / Specification / — and **not** by seller. The prototype currently has a "Sellers" group showing "Nexus IT Recyclers · Gold · 4.6★ · 38 listings". **Delete it.** It breaks the anonymity model outright.

## Task 3 — Search and filters

Postgres `tsvector` + GIN from Phase 2, with faceted filters:

| Filter | Source |
|---|---|
| Brand, series, model | catalog |
| CPU family and generation, RAM, storage type and size, screen size | catalog |
| **Grade** | `unit.grade_actual` — the *inspected* grade, never the declared one |
| **Inspection score band** | `unit.qc_score` |
| **Measured battery health** | `unit.battery_health_pct` — a real number from a real test, and a genuine differentiator |
| Warranty remaining and provider | `platform.warranty` |
| Quantity available | `qty_available` across supply points |
| Delivery pincode | drives landed price and dispatch estimate |
| Price band | landed price |
| Dispatch commitment | vendor lead time, anonymised to "ships in 24 h / 48 h" |

Only units with `is_sellable = TRUE` are visible. That flag is recomputed by trigger from status + `qc_passed_at` + `qc_valid_until` + seal status. **Never compute sellability in a query** — one place, one definition.

**Budget: search p95 < 300 ms.** Measure it in CI against the seeded catalog and fail the build on regression.

**Rule 5(3)(f) note:** although Rule 5 is marketplace-only and does not bind you, publishing an explanation of your ranking parameters is cheap and good practice. Do it on a `/how-we-rank` page.

## Task 4 — Product detail and the supply-point comparison grid

**This is the most load-bearing screen in the product and it does not exist in any prototype.**

Above the fold: model name, declared specification from the SKU, condition images for the selected grade **with the mandatory representative-image caption**, grade selector, and the price range across supply points.

**The scenario to build for:** a Dell Latitude 5320 is listed by ten different vendors at ten different prices. The customer's job on this screen is to decide which of those ten to buy from, on evidence. Everything else on the page serves that decision.

The comparison grid — one row per supply point offering this SKU at this grade:

| Column | Value |
|---|---|
| Supply point | `Supply Point A · Gurugram` |
| **Our price, landed** | our selling price + GST + freight to the entered pincode, **as one figure with a full break-up available**. This is vendor ask + our charge; the vendor's number never appears |
| **Avg QC score, this model** | `qc.vendor_sku_quality.avg_qc_score` — the headline quality number |
| **Grade accuracy** | `grade_accuracy_pct` — how often this supply point's declared grade survived our inspection |
| Battery health range | e.g. 88–94% |
| **Total warranty** | the **total** months the customer gets. **Never the vendor/platform split** |
| Units available | sellable units only |
| Inspection date · expires | from `qc_report`; **flag anything expiring within 14 days** |
| Dispatch | "ships in 24 h" |
| Action | select quantity, add to cart |

**Small samples do not get a headline number.** A supply point with fewer inspected units than the `platform_config` threshold (suggest 10) shows `New supplier · 3 units inspected` in place of the average and the accuracy figure. Do not render a 100% accuracy badge computed on two machines — under CP e-Comm r.7(2) that is **our** misrepresentation, not the vendor's.

**Make the two quality numbers legible at a glance**, not just present. The QC score is the tri-arc ring from the design system; grade accuracy is a compact bar or chip with a stated denominator ("98% · 412 units"). A number with no denominator is not evidence.

**What must never appear:** vendor name, vendor tier, contact, GSTIN, any address beyond the city, or anything that lets a buyer identify or reach the source. Quality metrics are performance, not identity — they are deliberately shown; identity is deliberately not.

**A default sort that does not leak.** Sort by landed price ascending, tie-broken by dispatch speed then by a stable hash of the unit ID — never by vendor ID, creation order, or anything correlated with vendor identity.

**Below the grid: the per-unit list.** For the selected supply point, the actual serial numbers available, each linking to its **unit passport** (`/unit/:serial`) with the real inspection photographs, area results, detected hardware, seal code and wipe certificate. **Before purchase.** This is what makes the representative images honest, and it is your defence under CP e-Comm r.7(2) and r.7(5).

## Task 5 — Landed price

```
landed = retail_price
       + freight(from_pincode → to_pincode, weight, carrier)
       + GST(18%, IGST if delivery state ≠ our state, else CGST + SGST)
```

Show it as **one figure with a break-up one click away**. Never reveal charges progressively at checkout — drip pricing is a named prohibited practice in the CCPA Dark Patterns Guidelines 2023.

**MARGIN-channel units** (bought from unregistered vendors under Rule 32(5)) give the buyer thinner ITC. Do not hide this. Show a clear label — "GST charged on margin · limited input credit" — with an explainer link. Run MARGIN and REGULAR as visually distinct pools. A procurement head who discovers this at invoice time will not buy again.

**Budget: offers grid p95 < 500 ms** for a SKU with 6 supply points and 500 units. Measure it. This query touches listing, unit, qc_report, seal, serviceability and the rate card — it will be the slowest thing you own. Consider a denormalised read model refreshed on `qc.report.completed` and `listing.published` if the join cannot make budget.

## Task 6 — Cart

- Cart splits by supply point. **Internally** these become sub-orders and separate purchase orders; **to the buyer** the cart is one order with multiple dispatch points and one invoice from you. Do not surface "sub-order" as a customer-facing concept — under the merchant-of-record model there is exactly one seller, and the invoice reflects that
- `UNIQUE (cart_id, listing_id)`
- Stock is **not** reserved in the cart. Reservation happens at checkout with a 20-minute hold (Phase 6)
- Show a live "3 of the 5 units you selected are still available" check on cart view, and re-validate on checkout entry
- Persist the cart per user; support multiple named carts for procurement teams running parallel requirements

## Task 7 — Bulk requirement (RFQ intake only)

Full RFQ is deferred, but the **intake** is not — it is how a procurement head with a spreadsheet becomes a lead.

- Upload a requirement list (CSV/XLSX) or fill a form: model or specification, quantity, grade, target price, delivery pincode, needed by
- Parse, match against the catalog, show what is available now and what is not
- Anything unmatched creates an internal lead for the sales team with the parsed rows attached
- No vendor sees this. In the merchant-of-record model, sourcing against a requirement is your job, not a vendor bidding process

## Task 8 — Customer portal shell

Authenticated area in `apps/storefront`: dashboard, orders, quotes, saved searches and stock alerts, addresses, team and roles, approval inbox, invoices, credit status, support, settings. Screens are stubs where Phase 6–9 fill them, but the shell, navigation, role-gating and empty states ship now.

## Task 9 — SEO and performance

- SSR/ISR on model, brand and category pages; revalidate on `listing.published` and `qc.report.completed`
- Structured data: `Product`, `Offer`, `AggregateOffer`, `BreadcrumbList` — with `seller` set to **your legal entity**, which under this model is correct and also solves the disclosure question in schema markup
- `next/image` with AVIF/WebP, correct `sizes`, and the condition-image CDN
- Budgets: LCP < 2.5 s, CLS < 0.1, INP < 200 ms on a mid-range Android over 4G
- `robots.txt` and a sitemap — but **exclude `/unit/:serial`** from indexing. Passports are for buyers, not for scrapers building a picture of your inventory

## Exit criteria

- [ ] **The anonymity sweep passes**: no vendor identifier of any kind appears in any customer-facing API response, at any depth, on any endpoint (`IDN-080`…`IDN-094`)
- [ ] The "Sellers" suggestion group is gone from search
- [ ] **Ten supply points on one SKU (a Dell Latitude 5320) render correct landed prices, average QC scores, grade accuracy and total warranty on one screen**, for three different delivery pincodes
- [ ] A supply point below the sample threshold shows "New supplier · N units inspected" instead of a percentage
- [ ] Every displayed price is vendor ask + our charge; the vendor's asking price appears in no customer-facing response
- [ ] The warranty column shows the **total** months only — the vendor/platform split appears nowhere in the customer payload
- [ ] Offers grid p95 < 500 ms at 10 supply points / 500 units, measured in CI, with aggregates served from the cached read model rather than computed live
- [ ] Search p95 < 300 ms, measured in CI
- [ ] A unit whose QC expired yesterday does not appear in search results
- [ ] A unit with a broken seal does not appear in search results
- [ ] The unit passport is reachable pre-purchase and shows the technician's real photographs
- [ ] Every condition image renders with the representative-image caption; a component test asserts it cannot be omitted
- [ ] A MARGIN-channel unit is visibly labelled with its ITC consequence
- [ ] Grievance officer name, designation and contact appear on every page (r.4(2))
- [ ] No pre-ticked checkbox exists anywhere (r.4(9))
- [ ] No countdown timer, no "only 2 left" scarcity device, no drip pricing — reviewed against all thirteen CCPA dark-pattern categories
- [ ] Lighthouse ≥ 90 on performance and 100 on accessibility for the homepage and a product page
- [ ] The default sort order is stable and provably uncorrelated with vendor identity

═══════════════════════════════════════════════════════════════════
