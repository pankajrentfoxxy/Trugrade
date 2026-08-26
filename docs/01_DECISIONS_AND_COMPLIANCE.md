# Decisions, compliance findings, and the questions I still need answered

**Research current to 25 August 2026.** This is research, not legal or tax advice. Items marked **⚠ SIGN-OFF** need an Indian lawyer or a practising CA before you act on them.

---

## Part 1 — The decision that reshaped everything

You asked for a marketplace where buyers see "Seller 1 · Gurugram, Seller 2 · Noida" and never learn who the vendor is. Researching that surfaced a hard blocker, and your answer to it changed the architecture.

### 1.1 The blocker

**Consumer Protection (E-Commerce) Rules, 2020** — G.S.R. 462(E), 23 July 2020 — **Rule 5(3)(a)**, verbatim:

> "Every marketplace e-commerce entity shall provide the following information in a clear and accessible manner, displayed prominently to its users at the appropriate place on its platform: **(a)** details about the sellers offering goods and services, including the name of their business, whether registered or not, their geographic address, customer care number, any rating or other aggregated feedback about such seller, and any other information necessary for enabling consumers to make informed decisions at the pre-purchase stage…"

Three things follow from that text:

1. The duty is on the **entity**, owed to "its users" — it is not conditioned on the buyer proving "consumer" status.
2. "**Displayed prominently… at the pre-purchase stage.**" Business name *and* geographic address *and* customer care number sit inside the "including" list, which makes them a floor, not a menu.
3. The proviso (full HQ and branch addresses on written request, post-purchase) is an **additional** duty. It does not substitute for the pre-purchase display. A design that shows nothing up front and reveals on request afterwards does not satisfy Rule 5(3)(a).

The "our buyers are businesses, not consumers" argument is real but thin. CPA 2019 s.2(7) does exclude buyers for a commercial purpose, and recent Supreme Court authority (*Annapurna B. Uppin*, *Rohit Chaudhary*, both 2024) applies a dominant-intention test — so many of your buyers genuinely will not be consumers. But **Rule 2(1) contains no B2B carve-out**, the CCPA enforces on its own motion without needing a complainant, and you will always have sole-proprietor buyers who qualify as consumers under the self-employment exception. I would not have built on it.

### 1.2 Your answer, and why it works

You said:

> *"We as an umbrella will take care of all the flow, we acquire the customer. Vendor will list their product only after my QC testing, and when a customer purchases, I pay the amount to the vendor with a discussed percentage."*

That is a **principal / merchant-of-record model**, and it dissolves the problem rather than working around it.

Under **Rule 3(1)** of the same Rules, an **inventory e-commerce entity** is "an e-commerce entity which owns the inventory of goods or services and sells such goods or services directly to the consumers". That is you. Inventory entities are governed by **Rule 4** (duties of all e-commerce entities) and **Rule 7** (duties of inventory entities). **Rule 5 applies, by its own heading and opening words, only to a marketplace e-commerce entity** — and **Rule 7 contains no duty to disclose your suppliers.**

The reason is structural, not a loophole: there is no third-party seller to disclose, because you are the seller.

**This is a genuine commercial asset.** In a refurbished-hardware business the sourcing network *is* the moat, and you are not required to expose it to your buyers or to competitors scraping your listings. It is arguably the strongest single argument for the model.

### 1.3 What it costs — build for these, they are not optional

| Obligation | Source | What you must build |
|---|---|---|
| **Take-back and refund are non-delegable** | r.7(4) | Defective, deficient, spurious, not-as-advertised, or delivered late → you must take it back and refund. Force majeure is the only out on lateness. A marketplace routes this to the seller; **you cannot** |
| **Authenticity liability** | r.7(5) | Where the entity "explicitly or implicitly vouches for the authenticity" of goods it sells, it bears liability in any action on authenticity. *"QC-tested and sealed by us"* **is** explicit vouching. Your core marketing claim is your principal liability trigger |
| **No intermediary safe harbour** | s.79 IT Act | You author every listing. All misleading-advertisement exposure under CPA 2019 and the **CCPA Misleading Advertisements Guidelines 2022** sits on you alone. This bites hardest in refurbished goods, where "Grade A", "like new", "battery health 90%+" are exactly the claims a regulator tests against reality |
| **Dark patterns** | CCPA Guidelines, 30 Nov 2023 | No scarcity counters, drip pricing, confirm-shaming, forced continuity. Penalties of up to ₹20 lakh reported in enforcement during August 2026. Review checkout |
| **Product-seller liability** | CPA 2019 s.86 | You are unambiguously a "product seller" |
| **Rule 4 identity duties** | r.4(2) | Legal name, principal geographic address of HQ and all branches, website details, and customer-care + grievance-officer contacts, displayed prominently. **Yours**, not the vendor's |
| **Grievance redress** | r.4(4)–(5) | Nodal officer resident in India; acknowledge a complaint **within 48 hours**, redress **within one month**; ticket number on every complaint |
| **Explicit consent only** | r.4(9) | No pre-ticked boxes, anywhere |

