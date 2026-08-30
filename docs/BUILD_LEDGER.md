# BUILD LEDGER

Updated: 2026-08-30T15:00:00+00:00  
Currently: Wave 4 - T22 documents (invoice, proforma, e-way bill); T25 done

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
| T22 | Documents - invoice, proforma, e-way bill | TODO |  |  |  |
| T23 | Warranty and claims | TODO |  |  |  |
| T24 | Returns inside the 48-hour window | TODO |  |  |  |
| T25 | Account - addresses, team, approvals | DONE |  | 116 shots, 29 states x 2 themes, 1440/900/600 | **Closes the build's oldest reachability gap.** `APPROVED` and `REJECTED` were states the schema allowed and the product could not reach: PHASE_06 Task 2 built the policy, the `order_approval` row and the 24-hour deadline, the transaction wrote the row, and nothing could decide one. Built `POST /api/buyer/approvals/:id/decision` plus `GET /api/buyer/approvals` and `/:id`; the four stranded orders now have a way forward and two were decided through the real endpoint (`TT-26-00004` approved, two POs raised; `TT-26-00011` declined, six units back to LISTED). **VR-123 did not exist anywhere and now does** - `roles.ts` said "enforced in the service" and no service enforced it. Four screens: `/account/approvals` (B), `/account/approvals/[id]` (C), `/account/addresses` (C), `/account/team` (B), plus `AccountNav` in the layout because three of them were reachable from nowhere. Addresses and team live in `identity` where their tables already are; the `customer` module is still empty. 22 integration tests (10 approval, 12 account), 8 storefront unit tests, every one attempting the forbidden thing. Also fixed: `order_approval.requested_at` came from the DATABASE clock while `expires_at` came from `ClockPort`, so the measured SLA drifted with any skew. |
| T26 | Vendor dashboard | DONE |  | 30 shots, 5 states x 2 themes, 1440/900/600 | Archetype E at `/vendor` — it was a KPI row and nothing else, which is B's furniture under E's name. Added the two queues, sorted by breach: grade corrections (real SLA, `qc.grade_correction_auto_days` x 24 = 48h) and awaiting inspection (**no SLA, and none invented** — `slaHours` and `breachedCount` come back `null`, and the route drops the fields rather than defaulting them). Cut three tiles that linked nowhere real: `/vendor/payables` and `/vendor/qc/corrections` are routes that do not exist, and `?expiring=14` is a parameter the listings board silently ignores. Kept the numbers, dropped the hrefs. Dropped the awaiting-inspection tile because the queue says the same thing with the wait attached. `unitsEverListed` added to the payload: first-run was inferred from `live + awaiting + sold`, which told a vendor whose whole first batch failed inspection to list their first stock. Added `?corrected=1` to the listings board so the corrections queue lands somewhere — predicate is the correction row, NOT `grade_corrected_from`, which is only written once a correction is APPLIED and therefore matched nothing for every correction still open. Nav lied: the single vendor entry said 'My listings' and pointed at the dashboard. Now two entries, 'Today' and 'My listings'. 6 integration tests, org scoping proven by seeding a neighbour with strictly more of everything and mutation-checked (removing one `vendor_org_id =` fails the suite). 6 console tests, one of which demands the ABSENCE of an SLA clause. |
| T27 | Listing wizard design pass + commission readout | DONE |  | 84 shots, 14 states x 2 themes, 1440/900/600 | Archetype D at `/vendor/listings/new`, and it had been shipping **two columns of a three-column archetype** — `WhyRail` was in `@trugrade/ui`, built for vendor registration, and used by nothing. Added, one list per step, every entry a consequence rather than a definition. **Two live defects found by driving the screen rather than reading it.** (1) Answering the batch-size question ran create -> attach -> submit a SECOND time, so `POST /:id/units` was handed serials the vendor's own draft was already holding; the API correctly refused them and the vendor was left with two drafts, an error calling their own machines duplicates, and no inspection. `listingId` is now remembered and the answer re-submits the listing that exists. Regression test attempts the second create and counts the POSTs. (2) **The wizard's success state was unreachable for every vendor in the database**: `vendor.vendor_facility` had 0 rows, `SubmitService.facilityAt` refuses a pickup address with no facility behind it, and `POST /api/vendor/facilities` wrote only `identity.org_address` — so the picker offered a location that submit then rejected, telling the vendor to add it as a facility on a screen that does not exist. Both the route and `prisma/seed/demo.ts` now write the facility row in the same transaction; a real visit (QCV-20260830-073FFC1F) was raised to prove it. Commission readout: `totalDeductions` was computed by the server and shown nowhere, so a list of charges had no total; `expectedPayoutDate` is absent from the server type and rendered 'Set by your payout cycle' in the value slot, a sentence dressed as an answer — now 'Not calculated' in `--ink-4`; the percentage carries its denominator in words, because the rupee denominator IS the selling price and that is the one figure this screen may not show. Grade definitions now carry their measured floors (battery %, cosmetic score, cycle cap) beside the prose, from `catalog.v_current_grade_definition` — the fields were already on the wire and the console type dropped them — and a declared band whose CEILING cannot clear the chosen grade's floor warns, never blocks (UNKNOWN has no ceiling and is compared to nothing, because a missing measurement must not render as passing OR failing). One primary action per screen: the selected SKU row stopped being an amber button, and the footer's submit is suppressed while the batch-size question is open. Every 'MISSING route' comment in `vendor/api.ts` was stale — all nine exist. |
| T28 | Listing management and repricing | DONE |  | 81 shots, 13 states x 2 themes, 1440/900/600 | Archetype B at `/vendor/listings` and a new archetype C at `/vendor/listings/[id]/reprice`. **The logged `STATUS_TONE` bug is fixed and the sweep found seven more of it.** ACTIVE was green and REJECTED/SUSPENDED red; ACTIVE/PARTIALLY_ACTIVE are now `info` (the amber wash, which is rule 1's third meaning — an active state), the in-flight ones are `processing`, and everything terminal is neutral with its meaning in its own label. Also fixed, same mistake, listed because a colour that means a verdict in one place and a status in another has stopped meaning either: `vendor/Units.tsx` (a sellable unit painted green two columns from the grade badge that carries the real verdict), `qc/VisitBoard.tsx` (COMPLETED green, NO_SHOW red), `qc/VisitDetail.tsx` (**UNTESTABLE was red — "we could not measure it" is not "it failed", and that distinction is what a vendor's appeal turns on**), `qc/AuditRecheck.tsx` and `qc/ToolProviders.tsx` ("Active" green), `qc/GradeCorrections.tsx` (an elapsed response window red), `ReviewQueue.tsx` (an SLA we breached rendered as a verdict on the applicant), `VendorReview.tsx` (a declared capability green). Deliberately left: real PASS/FAIL verdicts, form error text, and `ConditionImageCoverage`'s publish gate, which is a genuine binary. Row-action links dropped from `--acc-ink` to `--ink`: fifty rows x two links is a hundred amber controls beside the one chip that now means something. **`?corrected=1` was answering a different question from the queue that links to it** — the dashboard counts corrections with `vendor_responded_at IS NULL AND auto_applied_at IS NULL`, the board matched every correction ever raised. They agree today only because no vendor can answer one (T31) and the auto-apply job has never run; the moment either changes a queue saying "3 need you" lands on a board of nine. One predicate now, an integration test that seeds an answered correction and demands its absence, and the capture script reads both numbers live and refuses to run if they disagree. The board caption printed `rows.length` (a page) where it meant `total` (a match count). **Reprice is a route, not the row-expanding panel it was** — that panel's open/closed state lived in React and not the URL. It names, by serial, the machines that will NOT move: `unit.purchase_price` is frozen by `trg_lock_purchase_price` and the handler updates `WHERE purchase_price IS NULL`, so committed machines were being skipped in silence and a vendor who repriced forty and found nine unchanged would conclude it half-failed. `VendorUnitView` gained `payoutLocked` (the boolean, never the amount) to make that sayable. Six integration tests: two attempt the forbidden `UPDATE` on `purchase_price` and `valuation_method` directly against the table and demand the refusal (`pg_trigger` is consulted nowhere), one proves the partial skip, one proves the all-committed refusal is the vendor-readable 412 and not a trigger exception, one aims the reprice at a neighbour's listing, one is the corrections filter. Mutation-checked: removing either predicate fails the right tests. **Two more defects found on the way.** (1) `qc.visit_fee_waived_above` and `qc.visit_fee_waiver_units` are one number under two names — the baseline migration writes the first and `PricingService` reads it; the seed wrote the second and only `SubmitService` read it. So a database built from the seed alone could not price a listing and one built from migrations alone could not request an inspection. One name now, and `price.guardrail_lower_multiple` added to the seed for the same reason. (2) **Nine of the ten seeded vendors had no user account**, and they are exactly the nine whose stock the demo orders were placed against — so every unit in the database carrying a `purchase_price` belonged to a vendor who could not sign in, and the whole committed-machines behaviour was unreachable through the product. One VENDOR_OPS per supply point in `demo.ts`. |
| T29 | Bulk serial upload with dry-run | TODO |  |  |  |
| T30 | QC visit request, scheduling, results | TODO |  |  |  |
| T31 | Grade-correction response | TODO |  |  |  |
| T32 | Purchase orders - serials, seal codes, pick list | TODO |  |  |  |
| T33 | Payables and payout statement | TODO |  |  |  |
| T34 | Ops dashboard | TODO |  |  |  |
| T35 | Global search + Unit 360 | TODO |  |  |  |
| T36 | Onboarding review queue | TODO |  |  |  |
| T37 | Catalog and condition-image library | TODO |  |  |  |
| T38 | Margin rules and price books | TODO |  |  |  |
| T39 | Order board and procurement board | TODO |  |  |  |
| T40 | Finance console | TODO |  |  |  |
| T41 | Config, flags, templates, audit log | TODO |  |  |  |
| T42 | Theme toggle audit across every route | TODO |  |  |  |
| T43 | Empty/loading/error state audit | TODO |  |  |  |
| T44 | Mobile pass - 900px and 600px | TODO |  |  |  |
| T45 | Accessibility - axe, keyboard, SR | TODO |  |  |  |
| T46 | Performance budgets | TODO |  |  |  |
| T47 | Hindi localisation | TODO |  |  |  |
| T48 | Legal pages and Rule 4(2) block | TODO |  |  |  |

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
| listing | 8 | 20 | T27 T28 T29 |
| qc | 14 | 30 | T30 T31 |
| catalog | 9 | 20 | T37 |
| vendor | 2 | 3 | T26 done — `/api/vendor/dashboard` existed all along; `api.ts` had it marked MISSING |
| logistics | 2 | **0** | T21 tracking |
| **procurement** | **0** | **0** | T32 T33 T39 T40 |
| **payment** | **0** | **0** | T22 T40 |
| **platform** | **0** | **0** | T23 T24 T41 |
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

- **`GradeCorrectionService.respond()` is exposed by no controller.** The full transactional
  implementation exists — accept, accept-and-reprice, withdraw, dispute — and
  `listing.grade_correction.respond` is granted to four vendor roles and **guards nothing**. A vendor
  therefore cannot answer a correction at all; every one of them auto-applies. That is T31.
- **The auto-apply job is not running.** All nine seeded corrections are 69 hours into a 48-hour
  window and still open, so `autoApplyDue()` has never fired against the dev database. The dashboard
  reports them as breached, which is correct and is also the evidence.
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

