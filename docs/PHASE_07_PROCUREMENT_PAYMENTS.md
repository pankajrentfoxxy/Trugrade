# PHASE 7 — Procurement, invoicing, payments and vendor payouts

**Prerequisite:** Phase 6 exit criteria green. **Q2, Q3, Q6, Q7, Q8, Q9, Q10 in `01_DECISIONS_AND_COMPLIANCE.md` must be answered before starting.**
**Estimated size:** 2 engineers + CA review, 10–12 days. **This is the phase most likely to be under-scoped.**
**Covers your requirement #11, and the money half of #4.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. Read `docs/_CONTEXT.md`, `docs/02_ARCHITECTURE.md` §2.2 and §4.3, and **`docs/01_DECISIONS_AND_COMPLIANCE.md` Part 2 in full** — this phase is tax architecture wearing a software costume, and building it from intuition will cost more to unwind than to build correctly.

Additional reading: `docs/04_TEST_PLAN.md` §3.9 (procurement) and §3.10 (payment).

## Objective

An order raises purchase orders, the vendor invoices us, a three-way match runs, a payable accrues with TDS withheld at the right moment, both GST invoices exist with one e-way bill, the buyer pays us through the right rail, and a payout run pays the vendor with a deduction statement they can actually understand.

**A framing note before you start.** Because we are the principal, this is ordinary accounts-receivable and accounts-payable. There is **no escrow requirement, no RBI Payment Aggregator question, no split-settlement product, no GST TCS under s.52 and no GSTR-8.** If you find yourself building any of those, you have drifted back into the marketplace model — stop and re-read `01_DECISIONS_AND_COMPLIANCE.md` §2.1.

## Task 1 — Build out the `procurement` schema

Create every table from `02_ARCHITECTURE.md` §2.2. `price_book`, `margin_rule` and the two PO tables exist from Phases 3 and 6; add `vendor_invoice`, `goods_receipt`, `vendor_payable`, `payout_run`, `payout`, `tds_ledger`.

`REVOKE UPDATE, DELETE ON procurement.tds_ledger FROM app_role` — it is append-only, like the general ledger. A TDS record that can be edited is a TDS record you cannot defend.

## Task 2 — Vendor invoice and three-way match

The vendor uploads their tax invoice against the PO (or we self-bill where the vendor agreement permits it — capture which, per vendor, in `vendor_payout_preference.invoice_upload_required`).

**Three-way match** = purchase order ↔ vendor invoice ↔ goods receipt.

`match_status ∈ PENDING | MATCHED | PRICE_VARIANCE | QTY_VARIANCE | MISSING_GRN | DISPUTED`.

The **goods receipt is virtual** in this model — the goods never touch our warehouse. The receipt event is the **seal-verified pickup** from Phase 8: the carrier or our rider confirms the seal codes and serials at the vendor's door, and that acknowledgement writes `procurement.goods_receipt`. Until that exists, `match_status` is `MISSING_GRN` and **no payable accrues**.

Tolerances in `platform_config`: price variance ±0.5% or ₹100, whichever is greater; quantity variance zero (serials are exact — a quantity variance means a serial is missing, which is an exception, not a rounding difference).

Variances land in a finance work queue with the PO, the invoice and the receipt side by side and a one-click accept-or-dispute.

## Task 3 — TDS on purchases — get this exactly right

**Statutory position, current as at August 2026** (see `01_DECISIONS_AND_COMPLIANCE.md` §2.2):

| Parameter | Value |
|---|---|
| Provision | **s.393(1), Table Sl. No. 8(ii)**, Income-tax Act 2025 (formerly s.194Q) |
| Applies if | **Our** turnover exceeded **₹10 crore** in the immediately preceding tax year |
| Threshold | Purchases from **that vendor** exceeding **₹50 lakh** in the tax year |
| Rate | **0.1%** on the amount **above** ₹50 lakh; **5%** if the vendor has no valid PAN |
| Timing | At **credit to the vendor's account OR payment, whichever is earlier** |
| Base | Value **excluding GST**, where GST is shown separately |
| Return | Form 26Q, section code 1031 |
| Failure | **30% of the purchase value disallowed as expenditure** |

