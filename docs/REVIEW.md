# Reviewing Trugrade locally

Everything below was verified against a running stack, not copied from a seed file.
Where a screen is deliberately empty or a value deliberately absent, it says so and why —
those are findings, not gaps in the review.

## Start it

```bash
pnpm dev
```

Brings up Postgres, Redis, MinIO and Mailpit, applies migrations, then starts all three apps.

| What | Where |
|---|---|
| Storefront (buyer) | http://localhost:3000 |
| Console (vendor + staff) | http://localhost:5173 |
| API | http://localhost:4000 |
| Mailpit | http://localhost:8026 — **runs, but receives nothing.** See OTP below. |

The console is Vite and binds **IPv6 localhost only**: `http://localhost:5173` answers,
`http://127.0.0.1:5173` does not. That is not an outage.

If `pnpm dev` reports *"Could not start the local stack. Is Docker running?"* while every
container says Healthy, a stale process is holding a port. Kill by port — `pkill -f
"dist/main.js"` does not match on Windows:

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }
```

## Signing in

**Password for every account below: `Trugrade!Demo2026`**

### No second factor — use these to review quickly

| Account | Role | Reaches |
|---|---|---|
| `owner@acme.example` | CUSTOMER_OWNER | The whole buyer side |
| `buyer@acme.example` | CUSTOMER_BUYER | The procurer's narrower view |
| `approver@acme.example` | CUSTOMER_APPROVER | The approval inbox |
| `ops@northgate.example` | VENDOR_OPS | Vendor portal except payables |
| `finance@faridabad.example` | VENDOR_FINANCE | Payables, incl. the MSME 45-day clock |
| `finance@mayapuri.example` | VENDOR_FINANCE | Payables with a row past our own terms |
| `qc@trugrade.in` | QC_MANAGER | QC console |
| `catalog@trugrade.in` | CATALOG_ADMIN | Catalog, condition images |
| `kyc@trugrade.in` | KYC_REVIEWER | Onboarding review |
| `support@trugrade.in` | SUPPORT | Order board (no PO access — deliberately) |
| `pricing@trugrade.in` | PRICING_ADMIN | Margin rules |
| `ops@trugrade.in` | OPS_MANAGER | Ops dashboard |

### Second factor required

`PLATFORM_SUPERADMIN`, `OPS_MANAGER`, `FINANCE`, `DPO` and **`VENDOR_OWNER`** — so
`admin@trugrade.in`, `finance@trugrade.in`, `owner@northgate.example`, `anil@kestrel.example`.

Password first, then a SECOND FACTOR screen. The code auto-submits on the sixth digit.

### Getting the code

Mailpit stays empty — dev uses a fake notifier, not SMTP. The code arrives two ways:

1. **DevTools → Network → `mfa/otp` or `login/otp` → Response → `devCode`**
2. **Your `pnpm dev` terminal**: `[FakeNotification] [EMAIL] AUTH_LOGIN_OTP -> … {"code":"870909"}`

Passwordless OTP login is **silently refused for MFA roles** — the response looks fine and
carries no code, because handing out a code for an address that cannot use it would confirm
the address exists. Codes last 5 minutes; there is a 1-minute rate limit and a ~4-minute
resend cooldown, so repeated Sign in presses produce "Too many attempts", not progress.

## A walkthrough that exercises the interesting decisions

Concrete identifiers, all live in the seeded database.

**Buyer** — `owner@acme.example`

1. `/` then `/search` — real stock, real photographs. Grades A+/A/B are neutral by rule.
2. `/laptops/<sku>` — condition images served through encrypted object tokens, never a
   presigned URL. Some grades show "not photographed yet"; that is honest, not broken.
3. `/account` — four KPI tiles and one queue. Deliberately not the eleven the spec lists:
   the rest have no source, and a zero would read as "nothing is wrong".
4. `/account/orders` → `TT-26-00003` → `/units` — per-serial QC. One machine has **no
   battery reading** and renders "Not measured", never a tick.
5. `/account/orders/TT-26-00003/documents` — a real tax invoice, `TT/2026-27/00001`. Rows for
   documents that do not exist yet say *when* they will.
6. `/account/orders/TT-26-00003/delivery` — the buyer's own seal check. **APPLIED is not
   INTACT**: this screen is what turns one into the other.
7. `/account/warranty`, `/account/returns` — cover starts at delivery; an undelivered machine
   reads "Cover starts on delivery", never an expiry.
8. `/legal/grading` — the Rule 7(5) document. Its floors are read from `catalog.grade_definition`,
   not typed.

**Vendor** — `ops@northgate.example`, then `finance@faridabad.example`

9. `/vendor` — four tiles, not the spec's seven. Three have no source and say so.
10. `/vendor/listings/new` — the wizard, with the buyer-facing condition images beside the
    grade being declared.
11. `/vendor/corrections` — disputing is the same two clicks as accepting.
12. `/vendor/orders` → a PO → pick list. The buyer's order number is **deliberately absent**.
13. `/vendor/payables` as `finance@faridabad.example` — the MSME clock. **No payout has ever
    been run**, and the screen refuses to invent a date to plan against.

**Staff** — `ops@trugrade.in`, `qc@trugrade.in`, `pricing@trugrade.in`

14. `/overview` — six metrics from rows; four tiles named under "Not on this screen, and why".
15. `/kyc` → an applicant. `PROVIDER_ERROR` is excluded from the verdict **and** from the
    applicant's attempt count — a portal timeout is ours.
16. `/pricing/rules` — every rule is achieving 16.3% against targets of 20/18/15/13, because
    the seeded listings never went through the pricing engine.
17. `/platform/config` — 74 keys, **40 read by no file**. Provenance too: 11 keys written by
    both writers, 17 by a migration only, 45 by the seed only.
18. `/finance` — the three-way match reports **UNMEASURABLE, not UNMET**. We did not look;
    we did not fail.

## Known defects, stated rather than hidden

- **`TT-26-00007` and `TT-26-00009` are `DELIVERED` with a pending approval and no purchase
  order.** Two seeds chose the same orders for opposite purposes. Both code paths are guarded
  now — delivery refuses an order with a pending approval, and the seed skips them by state —
  but these rows predate the guard and need a direct repair. Until then the approval inbox is
  empty and those two orders show delivered machines with no record of what we paid.
- **`RequirePermission` renders its refusal outside the shell**, so a denied route is a bare
  page with no navigation back. Affects every guarded console route.
- **The audit-log, config, flags and template screens are read-only.** No editor exists.
- **Ten legal values are unfilled** and render as visibly empty dashed fields — the grievance
  officer's name and telephone, registered street address, CIN, customer-care number,
  jurisdiction, refund timing, delivery times, retention schedule, DPDP registration.
- **No vendor has a verified bank account or PAN**, so §4.8's payout gate fails for every
  supplier. TDS correctly records 0% — nobody has crossed ₹50 lakh.
