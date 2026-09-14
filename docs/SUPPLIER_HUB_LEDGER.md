# Supplier Hub ledger

**Scope:** `apps/console` vendor surface only. Admin console appearance unchanged.
**Design language:** MANIFEST (`data-surface="manifest"`) — paper ground, hairline rules, square corners.
**Prior work:** Landed in commit `f15a886` (`seller_pannel`) under the VENDOR MANIFEST plan. This ledger tracks the Supplier Hub close-out from that baseline.

| Stage | What | Status | Commit | Screens verified | Notes |
|-------|------|--------|--------|------------------|-------|
| 0 | Context / ledger | DONE | — | — | This file. Stage 0 rules re-read each session. |
| 1 | Hub token scope, type scale, contrast | DONE | 8b7a443 | 1-admin-* | `data-surface=hub` in `globals.css`, `hub-scope.spec.ts`, hub block in `tokens.spec.ts`. Safety: absent attribute → no change. |
| 2 | VendorShell + grouped nav | DONE | f15a886 | — | `VendorShell.tsx`, `useVendorCounts.ts`, `vendor-surface.tsx`, nav regrouped (Today/Sell/Inspect/Fulfil/Money/Account). `Shell.tsx` filter: `surface !== 'VENDOR'` only. |
| 3 | Ledger primitives + scoped CSS | DONE | f15a886 | — | `ClauseHeading`, `LedgerRow`, `RegisterStrip`, `InfoPopover`, `PermissionGrid`. MANIFEST table/button overrides in `globals.css`. |
| 4 | Today, Listings, Units | DONE | f15a886 | — | Dashboard rebuilt. Listings/units restyled. |
| 5 | Inspect | DONE | f15a886 | — | Visits + corrections restyled. Auto-apply job still unwired (see Open questions). |
| 6 | Fulfil + reject/dispatch API | PARTIAL | f15a886 | — | Dispatch board reads existing POs. `POST …/reject` and `POST …/dispatch` not added. |
| 7 | Money | DONE | f15a886 | — | Payables restyled. Payouts honest empty state. |
| 8 | Team & access | DONE | — | — | Superseded by plan §5 below; invite flow + facility scope landed in this stage. |
| 9 | Close-out | TODO | — | — | Screenshots, word-count pass, `SUPPLIER_HUB_REVIEW.md`, CI green. |

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

## Screenshots

Target path: `docs/review/supplier-hub/<stage>-<route>.png` at **1900**, **1440**, and **600** px.
None captured yet under Supplier Hub naming. Prior MANIFEST pass did not save review screenshots.

## Open questions

1. **Grade correction auto-apply** — `GradeCorrectionService.autoApplyDue()` has no scheduler. Copy must not promise automatic apply.
2. **PO reject / dispatch writers** — schema columns exist; no vendor POST endpoints yet.
3. ~~**Team invites**~~ — Resolved in plan §5: invite link + set-password at `/team/accept`; no credential emailed.
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
