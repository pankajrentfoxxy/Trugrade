# PHASE 9 — Warranty, claims, returns, support and disputes

**Prerequisite:** Phase 8 exit criteria green. **Q5 (inspection window) must be answered. The warranty document must be drafted by counsel before this phase ships.**
**Estimated size:** 2 engineers, 7–8 days.
**Covers your requirements #4 (warranty, support, tracking) and #12.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. Read `docs/_CONTEXT.md` and `docs/01_DECISIONS_AND_COMPLIANCE.md` §1.3 and §3.5 before starting.

Additional reading: `docs/legacy/Gorefurbo_Schema_Design_Annotated.md` Part 12, `docs/03_UX_SPEC.md` §3A (warranty and returns), `docs/04_TEST_PLAN.md` §3.12.

## Objective

A buyer raises a warranty claim on a specific serial, it is triaged, resolved and closed inside a tracked SLA — and a buyer who rejects a machine inside the inspection window gets it taken back without argument, because under Consumer Protection (E-Commerce) Rules **r.7(4) that obligation is ours and cannot be delegated to the vendor.**

## The framing that must not be lost

As a marketplace you would route a defective-goods claim to the seller under r.6(6). **You cannot.** As an inventory e-commerce entity:

- **r.7(4)** — you shall not refuse to take back goods or refund where goods are **defective, deficient, spurious, not of the characteristics or features advertised or as agreed, or delivered late** (force majeure excepted on lateness). Directly, non-delegably.
- **r.7(5)** — where you **explicitly or implicitly vouch for the authenticity** of the goods you sell, you bear liability in any action relating to authenticity. *"QC-tested and sealed by us"* is explicit vouching.
- **r.4(4)–(5)** — acknowledge a grievance within **48 hours**, redress within **one month**, with a nodal officer resident in India.
- **r.7(1)** — a **ticket number for every complaint**, so the buyer can track it.

Your commercial recovery from the vendor is a separate, internal matter — a penalty, a chargeback against their payable, a scorecard hit. **Never make the buyer wait on it.** Refund the buyer, then recover.

**And build for the honest case:** your grade definitions are the standard you will be measured against under r.7(2) and the CCPA Misleading Advertisements Guidelines 2022. If your Grade A allows a 10 mm scratch and a buyer receives a 25 mm scratch, that is a not-as-described claim and you owe a refund. Build the claim flow so the QC report, the grade definition in force on the inspection date, and the technician's photographs are all on one screen — because that is what turns an argument into a decision.

## Task 1 — Warranty

`platform.warranty`, `CHECK (end_date > start_date)`.

Per **unit**, not per order. Fields: `unit_id`, `order_id`, `duration_months`, `start_date` (delivery date, not invoice date), `end_date`, `coverage_json`, `exclusions_json`, `certificate_id`, `status`, `transferred_to_org_id` (a buyer may resell — decide whether the warranty travels).

### Warranty stacking — the trust play, and the thing to get right

The vendor stands behind the machine for one term. **We sell a longer one.** Vendor offers 3 months; we sell 6.

Add to `platform.warranty`:

```sql
total_months            INT NOT NULL,   -- what the customer bought: 6
vendor_backed_months    INT NOT NULL,   -- what the vendor stands behind: 3
platform_backed_months  INT NOT NULL,   -- our top-up: 3
vendor_org_id           UUID,           -- INTERNAL. Never leaves the API.
reserve_amount          NUMERIC(14,2),  -- accrued at sale from margin
reserve_released_at     TIMESTAMPTZ,
CONSTRAINT chk_warranty_split CHECK (vendor_backed_months + platform_backed_months = total_months)
```

**Four rules, and the first one is the whole point:**

1. **We are the sole warrantor to the customer for the entire term.** The customer never learns there was a split, never chases a vendor, and never waits on our recovery. Drop the old `provider` enum — a customer-visible `provider` field defeats both the trust play and the anonymity model. Test that `vendor_backed_months`, `platform_backed_months` and `vendor_org_id` appear in **no** customer-facing response.
2. **A claim inside the vendor-backed window creates a recovery, asynchronously.** We repair or refund the customer first, always; then a `platform.penalty` or a debit note nets against that vendor's next payable. The two things never touch in time.
3. **The top-up is a cost that must be funded.** `reserve_amount` is accrued at sale from margin (Phase 3, Task 5), banded by grade because a Grade B machine claims materially more often than an A+. Draw on it for platform-backed claims; release it to margin on expiry. Without this, the 6-month promise is an unpriced liability that grows with every sale.
4. **Never display the split.** The comparison grid, the product page, the invoice, the certificate and the claim screen all say one number: the total the customer gets. The split is a finance and recovery construct.

**Watch the claim-rate-versus-reserve number weekly from launch.** It is the metric that tells you whether the extra three months is a trust investment or a slow leak, and it is the kind of thing that only becomes visible after ninety days — by which point you have sold a lot of warranties.

