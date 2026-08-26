# Open decisions — what the build assumed, and how to change it

`01_DECISIONS_AND_COMPLIANCE.md` Part 4 leaves 23 questions open; `06_AMENDMENT_R2.md` adds
three more. None of them blocks the build, because every one has a documented default and
every default lives in `platform_config` or a feature flag rather than in code.

This file is the register. **Each row names where the value actually lives**, so changing a
decision is a config edit and a test run, not an archaeology exercise.

Legend — **Status:** `DECIDED` (client has answered) · `ASSUMED` (default taken, reversible)
· `BLOCKED` (needs counsel/CA before the dependent phase ships).

---

## Decided

| Q | Question | Answer | Where it lives |
|---|---|---|---|
| Q1 | Brand | **Trugrade** (26 Aug 2026) | `packages/config/src/brand.ts` — one token, no literals |
| Q2 | Invoicing legal entity | **TrueTech Services Pvt. Ltd.** | `LEGAL_DISCLOSURE.legalName` |
| Q21 | Whose contract is it | **Ours.** Back-to-back principal / merchant of record | The whole architecture. Reversing this is a rewrite of Phases 5–7 |
| — | Mobile stack | **Expo / React Native**, not Flutter | Phase 4 |
| — | Canonical QC model | **Vendor-site.** `qc_batch` deprecated | Phase 0 Task 5.6 |

## Assumed — defaults taken, each reversible in config

| Q | Question | Default taken | Where to change it |
|---|---|---|---|
| Q3 | Vendor commission model | **(b)** margin rule by category/brand/grade, with (a) fixed-% as the one-row special case | `procurement.margin_rule` rows |
| Q4 | Who pays the QC visit | Fee ₹1,500, bearer `TRUETECH`, min 25 units, waived above 50 | `platform_config`: `qc.visit_fee_inr`, `qc.fee_bearer`, `qc.min_units_per_visit`, `qc.visit_fee_waiver_units` |
| Q5 | Inspection window | **48 hours** from delivery | `platform_config.ordering.inspection_window_hours` |
| Q6 | Vendor payment terms | `T_PLUS_2` default, cycle earned by tier, ₹1,000 minimum payout | `vendor.vendor_payout_preference`, `platform_config.procurement.min_payout_threshold_inr` |
| Q7 | Our turnover > ₹10 cr | **Assumed NO** → TDS code path is inert, not zero-rated | `platform_config.tax.tds_applicable` (boolean). Flipping it activates the whole s.393(1) Sl.8(ii) path |
| Q8 | E-invoicing threshold | Payload and numbering built; **IRN generation off** | `platform_config.tax.einvoice_enabled` |
| Q9 | Unregistered-vendor share | Assumed **material** → MARGIN built as a full parallel pipeline, not a back-office path | Phase 7 |
| Q10 | Buyer credit terms | **Prepaid-only** at pilot; credit machinery built but gated | `platform_config.ordering.credit_enabled` |
| Q11 | Pilot geography | **NCR only**, in-house delivery; Delhivery adapter built against its real sandbox | `logistics.routing_rule` seed |
| Q12/Q13 | Carrier and Razorpay accounts | Assumed **not yet live** → every adapter runs `INTEGRATION_MODE=mock` | `.env` per adapter |
| Q14 | DeviceSure payload | Built to `07 §5.4`; a signed mock stands in | `qc_tool_provider.field_map_json` — swapping is config, not a release |
| Q15 | Who runs QC | Assumed **vendor staff under our protocol and licence** (the lower fixed-establishment risk reading) | Changes the technician app's threat model, not its schema. See ⚠ below |
| Q16 | QC validity | **90 days**, vendor warned at 14 | `platform_config.qc.report_validity_days`, `qc.expiry_warning_days` |
| Q22 | Warranty top-up rule | **Vendor's term + 3 months**, floor 6 total | `procurement.margin_rule.warranty_top_up_months` |
| Q23 | Small-sample threshold | **10 inspected units** before a headline average is shown | `platform_config.qc.min_sample_for_headline` |

## Deviations from the pack, and why

