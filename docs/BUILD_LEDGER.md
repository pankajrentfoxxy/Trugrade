# BUILD LEDGER

Updated: 2026-08-26T22:56:27+00:00  
Currently: T2 - restyling the 25 console route files onto the shell and tokens

This file is the memory of a long run. Context gets compacted; this does not.
Re-read it at the start of every task. Update it at the end of every task, in the
same commit as the work.

Status is one of `TODO` / `DOING` / `DONE` / `BLOCKED`.

| ID | Task | Status | Commit | Screens verified | Notes |
|----|------|--------|--------|------------------|-------|
| T1 | Console shell and chrome | DONE |  | console shell, both themes, 900/600 | Dark chrome per 09_FRONTEND_LOCKED; shell/Shell.tsx + nav.ts; screenshots in .screenshots/T1-console-shell/ |
| T2 | Console design conformance pass | TODO |  |  |  |
| T3 | packages/ui gap-fill | DONE |  | Storybook, both themes | All 20 components exported: StepRail WhyRail OtpInput FormSection AddressCard DocumentViewer RecordHeader SidePanel KpiRow QueueList Timeline + DataBoard density-aware |
| T4 | Customer registration - shell and steps 1-2 | TODO |  |  |  |
| T5 | Customer registration - step 3 statutory | TODO |  |  |  |
| T6 | Customer registration - steps 4-5 and submission | TODO |  |  |  |
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

_None yet. A blocked task is recorded here with what was tried, marked BLOCKED in
the table, and skipped — the run does not idle waiting for an answer._

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

