# PHASE 8 — Logistics, carrier integrations and delivery

**Prerequisite:** Phase 7 exit criteria green. **Carrier accounts must already be applied for — see `01_DECISIONS_AND_COMPLIANCE.md` Part 5.**
**Estimated size:** 2 engineers + 1 mobile, 10–12 days.
**Covers your requirement #10.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. Read `docs/_CONTEXT.md` and `docs/02_ARCHITECTURE.md` §5.1 (the logistics adapter layer) in full.

Additional reading: `docs/legacy/truetech_schema_migration_v3_qc_at_source.sql` (routing_rule, carrier_rate_card, vehicle, route_plan, route_stop, delivery_attempt — all exist), `docs/legacy/truetech-operations-journeys.html` Journey 4, `docs/04_TEST_PLAN.md` §3.11.

## Objective

An order ships **vendor → buyer directly**, the seal is verified at pickup in under two minutes, the right carrier is chosen by declarative rules, tracking flows in reliably, and delivery completes with an OTP, a photograph, and a seal the buyer can check themselves before signing.

## Task 1 — The canonical model, first

Define your own domain objects and never let a carrier's schema leak upward: `ShipFromLocation`, `Consignee`, `Package`, `HandlingUnit`, `Shipment`, `ServiceOption`, `TrackingMilestone`, `Surcharge`, `ProofOfDelivery`.

Map marketplace → canonical → carrier. Never marketplace → carrier.

**Build one carrier end-to-end before building five.** Delhivery is the anchor: it is the only provider with genuinely public documentation, a real sandbox, a non-expiring token, published rate limits, webhooks, and a documented NDR API. Prove the canonical model against it, then add adapters.

## Task 2 — Carrier adapters

| Carrier | Auth | Sandbox | Tracking | Notes |
|---|---|---|---|---|
| **Delhivery** | Static token, never expires, `Authorization: Token <t>` | `staging-express.delhivery.com` | Push webhook (they configure it) + pull, **750 req / 5 min / IP** | The anchor |
| **Blue Dart** | JWT from Consumer Key + Secret (**TTL undocumented**) plus `LicenceKey` and `LoginID` on every call — **four secrets** | Exists; URL not published; credentials review-gated | **Polling only** | **No rate-quote API** — hold your own rate card. Use **refresh-on-401**, not a timer, since the TTL is unknown |
| **Shiprocket** | Bearer, **240 h / 10-day expiry**. The API user's email **must differ** from the account email | **None** — test against production | Webhooks; **429 with an unpublished limit** | Aggregator fallback for long-tail pincodes |
| **DTDC** | `api-key` + `customerId` headers (Shipsy platform) | On request | Polling + webhook | **No public documentation at all.** Reach via Shiprocket unless a customer contract demands it |
| **Porter** | Not publicly documented; form-gated | Not documented | Webhooks; **tracking capped at 1 req/min** | **2-wheeler only, prepaid only, single pickup + single drop, intra-city only.** Architecturally unsuited to B2B freight — use it for same-city small parcels and nothing else |
| **In-house** | — | — | Own rider app | The NCR pilot rail |

### Delhivery quirks — encode every one of these

- The order-creation payload must be **form-encoded as `format=json&data=<json>`**, not a raw JSON body. This is what breaks most first integrations
- **Five characters are rejected outright: `&` `\` `%` `#` `;`.** Strip or encode them in every string field
- `pickup_location` must match the registered warehouse name **exactly, case-sensitive**, or you get an opaque "ClientWarehouse matching query" error
- Prepaid accounts need a **minimum ₹500 wallet balance** to manifest — a silent production failure mode. Monitor the balance and alert
- Duplicate `order_id` is rejected against already-consumed manifestation data
- Shipments must be passed as a **list**, even for one
- Multi-piece shipments require **pre-fetched waybills per box** — you cannot let the system auto-generate for MPS
- E-way bill goes in the `ewbn` field; `seller_gst_tin` and `hsn_code` are **mandatory**
- Serviceability response carries `is_oda` (out-of-delivery-area) — **important for B2B pricing**, since ODA pincodes attract surcharges

### Non-negotiables across every adapter

- **Idempotency key on every shipment creation.** If a carrier accepts and the connection then times out, a naive retry produces a duplicate label and a duplicate billed shipment. Do not rely on carrier-side dedup
- **Retain the raw carrier status code alongside your normalised milestone.** Delhivery's NDR API keys off raw codes (`EOD-74`, `EOD-15`, `ST-108`, …) to decide which actions are even *legal*. A normalisation that discards carrier codes silently breaks NDR handling
- **Distinguish transient from business failures.** Timeouts and 5xx → exponential backoff. Validation failures (bad pincode, wallet under ₹500, warehouse name mismatch) → an **operator work queue**, never a silent retry
- **Sequence and deduplicate tracking events.** Carrier scans arrive out of order and duplicated. Test both
- **Queue with priority classes.** Warehouse label generation must not be starved by bulk tracking ingestion
- Every adapter gets **contract tests against recorded fixtures**, so a carrier changing a response shape fails CI rather than production

