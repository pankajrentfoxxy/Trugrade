# Supplier Hub ledger

**Scope:** `apps/console` vendor surface only. Admin console appearance unchanged.
**Design language:** MANIFEST (`data-surface="manifest"`) — paper ground, hairline rules, square corners.
**Prior work:** Landed in commit `f15a886` (`seller_pannel`) under the VENDOR MANIFEST plan. This ledger tracks the Supplier Hub close-out from that baseline.

| Stage | What | Status | Commit | Screens verified | Notes |
|-------|------|--------|--------|------------------|-------|
| 0 | Context / ledger | DONE | — | — | This file. Stage 0 rules re-read each session. |
| 1 | Hub token scope, type scale, contrast | DONE | pending | 1-admin-* | `data-surface=hub` in `globals.css`, `hub-scope.spec.ts`, hub block in `tokens.spec.ts`. Safety: absent attribute → no change. |
| 2 | VendorShell + grouped nav | DONE | f15a886 | — | `VendorShell.tsx`, `useVendorCounts.ts`, `vendor-surface.tsx`, nav regrouped (Today/Sell/Inspect/Fulfil/Money/Account). `Shell.tsx` filter: `surface !== 'VENDOR'` only. |
| 3 | Ledger primitives + scoped CSS | DONE | f15a886 | — | `ClauseHeading`, `LedgerRow`, `RegisterStrip`, `InfoPopover`, `PermissionGrid`. MANIFEST table/button overrides in `globals.css`. |
| 4 | Today, Listings, Units | DONE | f15a886 | — | Dashboard rebuilt. Listings/units restyled. |
| 5 | Inspect | DONE | f15a886 | — | Visits + corrections restyled. Auto-apply job still unwired (see Open questions). |
| 6 | Fulfil + reject/dispatch API | PARTIAL | f15a886 | — | Dispatch board reads existing POs. `POST …/reject` and `POST …/dispatch` not added. |
| 7 | Money | DONE | f15a886 | — | Payables restyled. Payouts honest empty state. |
| 8 | Team & access | PARTIAL | f15a886 | — | Members from `GET /api/account/team`. Invite send not wired (no invite API). |
| 9 | Close-out | TODO | — | — | Screenshots, word-count pass, `SUPPLIER_HUB_REVIEW.md`, CI green. |

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

## Screenshots

Target path: `docs/review/supplier-hub/<stage>-<route>.png` at **1900**, **1440**, and **600** px.
None captured yet under Supplier Hub naming. Prior MANIFEST pass did not save review screenshots.

## Open questions

1. **Grade correction auto-apply** — `GradeCorrectionService.autoApplyDue()` has no scheduler. Copy must not promise automatic apply.
2. **PO reject / dispatch writers** — schema columns exist; no vendor POST endpoints yet.
3. **Team invites** — `POST /api/account/team/members` requires a password. Invite UI refuses to send rather than invent a credential.
4. **Facility dispatch address** — vendor facility payload is `label / city / pincode` only. Dispatch column shows "—" in `--fail` until address field exists.
5. **Accent** — MANIFEST `--acc` is viridian `#1D5C4A` on vendor surface only. Storefront keeps `#6BB1BE`.
6. **Payout history** — `procurement.payout_run` never written. Screen is zeros + empty state.
7. **Mono font on manifest surface** — `--font-mono` is JetBrains Mono under `data-surface=manifest`; hub uses IBM Plex Mono. MANIFEST may be retired when hub shell lands.
8. **Hub `--warn`** — prototype `#a86609` is 4.31:1 on `--warn-wash`. Token uses `#a56008` to clear 4.5:1 per WCAG arithmetic.

## Safety checklist

- [x] No existing vendor path renamed (`apps/console/src/routes/vendor/index.ts` paths/order/permissions preserved).
- [x] `Shell.tsx` — filter predicate only (`entry.surface !== 'VENDOR'`).
- [x] Admin routes never mount `VendorSurfaceSync`.
- [ ] Full definition-of-done gate: lint, test, screenshots, every state verified per stage.
