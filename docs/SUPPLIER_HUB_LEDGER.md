# Supplier Hub ledger

**Scope:** `apps/console` vendor surface only. Admin console appearance unchanged.
**Design language:** SUPPLIER HUB (`data-surface="hub"`) — white chrome, soft radius, real elevation on cards that carry an action, Inter throughout. MANIFEST (paper ground, square corners, Newsreader) was retired in Stage 10.
**Prior work:** Landed in commit `f15a886` (`seller_pannel`) under the VENDOR MANIFEST plan. This ledger is the only surviving record of that plan — `docs/VENDOR_MANIFEST.md` and `docs/VENDOR_MANIFEST_LEDGER.md` were deleted in Stage 10 and everything still open from them is folded in below.

| Stage | What | Status | Commit | Screens verified | Notes |
|-------|------|--------|--------|------------------|-------|
| 0 | Context / ledger | DONE | — | — | This file. Stage 0 rules re-read each session. |
| 1 | Hub token scope, type scale, contrast | DONE | 8b7a443 | 1-admin-* | `data-surface=hub` in `globals.css`, `hub-scope.spec.ts`, hub block in `tokens.spec.ts`. Safety: absent attribute → no change. |
| 2 | VendorShell + grouped nav | DONE | f15a886 | — | `VendorShell.tsx`, `useVendorCounts.ts`, `vendor-surface.tsx`, nav regrouped (Today/Sell/Inspect/Fulfil/Money/Account). `Shell.tsx` filter: `surface !== 'VENDOR'` only. |
| 3 | Ledger primitives + scoped CSS | DONE | f15a886 | — | Superseded by Stage 10: the primitives are now `PageHeader`, `Panel`, `LedgerRow`, `HubKpiRow`, `InfoPopover`, `PermissionGrid`. |
| 4 | Today, Listings, Units | DONE | f15a886 | — | Dashboard rebuilt. Listings/units restyled. |
| 5 | Inspect | DONE | f15a886 | — | Visits + corrections restyled. Auto-apply job still unwired (see Open questions). |
| 6 | PO line response + orders board | DONE | — | — | Per-line accept/reject, KPI board, detail dialog, serial attach, dispatch. |
| 7 | Hub screens (Home → Documents) | DONE | — | — | `data-surface=hub`, copy budget, create-listing dialog. |
| 8 | Team & access | DONE | — | — | Superseded by plan §5 below; invite flow + facility scope landed in this stage. |
| 9 | Close-out | TODO | — | — | Word-count pass, `SUPPLIER_HUB_REVIEW.md`. |
| 10 | Repaint the vendor surface as the supplier hub | DONE | — | `1b-*` | MANIFEST token block, scoped element rules, `manifest.tsx` and `manifest-scope.spec.ts` all deleted. `vendor-ledger.css` → `vendor-hub.css`, `vl-` → `hub-`. White masthead, 96px icon rail, 1800px centred page. Prepaint says `hub` and covers `/sell`. |
| 11 | Prototype parity: cascading machine picker, shell banner, ten-item rail | DONE | — | `2-*` | Free-text SKU search replaced by Brand → Model → Processor → Generation → RAM → Hard disk. Profile banner moved from the dashboard into the shell. Rail cut from 14 items to the prototype's 10. |

### Stage 11 — the machine picker

The listing flow asked for a SKU by free text. A vendor who could not spell
"EliteBook 840 G8" got an empty result and no way to tell a typo from a machine
we have not catalogued. It is now six narrowing dropdowns, each answered from
what the catalog carries under the rung above it.