## Task 3 — Routing rules

`logistics.routing_rule` already exists — declarative, evaluated in `priority` order, **first match wins**. Nullable predicate columns mean "don't care". Ops tunes routing without a code release.

Seeded rules to honour:

| Priority | Condition | Route |
|---|---|---|
| 10 | **Broken seal** | `VIA_HUB` — forced back through QC |
| 20 | Multi-vendor order | `CONSOLIDATED` |
| 30 | Vendor tier WATCHLIST or BRONZE | `VIA_HUB` |
| 40 | Value > ₹20,00,000 | `VIA_HUB` |
| 50 | NCR → NCR | `DIRECT`, in-house |
| 60 | Same city, ≥20 units | `DIRECT`, Porter |
| 70 | Otherwise | `DIRECT`, Blue Dart |
| 99 | Catch-all | `VIA_HUB` |

**Fix two schema defects here:**
- `routing_rule.carrier_code` and `fallback_carrier_code` are plain `TEXT`. Add FKs to `logistics.carrier(code)` so a typo in a rule fails at insert time rather than at dispatch time
- `carrier_rate_card` has **no overlap exclusion**, unlike `listing_tier_price` which does. Add `EXCLUDE USING gist` on carrier + from_zone + to_zone + weight range + effective date range. Two overlapping rate cards both match and quoting becomes non-deterministic

**Note on `CONSOLIDATED` in the merchant-of-record model.** A buyer sees one order from one seller — us. When units come from two supply points, either consolidate through the hub so the buyer gets one delivery, or ship directly and tell the buyer plainly that their order arrives in two parts on two dates. **Do not average two dispatch dates into one misleading ETA.** Make it a routing rule, decided by value and buyer preference, not an accident.

## Task 4 — Pickup and the seal check

This is the two minutes that decides whether an order ships.

```
1  Vendor is told exactly which sealed machines to produce (serials + seal codes)
2  Rider or carrier arrives, scans each seal code and each serial
3  pickup_task.expected_seals  vs  scanned_seals
4  Seal intact + serial matches  →  qc_reverification (DISPATCH_PICKUP / SEAL_CHECK) PASS
                                 →  procurement.goods_receipt written   ← unblocks Phase 7
                                 →  unit status PICKED_UP
5  Seal broken or missing       →  unit status SEAL_BROKEN
                                 →  routing rule priority 10 forces VIA_HUB
                                 →  full re-inspection, buyer notified, line paused
6  Serial mismatch              →  hard stop, exception to the QC manager
7  Unit absent                  →  partial pickup, line re-allocated or cancelled
8  e-way bill Part B filled with the vehicle number
9  Manifest signed, custody_event written
```

`logistics.custody_event` is append-only. It is the chain-of-custody record you will need the day a machine goes missing between a warehouse and a buyer.

## Task 5 — Delivery

- Delivery task with an OTP to the consignee's registered mobile
- Rider scans each serial against the manifest at the door
- **Seal integrity is shown to the buyer to check themselves before they sign.** This is the moment the whole model pays off — the buyer can verify that the machine they are accepting is the machine that was inspected
- Photographic POD, geo-tagged
- `logistics.delivery_attempt` with structured outcomes: `DELIVERED | CONSIGNEE_UNAVAILABLE | ADDRESS_NOT_FOUND | REFUSED | GATE_PASS_MISSING | OFFICE_CLOSED | PARTIAL_ACCEPTED | RESCHEDULED`. `UNIQUE (delivery_task_id, attempt_no)`. These are structured because "office closed" is a scheduling problem while "refused" is a commercial one, and they need different handling
- **Three failed attempts → RTO** (`dispatch.rto_after_attempts`). Currently config-only with nothing stopping attempt 4 — enforce it in the application and test it
- On delivery: order line → `DELIVERED`, the **inspection window opens** (client Q5, default 48 hours), and the payout-eligibility clock starts

## Task 6 — NDR, as a first-class flow

Not an edge case. Indian e-commerce sees high failed-delivery rates and unresolved NDRs convert to RTO with reverse logistics costing **₹180–240 per order** and no revenue recovered.

**Industry norms to build to:**
- Carriers make **2–3 delivery attempts** before RTO
- The seller-response window is **36 hours** from the NDR being raised — nearly every NDR not resolved inside it ends in RTO
- Carrier SLAs allow **24–48 hours between attempts**
- Delhivery deferral is capped at **6 days**

