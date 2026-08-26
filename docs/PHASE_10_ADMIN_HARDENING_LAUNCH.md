# PHASE 10 — Admin completion, hardening and pilot launch

**Prerequisite:** Phase 9 exit criteria green.
**Estimated size:** whole team, 8–10 days.
**Covers your requirement #7 (the full admin portal) and closes everything else.**

---

═══════════════════════════════════════════════════════════════════

Continue building **gorefurbo**. This phase has no new domain. It finishes the admin console, closes every security and performance gap, and puts the platform in front of real users.

Read `docs/04_TEST_PLAN.md` Part 4 (non-functional) and Part 6 (release gates) in full before starting.

## Objective

One real order — placed, sourced, picked up seal-verified, delivered, invoiced and paid — with **no engineer intervening at any point.** That is the only exit criterion that matters; the rest are how you get there.

## Task 1 — Finish the admin portal

Phases 1–9 each built the admin screens they needed. This task fills the gaps and makes the console coherent.

**Complete the console:**
- **Ops dashboard** — one screen answering: what is stuck, what breached SLA, what needs a human today. Onboarding queue depth and age, QC visits today and tomorrow, orders awaiting PO acknowledgement, pickups today, NDR queue with the 36-hour clock, unmatched receipts, claims breaching SLA, drift-view results
- **Global search** — one box that finds an order by number, a unit by serial, a vendor by GSTIN, a buyer by PO reference, an invoice by number, a seal by code. Ops lives in this box
- **Unit 360** — every fact about one serial on one page: catalog, listing, QC report with photographs, seal chain, order, PO, invoice, shipment, custody events, warranty, claims. When something goes wrong, this is where the answer is
- **Notification templates** — `UNIQUE (code, channel, locale, version)`, with EN and HI variants, preview, test send, and a version history. **Transactional messages ignore the `notify_*` preference flags**; only marketing and digests respect them
- **Feature flags** — `rollout_pct BETWEEN 0 AND 100`, per-org overrides, an audit trail
- **Platform config** — every threshold in one place with its effective date, an editor with type validation, and a change log. The QC visit fee, minimum units per visit, 90-day QC validity, 48-hour inspection window, geo-variance alert, audit-recheck percentage, grade-correction auto-days, RTO attempt count, max stops per route, document age rules, price-variance tolerance, minimum payout threshold. **Nothing that ops might want to tune should require a deploy**
- **Audit log viewer** — filter by actor, entity, action, date; export
- **User and role administration** for platform staff, with MFA enforced
- **Reporting**: GMV and margin by SKU, brand, grade and supply point · QC economics (cost per inspected unit, pass rate, correction rate) · vendor performance · buyer cohort and repeat rate · logistics cost and on-time rate · claim and return rates · ageing on both sides

**Reporting note:** build these as SQL views with a caching layer, not as a BI tool integration. At pilot volume a BI licence is cost without benefit, and the queries you write here become the BI semantic layer later.

## Task 2 — Security hardening

Work the OWASP API Top 10 matrix in `04_TEST_PLAN.md` §4.2 to completion. Specifically:

- **IDOR sweep across every endpoint.** Automated: for each authenticated route, replay it with a different org's token and assert a 403 or 404, never a 200. This is the single highest-value security test in a multi-tenant marketplace
- **Re-run the anonymity serialization sweep** (`IDN-080`…`IDN-094`) against the *complete* API surface, not just the endpoints that existed in Phase 5. Every phase since then added routes
- **Rate limits** on every public endpoint, tighter on OTP, verification, search and login. Per IP, per user, per org
- **Upload hardening**: signed URLs, 5 MB cap, MIME allow-list, magic-byte validation, EXIF strip, AV scan, and a check that a file cannot be fetched without a signed URL
- **JWT rotation and revocation**: refresh-token reuse invalidates the session family; a revoked session cannot be resurrected; logout is server-side
- **SQL injection** via filter, sort and pagination parameters — the faceted search is the largest surface
- **SSRF** on any webhook URL a vendor or admin can configure; allow-list schemes and block private ranges
- **Secrets scanning** in CI, and confirm nothing anywhere contains `CHANGE_ME_IN_PRODUCTION`
- **Dependency audit** and a lockfile policy
- **Penetration test** by a third party before launch. Budget two weeks for the test and the remediation, not one

## Task 3 — Performance

Run the k6 scenarios in `04_TEST_PLAN.md` §4.1 and hit the budgets:

| Target | Budget |
|---|---|
| Offers grid | p95 < 500 ms at 6 supply points / 500 units |
| Search | p95 < 300 ms |
| Order confirmation | p95 < 1 s |
| Concurrent buyers | 200 |
| Bulk serial upload | 50 vendors × 500 serials concurrently |
| LCP / CLS / INP | < 2.5 s / < 0.1 / < 200 ms on mid-range Android over 4G |

- Verify every index actually gets used — `EXPLAIN ANALYZE` on the ten hottest queries, checked into the repo as a baseline
- Remove N+1 queries; Prisma makes them easy to write and invisible to notice
- Connection pooling sized against ECS task count
- Consider a denormalised read model for the offers grid, refreshed on `qc.report.completed` and `listing.published`, if the live join cannot make budget

## Task 4 — Reliability

