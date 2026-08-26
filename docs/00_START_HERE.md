# gorefurbo — B2B refurbished-laptop platform · Build pack v1.0

**Prepared 25 August 2026 for Pankkaj Yadav · TrueTech Services Pvt. Ltd. / RentFoxxy**

This pack is a complete, phase-wise build prompt for the platform you described, plus the research behind the decisions in it. Roughly 100,000 words across 17 files. It is written to be executed by Claude Code, one phase at a time.

---

## Read this first — the one thing that changed

You asked for a marketplace where buyers see "Seller 1 · Gurugram, Seller 2 · Noida". Researching that surfaced a hard legal blocker: **Consumer Protection (E-Commerce) Rules 2020, Rule 5(3)(a)** requires a *marketplace* to display each seller's business name, geographic address and customer-care number **prominently, at the pre-purchase stage**. Anonymising them is a live CCPA enforcement risk, and the "our buyers are businesses, not consumers" argument is thinner than it looks.

Your answer — *"we as an umbrella take care of all the flow, we acquire the customer, the vendor lists only after my QC testing, and when a customer purchases I pay the vendor a discussed percentage"* — is a **principal / merchant-of-record model**, and it dissolves the problem rather than working around it. Rule 5 binds only marketplaces. As an **inventory e-commerce entity** you fall under Rules 4 and 7, which contain **no duty to disclose your suppliers**. There is no third-party seller to disclose, because you are the seller.

**That single decision reshaped the architecture.** It removed the RBI payment-aggregator problem, the escrow requirement, GST TCS under s.52 and GSTR-8 — and it added a whole new domain (`procurement`: purchase orders, three-way matching, TDS, vendor payouts) plus non-delegable take-back and authenticity liability. Everything in this pack assumes it.

If you want to reverse that decision, tell me — but reverse it now, not in Phase 7.

---

## What is in this pack

### Read these before building

| File | What it is | Read when |
|---|---|---|
| **`_CONTEXT.md`** | The binding shared context — business model, stack, module map, schema gaps, design tokens, the anonymity rule. **Every phase prompt tells Claude Code to read this first.** | Now, and keep it in the repo at `docs/_CONTEXT.md` |
| **`01_DECISIONS_AND_COMPLIANCE.md`** | Every regulatory finding with sources, the tax architecture, **and 20 questions I need you to answer** | **Now.** Part 4 blocks Phase 5 and Phase 7 |
| **`02_ARCHITECTURE.md`** | The technical contract — module seams, the new `procurement` schema, the three transactional flows, the anonymity architecture, integration design | Before Phase 0 |
| **`03_UX_SPEC.md`** | 1,282 lines. Design system as real `globals.css` and `tailwind.config.ts`, 30-component inventory, ~135 routes across four apps, 8 annotated flows, microcopy rules, performance budgets | Before Phase 0 (Parts 1–2) and per phase thereafter |
| **`04_TEST_PLAN.md`** | 1,509 lines. 164 validation rules, **477 numbered test cases**, 66 non-functional cases, 85 UAT steps, 94 release-gate assertions | Continuously. Every phase's exit criteria reference case IDs from here |
| **`05_NAMING.md`** | 10 names with Chaldean numerology proof and live domain checks, plus an 18-name reserve list | Before Phase 5 |
| **`06_AMENDMENT_R2.md`** | Multi-vendor comparison grid, warranty stacking (vendor 3 months → we sell 6), and the QR-coded QC report. **Supersedes passages in `_CONTEXT`, Phases 3, 4, 5, 7 and 9 — already patched into them** | Now |
| **`07_DEVICESURE_INTEGRATION.md`** | Review of DeviceSure v0.1.0 with eight defects found in the sample certificate, plus the real integration contract. **Replaces `02_ARCHITECTURE.md` §5.3 and rewrites Phase 4 Task 2** | Before Phase 4 |
| **`08_BRAND_SYSTEM.md`** | **The name is decided: Trugrade.** Full brand system — mark, "Anodised" palette, typography, the tolerance-band component, voice, and the codebase change list. **Supersedes the design tokens in `_CONTEXT.md` and Part 1 of `03_UX_SPEC.md`** | Before Phase 0 |

### The build prompts

Each is a self-contained prompt. Everything between the `═══` markers is what you paste into Claude Code.

| Phase | Title | Your requirements | Size |
|---|---|---|---|
| **0** | Foundation, schema hardening, design system | — | 1 eng, 5–7 d |
| **1** | Identity, RBAC, onboarding engine | #2, #3, #5 | 2 eng, 8–10 d |
| **2** | Master catalog + condition image library | #6, #7 | 1 eng + ops, 5–6 d |
| **3** | Listings, units, serials, pricing | #6 | 2 eng, 6–8 d |
| **4** | QC at source, technician app, your QC .exe | #13 | 2 eng + 1 mobile, 10–12 d |
| **5** | Storefront, search, anonymised supply-point grid | #8, #9 | 2 eng, 8–10 d |
| **6** | Checkout, orders, approvals, allocation | #4 (partial) | 2 eng, 7–8 d |
| **7** | Procurement, invoicing, payments, payouts | #11, #4 (money) | 2 eng + CA, 10–12 d |
| **8** | Logistics and carrier integrations | #10 | 2 eng + 1 mobile, 10–12 d |
| **9** | Warranty, claims, returns, support | #4, #12 | 2 eng, 7–8 d |
| **10** | Admin completion, hardening, launch | #7 | Whole team, 8–10 d |