**Target response times by reason:** incorrect address, 2 hours · consignee unavailable, 4 hours · phone unreachable, 6 hours · fake delivery attempt, same day.

**Build:**
- An NDR queue with reason, age against the 36-hour window, and the legal actions for that carrier's raw status code
- A canonical NDR action mapping to Delhivery's `DEFER_DLV` / `RE-ATTEMPT` / `EDIT_DETAILS`, with a per-carrier legality check against the raw code. **Delhivery's NDR API is asynchronous** — it returns a UPL ID and you must poll a status endpoint. The workflow has to handle deferred confirmation, not fire-and-forget
- **Automated buyer contact** — SMS, WhatsApp, and a voice callback option for address confirmation. The binding constraint is reaching the buyer, not calling the carrier API. A 36-hour window is too tight for a manual queue at volume
- Blue Dart NDR is **not publicly documented** — raise it during onboarding and treat it as an open question until answered

## Task 7 — Route planning and the rider app

`logistics.route_plan` with `CHECK ((rider_id IS NULL) <> (technician_id IS NULL))` — a route belongs to a rider **or** a technician, never both, never neither. This unifies delivery routing and QC-visit routing on one object, which is why the technician app and the rider app can share a route screen.

`logistics.route_stop`, `UNIQUE (route_plan_id, sequence_no)`. Max 8 stops (`logistics.max_stops_per_route`) — currently config-only with no constraint; enforce it in the application.

`logistics.vehicle` for the in-house fleet, with insurance and PUC validity tracked and expiring-document alerts.

**Rider app (Expo), `apps/rider`** — sharing the offline architecture and much of the UI from the Phase 4 technician app:
task list · navigation to stop · **serial and seal scan against the manifest** · exception capture · OTP entry · POD photograph · delivery attempt outcome · offline queue with a visible pending count.

## Task 8 — Serviceability and rate shopping

- `logistics.pincode_serviceability`, `UNIQUE (pincode, carrier_id, service_type)`, refreshed from carrier master-data APIs on a schedule (Delhivery and Blue Dart both offer a pincode master download)
- Rate shopping across carriers using `carrier_rate_card`, with **Blue Dart quoted from your own contract rate card** because it publishes no rate API
- Freight feeds the landed price on the storefront (Phase 5) — cache serviceability and rates aggressively; a live carrier call inside a product-page render will destroy your 500 ms budget
- **`is_oda` handling** — out-of-delivery-area pincodes carry surcharges and must be reflected in the landed price rather than absorbed silently

## Task 9 — Logistics console

Shipment board · route planning with a map · rider assignment · exception queue · NDR queue with the 36-hour clock visible · carrier performance (on-time %, damage %, exception rate, cost per shipment) · rate-card administration · routing-rule administration with a **simulator** ("given this order, which rule fires and why") · serviceability lookup · custody-event trail per unit.

The routing simulator is worth building properly. Eight rules evaluated first-match-wins is exactly the kind of system where nobody can predict the behaviour after three months of ops edits.

## Exit criteria

- [ ] An order ships **vendor → buyer directly** with one e-way bill carrying Case 2 fields
- [ ] The seal check at pickup completes in under two minutes on a real device, and writes `procurement.goods_receipt`
- [ ] A broken seal moves the unit to `SEAL_BROKEN`, forces `VIA_HUB` by routing rule 10, pauses the line and notifies the buyer
- [ ] A serial mismatch at pickup is a hard stop with an exception raised
- [ ] Delhivery contract tests pass against recorded fixtures, covering form-encoding, the five rejected characters, the case-sensitive warehouse name, the ₹500 wallet minimum and duplicate `order_id`
- [ ] Blue Dart refreshes its JWT on a 401 rather than on a timer, and concurrent requests trigger a single refresh
- [ ] A Shiprocket 429 backs off correctly; the 240-hour token refreshes before expiry
- [ ] Porter tracking respects the 1 req/min budget, and a backwards `order_reopened` webhook is handled without corrupting state
- [ ] Duplicate and out-of-order tracking events are deduplicated and ordered correctly
- [ ] An idempotency key prevents a duplicate shipment on a retried timeout
- [ ] An NDR action illegal for the carrier's raw status code is **rejected before** the API call
- [ ] Three failed delivery attempts trigger RTO and a fourth cannot be recorded
- [ ] `carrier_rate_card` rejects an overlapping rate card
- [ ] A routing rule referencing an unknown carrier code fails at insert
- [ ] The routing simulator explains which rule fired and why for any given order
- [ ] Rider app completes a delivery fully offline and syncs with no data loss
- [ ] The buyer can verify the seal at the door before signing

═══════════════════════════════════════════════════════════════════