| Decision | Why |
|---|---|
| Two new `@Public()` routes, `catalog/picker/brands` and `catalog/picker/models` | No vendor role holds a `catalog.*` permission, and the existing `catalog/brands` is `catalog.sku.read`. Same reasoning as `models/search` directly above them. |
| A brand with no active SKU is not offered at all | Picking it would open an empty model list, which reads as a failed request rather than a catalog gap. |
| A seventh dropdown, "Screen and graphics" | Six axes do not always identify one SKU — two entries can agree on all six and differ on screen. It appears only when they do. Resolving to whichever row came back first would list the vendor's stock against the wrong catalog entry. |
| `MachinePicker` lives in `routes/vendor`, not `packages/ui` | It fetches from `/api/catalog`. `packages/ui` holds presentational components; a data-fetching picker there would make the design system depend on this app's API shape. |
| Label fixes: "Intel i5-1135G7" not "Intel Core i5 i5-1135G7"; "Latitude 3420" not "Latitude Latitude 3420" | `cpu_family` already contains the model prefix and `model.name` usually already contains the series — but not always, so both are conditional, not a blanket drop. |

### Stage 11 — the rail, and what came off it

Ten items, matching the prototype: Home · Listings · Inspect · Grades · Orders ·
Payouts · Team · Facilities · Documents · Profile.

Four real routes came off the rail and gained a `rail: false` flag. They stay in
`NAV` — `activeEntry()` still lights the section a sub-route belongs under, and
the command palette still finds them. **Two of them were reachable from nowhere
else**, so the links came first and the rail change second:

| Route | Now reached from |
|---|---|
| `/vendor/listings/new` | "List a batch" on the Listings board |
| `/vendor/sku-request` | The machine picker's footer, where a vendor discovers the gap |
| `/vendor/dispatch` | "Dispatch board" on Purchase orders |
| `/vendor/payouts` | "Payout history" on Payouts |

### Stage 11 — where the prototype was NOT followed

| Prototype | Shipped | Why |
|---|---|---|
| An unscheduled visit shows `—` in `--ink-4` | `NotMeasured` — "Not scheduled yet" | `Visits.spec.tsx` is a committed contract and asserts the words, and CLAUDE.md's missing-value rule wants words over a glyph. A dash also carries no reason for a screen reader. |
| A notification bell with a `--fail` dot | Not built | There is no notification source. A bell that always shows an unread dot fabricates data on a screen. |
| Page subtitles that are prose | Only the factual ones (Listings, Team) | Stage 0 rule 3 and the Stage 7 copy budget. "9 created · 1 unit on sale" is a fact; "We raise one when a buyer orders machines you listed" is a paragraph. |

### Stage 10 — naming decisions worth keeping

| Plan said | Shipped as | Why |
|---|---|---|
| `RegisterStrip` → `KpiRow` | `HubKpiRow` | `KpiRow` is the Archetype E workspace component, exported from `@trugrade/ui` and used by `OpsOverview`, `finance/Console`, `qc/AuditRecheck` and the storefront account dashboard. Two exports of that name do not build, and renaming the admin one would have put the "admin is pixel-identical" check at risk for no gain. |
| `REGISTER_SUB_MAX` | `KPI_SUB_MAX` | Same 40-character cap, same spec. "Register" was MANIFEST vocabulary. |
| `ClauseHeading` props `n` / `kicker` | dropped | The clause number went with the ledger. `kicker` only ever echoed the rail's group heading — "Money" above a page the rail already marks as Money. |
| `LedgerSection` prop `aside` | `actions` | It is an actions slot on `Panel`; `aside` described where it sat, not what it held. |
| `PermissionGrid` `highlightRole` | added alongside `highlightColumn` | `highlightColumn` takes an index and `MemberDialog` already passes one. `highlightRole` takes the column heading, which is what the add-user preview actually has. |
| `ClauseHeading` → `PageHeader` | `HubPageHeader` | Same collision shape as `KpiRow`: `apps/console/src/lib/controls.tsx` already exports a `PageHeader` that takes its body as `children`, and roughly twenty-five admin and vendor screens import it. `Visits.tsx` imports both, so the two names had to stay distinct. |

### Stage 10 — two things the screenshots caught

- **The rail badge is a count, never a measure.** Payables briefly showed a rounded rupee total (`₹2.4L`); five glyphs do not fit a 40px tile and it wrapped over the icon. Badges are now counts of things waiting only, per the plan's "an item with work waiting gets a `--fail` count badge".
- **`HubKpiCell.value` is `string | null`.** The dashboard was calling `String(data.liveListings)`, which writes the word "undefined" into a 30px mono metric when an older API build omits a field. `null` now renders "Not measured" in `--ink-4`, matching the rule that a missing value never renders as a passing one. Covered by `hub.spec.tsx`.