**⚠ SIGN-OFF:** selling cover that outlasts the supplier's own is ordinary commercial practice, but check with counsel whether a standalone extended-warranty product priced separately would be characterised as an insurance contract. Bundling it into the sale price (as here) is the conservative structure and is what this design assumes.

**Coverage and exclusions must be structured data**, not a PDF. The claim triage engine reads them to auto-classify a claim as in or out of scope, and a buyer reads them to know before they claim. `coverage_json` at minimum: motherboard, display, battery, keyboard, storage, ports, charger — each in or out, each with a sub-period if it differs (batteries commonly carry a shorter term).

Warranty certificate PDF per unit, downloadable, with the serial, coverage table, exclusions, claim process and the grievance-officer contact.

**The warranty document does three jobs at once** — it is the product, it is the CPA 2019 s.86(c) liability trigger, and it is the r.7(5) authenticity vouching. **Have counsel draft it once with all three in view**, not assembled from a marketing brief. The structured `coverage_json` must be generated from that document, not written independently by an engineer.

## Task 2 — Warranty claim

`platform.warranty_claim` — add a CHECK to the currently unconstrained status column.

**State machine:** `RAISED → ACKNOWLEDGED → TRIAGE → APPROVED | REJECTED → IN_REPAIR | REPLACEMENT_ISSUED | REFUND_ISSUED → CLOSED`, with `INFO_REQUESTED` and `ESCALATED` as side states.

**Buyer flow:**
1. Select the unit **by serial** from their delivered units — never a free-text field. Every claim is anchored to a serial, and therefore to a QC report, a seal record and a purchase order
2. Choose an issue category, describe it, attach photographs or a video
3. Optionally re-run the QC executable and attach the report — this is where the tool earns its keep post-sale
4. Get a **ticket number immediately** (r.7(1)) and an acknowledgement **within 48 hours** (r.4(4))

**Triage screen** — everything on one page: the claim, the original QC report with the technician's six photographs, the detected hardware at inspection, the grade definition version in force on that date, the seal record and whether it was intact at delivery, the warranty coverage, and the vendor's scorecard.

**Outcomes:** repair (with a turnaround commitment), replacement from stock, refund, or reject with a written reason that cites the specific coverage or exclusion clause. A rejection with no cited clause should not be submittable.

**Internal recovery, separate and asynchronous:** a `platform.penalty` against the vendor when the claim traces to a misdeclaration, netted in the next payout run, and a `counts_against_accuracy` hit on the scorecard. The buyer never sees any of this and never waits for it.

**SLA:** acknowledge 48 hours, first response 2 working days, resolution 7 working days for repair and 3 for refund. Track and surface breaches on the ops dashboard.

## Task 3 — Returns within the inspection window

The **48-hour** window (client Q5) opens on delivery. Distinct from a warranty claim: this is "this is not what I ordered", not "this broke".

`platform.return_request` — add a CHECK to the unconstrained status column. `RAISED → APPROVED | REJECTED → PICKUP_SCHEDULED → PICKED_UP → RECEIVED → INSPECTED → REFUNDED | REPLACED | RETURNED_TO_BUYER`.

**Reasons, and the r.7(4) mapping:**

| Reason | r.7(4) category | Handling |
|---|---|---|
| Grade does not match | not as described | **Auto-approve.** Compare against the QC report |
| Specification does not match | not as described | **Auto-approve.** Compare detected hardware against the SKU |
| Seal broken on arrival | authenticity / spurious | **Auto-approve.** Immediate investigation |
| Serial does not match the invoice | spurious | **Auto-approve.** Escalate — this is a serious control failure |
| Physically damaged in transit | defective | Auto-approve; recover from the carrier |
| Dead on arrival | defective | Auto-approve |
| Late delivery | delivered late | Auto-approve unless force majeure is documented |
| Changed our mind | — | Per the commercial policy, not r.7(4). Restocking terms may apply if disclosed up front |

**Auto-approve means auto-approve.** Where the buyer's claim is verifiable against your own QC record, approving it is both the legal position and cheaper than the argument. Build the comparison, not an approval queue.

Reverse pickup via the logistics module. `platform.return_qc` on receipt. Refund through the original payment rail, with a **GST credit note** referencing the original invoice and reported in GSTR-1.

**r.4(8):** no cancellation charge on the buyer unless we bear an equivalent charge on our own cancellations.

## Task 4 — Support desk

`platform.ticket` and `platform.ticket_message` — add a CHECK to the status column.

- Categories: order, delivery, product, warranty, invoice, payment, account, other
- Every ticket has a **ticket number**, surfaced to the buyer (r.7(1))
- Threaded messages with attachments, internal notes clearly separated from buyer-visible replies
- Linked entities: order, unit serial, invoice, shipment, claim
- SLA per category and priority, with **48-hour acknowledgement enforced by the system**, not by hope
- Escalation to the **grievance officer**, whose name, designation and contact are published on every page under r.4(2)
- Canned responses, in English and Hindi
- Channels: web, email ingest, WhatsApp

