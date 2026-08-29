# BUILD LEDGER

Updated: 2026-08-29T18:20:00+00:00  
Currently: T16 - checkout

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
| T15 | Cart | DONE |  | 54 shots, 13 states x 2 themes x 1440/900/600 | Archetype C. Lines grouped by dispatch point, never called a sub-order; one seller, one invoice, said on the screen. Availability re-read on every open, with the shortfall sentence and a one-click fix; checkout held shut while a line is short. **No 20-minute timer: the hold is checkout's and the cart says so** rather than counting down against nothing. Multiple named carts, `?cart=` in the URL. Found and closed a silent-sign-out: no `/auth/refresh` exists, so a 15-minute-old tab claimed the buyer was signed out. |
| T16 | Checkout | TODO |  |  |  |
| T17 | Order confirmation and approval-required | TODO |  |  |  |
| T18 | Bulk requirement upload | TODO |  |  |  |
| T19 | Customer dashboard | TODO |  |  |  |
| T20 | Order list | TODO |  |  |  |
| T21 | Order detail - serial level | TODO |  |  |  |
| T22 | Documents - invoice, proforma, e-way bill | TODO |  |  |  |
| T23 | Warranty and claims | TODO |  |  |  |
| T24 | Returns inside the 48-hour window | TODO |  |  |  |
| T25 | Account - addresses, team, approvals | TODO |  |  |  |
| T26 | Vendor dashboard | TODO |  |  |  |
| T27 | Listing wizard design pass + commission readout | TODO |  |  |  |
| T28 | Listing management and repricing | TODO |  |  |  |
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

## Known bugs, not yet fixed

- `postJson` in `apps/console/src/routes/vendor/api.ts` reads `message` off the body root,
  but `DomainExceptionFilter` nests it under `error` — so every actionable refusal renders
  as "that did not go through (422)". Behaviour fix, deliberately not done inside a restyle.

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