## Supplier team and access (plan §5)

| Screen label | Constant | 2FA | Facility scope |
|---|---|---|---|
| Owner | `VENDOR_OWNER` | mandatory | all |
| Operations Manager | `VENDOR_ADMIN` | — | all (◐ on price / some PO actions when assigned) |
| Finance | `VENDOR_FINANCE` | mandatory | all |
| Warehouse | `VENDOR_VIEWER` | — | assigned facilities only |

| Item | Status | Notes |
|------|--------|-------|
| `identity.team.manage` permission | DONE | `VENDOR_OWNER` only; invite + member PATCH enforced in service for vendors. |
| Invite API + 72h token hash | DONE | `POST/DELETE /api/account/team/invites`, resend, accept sets session cookies. |
| `/vendor/team` screen | DONE | Members table, pending invites, capability matrix, invite/manage dialog. |
| `/team/accept` set-password | DONE | Archetype F, strength meter, auto sign-in. |
| Facility scope on PO repo | DONE | `fulfillment_facility_id` + `identity.user_facility`; integration test. |
| Screenshots `5-vendor-team-*` | TODO | 1900 / 1440 / 600 px. |

## Progressive supplier profile (plan §4)

| Item | Status | Notes |
|------|--------|-------|
| `SectionDialog` modal engine | DONE | `packages/ui` — 620px, segment strip, focus trap, escape/scrim close. |
| `/vendor/profile` card hub | DONE | `ProfileHub.tsx` — six sections, auto-advance ~700ms after save. |
| Business & GST dialog | DONE | Constitution tiles + GSTIN verify; state/PAN derived. |
| Pickup address dialog | DONE | Pincode-first lookup; city/state read-only. |
| Bank account dialog | DONE | IFSC lookup + penny-drop; `GET /api/onboarding/ifsc/:ifsc`. |
| Documents dialog | DONE | Three uploads via `Uploader`; **ObjectStorePort remains fixture-backed** — uploads lost on container restart; do not ship to production without real object storage. |
| Supplier agreement dialog | DONE | Recorded acceptance (name, version, timestamp) — no e-sign provider. |
| What you stock dialog | DONE | Optional; badged Recommended; excluded from %. |
| BankVerificationPort | FIXTURE | Penny-drop uses fake adapter — ledger records must not reach production as-is. |
| Screenshots `4-vendor-profile-*` | TODO | 1900 / 1440 / 600 px. |

## One-minute supplier signup (plan §3)

| Item | Status | Notes |
|------|--------|-------|
| `/sell/register` four-step flow | DONE | `SupplierSignup.tsx` on console; old seven-step components kept for Stage 9 cleanup. |
| Enumeration-safe register OTP | DONE | Same response shape for known/unknown; duplicate named at `POST /auth/register`. |
| Org bootstrap | DONE | `POST /auth/register` + `POST /api/onboarding/start` — no new KYC endpoint. |
| Listing lock until VERIFIED | DONE | UI on dashboard + `createDraft` server gate. |
| Screenshots `3-sell-register-*` | DONE | 1900 / 1440 / 600 px. |

## Dashboard fields used / omitted (Stage 2.4)

| Wanted | Source | Status |
|--------|--------|--------|
| liveListings | — | Omitted. API has `unitsLive`, not a listing count. |
| openVisits | — | Omitted. Not on `GET /api/vendor/dashboard`. |
| openCorrections | `queues.gradeCorrections.count` | Shown in rail when > 0. |
| unacknowledgedPos | — | Omitted. Not on dashboard payload. |
| awaitingDispatch | — | Omitted. |
| netDue | `payoutsDue` | Rail shows ₹Lakhs when present. |
| memberCount | — | Omitted. |

## Role mapping (Stage 8)

| Label on screen | Constant |
|-----------------|----------|
| Owner | `VENDOR_OWNER` |
| Operations | `VENDOR_ADMIN` and `VENDOR_OPS` |
| Finance | `VENDOR_FINANCE` |
| Warehouse | `VENDOR_VIEWER` |

