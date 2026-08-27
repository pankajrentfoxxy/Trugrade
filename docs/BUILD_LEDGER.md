# BUILD LEDGER

Updated: 2026-08-27T07:40:00+00:00  
Currently: T6 - customer registration steps 4-5 and submission

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
| T5 | Customer registration - step 3 statutory | DONE | (pending) | 34 shots, both themes, 1440/900/600 | PASS shows the returned legal name; FAIL names the reason; PROVIDER_ERROR never blames the applicant, never consumes an attempt, retries with visible backoff. Checksum + embedded-PAN conflict caught client-side. Fixed a cross-tenant rate-limit hole and the invalid GSTIN example. |
| T6 | Customer registration - steps 4-5 and submission | DOING |  |  |  |
| T7 | Vendor registration - steps 1-3 | TODO |  |  |  |
| T8 | Vendor registration - steps 4-5 | TODO |  |  |  |
| T9 | Vendor registration - steps 6-7 and submission | TODO |  |  |  |
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

## Known bugs, not yet fixed

- `postJson` in `apps/console/src/routes/vendor/api.ts` reads `message` off the body root,
  but `DomainExceptionFilter` nests it under `error` — so every actionable refusal renders
  as "that did not go through (422)". Behaviour fix, deliberately not done inside a restyle.

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

