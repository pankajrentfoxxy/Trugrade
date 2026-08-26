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
| **Q7** | Turnover > ₹10 cr in FY 2025-26 | **YES** (26 Aug 2026) → **TDS is live**, not inert | `platform_config.tax.tds_applicable = true`. See §Q7 below |
| **Q15** | Who runs QC | **Supervised first visit, then vendor self-serve** on a DeviceSure activation key + USB agent (26 Aug 2026). Auto-approve above a QC score of 75 | `platform_config.qc.*`, `vendor.qc_autonomy`. See §Q15 below |
| — | Mobile stack | **Expo / React Native**, not Flutter | Phase 4 |
| — | Canonical QC model | **Vendor-site.** `qc_batch` deprecated | Phase 0 Task 5.6 |

### Q7 — TDS is live from day one

TrueTech exceeded ₹10 crore in FY 2025-26, so **s.393(1) Table Sl. No. 8(ii)** of the
Income-tax Act 2025 (formerly s.194Q) applies to our purchases. This is no longer a
dormant code path.

| What | Value |
|---|---|
| Threshold | Purchases from **that vendor** exceeding **₹50 lakh** in the tax year |
| Rate | **0.1%** on the amount *above* ₹50 lakh; **5%** if the vendor has no valid PAN |
| Timing | At **credit or payment, whichever is earlier** — in our design that is at payable accrual, not at payout |
| Base | Value **excluding GST**, where GST is shown separately |
| Return | Form 26Q, section code 1031 |
| Getting it wrong | **30% of the purchase value disallowed as expenditure** |

**What this now requires that a dormant path did not:**

1. A **TAN** for TrueTech, on the platform's own tax profile (VR-018). Without it there
   is no Form 26Q to file.
2. `procurement.tds_ledger` per vendor per financial year, **append-only** — a TDS record
   that can be edited is a TDS record you cannot defend.
3. Correct handling of the **invoice that straddles the threshold**: TDS applies only to
   the portion above ₹50 lakh. The boundary tests at ₹49,99,999 / ₹50,00,001 / straddling
   already exist in `packages/contracts/test/money.spec.ts`.
4. Financial-year rollover on 1 April resets the cumulative *and* the threshold.
5. A quarterly 26Q export and a **per-vendor annual statement they can reconcile against
   their own 26AS** — a vendor who cannot tie our deduction to their credit will dispute
   every payout.
6. Vendor PAN capture becomes load-bearing, not optional: no PAN is a 50× rate difference.

**Still not built, and must never be:** s.206C(1H) seller TCS and s.206AB/206CCA
non-filer checks were **omitted from 1 April 2025**.

⚠ Get the CA to confirm the turnover figure is *aggregate turnover* on the basis the
section uses before Phase 7 ships. The 30% disallowance makes a wrong reading expensive.

### Q15 — supervised first visit, then vendor self-serve

**The model, as decided:**

1. **First listing**: our own QC expert travels to the vendor's premises and runs the
   inspection. One visit, per vendor.
2. **Thereafter**: we issue a **DeviceSure activation key** and ship a **USB agent**. The
   vendor's own staff run QC themselves, on their own people and their own premises.
3. **Auto-approval**: QC score **> 75** auto-approves the listing. At or below 75 the
   unit shows **FAILED**; the vendor fixes the issue and re-runs QC.

**This is good news for the GST fixed-establishment question (§2.5 of `01`).** The hazard
was stationing our own staff, equipment or a dedicated area at a vendor's site *on an
ongoing basis*. Under this model:

- The supervised visit is **one-off, rotating and non-exclusive** — nothing like the
  "sufficient degree of permanence" s.2(50) CGST requires.
- Steady state has **no people and no equipment of ours** at the vendor's site at all. A
  licensed software agent on the vendor's own hardware is not an establishment.

⚠ Still worth a CA's sign-off, but the facts are now favourable rather than borderline.
Document the arrangement as a **software licence to the vendor**, not a service we perform
at their premises.

**And it creates a new risk that is now load-bearing.** `07 §3.6` warned about exactly
this:

> *Once a vendor-run agent produces certificates that set the price we pay and the price a
> buyer pays, that agent is an untrusted party with a financial interest in the result.*

The vendor now runs the tool that decides their own payout. Six controls stop being
nice-to-have:

