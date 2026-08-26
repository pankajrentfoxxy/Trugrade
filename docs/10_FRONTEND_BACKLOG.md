# 10 - Frontend backlog: how to finish the build, one screen at a time

**26 August 2026.** Read this before pasting anything else into Claude Code.

---

## Part 1 - Why the build came out basic

This is measurable, not a matter of opinion. Lines of source in your repo today:

| Area | Lines |
|---|---|
| `apps/api/src` | **32,472** |
| `apps/console/src` | 9,404 |
| **`apps/storefront/src`** | **1,395** |
| `packages/ui/src` | 3,841 |

**The backend is 23x the size of the entire customer-facing app.** The storefront has exactly three
routes - `/`, `/sign-in`, `/register`. No product page, no search results, no cart, no checkout, no
orders, no unit passport, no customer portal. `AuthForms.tsx` is 6.6 KB, which cannot contain a
five-step registration with GSTIN and PAN verification - it is a basic email and password form.

Your git log says the same thing out loud:

```
d63e6d4  Phase 1 (backend) - identity, RBAC, and the onboarding engine
9f09aff  Phase 5 - one definition of sellable, supply-point labels, and the anonymity sweep
a24d53a  Phase 6 - purchase orders, the TDS ledger, and place of supply
```

Phase 1 is explicitly labelled *(backend)*. Phase 5 was the **storefront** phase and shipped as
backend rules. Phase 6 was **orders and checkout** and shipped as purchase orders and tax ledgers.

**Five causes, and four of them are mine.**

**1. My phase prompts were backend-shaped.** Phase 1 has ten tasks. Nine describe tables, services,
verification adapters and consent records in exhaustive detail. Task 10 is *"Frontend"* - one
paragraph, at the very end. Claude Code built what was specified, and the UI was barely specified.

**2. The exit criteria were functional, never visual.** *"A vendor completes all 7 steps"* passes with
seven unstyled forms. Nothing in any phase said *"and it matches the design system."*

**3. `03_UX_SPEC.md` is 192 KB.** No coding session reads that in full. The instruction *"read
§3A of the UX spec"* was, in practice, an instruction that got skimmed.

**4. The design was locked too late.** Look at the commit order - the Darkroom tokens landed **after**
Phases 1 through 7. Everything before that was built with no approved design to build to.

**5. Each phase was 3 to 10 days of work in one prompt.** Given ten tasks, a session does the ones it
can model precisely - schema, services, tests - and skims the rest. Phase-sized prompts produce
backend-sized results.

**And here is the proof that the fix works.** One screen in the storefront is right: the homepage.
`page.tsx` plus `storefront.css` is 41 KB, and the commit reads *"ported from the reference."* It is
the only screen that had a reference implementation and a narrow, single-screen task. That is the
entire method, and everything below applies it to the remaining forty screens.

---

## Part 2 - Three changes before the next task

### 2.1 Put `CLAUDE.md` in the repo root

**This is the single highest-leverage fix.** Claude Code loads `CLAUDE.md` into *every* session
automatically. Your rules stop being a 192 KB file it is asked to read and become context it always has.

Your repo has no `CLAUDE.md`. Copy the one supplied with this backlog to the repository root and commit it.

### 2.2 One screen per session, never one phase

Stop pasting phase prompts. Paste **one task from Part 3**, let it finish, review it, commit, then start
a **new session** for the next one. A fresh session per screen keeps the design rules at full strength;
by hour three of a long session they have been crowded out by whatever it is currently reading.

### 2.3 Make it look at its own work

Every task below ends with the same acceptance block. It forces the loop that was missing: run it,
screenshot it, compare it against the reference, check both themes. Claude Code has Playwright
available and can do this unaided - it simply was never told to.

---

## Part 3 - The backlog

**48 tasks in 7 waves.** Each is one session. Do them in order; later waves assume earlier ones.

### The task template

Every task follows this shape. Paste it verbatim, filling the bracketed parts:

```
Build [SCREEN NAME] at [ROUTE].

Read docs/09_FRONTEND_LOCKED.md and open docs/reference/homepage.html before starting.
That file is the reference implementation - where it and any description disagree, it wins.

ARCHETYPE: [A-F] from CLAUDE.md. DENSITY: [comfortable|default|compact].

WHAT IT DOES: [2-3 sentences of purpose, from the user's point of view]

SECTIONS, in order:
1. [...]
2. [...]

DATA: [which API endpoints; build them only if missing]

VALIDATION: [field rules, with the real error text a user will read]

STATES: loading / empty / error / success - describe what each shows.

ACCEPTANCE - do all of these before saying it is done:
- pnpm dev, open the route, and look at it
- screenshot with Playwright; compare chrome, spacing, type and colour against the reference
- check every state above, plus the 900px and 600px breakpoints
- toggle dark and light; both correct; header and footer unchanged between them
- no literal hex outside globals.css; every number in IBM Plex Mono with tabular-nums
- pnpm lint && pnpm typecheck && pnpm test
```

