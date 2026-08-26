# Trugrade - project rules

This file loads into every Claude Code session automatically. Everything here is always in force.

## What this is

B2B marketplace for **refurbished laptops only** (desktops/monitors/parts are marked SOON, not built).
Legal entity **TrueTech Services Pvt. Ltd.** Brand **Trugrade**. QC product **DeviceSure** (separate repo).

**Model: principal / merchant of record, back-to-back.** We hold no stock. At the moment a customer
orders, we buy that serial from the vendor and sell it on our own invoice; goods ship vendor to customer.
We are the seller. Vendor identity is never shown to buyers - they see `Supply Point A - Gurugram`.

## THE RULE THAT KEEPS BEING BROKEN

**A feature is not done until its screen is done.** The backend is currently 32,000 lines and the
storefront is 1,400. Do not add another service method to a module whose screens do not exist.

When a task says "build X", X includes: the route, the page, every state (loading / empty / error /
success), the validation with real messages, and the visual result matching the design system. A
passing integration test on an unstyled form is not a completed task.

## Design system - non-negotiable

Read `docs/09_FRONTEND_LOCKED.md` before touching any UI. **`docs/reference/homepage.html` is the
reference implementation - when it and any written description disagree, the file wins.**

- Tokens live only in `packages/ui/src/globals.css`. **No literal hex anywhere else.**
- Dark is default. `data-t="dark|light"` on `<html>`, persisted, pre-paint read to avoid flash.
- **Header and footer are dark in both themes.** Only working surfaces flip.
- Amber `--acc` means exactly three things: a primary action, a measured value, an active state.
  Nothing else. One primary action per screen.
- **Grades are neutral** (A+/A/B are all sellable). Green/red are reserved for PASS/FAIL only.
- **Every number is IBM Plex Mono with `tabular-nums`** - prices, serials, scores, counts, percentages,
  GSTINs, HSN codes. Inter for everything else. Base size 14px.
- Every percentage carries its denominator: `98% - 412 units`, never `98%`.
- **A missing value never renders as a passing one.** "Not measured" in `--ink-4`, never a tick.
- Never invent a component. Check `packages/ui` first; if it is missing, add it there, not in the app.

## Page archetypes

Every screen is one of six shapes. Declare which one at the top of the route file.

| | Shape | Structure |
|---|---|---|
| A | Landing | Claim, one control, then real inventory |
| B | **Board** | Filter rail + data table + row actions |
| C | **Record** | Identity header + evidence panel + actions side panel |
| D | Flow | Step rail + one step + "why we ask" rail |
| E | Workspace | KPI row, then queues ordered by SLA breach |
| F | Focus | One task, centred, no navigation |

B and C cover two thirds of the product. Do not invent a seventh shape without asking.

## Density

`data-density="comfortable|default|compact"` on the app root. Storefront comfortable (60px rows),
vendor default (46px), admin compact (34px). **One DataBoard component, three settings.** Writing a
second table component means the system has already failed.

## Hard architectural rules

- **No business logic in Next.js route handlers or server actions.** They may call the API, never be it.
  An Android app ships later and must consume the same endpoints.
- Token auth (JWT + rotating refresh in an httpOnly cookie). Never cookie-only sessions.
- Modules never cross-import. No cross-schema JOINs. The ESLint rule enforces it - do not disable it.
- Org scoping happens at the **repository** layer, never the service layer.
- **Board state lives in the URL** - filters, sort, page. A buyer must be able to send a colleague a link.
- `unit.purchase_price` and `unit.valuation_method` are immutable once set (DB triggers).
- Customer-facing responses are built from explicit allow-lists. **Never `return listing`.** No vendor
  name, GSTIN, address, contact or `org_id` may appear in any buyer-reachable payload, at any depth.

## Validation

Indian B2B: GSTIN `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$` (verify checksum),
PAN `^[A-Z]{5}[0-9]{4}[A-Z]$`, IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`, pincode `^[1-9][0-9]{5}$`,
mobile normalised to `+91XXXXXXXXXX`, CIN 21 chars, Udyam `^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$`.

Errors name what failed and how to fix it: *"Address proof is dated Jan 2025. We need one from the last
three months."* Never "Invalid input". Never a red border with no message.

**`PROVIDER_ERROR` is not `FAIL`.** A GST portal timeout is our problem, not the applicant's - say so,
retry automatically, and do not consume one of their attempts.

## Before you say a task is done

1. `pnpm dev`, open the route, and **look at it**.
2. Screenshot it with Playwright and compare against `docs/reference/homepage.html` for chrome,
   spacing, type and colour.
3. Check every state: loading, empty, error, success, and the mobile breakpoint.
4. Toggle dark/light. Both must be correct.
5. `pnpm lint && pnpm typecheck && pnpm test`.

If you have not looked at the screen, the task is not finished.

## House style

- Comment *why*, never *what*. No commented-out code, no `TODO` without an owner.
- No `any`. No `@ts-ignore`. No disabled lint rules.
- Conventional commits, one concern per commit.
- Never fabricate data on a screen. Counters, scores and stock come from the API or do not appear.