**⚠ SIGN-OFF:** the prudent position is to comply with Rules 4 and 7 **in full** and not rely on a B2B exemption. Rule 2(1) has no B2B carve-out, and "user" is defined far more broadly than "consumer".

### 1.4 One decision that follows and you should make deliberately

**⚠ SIGN-OFF — high priority, cheap to resolve, expensive to get wrong.** Does your tamper seal, carrying your brand, make you a **"product manufacturer"** under CPA 2019 s.2(36) rather than merely a product seller? Manufacturer liability under s.84 is materially stricter. If it does, consider seal branding that identifies the *inspection* rather than re-branding the *machine*.

---

## Part 2 — Tax architecture under the principal model

### 2.1 What you no longer have to do

- **No GST TCS under s.52.** Section 52 covers supplies made "through it by other suppliers". Own-account supply is out of scope — the CBIC / GST Council e-commerce FAQ says so directly at Q24 and Q25. **No 0.5% collection, no GSTR-8, no TCS credit reconciliation.** That is a real operating-cost saving.
- **No TDS as an e-commerce operator** under old s.194-O (now s.393(1) Table Sl. No. 8(v)).
- **No RBI Payment Aggregator exposure.** Under the RBI (Regulation of Payment Aggregators) Directions, 2025 (RBI/DPSS/2025-26/141, 15 September 2025), an escrow account is a PA privilege and para 10(b) says a PA business shall not carry out marketplace business. None of that reaches you, because you are collecting your own receivables and paying your own trade payables. **You do not need Razorpay Route, Cashfree Easy Split, or a bank escrow.**

### 2.2 What you now have to do

**TDS on your purchases — s.393(1) Table Sl. No. 8(ii) of the Income-tax Act, 2025 (formerly s.194Q).**

| Parameter | Position |
|---|---|
| Who deducts | You, if your turnover exceeded **₹10 crore** in the immediately preceding tax year |
| From whom | Resident vendors |
| Threshold | Purchases from that vendor exceeding **₹50 lakh** in the tax year |
| Rate | **0.1%** on the amount above ₹50 lakh; **5%** if the vendor has no valid PAN |
| Timing | At credit to the vendor's account **or** payment, **whichever is earlier** |
| Base | Value excluding GST, where GST is shown separately |
| Return | Form 26Q, section code 1031 |
| Failure | **30% of the purchase value disallowed as expenditure** |

**Two things that were true last year and are not now:** s.206C(1H) seller-side TCS on goods was **omitted with effect from 1 April 2025**, and so were s.206AB / s.206CCA (higher rates for return non-filers). **Do not build either.** You no longer need to run non-filer status checks on vendors.

### 2.3 Two GST valuation channels — you will run both

| | REGULAR | MARGIN (Rule 32(5) CGST Rules) |
|---|---|---|
| Vendor | GST-registered | Unregistered person / individual |
| ITC on purchase | Claimed | **None available, and none may be claimed** |
| Output GST | 18% on full transaction value | 18% on **(sale price − purchase price)**; negative margin ignored |
| Your buyer's ITC | Full | **Thin** — only the tax on your margin |

Rule 32(5) requires that "no input tax credit has been availed on the purchase of such goods". It is a condition precedent — the two are **mutually exclusive**, with no partial application.

**The commercial point that usually decides this:** in B2B the margin scheme is normally the *wrong* choice, because a fully ITC-eligible business buyer is worse off net. Reserve MARGIN for the unregistered-vendor channel, price those units knowing your buyer's credit will be thin, and **run the two as distinct SKU pools with separate invoicing — never mixed on one invoice.**