**Do NOT build s.206C(1H) seller TCS.** It was **omitted with effect from 1 April 2025**. Also do not build s.206AB / s.206CCA non-filer checks — likewise omitted. If you find them in an older document in the folder, that document is out of date.

**Implementation:**
- `procurement.tds_ledger` per vendor per financial year: `cumulative_purchase_value`, `threshold_crossed_at`, `tds_deducted`, `challan_ref`
- Withhold at **payable accrual**, because in this design credit precedes payment
- Handle the threshold-crossing invoice correctly: TDS applies **only to the portion above ₹50 lakh** on the invoice that crosses it. Write the boundary test at ₹49,99,999 / ₹50,00,001 / and an invoice straddling the line (`PRC-010`…`PRC-015`)
- Financial-year rollover on 1 April resets the cumulative and the threshold
- A quarterly TDS return export, and a per-vendor annual statement they can reconcile against their own 26AS
- **Gate the whole feature on a config flag** for whether our turnover crossed ₹10 crore (client Q7). If it did not, TDS does not apply at all and the code must be inert, not merely zero-rated

## Task 4 — Customer invoicing, both channels

`payment.invoice`, `payment.invoice_line`, with the merchant-of-record columns from `02_ARCHITECTURE.md` §2.3.

**REGULAR channel:** taxable value = full transaction value, GST 18%, ITC claimed on the purchase.

**MARGIN channel (Rule 32(5) CGST Rules):** taxable value = **(sale price − purchase price) per serial**, negative margins ignored, **no ITC availed or claimable on the purchase**.

The MARGIN channel demands, and you must build all of it:
1. `valuation_method` locked per unit at purchase (Phase 3 trigger, already built)
2. **Per-serial purchase price.** Pooled or weighted-average costing breaks the scheme outright, because the margin must be computed per unit
3. An **ITC-blocking flag** keeping MARGIN purchases out of the ITC ledger, reconciled monthly against GSTR-2B. A single accidental credit claim destroys the position retrospectively
4. Invoice narration: *"Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase."*
5. Segregated GSTR-1 reporting where the taxable value reported is the margin
6. **Never mix REGULAR and MARGIN lines on one invoice.** Split the order into two invoices. Enforce it with a constraint, not a code comment

**Tax split constraint already in the schema, keep it:**
```sql
CONSTRAINT chk_tax_split CHECK (
  (igst > 0 AND cgst = 0 AND sgst = 0) OR (igst = 0 AND cgst >= 0 AND sgst >= 0))
```

**Precision rule:** GST amounts are computed **once and stored**, never recomputed at render. An invoice that disagrees with itself between the screen and the PDF is a support ticket and, eventually, a GST notice.

Invoice numbering: a per-financial-year series, gapless, per GSTIN, generated inside the transaction that creates the invoice. Reserve the series in a dedicated table with a row lock — a gap in a GST invoice series is a question you will be asked in an audit.

## Task 5 — E-invoicing (IRN)

Build the payload and the numbering **now**; switch generation on by config when the client's CA confirms the threshold position (Q8).

- `irn`, `irn_ack_no`, `irn_generated_at`, `signed_qr` on `payment.invoice`
- The IRP adapter with a `Fake` implementation, like everything else
- **The dispatch-from details must be correct in the payload**, because the e-way bill is auto-generated from the IRN and Case 2 depends on those fields
- Note the 30-day reporting window from invoice date for taxpayers above the higher threshold — if generation is enabled, a job must chase unreported invoices before day 30

## Task 6 — E-way bill, Case 2

**One e-way bill for one physical movement, generated by us, on our invoice.**

| Field | Value |
|---|---|
| Bill From | **Us** (legal entity, our GSTIN, our state) |
| Dispatch From | **The vendor's** facility address |
| Bill To | The buyer (their GSTIN, their state) |
| Ship To | The buyer's delivery address |
| Invoice, value, tax | **Invoice-2** — our invoice to the buyer |