- **Backups**: RDS automated backups plus a nightly logical dump to S3. **Test a restore.** An untested backup is a hope, not a backup
- **Partition runway** ≥ 90 days on every partitioned table, with the health check alerting below 30
- **All six drift views** wired to nightly jobs, each returning zero rows, each paging on a non-zero result: `v_ledger_imbalance`, `v_stock_drift`, `v_sellability_drift`, `v_expiring_documents`, `v_expiring_qc`, plus a new one for three-way-match staleness
- **Dead-letter queues** monitored, with an ops screen to inspect and replay
- **A runbook** for the ten most likely incidents: carrier API down, payment webhook backlog, QC sync failure, partition exhaustion, drift alert, oversell, seal mismatch spike, ledger imbalance, mass NDR, database failover
- **Graceful degradation**: if a carrier API is down, orders still confirm and shipments queue. If the QC ingestion endpoint is down, the technician app queues offline. **Nothing customer-facing should fail because a third party did**

## Task 5 — Accessibility and content

- WCAG 2.2 AA: axe automated across every route, plus the manual keyboard and screen-reader checklist in `04_TEST_PLAN.md` §4.3
- Hindi localisation for buyer- and vendor-facing transactional messages, and for the vendor portal
- Legal pages, all live and linked: terms, privacy (DPDP-compliant), grading policy, warranty policy, return policy, shipping policy, vendor agreement, grievance redressal
- **The r.4(2) disclosure block on every page**: legal name, principal geographic address of HQ and all branches, website details, customer-care contacts, grievance-officer name, designation and contact
- **A final dark-patterns review** against all thirteen CCPA categories, with a written sign-off

## Task 6 — Data seeding and go-live

- Production seeding: catalog, condition images, grade definitions, tolerance rules, margin rules, routing rules, rate cards, notification templates, config
- **Onboard 5 real vendors and 3 real buyers.** Someone must recruit and hand-hold them — **that is not a developer's job.** Assign it now
- Run 3 real QC visits before launch day, not on launch day
- A dry-run order, end to end, with real money, on the day before launch

## Task 7 — Launch

- Canary: 10% of traffic, then 50%, then 100%
- A monitoring dashboard on a screen someone is actually watching
- A war-room channel with a named on-call rotation
- A **rollback plan**, tested, including the migration-reversal path
- **One real order, end to end, with a real buyer, on launch day**

## Exit criteria — the release gate

- [ ] **One real order completes: placed → PO raised → seal-verified pickup → delivered → invoiced → vendor paid, with no engineer intervening**
- [ ] The buyer can download the QC certificate and wipe certificate for every unit they received
- [ ] **No critical or high-severity finding open** from the penetration test
- [ ] The IDOR sweep returns zero 200s across the full API surface
- [ ] The anonymity sweep passes against the complete API surface
- [ ] All performance budgets met under load
- [ ] All six drift views return zero rows on production data
- [ ] Partition runway ≥ 90 days
- [ ] A database restore has been performed and verified end-to-end
- [ ] WCAG 2.2 AA: zero axe violations, manual checklist signed off
- [ ] Every legal page live; the r.4(2) block on every page; the grievance-officer workflow operating
- [ ] Dark-patterns review signed off against all thirteen categories
- [ ] The runbook exists and **the ops team can operate the platform without a developer** — proven by having them do it for a day
- [ ] 5 vendors and 3 buyers onboarded and transacting

---

## After day one — the order to build things in

Named here so the team builds toward them rather than against them.

| Weeks | Work |
|---|---|
| +1–2 | Stabilisation. Fix what the pilot found, not what you planned |
| +3–4 | E-invoice IRN generation, if the threshold applies |
| +5–6 | Blue Dart and DTDC adapters; expand serviceability beyond NCR |
| +7–8 | RFQ and bulk quotes, properly. Split-award across supply points |
| +9–10 | Vendor scorecard automation, once 90 days of data exists |
| +11–12 | Buyer credit terms at scale, ageing, collections workflow |
| +13–16 | Parts and accessories as a second category — the catalog and QC models already support it, the grading model does not. **Design a parts grading model before you build the category, not after** |
| +17+ | OpenSearch when facet latency demands it; BI; multi-hub; extract `qc` as the first real microservice |

## Where the model will strain first — watch these

Three predictions, offered so they are not surprises.

**QC economics.** You pay to inspect stock that may never sell. `qc.v_visit_economics` gives you cost per inspected unit; watch it against realised gross margin per sold unit weekly from day one. The controls already in the design are the 25-unit minimum, geographic batching, the visit fee below a threshold, and earned sampling by tier. If cost per inspected unit does not fall as vendor tiers mature, the sampling model is not working and that is a business problem, not an engineering one.

**Inspection staleness.** Reports expire at 90 days and units auto-unlist. On slow-moving SKUs you will pay to inspect the same machine twice. Watch the re-inspection rate by SKU and by vendor — it is a signal to stop listing that configuration, not a signal to extend the validity window.

**Working capital.** As principal you owe vendors on delivery-plus-window while buyers on credit terms pay you later. That gap is your working-capital requirement and it grows linearly with volume. It is the number that will constrain growth, and no amount of software fixes it. Model it before you scale vendor onboarding.

═══════════════════════════════════════════════════════════════════