**A grievance-officer workflow that satisfies r.4(4)–(5):** a distinct queue, a one-month redress clock, a written outcome, and an escalation path the buyer can see.

## Task 5 — Disputes

`platform.dispute` — add a CHECK to the status column. For anything that outlives a ticket: a chargeback, a contested grade after the return window, a vendor contesting a penalty, a delivery denied by the buyer but photographed by the rider.

Evidence pack assembly, on one screen: order, invoice, QC report, seal record, custody events, POD photograph and geo-tag, delivery OTP, tracking history, all messages. Outcome with a written rationale, a financial adjustment through the ledger, and a full audit trail.

## Task 6 — Vendor scorecard

`platform.vendor_scorecard`, `UNIQUE (vendor_org_id, period_end)`, computed monthly:

- **Grade accuracy** — corrections as a share of units inspected (the headline number)
- **QC pass rate**
- **PO acknowledgement time** and rejection rate
- **Dispatch readiness** — seals intact at pickup, units present
- **Claim rate** per 100 units sold, and claims upheld
- **Return rate**, split into not-as-described versus defective
- **Penalty total**

Feeds `vendor_tier` ∈ `WATCHLIST | BRONZE | SILVER | GOLD | PLATINUM`, which in turn drives the QC sampling percentage (Phase 4) and the payout cycle (Phase 7). **A vendor earns lighter inspection by being accurate.** That is the incentive that makes QC-at-source economic over time.

**Do not surface a scorecard before 90 days of data.** A scorecard computed on three weeks is noise, and a vendor demoted on noise is a vendor lost.

**Do not expose scorecards, tiers or ratings to buyers** — that would reintroduce vendor identity through the back door.

## Task 7 — Buyer feedback

`platform.buyer_review`, `UNIQUE (order_id, vendor_org_id)`, `CHECK (rating BETWEEN 1 AND 5)`.

**Important under the merchant-of-record model:** reviews are about **us and the machine**, not about a vendor the buyer never knew existed. Keep the internal vendor attribution for the scorecard, but the buyer rates the platform and the product. Rendering a vendor-attributed rating publicly would break the anonymity model and, more importantly, would misdescribe who the buyer actually dealt with.

**r.7(2):** we must not falsely represent ourselves as a consumer and post reviews. Reviews are verified-purchase only, tied to an order, and the verification is stated on the page.

## Task 8 — DPDP data-subject requests

`platform.data_subject_request` — add a CHECK to the status column. Access, correction, erasure, and consent withdrawal. Statutory records retained **8 years** regardless of an erasure request, with the retention basis recorded on the request so the refusal is explainable. A workflow with an SLA and a written response.

## Exit criteria

- [ ] A warranty claim on a specific serial completes end-to-end and closes inside SLA
- [ ] **A claim in month 5 — inside our top-up, outside the vendor's 3 months — is handled by us with no vendor involvement visible to the customer**
- [ ] A claim in month 2 is resolved for the customer first, and the vendor recovery happens separately and later
- [ ] `vendor_backed_months`, `platform_backed_months` and `vendor_org_id` appear in **no** customer-facing response
- [ ] Every customer-facing surface shows the **total** warranty months only
- [ ] A warranty reserve accrues at sale, is drawn on a platform-backed claim, and releases to margin on expiry
- [ ] Every claim and ticket carries a buyer-visible **ticket number** (r.7(1))
- [ ] Acknowledgement within **48 hours** is enforced by the system and breaches are visible (r.4(4))
- [ ] The triage screen shows the QC report, the grade definition version in force at inspection, the seal record and the technician's photographs on one page
- [ ] A rejection cannot be submitted without citing a coverage or exclusion clause
- [ ] A **grade-mismatch return auto-approves** by comparing the claim against our own QC report — no queue, no argument (`PLT-020`)
- [ ] A specification-mismatch return auto-approves by comparing detected hardware against the SKU
- [ ] A refund issues without waiting on any vendor recovery
- [ ] A vendor penalty is raised, nets in the next payout run, and hits the scorecard — invisibly to the buyer
- [ ] A GST credit note references the original invoice correctly and reports in GSTR-1
- [ ] Grievance-officer name, designation and contact appear on every page, and the escalation queue has a one-month clock
- [ ] Vendor scorecards compute correctly and are **never** exposed to a buyer
- [ ] A buyer review is verified-purchase only and attributes to us, not to a vendor
- [ ] A DPDP erasure request is honoured, with statutory records retained and the basis recorded
- [ ] All nine previously unconstrained status columns now have CHECK constraints

═══════════════════════════════════════════════════════════════════