These are places where two source documents disagree. Each resolution is deliberate.

| Conflict | Sources | Resolution |
|---|---|---|
| **Seal code prefix** | Phase 4 writes `GF-8841-QK`; `04` VR-100 writes `GRF-26HR-0004821` | Shape from VR-100, prefix is a config token defaulting to **`TRG`** (`platform_config.qc.seal_code_prefix`). The brand changed after both were written, and physical seal rolls are ordered against this shape — fixing it after the first print run is expensive. |
| **OTP TTL** | Phase 1 says 10 minutes; `04` VR-051 says 300 s | **300 s**, per the validation contract, which is the more specific document. `platform_config.identity.otp_ttl_seconds`. |
| **Inspection window** | `04` VR-153 says 5 days; `_CONTEXT` and Phases 6–9 say 48 hours | **48 hours** — it is the commercial promise the payout-eligibility clock is built on. |
| **Cart reservation** | Phase 5 says 20 min; `04` VR-124 says 15 min | **20 minutes**, per the phase prompt that owns checkout. |
| **Design tokens** | `_CONTEXT` and `03 Part 1` say navy/cyan/orange; `08` says Anodised | **`08` wins** — it says so explicitly. No orange exists in the system. |
| **Grade cap on a failed component** | `07 §3.1` proposes capping at grade C | We sell nothing below B, so a `FAIL` on a required area caps at **B and sets `is_sellable = FALSE`**. Same intent, expressed in our grade set. |
| **Technician identity** | `qc_report.technician_id` → `identity.user_account`; `qc_seal.applied_by` → `qc.qc_technician` | **`qc.qc_technician` everywhere**, migrated. Two identities on one inspection is how an audit trail stops being one. |

## ⚠ Blocked — needs counsel or a CA before the dependent phase ships

| Item | Blocks | Why it cannot be defaulted |
|---|---|---|
| **Q15 / GST fixed establishment** — who physically runs QC at a vendor site | Phase 4 go-live, multi-state scale | A fixed establishment under s.2(50) CGST changes the location of the supplier and can force registration in that state. This is a tax-structure decision wearing an operations costume. |
| **Rule 32(5) "minor processing"** | Phase 7 MARGIN volume | No binding authority on refurbished IT hardware. Consider an advance ruling under s.97 CGST if material volume depends on it. |
| **Seal branding → "product manufacturer"?** (CPA 2019 s.2(36)) | Phase 4 seal artwork | Manufacturer liability under s.84 is materially stricter than product-seller liability. Brand the *inspection*, not the *machine*, until this is answered. |
| **CPCB refurbisher registration** (E-Waste Rules 2022) | Vendor approval gate | If it reaches our model it is a hard gate, not a badge. |
| **BIS/CRS on domestic resale** | Scale-up | Flips if we re-brand units or handle a never-registered model. |
| **FDI — inventory model vs cash-and-carry wholesale** | Any term sheet | Getting it wrong is a restructuring, not a fine. Resolve before building a year of history. |
| **Warranty document** | Phase 9 | It is simultaneously the product, the s.86(c) trigger and the r.7(5) vouching. `coverage_json` is generated **from** that document, never written independently by an engineer. |
| **E-way bill Case 2 invoice field** | Phase 7 | One secondary source rendered it as Invoice-1; field logic and every other source say Invoice-2. Verify against the CBIC press release of 23 Apr 2018 before coding. |

## Not built, deliberately — a test asserting any of these is a defect

Per `04_TEST_PLAN.md` §1.6, and repeated here because it is the easiest thing to drift back into:

- GST TCS u/s 52, GSTR-8, TCS credit reconciliation
- TDS u/s 194-O / s.393(1) Sl.8(v) on us as an e-commerce operator
- s.206C(1H) seller TCS — **omitted from 1 Apr 2025**
- s.206AB / s.206CCA non-filer higher-rate checks — omitted
- Rule 5(3)(a) seller name/address/phone disclosure — marketplace-only; we are an inventory entity
- Payment-aggregator escrow, Razorpay Route split settlement
- `qc_batch` hub-batch QC