**System controls this demands (all in Phase 7):**
1. Vendor GST status captured and time-stamped at the purchase date, verified against the GSTN API rather than self-declared.
2. Purchase document type: tax invoice (registered) vs self-generated purchase voucher (unregistered — retain identity and ownership evidence).
3. **A locked `valuation_method` flag per unit — `MARGIN` or `REGULAR` — set at purchase and immutable.** This is the single most important control. The architecture doc specifies a DB trigger to enforce it.
4. An ITC-blocking flag keeping MARGIN purchases out of the ITC ledger, reconciled monthly against GSTR-2B.
5. Purchase price **per serial number** — pooled or weighted-average costing breaks the scheme outright.
6. Evidence the goods are used, plus the refurbishment work order describing exactly what processing was done.
7. Invoice narration on MARGIN sales: *"Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase."*
8. Segregated GSTR-1 reporting, where taxable value reported = the margin.

**⚠ SIGN-OFF:** Rule 32(5) requires "minor processing which does not change the nature of the goods". Cleaning, OS reimaging, and replacing RAM/SSD/battery/keyboard are normally accepted. Heavy rebuilds, cannibalising parts from multiple donor units, or chassis swaps risk failing the test. **There is no binding authority on refurbished IT hardware.** If material volume depends on this, get an opinion and consider an advance ruling under s.97 CGST.

### 2.4 Bill-To-Ship-To — the drop-ship mechanics

Goods move vendor (V) → buyer (B). Two invoices, one physical movement.

**Leg 1, V invoices you (P):** governed by **s.10(1)(b) IGST Act** — where goods are delivered to another person on the direction of a third person, that third person is deemed to have received them and **the place of supply is P's principal place of business**, irrespective of where the goods actually go.

**Leg 2, P invoices B:** governed by **s.10(1)(a)** — place of supply is **B's delivery location**.

| V | P | B | Leg 1 (V→P) | Leg 2 (P→B) |
|---|---|---|---|---|
| Karnataka | Karnataka | Maharashtra | PoS Karnataka → **CGST+SGST** | PoS Maharashtra → **IGST** |
| Maharashtra | Karnataka | Maharashtra | PoS Karnataka → **IGST** | PoS Maharashtra → **IGST** |
| Maharashtra | Karnataka | Tamil Nadu | PoS Karnataka → **IGST** | PoS Tamil Nadu → **IGST** |

Note row 1: goods never touch Karnataka, yet leg 1 is an intra-Karnataka supply. You accumulate CGST+SGST credit in your home state and use it against IGST output. CGST credit can offset IGST; it cannot offset SGST — so a home-state-heavy vendor mix with an out-of-state buyer mix can **strand SGST credit**. Model this before you set vendor onboarding priorities.

**E-way bill: one bill, and you should generate it (Case 2).** Per the **CBIC Press Release of 23 April 2018** on Bill-To-Ship-To, a single movement needs a single e-way bill and either party may generate it.

| Field | Case 1 (vendor generates) | **Case 2 (you generate) — use this** |
|---|---|---|
| Bill From | Vendor | **You** |
| Dispatch From | Vendor's dispatch address | **Vendor's address** |
| Bill To | You | **Buyer** |
| Ship To | Buyer's delivery address | **Buyer's delivery address** |
| Invoice | Invoice-1 (V→P) | **Invoice-2 (P→B)** |

**Why Case 2 is not optional for you.** Under Case 1 the vendor's invoice value — *your cost* — travels with the goods and is visible to your buyer's receiving staff and to the transporter. That is a live margin-disclosure problem. Under Case 2 the document accompanying the goods is your invoice at your price, and the vendor appears only as a dispatch address. The trade-off is that you must be the party arranging transport, and you must hold vendor dispatch addresses accurately in master data.

**⚠ Verify before coding:** one secondary source rendered the Case 2 invoice field as Invoice-1. The logic of the fields and every other source says Invoice-2. Confirm against the CBIC press-release PDF.

**Threshold:** ₹50,000 consignment value. Intra-state thresholds vary by state — check each state you ship within. E-way bill generation is blocked for documents older than 180 days. **Rule 138A:** the person in charge of the conveyance carries the invoice and the e-way bill; only one invoice travels, the other leg is a books entry.

### 2.5 The registration question — and the one real hazard

**You do not need registration in every state** by reason of drop-shipping. Section 22(1) CGST requires registration in the State "from where he makes a taxable supply", and the s.10(1)(b) deeming fiction fixes place of *supply*, not place of *business*.

