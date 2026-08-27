# BUILD LEDGER

Updated: 2026-08-27T11:40:00+00:00  
Currently: T10 - sign-in, both portals, and the surrounding states

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
| T10 | Sign-in, both portals, surrounding states | TODO |  |  |  |
| T11 | Search results /search | TODO |  |  |  |
| T12 | Product detail /laptops/[slug] | TODO |  |  |  |
| T13 | Unit passport /unit/[serial] | TODO |  |  |  |
| T14 | Certificate verification /qc/verify/[code] | TODO |  |  |  |
| T15 | Cart | TODO |  |  |  |
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