**Why Case 2 is mandatory and not a preference:** under Case 1 the vendor generates the bill on *their* invoice, and our purchase price is printed on the paperwork that arrives at the buyer's dock. Under Case 2 our invoice at our price travels, and the vendor appears only as a dispatch address.

**Write the test that proves it** (`PAY-060`…`PAY-064`): tokenise every document that travels with the goods and assert the vendor's `agreed_net_payout` value appears in none of them.

Threshold ₹50,000 consignment value; intra-state thresholds vary by state, so hold them per state in config. Part A is consignment details, Part B is the vehicle — Part B is filled at pickup in Phase 8. Generation is blocked for documents older than 180 days.

**⚠ Before coding the Case 2 invoice field, verify against the CBIC press release of 23 April 2018.** One secondary source rendered it as Invoice-1; the field logic and every other source say Invoice-2.

## Task 7 — Collecting money from buyers

| Rail | Build |
|---|---|
| **Cards / UPI / netbanking** | Razorpay standard checkout. Webhook-driven capture, `UNIQUE (gateway, gateway_ref)` for idempotency. Signature verification on every webhook |
| **NEFT / RTGS / IMPS** | **Razorpay Smart Collect** — a virtual account per buyer, with **TPV** so only the buyer's own verified account can pay in. This is the main B2B rail. Auto-reconciles by webhook; manual UTR entry exists only as a fallback |
| **Cheque and PDC** | Lifecycle `RECEIVED → DEPOSITED → IN_CLEARING → REALISED \| RETURNED`. Model **return** properly: dishonour carries s.138 Negotiable Instruments Act consequences (statutory notice within 30 days of the return memo, 15 days to pay). **Retain the return memo image.** Cheques now clear same-day under RBI continuous clearing (Phase 2 live 3 January 2026), and Positive Pay is mandatory bank-side from ₹50,000 — capture and submit PPS data as part of the deposit flow. PDCs are physical-instrument custody plus a scheduled deposit date; prefer NACH e-mandate for anything recurring |
| **Credit terms** | Our own trade credit against `credit_application` limits and ageing. **Extending our own credit is not lending and does not make us a Lending Service Provider.** Distributing a *third party's* credit does, and pulls in the RBI Digital Lending Directions 2025 — do not build that here |

**The reconciliation engine is the part people underestimate.** Build:
- An **open-items ledger per buyer**: invoice → allocations → residual. Not a payments table
- Bank-statement ingestion with auto-match on virtual account → buyer, amount → open invoices, date window
- **The three hard B2B cases, explicitly**: part payments; consolidated payments across many invoices; and **payments net of TDS the buyer withheld** — a naive matcher treats the last as a permanent short payment and it will pollute your ageing forever
- **An exception queue with a human workflow.** In B2B, 5–15% of receipts will not auto-match. Budget for the UI, not just the algorithm

## Task 8 — The ledger

`payment.ledger_entry` is the source of financial truth. **There is no balance column anywhere** — a balance is `SUM(credit) − SUM(debit)`.

```sql
CONSTRAINT chk_ledger_signs  CHECK (debit >= 0 AND credit >= 0),
CONSTRAINT chk_ledger_single CHECK ((debit > 0) <> (credit > 0))
```

Append-only. Every entry carries a `batch_id`, and every batch sums to zero — asserted **inside** the writing transaction. `payment.v_ledger_imbalance` is the nightly detective control and must return zero rows.

Account structure at minimum: buyer receivable, vendor payable, GST output, GST input, TDS payable, revenue, cost of goods sold, freight, QC cost, penalties, refunds, bank.

## Task 9 — The payout run

Exactly as `02_ARCHITECTURE.md` §4.3.

**Eligibility:** PO three-way matched **AND** delivered **AND** the inspection window closed (client Q5, default 48 hours from delivery).