| # | Control | Why it is now mandatory |
|---|---|---|
| 1 | **Ed25519 signature, signed server-side** | A SHA-256 hash proves a document has not changed since it was written; it proves nothing about *who* wrote it. Anyone holding the pendrive can author a payload and hash it. The signing key must never be on the USB. |
| 2 | **Device binding on the activation key** | One key, one agent, one machine fingerprint. A key that runs anywhere is a key that gets shared. |
| 3 | **Seal roll accounting** | Seals are physical and numbered. Ranges are issued per vendor and reconciled monthly; a certificate citing a seal outside that vendor's issued range is fraud, not a typo. |
| 4 | **5% audit recheck by our own technician** | This becomes *the* control. Vendor-level divergence rate drives the tier, and the tier drives sampling. |
| 5 | **Device passport / component history** (`07 §2`) | Detects the 512 GB drive that became 256 GB between inspection and pickup. A second anti-swap control alongside the seal. |
| 6 | **Score-distribution monitoring** | See the warning below. |

**⚠ Publishing the threshold creates an incentive to hit exactly 76.** A vendor whose
scores cluster just above the cut-off is gaming it, and that is a measurable signal, not a
suspicion. `qc.score_clustering_alert_band` flags any vendor with an anomalous share of
units landing in `[75, 80)` for audit recheck at 100%.

**The concern with the rule as literally stated — and what was built instead.**

A score above 75 is treated as **necessary but not sufficient**. Taken alone it reproduces
the exact defect `07 §3.1` found in DeviceSure v0.1.0: a certificate graded **A+ with a
failed USB port**, because a weighted mean of twelve components swallows one failure.
Eleven components at 100 and one at 30 averages to ~94 — comfortably over 75, and the dead
port disappears.

Auto-approval therefore requires **all** of the following, each individually configurable
so any one can be switched off:

```
qc.auto_approve_min_score            > 75    ← the rule as given
qc.auto_approve_block_on_fail        no FAIL or CRITICAL_FAIL on a required area
qc.auto_approve_block_on_not_measured no required area left unmeasured
qc.auto_approve_require_grade_match  declared grade == found grade
qc.auto_approve_require_seal         seal applied, with a photograph
qc.auto_approve_require_serial_match serial from the tool == declared serial
```

Rationale, in one line each: a dead port on an auto-listed machine is a not-as-described
return we cannot refuse under r.7(4); an unmeasured thermal system is a material unknown
we would be vouching for under r.7(5); a grade mismatch auto-listed at the vendor's
declared grade is our misrepresentation under r.7(2), not theirs.

**Ask:** confirm you want those five gates alongside the score, or name the ones to drop.

## Assumed — defaults taken, each reversible in config

| Q | Question | Default taken | Where to change it |
|---|---|---|---|
| Q3 | Vendor commission model | **(b)** margin rule by category/brand/grade, with (a) fixed-% as the one-row special case | `procurement.margin_rule` rows |
| Q4 | Who pays the QC visit | Fee ₹1,500, bearer `TRUETECH`, min 25 units, waived above 50 | `platform_config`: `qc.visit_fee_inr`, `qc.fee_bearer`, `qc.min_units_per_visit`, `qc.visit_fee_waiver_units` |
| Q5 | Inspection window | **48 hours** from delivery | `platform_config.ordering.inspection_window_hours` |
| Q6 | Vendor payment terms | `T_PLUS_2` default, cycle earned by tier, ₹1,000 minimum payout | `vendor.vendor_payout_preference`, `platform_config.procurement.min_payout_threshold_inr` |
| Q8 | E-invoicing threshold | Payload and numbering built; **IRN generation off** | `platform_config.tax.einvoice_enabled` |
| Q9 | Unregistered-vendor share | Assumed **material** → MARGIN built as a full parallel pipeline, not a back-office path | Phase 7 |
| Q10 | Buyer credit terms | **Prepaid-only** at pilot; credit machinery built but gated | `platform_config.ordering.credit_enabled` |
| Q11 | Pilot geography | **NCR only**, in-house delivery; Delhivery adapter built against its real sandbox | `logistics.routing_rule` seed |
| Q12/Q13 | Carrier and Razorpay accounts | Assumed **not yet live** → every adapter runs `INTEGRATION_MODE=mock` | `.env` per adapter |
| Q14 | DeviceSure payload | Built to `07 §5.4`; a signed mock stands in | `qc_tool_provider.field_map_json` — swapping is config, not a release |
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
| ~~Q15 / GST fixed establishment~~ | — | **ANSWERED 26 Aug 2026.** Supervised first visit then vendor self-serve. The facts are now favourable — no permanent people or equipment at a vendor site. Still worth a CA's sign-off, but it is a confirmation rather than an open question. See §Q15. |
| **Vendor-run QC anti-fraud** *(new, created by the Q15 answer)* | Phase 4 go-live | The vendor now runs the tool that sets their own payout. Ed25519 server-side signing, device binding and seal-roll reconciliation move from "planned" to "cannot ship without". Not a legal sign-off — an engineering one, but it belongs on this list because shipping without it is the same class of risk. |
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