---

### WAVE 1 - Make what exists look built (3 tasks)

The console has 9,404 lines of working screens with no design applied. Fix that before adding more.

**T1. Console shell and chrome.**
Dark top bar and left rail per CLAUDE.md, theme toggle, `data-density="compact"` for admin routes and
`"default"` for vendor routes. Every existing console route re-parented onto it. No route keeps its own
layout.

**T2. Console design conformance pass.**
Every file under `apps/console/src/routes` restyled onto `packages/ui` components and tokens. Delete
every local style and literal hex. Tables become the shared `DataBoard`. This is a large mechanical
task - it is fine for it to take two sessions.

**T3. `packages/ui` gap-fill.**
Build every component the backlog needs that does not exist yet: `StepRail`, `FormSection`, `WhyRail`,
`RecordHeader`, `SidePanel`, `KpiRow`, `QueueList`, `Timeline`, `EmptyState`, `FileUpload`, `OtpInput`,
`AddressCard`, `PriceBreakdown`, `DocumentViewer`, `StatusPill`, `BatteryBar`, `QcChip`, `GradeBadge`.
Storybook story per component per state per theme. Axe clean.

---

### WAVE 2 - Registration and auth (7 tasks)

You called this out specifically. It is the first thing a real vendor or buyer touches, and today it is
a single 6.6 KB form.

**T4. Customer registration - the shell and steps 1-2.**
Archetype D. Five steps, save-and-resume from `kyc.onboarding_progress.draft_json`, step rail, and the
"why we ask" rail. Step 1 Account: name, work email + OTP, mobile + OTP, password with a strength meter,
how they heard of us. Step 2 Company: legal name, trade name, constitution, industry, year established,
employee band, website, annual volume.

**T5. Customer registration - step 3, statutory.**
GSTIN with live format check then GSTN verification, showing the returned legal name for confirmation.
Additional GSTINs. PAN with verification. Primary GSTIN selection - **this single field decides how they
are invoiced forever, so it gets its own explanation.** `PROVIDER_ERROR` renders differently from `FAIL`.

**T6. Customer registration - steps 4-5 and submission.**
Step 4 Contacts and addresses: procurement, finance and IT contacts; billing address per GSTIN; delivery
addresses with contact, mobile, landmark, gate instructions and receiving hours. Step 5 Documents and
preferences: GST certificate, PAN card, authorised-purchaser ID, optional PO template - drag-and-drop,
5 MB cap, magic-byte validation, per-file progress and error. Notification channels, language, PO-required
flag. Then the review screen, submission, and the pending-approval state.

**T7. Vendor registration - steps 1-3.**
Archetype D, seven steps. Step 1 Contact: company, contact person, mobile + OTP, email + OTP, city,
monthly volume, brands dealt. Step 2 Business: legal name, trade name, constitution, incorporation date,
registered and operating addresses, category, website, staff count. Step 3 Statutory: GSTIN, PAN,
CIN/LLPIN, Udyam, TAN - each verified, each showing what came back.

**T8. Vendor registration - steps 4-5.**
Step 4 Capability: categories, brands, monthly capacity, grade mix, price bands, sourcing channels,
serials-upfront, in-house testing and repair, lead time, and **`can_dropship`** (required - a vendor who
cannot dispatch direct is a materially different vendor). Step 5 Facility and contacts: per warehouse -
address, **`dispatch_address`** (this becomes Dispatch From on every e-way bill), type, capacity, loading
dock, vehicle access, lift, testing stations, operating hours per day, holidays. Owner, ops, finance and
warehouse contacts with WhatsApp numbers and preferred language.

**T9. Vendor registration - steps 6-7 and submission.**
Step 6 Documents and bank: GST certificate, PAN, cancelled cheque, address proof, incorporation doc,
signatory ID, board resolution, optional CPCB and ISO. Bank account with a **penny-drop** showing live
status. Step 7 Agreement and payout: four e-signed documents, `pricing_mode`, payout cycle, threshold,
notification preferences. Then review, submit, application-status screen with per-step state and any
`blocking_reason` shown **verbatim**.

**T10. Sign-in, both portals, and the surrounding states.**
Archetype F. Customer: OTP-first with password secondary. Vendor: password-first with mandatory TOTP for
owner accounts. Plus forgot-password, reset, pending-approval, rejected-with-reason, and account-suspended.
Rate limiting surfaced honestly - *"Too many attempts. Try again in 4 minutes."*

---

### WAVE 3 - The buying path (8 tasks)

