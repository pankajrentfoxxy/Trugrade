# BUILD LEDGER

Updated: 2026-08-31T00:00:00+00:00  
Currently: Wave 4 - **T35 done (the Ctrl+K palette and the unit 360)**, which is the last screen task
in the backlog; everything after it is an audit. T39 done (the ops order and procurement boards). **T24 done** - the buyer's own seal check at handover, and returns inside the 48-hour window; platform.return_request has a writer at last

This file is the memory of a long run. Context gets compacted; this does not.
Re-read it at the start of every task. Update it at the end of every task, in the
same commit as the work.

Status is one of `TODO` / `DOING` / `DONE` / `BLOCKED`.

| ID | Task | Status | Commit | Screens verified | Notes |
|----|------|--------|--------|------------------|-------|
| T1 | Console shell and chrome | DONE | 13ab439 | console shell, both themes, 900/600 | Dark chrome per 09_FRONTEND_LOCKED; shell/Shell.tsx + nav.ts; screenshots in .screenshots/T1-console-shell/ |
| T2 | Console design conformance pass | DONE | 944eac9 | 126 shots: 21 routes x 2 themes x 1440/900/600 | All 25 route files; 13 hand-rolled tables to DataBoard; archetype on every route; board state in the URL; 0 stray hex. Exposed two defects, both FIXED in 944eac9: the API not booting (DocumentService unregistered) and cn() stripping text colours. |
| T3 | packages/ui gap-fill | DONE | 13ab439 | Storybook, both themes | All 20 components exported: StepRail WhyRail OtpInput FormSection AddressCard DocumentViewer RecordHeader SidePanel KpiRow QueueList Timeline + DataBoard density-aware |
| T4 | Customer registration - shell and steps 1-2 | DONE | b0acc96 | 26 shots, both themes, 1440/900/600 | Archetype D. Rail drawn from seeded step definitions, purpose_note is the why-rail copy. Save-and-resume verified with a cold reload. Added GET /api/onboarding/steps/definitions (@Public). Fixed: header classes that existed in no stylesheet, footer unreadable in light, ThemeToggle hydration failure, Stepper green tick. |
| T5 | Customer registration - step 3 statutory | DONE | 71d75ef | 34 shots, both themes, 1440/900/600 | PASS shows the returned legal name; FAIL names the reason; PROVIDER_ERROR never blames the applicant, never consumes an attempt, retries with visible backoff. Checksum + embedded-PAN conflict caught client-side. Fixed a cross-tenant rate-limit hole and the invalid GSTIN example. |
| T6 | Customer registration - steps 4-5 and submission | DONE | fa6484b | 30 shots, both themes, 1440/900/600 | Contacts+addresses with receiving hours, document upload with real magic-byte and age refusals, review screen, submitted and NEEDS_FIX states. Fixed four missing-renders-as-achieved defects. Uploader visible progress fixed in packages/ui (10f5b9d). |
| T7 | Vendor registration - steps 1-3 | DONE | a2da740 | 42 shots, both themes, 1440/900/600 | RegisterFlow is one shell for both flows (buyer 5 steps, vendor 7). StepAccount/StepStatutory shared so the PROVIDER_ERROR ladder and checksum guard exist once. CIN/Udyam/TAN render Captured-not-verified. Fixed: vendors could not register at all (MFA), /auth/session lying about mfaRequired, two time-bomb tests, Input mono missing tnum. |
| T8 | Vendor registration - steps 4-5 | DONE | 9612014 | 60 shots, both themes, 1440/900/600 | Capability + facilities. can_dropship required with 'no' a real answer; dispatch_address explicit rather than silently defaulting (it becomes Dispatch From on every e-way bill). Grade mix carries its denominator and must total 100. No defaultChecked anywhere. |
| T9 | Vendor registration - steps 6-7 and submission | DONE | 6ea119e | 86 shots, both themes, 1440/900/600 | Documents+bank with a real penny-drop, agreement+payout, review, submission, application status. Extracted three shared pieces rather than copying T6's: `DocumentChecklist`, `review-parts`, `verification`. Fixed a live API defect — the penny-drop hashed one value for the policy and another for the record, so the retry limit never bound and one typo paused an application. |
| T10 | Sign-in, both portals, surrounding states | DONE | 9046aff | 138 shots, 23 states x 2 themes x 3 widths | Closes Wave 2. Rate limit shows the server's real countdown off Retry-After. MFA says out loud that it is an emailed code, not TOTP, and login/otp refuses MFA_REQUIRED_ROLES. Enumeration closed structurally (deliver:false). Fixed: reviewer's rejection reason reaching nobody, an SLA promise under a rejection, db.ts skipping migrations on any private test DB, wordmark invisible in light. |
| T11 | Search results /search | DONE | 012086b | 50 shots, 10 states x 2 themes x 3 widths | Archetype B. Reuses the homepage rail rather than building a second. Whole board state in the URL. Zero-count facets disabled not hidden. Grade counts from unit.grade_actual. Unmeasured battery renders 'Not measured', never 0%. No supplier nameable. |
| T12 | Product detail /laptops/[slug] | DONE | 07b6c03 | 66 shots, both themes, 1440/900/600 | Archetype C. Board endpoint built. Ten supply points, both F's distinct, cheapest scores worst, Palwal renders New supplier. p95 190ms vs 500ms budget. Anonymity swept over 140KB of live payloads: zero hits. OfferRow gained `emphasis` so one row carries the amber, not ten. |
| T13 | Unit passport /unit/[serial] | DONE | 48a15a5 | 70 shots, both themes, 1440/900/600 | Archetype C, reachable signed out, noindex. All twelve areas including NOT_MEASURED. Real photographs behind viewfinder brackets. Needed the image pipeline + QC evidence prerequisite first. |
| T14 | Certificate verification /qc/verify/[code] | DONE | 878f888 | 60 shots, 600/900/1440, both themes | Archetype F, phone-first. Broken seal outranks the verdict. Expired is not failure. Unknown vs malformed distinguished without adding a third validator. Real QR, not the reference's decorative one. |
| T15 | Cart | DONE | ccc664a | 54 shots, both themes, 1440/900/600 | Archetype C. Grouped by dispatch point, never called a sub-order. 20-minute hold honestly absent (belongs to checkout). Fixed a silent false sign-out affecting EVERY authenticated screen, and /sign-in dropping ?next=. |
| T16 | Checkout | DONE | 93eb028 | 130 shots, 27 states x 2 themes x 3 widths | Archetype D. 16-step order transaction, 42 integration tests covering ORD-010/014/018/020 and PRC-030. Proven in data: PAYMENT_PENDING 3 units + 2 POs; AWAITING_APPROVAL 6 units + 0 POs. Six defects found by loading the screen, incl. an unresolved tax split drawn as settled with the wrong pair of heads. Also fixed: cart deletion stranding held stock (5ddf02b), and the header never reading the session (3963e99). |
| T17 | Order confirmation and approval-required | DONE | 569ccfb | 54 shots, both themes, 1440/900/600 | Archetype C at /orders/[orderNumber]. Built the one missing route, GET /api/buyer/orders/:orderNumber, which never reads procurement.purchase_order — anonymity structural, not careful. A foreign order answers 404 not 403, because sequential order numbers make a 403 an order-volume oracle. A PENDING approval past its deadline is reported EXPIRED by the server. |
| T18 | Bulk requirement upload | DONE | 856029c | 78 shots, 13 states x 2 themes x 3 widths | Archetype D. Closes Wave 3. Real lead created (TKT-202608-592E05E7) with 3 RFQ rows. XLSX refused by magic bytes rather than half-parsed. Found the CSV line-number shift and the A+ refusal, both fixed in 1361247. |
| T19 | Customer dashboard | DONE |  | 28 shots, 6 states x 2 themes, 1440/900/600 | Archetype E at `/account` — the header's Account button led to a 404 until now. Four KPI tiles and ONE queue, because the approval expiry is the only SLA a buyer is on the receiving end of. `approvalSlaHours` is measured off the row (`expires_at - requested_at`), never the column's 24h default. No approve/reject control, because no endpoint can decide one. Empty-account state reached by parking all 13 orders on another buyer org through the real column, then putting them back. |
| T20 | Order list | DONE |  | 56 shots, 14 states x 2 themes, 1440/900/600 | Archetype B at `/account/orders`. Built `GET /api/buyer/orders` — the list endpoint did not exist. One search box over three numbers (ours, the buyer's PO reference, a serial) and the matched serial is shown on the row. Whole board state in the URL; the capture script reaches every filtered state by address, not by clicking. Facet counts live, zero-count options disabled not hidden. Found and fixed two page-level horizontal-scroll defects that affected EVERY storefront board. |
| T21 | Order detail - serial level | DONE |  | 48 shots, 14 states x 2 themes, 1440/900/600 | Archetype B at `/account/orders/[orderNumber]/units`, the first sub-route of the record — the tab strip lives in the record's LAYOUT so T22/T23/T24 inherit it. Built `GET /api/buyer/orders/:orderNumber/units` and `IQcService.inspectionsByReport`, so ordering reads QC through qc's own allow-list rather than joining three of its tables. Reads neither `procurement.purchase_order` nor `listing.unit`. Foreign order 404 not 403, matching T17. **Fixed the QC seed monoculture**: 239 reports were all PASS/A/APPLIED — `prisma/seed/qc-spread.ts` now derives PASS_WITH_NOTE from the WARN areas already seeded and puts a FAIL, a MISMATCH, a broken seal and three grade corrections on allocated units only (a FAIL on a LISTED unit would put a failed laptop on the storefront, because `unit_is_sellable` does not look at the verdict). Three defects found by loading the screen: the order record had been rendering the site header TWICE since it moved under `/account`; `battery_health_pct` is NUMERIC so `$queryRaw` returned it as a STRING and an average would have concatenated it; and a descending sort flipped nulls-last to nulls-first, putting the unmeasured machine at the top as if it were the best battery. |
| T22 | Documents - invoice, proforma, e-way bill | DONE |  | 44 shots, 11 states x 2 themes, 1440/900/600, plus 3 rendered PDFs opened and read | Archetype B at `/account/orders/[orderNumber]/documents`, and the first task in the `payment` module — it had 12 empty tables and no writer anywhere in `src`, so 13 orders existed and not one invoice did. **Built the issuance, not just the screen.** `InvoiceIssueService` prices a consignment through `platformToBuyer`, `resolveTaxSplit` and `marginTaxableValue` from `@trugrade/contracts` — it does no arithmetic of its own — and `InvoicePdfService` renders with pdf-lib the way `qc/internal/report-pdf.service.ts` does, no second library and no headless browser. The first real invoice (`TT/2026-27/00001`, Rs 99,059.82) totals to the ORDER's stored `grand_total` to the paisa, which is the cross-check that says the invoice and the order are one calculation rather than two that agree today. **Three moments, not one.** A proforma exists on confirmation; a tax invoice at REMOVAL of the goods (s.31(1)(a) CGST Act — not at payment, which is what T17's screen already said in words); an e-way bill at pickup. One invoice per CONSIGNMENT rather than per order, because Rule 138 binds an e-way bill to a consignment and `payment.eway_bill.invoice_id` is UNIQUE — one invoice per order would leave two of three dispatches with nothing they could legally travel under. **The proforma is not stored, deliberately.** It is not statutory, it consumes no number from the GST series, and it is derived entirely from the order — so it is rendered on demand and numbered `PRO/<order>`. Storing it would need a writer inside the checkout transaction and would produce a document that goes stale the moment the order changes. **Gapless numbering proved by a real race**, not by asserting the lock exists: eight concurrent transactions through `payment.next_invoice_number` come back 00001…00008, no gap, no duplicate, counter at 8. The function and its `FOR UPDATE` were already in the Phase 7 migration; nothing had ever called them. **The seller did not exist.** `kyc.gst_profile` carried a GSTIN for every buyer and vendor and none for us, and `payment.invoice_series` was empty — so issuance refused, correctly, and the whole path was unreachable. `prisma/seed/invoicing.ts` adds our registration (synthetic, check-digit valid, Haryana 06), the series for this financial year AND the next, and moves TT-26-00001 to DISPATCHED so the screen has both halves of its story on one database. The invoice itself is raised through the real path, `POST /api/ops/orders/:orderNumber/invoices`, so it goes through the numbering it exists to prove. **The empty state IS the screen.** Every document is a row on every order, and one that does not exist carries the moment that brings it — no blank, no dead download, no disabled button. A cancelled order says "never", not "later". A MARGIN order is flagged on the PROFORMA, before the money moves, rather than at invoice time. **The seam runs one way.** `ordering` owns the order and hands `payment` an `OrderBillingBasis` — a value, not a handle — so `payment` has no path back into `ordering."order"` and therefore none to a vendor org id. Anonymity swept in the PDF BYTES, not just the JSON: inflate every stream, hex-decode the text, and grep that plus the filename and the document metadata for the vendor's legal name, trade name, GSTIN, org id and our own purchase price, with positive assertions on the serial and the invoice number so the sweep cannot pass on an empty haystack. Four defects found by loading the screen: "Not numbered yet" on rows that will never carry a number; a blank amount on the proforma, which is the one figure a finance team pays against; an e-way bill promising "at pickup" on a CANCELLED order; and `.pill.wire` being a CHROME control (`--on-chrome` on `--chrome-line-2`) that renders white-on-white on a light working surface — T21's "Show all machines" has it too. |
| T23 | Warranty and claims | DONE |  | 52 shots, 13 states x 2 themes, 1440/900/600 | The first task in the `platform` module — it had 0 internals, 0 routes and 0 rows in `warranty`, `warranty_claim`, `return_request` and `return_qc`. **The question was what creates a `platform.warranty` row, and the honest answer was that nothing could.** Cover starts when the buyer has the machine; `logistics.shipment` and `logistics.delivery_task` are both EMPTY and neither has a writer, so there was no delivery on the database for a term to run from — the after-sale half of the product was unreachable, not merely unbuilt. So delivery is recorded in **ordering's own schema** (`sub_order.delivered_at`, the statuses, an `order_event`) by `POST /api/ops/orders/:orderNumber/delivery`, the same manual shape T22 used for invoices and for the same missing-pickup-writer reason. It fabricates no carrier, no AWB and no rider POD; when `logistics` grows a real delivery task, that becomes the source and this becomes the exception path. **It takes no timestamp** — the instant is `ClockPort` and there is no parameter to override it, because that stamp is what T24's 48-hour window is measured from. Idempotent, proved by pressing it twice and counting rows. **The term was already modelled and the retrofit got it right**: one number to the customer, `vendor_backed_months + platform_backed_months` internally, `provider` deliberately dropped because we are the sole warrantor for the whole term. Nothing reopened it. `total = max(vendor months + platform.warranty_top_up_months, platform.warranty_min_total_months)` — the same arithmetic the PRICE was built from, and the floor is why "we have not agreed a top-up with this supply point" never renders as "no warranty". **Three schema gaps closed.** `platform.warranty` had no uniqueness at all, so a second press would have given one machine two overlapping terms; `uq_warranty_unit` fixes it. `warranty_claim.status` DEFAULTED to `'OPEN'`, which is not in its own eleven-state CHECK — every insert that did not name a status explicitly would have failed, and zero rows had ever been written so nobody had hit it. The claim also gained `claim_number`, `evidence_keys` and `order_line_unit_id`. **The seam runs through barrels, not joins.** `ordering` gained `ownedUnits()` on its public interface — ownership of a serial is four tables and a state machine ordering owns — and `platform` reaches it through `OrderingLookup`, a late `ModuleRef` resolve mirroring ordering's own `CatalogLookup`, because `OrderingModule` already imports `PlatformModule` and the reverse would close a cycle. Two single-schema statements and a fuse in TypeScript wherever a join would have been shorter. **Every deadline is decided on the server**: `inWarranty`, `daysRemaining` and `expiringSoon` are FIELDS on the payload, not a subtraction the page does, so a laptop clock three weeks fast cannot offer a paid repair on a machine we owe a free one on. `addMonths` clamps to the last day of the target month — 31 Aug + 6 months is 28 Feb, not 3 Mar — which is the sort of two-day overrun only ever noticed in a dispute. **Three screens, three archetypes**: B at `/account/warranty`, D at `/account/warranty/claims/new`, C at `/account/warranty/claims/[claimNumber]`, plus the Warranty tab in `AccountNav`. The distinction the register exists to keep is between COVERED, OUT OF COVER and NOT COVERED YET — a machine that has not arrived shows "Cover starts on delivery" in `--ink-4`, never an expiry and never a tick. **A term ending is not a FAIL**: days remaining are amber (a measured value, one of the accent's three meanings), an ended term is neutral ink beside its date, and the only red on these screens is a rejected claim and a refusal. An out-of-warranty machine gets the exact expiry date and a paid-repair route, never a dead end. 17 integration tests, every guard attempted rather than asserted: a second organisation raises a claim on the first's serial (404, not 403) and reads their claim by its real number (404, and absent from their list). `prisma/seed/after-sale.ts` advances six orders out of the supply point and backdates three arrivals — 5, 165 and 400 days — so an expired window, an expiring term and an out-of-warranty machine are all reachable; the instant comes from the caller's `SystemClock`, not from `Date.now()`, so the seed and the service measure from one clock. Added `rider@trugrade.in` to the demo seed: `logistics.delivery.execute` lives only on RIDER and PLATFORM_SUPERADMIN, and the superadmin needs MFA, so without it the delivery endpoint was unreachable on the demo database. |
| T24 | Returns inside the 48-hour window | DONE |  | 102 shots, 19 states x 2 themes, 1440/900/600 | **The after-sale half T21 and T23 both deferred: the buyer's own seal check at handover, and the return window that runs from it.** T21 explicitly left "verify a seal" and "flag a mismatch" unbuilt because neither had an endpoint; `platform.return_request` and `return_qc` were 0 rows with no writer anywhere in `src`. **The window is ONE number in ONE place.** `ordering.inspection_window_hours` is the key `procurement`'s payables screen already measures against — the window that lets a buyer send a machine back is the same one that makes the vendor's money eligible, and two constants for that would eventually pay a supply point for a machine still inside its buyer's return period. Both ends come from `ClockPort`: T23's `delivered_at` stamped it, and "has it closed" is decided against the same clock — the T25 defect was exactly that pair coming from two sources. **The page never decides**: `window.open`, `hoursRemaining` and every `blockedReason` are fields, and there is no `Date.now()` in either screen. The key MISSING is `null` and then no window is claimed at all, the same treatment `PayableService` gives it. **Three seams, no new ones.** `qc` gained `recordSealCheck` on its barrel — `ordering` owns the manifest and decides whether a scanned code is on THIS delivery, `qc` owns what a seal may become, and `SealingService.verifyIntact`/`reportBroken` were already there and are not restated; it refuses a `unitId`/`sealCode` pair that do not match even though the caller has already matched them. `platform` gained `openSealDiscrepancy` on ITS barrel, called from `ordering` (which already imports `PlatformModule`), and it takes **no org id** — the buyer's org is read from the request context inside `platform`, so there is no argument a caller can get wrong. Returns reach ownership through T23's `OrderingLookup`. **The manifest is this order's machines and nothing wider**, which is the whole safety property: a lookup asking "is this a valid seal anywhere" would answer yes about a laptop that was never sold to this buyer. The refusal is §3A.3's own sentence, verbatim, in a `role="alert"` panel above the record rather than a red line under an input — it is an instruction to refuse a machine, not a typo notice. **A broken or missing seal blocks receipt and opens the return in the same call**, one tap, because Rule 7(4) take-back is ours and non-delegable. **This is the screen that turns APPLIED into INTACT** and it is why `SealChip` paints APPLIED neutral: an unchecked seal blocks the handover exactly as a broken one does, for a different reason, said differently. Receipt is an `ordering.order_event` (`BUYER_RECEIPT_CONFIRMED`), NOT a fabricated POD — `logistics.delivery_task` still has no writer and a rider's signature nobody took would be the missing-value defect with a photograph attached. Addressed by POSITION (`/delivery/2/receipt`), never by `sub_order_number`: "sub-order" is a word that does not reach a buyer. **Schema: a broken seal is its own reason.** §3A.4 lists six return reasons and the CHECK held six codes, but not the same six — "seal broken on arrival" had nowhere to go and the nearest fit already meant physical damage, so `SEAL_BROKEN` was added; folding them together loses the distinction that decides who pays. `uq_return_open_per_unit` (partial, on the live statuses) is what makes the automatic discrepancy idempotent — the T23 lesson about a uniqueness rule enforced only in code on a table whose caller is a button — and `ix_return_buyer` because every query on it is org-scoped and there was no index. **Four screens**: C at `/account/orders/[id]/delivery`, B at `/account/returns`, D at `/account/returns/new`, C at `/account/returns/[id]`, plus the Delivery-check tab in `OrderNav`, Returns in `AccountNav`, and the flag action on T21's units board that states a MISMATCH and could not act on it. **Colour**: hours remaining are amber as a MEASURED VALUE and nothing on either screen flashes — §3A.4 is explicit that the countdown is information, not pressure; a closed window is neutral ink, a date and the warranty route, never a failure. A pending return, a collected one and an inspected one are all neutral; the only red is a seal we cannot vouch for and a rejection, which are genuine verdicts. One amber control per screen and one across all three consignments — the scan button while a seal is unchecked, the sign button once none is. 15 integration tests, every guard attempted with a control beside it: a return one minute inside the window lands and one two minutes outside is refused on the same order (nothing differs but the instant); a REAL seal belonging to a neighbour is refused with the exact sentence while a seal on this delivery succeeds; a second org raises a return on the first's order and reads their return by its real number (404 both, and the owner does both successfully in the same test). Mutation-checked: `TRUE OR buyer_org_id = ...` in `forOrgByNumber` fails the org test. **Seven component tests** for the claims an integration test cannot see, and the first of them is a defect this task actually shipped for one capture run: an order whose window closed with NOT ONE seal looked at rendered "Every seal checked" at the top, because the unchecked count was taken over live consignments only. Also locked: a machine with no seal on record draws the words and no chip, exactly one amber control across three deliveries, the not-on-this-delivery alert is `role="alert"` and verbatim, and a payload saying `open: false` with a future `closesAt` is honoured rather than re-derived. Mutation-checked: reverting the never-checked branch fails exactly one. Also asserted: the partial unique index refuses a second live return by direct INSERT, a REJECTED one does not block a new one, receipt is refused half-checked and is idempotent, and `findForbiddenKeys` sweeps all three payloads. **Not built, and each says so on screen.** (a) **Evidence upload.** §3A.4 wants two photographs for physical damage and a seal photo for a broken-seal claim; the only upload route on the platform writes `kyc.document` rows into the onboarding review queue, which is the wrong home for a picture of a scratched lid. Refusing against a control that does not exist would make two of six reasons unreachable with a 422 nobody can satisfy, so the shortfall travels as `evidenceStillNeeded` and both screens say we will ask by email. When an evidence route exists this becomes the refusal and the number does not move. (b) **What actually mismatched.** T21's deferral asked for it; `qc.qc_mismatch` has ZERO rows and nothing writes one, so the screens carry the MISMATCH verdict and the action, and the return form asks the buyer for the detail we never captured. (c) **The return's own timeline is one step.** Pickup, receipt and inspection have no writer and `platform.return_qc` is empty; the record draws "raised" and says the rest has not happened rather than inventing a collection date. (d) **No refund date.** No configured refund period and no `payment.credit_note` writer, so the panel states what happens and not when. (e) The ops side of a return (`/admin/returns`) is not built — this task is the buyer's half. **Found on the way past, fixed once:** `.pill.wire`'s base rule in `storefront.css` is the HEADER's dark-chrome variant (on-chrome text on a translucent white border), so a wire pill inside an `EmptyState` is very nearly invisible on a light working surface — T21's units board, T22's documents board and T23's warranty board all have that button in that place. One shared rule rather than four. **Reported, not fixed:** `DataBoard` renders its `empty` slot inside a `<td colSpan>`, so on a phone the whole empty-state panel inherits the table's intrinsic width and sits off the right edge of a horizontal scroll nobody knows is there. Right for a table of data; wrong for the one sentence explaining why there is none. T24's returns board renders its empty state INSTEAD of the board to dodge it; the same is true of the other three boards and the fix belongs in `packages/ui`. |
| T25 | Account - addresses, team, approvals | DONE |  | 116 shots, 29 states x 2 themes, 1440/900/600 | **Closes the build's oldest reachability gap.** `APPROVED` and `REJECTED` were states the schema allowed and the product could not reach: PHASE_06 Task 2 built the policy, the `order_approval` row and the 24-hour deadline, the transaction wrote the row, and nothing could decide one. Built `POST /api/buyer/approvals/:id/decision` plus `GET /api/buyer/approvals` and `/:id`; the four stranded orders now have a way forward and two were decided through the real endpoint (`TT-26-00004` approved, two POs raised; `TT-26-00011` declined, six units back to LISTED). **VR-123 did not exist anywhere and now does** - `roles.ts` said "enforced in the service" and no service enforced it. Four screens: `/account/approvals` (B), `/account/approvals/[id]` (C), `/account/addresses` (C), `/account/team` (B), plus `AccountNav` in the layout because three of them were reachable from nowhere. Addresses and team live in `identity` where their tables already are; the `customer` module is still empty. 22 integration tests (10 approval, 12 account), 8 storefront unit tests, every one attempting the forbidden thing. Also fixed: `order_approval.requested_at` came from the DATABASE clock while `expires_at` came from `ClockPort`, so the measured SLA drifted with any skew. |
| T26 | Vendor dashboard | DONE |  | 30 shots, 5 states x 2 themes, 1440/900/600 | Archetype E at `/vendor` — it was a KPI row and nothing else, which is B's furniture under E's name. Added the two queues, sorted by breach: grade corrections (real SLA, `qc.grade_correction_auto_days` x 24 = 48h) and awaiting inspection (**no SLA, and none invented** — `slaHours` and `breachedCount` come back `null`, and the route drops the fields rather than defaulting them). Cut three tiles that linked nowhere real: `/vendor/payables` and `/vendor/qc/corrections` are routes that do not exist, and `?expiring=14` is a parameter the listings board silently ignores. Kept the numbers, dropped the hrefs. Dropped the awaiting-inspection tile because the queue says the same thing with the wait attached. `unitsEverListed` added to the payload: first-run was inferred from `live + awaiting + sold`, which told a vendor whose whole first batch failed inspection to list their first stock. Added `?corrected=1` to the listings board so the corrections queue lands somewhere — predicate is the correction row, NOT `grade_corrected_from`, which is only written once a correction is APPLIED and therefore matched nothing for every correction still open. Nav lied: the single vendor entry said 'My listings' and pointed at the dashboard. Now two entries, 'Today' and 'My listings'. 6 integration tests, org scoping proven by seeding a neighbour with strictly more of everything and mutation-checked (removing one `vendor_org_id =` fails the suite). 6 console tests, one of which demands the ABSENCE of an SLA clause. |
| T27 | Listing wizard design pass + commission readout | DONE |  | 84 shots, 14 states x 2 themes, 1440/900/600 | Archetype D at `/vendor/listings/new`, and it had been shipping **two columns of a three-column archetype** — `WhyRail` was in `@trugrade/ui`, built for vendor registration, and used by nothing. Added, one list per step, every entry a consequence rather than a definition. **Two live defects found by driving the screen rather than reading it.** (1) Answering the batch-size question ran create -> attach -> submit a SECOND time, so `POST /:id/units` was handed serials the vendor's own draft was already holding; the API correctly refused them and the vendor was left with two drafts, an error calling their own machines duplicates, and no inspection. `listingId` is now remembered and the answer re-submits the listing that exists. Regression test attempts the second create and counts the POSTs. (2) **The wizard's success state was unreachable for every vendor in the database**: `vendor.vendor_facility` had 0 rows, `SubmitService.facilityAt` refuses a pickup address with no facility behind it, and `POST /api/vendor/facilities` wrote only `identity.org_address` — so the picker offered a location that submit then rejected, telling the vendor to add it as a facility on a screen that does not exist. Both the route and `prisma/seed/demo.ts` now write the facility row in the same transaction; a real visit (QCV-20260830-073FFC1F) was raised to prove it. Commission readout: `totalDeductions` was computed by the server and shown nowhere, so a list of charges had no total; `expectedPayoutDate` is absent from the server type and rendered 'Set by your payout cycle' in the value slot, a sentence dressed as an answer — now 'Not calculated' in `--ink-4`; the percentage carries its denominator in words, because the rupee denominator IS the selling price and that is the one figure this screen may not show. Grade definitions now carry their measured floors (battery %, cosmetic score, cycle cap) beside the prose, from `catalog.v_current_grade_definition` — the fields were already on the wire and the console type dropped them — and a declared band whose CEILING cannot clear the chosen grade's floor warns, never blocks (UNKNOWN has no ceiling and is compared to nothing, because a missing measurement must not render as passing OR failing). One primary action per screen: the selected SKU row stopped being an amber button, and the footer's submit is suppressed while the batch-size question is open. Every 'MISSING route' comment in `vendor/api.ts` was stale — all nine exist. |
| T28 | Listing management and repricing | DONE |  | 81 shots, 13 states x 2 themes, 1440/900/600 | Archetype B at `/vendor/listings` and a new archetype C at `/vendor/listings/[id]/reprice`. **The logged `STATUS_TONE` bug is fixed and the sweep found seven more of it.** ACTIVE was green and REJECTED/SUSPENDED red; ACTIVE/PARTIALLY_ACTIVE are now `info` (the amber wash, which is rule 1's third meaning — an active state), the in-flight ones are `processing`, and everything terminal is neutral with its meaning in its own label. Also fixed, same mistake, listed because a colour that means a verdict in one place and a status in another has stopped meaning either: `vendor/Units.tsx` (a sellable unit painted green two columns from the grade badge that carries the real verdict), `qc/VisitBoard.tsx` (COMPLETED green, NO_SHOW red), `qc/VisitDetail.tsx` (**UNTESTABLE was red — "we could not measure it" is not "it failed", and that distinction is what a vendor's appeal turns on**), `qc/AuditRecheck.tsx` and `qc/ToolProviders.tsx` ("Active" green), `qc/GradeCorrections.tsx` (an elapsed response window red), `ReviewQueue.tsx` (an SLA we breached rendered as a verdict on the applicant), `VendorReview.tsx` (a declared capability green). Deliberately left: real PASS/FAIL verdicts, form error text, and `ConditionImageCoverage`'s publish gate, which is a genuine binary. Row-action links dropped from `--acc-ink` to `--ink`: fifty rows x two links is a hundred amber controls beside the one chip that now means something. **`?corrected=1` was answering a different question from the queue that links to it** — the dashboard counts corrections with `vendor_responded_at IS NULL AND auto_applied_at IS NULL`, the board matched every correction ever raised. They agree today only because no vendor can answer one (T31) and the auto-apply job has never run; the moment either changes a queue saying "3 need you" lands on a board of nine. One predicate now, an integration test that seeds an answered correction and demands its absence, and the capture script reads both numbers live and refuses to run if they disagree. The board caption printed `rows.length` (a page) where it meant `total` (a match count). **Reprice is a route, not the row-expanding panel it was** — that panel's open/closed state lived in React and not the URL. It names, by serial, the machines that will NOT move: `unit.purchase_price` is frozen by `trg_lock_purchase_price` and the handler updates `WHERE purchase_price IS NULL`, so committed machines were being skipped in silence and a vendor who repriced forty and found nine unchanged would conclude it half-failed. `VendorUnitView` gained `payoutLocked` (the boolean, never the amount) to make that sayable. Six integration tests: two attempt the forbidden `UPDATE` on `purchase_price` and `valuation_method` directly against the table and demand the refusal (`pg_trigger` is consulted nowhere), one proves the partial skip, one proves the all-committed refusal is the vendor-readable 412 and not a trigger exception, one aims the reprice at a neighbour's listing, one is the corrections filter. Mutation-checked: removing either predicate fails the right tests. **Two more defects found on the way.** (1) `qc.visit_fee_waived_above` and `qc.visit_fee_waiver_units` are one number under two names — the baseline migration writes the first and `PricingService` reads it; the seed wrote the second and only `SubmitService` read it. So a database built from the seed alone could not price a listing and one built from migrations alone could not request an inspection. One name now, and `price.guardrail_lower_multiple` added to the seed for the same reason. (2) **Nine of the ten seeded vendors had no user account**, and they are exactly the nine whose stock the demo orders were placed against — so every unit in the database carrying a `purchase_price` belonged to a vendor who could not sign in, and the whole committed-machines behaviour was unreachable through the product. One VENDOR_OPS per supply point in `demo.ts`. |
| T29 | Bulk serial upload with dry-run | DONE |  | 57 shots, 10 states x 2 themes, 1440/900/600 (the commit is captured once, in dark) | Archetype F at `/vendor/listings/[id]/bulk-upload`, rebuilt around one rule: **the counts the dry run promises are the counts the commit produces.** Three divergences existed and each rejected the ENTIRE file at commit time while the report announced a page of happy rows. (1) **`willAdd` counted only clean rows** while `onAccepted` handed the commit clean + warned, so a file with 28 warnings said "412 of 440 will be added" above a button reading "Add 440 machines". `willAdd` now means what the commit inserts and `warnings` is documented and rendered as a SUBSET of it — a warned row is an accepted row, which is the entire point of it being a warning. (2) **The dry run did not know the listing.** `ListingService.addUnits` refuses a listing that is not a DRAFT, and this screen is reachable from any listing row. (3) **Nor its capacity** — `addUnits` refuses the whole batch over `LISTING_QTY.max`, so a big file onto a nearly-full listing promised 5,000 and delivered nothing. New `POST /api/vendor/listings/:id/serials/validate-csv` reads both; the wizard keeps the unscoped route because at step 3 there genuinely is no listing, and a nullable field would make "we did not check" and "we checked and it is fine" the same response. Over-capacity rows become ERRORs naming the line to delete rather than a whole-file refusal after the fact. **A bug the screenshots caught that no test would have**: `validateSerialBatch` writes "Duplicate of line N" where N is the BATCH index, and `dryRunCsv` remapped the row's `lineNumber` to the vendor's file but never the number inside the prose — a file with a blank third line reported "Duplicate of line 1", which is the header. Same defect as misnumbering a row, arriving by a different door. XLSX/OLE/PDF/PNG/gzip/RAR/ELF refused by **magic bytes in the browser before a byte is decoded**, and refused again server-side (NULs and a U+FFFD ratio) because the API is the trust boundary and a client that is not our screen gets the same answer. Row cap and 10 MB cap named as sentences rather than met as a zod error at the commit. Template download added — `SERIAL_CSV_COLUMN` claimed to BE the download and nothing served it. The commit now **reconciles against the promise** and says so either way, including "exactly what the dry run said", because printing it only on a mismatch teaches people that silence means nothing happened. Eight integration tests, every one shaped as promise-then-commit-then-compare over the same bytes; four console tests including a renamed XLSX asserted to reach no API call. **Not built, deliberately:** §3B.2's cross-SKU importer (a row carrying SKU code, grade, battery and payout, at `/vendor/listings/bulk-upload` with no id). That needs an endpoint that creates listings from a file, and a grade column on THIS route would be actively wrong — a listing carries one declared grade and is priced at it, so a B machine under an A listing sells at the A price. "Map columns" is likewise not built: the header matcher already accepts serial/serials/serial_no/serial number, and a mapping UI for a one-column file is furniture. |
| T30 | QC visit request, scheduling, results | DONE |  | 114 shots, 19 states x 2 themes, 1440/900/600 | **The vendor's side of an inspection, over routes the QC console does not share.** Archetype B at `/vendor/qc/visits`, C at `/vendor/qc/visits/[id]`, B again at `/vendor/qc/visits/[id]/results`, behind a new `VendorVisitsController` in the `qc` module over a new `VendorVisitRepository` where the caller's org is a `WHERE` clause rather than a parameter. **No new permission and no widened grant**: reading what we found on your own machines is `listing.own.read`, calling off an inspection of your own stock is `listing.own.write` (OWNER/ADMIN/OPS and not FINANCE/VIEWER, which is exactly §3B's "VENDOR_OPS+"). T31's conclusion held — a vendor token still carries no `qc.` permission at all, and `qc-console-is-not-vendor-reachable.spec.ts` passes untouched. 404 and not 403 on a foreign visit, for the reason T17 and T32 give: a 403 confirms the id names a real inspection belonging to somebody, and whose machines we are opening this week is a fact about a competitor. **The missing scheduling route was the reason no visit had ever been booked.** `SchedulingService.schedule()` has always run all six checks, and the only way to reach it was `POST /qc/visits` with a `schedule` block — which also *creates* a visit. So a REQUESTED visit raised by a vendor submitting a listing, the only way a visit is ever raised in production, could not be given a date without inventing a second visit for the same machines. `POST /api/qc/visits/:id/schedule` closes that, and the whole spread below was produced through it rather than seeded: a Sunday is refused ("The site is closed on 2026-09-06"), the seeded holiday is refused by name, one visit went to TECH_ASSIGNED with a technician and one to SCHEDULED with a date and no person. **`qc_visit_unit` had zero rows and all three visits were REQUESTED.** `prisma/seed/qc-visits.ts` gives it the spread a real week produces across two supply points — REQUESTED (one with a manifest, one without, because "the manifest is not prepared yet" is a state that has to render), IN_PROGRESS with three of six machines done, COMPLETED, PARTIALLY_COMPLETED with two machines never produced, and NO_SHOW_VENDOR. **Every outcome is derived, never sprinkled**: from the report's own verdict, from a `grade_correction` that genuinely exists, or from the absence of a report at all. MISMATCH becomes UNTESTABLE (QC-012). The FAIL and the UNTESTABLE are on Faridabad because `qc-spread` deliberately keeps a failed machine off a LISTED unit, so the capture script runs two logins — one that used Northgate alone would never once render either. The six denormalised counters are recomputed from the manifest rather than typed, because a visit header disagreeing with its own table is indistinguishable on screen from an aggregation bug. Every instant comes from the caller's clock; `Date.now()` appears nowhere. **Two seed-honesty defects found by reading the payload rather than the screen.** (1) The first pass put reports completed on 26 Aug onto visits dated 16 and 21 Aug — invisible today because no vendor screen shows both, which is exactly why it would have survived until one did; `alignToEvidence` moves the visit's clock onto its reports and never the reverse, because those reports are read by the buyer's order screens and by every warranty window derived from them. (2) Sorting by serial happened to pick the units whose reports have no `qc_hardware_detected` row, so **every battery read "not measured"** — a monoculture pointing the other way. The sort now prefers a measured battery and deliberately puts **one** unmeasured machine on a finished visit, because a spread with no gap never renders the branch that catches a missing measurement showing as a passing one. The capture script fails the run if that machine is absent. **Three display defects found by looking at the screen.** (1) The board's visit-fee column carried the full explanatory sentence on all seven rows — one paragraph seven times, in a column meant to be scanned; `FeeLine` gained a `brief` form and the reason stays on the record. (2) The NO_SHOW row printed `0 passed · 0 regraded · 0 failed`, which reads as a fully measured result of zero on a visit where nobody opened anything — the same defect as a missing value rendering as a passing one, pointed the other way; it now says "No machine was opened". (3) `repo.createVisit` prices nothing, so an ops-filed visit rendered "Trugrade is bearing the ₹0.00 visit fee". The amount is now named only when there is one, and the three zeros are three different sentences — waived (with what waived it), ours ("this inspection is at our cost"), and unpriced ("Not priced yet"), never a bare ₹0. **§3B's cancellation notice window does not exist in this product**, so the screen says so rather than inventing it. There is no `platform_config` key for one, `advance()` does not touch `visit_fee`, and nothing anywhere charges for a cancellation — the panel states the fee already on the record and that calling it off does not move it. Same treatment as T32's four honestly-unknown values. **Colours.** A visit status is never a verdict: nothing on these screens is `pass` or `fail` at the visit level, PARTIALLY_COMPLETED and the two no-shows are `warn`, everything terminal is neutral. UNTESTABLE is `warn` and says in words that it is not a failure. Grades neutral on both the declared and the inspected side. The cancel action is `secondary` and not `danger`, because `--fail` means FAIL two columns away. **Eleven integration tests, four of which attempt the forbidden thing** — open a neighbour's visit by its real id, cancel it by its real id, sweep the payload for their serials, and call the routes with no org at all — each reading the neighbour's row back to prove nothing half-applied, plus the control case that the neighbour can still open their own. Mutation-checked: replacing the org predicate with `TRUE OR ...` fails four of them. **Eighteen component tests** for the claims an integration test cannot see: a visit nobody attended renders no score/grade/seal and no zero, UNTESTABLE reads `warn` while a real FAIL still reads `fail`, a no-show prints no zero breakdown, grades carry no verdict class, and each of the three zero-fee sentences. Mutation-checked: flipping UNTESTABLE to `fail` fails two. The cancel flow was also driven end to end over real HTTP — ops file a visit, the vendor reads it, a two-word reason is refused with its own message, the cancellation lands, and the neighbour gets a 404. **`vendor.facility_hours` had zero rows on ten facilities** — the same shape of gap T27 found in `vendor_facility` itself. `assertSiteOpen` reads a missing calendar as "no constraint recorded", so nothing was failing, but §3B says the screen states a closed day cannot be booked and a screen cannot state a rule with no data behind it. Mon–Sat 09:00–18:00, Sunday shut, plus a holiday and three weeks of offered technician slots so the real scheduling path is reachable at all. **Not built:** confirming a proposed slot and proposing an alternative (§3B). `qc_visit` has one `scheduled_date` and no notion of a *proposed* slot awaiting acceptance, and no accept-by deadline column — building it would be schema, not a screen, and the vendor would be accepting something the database cannot represent as unaccepted. The pre-visit checklist is printed on the record rather than downloaded: it is fixed content, not data, and a PDF endpoint for five sentences is a service to keep correct. Adding units to a pending request is not built either — `addManifest` exists on the console service, but which units may join a request is a listing-status question the vendor's own listing board already answers, and no route exposes it to a tenant. **No ops screen calls the new scheduling route yet.** `POST /api/qc/visits/:id/schedule` is reachable and was driven end to end from a script, but `apps/console/src/routes/qc/VisitDetail.tsx` has no reschedule control on it — this task owns the vendor's side and the ops console screens already existed, so adding one is a change to somebody else's screen made on the way past. **Reported, not fixed.** (a) `SealChip` paints `APPLIED` green (`pass`), so a seal renders in a verdict colour on a row whose verdict is FAIL — the shared component is not this task's to edit. (b) That row exists because `qc-spread.ts` flips a report to FAIL and leaves `qc_seal.status = APPLIED`; a failed machine is never sealed, and the vendor's results board is the first screen to draw both facts side by side. Changing it ripples into T21/T23/T24's screens, so it is logged rather than touched. (c) The ops `VisitDetail` carries no `facilityId`/`addressId`, so the console cannot reschedule a visit to another site. (d) `pnpm test` failed once with a React unmount race in `wizard.spec.tsx` under turbo's parallel load; it passes standalone (152/152) and under turbo alone, and is unrelated to this task. (e) Running Prettier over `qc.controller.ts` and `qc/dto/qc.dto.ts` reformatted pre-existing code that had never been formatted, which inflates the diff on both by about seventy lines of pure whitespace; both files are inside this lane's agreed split, so the churn cannot collide with the other session. |
| T31 | Grade-correction response | DONE |  | 72 shots, 12 states x 2 themes, 1440/900/600 | **Closes the reachability gap this ledger logged: `GradeCorrectionService.respond()` was exposed by no controller**, so `listing.grade_correction.respond` was granted to three vendor roles and guarded nothing and every correction reached its deadline and auto-applied. New archetype B at `/vendor/corrections` and archetype C at `/vendor/corrections/[id]`, over a new **org-scoped** route pair — `GET/POST /api/vendor/grade-corrections[/:id][/respond]` in a `VendorCorrectionsController` that lives in the `qc` module (the service is internal to it; exporting it through the barrel to reach a controller would make the correction lifecycle another module's to call) and reads through a new `VendorCorrectionRepository` where the caller's org is a predicate, not a parameter. **No new permission.** The task offered `qc.report.read_own`; it was not needed and would have been wrong — reading corrections on your own machines is `listing.own.read`, answering one is `listing.grade_correction.respond`, and `qc-console-is-not-vendor-reachable.spec.ts` requires a vendor token to carry no `qc.` permission at all. The console's cross-vendor `correctionQueue()` is untouched and still unreachable by any vendor. **Ownership is `listing.unit.vendor_org_id`, not `listing.listing`** — `grade_correction.listing_id` is nullable, and an owner derived from a nullable column leaves rows with no owner. **Disputing is exactly as easy as accepting**: four peer radio options in the domain's own order, each printing its consequence, nothing pre-selected, one primary action. An elapsed window is `warn` and says "you can still answer", which is the truth — `respond()` refuses only a SETTLED correction, and all nine seeded corrections are ~77 hours into a 48-hour window because the auto-apply job has never run here. The dashboard queue now links to `/vendor/corrections` instead of `/vendor/listings?corrected=1`: that board is real and stays, but nothing on it could answer anything, so a queue headed "awaiting your answer" landed you where you could not give one. **All three surfaces read one predicate** and the capture script asserts it live, before and after two real answers made through the product (dashboard count = corrections board = `?corrected=1` listings). Eight integration tests: four prove each answer lands with its consequence (grade written, ask written, `qc_reverification` opened on a dispute, second answer refused), three attempt the forbidden thing — answering, then reading, a neighbour's correction, then calling it with no org — and read the neighbour's row back to prove nothing moved, plus the control case that the owner and the neighbour can each still answer their own. Mutation-checked: replacing the org predicate with `TRUE OR ...` fails two of them. **Not done:** `price_suggested` is on the table, is never written by anything, and is therefore not on the wire — no seeded correction carries a `price_before` either, so every capture shows the honest "No amount" rather than a rupee figure. The vendor listings board still has no per-row link into a correction (the listing payload carries no correction id); the corrections board and the nav entry are the way in. **Follow-up, done in the T29 pass:** `Corrections.spec.tsx`, seven tests for the four claims an integration test cannot see — nothing pre-selected and the four answers peers, an elapsed window rendered `warn` and never as expired or failed, "No amount" where `price_before` is null, and a neighbour's correction rendered as a refusal rather than a spinner. |
| T32 | Purchase orders - serials, seal codes, pick list | DONE |  | 66 shots, 11 states x 2 themes, 1440/900/600 | **`procurement`'s first internals and first routes.** The readiness table read "procurement 0/0" and the natural conclusion — that these screens need a module built first — is wrong: `ordering`'s `order-transaction.service.ts` has been writing `purchase_order`, `purchase_order_line`, `vendor_payable` and `tds_ledger` inside the order transaction since Phase 6, so 17 POs and 28 lines were already there and this was a read task. New `PurchaseOrderRepository` (org predicate in the `WHERE`, no method takes a vendor id), `PurchaseOrderService` (the views and the acknowledgement), `ProcurementController` at `/api/vendor/purchase-orders` with list / status-counts / detail / pick-list / acknowledge. Archetype B at `/vendor/orders`, C at `/vendor/orders/[poId]`, F at `/vendor/orders/[poId]/pick-list`. **No new permission and no widened grant**: `procurement.po.read_own` guards the three reads (all five vendor roles hold it), `procurement.po.acknowledge` guards the write (OWNER/ADMIN/OPS but not FINANCE or VIEWER, and the record screen disables Accept with that reason rather than hiding the page). **Anonymity is enforced in the direction this repo had not tested.** Every other anonymity test keeps a vendor off a buyer's screen; a PO is joined to `ordering."order"` by a foreign key and is where the reverse leak lives. Nothing is spread from a row; the buyer's **order number is deliberately absent** even though it is one join away, because order numbers are sequential and two of a vendor's own POs a fortnight apart would let them subtract the platform's order volume out of the difference. `purchase-order-is-not-a-buyer-oracle.spec.ts` seeds a buyer whose legal name, GSTIN, contact, mobile, address label and delivery instruction are all distinctive strings and sweeps the serialised payload of all three routes for every one of them; the capture script does the same live against the seeded database, before and after two real acceptances, using the buyer strings read out of Postgres rather than a constant. The cross-tenant tests attempt the forbidden thing rather than inspecting a guard: they open the neighbour's PO by its real id on all three routes, demand the refusal, and read the row back to prove nothing half-applied. **404 and not 403** on a foreign PO, for the reason T17 gives about order numbers — a 403 confirms the row exists, and which vendor a purchase went to is exactly what is not disclosed. **The pick list is a separate route, not a flag**, because it is the point at which the delivery address is released ("the goods must physically travel"); `PickList` and `PurchaseOrderLine` are separate server types so that **no money can reach the packing list at any depth** — s.10(1)(b) IGST Bill-To-Ship-To — and a test asserts the amount appears on the record and not on the document. Six address columns chosen one at a time: `contact_name`, `contact_mobile`, `delivery_instructions` and `label` are on the same row and every one names the customer. **No barcode on the pick list**: `Barcode` in `@trugrade/ui` is placeholder geometry, this ledger says so, and a bar pattern beside a real seal code invites somebody to scan a thing that decodes to nothing. Serials and seal codes are mono, `tabular-nums`, `tracking-[0.08em]` and 52px rows, because they are compared to a sticker by a person holding a laptop. **TDS is read, never recomputed** — `computeTds` ran once inside the raising transaction against that day's cumulative purchases and that day's config, and a second implementation is a second answer; the rate carries its denominator (`0% — ₹0.00 of ₹92,020.00`) and the reason lives on the payables screen where the stack is. **Four values that are honestly unknown, and none renders as a passing one**: `acknowledgeBy` is always null because there is no acceptance window in `platform_config` and no penalty rule behind one, so the panel says "no acceptance deadline has been set" rather than inventing 24 hours (§3B.3 asks for the deadline and the penalty; both are missing from the product, not from the screen); `expected_dispatch_at` is null on every PO ever raised; the pick list's carrier reference says "not assigned yet" because `logistics.shipment` has no writer and zero rows; a PO whose order address cannot be resolved reads "Destination unresolved — do not dispatch". **Three defects found by looking at the screen rather than the response.** (1) `Board`'s `[&_table]:min-w-[940px]` — the reference's figure, right for a full-width board — clipped the last two columns of the PO's line table inside an archetype-C evidence column, so the vendor's payout was invisible at rest; `Board` gained `tableMinWidth` and the record passes 620. (2) `Button` defaults to `variant: 'secondary'`, so both screens' primary action shipped grey until it was asked for by name. (3) The "no acceptance deadline" footnote rendered under an order already accepted, which is noise on the one panel that must stay scannable. **Not built:** `/vendor/orders/[poId]/handover` (§3B.3) — it writes `logistics.pickup_task` and a rider OTP against a module with two internals and no routes, and per-unit outcomes (produced / seal broken / cannot find / already sold elsewhere) need a penalty and a re-allocation path that nothing owns yet. `/vendor/invoices` likewise: `procurement.vendor_invoice` and `goods_receipt` both have zero rows and no writer, so the three-way match a vendor invoice is validated against does not exist to fail. |
| T33 | Payables and payout statement | DONE |  | 30 shots, 5 states x 2 themes, 1440/900/600 | Archetype B at `/vendor/payables`, over a new `PayableRepository` / `PayableService` / `PayablesController` (`GET /api/vendor/payables`). **The hard part was the half with no data behind it.** `procurement.payout_run` and `payout_line` are empty with no writer, and nothing sets `vendor_payable.eligible_at` — so the screen says both in as many words rather than filling the slot. **No expected-payment date is derived from `procurement.default_payout_cycle`**, and there is no field on any type in the API or the console that could carry one: an integration test enumerates the row's keys and fails on `expectedPaymentOn`/`expectedOn`/`payoutDate`/`payoutOn`, and the capture script greps the live response for the string `T_PLUS_2` before it believes a frame. That figure is one a vendor plans cash against; inventing it is the missing-value rule with money behind it. `eligibleAt` (the record) is carried **beside** `inspectionWindowClosesAt` (the rule) rather than merged with it, because "we have recorded this as payable" and "it becomes payable on the 3rd" are different claims and only one is true. **The one real clock is MSME.** A Udyam number on `vendor.vendor_profile` makes a supplier an MSME and s.15 MSMED Act 2006 binds us to `msme.max_payment_days` from acceptance, with s.16 compound interest at 3× the RBI bank rate on delay — an obligation, not a cycle, so it is the one date the screen puts a number on. Keyed off the registration actually being there AND the period actually being configured; either missing falls back to the purchase order's own `terms_days`, and both arms are asserted against the same delivery so the difference cannot come from anywhere else. **Delivery is real now**: the other lane's `ordering.sub_order.delivered_at` (T23/T24) is what the 48-hour window runs from, so `Delivered 28 Jul 2025 · payable since 28 Jul 2025, 7:25 pm · no payout run has been executed` is a sentence about actual rows, and one seeded payable is genuinely **past our own payment terms** and says so. Every clock comparison is made against the injected server clock, not the browser — the correction-window precedent, and a payable is a money deadline. **TDS is read, never recomputed**: the amount is the sum of `vendor_payable.tds` (what `computeTds` produced inside each raising transaction); `computeTds` is called once more for its `reason` only — a statement about the year's position, not a second amount. The rate carries its denominator and is the rate that *would* apply above the threshold, never ₹0 ÷ gross, which would tell a vendor the rate is zero when it is the threshold that has not been crossed. **The deduction stack shows every line including the four that are ₹0**, each with why: below the ₹50 lakh threshold, no penalty charged, inspections borne by us. Net comes from the server, where `chk_payable_arithmetic` (`net_payable = gross - tds - penalties - qc_fee`) guarantees it at the database rather than a component guaranteeing it in the browser. **Two seed gaps found and fixed.** (1) `vendor.vendor_profile` had **zero rows for every vendor on the platform** — `vendor/internal/promotion.service.ts` writes it on the real onboarding path and `demo.ts` builds its vendors directly, so the MSME clock, the settlement cycle and the DeviceSure licence state were three behaviours no demo account could reach; one row per demo vendor now, with Faridabad carrying `UDYAM-HR-05-0042317` so both branches are photographable. (2) **`msme.max_payment_days` is in the baseline migration and was missing from `seedConfig`** — the same shape as T28's `qc.visit_fee_waived_above`, and not a display bug: a database built from the seed alone silently paid an MSME on 15-day PO terms instead of the statutory 45, which is a real liability under s.16. Eleven integration tests; the neighbour is seeded with strictly more of everything and two of them attack with real ids — `deliveriesFor` is handed the neighbour's own `sub_order` order ids and must come back empty (then the row is read back to prove it is still there for its owner), and the year-to-date TDS position is summed from `tds_ledger` rows worth ₹90 lakh belonging to somebody else, which if leaked would not merely show a wrong number but flip the rate a real deduction is struck at. Mutation-checked: `TRUE OR vendor_org_id = …` in `deliveriesFor` fails exactly that test. **Not built:** `/vendor/payouts` and `/vendor/payouts/[id]` — a board and a statement detail over two tables with no writer would be a route pair whose only reachable state is "nothing yet"; what §3B.4 asks the statement to *say* is served from the payables that exist. `/vendor/penalties` and `/vendor/ledger` are blocked the same way (`payment.penalty` and `payment.ledger_entry` are empty, no writer). |
| T34 | Ops dashboard | DONE |  | 36 shots, 6 states x 2 themes, 1440/900/600 | **Archetype E at `/overview`, and the whole task was deciding what NOT to put on it.** New `OpsController` at `GET /api/ops/dashboard`, in `identity` for the reason `VendorController.dashboard` gives: the dashboard is an aggregate over seven module schemas that no domain owns, written as separate statements one module schema each and combined in TypeScript, because `no-cross-schema-join` forbids the join that would be shorter and is right to. **§3C.1 asks for eleven tiles and four of them have no source in this product**: `logistics.shipment` has no writer, `platform.return_request` and `payment.payment` are empty, `qc.qc_mismatch` is empty. They are returned in a `gaps` array **by name with the reason** and printed at the bottom under “Not on this screen, and why”, because a zero there reads as “nothing is wrong” — the same defect as a missing value rendering as a passing one, pointed at an operational risk. Six metrics survived, every one out of a row: 15 of 18 applications past our own promise, 2 orders held for a buyer's approver, 15 purchase orders unacknowledged, **0 payout runs ever executed** with 17 payables accrued behind it, 11 support tickets, and the **partition runway** — 183 days, from `ops.v_partition_runway`, which §3C.1 puts here deliberately because schema gap #1 is an operational risk and not a runbook footnote. **Four queues, and a queue exists only where a board answers it.** T26's ledger entry settled that (“a number with no board beats a link to the wrong one”), so purchase orders, order approvals, payables and tickets are KPI counts rather than queues — their boards are T39's, and a tile linking to a route that 403s or does not exist is worse than no tile. **Onboarding is two queues and not one**, because a vendor is owed 48 working hours and a buyer 24: `QueueItem` carries one `slaHours`, so a single queue would either state one number over both — exactly the defect T36 found on the review board — or drop the promise entirely and throw away the only real SLA on the screen. **`slaHours` and `breachedCount` are null where there is no promise, never zero.** The inspection queue has neither: nothing in `platform_config` commits us to a date by which a declared machine is inspected, so it renders “Breaches not measured” rather than the reassuring “Within SLA”, and the page header says out loud how many of the queues carry no promise — a workspace that looks green because half of it is untimed is the same defect one level up. **Every slice is gated on the permission the board behind it checks.** §3C.1's “others see their slice” is a permission question, and the answer is six `if (can(...))` blocks: a KYC_REVIEWER gets the two application queues and no purchase orders, a RIDER gets the platform-wide runway and the sentence explaining why there are no queues, an OPS_MANAGER gets all of it. Photographed as three real sign-ins, not three fixtures. **The route is guarded on `orgType`, not on a permission.** There is no string that means “you work here”, and gating the whole screen on `identity.audit.read` — the tempting choice — would hide it from a QC_MANAGER and a FINANCE who each have a real slice on it. `RequirePlatform` in the console and `requirePlatform()` on the server, because a client-side check is a convenience and never the boundary. A vendor gets 403 rather than an empty 200: an empty screen is not an answer to a question that has none. **`NavEntry.permission` is now optional**, for this one entry and documented as such; `/overview` is **first** in `NAV`, so `Landing` puts every member of platform staff on the day's exceptions. **The clock.** Both breach counts are measured against `ClockPort`, passed into the SQL as a parameter rather than using the database's `now()`. T25's defect was exactly that shape — an approval SLA measured against two clocks, reporting 22 hours where it should have reported 24 — and here it would make the dashboard and the board it links to disagree by the app/DB skew. An integration test asserts the two counts are equal, which is the invariant rather than a restatement of the query. **Nine integration tests**, three of which attempt the forbidden thing (a vendor on the route, a reviewer's payload swept for procurement keys, a rider's swept for queues) each with its control case, plus the two-clock invariant and the never-submitted application that must be absent from both screens. Mutation-checked: `true || can('procurement.po.read_any')` fails two of them. **Ten component tests** for the claims an integration test cannot see — a null breach count renders “Breaches not measured” and never “Within SLA”, no borrowed SLA clause appears on an untimed queue, a null metric renders “Not measured” and a *meaningful* zero renders as 0 with what is stuck behind it, and the gaps are named rather than counted. **The capture run asserts the payload before it believes a frame**: it fails unless at least one queue has a real promise AND at least one has none, because that contrast is the screen's whole claim and a database where every queue happened to have an SLA would photograph as if the rule were not there. It also fails if the reviewer's slice contains a key only the ops manager should have. **Reported, not fixed: `QueueList` in `packages/ui` paints a breached queue with `--fail`** — a red left-edge rule and red “9 past SLA” against a row labelled “Buyer applications”. Red is PASS/FAIL only, an SLA we broke is not a verdict on the applicant, and T28 reached exactly this conclusion on `ReviewQueue` and moved it to `warn`. The shared component is not this task's to edit, so it is logged: **the recommendation is `--warn` for the rule and the count, unchanged wording.** **Not built:** the tiles behind `logistics`, `platform.return_request`, `payment.payment` and `qc.qc_mismatch` (no writer or no rows — named on screen instead); the per-tile error state §3C.1 asks for, because the payload is one request and a partial failure would mean six, which is six ways for one screen to be half-loaded; and any “this period” selector — every number here is a live count of open work, and a date range over a queue of exceptions is a report, not a workspace. |
| T35 | Global search + Unit 360 | DONE |  | 78 shots: 12 states x 2 themes x 1440/900/600, plus loading and error (dark only) | **Component 25 (the Ctrl+K palette) in the console chrome, archetype C at `/units/[serial]`.** Both routes are new on `identity`'s `ops` prefix, in a new `ConsoleController` — the third aggregate that lands there for `OpsController`'s stated reason: a palette searches five schemas by definition and a serial's life spans six, and no domain owns either combination. One statement per module schema, assembled in TypeScript; `no-cross-schema-join` not disabled anywhere. **Findings.** (1) `identity.audit_log` holds 1,653 rows and **not one names a unit** — the brief expected it to be a serial's evidence trail and it is not; a serial's real trail is `listing.stock_movement` (217 rows). The screen prints the zero with the reason rather than an empty table that reads as a clean history, and the capture script asserts the zero before photographing the sentence. (2) The archetype-C grid had **no `min-w-0` on the evidence column**, so the PAGE scrolled sideways at 600px under a footer that stopped at the viewport edge — measured at 816px inside a 600px viewport. Fixed here and in T39's `OrderRecord.tsx`, which had the same latent defect at 736px. (3) The 360 is **two halves on two permissions**: `listing.any.read` opens the machine (TECHNICIAN and CATALOG_ADMIN hold it), `ordering.any.read` is needed for the trade, and the absence is a sentence rather than a blank panel. **The palette does NOT replace T39's order-board search** — that filters a paginated board with facets and a shareable URL, this navigates; both kept. **Tickets are deliberately not searched**: `/admin/support` does not exist, so every hit would open nothing, and the palette names the gap. No single term on this database reaches all four groups (serials, order numbers, PO numbers and legal names share no substring), so three real terms are captured instead of one seeded to suit a screenshot. New: `console-search-and-unit-360.spec.ts` (16 tests, every refusal paired with a control; the append-only probe inserts a row first because `UPDATE ... WHERE true` on a truncated table fires no ROW trigger and passed vacuously). `qc-console-is-not-vendor-reachable.spec.ts` re-run green. |
| T36 | Onboarding review queue | DONE |  | 84 shots, 14 states x 2 themes, 1440/900/600 | **A design and completeness pass that turned into a permission split.** Archetype B at `/kyc`, C at `/kyc/:orgId`. **The record screen showed none of the evidence a review is made from** - four commercial captures and nothing else: no documents, no verification checks, no SLA, and no sight of the decision already recorded. `GET /kyc/review/:orgId` now carries the checks, the clock and the last decision; the documents are a **separate route** at `GET /kyc/orgs/:orgId/documents` gated on `kyc.document.read`. That separation is the point: OPS_MANAGER holds `kyc.application.read` and not `kyc.document.read`, and folding the documents onto the payload the screen already fetches would have widened the second grant to everybody holding the first with nothing looking wrong - the guard would still read `kyc.application.read` and the response would just carry more. `onboarding-review-surface.spec.ts` makes the request rather than inspecting the grant, and reads the neighbouring control case back (OPS_MANAGER still gets the application, a KYC reviewer still gets the documents). Mutation-checked: widening the route's permission fails exactly that test. The screen renders the 403 as “you are not cleared for this applicant's documents” rather than a blank panel, which would read as “they sent nothing” - the missing-value rule pointed at a person. **`PROVIDER_ERROR` is not `FAIL`, and `groupChecks` is where that is enforced.** A check type's verdict is the latest run that actually said something about the applicant; provider failures are excluded from the verdict, from the consumed-attempt count and from the “outstanding before approval” list, and are stated in their own sentence as ours - *“those are ours: they retried automatically and consumed none of the applicant's 5 attempts a day.”* MISMATCH is `warn` and says in words that it is a difference for a person to judge, not a failure. A check with no rows at all reads “Not run”, never a tick. Nineteen component tests; mutation-checked by flipping `PROVIDER_ERROR` to `fail` / `ours: false`, which fails three of them. **The board stated the wrong promise on half its rows.** `REVIEW_SLA_HOURS` gives a vendor 48 hours and a buyer 24, and the header said “past the 48-hour promise” over both - a day more than a buyer was ever owed, on the one screen whose job is to be honest about a promise. `slaHours` is now on the wire per row and the clause is dropped rather than defaulted where an org type carries none. `hoursRemaining` is computed on the server clock on **both** routes (one `hoursToSla`, not two), because the console's own lint rule forbids `Date.now()` for exactly this reason. **A breach is ours and never a verdict.** T28 fixed the red chip here; this pass found the sequel - a warn `StatusPill` on every breached row is fifteen outlined amber chips down one column, which is the decorative wash that stops amber meaning anything. The amber is now on the *number* (a measured value, one of the three sanctioned uses) and the meaning is in the words: `64 h past of 24`. INFO_REQUESTED is neutral, not warn: waiting on the applicant is a normal place to be. **Document decisions are now possible at all** - 85 documents existed and no route could accept or reject one, so §3C.1's primary action had never been buildable. `DocumentService.review()` plus `POST /kyc/orgs/:orgId/documents/:id/review`, gated on `kyc.application.review` AND `kyc.document.read` (settling a file you may not look at is not a decision anybody should be able to make). A rejection **requires** a code from a served controlled list and a free-text specific of at least ten characters, and the applicant reads the two as one paragraph - *“This document is older than we can accept. Your electricity bill is dated January 2026; we need one issued in the last three months.”* The modal shows that sentence back before it is sent, and `register/DocumentChecklist.tsx` already renders `rejectionReason` verbatim, so the loop closes on the applicant's own screen. **Twelve of the eighteen rows in the queue had never been submitted.** `submitForReview` writes the status and the instant in one update, so a row with the status and no instant cannot have come through the product; they were residue from abandoned capture runs, and they sorted *above* every real application because their invented SLA was the most overdue. `submitted_for_review_at: { not: null }` is now a predicate. **The seed had no spread and every branch was unphotographable**: no application inside its promise, no MISMATCH or FAIL anywhere, no rejected document, no INFO_REQUESTED, no recorded rejection. `prisma/seed/kyc-review.ts` writes five applications off the caller's clock with the SLA *derived* from the submission instant, including one carrying two `PROVIDER_ERROR` rows followed by a `PASS` at the **same `attempt_no`** - because an automatic retry consumes nothing, and a seed that advanced it would teach the screen the opposite of the rule it exists for. One document is deliberately unscanned so “Not scanned” renders beside files that were. **`ops@trugrade.in` (OPS_MANAGER) added to the demo seed**, the T33 precedent: it is the only role holding the queue permission without the document one, so without it the refusal branch could only be photographed by faking a 403. OPS_MANAGER is in `MFA_REQUIRED_ROLES`, so the capture script walks the real OTP off the dev response. The capture run **asserts the live payload before it believes a frame** - both promises present, a row past, a row inside twelve hours, a row comfortably inside, a real PROVIDER_ERROR, a real MISMATCH, a real rejected document, a real unscanned one - and fails rather than photographing a stale API build. **Not built, and why.** §3C.1's *claim* lock (a 30-minute Redis lock naming the holder) - nothing in the schema records a claim, and a lock with no row behind it is invisible to the second reviewer the moment their tab reloads. The **override with written justification** that §3C.1 makes a precondition of approval: no table records one, so enforcing the rule would leave every application with a single name mismatch permanently un-approvable with no way through; the screen names what is outstanding above the button and says plainly that nothing blocks it and the audit log carries the reviewer's name. `DocumentViewer` is not wired - `GET /onboarding/documents/:id/url` is the applicant's own route and presigns from their org, and a reviewer-side presign is an object-store decision (watermarking, access logging, TTL) rather than a screen. `/admin/onboarding/kyc-checks` and `/admin/blacklist` are separate spec rows and separate screens. **Reported, not fixed:** (a) the console has no client-side token refresh, so any capture run longer than an access token renders “did not load” on a healthy screen - the script re-signs-in once and says so; (b) the login limiter trips at eight sign-ins, which a full capture run plus two manual curls reaches; (c) `QueueList` in `packages/ui` navigates with a bare `<a href>`, so every queue tile is a full page reload in an SPA - shared component, not mine to edit. |
| T37 | Catalog and condition-image library | DONE |  | 135 shots, 24 states x 2 themes, 1440/900/600 | A design and completeness pass over four working screens, plus the one route that was serving a library nobody could see. **The buyer's half of the image pipeline was still switched off.** `apps/storefront/.../laptops/[slug]` rendered a hard-coded `RepresentativeImage` with `match="PLACEHOLDER"`, on the grounds — written in a comment in the file — that "nothing serves an S3 key to a browser and the dev bucket holds zero objects". Both halves stopped being true when the image pipeline landed: `catalog` swaps the key for an AES-GCM object token, `GET /api/objects/:token` serves the bytes, and the store holds 7,496 objects against 608 catalogued rows. So the product page was showing "we have not photographed this grade" over a working library. The gallery now renders the resolved set, every frame through `RepresentativeImage` so the caption cannot be dropped, and the footnote keys off `match` rather than `isGeneric` — MODEL means another machine of the same model, SERIES means a different model, and calling both "this range" under-states the second. Verified live: 7 photographs, all decoding, all off `/api/objects/`. **The vendor-readable read route already existed and nothing used it.** T27 logged that a vendor choosing a grade could not see the reference photographs, and the fix is not a new route: `GET /catalog/skus/:id?grade=` is `@Public()` and resolves the same gallery the product page gets, because no vendor role holds any `catalog.*` permission and the catalogue is reference data vendors read and never write. Wizard step 2 now shows it — the literal frames a buyer will see beside their machine, with the match level stated in words, so "worse than this and it is a B" is a comparison against something. `condition-images-are-vendor-readable.spec.ts` makes both calls with a real vendor token: the SKU route must answer with the resolved set, and the coverage grid must refuse — each refusal paired with the same call under a CATALOG_ADMIN token, so a route broken for everybody cannot pass as a route properly guarded. The key-leak assertion is mutation-checked: adding `s3Key` back to the public payload fails it and nothing else. **`GET /catalog/condition-images/coverage` now mints an object token per frame** (300 s, §3C's admin TTL, not the buyer's 900), which is what the `ponytail:` comment on `FrameList` named as the unblock. The panel shows thumbnails beside the reorder and retire controls, and a **Preview as a buyer** rendering per grade through the real component with `match` taken from the frame's own anchor. `s3Key` is kept on that payload deliberately — it is the write surface, the operator's own upload produced the key, and `isPublishable` takes a whole `ConditionImage`. **A coverage gap is not a verdict.** The gap slot was `--fail` and the gap count a red pill, which is the misuse T28's sweep found eight of elsewhere: a photograph nobody has taken is work outstanding, not a FAIL. Gaps are now neutral ink on a dashed border, loud by weight rather than by colour, and the glyph still carries it. `Publishable / Cannot publish` and the blocked-grade count keep their green and red, as T28 deliberately decided — that one is a genuine binary gate. **The gap state was unreachable and is now real**: every model had a complete set, so the capture retires one frame through the console's own form with a real reason, and the grid reads `1 of 32 models have gaps - 1 empty slot - 1 grade cannot be published`, with `Grade A_PLUS is missing LID_TOP` and `No primary image chosen` as the two consequences. The row survives, which is the point of retiring rather than deleting. **`catalog.sku_request` had never held a row**, so the empty state was the deliverable — and the old copy said "every vendor request has been decided", a sentence about a history that does not exist. It now says what a request is, the exact place in the wizard that creates one, the three answers, and that an empty queue means no vendor has hit an uncatalogued machine rather than that requests are handled elsewhere. The populated queue is photographed against a **real request raised through `/vendor/sku-request` as a real supplier** (Mayapuri, Dell Latitude 7440 Ultralight), with real 48% near-match scores; it is left PENDING in the dev database so the state stays reachable. **`CatalogTree`'s empty state linked to `/catalog/brands/new`, which has no `<Route>` and no endpoint behind it.** There is no brand-create anywhere: the SKU importer writes `catalog.brand`, `series` and `model` on its way to a SKU. The guidance names the importer instead, and the test asserts the ABSENCE as well — guidance naming a screen that does not exist is worse than none, because the person following it concludes the console is broken. **New archetype C at `/catalog/skus/:id`** (§3C.2), reached from the SKU code on the tree rather than from a separate row action — fifty rows x one amber link is fifty amber controls on a screen entitled to one, so the code is the link and it is `--ink`. Grade tabs in the URL, the resolved gallery for the selected grade, the typed specification, and a side panel that says plainly what cannot be edited here and why. It does NOT show live listings or price history: `listing.listing` has no by-SKU count on its barrel (the tree reads it with its own single-schema query and that stays there), and **there is no `price_book` table in the schema at all**, which §3C.2 and §3C's pricing row both assume. **Not done, and reported rather than worked around:** a one-caption `ConditionGallery` belongs in `packages/ui` — six frames means six identical captions today, which the storefront's own comment calls out as "the same sentence six times" — but adding a second `<img>`-bearing file there fails `no-bare-listing-image.spec.ts` unless its exemption list is extended, and that package is not this lane's to edit. The SKU record has no spec-edit route because no endpoint exists (§3C.2 wants a justification and a vendor notification behind it). `/admin/listings` and `/admin/pricing/history` were not touched. **Flagged:** `ObjectsController`'s rate limit is 240 fetches per five minutes per IP, and one open coverage panel is ~22 thumbnails while the SKU record is 7 per grade — ten models in five minutes is at the ceiling, and the capture run hit it. Nobody has decided that number against an admin screen that shows a whole model's library. |
| T38 | Margin rules and price books | DONE |  | 36 shots, 6 states x 2 themes, 1440/900/600 | **Margin rules built properly; price books deliberately not built, and the screen says why.** `procurement.price_book` is not in the schema — no table, no migration, no writer, nothing that would consume one — while `03_UX_SPEC` §3C.2 names it in two rows. It was not invented, and the choice was made with the schema open: the two guardrails a price book would carry already have implementations, and neither is a book. The floor is the rule's own `floor_margin_pct` against `minimumSellingPrice`'s ₹500 absolute; the market band is a rolling 30-day `percentile_disc` median of live listings for the same (SKU, grade) against `price.guardrail_lower_multiple`. A real price book would be a table, an exclusion constraint (§3C.2 asks overlapping ranges be REJECTED, mirroring `listing_tier_price`), a writer, admin CRUD **and** enforcement inside `PricingService` — and without that last part it is decoration, which is the exact failure mode `reserve_pct_by_grade` already demonstrates. That is not one migration. The screen states the absence and the API proves it with `to_regclass` rather than a constant, so the day somebody adds the table the claim stops being made. **Archetype B at `/pricing/rules`, read-only, over one new route** — `GET /api/admin/pricing/margin-rules`. **It lives in `listing`, not `procurement`**, and that is the load-bearing decision: `MarginRuleRepository` is the RESOLVER and the only implementation of “which rule wins” anywhere, so an admin read in the module that owns the schema would have been a second answer to the one question this screen exists to settle. **Guarded on `listing.price.override`** — a write permission guarding a read, deliberately: §3C.2 gives the screen to ADMIN_PRICING and ADMIN_SUPER, and that grant is held by exactly PRICING_ADMIN and PLATFORM_SUPERADMIN, while the tempting `listing.any.read` also reaches OPS_MANAGER, QC_MANAGER, CATALOG_ADMIN and TECHNICIAN. No permission was invented. **The overlap case, which is the point.** Rules resolve first-match-wins by `(priority, created_at, id)`, so collision is normal: the seeded ₹0–₹25,000 band at priority 5 and the Grade B rule at priority 10 both match a Grade B machine at ₹20,000, and until today nothing said which applied. `margin-rule-overlap.ts` is pure, has 14 unit tests, and answers two things — which pairs collide and who wins (exact: four independent dimensions, half-open money and date intervals, an inactive rule collides with nothing), and whether a rule is unreachable (**deliberately conservative** — a sufficient condition per grade, not a set cover, because a false “reachable” leaves an unused rule on screen while a false “unreachable” tells ops a live rule is dead). It correctly reports the seeded catch-all at priority 100 as never reachable, which the seed's own comment claims and nothing checked. Precedence travels in the row cell and not only in the row ORDER, because a board somebody re-sorts by margin would otherwise start lying silently. **`margin-rules-precedence.spec.ts` is the test that matters and it does not check agreement in the abstract**: it seeds the collision, reads the screen, then prices a real listing through `PricingService` and demands `outcome.marginRuleId` is the rule the screen named — plus that the 20% target was the one applied, and that `listing.unit.margin_rule_id` carries it. Then it switches the winner off and demands both the screen and the engine move to the loser. Mutation-checked: flipping the comparator in `analyseRules` fails exactly that test and nothing else. Six more attempt the forbidden thing — VENDOR_OWNER, OPS_MANAGER and CATALOG_ADMIN each refused with the control case under PRICING_ADMIN, and an assertion that OPS_MANAGER genuinely holds `listing.any.read` so the refusal is about the narrow guard rather than about a broken route. 13 tests. **Not one rupee is recomputed, and that is stronger than the usual reason.** The per-rule totals are `SUM(unit_price)` and `SUM(vendor_ask_price)` on the LISTED stock each rule resolves — what we actually charge and actually pay. Re-running the pricer would have shown what the rule SAYS, and the gap between that and the row is the only thing on the screen worth looking at: **every rule reports 16.3% of payout while targeting 20/18/15/13%**, because the demo listings were written by the seed at a flat 14%-of-selling-price commission and never went through the engine. The screen surfaced that by itself on its first load. Each rule's target is printed beside what it is achieving so the drift is readable without arithmetic. **Four things nothing consumes, each stated with its evidence rather than asserted.** (1) `reserve_pct_by_grade` is on every rule and is in every price — and it is **per platform-backed MONTH**, not a flat percentage, so a Grade B machine from a vendor offering nothing reserves 4% × 6 = 24% of the payout — while `platform.warranty.reserve_amount` is NULL on all 21 warranty terms (T23's finding, now counted on the response, not claimed in copy). The buyer has paid for a reserve no ledger holds, and the screen says exactly that. (2) `price.guardrail_upper_multiple` is set to 3.0 in the baseline migration and **read by no file in the API** — only the lower side is checked — so it renders as “Set to 3x, and nothing reads it” rather than beside the working one as though they were a pair. (3) `price.rounding_step_inr` is deliberately absent and the pricer treats it as 0; the screen says “Prices are not rounded”, never “0”. (4) `margin_rule.approved_by` is null on every row because nothing writes it. **There is no ceiling column on the table at all** — §3C.2 describes one — so `ceilingMarginPct` is `null` on the wire and “No ceiling” in `--ink-4` on screen, with a test that fails if a 0 ever appears there. **Attribution is stated as what it is.** `listing.unit.margin_rule_id` exists and `PricingService.priceListing` writes it, so the platform CAN say which rule priced a serial — and it is set on 0 of 239 priced machines. So the board's totals are a re-resolution against today's rules and today's date, not history, and the screen says so with both counts rather than presenting the figure as a record. The read is one `resolveFor` per distinct (SKU, grade, payout) combination — 34 today, `ponytail:`-marked with the upgrade path. **A rule change reprices nothing committed**: `unit.purchase_price` is frozen by `trg_lock_purchase_price` the moment a PO names a serial, only LISTED units are counted, and the screen says so in the panel that would otherwise imply otherwise. **Colour**: a target margin is a SETTING and reads as ink; the margin being achieved is a MEASURED value and is the only amber on the board. “In force” went from the amber `info` chip to neutral because five amber chips beside one amber measurement leaves nothing standing out — the exception (not yet in force, switched off) is what wears the outlined `warn`. An unreachable rule is a mistake in the ruleset, not a verdict, so “Never applies” is `warn` and never red. Grades neutral throughout. **One seed gap closed**: `pricing@trugrade.in` (PRICING_ADMIN). `listing.price.override` is held by PRICING_ADMIN and PLATFORM_SUPERADMIN, and the superadmin needs MFA — so this screen was unreachable on the demo database by every account that could sign in, the same shape as T23's missing rider. **One flaky failure fixed on the way**: `wizard.spec.tsx`'s batch-size fixture answered the payout-preview POST with `{}`, and `StepPrice` maps over `preview.deductions` — an unhandled TypeError that vitest reports as a failed FILE whenever the rejection lands inside the run. It made `pnpm test` fail intermittently on the console and had nothing to do with either task. **Not built:** every write §3C.2 asks for — create, edit, schedule, and the simulator. No route in the product mutates `procurement.margin_rule` and nothing writes `approved_by`; a simulator with nothing to save is a calculator, and the read had to exist first, because “which of five overlapping rules decides this” is the question a write screen must answer before it can safely offer an edit. `/admin/pricing/history` and `/admin/listings` were not touched. |
| T39 | Order board and procurement board | DONE |  | 108 shots, 18 states x 2 themes, 1440/900/600 | **Archetype B at `/orders` and `/procurement/pos`, archetype C at `/orders/[orderNumber]` — and the record is the only screen in the product where a buyer and a vendor appear together.** §3C.4 says so in as many words, and the seam is what makes it safe rather than careful: the buyer's own `/account/orders/[orderNumber]` reads `procurement` nowhere at all, the vendor's `/vendor/orders/[poId]` carries no buyer and (T32) not even the buyer's order number, and these three routes are gated on `ordering.any.read` and `procurement.po.read_any` — `*.any.*` permissions that by the convention `roles.ts` documents no tenant role holds or may be given. New `OpsOrderService` in `ordering`, new `OpsPurchaseOrderService` + `OpsProcurementController` in `procurement`; the order routes went onto the existing `OrderingOpsController` and the PO board got its own controller for the reason that one gives about `OrderingController` — `@Controller('vendor/purchase-orders')`'s whole contract is that every route under it is one vendor's own, org-scoped in the repository, and a platform-wide route inside it would make that read of the file wrong. **A separate class rather than a flag on `PurchaseOrderRepository`**: a boolean that turns the org predicate off is one mistyped argument away from a cross-tenant read, sitting inside the file whose documented purpose is that the predicate is always there. **One box over seven identifiers, matched and never parsed.** §3C.4 asks for search by order number, PO number, serial, seal code, GSTIN, buyer name and mobile; they live in four module schemas, so each is resolved inside its own module's schema and handed to `ordering`'s query as an array of ids — `no-cross-schema-join` forbids the join that would be one statement and the assembly is TypeScript's. **A row says why it matched**, with the VALUE and not the field name ("matched on TG-TGD5963139B", not "matched on GSTIN"), because a seal-code search landing on a board with no seal column reads as a mistake; and the board prints what it compared against, so an empty result is not read as an unsupported field. **The margin is refused rather than approximated.** `subtotal - sum(po.total_net)` in integer paise, and `null` with the reason whenever the purchase orders do not cover every allocated machine — which is not hypothetical: TT-26-00007, 00009 and 00011 have six machines each and no purchase order at all, two of them DELIVERED, so this platform has delivered machines with no record of what it paid for them. A margin over partial cover looks exactly like a correct one. Same rule on the board: an order that raised none renders "None raised" in `--ink-4`, never a `0` in a numeric column. **The two dead tiles on T34's dashboard now lead somewhere.** `order-approvals` → `/orders?approval=pending` and `po-unacknowledged` → `/procurement/pos?status=RAISED`, and the link is the SAME predicate the count is — `?approval=pending` filters on the `order_approval` row rather than the order's status, so a tile saying "2 waiting" cannot land on a board of nine (T28's drift, avoided rather than repeated). The capture run refuses to photograph a database where the tile's number and the board's total disagree. Payables and tickets stay hrefless: their boards are T40's and T41's. **A link the caller cannot open is not a link.** The purchase-order count on a row and the PO number on the record are gated on `procurement.po.read_any` — SUPPORT, whose board §3C.4 says this is, does not hold it — so they are links for an ops manager and plain numbers for support. The count itself stays, because it is a fact they are entitled to. **`support@trugrade.in` added to `demo.ts`** for the same reason T23 added a rider and T38 a pricing admin: §3C.4 gives the order board to ADMIN_OPS *and* ADMIN_SUPPORT and no SUPPORT account existed, so the read-only support view was unreachable and both accounts that could reach the board at all (OPS_MANAGER, FINANCE) need MFA. It is also the interesting slice — SUPPORT gets the orders and is refused the purchase orders; PRICING_ADMIN gets the purchase orders and is refused the orders — and both refusals are photographed as real sign-ins rather than fixtures. **Colour.** The first draft put thirteen rows under two outlined-amber chips each (every `PAYMENT_PENDING` order, every `PENDING` payment) and fifteen `RAISED` purchase orders under a third; a board that is mostly amber has spent the colour on everything and marks nothing, which is what T37 and T38 each had to undo. `warn` now means only what needs somebody in this building today — an order held for an approver, a partial or failed payment, a DISPUTED purchase order. `RAISED` is `processing` here and stays `warn` on the vendor's board, deliberately: there it is the one thing that vendor must act on; here it is the ordinary first state of every purchase order ever raised, and this screen says out loud that no acceptance deadline exists in this product. Nothing on any of the three screens is `pass` or `fail`. A REJECTED approval is neutral — a decision, not a failure — and only an EXPIRED one is `warn`, because that deadline was ours. **20 integration tests, every guard attempted rather than asserted, each with its control case**: a vendor and the buyer whose own order it is are refused all three routes while an OPS_MANAGER gets the same three URLs; SUPPORT and PRICING_ADMIN each get one board and are refused the other; every facet count is re-fetched as a filter and must equal what it promised; the seal, serial, GSTIN, name and mobile searches each carry a control term that must find nothing. Mutation-checked: widening the PO board's permission to `ordering.any.read` fails exactly the two slice tests. **18 console tests** for the claims an integration test cannot see — "None raised" instead of a zero, an unstatable margin as words in `--ink-4` with no figure anywhere in the block, no `.text-pass`/`.text-fail` on any of the three screens, "waiting 23 h" and never "late" or "overdue", and the permission-gated link present for an ops manager and absent for support. **Three capture-script defects found and fixed, all of the believe-a-frame kind**: `route` → `unroute` → `route` races (the 6-second delayed handler is still registered when `unroute` runs, so the "error" frame came back a perfectly loaded board); a Playwright glob `*` does not cross a `/`, so `**/api/ops/orders*` stubbed the board and silently did nothing to `/api/ops/orders/TT-26-00013`; and waiting for `table` photographs `DataBoard`'s skeleton as the loaded state, so the run waits for an anchor inside `tbody`, which a skeleton row does not have. **Not built, and the screens say so rather than showing a dead control.** §3C.4's cancel-with-reason, reallocate-a-unit and force-progress are all legs of the order transaction — cancelling releases units back to sellable and reverses the purchase order, the payable and the TDS accrual — and no service in this codebase does any of it; the record's side panel names all three and names what is missing. The backlog's "with three-way match" is likewise absent: `procurement.vendor_invoice` and `goods_receipt` are both empty with no writer, so the two documents a purchase order is matched against do not exist to disagree, and `/admin/procurement/vendor-invoices` is blocked the same way. §2.2's masked PII with an audit-logged reveal is not built either — the buyer's mobile is shown in full to staff, as T32's pick list already shows it to a vendor, and an audited reveal needs the audit-write path T41 owns. |
| T40 | Finance console | DONE |  | 24 shots, 4 states x 2 themes, 1440/900/600 | **One archetype-E screen at `/finance`, sized to the data, and the size is the finding.** §3C.4 asks for eight money boards. The tables behind seven of them are empty AND have no writer — `payment.ledger_entry`, `payment.payment`, `payment.refund`, `payment.settlement_run`, `payment.payout`, `procurement.payout_run`/`payout_line`, `procurement.goods_receipt`, `procurement.vendor_invoice`, `payment.eway_bill` — so eight boards would have been eight screens that look identical the day a writer lands and the day it does not. They are listed by name with their row count and the route they would have served, and nothing was stubbed. **New `FinanceController` at `GET /api/admin/finance`, in `identity`** for exactly the reason `OpsController` is: the payload spans `payment`, `procurement`, `kyc`, `ordering` and `platform`, no module's service owns the combination, and the rule that keeps it honest is separate statements, one module schema each, combined in TypeScript. `no-cross-schema-join` forbids the shorter join and is right to. Guarded on **`payment.ledger.read`** and not `payment.invoice.read_any`: the latter also reaches OPS_MANAGER and SUPPORT, who legitimately look up a buyer's invoice on a ticket and have no business with a vendor payout stack that names supply points and their bank status. **The cross-check that matters passes.** `TT/2026-27/00001` totals Rs 99,059.82 and its order's `grand_total` is Rs 99,059.82 — compared as integer paisa on the server, never as floats, because `Number('99059.82') * 100` is 9905981.999... and would answer "no" on a pair that match exactly. `payment.invoice_series.last_number` is 1 against 1 document, so the GST series has no gap, and a gap is rendered as an alarm rather than a warning. **The screen's actual news is what stops money moving.** §4.8's five payout conditions are each checked against the rows that would answer them: delivered (0 of 17 payables carry an `eligible_at` at all), inspection window closed (48 configured hours, no clock started), three-way match (**17 POs, 0 goods receipts, 0 vendor invoices — reported UNMEASURABLE and not UNMET**, because two of the three legs having no rows means we did not look, not that we looked and found a mismatch), bank account verified (0 of 6 supply points with a payable; the 5 verified `kyc.bank_account` rows all belong to test-scaffolding orgs), and no unresolved dispute — the one of five that passes, and it passes because nobody has raised one. **The TDS story is more precise than "5% instead of 0.1%".** 17 accruals over Rs 11,25,998 of purchases have withheld Rs 0.00, and that zero is a CORRECT deduction: 0 of 6 supply points has crossed the Rs 50,00,000 per-vendor threshold. What is worth knowing before one does is that `kyc.pan_record` is **empty across the whole platform**, so the rate that would apply is s.206AA's 5% and not s.194Q's 0.1% — fifty times the deduction, taken out of a payment already agreed. The screen says both, in that order. **Two live findings the screen surfaced by itself.** (1) `payment.commission_rule` holds five rates, 4.5%-8% by vendor tier, and **no file in the API reads the table**; `ordering.sub_order.commission_amount` is 0.00 on all 23 consignments. Same shape as T38's `price.guardrail_upper_multiple`. Under the merchant-of-record model the margin rules already deliver our margin, so a commission column may be the wrong shape for this business — but a rate somebody set beside a column nobody fills must not look like a working pair. (2) **9 of the 10 consignments carrying a delivery date have no tax invoice against them.** Under GST an invoice is due at removal, so that is a real exposure; the cause is that the seed marks deliveries directly rather than routing them through `InvoiceIssueService`, which is the only path that raises a document. **Colour**: an unpaid invoice and an accrued payable are not verdicts, so nothing is green or red — the payout gates wear the outlined `warn` chip when unmet and a NEUTRAL chip when unevaluable, because "we did not look" must never wear the same face as "we looked and it failed". The one red on the screen is an invoice that disagrees with its order, which is a genuine arithmetic FAIL and has never fired. "Paid out to supply points" renders **Not measured**, never Rs 0 — nothing has been paid AND nothing can be, and a zero reads as only the first. **Not built:** every write §3C.4 asks for (refund, retry, mark manual, create/approve/execute a payout run, import a bank statement, generate an e-way bill, issue a credit note, regenerate an invoice) — each needs a table with a writer first; the GSTR-1 export; and the per-board split, because one screen over this much data is the honest shape and eight is theatre. |
| T41 | Config, flags, templates, audit log | DONE |  | 78 shots, 13 states x 2 themes, 1440/900/600 | **Three archetype-B boards — `/platform/config`, `/platform/flags`, `/platform/audit-log` — over two new read-only routes.** `GET /api/admin/platform/config` in the `platform` module (its own three tables, no seam to cross) and `GET /api/admin/audit-log` in `identity` (its own table). **The config board leads with reachability, not with the value.** A table of 74 editable values implies 74 working settings and that implication is false: **40 of them are named by no file in the API.** Every config defect this repo has found was that shape rather than a wrong value, so the board shows, per key, the source files that read it — `internal/config-consumers.ts` holds a committed scan of `src/`, and `config-consumers.spec.ts` **re-runs the scan on every `pnpm test` and demands the same answer**, so the map cannot go stale silently. There is no generator script to remember: the spec is the generator. The file is excluded from its own scan, and so is the controller that renders it — a reachability column that counts its own renderer always says yes. **A second scan, and it found more than the first.** `platform_config` has two writers, the migrations and `prisma/seed/reference.ts`, and they have **substantially diverged: 11 keys are written by both, 17 by a migration only, 45 by the seed only, and 1 by neither.** Neither source alone produces a working platform. That is the `msme.max_payment_days` defect generalised — it was migration-only, and a seed-built database paid an MSME on 15-day terms instead of the statutory 45. The one key written by nothing is `qc.visit_fee_waiver_units`, a live row under the retired half of the two-names-one-number pair, and the board labels it "Written by nothing". The scan is case-insensitive because the baseline migration writes `warranty.default.A_PLUS` and a later migration lower-cases every key in place; case-sensitive matching reported three live keys as orphaned. **`tax.tds_applicable` has two rows** — `false` at 02:22 and `true` at 07:09 on the same day, both `version` 1 — which the board renders as version history with the superseded value named, because `platform_config.key` is unique only with `effective_from` (schema gap #4) and `version` is never incremented by anything. **The screen is read-only and that is the design.** §3C.7 asks for an editor; a text box over this table with no staging, no typed validator per key, no mandatory reason, no second approver on the statutory keys and no rollback is a production incident with a save button. `config-is-not-writable.spec.ts` proves the refusal by PULLING: POST, PATCH, PUT and DELETE against the route **as a PLATFORM_SUPERADMIN who holds `platform.config.write`** — so the 404 means the capability does not exist rather than that this caller lacks it — with the GET beside them as the control, plus an assertion that `tax.tds_rate_pct` was not left at 99. Guarded on `platform.config.write` (a write permission guarding a read: §3C.7 gives the screen to ADMIN_SUPER, that grant is held by exactly PLATFORM_SUPERADMIN, and there is no `platform.config.read` to invent). **The audit log is evidence, and the test tries to destroy it.** `audit-log-is-evidence.spec.ts` attempts an UPDATE and a DELETE against `identity.audit_log` and demands the database refuse — plus a row-count check afterwards, because a rejection alone does not prove nothing changed — with TWO controls: an UPDATE whose WHERE matches nothing must SUCCEED (the trigger is FOR EACH ROW, and without this the first two pass against a table that refuses everything), and an INSERT must be read back. `trg_append_only` and not a REVOKE, which is the defect this repo already shipped once: a REVOKE cannot bind the table owner and the application connects as the owner. POST/PATCH/PUT/DELETE on the viewer route are all 404 with the GET as the control. **A filter never drops a row silently.** Every response carries three counts — the whole log, what the filter matched, what fits on the page — and the screen prints all three plus what the filter excluded. A date-only `to` means the END of that day, tested: treated as an instant it is midnight and silently excludes the day somebody asked for. **The partition state is a first-class answer.** `identity.audit_log` is RANGE-partitioned by month with **no DEFAULT partition** (schema gap #1), so a query outside 2026-08-01..2027-03-01 returns zero rows and looks exactly like a clean history — the response reports the bounds and whether the requested range is inside them, and the screen says "a zero here is not evidence that nothing happened". That state is photographed for real (a 2020 date range), not stubbed. **Flags and templates are one screen, not two.** Both tables are empty AND named by no file in the API, so they are one unbuilt capability with two tables rather than two empty features; the reader counts are asserted by the same scanner, with `platform.notification_log` — which genuinely has one writer — as the control that stops the scan answering "nothing reads anything". The empty state says out loud that an empty flag list is NOT "everything is off". **Colour**: a config value is a setting and reads as ink; nothing on any of the three boards is green or red, because an unread key, an inactive flag, a failed login and an audit row are none of them verdicts. Unread keys, migration-only keys and future-dated rows wear the outlined `warn` chip. `--acc` appears once per screen, on the measured count. **Board state is in the URL** on both filtered boards, including the audit log's page. **Not built:** the config editor and its history/export; the flag toggle, rollout slider and org scoping; template editing, versioning, preview, test-send and activation; the audit-log export (§3C.7 requires the export be itself audit-logged, and an export button that did not write its own row would be the first unlogged read of the log); `/admin/notifications/log`, `/admin/users`, `/admin/roles`, `/admin/dpdp/*`, `/admin/system/partitions`, `/admin/system/integrations` and `/admin/reports`, which are separate §3C.7 rows. |
| T42 | Theme toggle audit across every route | PART (console) |  | 44 route x theme combinations; `data-t` and the computed header/footer background read in the page | **apps/console only; the storefront lane is separate.** Measured rather than eyeballed: `data-t` applies correctly on every route in both themes, and header and footer computed `rgb(8,9,11)` = `--chrome` in BOTH themes on all of them. The pre-paint read works (inlined in `index.html`; `test/prepaint.spec.ts` guards the drift). **No dark-chrome component sits on a working surface** - the `.pill.wire` class of bug does not exist here: the only `on-chrome-*` outside `Shell.tsx` is the command-palette TRIGGER, which lives in the header, and the palette dialog itself is correctly `bg-sheet`/`text-ink`. Raw `text-acc` appears once, `Shell.tsx:115`, on `bg-chrome-2` - legal, an active state on dark chrome; `--acc` as text on a light sheet would be 1.75:1 and there is none. **Two findings, neither fixed:** (1) the only literal hex in the console is `PickList.tsx` 49-52 (`#fff`, `#000`, `#999`) inside `@media print` - ink on paper, where no token applies, but it is still outside the token block; (2) **`/login` has no theme toggle**, because it is deliberately outside `Shell` and `Shell` owns the only one, so a signed-out user cannot change theme - the stored preference is still honoured pre-paint. |
| T43 | Empty/loading/error state audit | PART (console) |  | Every console route, all four states; two shots of the repaired refusal | **apps/console only.** Three defects fixed. (1) **`RequirePermission` and `RequirePlatform` rendered their refusal OUTSIDE `<Shell>`** - all ~20 guarded routes were a bare paragraph with no header, no rail, no footer and no way back. Fixed by flipping the nesting in `App.tsx` so `<Shell>` is outside the guard, which is the shape the vendor barrel already had; verified that header, footer, section rail and skip link are all present on a refused `/platform/config`. (2) **Dead link:** `Unit360.tsx:683` offered "the audit-log viewer" at `/audit-log`, which has no `<Route>` - the `*` catch-all silently bounced the click to `Landing` and on to whatever section the reader happened to hold. Now `/platform/audit-log`. (3) **`useResource` cleared neither `data` nor `error` between requests.** `error` surviving was the serious half: every caller checks `error` first, so ONE transient 500 pinned "did not load" for the rest of the session - changing the filter refetched, succeeded, set `data`, and the board still refused to render. `data` surviving was quieter and no more honest: a board kept showing the previous filter's rows with nothing on screen saying they were stale. Verified clean: every route has a named error, a named empty and a loading skeleton - no "no rows" anywhere. The deliberately-empty screens (flags, notification templates, finance invoices/payables/ledger, sampling rules, tool providers, audit rechecks) each say what the table is and what would create a row, and flags and templates say that nothing reads the table at all - left exactly as they are, nothing seeded. `NotMeasured` carries a `why` and an sr-only reason throughout, `NO_SHOW_*` is `warn` and not a measured zero, and `/finance` still reports UNMEASURABLE. Every query parameter a control writes (`q`, `show`, `brand`, `status`, `reach`, `from`/`to`) is read by its board - no second silently-ignored filter. **Noted, not a defect:** no console board is sortable at all (zero `sortable` columns, zero `onSort`); the captions state a fixed order in prose, so the "board state lives in the URL" rule currently has no `sort` to carry. |
| T44 | Mobile pass - 900px and 600px | PART (console) |  | ~130 measurements of `document.scrollWidth` vs `innerWidth` at 1440/900/600 after scrolling right, 32 routes x 2 themes, every offending element named | **apps/console only.** Measured, not hunted by eye - `scripts/t42-t45-console-audit.mjs`. **Two page-scroll defects found, both the known class, both fixed and re-measured.** (a) `/kyc/:orgId` at 600 scrolled the PAGE to **756px**; the offender was the archetype-C side panel `<aside class="tg-card ... sticky top-5">`, measured 736px wide inside a 600px viewport. (b) `/vendor/qc/visits/:id` at 600 scrolled to **684px**; the offender was the evidence column `div.flex.flex-col.gap-5` at 664px. Same root for both, and it is the fifth and sixth instance of it: `lg:grid-cols-[minmax(0,1fr)_380px]` protects only the FIRST track and only at `lg` and up - below `lg` the grid collapses to one implicit column whose automatic minimum is min-content, and the fixed 320/380px track never had the protection at ANY width. Fixed with `[&>*]:min-w-0` on **all ten** archetype-C grids in the console (eight of them latent), then re-measured: both routes now report exactly 600/900/1440. Also checked and clean: only two hand-rolled `<table>` remain (`lib/controls.tsx` and `vendor/PickList.tsx`) - the "thirteen places" have been converted to `DataTable`; and `Board` is `overflow-hidden`, which zeroes its own automatic minimum, so it is not a carrier. |
| T45 | Accessibility - axe, keyboard, SR | PART (console) |  | axe-core 4.10.2 on every console route in both themes at 1440, plus a keyboard and palette probe measuring focus, focus order, focus return and rectangle visibility | **apps/console only.** Two defects fixed. (1) **`definition-list` (serious)** on `/orders/:orderNumber` and `/units/:serial`, both themes. Root: `Datum` in `lib/controls.tsx` emitted `<div><span/><span/></div>`, and two of its twelve callers wrapped it in a `<dl>`, which may not hold loose spans. Fixed AT the component - `Datum` now carries its own `<dl><dt><dd>`, so all twelve call sites get a real key/value relationship where the other ten had been announcing two unrelated strings; the two `<dl>` parents became plain grids, since a `<dl>` may not nest. Re-measured: gone. (2) **The command palette never scrolled its active option into view.** `aria-activedescendant` moves the announcement without moving DOM focus, so the browser does nothing about visibility, and the list is `max-h-[46vh] overflow-y-auto` - a search filling several groups walked the highlight off the bottom, the reader announced a row nobody could see, and Enter opened a record nothing on screen had named. Added a `scrollIntoView({ block: 'nearest' })` effect. **Verified clean:** the palette is a real `<dialog>` opened with `showModal()`, so focus is trapped and the background inert; the input takes focus on open; `aria-expanded` and `aria-activedescendant` are correct; Escape closes and focus returns to the pre-open element; **axe on the open dialog reports zero violations**. Thirty consecutive tab stops, every one with a 2px focus ring - no focus-visible failures. The skip link is the first tab stop and becomes visible when focused. `ThemeToggle`'s two labels are `display:none`-switched, so exactly one accessible name is exposed. Grades stay neutral and green/red stay PASS/FAIL: every `tone="fail"` and `text-fail` in the console is an error, a hard gate refusal or a measured over-threshold, and each carries its text - no ninth misuse added, none of the eight undone. **Reported to packages/ui rather than edited, because the storefront lane shares those files:** (i) **`scrollable-region-focusable` (serious)** on `/platform/audit-log`, `/platform/config`, `/finance` and `/units/:serial` at 1440, and on most boards at 900/600 - `DataTable`'s wrapper `<div class="relative w-full overflow-x-auto">` has no `tabIndex`, `role` or `aria-label`; measured 940px of content in a 558px box with `tabindex: null`, so a keyboard-only user cannot scroll the widest boards. (ii) **`color-contrast` (serious) on every route in both themes, and it is token-level rather than per-file**: `--on-chrome-3` on `--chrome` is **3.64:1** and fails AA in BOTH themes because the chrome never flips (header `Ctrl K`, the `PLATFORM` badge, footer headings and captions); `--ink-4` is **3.04 dark / 2.61 light** on `--sheet` and 3.30 / 2.31 on `--ground`, failing AA on every surface - and it is the token CLAUDE.md MANDATES for "Not measured" and for denominators, so the honest-absence marker is the least readable text in the product (55 uses in the console, 19 in packages/ui); `--ink-3` is 4.36 on `--ground` in light and 4.19 / 4.28 on `--sheet-3`, failing AA there (139 uses). `09_FRONTEND_LOCKED.md` section 9 only ever verified `--ink` and `--ink-2` - `--ink-3`, `--ink-4` and `--on-chrome-3` were never checked and do not pass. (iii) `DataTable`'s caption/aria-live re-sort announcement cannot be exercised in the console because **nothing in the console sorts**; separately each caller hard-codes the order into the caption ("newest first"), so wiring sort up would make the live region state an order that is no longer true - the fix is for `DataTable` to append its own `sort` state to the region. **Not finished:** axe was run at 1440 only, so the extra `scrollable-region-focusable` instances at 900/600 are not enumerated; no real screen-reader transcript was taken, so the SR findings come from the accessibility tree and axe rather than from listening; and `/qc/visits/:id/inspect` was measured but not in each of its mid-inspection states. |
| T46 | Performance budgets | TODO |  |  |  |
| T47 | Hindi localisation | TODO |  |  |  |
| T48 | Legal pages and Rule 4(2) block | DONE |  | 92 shots: 11 documents + 4 unavailable states x 2 themes x 1440/900/600, plus the r.4(2) footer in both | **Ten documents under `/legal/**`, not nine.** `03_UX_SPEC.md` line 725 lists terms, privacy, grievance, returns-and-refunds, warranty, grading, wipe-standard, shipping, cancellation AND pricing-and-taxes. All ten are built, as one ISR route (`legal/[doc]`) with `generateStaticParams` over the slugs plus an index at `/legal` — SSR/ISR per line 630, on the SEO side of that line and not the `noindex` side with `/account/**`. Archetype C: the document is the record, its identity is title/version/date, and the side rail holds the contents and the other nine rather than actions, because a legal page has no primary action and inventing one would spend the screen's single amber control on nothing. **The rule that shaped every sentence: the page must describe what the product does, not what we wish it did.** A page promising a 30-day return while `ReturnsService` enforces 48 hours is not a typo — it is a liability made of prose, and the customer wins that argument. So no figure on these pages is typed into them. **Two public reads carry them.** `GET /api/public/legal-terms` (new `PlatformPublicController`) returns five named `platform_config` keys — inspection window, warranty top-up, warranty floor, and the two r.4(5) clocks — from `platform.v_current_config`, the same view `ReturnsService.windowHours` and `WarrantyService` read. `GET /api/public/grades` was widened from one floor to four: it published only `minBatteryHealthPct`, and r.7(5) asks for the OBJECTIVE definition of a grade, which battery health alone is not — `maxCycleCount`, `minCosmeticScore`, `screenDefectsAllowed`, `displayName` and `effectiveFrom` now travel too, straight off `catalog.grade_definition`. **Every value is nullable and there are no defaults.** An unset key comes back `null`, and the page prints `Not published` in `--ink-4` and says the term is unstated; `48` printed because the code assumed 48 is a term nobody in the business set. **The published figures, all live-read:** window `48 h`; warranty `max(vendor + 3, 6)`; grievance `48 h` acknowledge / `30 d` redress; grades A+ `85%`/`300` cycles/`90` cosmetic, A `75`/`700`/`75`, B `60`/`1200`/`60`. **The r.4(5) grievance clocks had no reader at all before this.** `platform.grievance_ack_hours` and `platform.grievance_redress_days` were seeded and consumed by nothing — the same reachability shape T41 found on 40 other keys. `/legal/grievance` is their first consumer, and `CONFIG_CONSUMERS` is updated for all five keys so `config-consumers.spec.ts` stays honest. **No config key was added, and that is deliberate.** Line 727 asks for versions in `platform.config`, re-consented at next login. The version number and the date are built; **the re-consent is not, and no key holds a version.** A version is a fact about a document — a config row cannot know that a paragraph changed, so a config-held version is a second place to remember, and the first time somebody forgets, the published document claims a version it is not. What config *would* legitimately hold is what each USER last accepted, which needs a sign-in gate, a per-user acceptance record and a screen, none of which exist. T41 found config already split across two writers (11 keys in both, 17 migration-only, 45 seed-only); adding an unread key to widen that split in order to imply a mechanism that does not run would be the worst of both. The three documents line 727 names carry a note in their own text saying we will ask and do not yet. **The tests are not render tests.** Two halves that compose. `legal-pages-agree-with-enforcement.spec.ts` asserts each endpoint equals `platform.v_current_config` and `catalog.grade_definition` read in the same test, never against a literal. `t48.spec.tsx` drives all ten documents with values deliberately unlike the seeded ones — window 72, warranty 4/9, grievance 36/21, grade floors 88/250/93 — and asserts both that the stated figure moved AND that **no trace of the seeded figure survives anywhere in the rendered document**; a page with `48` typed into a sentence passes the first assertion and fails the second. Each half carries its control: the endpoint suite pins that config actually holds 48 and that the grade rows are non-empty (both equalities pass vacuously against two empty sets), and the nullability is proved by PULLING — the key's `effective_from` is pushed ten years out and the endpoint must answer `null` rather than 48, and a key holding a string must answer `null` rather than printing it. The grade table is checked per ROW, not per table: a table-wide text search passes just as happily with A+'s cycle cap printed on B's row. **What the documents refuse to claim, each because the code does not do it.** No carrier tracking (`logistics.shipment` has no writer; delivery is recorded by us against the consignment). No self-serve cancellation after confirmation (no endpoint offers one — abandoning a checkout and an approver's rejection are what exist). No e-invoice IRN or QR (`tax.einvoice_enabled` is false). No refund route or timing (nothing executes a refund). No general retention schedule. No re-consent. Returns state plainly that **a return is never refused for want of a photograph you had no way to send us** — the evidence counts (2 for damage, 1 for a seal) are real, but there is no upload route, so the shortfall travels on the payload and the page says so. `/legal/wipe-standard` says outright that some machines have no certificate and that **a blank must not be read as a pass**. **Grades are neutral and the test enforces it**: the grading page is swept for `text-pass`/`text-fail`/`bg-pass`/`bg-fail` and must have none. Green and red are PASS/FAIL; a position on a scale is not a verdict. **Two defects found by looking at the screen rather than at test output.** (1) The grade table was unreadable — the global `table`/`th` rule in `storefront.css` is sized for a data board (`min-width:940px`, and a `th` that is 9.5px uppercase mono with `white-space:nowrap`), which is right for a column header and wrong for the `<th scope="row">` the grade name needs, so each customer description rendered as one uppercase mono line running straight through the numeric columns. Scoped with `.legaltbl`, exactly as `.lview`, `.passport .areas` and `.cartlines` already scope the same table; no second table component. (2) The documents were set in `.wrap` (1400px), which is ~100 characters a line with a band of nothing between the prose and its own contents rail; now a 920px reading container with the article at ~74 characters. **The capture run produced a false frame, and why is worth recording.** The first attempt stubbed `/api/public/legal-terms` to 500 with `page.route` and photographed the result as the unavailable state — but these pages fetch on the SERVER, so the browser never makes that request, Next served its cached render, and the "unavailable" screenshot showed 48 hours in full. The state is now captured for real by `t48-unavailable-shots.mjs`, with the API stopped and `.next/cache/fetch-cache` cleared, and that script refuses to save a frame in which any live value survived. `t48-shots.mjs` gates on build freshness before the first frame — `/public/legal-terms` must exist (a pre-T48 build 404s) and `/public/grades` must carry `maxCycleCount` (a pre-T48 build answers the same 200 without it, and the grading page would photograph two empty columns that look like a data fault). The API was in fact serving a stale build when this task started. **The footer is now block 9 of the reference homepage** — five columns — replacing a four-line disclosure that carried no legal links at all. `storefront.css` already held `.fg`/`.fa`/`.legal`/`.fbot`/`.pays` from the reference and no component used them. Every href points at a route that exists; the mock's `href="#"` columns are not reproduced, and its `NET 30` payment chip is dropped because `ordering.credit_enabled` is false. **The mock's legal block holds invented values — GSTIN `06AABCT1234A1Z5`, a CIN, and a grievance officer called Ravi Menon — and none is reproduced.** The GSTIN is the real `06AAJCT2846R1ZL` we invoice under; the CIN, street address and officer name render as visibly empty fields. `LEGAL_DISCLOSURE` gained `gstin` and `cin`, and both placeholder phone numbers (`+91-000-000-0000`) became `null` — a number that reads as a telephone number and dials nowhere is worse than an absent one. That change reached `invoice-pdf.service.ts`, whose queries line would otherwise have printed `null` on a PDF; it now lists only the channels that answer. **Not built:** the re-consent gate and its per-user acceptance record; a version history or diff between published versions; Hindi copies (T47); and every value that still needs a real one before launch — the grievance officer's name and telephone, the registered street address, the CIN, the jurisdiction and dispute-resolution clause, the refund route and timing, committed delivery times, the general retention schedule, and the DPDP Consent Manager registration. |

## Reported by T40/T41 — found by loading the screens, not fixed

- **`payment.commission_rule` is read by no file in the API.** Five rates, 4.5%-8% by
  vendor tier, seeded and protected from truncation as reference data — and
  `ordering.sub_order.commission_amount` is `0.00` on all 23 consignments. Identical in
  shape to `price.guardrail_upper_multiple` (T38). Under the merchant-of-record model our
  margin is the difference between what we pay and what we charge, which the margin rules
  already deliver, so **the honest question is whether a commission column belongs in this
  business at all** rather than which service should start reading it. Named on `/finance`;
  the decision is commercial, not a coding one.
- **9 of the 10 consignments carrying a `delivered_at` have no tax invoice.** Under GST an
  invoice is due at removal from the supply point. The cause is the seed: it writes
  `sub_order.delivered_at` directly rather than routing the delivery through
  `InvoiceIssueService`, which is the only path that raises a document. Fixing the seed is
  a one-line change in somebody else's file; the exposure is named on `/finance` so it
  cannot be mistaken for a rendering artefact.
- **`kyc.pan_record` is empty across the whole platform.** No vendor has a verified PAN, so
  the moment one crosses the Rs 50 lakh s.194Q threshold the rate that applies is s.206AA's
  5% rather than 0.1% — **fifty times the deduction, taken out of a payment we have already
  agreed**. Nothing is wrong today (no vendor is close to the threshold) and there is no
  code defect; it is an onboarding gap with a fifty-fold price on it.
- **`platform_config` has two writers and they have diverged.** The migrations and
  `prisma/seed/reference.ts` agree on only **11** of the 74 keys: **17** exist in a
  migration and in no seed file, **45** the other way round, and **1** in neither. Neither
  source alone builds a working platform. `msme.max_payment_days` was the migration-only
  case that already cost a statutory 45-day term; the remaining 16 have not been checked
  one by one. Measured by `scanSources` in
  `apps/api/src/modules/platform/internal/config-consumers.ts` and re-derived on every
  `pnpm test`, so the number moves when somebody fixes it.
- **The integration harness rebuilds `platform_config` from the seed's list alone.**
  `truncateAll` protects the table by name, but CASCADE takes it anyway through
  `changed_by -> identity.user_account`, and `restoreReference` puts back only
  `reference.ts`'s 56 keys. So **every integration test runs against a database missing the
  17 migration-written keys**, including `kyc.bank_change_freeze_hours`, which has a live
  reader in `kyc/internal/verification.service.ts`. Any code path that reads one of those 17
  under test gets `missing_platform_config` rather than the production value. Not fixed:
  `test/support/db.ts` is shared and the fix is a decision about which writer is canonical.
- **`qc.visit_fee_waiver_units` is a live row that neither writer creates.** The losing half
  of the two-names-one-number pair; the dev database still has it because a rename left the
  old row behind. Harmless today (nothing reads it), and it is the reason the config board
  has a "Written by nothing" state at all.
- **`platform_config.version` is never incremented by anything.** `tax.tds_applicable` has
  two rows — `false` at 02:22 and `true` at 07:09 on 26 Aug — and both say `version` 1.
  History is carried by `effective_from` alone, which works, but the column implies a
  guarantee nothing provides.
- **There is no AUDITOR demo account.** AUDITOR is the role §3C.7 means by ADMIN_AUDIT, it
  is read-only everywhere including the audit log, and it is **not** in `MFA_REQUIRED_ROLES`
  — so `audit@trugrade.in` would be the only signable account that reaches the audit log
  without walking an OTP. Not added: `prisma/seed/demo.ts` is being edited by another
  session in this tree, and all three T40/T41 screens are already reachable by a demo
  account (`admin@` for config and flags, `finance@` for finance and the log, `kyc@` for the
  log without MFA). One line, when that file is free.
- **`apps/api/tmp/*.mjs` fails `pnpm lint` at the repo level** — 16 errors across
  `add-support.mjs`, `probe.mjs` and `q.mjs`, including a real
  `@trugrade/no-cross-schema-join` violation in `q.mjs`. Untracked scratch belonging to
  another session, so it was left alone; `eslint src test` is clean in `apps/api`. Either
  delete them or add `tmp/` to the API's eslint ignores.
- **`ManualInspection.spec.tsx` fails intermittently under `pnpm test`** and passes on its
  own and on a clean `vitest run` (208/208). It is `userEvent.type` racing a 5-second
  budget while the API's jest run saturates the machine in the same turbo pass. Not a
  defect in the screen; it will keep costing somebody a diagnosis until the typing
  assertions get a longer timeout.

## Reported by T22 — not fixed, they are outside my files

- **`CUSTOMER_BUYER` cannot read its own organisation's tax documents.**
  `03_UX_SPEC.md` §3A.3 lists `/account/orders/[id]/documents` for BUYER_FINANCE,
  BUYER_ADMIN, BUYER_OWNER **and BUYER_PROCURER**. Of those four,
  `packages/contracts/src/roles.ts` gives `payment.invoice.read_own` to
  CUSTOMER_OWNER, CUSTOMER_ADMIN and CUSTOMER_FINANCE and **not** to
  CUSTOMER_BUYER — so Farah, who places the orders, gets a 403 on the documents
  for an order she raised. The route is guarded with the correct permission
  rather than a weaker one, and the screen renders the refusal as a real state
  naming who in the organisation can open it. The one-line fix is adding
  `'payment.invoice.read_own'` to `CUSTOMER_BUYER`; `packages/contracts` is not
  this task's to change. The 403 capture (`T22-no-permission-*`) is that state,
  produced by a real sign-in as `buyer@acme.example`, not by a stub.

- **`.pill.wire` is a chrome control used on working surfaces.**
  `storefront.css` defines it as `--on-chrome` ink on a `--chrome-line-2` border,
  which is right on the dark header and on the landing hero and is white-on-white
  on a light sheet. T21's "Show all machines" in the units board's empty state has
  it, and so does the "browse in bulk" link on the home page. Pinned for T22's
  three uses with a scoped override and reported rather than changed globally,
  because the two dark uses are correct as they are. The real fix is a
  `.pill.sheet` variant, or making `wire` surface-aware.

- **`prisma/seed/index.ts` with `SEED_DEMO=1` fails before it reaches the new
  step.** `seedDemo` raises *"15 unit(s) carry a supply-point label that is not
  the one assigned to their vendor in that city"* on the current dev database.
  Pre-existing and unrelated to invoicing — `seedInvoicing` runs clean when
  invoked on its own — but it means a fresh `pnpm db:seed` does not reach the
  seller registration today.

## Reported by T22 — decisions, not code

- **A tax invoice is issued at REMOVAL, not at payment.** s.31(1)(a) CGST Act:
  for a supply of goods the invoice is issued before or at the time of removal
  for delivery. Issuing on payment would be late for a credit order and early for
  a prepaid one nobody has picked. T17's screen already said "raised when the
  machines are dispatched"; this makes it true. `BillingConsignment.removed` is
  the trigger and `ordering` computes it, because `ordering` owns the status.

- **One invoice per consignment, not per order.** Rule 138 binds an e-way bill to
  a consignment and `payment.eway_bill.invoice_id` is UNIQUE, so an order
  dispatching from three supply points needs three invoices — folding them into
  one leaves two consignments with nothing they could legally travel under. To the
  buyer they read as "Delivery 1 of 3 · Supply Point A · Gurugram", which is the
  vocabulary the order screens already use.

- **The proforma is derived, not stored.** No statutory number, no row, no writer
  in the checkout transaction. It is numbered `PRO/<order number>` and rendered on
  demand from the order, so it cannot go stale; a stored one would be wrong the
  moment a line changed. It says on its face that it is not a tax invoice and that
  no input credit may be claimed against it.

- **Signed URL, not presigned.** `ObjectUrlSigner` encrypts `<expiry>:<key>` with
  AES-256-GCM and `GET /api/objects/:token` resolves it, so the object key never
  reaches the browser. A presign publishes the key path, which is the leak
  PHASE_05 Task 1 names. The download route mints a fresh 300-second URL per
  click and 302s to it, which is also where the `audit_log` row is written — one
  row per download rather than one per page view.

- **`sub_order.invoice_id` is left NULL.** `payment.invoice.sub_order_id` is the
  authoritative link and `payment` writes it; the column on `ordering.sub_order`
  is the redundant half of the pair, and writing it would be a cross-module write
  for a denormalisation nothing reads. ponytail: set it when a query needs it.

## Reported by T22 — not built, stated rather than implied

- **The e-way bill has no writer.** `payment.eway_bill` is read and never written.
  It is generated on the GST portal at pickup, and `logistics` has no pickup
  writer, so there is nothing to fire from. The row on the screen says so in its
  own words rather than showing a blank, and when a number does exist the row
  renders it — there is deliberately no download, because the portal returns a
  number and not a file we hold.

- **"Email to accounts" is not built.** §3A.3 lists it as a primary action.
  `customer.org_preference.invoice_delivery_email` exists and nothing sends mail
  against it. Nothing on the screen suggests it does.

- **Proof of delivery, credit notes and returns are not built.** Each is a row
  that says why it does not exist. A credit note is modelled as
  `payment.invoice` with `type = 'CREDIT_NOTE'` and `original_invoice_id` — there
  is no `payment.credit_note` table, and there does not need to be.

- **The rest of `payment` is untouched.** Settlement runs, payouts, refunds,
  penalties, the ledger and `itc_entry` are still empty. T22 built the invoice
  slice; T40 needs the others.

## Reported by T25 — the decision that did not exist

`OrderingController` could create an order that needed a signature and could
show it waiting for one. **Nothing could give it.** `APPROVED` and `REJECTED`
were reachable only by writing the column by hand, which T17 and T19 both had to
do for their captures. Built, in `apps/api`:

| Route | What it does |
|---|---|
| `GET /buyer/approvals` | The approvals addressed to the caller. Board state in the URL. |
| `GET /buyer/approvals/:id` | One approval, with the order through `OrderReadService`'s own allow-list. |
| `POST /buyer/approvals/:id/decision` | Approve or reject. |

Five things about it are decisions rather than code:

- **VR-123 is enforced for the first time.** `packages/contracts/src/roles.ts`
  says of `CUSTOMER_APPROVER`: *"an approver may never approve their own order.
  Enforced in the service, not here."* It was enforced in no service. It is now,
  in `ApprovalService.decide`, and it is checked **after** the named-approver
  test rather than instead of it — the way self-approval actually arises is a
  policy naming somebody as their own approver, so both conditions are true at
  once and only the second is the violation. The test constructs exactly that
  row and has the person attempt it.
- **Approving calls `raisePurchaseOrder`, it does not restate it.** The
  transaction leaves an `AWAITING_APPROVAL` order with steps 6–12 done and 13,
  14 and 16 deliberately skipped. `OrderTransactionService.commitApproved` runs
  exactly those three, through the same private method the placement path uses,
  so there is one definition of what a PO, a payable, a TDS accrual and a frozen
  `purchase_price` are. It re-reads each unit and **refuses if one is no longer
  `RESERVED`** — a machine scrapped while a manager was thinking is not sold by
  an approval arriving afterwards.
- **Rejecting releases the stock through `releaseOrderStock`**, the mirror of
  `HoldService.release` for the stage after a hold has been consumed: at
  `AWAITING_APPROVAL` there is no `checkout_hold` row left, and what holds the
  machines is `listing.unit.status = 'RESERVED'`. `listing.qty_available` is not
  touched — `trg_listing_counters` recomputes it, and a hand-written correction
  beside a trigger is how counters start disagreeing. Verified on the live demo
  database: six units back to `LISTED`, counters restored by the trigger.
- **The deadline is the server's, in both directions.** A `PENDING` row past
  `expires_at` is reported `EXPIRED` (T17's rule) *and* a decision arriving after
  it is refused against `ClockPort`, with the row settled to `EXPIRED` in the
  same breath so the state stops being a lie the moment anybody looks. A
  storefront unit test hands the browser a PENDING row whose deadline has passed
  by the browser's clock and asserts the screen still says PENDING.
- **`settle`'s `AND status = 'PENDING'` is the concurrency guard**, not the HTTP
  verb. Two approvers pressing at once, or one pressing twice, and only the first
  write lands — proven by deciding twice and asserting one purchase order, not
  two.

## Reported by T25 — fixed, and it was a live defect

- **`ordering.order_approval.requested_at` was written by the DATABASE clock
  while `expires_at` came from `ClockPort`.** The transaction omitted the column
  and let `DEFAULT now()` fill it. In production the two are milliseconds apart
  and nothing shows; under a fixed clock they diverge by hours, and the SLA the
  dashboard and the inbox both measure — `expires_at - requested_at`, measured
  off the row precisely so it is never the column's 24h default — came back as
  22. Any clock skew between the app and the database produced the same wrong
  number in production. One parameter, in `order-transaction.service.ts`.
- **The account area had no navigation.** `/account/orders` was reachable from a
  dashboard tile and `/account/addresses`, `/account/team` and
  `/account/approvals` would have been reachable from nowhere at all. `AccountNav`
  now lives in `/account/layout.tsx`, the way T21 put the order record's tab
  strip in ITS layout. Only routes that exist are listed.
- **`.sidep{order:-1}` put the button above the evidence on a phone.** Right for
  a product page, where the first thing to answer is the pincode; wrong on a
  screen whose whole rule is that the landed cost and the serials come before the
  signature. Scoped override, `.apprrec`.

## Reported by T25 — decisions, not code

- **The row action is Review, not Approve, and there is no bulk approve.**
  03_UX_SPEC asks for both a bulk action and *"the full landed cost, the
  requester and which policy rule triggered the approval, before the button"*.
  Those two cannot both be true. A one-click approve in a table row is a
  signature given without reading what is being signed, and a bulk one is that
  multiplied. The decision is taken on the record, where all of it is on screen.
- **Green and red appear on these screens and nowhere else in the portal.** An
  approved or declined order is a verdict, which is the one thing the design
  system reserves PASS/FAIL colour for. A *pending* approval is neutral — waiting
  is not a result — and so is an expired one, because a deadline that passed is
  not a decision anybody took and colouring it red blames the approver for a
  clock.
- **The decline button is `secondary`, not `danger`.** Red belongs to the
  verdict, and the verdict does not exist until the button has been pressed.
- **A billing address is read-only, refused by TYPE rather than by the flag.**
  The response carries `editable:false` and the reason; `updateAddress` refuses
  anything that is not `SHIPPING` whichever field was sent, and the test ignores
  the flag and PATCHes a billing row anyway, then asserts the stored `city` and
  `state_code` are unchanged. A wrong state code on a billing address is a wrong
  GST jurisdiction on an invoice.
- **Nobody can grant a role they do not hold.** 03_UX_SPEC says it of custom
  roles; it is applied to the fixed ones, so an admin who cannot approve orders
  cannot make somebody an approver. The screen marks the role unavailable AND the
  server refuses it, and the test has the admin attempt it.
- **`receivingHours` is `null` and the form does not offer the field.**
  03_UX_SPEC asks a delivery site for receiving hours and `identity.org_address`
  has no column for one. Every card prints "Not recorded" in `--ink-4` and the
  form says so rather than collecting something it would discard. A delivery
  outside hours we invented is a failed delivery made on our own promise.

## Reported by T25 — not built, stated rather than implied

- **There is no invite flow.** 03_UX_SPEC's `/account/team` asks for one and it
  needs `identity.user_invitation` (the table exists, no code touches it), a
  token, an email and an accept route. The screen says out loud that somebody
  joins by registering against the organisation and an owner then gives them a
  role — a button opening a form that led nowhere would be worse than none.
- **There is no approval-policy editor**, so "ask an account owner to name a
  different approver" is advice with no screen behind it. The approver on an
  order comes from `customer.buyer_approval_policy.approver_user_id`, not from a
  role, so making somebody `CUSTOMER_APPROVER` on the team screen does NOT route
  anything to them. That is 03_UX_SPEC's `/account/spend-limits`, and it belongs
  in the `customer` module, which owns the `customer` schema and is still empty.
  The refusal copy was written to avoid promising a screen that does not exist.
- **Nothing releases an expired approval's stock.** `ix_order_hold` indexes
  `ordering."order".stock_hold_expires_at` for exactly this sweep and no job runs
  it — `HoldService`'s cron only releases `checkout_hold` rows, which are gone by
  the time an order exists. So an approval nobody answers leaves six machines
  `RESERVED` for ever, and the copy on three screens ("the hold releases on its
  own") is currently a promise the platform does not keep.
  **`OrderTransactionService.releaseOrderStock` is the whole of what such a job
  needs** and it is now built and tested; the cron is about fifteen lines and was
  left out of this task deliberately rather than smuggled in.
- **`/account/roles`, `/account/gstins`, `/account/settings` and
  `/account/spend-limits` are not built**, so `AccountNav` does not list them.

## Reported by T25 — data moved, and what was NOT moved back

Two of the four stranded approvals were **decided through the real endpoint** and
are meant to stay decided — that is the gap closing, not a fixture:
`TT-26-00004` approved (`PO-26-00016`, `PO-26-00017` raised, payables accrued)
and `TT-26-00011` declined with a real reason (six units back to `LISTED`).
`TT-26-00007` and `TT-26-00009` are left `PENDING` so the inbox has something
outstanding.

One row was moved and restored: `TT-26-00007`'s `expires_at` was brought back an
hour for the `EXPIRED` captures and put back to `2026-08-30 21:40:24.822+00`,
the microsecond it held before, in a `finally`. `scripts/t25-shots.mjs` prints
the four rows before and after.

## Reported by T18 — decisions, not code

- **Archetype D, not B.** The answer is two tables, but there is nothing to
  filter, sort or page: there is one task with two states — the list going in and
  the answer coming back — and a rail that says which of the two you are looking
  at. The tables themselves are `DataBoard` at the storefront's comfortable
  density, like every other screen.
- **The upload and the typed form are one screen, with one primary action.**
  Choosing a file submits it, exactly as the KYC document step does; the typed
  form has the single amber button. Two amber buttons on one screen would have
  been the alternative, and a tab strip to avoid them would have hidden half the
  answer to "how do I give you this".
- **`loading.tsx` exists and could not be photographed.** A `<Link>` transition
  in the App Router holds the previous page on screen while the segment's payload
  streams rather than painting the boundary, and every other way in is a full
  document load. It is not dead code — it is the standard boundary and it renders
  when the segment suspends — but the capture named `T18-loading` would have been
  a picture of something else, so there is none. What is captured instead is the
  wait a person really sits through: `T18-uploading` (the file being checked) and
  `T18-checking-typed` (the form in flight).
- **The header's `/bulk` link is now a `next/link`.** It was a plain `<a>`, which
  made every visit a full document load and meant the route's own loading state
  could never render at all. One import and one tag, in `SiteHeader`.
- **The magic-byte check lives in the browser, and it is not the trust boundary.**
  The endpoint takes a JSON string, not a multipart file, so there is nothing on
  the wire for the server to sniff; the server's boundary is the capped string and
  the per-row report. The client check exists so that somebody who picked the
  wrong file gets one sentence about the file — "requirements-q4.csv is an Excel
  workbook, not a CSV" with the Save As that fixes it — instead of two hundred
  sentences about its rows. The extension and the browser's `type` are consulted
  nowhere.
- **XLSX is refused, not parsed.** The backlog line says "CSV/XLSX". A workbook is
  a zip of XML and reading one needs a dependency the API deliberately does not
  have — `RfqIntakeService` reuses the SKU importer's RFC 4180 parser precisely to
  avoid it — and a client-side parser would put a second, divergent definition of
  "a requirement row" in a page. So an XLSX is detected by its first bytes and
  refused by name with the two-click conversion. If XLSX has to be genuinely
  supported it belongs in `@trugrade/contracts` beside `parseCsv`, serving both
  importers, and it is a deliberate dependency rather than a page's private one.
- **The typed path keeps your rows on a failure; the file path does not.** A 500
  on the form leaves every line on screen with the refusal above it, because
  throwing away what somebody just typed is worse than the failure. A 500 on an
  upload has nothing to keep, so it gets the full-screen refusal with a way back.
- **Nothing is stored until the list is sent, and the rail says so.** `StepRail`
  always closes with registration's save-and-resume state, which would promise a
  draft this flow does not keep — the same defect checkout hit. Suppressed the
  same way, and the rule in `storefront.css` now names both flows. The fix still
  belongs in the component: the save block needs to be omittable.

## Reported by T18 — found in the API, not fixed (ownership was storefront only)

- **`A+` is refused as a grade, and it is the way everyone writes it.** The row
  schema upper-cases and turns spaces and hyphens into underscores, so `a plus`
  and `A_PLUS` both land — but `A+`, which is how the grade is printed on every
  screen in this product, becomes the string `A+` and fails the enum. A whole
  otherwise-good row is lost to it. One line in `requirementRowSchema`'s
  preprocess (`.replace(/\+/g, '_PLUS')`) closes it. `docs/review/T18-unreadable-rows-*`
  shows the refusal on line 4.
- **A blank line in the middle of a file shifts every line number after it.**
  `parseCsv` drops all-blank rows from the grid, and `fromCsv` then numbers rows
  by their position in the FILTERED grid. Proved against the live API: a file
  whose third row is blank reports its fourth line as line 3. That is exactly the
  "line 47 vanished" failure this task is written against, pointed one row off.
  The fix is to number rows before filtering — the parser already has the
  information.
- **A rejected row is reported with the schema's field name, not the CSV's.** The
  server answers `deliveryPincode`; the buyer's header says `delivery_pincode`.
  The screen maps it back (`CSV_COLUMN` in `BulkIntake.tsx`) because it had to,
  but the mapping belongs where the two names are both known — the intake service
  parsed the header and knows which column each field came from.
- **Zod's raw text reaches the buyer.** "Expected number, received nan" and
  "Invalid enum value. Expected 'A_PLUS' | 'A' | 'B', received 'GRADE_A_PLUS'" are
  rendered verbatim because the server's wording is the rule. They are not house
  style — "Enter the quantity as a whole number of machines" is — and
  `requirementRowSchema` is the one place to say so.
- **`MatchedRequirement` does not echo the buyer's own text.** `UnmatchedRequirement`
  carries `model`; the matched arm drops it. That matters because the matcher is
  a trigram search: "Dell Latitude 5320" matches "Dell Latitude 5420" and the
  buyer cannot see the substitution from the response alone. The screen shows the
  matched title and full specification so the swap is at least visible, and says
  the line number is the row in their own file — but echoing `model` back is one
  field and it is the honest version.
- **The endpoint is unrated and every call writes.** Each submission inserts an
  `ordering.rfq` per matched row and opens a `platform.ticket` when anything is
  unmatched. Running the capture script twice put eleven `BULK_REQUIREMENT`
  tickets in the demo database. Nothing here is corrupt and none of it was moved
  by hand, but a rate limit belongs on a route that writes on every POST.
- **The constants are restated in the storefront.** `REQUIREMENT_COLUMNS`, the
  2,000,000-character cap and the 500-row cap live in the API's DTO file, which
  the storefront may not import. Restated in `bulk/api.ts` with the duplication
  named — the same report `CART_NAME_MAX` already carries. They belong in
  `@trugrade/contracts`.

## Reported by T17 — decisions, not code

- **The confirmation screen is a resource, not a return value.** Checkout's
  `Placed` was rendering `OrderConfirmationView` — the transaction's return
  value — which meant a buyer who closed the tab, or who came back from the
  "your order needs a signature" email, had nowhere to go. T17 gives the order a
  URL and `place()` navigates to it, so `Placed` shrank from 90 lines to a
  hand-off. **Two screens describing one order is two places for them to
  disagree**, and the money and the serials were duplicated across both.
- **`/orders/[orderNumber]`, not `/orders/[id]`.** The human number is what is on
  the confirmation, in the email and in the buyer's finance system. A route keyed
  on a uuid makes "look up TT-26-00004" impossible without a search first.
- **A foreign order answers 404, not 403.** "You may not see TT-26-00004"
  confirms TT-26-00004 exists, and order numbers are sequential — a 403 turns the
  route into an order-volume oracle for anyone with an account. The screen for a
  foreign order and the screen for a number that never existed are therefore the
  same screen, deliberately, and a test asserts the copy does not distinguish
  them.
- **A `PENDING` approval past `expires_at` is reported as `EXPIRED`, by the
  server.** The release job runs on a schedule, so the raw row still says PENDING
  for as long as the job lags. A screen reading it would tell a buyer their order
  is still with their manager an hour after our own deadline passed. The deadline
  is ours and it has gone; that is the true statement, and it is computed against
  `ClockPort` rather than the browser.
- **`order.stock_hold_expires_at` is deliberately not exposed.** On a confirmed
  order it still holds the spent twenty-minute checkout hold — an instant in the
  past — and a screen handed that would draw an expired deadline over machines
  that are allocated and are not going anywhere. The only hold with a deadline a
  buyer needs is the approval one.
- **Hours and minutes, not `mm:ss`.** Checkout's `Countdown` is right for twenty
  minutes and wrong for twenty-four hours: it would print `1439:58` and tick it
  down one second at a time in front of somebody who has gone to find their
  manager. `Deadline` recomputes once a minute and prints the absolute instant
  beside it, because that is the figure you put in a message to the approver.
- **There is no amber primary action on this screen, and that is the design.**
  Payment is Phase 7, cancellation and reorder are T21, and the one action an
  approval-pending order wants — approving it — is not the requester's to take. A
  primary control that led nowhere would be worse than none. "One primary action
  per screen" is a ceiling, not a quota.
- **The proforma and the tax invoice say "not issued yet" rather than showing a
  disabled download.** Neither is generated (the proforma is the rest of PHASE_06
  Task 6; the tax invoice is Phase 7). A missing document drawn as a present one
  is the same failure as a missing measurement drawn as a passing one.

## Reported by T17 — the endpoint that did not exist

`OrderingController` had carts and checkout and nothing that read an order back.
`CheckoutService.confirm()` returns `OrderConfirmationView`, but a function's
return value is not a resource — there was no way to see an order a second time,
from any client, ever. Built, in `apps/api` and only this:

- `GET /api/buyer/orders/:orderNumber` → `OrderReadService.byNumber()`
  (`apps/api/src/modules/ordering/internal/order-read.service.ts`, 380 lines),
  registered in `OrderingModule`, guarded by `ordering.own.read`, validated by a
  new `orderNumberSchema` (`^TT-\d{2}-\d{5}$`).
- Seven queries, none of them crossing a schema — the ESLint rule caught the one
  place a test tried to (`ordering` JOIN `procurement`), which is the rule doing
  exactly its job.
- The tax heads are not stored on `ordering."order"`, only the total is, so they
  are resolved again through `resolveTaxSplit` from the same two facts that
  decided them at confirmation: our state and the DELIVERY state.
- **It does not read `procurement.purchase_order` at all** — not counted, not
  summarised, not referenced by number. Under the merchant-of-record model our PO
  to a supply point is vendor-and-admin-only (PHASE_06 Task 6), and the way that
  stays true is structural rather than careful.

Four integration tests in `checkout-order.spec.ts` (now 46, was 42). Each one
attempts the forbidden thing: another organisation's buyer asks for the order by
its real number and is refused 404; a raised PO's number and its agreed payout
are looked up and then swept for in the buyer's payload; a PENDING approval is
pushed past its deadline and must come back EXPIRED.

## Reported by T17 — not fixed, they are outside my files

- **`EmptyState.body` is typed `string`, so an identifier in the sentence cannot
  be mono.** The "no order with that number" screen names two order numbers and
  both must be IBM Plex Mono. `body?: React.ReactNode` would fix it in one line;
  until then `Missing` is hand-rolled on the storefront's own `.empty` class,
  which is what `Failed` already does. `packages/ui/src/components/primitives.tsx`.
- **`CheckoutService.confirm()` still interpolates a raw ISO instant into
  `next`** — "…is not given by 2026-08-30T21:28:25.288Z". T16 formatted it on the
  client; T17 deleted that helper because the sentence is now shown for the
  instant before the hand-off. **The fix belongs in the service that writes the
  string.** `apps/api/src/modules/ordering/internal/checkout.service.ts`.
- **There is no approve/reject endpoint.** PHASE_06 Task 2 builds the policy and
  the `order_approval` row, and the transaction writes it, but nothing can decide
  one — so `APPROVED` and `REJECTED` are unreachable through the product. The
  approver's screen is not in this backlog under any number I can find; it needs
  one.
- **Order confirmation and proforma PDFs are not generated** (PHASE_06 Task 6
  asks for both). The screen says "not issued yet" rather than faking a download,
  and it is the honest answer until they exist.

## Reported by T17 — data moved for two captures, and put back

`EXPIRED` and `REJECTED` cannot be reached by driving the UI, because nothing can
decide an approval. `scripts/t17-shots.mjs` moves two rows through the real
columns and restores them in a `finally`, printing the rows before and after:

- `TT-26-00007` — `order_approval.expires_at` brought back an hour, then restored
  to the exact microsecond it held before the run (`requested_at + 24 hours` was
  close and not equal, which is not "put back").
- `TT-26-00009` — `status` / `decided_at` / `comment` set to what an approver
  pressing decline would write, then reset to `PENDING` / NULL / NULL.

Verified restored: all four seeded approvals are `PENDING`, undecided, with their
original deadlines.

## Reported by T16 — what loading the screen found

The flow was 1,700 lines that had never been rendered in a browser. Everything
below was found by opening it, and most of it is the same family of defect the
rest of this run keeps finding: **a value we did not have, drawn as one we did.**

- **The confirm step drew an unresolved tax split as a settled one, at ₹0.00.**
  With the Bengaluru site chosen — Karnataka 29, outside the NCR lane, so no
  freight and no taxable value — the panel headed *"The tax split on this order"*
  printed **"CGST at 9% — ₹0.00 · SGST at 9% — ₹0.00"**. Two things wrong at
  once: there was no split to show, and 06 against 29 is inter-state, so CGST +
  SGST is not merely unresolved but **the wrong pair of heads**. This is the one
  panel PHASE_06 Task 1 exists to put in front of a finance team *before* an
  invoice exists, and it was showing them something `payment.invoice`'s own CHECK
  constraint would refuse to store. It now says the split is not resolved, names
  what it would be (IGST), and prints "Not resolved" in `--ink-4`.
- **The primary action's refusal lived only in a `title` tooltip, and the button
  still fired.** `Button.disabledReason` sets `title` and `aria-disabled` but
  deliberately leaves the element enabled so a screen reader can reach it — which
  also leaves `onClick` live. So "Place this order" on an unpriced lane was a
  control the screen called unavailable, gave no on-screen reason for, and would
  have POSTed anyway. The reason is now printed under the button — the same
  failure the payment step's own comment refuses one file over — and `place()`
  guards on it. `t16.spec.tsx` presses the button and asserts `confirmCheckout`
  is never called: it attempts the forbidden thing rather than asserting a guard.
- **The step rail promised a draft this flow never writes.** `StepRail` always
  closes with a save state, and with no `savedAt` that state reads *"Nothing
  saved yet. Finish a step to save a draft."* True in registration, which writes
  `onboarding_progress.draft_json` after every step. False here, and false in the
  dangerous direction: checkout saves nothing, and what actually holds a buyer's
  place is a twenty-minute hold that releases whether or not the tab is open.
  Hidden with one scoped rule and replaced with the true sentence under the rail.
- **The confirmation ran the full 1400 px of `.wrap`**, so a serial number and
  its dispatch point sat a thousand pixels apart — and it called a
  `PAYMENT_PENDING` order **"What you were charged"** under a green `pass` pill.
  Nothing had been charged, and an order is not a PASS/FAIL verdict. Now `74ch`
  like every step before it, a neutral pill reading "Order placed · payment
  pending", and "What this order comes to · Nothing has been charged yet."
- **The approval arm called held machines "yours" and printed a raw instant.**
  `OrderConfirmation.next` is product copy — it is the only thing a buyer is told
  after the transaction commits — and it interpolates
  `2026-08-30T21:28:25.288Z`. Milliseconds and a Z suffix are a log line, not a
  deadline a person can act on. Formatted to IST at the render; the heading now
  reads "The machines held for you" while an approver still has to say yes.
- **Two hand-rolled `<input>`s where `Input` exists**, so the PO reference had no
  error wiring, no required marking and none of the system's focus ring. Replaced
  — the required-PO refusal on screen is `Input`'s own error state.

## Reported by T16 — the seed, and it was writing a wrong state code

- **The buyer org held a PICKUP address that checkout pre-selected for billing.**
  `seedDemo` called the generic `addr()` helper for the buyer. That helper writes
  a **PICKUP** row — a vendor's shape — labelled "Primary", `is_default` AND
  `is_billing_enabled`, and it matches an existing row **on pincode alone**, so
  an early run's row survives every later correction. Three consequences, all
  visible on step 2: an organisation that has never shipped anything had a pickup
  point; **two rows read DEFAULT in one radio group**; and the pre-selected
  billing address carried `state = 'Karnataka'` under `state_code = '06'`, which
  is Haryana. A wrong state code on a billing address is a wrong GSTIN
  jurisdiction on an invoice. The call is removed and the stale row deleted;
  `seedBuyerCheckoutSetup` already gives the buyer three real SHIPPING sites, all
  billing-enabled, exactly one default.

## Reported by T16 — decisions, not code

- **The IGST screenshot is New Delhi, not Bengaluru.** The brief named Bengaluru
  as the inter-state case, and Bengaluru cannot be priced at all —
  `logistics.carrier_rate_card` covers Delhi NCR, so 560001 returns
  `freight: null, grandTotal: null` and there is no split to show. **New Delhi
  (07) is the reachable inter-state lane**: same goods, same ₹298 freight, and
  the whole tax lands as IGST ₹23,219.64 instead of CGST ₹11,609.82 + SGST
  ₹11,609.82. `T16-breakup-cgst-sgst-gurugram-*` against
  `T16-breakup-igst-newdelhi-*` is that pair, and it is the same cart both times.
  Bengaluru is captured as the third arm it really is — the lane we cannot price.
- **`deliverySites` is three rows, not fourteen.** Only `SHIPPING`, `is_active`
  rows reach the delivery step. Three is the right number here because they are
  three different answers: Gurugram 06 (our own state), New Delhi 07 (another
  state, priced), Bengaluru 29 (another state, unpriced).
- **The countdown is the only clock on the screen, and there is no second one.**
  No "N left", no viewer count, no expiry on anything but the hold. It reads
  `checkout_hold.expires_at` and nothing else, and it does not reset on F5 —
  `HoldService.take` joins an existing live hold rather than extending it, which
  this run verified by reloading. `T16-hold-expired-*` is the browser watching it
  reach 00:00 with the every-minute cron putting the machines back on sale behind
  it, both confirmed against the table.
- **PREPAID arrives selected on the payment step, and that is the server's stored
  preference rather than a UI default.** It is also the only mode this buyer is
  permitted; the other two are disabled with their reason on screen. Worth
  knowing it is a defaulted *answer*, not a defaulted *consent* — there is no
  pre-ticked checkbox anywhere in the flow, and placing the order is the
  agreement.

## Reported by T16 — not fixed, they are outside my files

- **Deleting a cart leaks reserved stock, permanently.** `checkout_hold.cart_id`
  is `ON DELETE CASCADE` and `checkout_hold_unit.hold_id` cascades from that, so
  `DELETE FROM ordering.cart` destroys a live hold **without any of the code that
  took it ever running**. `HoldService.release` is what moves units back to
  AVAILABLE and increments `qty_available`; a cascade skips it, and the machines
  stay reserved to a hold that no longer exists. Found because a crashed capture
  run leaked units exactly that way and the next run was refused on screen. The
  service's own note says a hold must be released by the code that took it, and
  names three paths — the cascade is a fourth it does not know about. **A
  `BEFORE DELETE` trigger on `ordering.cart`, or `ON DELETE RESTRICT` plus an
  explicit release, closes it.** Worked around in `scripts/t16-shots.mjs`, which
  expires holds and waits for the cron before deleting any cart.
- **`OrderConfirmation` does not carry the buyer's own PO reference or cost
  centre**, though both are stored correctly — `order.buyer_po_number` and
  `order.cost_centre`, checked in the database after a real placement. The buyer
  types a reference on step 4 and never sees it echoed on the confirmation, which
  is the one screen where they would catch it before it reaches an invoice.
- **`OrderConfirmation.next` interpolates a raw ISO 8601 instant.** Formatted at
  the render, but it belongs in the service that writes the sentence — every
  other client of that field will print the same log line at a buyer.
- **`TaxSplit.interState` is `false` on an unpriced lane whose two state codes
  differ.** 06 against 29 is inter-state under s.10(1)(a) whatever the freight
  situation is. The screen no longer trusts the flag when `grandTotal` is null
  and compares the two codes itself, but the field says something untrue and any
  other reader will believe it.
- **Every authenticated screen still shows "Sign in / Create account" in the
  header.** `SiteHeader` is server-rendered and never reads the session, so a
  buyer four steps into checkout is invited to sign in. T15 shipped with it and
  it is chrome-wide rather than this route's — but it is on all 130 captures.
- **There is still no way to reach `/cart` or `/checkout` from the chrome**
  (T15 reported it). Both are reachable only from the comparison board.

## Reported by T15 — decisions, not code

- **The backlog's "20-minute hold with a visible timer" is not built, deliberately.**
  PHASE_05 Task 6 says stock is not reserved in the cart and the hold is taken at
  checkout entry; `CartService`'s own note says the same and adds why (a hold not
  released by the code that took it leaks inventory). A countdown on a screen that
  holds nothing is a scarcity device wearing a clock. The panel instead says
  "Nothing in a cart is reserved. Stock is held for 20 minutes when you start
  checkout, and the hold and its countdown are shown there." **T16 owns the timer**,
  and when it exists this sentence is what has to become true.
- **Checkout is closed while `needsAttention` is true**, with the reason on screen
  rather than only in a `title`. `CartService.view` sets the flag and Phase 6's
  checkout entry refuses on it, so a button leading to that refusal one screen later
  would be worse than a closed one. Every short line carries its own one-click fix
  ("Set this line to 3 units"); a line at zero can only be removed, and says so.
- **Goods value is not called a total.** The cart has no delivery pincode, so
  freight and the GST split cannot be landed here. Both are named on the panel with
  their rate and basis and the screen says there is no third charge — which is the
  honest version available today. It is NOT drip pricing to say which two heads
  follow the address; it would be to show a smaller number called "total". The
  landed figure per supply point is on the offer board (T12) and the full break-up
  is T16's.
- **The archetype is C, not B.** A named cart is one record: identity header, its
  lines as evidence, one actions panel. There is no filter rail and nothing to sort.
  The lines are `DataBoard` — the same table every board uses, at comfortable
  density with T12's 12px cell inset, because six columns at 20px do not fit beside
  a 320px panel.
- **Quantity replaces, so the `?listing=&qty=` hand-off is safe to replay.** A
  reload of the URL `OfferGrid.onAdd` builds re-states the same line instead of
  doubling it; the params are then stripped and `?cart=` is written in their place.

## Reported by T15 — fixed, and it was a live defect

- **There is no `/auth/refresh` route, and nothing in the storefront rotated the
  session.** `tg_access` lives 15 minutes; `tg_refresh` lives 30 days scoped to
  `/api/auth`, and `GET /auth/session` is what rotates it. Without that call a buyer
  who read a spec sheet for a quarter of an hour came back to a cart page telling
  them to sign in **while they were signed in** — the worst version of the
  signed-out state, because it is wrong. `withSessionRetry` in
  `apps/storefront/src/app/cart/api.ts` restores once and replays. Deliberately not
  in `call` itself: a retried `POST /auth/login` would burn two of somebody's
  rate-limited attempts for one try. Every other authenticated screen still has the
  hole.
- **`/sign-in` now honours `?next=`** for buyers, single-leading-slash only so it
  cannot become an open redirect. Without it, an add from the comparison board while
  signed out lost the machine the buyer had picked. Verified end to end with
  Playwright: signed-out → `/cart?listing=…&qty=2` → sign in → back on `/cart` with
  the line added.

## Reported by T15 — not fixed, they are outside my files

- **`CartView` cannot link a line back to its model.** A line carries `offerId`
  (the listing) but no `skuId` and no slug, so there is no way to reach
  `/laptops/[slug]` from the cart — the one navigation a buyer wants when they are
  comparing two lines. `CartLineView` needs `skuId`.
- **No landed price anywhere in the cart.** There is no endpoint that prices a
  listing to a pincode; `GET /public/skus/:skuId/offers` is keyed by SKU and the
  cart has no SKU. Until either the cart takes a pincode or a per-offer pricing read
  exists, the cart cannot show a landed total and T16 is the first screen that can.
- **`cartNameSchema` lives in the API's DTO file** (`z.string().trim().min(1).max(60)`),
  which the storefront may not import, so `CART_NAME_MAX = 60` is restated in
  `cart/api.ts`. It belongs in `@trugrade/contracts`.
- **The empty-name refusal is raw Zod**: "String must contain at least 1
  character(s)". The screen validates before sending so a buyer never sees it, but
  any other client will.
- **There is no way to reach `/cart` from the chrome.** The utility bar and header
  in `09_FRONTEND_LOCKED.md` §7 have no cart entry, so the only route in is the
  comparison board's Add. Not added unilaterally — it changes the header on every
  page and the reference file wins — but T16 needs the same entry point and the two
  should be decided together.
- **`EmptyState` renders an `h3`**, so the signed-out, no-carts and error states of
  this route have no `h1`. Fine for `noindex`, wrong for anything indexed.

## Reported by T14 — decisions, not code

- **This screen is not a second passport, and that is the whole design.** The
  API assembles ONE document and serves it at `/unit/:serial` and
  `/qc/verify/:code`; the storefront now reads it through one function,
  `readPassport()`, with two thin callers. Restating the twelve areas, the
  detected hardware and the wipe certificate here would have put two renderings
  of one document in the product and made a phone scroll for a minute before
  answering the only question being asked of it. `/unit/[serial]` is one tap
  away and carries the rest.
- **Expiry is `--warn` and never `--fail`.** The verdict headline keeps its own
  colour — a machine that passed did pass — and the staleness gets its own band
  saying, in words, that it is not a failure. The kicker above the headline is
  what changes: `CERTIFICATE EXPIRED` in `--warn`. A green PASS with an amber
  band above and below it is the honest arrangement; a red PASS is a lie.
- **A broken seal outranks the verdict, so it is said inside the verdict block.**
  The seed has exactly one BROKEN seal and it rendered a large green PASS with
  the bad news 400px further down. That is a true page arranged into a
  misleading one. `.voidseal` now sits directly under the verdict pills in
  `--fail` and says "do not sign for this machine". `--fail` rather than
  `--warn` because a seal status IS a pass/fail signal — `SealChip` maps BROKEN
  and MISSING to the fail tone for the same reason.
- **MALFORMED does not render the API's own sentence.** `VERIFICATION_CODE.message`
  is *"That verification code was not recognised."*, which describes an UNKNOWN
  code, not a malformed one — rendering it verbatim under a heading that says
  "that is not the shape of one of our codes" contradicts itself, and the two
  states have to read differently. The screen writes its own copy and names the
  shape (14 characters, no I/L/O/U). **The rule message is worth fixing**; it
  lives in `packages/contracts`, which is the other session's.
- **Nothing re-validates the code shape in the storefront.** That is the
  temptation this route has already been burned by: two validators on one column
  disagreeing silently is what made every unit answer 422. One validator, at the
  boundary that owns the column; the screen renders the answer.
- **The ERROR state claims nothing.** It used to be worded like T13's ("the
  certificate and the machine exist") — but if we could not reach our own
  records we do not know that the code is one of ours, and asserting it is
  asserting the very thing the check failed to establish. It now says it is
  neither a yes nor a no.

**Live anonymity sweep:** 25 `GET /api/qc/verify/:code` payloads against the
seeded database, checked for every `identity.organization` id, legal name and
trade name, for any UUID at all, and for `gstin` / `org_id` / `vendor` /
`address` / `phone` / `supplyPoint` / `s3Key` / the four NCR city names. **Zero
hits, and zero UUIDs.** The unit suite repeats it over the rendered HTML with
`findVendorIdentityLeaks`, on the found screen and on all four refusals.

## Reported by T14 — not fixed, they are outside my files

- **`QrBlock` in `packages/ui` is a conic-gradient checkerboard**, and
  `09_FRONTEND_LOCKED.md` §4 says of the QR motif specifically: *real QR in
  production, never decorative*. A checkerboard on the one page whose entire job
  is to be scanned is the one thing §4 forbids a motif to be. This route
  therefore draws its own SVG with `qrcode-generator` — the same library the API
  already uses for the printed report's QR, so paper and screen encode the same
  URL through the same encoder. **The fix belongs in `QrBlock`**: take the
  library, keep the polarity fixed with `--chrome` on `--on-chrome` (the two
  tokens that do not flip between themes — a scanner will not read an inverted
  symbol, so `--ink` on `--sheet` is wrong by construction), and keep four
  modules of quiet zone.
- **`Barcode` does not encode anything.** Its bars are derived from
  `charCodeAt` arithmetic, which is stable per code and is not Code 128. §4 says
  the strip *encodes the seal code*. It is beside the code it stands for, which
  is the half that carries information; the other half is a real symbology.
- **Every inspection photograph in the dev bucket is a generated stand-in** that
  prints "STAND-IN — NOT A PHOTOGRAPH" across itself. The zoom, the brackets and
  the serial caption are all real and exercised; the pictures are not. Worth
  knowing before anyone reviews these captures for photographic quality.
- **The seed contains no FAIL, no PASS_WITH_NOTE and no MISMATCH** — all 239
  reports are PASS — so the `--fail` verdict path is covered by the unit suite
  and by nothing on screen. A single seeded FAIL would make that state
  photographable.
- **`AuthShell` centres its card vertically**, which is right for a 300px
  credential form and wrong for a short refusal: the answer floated halfway down
  the window. Worked around here with `.authwrap.solo:has(.verify) .authcard`.
  An `align` prop on the shell would say it better than a `:has()` in a
  stylesheet.

## Reported by T12 — the endpoint that did not exist, and what it cost

`GET /api/public/offers` is the HOMEPAGE grid: one row per (SKU, grade), a price
RANGE and a COUNT of supply points, aggregated precisely so it cannot name a
source. The comparison board needs the opposite shape — one row per supply point
— so `GET /api/public/skus/:skuId/offers?pincode=&grade=` is new, and lives in
`listing` beside the stock it reads.

Four things about it are decisions rather than code:

- **`pincode` is optional and its absence is a distinct answer.** `delivery` is a
  three-armed union: `NONE`, `DELIVERABLE`, `UNSERVICEABLE`. "Nobody has told us
  where to deliver" and "we cannot deliver there" are different sentences, and a
  screen that renders the first as the second tells a buyer in Bengaluru we
  refuse them when they have not typed anything yet. With no pincode the board
  returns its evidence — grades, unit counts, supply-point counts — and no
  prices, and the screen asks. **No pincode is invented**: a delivered price to
  somewhere the buyer never named is worse than an empty state, and quoting a
  "from" figure that grows at checkout is drip pricing (CCPA 2023). `/search`
  made the same call in T11 and the two screens agree.
- **The row is `(supply point, valuation pool, listing)`.** `(code, city)` is the
  supply point and never the code alone — the seeded board has an `F` in Noida
  and a different vendor's `F` in Faridabad, and grouping on the letter welds
  them into one row without failing anything. The valuation method is part of the
  key because a MARGIN unit gives thinner input credit at the same price.
- **A lane we could not price is not a row.** `unpricedSupplyPoints` counts them
  so the screen can say so; a landed price missing its freight is a price
  misrepresentation under CP e-Comm r.6(5).
- **`landedPriceForBuyer` could not be called from a public route.** It reads the
  listing through the scoped repository, and `OrgScope` throws
  `org_scope_without_principal` for an anonymous caller — it says in as many
  words that a public endpoint must come through a public repository method. So
  `publicPricingFacts` + `landedPriceForPublicOffer` are the public path, and
  both ends call the same `landedPrice()`: one definition of what a buyer pays,
  reached two ways.

**Measured:** board p95 **190 ms**, median 104 ms (40 runs across four delivery
pincodes, ten supply points, 105 sellable units, freight batched into one call),
against the 500 ms budget in PHASE_05 Task 5.

Integration is **549/549 across 29 suites** (was 523/28); storefront unit tests
are 58 across 9 suites (was 45 across 8). The new suite drives the board rather
than asserting a guard exists: it groups two vendors both labelled `F`, reads
back two rows, and fails if they merge; it sweeps the serialised payload for
every seeded vendor's id, legal name, address, phone and dispatch pincode with
`findVendorIdentityLeaks`; and it checks the order is unchanged after a vendor's
legal name is rewritten to sort last.

## Reported by T12 — fixed, and it is `apps/api/src/modules/qc`

- **`VendorQualityService.qualityForSupplyPoints` was unreachable from any other
  module.** It is the read model the whole comparison board sells on, it is
  correct, it is tested — and it was neither on `IQcService` nor exported from
  the barrel, so the only way to reach it was to import `qc/internal/`, which the
  `no-cross-module-import` rule forbids. `QcService` now delegates to it in three
  lines and the barrel re-exports the two types the answer needs. The
  alternative was reading `qc.vendor_sku_quality` from `listing`, which would put
  the small-sample suppression — the one thing in that file with legal
  consequences under r.7(2) — in two places.

## Reported by T12 — not fixed, they are outside my files

- **`OfferRow` hard-codes `variant="primary"` on its action, so a ten-row board
  renders ten amber buttons.** `09_FRONTEND_LOCKED.md` allows one amber control
  per screen, and `docs/reference/homepage.html` draws exactly that: `.sel` on
  the best row and `.sel.gh` on the rest. The component takes no emphasis prop
  and `packages/ui` is outside this task's files, so the board ships with ten.
  **One prop fixes it** — `OfferRowProps.emphasis?: 'primary' | 'secondary'`,
  defaulting to secondary, with the caller marking the lowest-landed row.
- **`SupplyPointOffer.batteryHealthPct` has no denominator.** The row renders
  `87–94%` for a supply point where ten of twelve units were measured, and
  CLAUDE.md asks every percentage to carry its denominator. The API returns
  `batteryMeasured` and the component has nowhere to put it; the per-unit list
  below the board prints "Not measured" per serial, which is the honest half that
  is reachable today. `batteryHealthPct: { min, max, measured, of }` is the fix.
- **`OfferGrid` computes "Lowest landed" within its own grid**, so running MARGIN
  and REGULAR as two visually distinct pools (PHASE_05 Task 5) puts the label on
  the cheapest MARGIN row as well. The pool note says out loud that the rows are
  ranked among themselves; a `lowestLanded` override on the grid would say it
  better.
- **There is no public URL for a condition image.** `GET /catalog/skus/:id?grade=`
  returns `s3Key`, `altText` and the match level, and nothing serves a key to a
  browser — no presigned-download route, and the dev bucket holds zero objects
  against 608 catalogued rows. The page therefore renders ONE
  `RepresentativeImage` placeholder with its mandatory caption and says how many
  photographs are catalogued for that grade, rather than six broken images with
  six identical captions. A `GET /public/condition-images/:id` that presigns for
  60 seconds is the missing piece, and it belongs in `catalog`.
- **`truetech_warranty` is `NONE` on every seeded listing**, so the term a
  customer is sold is not stored anywhere before a sale — `platform.warranty` is
  written at order time. The board computes it the way the PRICE was computed:
  `max(vendor months + the margin rule's top-up, platform.warranty_min_total_months)`,
  in `PricingService.customerWarrantyMonths`. The listing column is what should
  carry it, written when the listing is priced.
- **The freight on this board is Rs 149 to every NCR pincode and Rs 298 to
  250001**, straight off `logistics.carrier_rate_card` (0.01–5 kg, NCR→NCR, base
  149, ODA surcharge 149). The task brief quoted Rs 284 / Rs 433, which no row in
  the seeded card produces — worth reconciling before those numbers appear in a
  test.
- **`catalog.model` has no `slug`**, so `/laptops/[slug]` takes the SKU id, which
  is what T11's cards already link to. A real slug is an SEO decision and a
  catalog column, not a storefront workaround.

## Reported by T10 — what MFA actually is today

**There is no TOTP anywhere in the platform, and the backlog asks for it on owner
accounts.** Checked rather than assumed: `grep -ri totp apps/api/src prisma/schema.prisma`
returns nothing at all. What exists is
`TOTP_POLICY` in `packages/contracts/src/rules.ts` — digits, step, drift, and the
string "Enter the 6-digit code from your authenticator app" — and `otplib` sitting in
`apps/api/package.json` dependencies, imported by no file. There is no
`user_totp_secret` table, no enrolment route, no QR, no recovery codes.

So the second factor a VENDOR_OWNER meets today is `POST /auth/mfa/otp`: a
six-digit code emailed to `user_account.email`, the same mailbox the password
reset goes to. **That is one factor asked twice, not two factors.** Whoever holds
the mailbox holds the account, with or without the password.

The screens say so rather than borrowing the word. `MfaChallenge` in
`packages/ui` prints, under every challenge in both portals:

> This second factor is a code to the address on the account. An authenticator
> app is not supported yet, so it is a second code rather than a second device.

Two consequences that are decisions, not code:

- `POST /auth/login/otp` **refuses to send a sign-in code to any account in
  `MFA_REQUIRED_ROLES`**. Passwordless sign-in plus an emailed second factor would
  be mailbox-only access to an account that can change where money is paid. Those
  accounts sign in with a password, which is at least a second secret. The refusal
  is silent — a visible one would be the enumeration answer in a different hat.
- `POST /auth/password/forgot` is open to them, because a reset ends in a password
  and the factor still has to be satisfied afterwards. It does mean mailbox access
  is enough to take an owner account today. **Real TOTP enrolment is what closes
  that**, and it is a schema change plus a route, not a label.

## Reported by T10 — four auth routes did not exist

The backlog asks for "OTP-first with password secondary" and "forgot-password,
reset". None of the four routes those need existed; `/auth/*` had register, login,
logout, session and the MFA pair and nothing else. Built in
`apps/api/src/modules/identity`, minimally:

| Route | What it does |
|---|---|
| `POST /auth/login/otp` | Sign-in code to an existing account. Declines `MFA_REQUIRED_ROLES` silently. |
| `POST /auth/login/otp/verify` | Redeems it and issues a session. |
| `POST /auth/password/forgot` | Reset code. Open to every account. |
| `POST /auth/password/reset` | Sets the password, 204, and revokes every session. |

Three things about them are worth carrying forward:

- **The enumeration defence is structural, not verbal.** `OtpService.issue` took a
  new `deliver` flag: `false` runs the whole issue — all three rate-limit windows,
  the supersede, the row — and skips only the send. Without it only a *known*
  address could ever be rate-limited, so a 429 on the second request was a yes.
  `sentTo` is a mask of what the caller typed, never of what we hold. Both verify
  routes flatten every way a code can fail into one sentence, because "wrong, 4
  attempts left" and "expired" are distinguishable only for an address that has an
  account. `test/integration/sign-in.spec.ts` compares the two paths field for
  field rather than asserting that a guard exists.
- **`loginWithPassword`'s tail became `completeLogin`**, shared with the code path.
  The ACTIVE check, the suspended-organisation check, the lockout reset, the token,
  the session row and the audit line are one copy. A second copy of "is this
  organisation suspended" is the copy that gets forgotten.
- **A reset revokes every session and clears the lockout budget.** A reset that
  leaves the intruder's thirty-day refresh token alive has changed a string.

## Reported by T19/T20 — fixed, and they were live defects on every board

Both were found by taking the 600px capture and noticing the header spanned 600px
while the page behind it was 743px wide. Neither is in `apps/account`; both are in
`apps/storefront/src/app/storefront.css`, which this task owns, and both were
already shipped.

1. **`.cols` was `grid-template-columns:1fr` below 900px.** `1fr` is
   `minmax(auto,1fr)`, and a grid item's automatic minimum is its MIN-CONTENT
   width — so a table with `min-width:940px` widened the grid item, then the
   document, and the whole PAGE scrolled sideways under a header that did not.
   The desktop rule was always `minmax(0,1fr)`; the mobile one was not. Fixed by
   making them agree. `/search?view=list` at 600px scrolled 550px before this.
2. **`.tbl` was not a containing block.** `DataBoard` renders its caption and its
   `aria-live` region with Tailwind's `sr-only`, which is `position:absolute`,
   and the table's own `overflow-x:auto` wrapper is not positioned — so those two
   1px boxes resolved against the initial containing block, escaped the wrapper's
   clip at the far right of a 940px table, and made the document scroll. Pinned
   with `position:relative` on `.tbl`; see the gap below for the real fix.

Verified after: nine storefront routes at 600/900/1440 all report
`scrollingElement.scrollLeft === 0` after being pushed right.

## Reported by T21 — fixed here

1. **The order record rendered the site header TWICE.** `/account/layout.tsx` has
   `SiteHeader`, and when T17's record moved from `/orders/[orderNumber]` to
   `/account/orders/[orderNumber]` its own layout kept one too — so the utility
   bar, the logo, the search box and the account buttons were drawn twice on every
   order screen, in both themes, at every width. A nested layout inherits its
   parent's chrome; it does not restate it. Fixed by making the record's layout
   carry only the sub-route nav.
2. **`qc_hardware_detected.battery_health_pct` is NUMERIC, and `$queryRaw` hands a
   NUMERIC back as a STRING.** The field was typed `number | null` on an interface
   and was in fact `"87.50"`. Nothing failed loudly: the bar rendered, because
   `Math.round("87.50")` works. The average above it would have been
   `("82" + "93") / 2` — string concatenation, then division, reporting a fleet of
   machines at 4146% battery health. Fixed with `::float8` in the one query that
   reads it, and asserted with `typeof` rather than a value.
3. **A descending sort flipped nulls-last into nulls-first.** The comparator put
   an unmeasured battery last, and the board reversed the comparator's sign for a
   descending sort — which reversed the null handling with it and put the machine
   nobody measured at the top, as if it had the best battery on the order. A
   comment claimed the opposite. Fixed by applying the direction to the comparison
   of two PRESENT values only, and both directions are asserted.
4. **The seed's QC estate was a monoculture** — 239 reports, every one
   `PASS` / grade `A` / seal `APPLIED`, one absent battery. The ledger has carried
   this as a known gap since Phase 4. `prisma/seed/qc-spread.ts` now derives
   `PASS_WITH_NOTE` from the WARN area results `seedQcEvidence` already writes
   (seven of twelve areas carrying a finding, about a sixth of the estate) and
   puts one FAIL, one MISMATCH, one broken seal and three grade corrections on
   ALLOCATED units only. It has to be allocated-only: `listing.unit_is_sellable`
   looks at status, QC dates and the seal and **not at the verdict**, so a FAIL
   written onto a LISTED unit would put a failed laptop on the storefront. That is
   worth a look in its own right.

## packages/ui gaps reported by T19/T20 — fix when a task needs them

- **`DataTable`'s scroll wrapper needs `relative`.** `packages/ui/src/components/data.tsx`
  wraps the table in `div.w-full.overflow-x-auto`; its `sr-only` caption and live
  region are `position:absolute` and therefore escape that wrapper's clipping.
  Adding `relative` to that div fixes it for every consumer and lets
  `.tbl{position:relative}` in the storefront be deleted. The console has the same
  latent bug in thirteen places and has never been measured for it.
- **`QueueItem.slaHours` is required and `number`.** A queue with no promise
  attached to it therefore cannot be rendered at all without inventing one, which
  is why T19 renders a single queue plus a plain calm panel rather than two
  queues. Making it optional — rendering "No SLA set" the way `breachedCount`
  already renders "Breaches not measured" — would let an honest second queue exist.
- **`EmptyState.body` is typed `string`.** Still true, still the reason T17's
  not-your-order screen is hand-rolled: two order numbers in one sentence both
  have to be mono and a `string` cannot carry a `<span className="mono">`.

## Reachability, measured by T19 — states that exist and cannot be reached

- **A buyer with no orders.** One buyer organisation on the dev database has all
  thirteen orders and the other verified buyer orgs have no users to sign in as.
  `scripts/t19-shots.mjs` reaches the state by moving `ordering."order".buyer_org_id`
  to another verified buyer org for the length of one capture and putting it back
  in a `finally`, printing the rows before and after. No fixture was invented.
- **An approval that has actually expired, or been declined.** Still unreachable
  by driving the UI: there is no approve/reject endpoint (PHASE_06 Task 2 built
  the policy and the row, not the decision screens). T17 borrows the columns for
  its captures; T19 does the same for the near-deadline one.

## Reported by T10 — fixed, and they were live defects

- **`kyc_review.notes` reached nobody.** `KycService.decide` refuses to record a
  rejection without a reason *because "the applicant sees it"* — and nothing
  showed it to them. `GET /onboarding/steps` returned `status: 'REJECTED'` and no
  reason, and `Review.tsx`'s own copy said "The reason is below" above a panel that
  had nothing in it. `OnboardingSummary` now carries `decision`
  (`decision / notes / reasonCodes / decidedAt`) and `ApplicationStatus` renders
  the notes verbatim, on the sign-in outcome and on both registration reviews.
  `T10-rejected-with-reason-*` is a real reviewer's sentence through the real route.
- **`ApplicationStatus` printed a live SLA on a decided application.** A rejection
  rendered "TIME REMAINING · 19 hours" directly under it, because the block was
  unconditional. Now shown only while the application is with us. The API half is
  below.
- **`isUpToDate()` in `test/support/db.ts` hard-coded `-d trugrade_test`.** It
  asked whether the *shared* database was migrated whatever `DATABASE_URL_TEST`
  said — so the private-database escape hatch that `test/support/env.ts` exists to
  provide answered "up to date" for a database that had never had a migration run,
  and every suite failed on a missing relation. The concurrency fix and the
  migration check now agree on which database they mean.
- **The storefront wordmark was invisible in light theme on the auth pages.**
  `.brand` is `--on-chrome` and `.wm .g` is raw `--acc`; both are right in the dark
  header and wrong on a working surface. "tru" rendered near-white on the paper
  ground, and `09_FRONTEND_LOCKED` §2 forbids raw `--acc` as a text colour on a
  light surface. Scoped to `--ink` / `--acc-ink` inside `.authcard`.
- **Two registration test stubs returned a `Response` with no `headers`.** Fixing
  the stubs rather than making the client defensive: `api.ts` reads `Retry-After`
  off every refusal, and a client that tolerates a headerless response is a client
  that quietly stops reading the header.

## Reported by T10 — not fixed, they are outside my files

- **`decide()` clears `review_sla_due_at` only on APPROVE.** A REJECTED or
  INFO_REQUESTED organisation keeps a due date that has already been met, so
  anything reading that column believes a promise is still outstanding. The screen
  refuses to print it; the column is what should change.
- **Nothing exposes `IdentityService.suspendOrganization`.** No controller anywhere
  calls it, so an organisation can only be suspended with SQL — which is what the
  capture script had to do. The refusal it produces at sign-in is real
  (`completeLogin` throws it); the way in is not.
- **`GET /onboarding/steps` is `@RequireRoles(...OWNER, ...ADMIN)`**, so a plain
  CUSTOMER_BUYER in a REJECTED organisation signs in and lands in the shop with no
  explanation. Both sign-in screens treat a 403 there as "this person does not own
  the application" and send them on, which is right for a pending org and wrong for
  a refused one. A member-safe read of the org's status — even just the status —
  would let the screen say something true to them.
- **`RateLimiter`'s message is a fixed duration, and its comment calls a live
  countdown "a dark pattern the CCPA guidelines name".** `auth-and-scope.spec.ts`
  asserts the wording. The backlog asks for the opposite, and both are right about
  different things: the guidance is about *manufactured* urgency that pushes
  somebody to act, and this is a wait the product has already imposed. Resolved by
  doing both — the server's sentence verbatim, and the exact remaining seconds
  ticking beside it off `Retry-After`. The server was not changed and that test
  still passes.
- **The registration and OTP budgets are still keyed on IP alone** (T6 and T7
  reported it; `auth-account-otp-ip` is the same shape). `scripts/t10-shots.mjs`
  clears them, and now also clears all three per-target OTP windows — a full
  capture asks one supplier owner for four codes, and `OTP_POLICY` allows five an
  hour.

## packages/ui — two components added, both because two apps needed them

- **`RateLimitNotice`.** The server's sentence plus a live `mm:ss` in mono with
  `tabular-nums`, and no timer at all when no `Retry-After` arrived — a wait we did
  not measure must not be drawn as a number we made up. Both portals use it.
- **`MfaChallenge`.** The second-factor exchange — six boxes, sixty-second
  cooldown, resend, the honest note about what the factor is — with the two network
  calls injected rather than imported, because the console cannot import from the
  storefront. `register/MfaGate.tsx` is now a 20-line binding over it rather than a
  second implementation; the console has the other binding. Its heading, reason and
  factor note are props, which is how the same panel serves a registration gate, a
  sign-in code and a second factor.

## Reported by T9 — fixed, and it is `apps/api`

- **The penny-drop's retry policy and its audit row hashed different values, so
  both controls that read `input_hash` were wrong.** `pennyDrop` called
  `assertRetryAllowed` with `hash(accountNumber + ':' + ifsc)` while `record`
  stored `hash(accountNumber)`. Two consequences, both live:
  - the five-a-day limit filtered `verification_check` on a hash that matched no
    stored row, so **it never bound at all** — a payout account could be probed
    without limit;
  - `checkForValueShopping` never saw the pending hash among the stored ones, so
    it counted every attempt as a new distinct value. A supplier who mistyped an
    account number once, corrected it and pressed save had their application
    **paused for suspected fraud on the second attempt**.

  Found by driving the real screen: the capture run could not get past step 6.
  Fixed by hashing the account number in both places. Value-shopping on a payout
  account is still two distinct values a day, which is right — one company, one
  payout account, so a third is a pattern — and `T9-pennydrop-paused-*` shows it
  rendered as an application-level pause rather than a field error.

## Reported by T9 — not fixed, they are outside `apps/storefront`

- **`requestFix` never moves `organization.status`.** It writes
  `onboarding_progress.status = NEEDS_FIX` and a `blocking_reason` and stops, so
  an application with a step sent back is still `KYC_SUBMITTED` — and the status
  screen would read "nothing more is needed from you right now" directly above a
  panel asking for a document. `ApplicationStatus` derives `INFO_REQUESTED` from
  `needsFix.length > 0` instead. The org status is the thing that should change.

- **The step 7 seed promises something the platform does not do.**
  `onboarding_step_definition` describes AGREEMENT as "The vendor agreement, the
  grading policy and the data-wipe undertaking, **e-signed**." There is no e-sign
  adapter anywhere in `apps/api/src/shared/adapters` — `AADHAAR_ESIGN` is a
  string in `CheckType` with nothing behind it — so the step says out loud that
  an acceptance is *recorded*, not signed. `RegisterFlow` now takes
  `purposeNotes` so the flow can replace a seeded note that is not true; the seed
  is what should change, and that prop should shrink rather than grow.

- **`agreement_acceptance` has no route.** The table has `agreement_code`,
  `version`, `doc_hash`, `ip`, `user_agent` and `esign_ref`, and nothing writes
  it. Step 7's four acceptances therefore live in the AGREEMENT step draft, in
  that table's own column names so a promotion is a mapping. There is also no
  seeded catalogue of agreements, so the four codes, their versions and their
  summaries are in `picklists.ts` with the usual note.

- **`document_type_rule.requires_expiry` is data with nowhere to put an answer.**
  CPCB and ISO certificates carry `requires_expiry = TRUE`, and
  `POST /onboarding/documents` accepts only `documentDate`. The step says who
  reads the validity date instead of showing a field that goes nowhere.

- **`vendor_payout_preference` has no route either**, so `pricing_mode`, the
  cycle and the threshold are the AGREEMENT draft, again in the column names.
  The three lists behind them — `PRICING_MODES`, `PAYOUT_CYCLES` and the
  ₹1,000 floor — are in `picklists.ts`; two of the three exist as CHECK
  constraints and were copied verbatim, and the floor is
  `platform_config.procurement.min_payout_threshold_inr`, which no route exposes
  to a browser.

- **Nothing tells a client an org's tier**, so "cycle earned by tier" (Q6) cannot
  be evaluated on screen. Every applicant here is new, so the step records
  `T_PLUS_2` as a *request* and says plainly that the weekly run applies until it
  is granted — rather than granting a cycle we would not honour or refusing one
  silently. A tier on the session or on `GET /onboarding/steps` would let the
  screen say which.

- **The promotion gap bites a sixth time.** `organization.constitution` is null,
  so the constitution gate on `board_resolution` returns "optional" for a private
  limited company that plainly needs one. Step 6 falls back to step 2's own
  answer, exactly as step 3 does for VR-008; the fallback deletes itself the day
  a BUSINESS_PROFILE promotion lands.

- **`RegisterFlow` linked every completed step back to `/register`**, hard-coded,
  so a supplier who clicked a finished step in the rail landed in the *buyer*
  form. Fixed storefront-side with a `basePath` prop.

## packages/ui gaps reported by T9 — fix when a task needs them

- **`Input` has no prefix/suffix affix.** A rupee amount and a percentage both
  need their unit beside the field; the two on step 7 carry it in the label
  ("Smallest amount worth paying you, in rupees") because inventing an affix in
  the app would be the second table all over again.
- **No radio-group component.** `register/Choice.tsx` is a null-default single
  select, and `register/YesNo.tsx` is the same shape with two fixed options.
  `YesNo` should fold into `Choice`, and both belong in `packages/ui` beside
  `Checkbox` — a form system with a `Checkbox` and no radio is half a system.

## Wave 2 closed — what it left behind

Registration and auth are complete for both portals: buyer 5 steps, vendor 7, both
sign-ins, MFA, and every surrounding state. Integration is 500/500 across 27 suites.

Three things Wave 2 proved are MISSING and that later waves depend on:

1. ~~**No step promotion.**~~ **CLOSED 27 Aug, commit c04c5f5.** All six promotable steps now
   write their owning tables inside the completion transaction. `organization.constitution` is
   written, which armed the three rules T5/T7/T9 each found inert. Reported independently by T5, T6, T8 and T9. A COMPLETE step's
   answers live only in `onboarding_progress.draft_json`; `vendor_capability`,
   `vendor_facility`, `facility_hours`, `org_address`, `org_contact`, `gst_profile` and
   `bank_account` all stay EMPTY no matter what an applicant enters. Every screen that
   reads a promoted table — the whole vendor portal in Wave 5 — has nothing to read.
   **This is the single largest blocker for Waves 5 and 6.**
2. **No TOTP.** `mfa_secret_enc` exists as a column referenced only by the audit
   redaction list. Owner accounts are protected by an emailed code today.
3. **No route sets `SUSPENDED`**, and `suspendOrganization` has no caller.

## The step-promotion gap — measured, and the fix is mechanical

Measured against the live dev database, not inferred:

```
onboarding_progress = 642      vendor_capability = 0    vendor_facility = 0
vendor_profile      = 0        org_contact       = 0    gst_profile     = 0
org_address         = 2  (demo seed, not onboarding)
bank_account        = 5  (T9's POST /onboarding/bank-account writes explicitly)
```

642 drafts have produced zero rows in every table the rest of the product reads. Only
`bank_account` is written, and only because T9 built a route that commits it directly.

**The architecture is already right; the wiring is absent, and it is documented as absent.**
`OnboardingService.completeStep(orgId, stepCode, promote)` calls `promote(draft)` and THEN
clears `draft_json`. `kyc.controller.ts` currently passes a callback that writes an audit
row and nothing else, with a comment saying plainly that no module has registered a
promotion yet, and a `ponytail:` marker naming the upgrade: the owning module exports a
promotion through its barrel and the handler passes it — not a bigger controller.

**Consequence today, beyond Waves 5-6:** because `draft_json` is cleared on completion and
nothing takes its place, a completed step's answers survive only in the client's memory.
T9 had to make `RegisterFlow` MERGE server answers rather than replace them, or "the review
screen emptied one step at a time". So a cold reload after completing steps is expected to
lose them — worth confirming and fixing as a Wave 2 defect, not only a Wave 5 blocker.

**The fix, per step code, each owned by the module that owns the table:**

| Step | Promotes into | Owning module |
|---|---|---|
| BUSINESS_PROFILE | `organization` (constitution!), `vendor_profile` | identity / vendor |
| STATUTORY | `gst_profile`, `pan_record` | kyc |
| CONTACTS_ADDRESSES | `org_address`, `org_contact` | identity |
| CAPABILITY | `vendor_capability` | vendor |
| FACILITY_CONTACTS | `vendor_facility`, `facility_hours`, `facility_holiday` | vendor |
| DOCUMENTS_BANK | `bank_account` (already done by its own route) | kyc |
| AGREEMENT | `agreement_acceptance`, `vendor_payout_preference` | vendor |

`organization.constitution` is the highest-value single field: T5, T7 and T9 all found rules
that read it and are therefore inert (the CIN requirement, VR-008, the board-resolution gate).

T8's draft keys already use the destination tables' own column names, so those two steps are
a mapping rather than a redesign.

## Open questions

### 1. Value-shopping pauses an honest multi-state buyer. Commercial call, not a coding one.

`checkForValueShopping` throws ConflictError and pauses an application at the THIRD
distinct value for a check type in 24h. That is right for PAN, CIN, TAN and a payout
account — one company, one lawful answer, so a third is a pattern.

It is wrong for GSTIN, and registration step 3 is where it bites: one legal entity holds
one GSTIN **per state it is registered in**, and that step exists to collect the extra
ones. A buyer operating in Delhi, Haryana and Karnataka is paused for suspected fraud
while entering exactly what we asked them for.

Raising the threshold for GSTIN was the obvious fix and I did not take it — it weakens a
fraud control without making it correct, and how many registrations we tolerate before
pausing is your decision. The screen renders the pause honestly as a "Checks paused"
banner rather than a field error, so nothing is silently broken today.

**The sharper rule, if you want it instead of a number:** characters 3-12 of a GSTIN ARE
the holder's PAN. Every GSTIN one org submits must carry the SAME embedded PAN — three
state registrations of one company share one; three companies' GSTINs do not. That
catches shopping on the second attempt and never fires on a legitimate multi-state buyer.
It needs the embedded PAN stored beside the hash in `verification_check`, so it is a
schema change rather than a constant. Say which you want.

_Nothing else open. A blocked task is recorded here with what was tried, marked BLOCKED in
the table, and skipped — the run does not idle waiting for an answer._

## Resolved

**`cn()` stripped every colour class** — raised by T2, fixed in 944eac9.
`tailwind-merge` resolves from a map of Tailwind's DEFAULT classes and had never seen
this preset's ten custom sizes, so `text-body-sm` fell back to "colour" and dropped the
real colour beside it. Every amber primary action rendered --ink-2 on --acc: 1.7:1
measured, against the 11.2:1 in 09_FRONTEND_LOCKED section 9. `cn()` now extends
tailwind-merge with the preset's font-size group; browser-measured 11.09:1 in both
themes. `cn.spec.ts` reads the preset so a size added there and not here fails loudly.

**The API did not boot** — raised by T2, fixed in 944eac9. `DocumentService` was injected
into `OnboardingController` and missing from `KycModule.providers`. Typecheck, lint and
every unit test passed; only starting the process found it.

## Reported by T8 — not fixed, they are outside `apps/storefront`

- **`vendor_capability.can_dropship` and `can_provide_serials_upfront` both
  default to `TRUE`, and both are questions with two real answers.** A column
  default is the answer the database gives when nobody asked, and on these two
  that default is the commercially convenient one. The screen refuses to inherit
  it — `YesNo` holds `null` until somebody presses a radio — but the defaults
  mean any *other* writer of these rows (an import, a back-office form, a
  fixture) asserts "yes, they can dispatch direct" on a supplier's behalf.
  `DEFAULT NULL` with a NOT NULL added at promotion would say what is true.

- **`vendor_facility.dispatch_address_id` is nullable and means "the facility
  address".** That is a reasonable normalisation and a dangerous read: every
  consumer has to remember the fallback, and the one that forgets prints the
  wrong **Dispatch From** on an e-way bill. The screen makes the choice explicit
  and prints back the address that will actually be used, but nothing in the
  schema distinguishes "same as the facility" from "never asked".

- **`vendor_capability.sourcing_channels` is a bare `TEXT[]`** — no CHECK, no
  enum, no contract. The eight codes the form offers exist only in
  `apps/storefront/src/app/register/picklists.ts`. Category, facility type and
  vehicle access all have CHECK constraints and were copied from them verbatim;
  this one had nothing to copy.

- **`facility_hours.day_of_week` is `INT CHECK (0..6)` with nothing saying which
  end is Sunday.** Taken as the JavaScript convention (0 = Sunday) because that
  is what every client reading it back will assume, and written down in
  `WEEK_DAYS`. It should be a comment on the column or an enum.

- **No `onboarding_field_requirement` rows for CAPABILITY or FACILITY_CONTACTS.**
  Both steps return an empty `fields` array, so unlike step 3 nothing on these
  two screens is server-driven. That is survivable — neither step has a
  constitution gate — but it means the shape of the two biggest forms in the
  vendor flow lives entirely in the client.

- **Still no step promotion** (T5, T6 and T7 all reported it). `completeStep`
  clears `draft_json`, so once step 4 or 5 is COMPLETE its answers exist only in
  the audit row. `vendor_capability`, `vendor_facility`, `facility_hours`,
  `facility_holiday`, `org_address` and `org_contact` all stay empty. The draft
  shapes written here use those tables' own column names precisely so a
  promotion is a mapping rather than a redesign.

## Contracts gaps reported by T8

- **No option list for supply category, sourcing channel, facility type,
  vehicle access or contact type.** Three of the five are CHECK constraints in
  the baseline migration and were copied verbatim; two are not defined anywhere.
  All five are in `picklists.ts` with the same note the T4–T7 lists carry: they
  belong in `@trugrade/contracts` or `platform_config` before the vendor console
  grows a filter that has to agree with this form.
- **No grade list in contracts either** — but the catalogue has one, so step 4
  reads `GET /public/grades` and splits stock across whatever it returns. When
  it does not answer, the question is stood down rather than asked against a
  guess. That is the pattern the five lists above should follow.

## Reported by T7 — not fixed, they are outside `apps/storefront`

- **A vendor could not register at all, and nothing said so.** `VENDOR_OWNER` is
  in `MFA_REQUIRED_ROLES`, so `POST /auth/register` returns `mfaRequired: true`
  and `AuthGuard` then refuses every non-public route — `POST /onboarding/start`
  is a 403 on the very next call. Fixed screen-side by `register/MfaGate.tsx`,
  which is now part of step 1 and of a resumed session. Two API problems remain
  underneath it:
  - **`GET /auth/session` reports `mfaRequired: false` for a session that has
    not satisfied MFA.** When a principal resolves — which it does on that
    `@Public()` route even with `mfa: false` in the token — the handler returns
    a hard-coded `false`. Only the refresh branch reads the claim. A client
    therefore cannot ask whether a factor is outstanding; the flow has to infer
    it from a 403 on the next call, which is what it now does.
  - **`mfa/otp` sends a code to the address the applicant verified sixty seconds
    earlier.** Correct as a second factor for a *login*, thin as one during
    registration: the same mailbox proves the same thing twice. The backlog
    (T10) says "mandatory TOTP for owner accounts", and there is no TOTP
    enrolment anywhere in the API — `AADHAAR_ESIGN` is the only other factor in
    `CheckType`. The panel is honest about what it is; the enrolment is missing.

- **No verification route for CIN, LLPIN, Udyam or TAN.** `CheckType` names
  `UDYAM` and `CIN`; no controller exposes either, and `TAN` is not in the union
  at all. So step 3 captures all four and says, once and out loud, that it checks
  the format and nothing else — "Captured — not verified", never a tick. When a
  route lands, the fields already render from `onboarding_field_requirement` and
  only the outcome panel has to be wired.

- **`onboarding_field_requirement` seeds `incorporation_date` on STATUTORY; the
  backlog puts it on step 2.** Both are defensible and asking twice is not, so
  `VendorRegistration` drops it from step 3's list (`ASKED_EARLIER`) and step 2
  owns it. The seed and the step that actually asks should agree — a client-side
  filter over server-side data is the wrong place for that decision to live.

- **`onboarding_field_requirement` has no row for TAN.** Declared client-side in
  `VendorRegistration.tsx` in the endpoint's own shape, so it renders and
  validates like the seeded four and so the constant is what gets deleted when a
  row appears.

- **The registration rate limits are still keyed on IP alone** — T6 reported the
  OTP one, and `auth-register` (10 a day) is the same shape. Four accounts is one
  capture run. `scripts/t7-shots.mjs` clears the dev keys explicitly and says why;
  in production one applicant behind an office NAT locks out the building.

- **`Input mono` does not set `tabular-nums`.** Browser-measured
  `font-variant-numeric: normal` on every GSTIN, PAN, CIN, Udyam, TAN and PIN
  input in both flows. Visually a no-op in IBM Plex Mono, whose digits are already
  fixed-width, but CLAUDE.md asks for it on every number and the fix belongs in
  `Input`'s `mono` branch in `packages/ui`, not in six call sites.

- **`statutory.spec.tsx` timed out under `pnpm test`'s parallel load** once the
  vendor flow added four fields to the step it renders: seventy `act` flushes of
  a bigger form crossed Jest's default five seconds, and timing out inside
  `useFakeTimers` skipped the `useRealTimers` cleanup, which turned one failure
  into six. Given an explicit 30 s timeout, with the reason written above it.

## Contracts gaps reported by T7

- **No option list for a vendor's business category or monthly volume.**
  `vendor_profile.business_category` is a free `String` and
  `.monthly_volume_estimate` a bare `Int`, so nothing defines what may go in
  either. Written in `picklists.ts` beside the buyer's five, same report: they
  belong in `platform_config` or contracts before the vendor console grows a
  filter that has to agree with this form.

## packages/ui gaps reported by T2 — fix when a task needs them

- No `<select>`, `<textarea>` or `<input type=date>` in the package. T2 kept one copy in
  `apps/console/src/lib/controls.tsx`. They belong in `packages/ui` — fold in during Wave 2,
  which is form-heavy.
- `DataBoard` has no card container. The reference's `.tbl` + `.tbh` is the table's own
  chrome; T2 added `Board` app-side for seven boards.
- `Button` has no `asChild`/`as`, so a primary action that navigates must drop its `href`.
- `KpiRow`, `RecordHeader`, `Breadcrumb`, `Stepper` render raw `<a href>` — a full page
  reload on every drill-down in an SPA. They need a link-component injection point.
- `PriceBreakup` requires `valuationMethod` and sums lines to a total — a buyer landed-price
  shape that does not fit a vendor payout preview (gross minus deductions).

## Reported by T5 — not fixed, they are `apps/api`

- **The verification rate limit is keyed on the value alone, not on the applicant.**
  `VerificationService.assertRetryAllowed` filters `verification_check` by
  `check_type + input_hash + 24h` with no `org_id`, so five consuming attempts on a
  PAN anywhere on the platform lock that PAN out for everyone. It also means one
  org can burn another org's budget for a value it happens to know. Found because
  the capture script reused one PAN across runs and the second run was refused.
- **`checkForValueShopping` fires on the third GSTIN, and this screen exists to
  collect several.** Three *distinct* GSTINs from one org in 24 hours throws
  `ConflictError` and pauses the application — but a buyer with registrations in
  Haryana, Karnataka and Maharashtra is the normal case for step 3, not a fraud
  signal. The screen renders the pause honestly (`T5-value-shopping-paused-*`)
  rather than as a field error, but the rule needs a carve-out for values the
  applicant is deliberately adding to one step.
- **No step promotion, so `organization.constitution` is never written.**
  `completeStep` takes a promotion function and no module has registered one, so
  step 2's constitution stays in `draft_json` and `organization.constitution`
  stays null. Two things on step 3 are therefore inert: `onboarding_field_requirement`
  cannot decide that a private limited company must supply a CIN (it renders as
  optional), and `verifyPan`'s VR-008 check — "this PAN belongs to an individual
  but you selected private limited" — is never armed, because the client has no
  constitution to send. Both are wired and start working the day a STATUTORY /
  BUSINESS_PROFILE promotion lands.
- **`GSTIN.message` in `@trugrade/contracts` gives an invalid example.**
  "e.g. 06ABCDE1234F1Z5" fails its own check digit — the correct one is 4. Cosmetic,
  but it is the string every GSTIN field in the product shows, and a worked example
  that would be refused by the validator beside it is worse than none.

## Reported by T6 - not fixed, they are outside `apps/storefront`

- **`Uploader` shows per-file progress to a screen reader only.** It takes
  `progressPct`, announces it at the quartiles, and renders an "Uploading" pill
  with no number and no bar. The backlog asks for visible per-file progress, so
  `StepDocuments` renders the bar itself, beside the component -
  `T6-upload-in-flight-*` is a real throttled upload at 49% of 977 KB. Eight
  lines that belong inside `Uploader`, where every other upload surface gets
  them for free.
- **`AddressCard` has no billing mode.** It always renders Landmark, Gate
  instructions and Receiving hours, so a *billing* address - which is never
  asked for any of them - shows three "Not provided" rows for fields that do not
  apply to it. "Not provided" is right for a delivery address nobody asked; it is
  noise on a billing one. It needs a variant, or the three rows need to be
  driven by what the caller passes.
- **`document_type_rule` has no `org_type` or `step_code`.** All fourteen rows
  apply to everyone, so nothing in the API can say which four a *buyer* is asked
  for. `picklists.ts` holds the four codes and says so; every rule about each of
  them - label, cap, accepted types, age - comes from the endpoint. The
  selection belongs in the table beside the rules it selects.
- **No `color-scheme` on `:root`.** The browser paints its own widgets - the
  date and time pickers step 4 and step 5 use, the select arrow, scrollbars -
  from `color-scheme`, not from our tokens, so a dark page rendered a
  near-invisible dark clock icon. Set in `apps/storefront/src/app/storefront.css`
  as a workaround; it belongs next to the token block in
  `packages/ui/src/globals.css` and should be deleted from the storefront when it
  lands there.
- **The OTP rate limit is keyed on IP alone.** `REGISTER_OTP_IP_LIMIT` counts
  `ctx.ip`, so the capture run exhausted it after ten registrations and the
  light-theme run was refused for 47 minutes. In production behind an office NAT
  or a CGNAT, that is one buyer's registrations locking out everybody else's from
  the same building. Cleared the dev key to finish the captures; the rule needs a
  second dimension.
- **A completed step's answers exist nowhere a client can read** - the third time
  this promotion gap has bitten (T5 reported it first). `completeStep` clears
  `draft_json` and no module has registered a promotion, so after a cold reload
  the review screen can show a COMPLETE step's answers only if this session
  supplied them. It says so plainly rather than rendering five false gaps, and
  `RegisterFlow` now MERGES the server's answers into what it holds instead of
  replacing them - without that merge the review screen empties one step at a
  time as each step completes.
- **A COMPLETE step is locked and there is no change-request flow.**
  `saveDraft` refuses a COMPLETE step with "use the change-request flow", and no
  such flow exists. The review screen therefore offers a link back only for steps
  that can actually be changed, and says what it takes to change the rest. That
  is honest about today's API, but it means a buyer who spots a wrong GSTIN on
  the review screen cannot fix it without a reviewer.

## Contracts gaps reported by T6

- **No GST state-code map, still.** T5 reported it; T6 needed it for real (a
  billing address must sit in the state that issued its GSTIN) and wrote the
  36-row list in `apps/storefront/src/app/register/picklists.ts`. Two withdrawn
  codes - 25 and 28 - are deliberately absent, and an unrecognised code stands
  the cross-check down rather than guessing.
- **No option lists for state, receiving days, notification channel or
  language.** Same shape as the T4 report: written in `picklists.ts` with a
  comment, belong in `@trugrade/contracts` or `platform_config`.

## Contracts gaps reported by T5

- **No client-side provider retry schedule.** `PROVIDER_RETRY_SCHEDULE_SECONDS`
  lives in `apps/api/src/modules/kyc/internal/verification.service.ts`, which the
  storefront cannot import. Step 3 defines its own, shorter, ladder because the
  two are different things (a server retrying out of band vs a person waiting at a
  form) — but the fact that a screen has to invent one says the contract is missing.
- **No state-code → state-name map.** `stateCodeFromGstin` returns "06" and
  `VerificationService.stateName` holds a private eight-entry lookup. The screen
  can only show the bare code.

## Gaps reported by T4

- **`ThemeToggle` cannot hydrate.** It seeds its state from `document.documentElement`,
  which is correct in the browser and impossible on the server, so an SSR page renders
  the moon and a light-theme client renders the sun — React threw the whole tree away and
  re-rendered it on every light-mode page load. One line fixes it: seed the state with
  `'dark'` and let the existing `useEffect` correct it. Worked around in
  `apps/storefront/src/app/HeaderThemeToggle.tsx`, which deferred-mounts it; delete that
  wrapper when the package is fixed.
- **Still no `<select>`.** T2 kept one in `apps/console/src/lib/controls.tsx`; T4 now has a
  second in `apps/storefront/src/lib/controls.tsx`. Two copies. Fold into `packages/ui`.
- **`Stepper` marks a completed step with a green tick** (T3 already reported this). It is
  visible on every screenshot of step 2: green is reserved for PASS/FAIL.
- **`Stepper`/`StepRail` have no link-component injection point**, so a completed step in
  the rail is an `<a href>` and a full page load. The flow re-reads its state on mount, so
  it lands correctly — but it is a reload inside a wizard.

## Contracts gaps reported by T4

- **No option lists for constitution, industry, employee band, annual volume or lead
  source.** Constitution at least exists as the `constitution_type` enum and was copied
  from the schema verbatim; the other four have no definition anywhere, so
  `apps/storefront/src/app/register/picklists.ts` writes them and says so in a comment.
  They belong in `@trugrade/contracts` or `platform_config` before a second screen needs
  the same lists.
- **`PasswordService.COMMON_BASES` is not shared.** The client meter has to agree with the
  server or it reads "very strong" on a password the server then refuses — which is exactly
  what happened first time. The list is duplicated in
  `apps/storefront/src/app/register/validation.ts`. It belongs beside
  `PASSWORD_BLOCKLIST_WORDS`.
- **VR-032b (`EMAIL_DISPOSABLE`) has no implementation.** Nothing refuses a temporary
  mailbox, and there is no domain list. The registration form therefore does not claim to
  refuse one; it notes when a free consumer mailbox is used and accepts it.

## Fixed in passing by T4

- The storefront header used `nav-browse` / `ghost` / `cta` class names that exist in no
  stylesheet, so "Browse laptops", "Requirement" and "Sign in" rendered as bare text
  against the reference's `.catbtn` and `.hbtn`/`.hbtn.solid`. The header is now
  `apps/storefront/src/app/SiteHeader.tsx`, shared by the homepage and `/register`, and
  matches `docs/reference/homepage.html` markup for markup.
- The wordmark rendered `tru<em>grade</em>`. The reference is `<span class="g">`, which is
  what `.wm .g{color:var(--acc)}` styles — so the amber half of the logo was italic and
  grey instead. Fixed on the homepage and the sign-in page.
- The Rule 4(2) footer in `layout.tsx` used `text-ink`/`text-ink-2` while `storefront.css`
  paints every `footer` with `--chrome`. In light theme that was near-black text on the
  dark chrome: the legal-name line was unreadable. Now `on-chrome` tokens, identical in
  both themes.
- `<html>` had no `data-density`. The storefront is `comfortable` per CLAUDE.md.
- A short page floated the footer halfway up the window; `body` is now a min-height flex
  column.

## Schema defects found by T8 — fix as one focused change after T9

Verified against the live database, not inferred:

- **`vendor.can_dropship` and `can_provide_serials_upfront` are `NOT NULL DEFAULT TRUE`.**
  Any writer that does not set them asserts the commercially convenient answer, so the
  database claims a capability the vendor never stated — and `can_dropship` drives whether
  we route goods vendor-to-customer direct. Same family as every other defect this run has
  found: a missing value rendering as a passing one, this time at the schema layer. They
  should be nullable with no default so "never asked" is distinguishable from "no".
  T8's screen already refuses to continue until it is answered; the hole is for every
  other writer.
- **`vendor_facility.dispatch_address_id` nullable means "use the facility address"**, so
  nothing distinguishes "same address, confirmed" from "never asked". It becomes Dispatch
  From on every e-way bill.
- **`sourcing_channels` is a bare `TEXT[]`** — no CHECK, no enum, no contract, while
  category, facility type and vehicle access all have CHECK constraints.
- **`facility_hours.day_of_week` is `0..6` with no comment saying which end is Sunday.**
  Confirmed: the column has no COMMENT at all.
- **`org_address.contact_name` is NOT NULL but is never asked per facility** — the person
  it wants is the warehouse contact captured on the same screen. Asking twice would put two
  answers to one question in the database.

## Motifs that do not carry information — 09_FRONTEND_LOCKED §4 violations

§4's governing rule is "a motif must carry information", and two components break it.
Both are printed beside the real value they claim to encode, on screens a warehouse or a
buyer uses, so they read as scannable and are not.

- **`Barcode` (packages/ui/src/components/measure.tsx) encodes nothing.** It is
  `charCodeAt` arithmetic producing decorative bars. §4 says it "encodes the seal code,
  shown beside it". Used on `/qc/verify/[code]`, `/unit/[serial]` and the console's
  `VisitDetail`, always next to a genuine seal code — so a technician will try to scan it.
  **Fix = real Code 128 Set B.** I attempted this and abandoned it: the 107-row pattern
  table has to be transcribed from an authoritative source, and I could only recall ~101
  rows. A barcode that encodes the WRONG value is worse than one that encodes nothing,
  which is the whole argument for fixing it — so it needs the real table, plus a
  round-trip decode test (encode, then read the widths back as a scanner would; a
  transposed row survives a length check and fails a round trip).
- **`QrBlock` is placeholder geometry**, while §4 says the QR must be real in production.
  T14 worked around this by drawing its own real QR with `qrcode-generator`, which the
  API's PDF already depends on — so the library is present and the fix is to move T14's
  implementation into the package and delete the placeholder.

## Backend readiness, measured 30 Aug — this decides how big each remaining task is

| Module | internals | routes | Tasks that need it |
|---|---|---|---|
| ordering | 8 | 14 | T19 T20 T21 T25 done |
| listing | 9 | 21 | T27 T28 T29 done. **T38 done and it lives here, not in `procurement`** — `MarginRuleRepository` is the margin-rule resolver, so the admin read sits beside it rather than in the module that owns the schema. |
| qc | 15 | 34 | T30 T31 done |
| catalog | 9 | 20 | T37 done — a design and completeness pass, plus one field on the coverage route. No new internals. |
| vendor | 2 | 3 | T26 done — `/api/vendor/dashboard` existed all along; `api.ts` had it marked MISSING |
| logistics | 2 | **0** | T21 tracking. **Still no pickup or delivery writer** — T23 records delivery in `ordering` instead, and says so. |
| **procurement** | **4** | **6** | T32 T33 done — the tables were never empty; `ordering` fills them. T39 T40 |
| payment | 4 | 3 | T22 done — the INVOICE slice only. Settlement, payouts, refunds, penalties, the ledger and the e-way bill WRITER are still empty; T40 needs them. |
| platform | 6 | 7 | T23 done — warranty, claims and the delivery writer. **T24 done — returns.** `return_request` now has a writer (the buyer, and the seal check on their behalf) and `SEAL_BROKEN` on its reason CHECK; `return_qc` is still 0 rows with no writer, because inspecting a machine on its way BACK is the ops half. Tickets, disputes and scorecards are still empty. |
| **customer** | **0** | **0** | T25 done WITHOUT it — addresses and team live in `identity`, approvals in `ordering`, because those are the schemas that own the tables. What genuinely belongs here is `customer.buyer_approval_policy` (03_UX_SPEC `/account/spend-limits`), which nothing outside `checkout.service.ts` reads today. |

Roughly 12 of the 30 remaining tasks are screens over a working API. The other 18 need a
module built first — `payment` and `procurement` are the Phase 7 money layer, which exists
as schema and contracts only. Those are not screen tasks wearing a screen task's size, and
planning them as such is how a wave silently stalls.

## Security finding from T26 — one vendor can read every vendor's grade corrections

**`GET /api/qc/grade-corrections` is guarded by `qc.report.read`, which every vendor role holds**
(VENDOR_OWNER, VENDOR_ADMIN, VENDOR_OPS and VENDOR_VIEWER all carry it in
`ROLE_PERMISSIONS`), and `QcConsoleService.correctionQueue()` applies **no org predicate at all** —
it selects every open correction platform-wide and enriches each row with `vendorName`. So any
signed-in vendor account can list its competitors' units, serials, SKUs and regrade reasons.

Not introduced by T26 and not fixed by it: the same method is the ops console's board, so scoping it
changes behaviour for T30/T31, and that is their call to make rather than a side effect of a
dashboard pass. **T26 deliberately did not route the vendor's correction queue through it** — the
counts come from the org-scoped `/api/vendor/dashboard` instead. The fix is a caller-org branch in
`correctionQueue()` (platform sees all, a vendor sees its own), plus a test that signs in as a vendor
and demands the neighbour's rows are absent.

## Reachability gaps found in T26

- ~~**`GradeCorrectionService.respond()` is exposed by no controller.**~~ **Closed by T31.**
  `POST /api/vendor/grade-corrections/:id/respond` guards on `listing.grade_correction.respond` —
  the permission that existed for this and had nothing to guard — and scopes at
  `VendorCorrectionRepository`. The entry stays so nobody re-opens it. Note the count: the grant is
  on THREE vendor roles (OWNER, ADMIN, OPS), not four; VENDOR_FINANCE and VENDOR_VIEWER can read a
  correction on their own stock and cannot answer it, which is correct.
- **The auto-apply job is not running.** All nine seeded corrections are ~77 hours into a 48-hour
  window and still open, so `autoApplyDue()` has never fired against the dev database. The dashboard
  reports them as breached, which is correct and is also the evidence. **T31 did not fix this and
  deliberately did not paint it as a failure**: an elapsed window is `warn` and the screen says the
  correction is still answerable, which is exactly what `respond()` does — it refuses a SETTLED
  correction, not a late one. Wiring `autoApplyDue()` to a schedule is still nobody's task.
- **`procurement.vendor_payable` is written by `ordering`, not `procurement`.** The readiness table
  reads "procurement 0/0" and the natural conclusion — that a payout figure has no source — is wrong:
  `order-transaction.service.ts` inserts the payable and the PO in the same transaction as the order.
  The dev database holds 15 of each. So the payout tile has real data and was kept. What does not
  exist is `eligible_at` (nothing sets it, so "expected on" is genuinely unknown and says so) and any
  vendor-facing payables screen.

## Reachability gaps found in Wave 3 — features whose states no route can produce

- **No approve/reject endpoint exists.** PHASE_06 Task 2 builds the policy, the row and the 24-hour
  expiry, and the order transaction writes an `order_approval` — but nothing can DECIDE one, so
  `APPROVED` and `REJECTED` are unreachable through the product. Four orders sit at
  AWAITING_APPROVAL with no way forward. An approver's screen appears under no backlog number I could
  find; it likely belongs with T25 (approval inbox) in Wave 4.
- **Order confirmation and proforma PDFs are not generated**, though PHASE_06 Task 6 asks for both.
  T17's screen says "not issued yet" rather than faking a download.
- **The seed contains no FAIL, PASS_WITH_NOTE or MISMATCH QC report** — all 239 are PASS, so the
  `--fail` verdict path on T14 is covered by tests and by no screenshot.

## Known bugs, not yet fixed

- `postJson` in `apps/console/src/routes/vendor/api.ts` reads `message` off the body root,
  but `DomainExceptionFilter` nests it under `error` — so every actionable refusal renders
  as "that did not go through (422)". Behaviour fix, deliberately not done inside a restyle.
  **Update (T26): the code now reads `error.message` and the comment describes the fix. The
  bug is gone; this entry stays only so nobody re-fixes it.**
- ~~**`STATUS_TONE` in the vendor listings board paints ACTIVE green and REJECTED/SUSPENDED red**~~
  **Fixed in T28**, along with seven more instances of the same mistake across the QC console, the
  review queue and the vendor review screen. The entry stays so nobody re-opens it. What the sweep
  deliberately did NOT touch: real PASS/FAIL verdicts (`qc/VisitDetail`'s outcome map), form error
  text, and `ConditionImageCoverage`'s "Publishable / Cannot publish", which is a genuine binary
  gate rather than a position on a scale.

## Reported by T27/T28 — not fixed, and each needs a decision

- **The vendor's own ask has no history, so the reprice screen cannot show one.** `03_UX_SPEC` §3B.2
  asks for a price-history chart on `/vendor/listings/[id]/reprice`. `listing.price_history` records
  `old_price`/`new_price` as **our selling price**, which is the one figure a vendor screen may not
  show, and `unit.vendor_ask_price` is overwritten in place with no trail. So the only honest chart
  is one with no numbers on it. The reprice form still promises "goes on the price history, with
  your name", and that promise is currently unreadable by the person it is made to. Fixing it is a
  column or a table and therefore a migration, not a screen change.
- **`GET /api/qc/grade-corrections` is still unscoped** (see the T26 finding above). T28 did not
  route anything new through it; the vendor board's `?corrected=1` reads `listing`, org-scoped at
  the repository.

## Reported by T29 — not fixed, and each needs a decision

- **The magic-byte signature table now exists twice.** `apps/console/src/routes/vendor/csvFile.ts`
  is a second copy of `apps/storefront/src/app/bulk/api.ts`. The two apps cannot import from each
  other and the shared home is `packages/contracts`, which another session owns this week — so it
  was forked deliberately with a `ponytail:` comment rather than silently. Promote it to contracts
  when a third caller appears, and delete both copies in the same commit or the fork becomes three.
- **"Duplicate of line 2 in this batch" says *batch* where the vendor reads *file*.** The message
  comes from `validateSerialBatch` in contracts, which is shared with the paste box where "batch" is
  the right word. T29 fixed the NUMBER (it pointed at the header) and left the noun alone, because
  changing it is a contracts edit and the word is correct on the other caller. The honest fix is a
  caller-supplied noun, or two messages.
- **`WILL ADD` is a green pill and `ERROR` a red one, on the dry-run table.** Left as it is, on the
  same reasoning T28 used to leave `ConditionImageCoverage`'s publish gate alone: this is a genuine
  binary — the row will be written or it will not — rather than a position on a scale, and the
  colour is not standing in for a QC verdict. Flagged because it is the one place in the vendor
  portal where green and red appear outside a PASS/FAIL, and somebody should agree with that
  reading rather than inherit it.
- **Nothing enforces `LISTING_QTY.max` at the database.** `ListingService.addUnits` checks it, and
  T29's dry run now checks the same subtraction, so the two agree — but two application-layer
  checks are not a constraint, and a third writer would not know. VR-080 claims `enforcedAt: DB`
  and that is still not true.

## Reported by T32 and T33 — not fixed, and each needs a decision

- **There is no PO acceptance deadline and no penalty behind one.** `03_UX_SPEC` §3B.3 requires
  "the acceptance deadline shown with the penalty for missing it, stated before acceptance".
  `platform.platform_config` has no key for either — the nearest neighbours (`ordering.approval_hold_ttl_hours`,
  `qc.grade_correction_auto_days`) exist because somebody decided a number. Nobody has decided this
  one, so `VendorPoView.acknowledgeBy` is null on every purchase order and the panel says so in
  `--ink-4`. The screen is ready for the number; the business has not produced it.
- **`purchase_order.expected_dispatch_at` is written by nothing.** The column exists, the order
  transaction does not set it, and no route updates it. Every PO therefore reads "Not agreed" under
  Expected dispatch. It is the field the handover screen would key off.
- **`logistics.shipment` and `logistics.pickup_task` have no writer and zero rows**, so a packing
  list has no carrier reference and no task id to quote (§3B.3 asks for "our shipment reference").
  T32 prints "Not assigned yet" and tells the vendor to quote the PO number, which is the only
  reference that exists. `/vendor/orders/[poId]/handover` is blocked on the same gap.
- **`procurement.goods_receipt` and `procurement.vendor_invoice` are still empty with no writer.**
  `/vendor/invoices` (§3B.3) validates an invoice against a three-way match that cannot run, so it
  was not built rather than built against nothing.
- **`Board` in `apps/console/src/lib/controls.tsx` gained a `tableMinWidth` prop.** The reference's
  940px floor is right for a full-width board and wrong inside an archetype-C record, where it
  pushed two columns off the right of a 700px evidence column. This belongs on `DataBoard` in
  `@trugrade/ui` along with the rest of `Board`; the existing note about not owning that package
  still applies.
- ~~**`apps/api/prisma/seed/after-sale.ts:83` fails `no-restricted-syntax` (`Date.now()`)**~~ —
  fixed in T23. `seedAfterSale` now takes the instant as a parameter and `prisma/seed/index.ts`
  supplies `new SystemClock().now()`, so the seed and the services that measure the 48-hour window
  read one clock. Thank you for catching it.

### T33's own

- **There is no `procurement.payable.read_own` permission**, so `/api/vendor/payables` is guarded by
  `procurement.po.read_own` — which §3B.4 does not intend: that screen is FINANCE and OWNER, and
  `po.read_own` is held by all five vendor roles including VENDOR_VIEWER. The interim is defensible
  (`gross` is the purchase order's `total_net` and `tds` its `tds_amount`, both already readable on
  `/api/vendor/purchase-orders/:id`) and what it genuinely widens is `penalties` and `qc_fee`, which
  are ₹0 on every row in existence. Inventing the permission means editing
  `packages/contracts/src/roles.ts`, which another lane owns this week. **Narrow it the moment
  contracts is free** — one grant on two roles and a guard change, and it is the last thing standing
  between this screen and the spec.
- **`procurement.payout_run` is referenced in zero source files.** Confirmed from the code rather
  than the row count. Until T40 there is no settlement run, no bank file, no `payment.ledger_entry`
  pair and therefore no payout statement keyed to a run — which is why `/vendor/payouts` is
  deliberately unbuilt rather than built empty.
- **Nothing sets `vendor_payable.eligible_at`** (first logged by T26, still true). The screen now
  makes the gap visible — the rule's answer and the record's absence side by side — which is honest
  presentation, not a fix. The fix is a writer, in the same place the payout run will live.
- **No vendor on the platform has a payout bank account.** `kyc.bank_account` has five rows and all
  five belong to the `Northgate Asset Recovery` test-scaffolding orgs, not to any of the ten demo
  suppliers. So even with a payout run, nothing could be paid: §4.8's bank-account eligibility
  condition fails for every vendor. The screen says so on the one line a vendor can act on.
- **No vendor has a verified PAN either**, so every TDS line reports the 5% no-PAN rate rather than
  0.1%. Correct behaviour on incomplete data — `kyc.pan_record` is written by onboarding and the
  demo seed does not run it.
- **`payment.penalty` and `payment.ledger_entry` are empty with no writer**, so `/vendor/penalties`
  and `/vendor/ledger` (§3B.4) cannot be built against anything. The statement states the penalty
  line as ₹0 with its reason rather than linking to a screen that does not exist.
- **`vendor.vendor_payout_preference` has zero rows, and nothing on `/vendor/payables` reads it —
  deliberately.** A preferred cycle is a request, not a promise, and turning one into a payment date
  is precisely what this task was told not to do. It matters for `/vendor/settings` and for the
  admin payout run, not here.

## Prerequisites built outside the numbered backlog

| What | Commit | Why it could not wait |
|---|---|---|
| Step promotion | c04c5f5 | 642 drafts wrote zero rows to the tables the product reads |
| Multi-supply-point demo data | e4c177f | The comparison board had one row to compare |
| Image pipeline + QC evidence | (this) | No image could render anywhere; 3 of the passport's 5 evidence panels were empty |

## Operational traps that have each cost real time

- **`pkill -f "dist/main.js"` does not match the API on Windows.** A stale process kept
  port 4000 for hours and every curl silently hit the OLD build — I nearly diagnosed a
  second, deeper bug that did not exist. Kill by port instead:
  `Get-NetTCPConnection -LocalPort 4000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }`
  Same for 3000 (Next) and 5173 (Vite).
- **Next dev caches CSS from `packages/ui`.** Appending to globals.css and reloading shows
  nothing; restart the dev server. This cost one session an hour chasing a phantom.
- **The object route's rate limit is sized for a product page, not an admin one.**
  `ObjectsController` allows 240 fetches per 300 s per IP (and 20 misses per hour).
  Measured during T37's captures: one open condition-image panel loads ~22 thumbnails,
  the SKU record 7 per grade, and a storefront gallery 7 — so a capture run across two
  themes and three widths exhausts it, and every photograph then comes back as a broken
  image that looks exactly like a CSS fault. Ten models opened in five minutes puts a
  real operator at the ceiling too. Not changed: it is a deliberate control, and the
  number needs deciding against an admin screen that shows a whole model's library.
- **The console capture scripts sign in enough times to trip the auth rate limit.**
  One T39 run signs in four accounts x two themes, plus the build-freshness checks,
  plus `open`'s retry after every dev-server rebuild. Two runs back to back and
  `/api/auth/login` answers 429 for fifteen minutes and `/api/auth/mfa/otp` for an
  hour, which stops a capture run dead in the middle. Prefer a demo account whose
  role is NOT in `MFA_REQUIRED_ROLES` (the OTP limit is the long one), cache the
  token between probe runs, and expect to wait rather than to debug.
- **A capture run that signs in twice per MFA account stops dead mid-run.**
  `/api/auth/mfa/otp` allows **five codes an hour with a 60-second cooldown**, per email.
  T35's script originally spent two per account — one for the API build-check and one for the
  browser — and burned the hour twice while it was being written. The fix is in
  `scripts/t35-shots.mjs`: sign the browser in once, lift the access token off the
  `login`/`mfa/verify` response, and hand THAT to the assertions. Switch theme by rewriting
  `tg-theme` and reloading inside the signed-in context rather than opening a context per theme.
  `redis-cli TTL rl:otp-hour:LOGIN:<email>` says how long the wait is; `redis-cli GET` on the same
  key says how many were spent. (T35 also had to clear those dev keys once to finish the run —
  a local-environment action, no code or config changed.)
- **An unconditional `addInitScript` silently undoes a mid-run theme switch.** It re-runs on
  every navigation, so `localStorage.setItem('tg-theme','dark')` reset the light half of a run
  back to dark. `assertTheme` was the only thing that caught it. Seed the key only when absent.
- **Date-pinned tests are time bombs.** Two suites passed only while the real date matched
  a literal in the file. If a test needs a fixed instant, fix the TIME and let the DATE
  track today, or seed and assert from the same clock.

## Notes carried forward

- **The test database is shared.** `truncateAll` uses `TRUNCATE ... CASCADE` and does
  not reset seeded reference data. Two suites on one database deadlock; that once cost
  147 phantom failures across 19 suites. Run against a private database:
  `DATABASE_URL_TEST=...trugrade_test_<name>`. `test/support/env.ts` now honours an
  exported value — it used to silently overwrite it.
- **A test that asserts a guard EXISTS proves nothing.** Make it attempt the forbidden
  thing and expect the refusal. Three shipped defects had exactly that shape:
  append-only enforced by a REVOKE that cannot bind a table owner, a console that had
  never once built while 111 unit tests passed, and a required `freight` parameter that
  defaulted to zero.
- **Another Claude session shares this working tree** (`build-pack-v1-4b`). Agreed split:
  `apps/console/**`, `apps/api/src/modules/**`, `apps/api/test/**`, `apps/technician/**`
  and `apps/storefront/**` are ours; `packages/contracts/src/**` is theirs; migrations
  are shared by new-directory-only.