## CI baseline (Stage 1, 2026-09-14)

| Check | Scope | Status |
|-------|-------|--------|
| `pnpm typecheck` | `packages/ui` | PASS |
| `pnpm lint` | `packages/ui`, `packages/config` | PASS |
| `pnpm test` | `packages/ui` | PASS — 343 tests incl. `hub-scope.spec.ts`, hub contrast block |

## Stage 7 copy budget

| Scope | Words (visible JSX) |
|-------|---------------------|
| Before (board shells) | ~612 |
| After (Dashboard, Listings, Payouts, Facilities, Documents, create dialog) | under 400 |

Visits/Corrections record routes still carry detail copy — board headers restyled; full trim is Stage 9.

## Screenshots

Target path: `docs/review/supplier-hub/<stage>-<route>.png` at **1900**, **1440**, and **600** px.
None captured yet under Supplier Hub naming. Prior MANIFEST pass did not save review screenshots.

## Open questions

1. **Grade correction auto-apply** — `GradeCorrectionService.autoApplyDue()` has no scheduler. Stage 7 copy states automatic apply is not live; wiring the job is separate work with its own tests.
2. ~~**PO reject / dispatch writers**~~ — Resolved in Stage 6: `POST …/respond`, `POST …/dispatch`; legacy `acknowledge` wraps respond-all.
3. ~~**Team invites**~~ — Resolved in plan §5: invite link + set-password at `/team/accept`; no credential emailed.
4. **Facility dispatch address** — vendor facility payload is `label / city / pincode` only. Dispatch column shows "—" in `--fail` until address field exists.
5. ~~**Accent**~~ — Resolved in Stage 10: hub `--acc` is teal `#0F7C8A` on the vendor surface only. Storefront keeps `#6BB1BE`, which the hub carries as `--brand-tint` for the wordmark.
6. **Payout history** — `procurement.payout_run` never written. Screen is zeros + empty state.
7. ~~**Mono font on manifest surface**~~ — Resolved in Stage 10: MANIFEST is gone. The hub uses IBM Plex Mono, and Newsreader, Public Sans and JetBrains Mono were dropped from the console font link.
8. **Hub `--warn`** — prototype `#a86609` is 4.31:1 on `--warn-wash`. Token uses `#a56008` to clear 4.5:1 per WCAG arithmetic. The repaint plan restated `#a86609`; the arithmetic is in `tokens.spec.ts` and still disagrees, so the corrected value stands.
9. **Partial PO rejection leaves buyer short** — When a vendor accepts some lines and rejects others, the buyer's order is short on the rejected SKUs. Either re-source from another supply point or notify the buyer — a commercial decision and admin screen, not built here. Stage 6 emits `po.partially_rejected` for admin consumption later.

### Carried over from the deleted VENDOR_MANIFEST plan

10. **120-character JSX text lint rule** — the old plan's Stage 3.3 proposed an ESLint rule capping visible JSX text in `routes/vendor/**`. Never written. The Stage 7 copy budget is enforced by review, not by CI.
11. **Storybook audit under the vendor surface** — the old plan's Stage 3.1 asked for a walk of every story with `data-surface` set. Not done for `hub`; `Archetypes.stories.tsx` and `DesignSystem.stories.tsx` have not been checked against the hub tokens.
12. **Console has no injectable clock** — Stage 10 added `apps/console/src/lib/clock.ts` as the single sanctioned `Date.now()` call site, mirroring the API's `ClockPort`. It is a module boundary, not a DI port: tests stub the module. Two pre-existing lint errors (`Documents.tsx`, `Payouts.tsx`) were cleared by routing through it.

## Safety checklist

- [x] No existing vendor path renamed (`apps/console/src/routes/vendor/index.ts` paths/order/permissions preserved).
- [x] `Shell.tsx` — filter predicate only (`entry.surface !== 'VENDOR'`).
- [x] Admin routes never mount `VendorSurfaceSync`.
- [ ] Full definition-of-done gate: lint, test, screenshots, every state verified per stage.