**Total, honestly stated:** roughly 90–110 working days for a team of 3–4. That is 4½ to 5½ months, not 28 days. The earlier 28-day plan in your folder was scoped for about 20–25% of this — a working NCR pilot with manual invoicing and manual payments. That is still a legitimate way to sequence it: **Phases 0–6 give you a demonstrable pilot; Phases 7–10 make it a business.**

---

## How to run this with Claude Code

1. **Set up the repo and copy the docs in:**
   ```
   mkdir gorefurbo && cd gorefurbo && git init
   mkdir -p docs/legacy
   # copy _CONTEXT.md, 01–05 into docs/
   # copy your existing SQL and HTML prototypes into docs/legacy/
   ```
2. **Start Claude Code in the repo root.**
3. **Paste `PHASE_00_FOUNDATION.md`** — everything between the `═══` markers.
4. **Do not move on until the exit criteria are objectively met.** Every phase ends with a checklist written as checkable assertions, not feelings. A phase does not end because the calendar says so.
5. **Commit at every task boundary**, so a bad turn costs one task, not one phase.
6. **Re-paste `_CONTEXT.md` if a session loses it.** Every phase prompt opens by telling Claude Code to read it, but a long session can drift.

**A note on the two big reference files.** `03_UX_SPEC.md` and `04_TEST_PLAN.md` are too large to hold in context alongside a build session. Don't paste them — keep them in `docs/` and let the phase prompts point Claude Code at the specific sections it needs.

---

## Answers you owe me before certain phases

Full detail in `01_DECISIONS_AND_COMPLIANCE.md` Part 4. The short version:

**Before Phase 5:** brand name (Q1) · which legal entity invoices (Q2) · the vendor commission model — fixed %, %-by-category, or vendor-sets-net-payout (Q3) · who pays the QC visit fee (Q4) · the inspection-window length (Q5) · vendor payment terms (Q6).

**Before Phase 7:** did TrueTech exceed ₹10 crore turnover last FY (Q7 — decides whether TDS applies at all) · your CA's position on the current e-invoicing threshold (Q8) · what share of sourcing is from unregistered vendors (Q9 — decides whether the GST margin channel is a full pipeline or a back-office path) · prepaid-only pilot or credit terms from day one (Q10).

**Before Phase 4:** the `@devicesure/contracts` Zod schemas and one sample **JSON** certificate payload (Q14 — the repo and the PDF have arrived; see `07_DEVICESURE_INTEGRATION.md`) · **who physically runs QC — your staff or the vendor's under your protocol (Q15)**. Q15 is the highest-value open question in this pack, because it is simultaneously an operations decision, a DeviceSure licensing decision, and a **GST fixed-establishment** risk.

**Before Phase 5:** confirm the assumption in `06_AMENDMENT_R2.md` §2 — the customer's contract is with **us**, not the vendor (Q21) · the warranty top-up rule (Q22) · the small-sample threshold for showing a headline QC average (Q23).

---

## The five things most likely to hurt you

**1. The partition runway expires on 2026-10-01.** Your existing schema's partitions for `order_event`, `shipment_tracking`, `notification_log` and `integration_log` run out in about five weeks. There is no DEFAULT partition and no creation job — inserts will simply start failing. It is Phase 0, Task 5.1, and it is first for a reason.

**2. Phase 7 is the phase people under-scope.** Procurement, dual-channel GST valuation, TDS with a threshold that crosses mid-invoice, two invoices with one e-way bill, and a reconciliation exception queue. It is tax architecture wearing a software costume. Get your CA involved before it starts, not after.

**3. The QC app is the highest-risk build.** Mobile, offline, and it carries the product's entire promise. That is why Phase 4 tells you to build the **web QC console first** — so a tablet-based fallback exists from day one if the mobile app slips.

**4. Third-party lead times.** Blue Dart's credentials are review-gated, DTDC has no self-service path at all, SMS DLT registration takes weeks, WhatsApp Business API takes weeks. Every one of them has a mock in the codebase so nothing blocks — **but start the applications on day 1, before any code.** `01_DECISIONS_AND_COMPLIANCE.md` Part 5 is the list.

**5. Working capital.** As principal you owe vendors on delivery-plus-window while buyers on credit terms pay you later. That gap grows linearly with volume, it is the number that will constrain growth, and no amount of software fixes it. Model it before you scale vendor onboarding.

---

## Two small reconciliations

- `02_ARCHITECTURE.md` names the mobile apps `apps/technician` and `apps/rider`; `03_UX_SPEC.md` §3D describes them as one Expo workspace shipping two apps. These are the same thing — one Expo monorepo target, two bundle IDs, shared auth, offline queue, camera and tokens. Either folder layout is fine; pick one in Phase 4 and be consistent.
- The earlier plan in your folder specified **Flutter** for mobile. This pack specifies **Expo / React Native**, because your team knows React. One language across five apps beats a marginally better mobile runtime nobody on the team can debug. If you have a Flutter developer already committed, say so and I will switch it back — nothing else in the architecture depends on the choice.

---

## What I did not build

- **RFQ and bulk quotes** beyond intake — deferred to post-pilot
- **OpenSearch** — Postgres full-text handles 200 SKUs comfortably; revisit at ~50k
- **A parts and accessories category** — the catalog and QC models already extend to it, but the *grading* model does not. Design a parts grading model before you build the category
- **Microservice extraction** — the module seams are enforced from Phase 0 so you can split later without paying for it now
- **A bootable-USB diagnostic agent** — your existing `.exe` is the Phase 4 path; a bootable agent is a 4–6 week project of its own

---

*Everything in `01_DECISIONS_AND_COMPLIANCE.md` marked **⚠ SIGN-OFF** needs an Indian lawyer or a practising CA before you act on it. I have given you the reasoning and the sources; I have not given you advice.*
