# Vendor MANIFEST ledger

Status: DOING — stages 1–8 landed in one pass on the live vendor surface.
Admin console is unchanged except the Shell filter predicate (`surface !== 'VENDOR'`).

| Stage | What | Status | Commit | Screenshots | Notes |
|-------|------|--------|--------|-------------|-------|
| 0 | Context / ledger | DONE | — | — | This file. |
| 1 | Token scope, fonts, contrast | DONE | — | — | `data-surface=manifest` is opt-in. Absent, nothing changes. |
| 2 | VendorShell + grouped nav | DONE | — | — | Existing paths kept. New: team, facilities, documents, dispatch, payouts. |
| 3 | Ledger primitives + scoped CSS | DONE | — | — | ClauseHeading, LedgerRow, RegisterStrip, InfoPopover, PermissionGrid. |
| 4 | Today, Listings, Units | DONE | — | — | Today rebuilt. Listings header restyled. Units inherit tokens. |
| 5 | Inspect | DONE | — | — | Corrections header restyled. Auto-apply job still unwired (see below). |
| 6 | Fulfil + reject/dispatch API | PARTIAL | — | — | Dispatch board reads existing POs. Reject/dispatch writers not added. |
| 7 | Money | DONE | — | — | Payables header restyled. Payouts is an honest empty state. |
| 8 | Team & access | PARTIAL | — | — | Members from `GET /api/account/team`. Invite send not wired (no invite API). |
| 9 | Close-out | TODO | — | — | Screenshots and word-count pass still due. |

## Dashboard fields used / omitted (Stage 2.4, Stage 4)

| Wanted | Source | Status |
|--------|--------|--------|
| liveListings | — | Omitted. API has `unitsLive`, not a listing count. |
| openVisits | — | Omitted. Not on `GET /api/vendor/dashboard`. |
| openCorrections | `queues.gradeCorrections.count` | Shown in the rail when > 0. |
| unacknowledgedPos | — | Omitted. Not on the dashboard payload. |
| awaitingDispatch | — | Omitted. |
| netDue | `payoutsDue` | Rail shows ₹Lakhs when present. |
| memberCount | — | Omitted. |

Today strip uses only real fields: units on sale, awaiting inspection, corrections, due to you.

## Role mapping (Stage 8)

| Label on screen | Constant |
|-----------------|----------|
| Owner | `VENDOR_OWNER` |
| Operations | `VENDOR_ADMIN` and `VENDOR_OPS` |
| Finance | `VENDOR_FINANCE` |
| Warehouse | `VENDOR_VIEWER` |

## Open questions

1. **Grade correction auto-apply** — `GradeCorrectionService.autoApplyDue()` has no scheduler. Copy no longer promises an automatic apply that does not run.
2. **PO reject / dispatch writers** — schema columns exist; no vendor POST was added in this pass so production cannot 500 on a new route.
3. **Team invites** — `POST /api/account/team/members` requires a password. Invite UI is present and refuses to send rather than invent a credential.
4. **Facility dispatch address** — vendor facility payload is `label / city / pincode` only. Dispatch column renders "—" in `--fail` because e-way bills need that field.
5. **Accent** — MANIFEST `--acc` is viridian `#1D5C4A`. Dark ink is used for emphasis on paper (primary buttons stay token `--acc`).
6. **Payout history** — `procurement.payout_run` has never been written. Screen is zeros + empty state.

## Safety

- No existing vendor path was renamed.
- `Shell.tsx` change is the filter predicate only.
- API was not modified.
- Admin routes never mount `VendorSurfaceSync`.
