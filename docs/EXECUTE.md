# EXECUTE - the run-to-completion prompt

**Open a fresh Claude Code session in the `trugrade` repo root. Paste everything between the `===`
markers. Then leave it alone.**

Do not paste anything else. Do not answer "shall I continue" - it is instructed not to ask.

===============================================================================

You are finishing the Trugrade platform. This is a run-to-completion instruction: work through every
task below in order, without stopping to ask permission between tasks, until the whole thing is built
and ready for me to review locally.

## 1. Read these first, in this order

1. `CLAUDE.md` - project rules, always in force
2. `docs/09_FRONTEND_LOCKED.md` - the locked design system
3. **`docs/reference/homepage.html`** - the reference implementation. **Where this file and any written
   description disagree, this file wins.** Open it and actually read it before writing UI.
4. `docs/10_FRONTEND_BACKLOG.md` - the 48 tasks, T1 to T48
5. `docs/_CONTEXT.md` - the business model

Do not read the `docs/PHASE_*.md` files. They are backend-shaped and they are the reason this repo has
32,000 lines of API and 1,400 lines of storefront. They are history, not instructions.

## 2. The ledger - do this before anything else

Create `docs/BUILD_LEDGER.md` with a row for every task T1 to T48:

```markdown
# BUILD LEDGER
Updated: <ISO timestamp>
Currently: <task id> - <one line on what you are doing>

| ID | Task | Status | Commit | Screens verified | Notes |
|----|------|--------|--------|------------------|-------|
| T1 | Console shell and chrome | TODO | | | |
```

Status is one of `TODO` / `DOING` / `DONE` / `BLOCKED`.

**This file is your memory.** Your context will be compacted many times over a run this long. Every time
that happens you will lose the thread. So:

- **Re-read the ledger at the start of every task.** It is the truth about where you are.
- **Update it at the end of every task**, in the same commit as the work.
- If you ever find yourself unsure what you were doing, do not guess and do not restart - read the ledger.

## 3. Execution contract

**Sequence.** Strictly T1 to T48, in order. The order already encodes the dependencies: T3 builds the
components that Waves 2 to 6 consume, so it lands before any screen that needs them.

**One task at a time.** Do not start a task while another is unfinished. Do not run tasks in parallel.
Do not split a task into "the half that doesn't collide" - finish it, commit it, move on.

**Do not ask to continue.** After finishing a task, update the ledger, commit, and immediately begin the
next one. The only reasons to stop are in section 6.

**Commit per task**, conventional commits, referencing the task id:
`feat(storefront): T11 search results with the fifteen-facet rail`

**If a task turns out to be already done**, verify it against the definition of done in section 4. If it
passes, mark it `DONE` with a note and move on. If it does not, finish it properly.

**Scope discipline.** These tasks are screens. If an API endpoint a screen needs is missing, build only
that endpoint, then return to the screen. Do not extend a module beyond what the screen in front of you
requires. The backend is already 23x the frontend; do not widen that gap.

## 4. Definition of done - every task, no exceptions

A task is done when **all** of these are true:

1. The route exists and renders.
2. **You ran `pnpm dev`, opened the route, and looked at it.**
3. **You took a Playwright screenshot in both themes** and saved them to
   `docs/review/<task-id>-<route>-dark.png` and `-light.png`.
4. You compared those screenshots against `docs/reference/homepage.html` for chrome, spacing, type
   scale, colour and density - and fixed what did not match.
5. Every state is built: loading, empty, error, success.
6. Breakpoints checked at 1440, 900 and 600.
7. Both themes correct; header and footer identical between them.
8. No literal hex outside `packages/ui/src/globals.css`. Every number in IBM Plex Mono with
   `tabular-nums`. Every percentage carries its denominator.
9. Validation errors name what failed and how to fix it, in real sentences.
10. `pnpm lint && pnpm typecheck && pnpm test` all pass.
11. Ledger updated, work committed.

**A passing test on an unstyled form is not a completed task.** If you have not looked at the screen,
you are not finished.

## 5. The waves

Work the backlog in `docs/10_FRONTEND_BACKLOG.md` Part 3. Summary of what each wave must leave behind:

**Wave 1, T1-T3 - foundations.** Console shell with dark chrome and rail; every existing console route
restyled onto tokens with no local styles or literal hex left; `packages/ui` complete with `StepRail`,
`WhyRail`, `OtpInput`, `FormSection`, `AddressCard`, `DocumentViewer`, `RecordHeader`, `SidePanel`,
`KpiRow`, `QueueList`, `Timeline`, `EmptyState`, `FileUpload`, `PriceBreakdown`, `StatusPill`,
`BatteryBar`, `QcChip`, `GradeBadge` - each with a Storybook story per state per theme, axe clean.
**Nothing in later waves may hand-roll any of these.**

