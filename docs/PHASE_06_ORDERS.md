# PHASE 6 — Checkout, orders, approvals and allocation

**Prerequisite:** Phase 5 exit criteria green.
**Estimated size:** 2 engineers, 7–8 days.
**Covers your requirement #4 (order page and PO), partially.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. Read `docs/_CONTEXT.md` and `docs/02_ARCHITECTURE.md` — **especially §4.1, the order-confirmation transaction** — before starting.

Additional reading: `docs/legacy/Gorefurbo_Schema_Design_Annotated.md` Part 8, `docs/legacy/truetech-operations-journeys.html` Journey 3 part 2, `docs/03_UX_SPEC.md` §3A (cart, checkout, orders), `docs/04_TEST_PLAN.md` §3.8 — the concurrency section is the important one.

## Objective

A buyer checks out a multi-supply-point cart, an approver signs it off if policy requires, specific serial numbers are allocated to that buyer atomically, and purchase orders are raised to each vendor **inside the same transaction**. Two buyers racing for the last unit must produce exactly one winner and one clean failure.

## Task 1 — Checkout

Steps: review → GSTIN and billing → delivery site → PO reference → payment mode → confirm.

**GSTIN selection is the field that decides everything downstream.** A buyer org may hold several GSTINs (`uq_primary_gst ON kyc.gst_profile (org_id) WHERE is_primary`). The chosen GSTIN determines:
- The billing entity on the invoice
- Whether the supply is IGST or CGST+SGST — `payment.invoice` enforces `CHECK ((igst > 0 AND cgst = 0 AND sgst = 0) OR (igst = 0 AND cgst >= 0 AND sgst >= 0))`
- The buyer's ITC position

Resolve the tax split from **our state versus the delivery state** (place of supply under s.10(1)(a) IGST Act is where the movement terminates), not from the billing address. Show the resolved split on screen **before** confirmation so a finance team can catch a wrong GSTIN before an invoice exists.

**Delivery site:** from `org_address` where `is_delivery_enabled`. Capture contact, mobile, landmark, gate instructions and receiving hours — a B2B delivery that arrives at a closed loading dock is a failed delivery, and `delivery_attempt.outcome` has a specific code for it.

**PO number:** if `org_preference.po_required` is true, the buyer's own purchase-order reference is **mandatory** and prints on the invoice. Many Indian corporates will not process an invoice without it.

**Payment mode:** filtered by the buyer's `buyer_approval_policy.allowed_payment_modes` (default `{PREPAID}`) and their credit status. A junior buyer may be permitted prepaid but not the company credit line.

**Price break-up in full, on one screen.** Unit price × quantity, freight, GST by head, total. No progressive disclosure of charges — drip pricing is prohibited.

## Task 2 — Buyer approval policy

`customer.buyer_approval_policy` with `CHECK ((user_id IS NULL) <> (role_id IS NULL))` — a policy targets exactly one of a user or a role, never both, never neither.

Controls: `max_order_value` (null = unlimited), `max_monthly_value` (rolling 30 days), `max_units_per_order`, `allowed_payment_modes`, `requires_approval_above`, `approver_user_id` (null falls back to the org owner), `cost_centres_allowed`.

When a threshold fires, create an `ordering.order_approval`:
- The order sits at `CREATED`
- **Stock is held but the order is not confirmed** — this is the important semantic. The units are unavailable to other buyers, but no PO exists and nothing is committed
- `expires_at` is mandatory, because stock cannot be held indefinitely waiting for a manager. Default 24 hours, configurable
- Approver gets an email, an in-app notification, and a WhatsApp message if consented
- Status `PENDING → APPROVED | REJECTED | EXPIRED`
- On `EXPIRED` or `REJECTED`, release the hold and notify the requester

**This is a genuine B2B differentiator and it is cheap to build.** Do not defer it.

## Task 3 — The order-confirmation transaction

The single most important piece of code in the system. One `BEGIN…COMMIT`, exactly as `02_ARCHITECTURE.md` §4.1 specifies.