**⚠ SIGN-OFF — this is the highest-value open question in the whole project.** Your facts contain a specific hazard: **you QC-test and seal at the vendor's premises.** If you station your own staff, equipment or a dedicated area at a vendor's site in another state on an ongoing basis, revenue can argue that is a **"fixed establishment"** under s.2(50) CGST — "a place, other than the registered place of business, characterised by a sufficient degree of permanence and suitable structure in terms of human and technical resources." A fixed establishment changes the location of the supplier, can force registration in that state, and creates distinct-person cross-charge obligations under Schedule I.

Design decisions that materially reduce the risk, and which the architecture already assumes:
- Use the **vendor's** personnel and equipment under a services contract, with your QC protocol and remote or sampled supervision, rather than your own permanently deployed staff.
- No dedicated leased space at vendor sites.
- Keep QC engagements rotating and non-exclusive rather than permanent at one site.
- Document the arrangement as a service **bought from** the vendor and invoiced by the vendor.

**The QC deployment model is a tax-structure decision, not an operations decision.** Whoever designs it needs the GST advice in the room.

### 2.6 E-invoicing

IRN e-invoicing applies above the notified aggregate-turnover threshold, with a 30-day reporting window from the invoice date for taxpayers above the higher threshold. **Build the invoice numbering and payload shape now**, so switching IRN on is a configuration change and not a re-architecture. Getting the dispatch-from details right in the e-invoice payload is also what makes Case 2 e-way-bill auto-generation clean. **⚠ Confirm the current threshold with your CA before Phase 7 ships** — it has moved repeatedly.

---

## Part 3 — Other compliance findings that change the build

### 3.1 E-waste — you are a "refurbisher"

The **E-Waste (Management) Rules, 2022** define refurbishers as a regulated entity class with **CPCB registration** and filing obligations, and **Rule 7 independently obliges refurbishers to ensure refurbished EEE complies with CRS/BIS.** Build `vendor_certification` support for `CPCB_EWASTE` (already in the schema) and make it a **hard gate** on vendor approval if your counsel confirms the obligation reaches your model. **⚠ SIGN-OFF.** Battery replacement at scale may also engage the Battery Waste Management Rules 2022 — not researched here.

### 3.2 Import of used laptops is effectively closed

Two layers stack and both bite:
1. **FTP 2023 Para 2.31** — personal computers and laptops are expressly on the **restricted** list for second-hand capital goods, requiring a **DGFT import authorisation**. A Chartered Engineer Certificate is mandatory for customs clearance of used capital goods generally.
2. **DGFT Notification No. 13/2024-25, 20 May 2024** — import of goods notified under the CRS Order 2021, **"new as well as second hand, whether or not refurbished, repaired or reconditioned"**, is prohibited unless BIS-registered and BIS-labelled, or covered by a specific MeitY exemption letter. Non-compliant goods at port must be re-exported, failing which customs deform them beyond use and dispose of them as scrap.

**Bottom line: source domestically.** Corporate ITAD and lease-return stock inside India avoids all of this. An import-based sourcing strategy is a licensing project, not a procurement decision.

### 3.3 BIS / CRS on domestic resale

Laptops are notified under the **Electronics and IT Goods (Compulsory Registration) Order, 2021**. The BIS FAQ does not squarely address labelling obligations for a domestic reseller of used, already-registered goods. The practical industry position — the refurbisher is not a manufacturer, and registration attaches to the model — is common but **not stated in any verifiable source.** Two situations flip it: if you **re-brand** units under your own mark you become a brand owner for CRS purposes; and a unit that was **never BIS-registered** (grey import, or a model never sold in India) is exposed. **⚠ SIGN-OFF with a BIS consultant before scaling.** This interacts directly with §1.4 — seal branding versus machine branding.

### 3.4 Legal Metrology

**Rule 6(10)** requires an e-commerce platform to display, on the listing, the declarations Rule 6 requires on the package: manufacturer/packer/importer name and address, generic name, net quantity, MRP inclusive of all taxes, consumer-care contact, month and year of manufacture/packing/import, and country of origin for imports.