**T11.** Search results - `/search`. Archetype B. The fifteen-facet rail from the reference, URL state,
live counts, disabled-not-hidden zero facets, sort, grid/list toggle, pagination.
**T12.** Product detail - `/laptops/[slug]`. Archetype C. Condition images with the mandatory
representative-image caption, spec table, grade selector, and the **supply-point comparison board**.
**T13.** Unit passport - `/unit/[serial]`. Real inspection photos, twelve area results, detected hardware,
seal record, wipe certificate. **Reachable before purchase, no account.**
**T14.** Public certificate verification - `/qc/verify/[code]`. Built for a phone held next to an open
laptop. Large PASS state, zoomable photos, seal code prominent. Rate-limited, `noindex`.
**T15.** Cart - multi-supply-point, live stock re-check, 20-minute hold with a visible timer.
**T16.** Checkout - archetype D. GSTIN selection with the **IGST vs CGST+SGST split shown before
confirmation**, delivery site, PO reference, payment mode, full price break-up on one screen.
**T17.** Order confirmation and the approval-required state.
**T18.** Bulk requirement upload - CSV/XLSX parse, match against catalog, show what is and is not
available, create a lead for the rest.

---

### WAVE 4 - Customer portal (7 tasks)

**T19.** Dashboard - archetype E.
**T20.** Order list - archetype B.
**T21.** **Order detail - archetype C. Serial-level.** Timeline from `order_event`, per-serial QC report
links, documents, tracking. Eight machines from two dispatch points arriving on different days is shown
honestly, never averaged into one misleading status.
**T22.** **Documents - invoice, proforma, order confirmation, e-way bill, and the customer's own PO
reference.** Server-rendered PDFs, brand-correct, with serials printed.
**T23.** Warranty - list per serial, coverage, and the claim flow. **One number only: the total the
customer gets. The vendor/platform split appears nowhere.**
**T24.** Returns inside the 48-hour window - auto-approved against our own QC record where the claim is
verifiable.
**T25.** Account - addresses, team and roles, approval inbox, spend limits, credit application, saved
searches, support tickets.

---

### WAVE 5 - Vendor portal (8 tasks)

**T26.** Dashboard - archetype E. **T27.** Listing wizard design pass, with the **live commission
readout** (vendor enters ₹28,000, screen shows "Trugrade commission 12.8%"). **T28.** Listing management
and repricing. **T29.** Bulk serial upload with dry-run. **T30.** QC visit request, scheduling,
per-unit results. **T31.** Grade-correction response - accept / reprice / withdraw / dispute, with the
2-day auto-apply clock visible. **T32.** Purchase orders - exact serials and seal codes to produce,
pick list, acknowledge or reject. **T33.** Payables and payout statement with every deduction named and
sourced, plus scorecard and tier.

---

### WAVE 6 - Admin console (8 tasks)

**T34.** Ops dashboard - what is stuck, what breached SLA. **T35.** Global search + **Unit 360**
(every fact about one serial on one page). **T36.** Onboarding review queue with document viewer and
48-hour SLA clock. **T37.** Catalog and the **condition-image library** with a coverage grid.
**T38.** Margin rules and price books. **T39.** Order board and procurement board with three-way match.
**T40.** Finance console - receivables, payables, reconciliation exceptions, payout runs, TDS register.
**T41.** Config, feature flags, notification templates, audit log viewer.

---

### WAVE 7 - Close-out (7 tasks)

**T42.** Theme toggle audited across every route, no flash on any of them.
**T43.** Every empty, loading and error state audited against the design system.
**T44.** Mobile pass - 900px and 600px on all ~48 routes.
**T45.** Accessibility - axe clean in both themes, keyboard paths, screen-reader labels.
**T46.** Performance - offers grid p95 under 500 ms, search under 300 ms, LCP under 2.5 s on mid-range
Android over 4G.
**T47.** Hindi localisation for buyer and vendor transactional surfaces.
**T48.** Legal pages, the Rule 4(2) disclosure block on every page, grievance-officer workflow.

---

## Part 4 - How to run a session

1. **New session per task.** Do not continue the previous one.
2. Paste **one task**, using the template.
3. When it says it is done, ask: *"Show me the screenshot you took, in both themes."* If it did not take
   one, it did not check - send it back.
4. **You look at it too**, at 1440px and on a phone.
5. Commit. Then a new session for the next task.

**If a task starts sprawling into backend work, stop it.** *"The API is out of scope for this task. If an
endpoint is missing, list what you need and build only that, then return to the screen."* That single
sentence is what prevents another 32,000-line backend.

## Part 5 - What to hand over, and when

**Once, now:** `CLAUDE.md` to the repository root. Commit it.

**Already in `docs/`:** `09_FRONTEND_LOCKED.md`, `reference/homepage.html`, `_CONTEXT.md`. Nothing to do.

**Per task:** just the task text. `CLAUDE.md` carries the rules; the task carries the screen. **Do not
paste the phase files again** - they are the reason the backend is 23x the frontend.