```
BEGIN
  1  validate cart, buyer org status VERIFIED, credit headroom, approval satisfied
  2  acquire Redis locks per listing_id — ALWAYS in ascending listing_id order
  3  re-read qty_available FOR UPDATE
  4  assert qty_available >= requested                      -- else fail cleanly
  5  UPDATE listing SET qty_available -= n, qty_reserved += n
  6  INSERT ordering."order"          (order_number TT-26-NNNNN)
  7  INSERT ordering.sub_order        one per vendor — INTERNAL grouping only
  8  INSERT ordering.order_line
  9  SELECT units ... FOR UPDATE SKIP LOCKED               -- allocate specific serials
 10  INSERT ordering.order_line_unit  (unit_id is UNIQUE — one unit, one line, ever)
 11  UPDATE listing.unit SET status = 'RESERVED'
 12  INSERT listing.stock_movement
 13  INSERT procurement.purchase_order + purchase_order_line per vendor
 14  accrue procurement.vendor_payable, computing TDS against procurement.tds_ledger
 15  INSERT ordering.order_event
 16  write events to platform.event_outbox            -- transactional outbox
COMMIT
→ outbox dispatcher emits order.confirmed, po.raised
```

**Rules that are not negotiable:**

- **Lock ordering.** Always ascending `listing_id`. A multi-vendor cart that locks in cart order will deadlock under concurrency, and it will do so intermittently, in production, at volume. Write the test that proves the ordering (`ORD-014`).
- **The Redis lock is an optimisation, not the guarantee.** The guarantee is the DB constraint `qty_available + qty_reserved + qty_awaiting_qc + qty_qc_failed <= qty_total`. **Write a test that expires the lock mid-transaction and proves the constraint still holds** (`ORD-018`). If your correctness depends on the lock, your correctness depends on Redis being up.
- **Unit allocation is `FOR UPDATE SKIP LOCKED`**, so two concurrent orders take different units rather than blocking on each other.
- **`order_line_unit.unit_id` is UNIQUE.** A physical laptop can be on exactly one order line, ever. Mirrored by `purchase_order_line.unit_id UNIQUE`. Together these make double-selling structurally impossible rather than merely unlikely.
- **If the PO cannot be raised, the order does not confirm.** No price-book entry, vendor suspended, TDS ledger locked — all of these fail the checkout. Better a failed checkout than an order you cannot source. Return a specific, honest error: "One of the supply points for this item is temporarily unavailable. Remove it and try again."
- **Rollback must be complete.** Test injected failures at each of the seven points after step 5 and assert nothing persists (`ORD-020`).
- Stock hold at checkout entry is **20 minutes**, released by a job on expiry.

## Task 4 — Order state machine

`order_status` has 24 values and is shared by `order`, `sub_order` and `order_line`:

`CREATED · AWAITING_APPROVAL · PAYMENT_PENDING · CONFIRMED · VENDOR_ACCEPTED · VENDOR_REJECTED · PICKUP_SCHEDULED · PICKED_UP · AT_HUB · QC_IN_PROGRESS · QC_HOLD · QC_CLEARED · INVOICED · PACKED · DISPATCHED · IN_TRANSIT · OUT_FOR_DELIVERY · DELIVERED · PARTIALLY_FULFILLED · COMPLETED · CANCELLED · RTO · RETURNED · REFUNDED`

**Note the QC states are now mostly vestigial** — inspection happens before listing, not after order. `AT_HUB`, `QC_IN_PROGRESS`, `QC_HOLD`, `QC_CLEARED` remain reachable only through the broken-seal exception path (Phase 8, routing rule priority 10). Document that, and write a test asserting the normal path never enters them.

Implement transitions as an explicit, tested state machine with a legality table. Every transition writes `ordering.order_event` with actor, reason and timestamp. **The event log is what the buyer's tracking page renders** — it is a product surface, not a debug log, so write the reason strings for a human reader.

## Task 5 — Purchase orders to vendors

The vendor-facing half of the merchant-of-record model. Build the tables now; Phase 7 builds invoicing and payment on top.