Three refurbished-specific ambiguities, all worth an opinion:
- Whether a used laptop sold loose is a "pre-packaged commodity" under Rule 2(l) at all is genuinely arguable. **If you re-pack units into branded retail boxes, you become the packer** and the declarations attach in your name.
- "MRP inclusive of all taxes" sits awkwardly with the margin scheme and with per-unit variable pricing of used goods. There is no clear guidance.
- **Rule 3 exempts packages intended for industrial or institutional consumers** — potentially significant for a genuinely B2B channel, but fact-specific and frequently litigated.

**Amendment status:** the Legal Metrology (Packaged Commodities) Amendment Rules, 2026 (notified 13 Feb 2026) insert Rule 6(10A) — a searchable and sortable **country-of-origin filter** for imported products. The **Second Amendment Rules, 2026 (G.S.R. 312(E), 27 April 2026) pushed compliance out to 1 July 2027.** This is the most recently changed item in this pack — **re-verify the operative date before you rely on it.**

### 3.5 Warranty

**There is no statutory minimum warranty period for refurbished goods in India.** Warranty is contractual. What the law does is force disclosure of whatever warranty exists (r.7(1), r.6(5) content) and make whatever you promise strictly enforceable.

**Your warranty document does three jobs at once:** it is the product, it is the s.86(c) liability trigger, and it is the Rule 7(5) authenticity vouching. **Draft it once, by counsel, with all three in view** — not assembled from a marketing brief.

### 3.6 DPDP Act 2023

Consent must be itemised and purpose-specific, with a notice in the language the data principal chose, and provable. The schema already models this correctly in `kyc.consent_record` — rows are never deleted, and `withdrawn_at` is itself the compliance artifact. Build the data-principal rights workflow (`platform.data_subject_request`) in Phase 10, and keep statutory records for 8 years.

### 3.7 FDI — read this before any fundraise

Press Note 2 (2018 Series) says **"FDI is not permitted in inventory based model of e-commerce"**, and defines that model as one where inventory "is owned by e-commerce entity and is sold **to the consumers** directly."

**The prohibition is drafted against B2C retail.** Genuine B2B with owned inventory is the **cash-and-carry wholesale trading** route, where 100% FDI is automatic — subject to conditions including a cap on sales to group companies. That is a structural reading, **not a written DPIIT clarification directly on point.**

**⚠ SIGN-OFF before any term sheet.** If foreign capital is anywhere in your plan, resolve this *before* you build a year of inventory-model history, not after. Getting it wrong is not a fine — it is a restructuring.

---

## Part 4 — Questions I need you to answer

These are ordered by how much they block. Everything above 5 changes what gets built.

### Blocking — answer before Phase 5

**Q1. Brand.** Do you want one of the ten names in `05_NAMING.md`, or do we keep **gorefurbo** (which already scores Chaldean 6 and whose domain you own)? The build treats the brand as a token, so this can wait until Phase 5 — but not past it.

**Q2. Legal entity on the invoice.** Is **TrueTech Services Pvt. Ltd.** the entity that will buy from vendors and sell to customers, or is there a separate RentFoxxy entity? Everything in Phase 7 — GSTIN, invoice series, TDS registration, e-way bill — hangs off this.

**Q3. Vendor commission model.** You said "a discussed percentage". Which is it?
- (a) **Fixed % per vendor** — simplest, one number in the contract
- (b) **% by category / brand / grade** — the `margin_rule` table already supports this
- (c) **Vendor names a net payout, you set the retail price freely** — margin varies per unit, most flexible, hardest to explain to vendors
The architecture builds (b) with (a) as a special case. Confirm, or tell me it is (c).

**Q4. Who pays for the QC visit?** The v3 schema has `visit_fee`, `fee_bearer` ∈ `TRUETECH | VENDOR | SPLIT | WAIVED`, a ₹1,500 default and a 25-unit minimum with waiver above 50 units. Are those your real numbers? This decides whether "we inspect stock that never sells" is a cost you absorb or a fee you charge.

**Q5. The inspection window.** The operations blueprint says buyers get **48 hours** to reject after delivery. Is that the commercial promise? It sets when a vendor payable becomes payable, and it is the r.7(4) take-back mechanism.

**Q6. Payment terms to vendors.** The schema offers `WEEKLY | T_PLUS_2 | MONTHLY` with a ₹1,000 minimum payout threshold. Which is the default, and is the cycle earned by tier?

### High — answer before Phase 7

**Q7. Turnover.** Did TrueTech Services Pvt. Ltd. exceed **₹10 crore** turnover in FY 2025-26? That single fact decides whether TDS u/s 393(1) Sl.8(ii) applies to your purchases at all.

