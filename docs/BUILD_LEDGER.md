# BUILD LEDGER

Updated: 2026-08-26T22:56:27+00:00  
Currently: T2 done. Next: T4 - customer registration, shell and steps 1-2

This file is the memory of a long run. Context gets compacted; this does not.
Re-read it at the start of every task. Update it at the end of every task, in the
same commit as the work.

Status is one of `TODO` / `DOING` / `DONE` / `BLOCKED`.

| ID | Task | Status | Commit | Screens verified | Notes |
|----|------|--------|--------|------------------|-------|
| T1 | Console shell and chrome | DONE | 13ab439 | console shell, both themes, 900/600 | Dark chrome per 09_FRONTEND_LOCKED; shell/Shell.tsx + nav.ts; screenshots in .screenshots/T1-console-shell/ |
| T2 | Console design conformance pass | DONE |  | 21 routes, both themes, 1440/900/600 | All 25 route files restyled; 13 hand-rolled tables → DataBoard; archetype declared on every route; board state in the URL; screenshots in docs/review/. **Blocked on a packages/ui defect: see "Open questions".** |
| T3 | packages/ui gap-fill | DONE | 13ab439 | Storybook, both themes | All 20 components exported: StepRail WhyRail OtpInput FormSection AddressCard DocumentViewer RecordHeader SidePanel KpiRow QueueList Timeline + DataBoard density-aware |
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

### 1. `cn()` silently strips every colour class. Six lines, `packages/ui`, blocking.

`packages/ui/src/lib/cn.ts` calls bare `twMerge`. `tailwind-merge` does not know
this project's custom `fontSize` scale, so it classifies `text-body-sm`,
`text-label`, `text-data`, `text-h3` … as **text-colour** classes and drops
whatever real colour sits on the other side of them. Reproduce:

```
$ cd packages/ui && node -e "const {twMerge}=require('tailwind-merge');
  console.log(twMerge('bg-acc text-acc-on','h-11 px-5 text-body-sm'))"
bg-acc h-11 px-5 text-body-sm      # text-acc-on is gone
```

Consequences, on every screen:

- **`Button variant="primary"` loses `text-acc-on`** and inherits `--ink-2`.
  Amber fill, `#A8B1BE` text — about 1.7:1, where §9 of `09_FRONTEND_LOCKED.md`
  claims 11.2:1. Verified in the browser: `getComputedStyle` on the KYC Approve
  button returns `color: rgb(168,177,190)` on `background: rgb(255,182,39)`.
- `danger` loses `text-white`; `link` loses `text-acc-ink`.
- **`StatusPill` and `GradeBadge` lose `text-label` / `text-data`** — the
  *sizes* — so every pill renders at the inherited 14px instead of 10.5px, and
  `DataTable`'s column headers with them. This is the single biggest reason the
  console's type scale does not match `docs/reference/homepage.html`.

The fix is one file:

```ts
import { extendTailwindMerge } from 'tailwind-merge';
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['display-1','display-2','h1','h2','h3','body-lg','body','body-sm','label','data'] },
      ],
    },
  },
});
```

T2 did not apply it: `packages/ui` is T3's lane and another session shares this
tree. **T2's screenshots in `docs/review/` show the defect** — every amber
primary action in them is unreadable for this reason and no other.

### 2. The API does not boot, so T2's screenshots used a mock.

`node apps/api/dist/main.js` dies at startup:

```
UnknownDependenciesException: Nest can't resolve dependencies of the
OnboardingController (KycService, AuditService, VerificationService, ?).
Please make sure that the argument DocumentService at index [3] is available
in the KycModule context.
```

`apps/api/src/modules/kyc/internal/document.service.ts` exists but is not in
`KycModule`'s `providers`. It is an untracked file — in-flight work from the
other lane — so T2 left it alone and drove the console against a stub of the
read endpoints instead. Every screenshot is the real console; only the JSON
behind it is fake.

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