**Wave 2, T4-T10 - registration and auth.** Customer 5 steps, vendor 7 steps, both with save-and-resume,
real GSTIN/PAN/penny-drop verification with `PROVIDER_ERROR` shown differently from `FAIL`, document
upload with magic-byte validation and EXIF stripping, e-sign, application status showing any
`blocking_reason` verbatim. Both sign-ins, MFA for vendor owners, and every surrounding state -
pending, rejected, suspended, rate-limited. Registration OTP must work for an applicant who has no
account yet, `@Public`, rate-limited per identifier and per IP, with a response byte-identical for known
and unknown emails so it cannot be used to enumerate our vendor list.

**Wave 3, T11-T18 - the buying path.** Search results, product detail with the supply-point comparison
board, unit passport, public certificate verification, cart, checkout, order confirmation, bulk upload.

**Wave 4, T19-T25 - customer portal.** Dashboard, order list, serial-level order detail, documents and
PDFs, warranty and claims, returns, account.

**Wave 5, T26-T33 - vendor portal.** Dashboard, listing wizard with the live commission readout, listing
management, bulk upload, QC visits, grade-correction response, purchase orders, payables and scorecard.

**Wave 6, T34-T41 - admin console.** Ops dashboard, global search and Unit 360, review queue, catalog and
condition images, margin rules, order and procurement boards, finance, config and audit.

**Wave 7, T42-T48 - close-out.** Theme audit, state audit, mobile pass, accessibility, performance,
Hindi localisation, legal pages and the Rule 4(2) block.

## 6. When to stop and ask - and only then

Stop and ask me exactly four kinds of question:

1. **A commercial decision I have not made** - a number, a policy, a rule that is not in the docs.
2. **A design conflict** the reference file does not settle.
3. **Something that would break a decision already recorded** in `_CONTEXT.md` or `09_FRONTEND_LOCKED.md`.
4. **A blocker you have genuinely tried and failed to solve** - after at least two real attempts, with
   what you tried written down.

When you do stop: write the question into `docs/BUILD_LEDGER.md` under a `## Open questions` heading,
mark that task `BLOCKED`, **skip it and carry on with the next task**. Do not idle waiting for me.

Never stop to ask permission, to report progress, or to confirm the plan.

## 7. Final handover

When T48 is done - and only then:

1. Run migrations from an empty database, then seed a **full demo dataset**: 200 SKUs with condition
   images, 5 vendors at different tiers, 3 buyers, 300 inspected and sealed units across supply points,
   live listings, 12 orders across every status, purchase orders, invoices, one warranty claim, one
   return, one grade correction awaiting a vendor response.
2. Start the API, storefront and console, and confirm each responds.
3. Screenshot **every route** in both themes into `docs/review/`.
4. Write `docs/REVIEW.md` containing:
   - Start commands, ports, and how to reset the database
   - **Login credentials for every persona** - buyer owner, buyer approver, vendor owner, vendor staff,
     ops manager, KYC reviewer, QC manager, finance, admin
   - A **numbered walkthrough** a non-technical person can follow end to end: register a vendor, approve
     it, list stock, run an inspection, watch it go live, buy it as a customer, see the purchase order
     raised, mark it delivered, raise a warranty claim
   - Every route grouped by portal, with its screenshot
   - What is deliberately mocked (couriers, payment gateway, SMS, e-invoice) and how to switch each to real
   - **Known gaps** and everything under `## Open questions`
5. Then stop and tell me: **"Build complete. Ready for local review - see `docs/REVIEW.md`."**

## 8. Start now

Read the five documents in section 1. Create the ledger. Begin at the first task that is not `DONE`.
Do not reply to this message with a plan - reply by starting work.

===============================================================================

---

## How to use it

**Before you paste:**

```bash
cd trugrade
git status          # commit or stash anything in flight
git checkout -b build/run-to-completion
```

**Then:** new Claude Code session, paste the block above, walk away.

**What to expect.** This is a long run - realistically days of wall time, not hours, and the context
will compact many times. That is what the ledger is for: it re-reads `docs/BUILD_LEDGER.md` at the start
of every task, so a compaction costs it a few seconds instead of the thread.

**How to check in without derailing it.** Do not interrupt with questions. Open `docs/BUILD_LEDGER.md`
in VS Code - it tells you the current task, what is done, and any blocked items. Browse `docs/review/`
for the screenshots as they appear.

**If it stops early**, paste exactly this:

```
Read docs/BUILD_LEDGER.md and continue from the first task that is not DONE.
Same contract as before: one task at a time, in order, do not ask to continue.
```

**If a wave comes out weak**, do not restart the run. Let it finish, then fix that wave with individual
tasks from the backlog - by then the components exist and the fixes are small.

**One thing worth doing yourself.** At the end of each wave, spend ten minutes in `docs/review/` looking
at the screenshots. Wave 1 and Wave 2 are the ones worth catching early: if the console shell and the
registration flows are right, everything after them inherits that. If they are wrong, everything after
them inherits that too.