**Deduction stack, in this order, as first-class data rather than arithmetic in a query:**

```
gross        = SUM(agreed_net_payout) across eligible PO lines
− TDS        computed against tds_ledger
− penalties  from platform.penalty, unsettled
− warranty   recoveries for claims that fell inside that vendor's backed window
± adjustments credit notes, grade-correction repricing, QC visit fee if fee_bearer = VENDOR
= net payable
```

**On warranty recoveries.** We sell 6 months against a vendor's 3 (see Phase 9). A claim inside the vendor-backed window is settled with the customer immediately and recovered here, later, as a line on the payout statement — *"Warranty recovery · serial 5CD1234ABC · claim WC-26-0412 · month 2 of 3 vendor-backed."* It must name the serial and the claim, or the vendor cannot verify it and will dispute it on principle. Claims falling in **our** top-up months draw on the warranty reserve and never touch the vendor.

If `net < vendor_payout_preference.min_payout_threshold` (default ₹1,000), roll it forward. Nobody wants a ₹400 NEFT.

Cycle from `vendor_payout_preference.preferred_cycle` ∈ `WEEKLY | T_PLUS_2 | MONTHLY` — **requested by the vendor, granted by tier** (client Q6 defines the tier mapping).

**The vendor payout statement is a product surface, not a report.** It must show, line by line: which PO, which serials, agreed payout each, every deduction with its reason and its source document, and the net. A vendor who cannot reconcile your statement to their own books will stop trusting you long before they stop selling to you, and that mistrust is expensive to reverse.

Bank transfer via a payout adapter (RazorpayX or bank file), capturing UTR back onto `procurement.payout`.

## Task 10 — Finance console

Receivables ageing · payables ageing · reconciliation exception queue · payout run preparation with a dry-run preview · TDS register and 26Q export · GST registers (GSTR-1 outward with the MARGIN segregation, GSTR-2B reconciliation, GSTR-3B summary) · credit notes · manual journal entries with mandatory narration and dual approval · the ledger explorer.

## Exit criteria

- [ ] An order raises POs; the vendor uploads an invoice; a seal-verified pickup writes the goods receipt; the three-way match completes and a payable accrues
- [ ] A price variance beyond tolerance lands in the finance queue and **does not** accrue a payable
- [ ] TDS is correct at ₹49,99,999, at ₹50,00,001, and on a straddling invoice (`PRC-010`…`PRC-015`)
- [ ] A vendor with no PAN is withheld at 5%
- [ ] Financial-year rollover resets the cumulative and the threshold
- [ ] A REGULAR invoice charges 18% on full value; a MARGIN invoice charges 18% on the per-serial margin and carries the Rule 32(5) narration
- [ ] **A MARGIN purchase cannot enter the ITC ledger** — enforced at the database, not in application code (`PAY-045`…`PAY-049`)
- [ ] An order containing both channels produces **two** invoices, never one mixed invoice
- [ ] All three IGST/CGST+SGST cases from the Bill-To-Ship-To table produce correct tax heads (`PAY-025`…`PAY-030`)
- [ ] **One e-way bill per movement, Case 2 fields correct, and the vendor's purchase price appears on no document that travels with the goods** (`PAY-060`…`PAY-064`)
- [ ] The invoice number series is gapless per GSTIN per financial year under concurrent load
- [ ] A 500-line order rounds with **zero** drift (`PAY-017`)
- [ ] Every ledger batch sums to zero; `v_ledger_imbalance` returns zero rows
- [ ] A payout run produces a statement a vendor can reconcile line by line, with every deduction sourced
- [ ] A payout below the minimum threshold rolls forward
- [ ] A buyer payment net of their own TDS reconciles correctly rather than showing a permanent short payment
- [ ] A dishonoured cheque records the return memo and starts the s.138 clock
- [ ] **No code anywhere implements GST TCS u/s 52, GSTR-8, s.206C(1H), s.206AB or s.206CCA**

═══════════════════════════════════════════════════════════════════