`procurement.purchase_order`: `po_number` (human, e.g. `PO-26-00841`), `vendor_org_id`, `order_id`, `status`, `total_net`, `tds_rate_pct`, `expected_dispatch_at`, `valuation_method`, `terms_days`.
`procurement.purchase_order_line`: `po_id`, `unit_id` **UNIQUE**, `sku_id`, `agreed_net_payout`, `grade_at_po`, `qc_report_id`.

PO status: `RAISED → ACKNOWLEDGED → DISPATCH_READY → DISPATCHED → RECEIVED → INVOICED → MATCHED → PAYABLE → PAID`, with `CANCELLED` and `DISPUTED`.

**Vendor portal on PO receipt:**
- "You have a purchase order for 8 units. Here are the exact serial numbers and seal codes to produce."
- Acknowledge or reject with a reason within a window (default 4 working hours) — a rejection triggers re-allocation from another supply point if stock exists, and a partial cancellation if not
- Print the pick list with serials and seal codes
- The PO shows **only** `agreed_net_payout` — never the retail price, never the buyer's identity, never the delivery address until pickup is scheduled

**Assert in a test that the PO payload contains no buyer identity and no retail price** (`PRC-030`).

## Task 6 — Order and PO documents for the customer

Your requirement #4 asks the customer to see "all PO (created with respect to Order)". Under the merchant-of-record model there are two different documents and they must not be confused:

| Document | Who issues | Who sees it |
|---|---|---|
| **The buyer's own PO reference** | The buyer's procurement system | Buyer; printed on our invoice |
| **Our order confirmation / proforma** | Us, to the buyer | Buyer |
| **Our purchase order to the vendor** | Us, to the vendor | **Vendor and admin only — never the buyer** |

The customer's "PO page" therefore shows: their PO reference, our order confirmation, our proforma, and later our tax invoice. Generate order confirmation and proforma PDFs here; the tax invoice is Phase 7.

## Task 7 — Customer order screens

- Order list with filters, search by order number, PO reference or serial
- Order detail: timeline from `order_event`, **per-serial status**, per-serial QC report links, documents, delivery tracking placeholder, support entry point
- **Order tracking is serial-level.** "Your order" is not one thing arriving; it is 8 specific machines, possibly from 2 dispatch points, possibly arriving on different days. Show it honestly rather than averaging it into one misleading status
- Reorder from a past order — matches by SKU and grade, tells the buyer plainly what is no longer available
- Cancellation, within the rules, with the r.4(8) constraint: **no cancellation charge on the buyer unless we bear an equivalent charge on our own cancellations**

## Task 8 — Admin order board

Board by status, ageing against SLA, exceptions first. Actions: reallocate a line to a different supply point, cancel a line, force a state transition (logged with a mandatory reason), contact the buyer, escalate. Every override is `audit_log`ged with actor and justification.

## Exit criteria

- [ ] **Two concurrent buyers race for the last unit; exactly one succeeds and one gets a clean, specific failure** (`ORD-010`)
- [ ] The DB constraint holds even when the Redis lock is force-expired mid-transaction (`ORD-018`)
- [ ] Injected failure at each of the seven post-decrement points rolls back completely — no orphan order, no orphan PO, no leaked stock (`ORD-020`)
- [ ] A multi-supply-point cart locks in ascending `listing_id` order; a deliberate reverse-order test deadlocks, proving the ordering matters (`ORD-014`)
- [ ] Specific serials are allocated and visible to the buyer on the order detail page
- [ ] A PO is raised per vendor **inside** the order transaction; if PO creation fails, no order exists
- [ ] `order_line_unit.unit_id` and `purchase_order_line.unit_id` uniqueness both fire on a deliberate double-allocation attempt
- [ ] An order above the approval threshold holds stock, does not confirm, expires at 24 hours, and releases the hold
- [ ] IGST vs CGST+SGST resolves correctly for all three cases in the `01_DECISIONS_AND_COMPLIANCE.md` §2.4 table
- [ ] The vendor PO shows no buyer identity and no retail price (`PRC-030`)
- [ ] The customer never sees a vendor purchase order
- [ ] Order confirmation and proforma PDFs generate with correct serials
- [ ] Every state transition writes an `order_event` with a human-readable reason

═══════════════════════════════════════════════════════════════════