**Q8. Current e-invoicing threshold and your position against it.** Needs your CA. Determines whether Phase 7 ships IRN generation or just the payload.

**Q9. Unregistered-vendor volume.** Roughly what share of your sourcing will be from individuals or unregistered dealers? If it is under ~5%, we build the MARGIN channel as a manual back-office path and save two weeks. If it is material, it is a full parallel pipeline.

**Q10. Credit terms.** Will you extend NET 15/30 to buyers from day one, or is the pilot prepaid-only? (Extending **your own** trade credit is fine and does not make you a lending service provider. Distributing a **third party's** credit does, and pulls in the RBI Digital Lending Directions 2025 — do not do that without reading them.)

### Medium — answer before Phase 8

**Q11. Pilot geography.** NCR only, in-house delivery only, as the earlier plan assumed? Or does Phase 8 need Delhivery live at launch?

**Q12. Do you already hold carrier accounts?** Delhivery, Blue Dart, DTDC, Shiprocket, Porter — which exist today, and who owns the credentials? Blue Dart's onboarding is review-gated and DTDC has no self-service path at all. **These applications should start on day 1, before any code.**

**Q13. Razorpay account status** — live, KYC-complete, and does it have Smart Collect enabled? Virtual accounts are not available to the "Individual" merchant category.

### Needed for Phase 4

**Q14. The QC executable.** You said you would share the repo. I need: the exact output format (JSON/XML/CSV/PDF), whether it signs its output and with what, whether it reads the serial from SMBIOS, whether it performs the data wipe or only certifies one, what it does offline, and how it is licensed and distributed to a technician's machine. **`02_ARCHITECTURE.md` §5.3 proposes a contract — tell me where your tool differs and I will change the contract, not your tool.**

**Q15. Who runs QC?** Your own employed technicians travelling to vendor sites, or vendor staff running your tool under your protocol? **This is the GST fixed-establishment question from §2.5 and it is the highest-value open item in this pack.** It also changes the technician app: employed staff need routing, availability and expense capture; vendor staff need a locked-down single-purpose tool and much stronger anti-fraud.

**Q16. The 90-day QC validity.** The v3 schema expires reports after 90 days, auto-unlists the units, and warns the vendor 14 days ahead. Confirm 90 days is your number — it directly sets how much re-inspection cost you carry.

### Lower, but do not forget

**Q17.** Are you CPCB-registered as a refurbisher, or is that pending?
**Q18.** Do you re-pack units into your own branded boxes? (Triggers Legal Metrology packer obligations and possibly BIS brand-owner status.)
**Q19.** Any imported stock at all, now or planned? (§3.2 — and it changes the Legal Metrology country-of-origin filter obligation.)
**Q20.** Is foreign investment anywhere in the plan? (§3.7 — resolve before you build history.)

---

## Part 5 — Start these on day 1, before any code

Lead times you do not control. Every one of them has a mock in the codebase so nothing blocks, but every one takes weeks in the real world.

| Item | Typical lead time | Owner |
|---|---|---|
| AWS account, ap-south-1, billing alerts | Days | Engineering |
| **SMS DLT registration** (entity + header + templates) | **2–4 weeks** | Ops |
| **WhatsApp Business API** + template approval | **2–4 weeks** | Ops |
| **Razorpay** KYC + Smart Collect enablement | **1–2 weeks** | Finance |
| **GSTIN / PAN verification provider** contract | 1–2 weeks | Finance |
| Penny-drop / bank verification provider | 1–2 weeks | Finance |
| **Delhivery** API credentials (staging + production) | 1–2 weeks | Ops |
| **Blue Dart** — four secrets, review-gated sample-label approval | **3–6 weeks** | Ops |
| **DTDC** — no self-service path, account manager only | Unknown | Ops |
| Shiprocket account + API user | Days | Ops |
| Porter enterprise API (form-gated) | Unknown | Ops |
| **CA engagement** for §2.3, §2.5, §2.6 | Now | You |
| **Counsel engagement** for §1.4, §3.1, §3.3, §3.7 | Now | You |
| Tamper-seal supplier, numbered, tamper-evident | 2–3 weeks | Ops |
| Recruit 5 pilot vendors and 3 pilot buyers | Ongoing | **Not a developer's job** |
