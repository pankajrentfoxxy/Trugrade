# Pre-public-launch checklist

**Nothing in this file is actioned.** Every item below is deliberate on
`refurbo_V-1.0.1.2`, which is an internal-testing branch. This document records
what must change before the platform is open to the public, what its state is
*today*, and what has to be true before each box can be ticked.

Verified against the working tree and the live `.env` on 2026-09-16. Where a
claim below is about production, it was read from the deployed environment
rather than inferred from the code.

---

## 1. `devCode` — OTP codes in API responses

**State: ON in production.** `OTP_DEV_CODE_IN_RESPONSE=true` in `/var/www/Trugrade/.env`,
with `NODE_ENV=production`.

**This is the single most dangerous item on the list.** While it is on, the OTP
for any account is returned in the body of the request that triggers it. Anyone
who knows an email address can request a code, read it from the response and
take over that account — customer, vendor, or platform staff. It is on because
the owner asked for it while testing in-house.

It is already gated behind an explicit environment flag and deliberately *not*
derived from `NODE_ENV` (`otp.service.ts:63`), and `main.ts:52` logs a warning
naming the risk on every boot. 25 references across 7 files read it; none of them
decide on their own whether to emit.

**Before launch**
- [ ] Remove `OTP_DEV_CODE_IN_RESPONSE` from the production environment.
- [ ] Add a test asserting the production config cannot emit a `devCode` — the
      flag is the control, so the test has to be about the config and not about
      one call site.
- [ ] Rotate any account that was used for testing while it was on. A code that
      was readable is a code that may have been read.

## 2. `trust proxy` — unset

**State: unset.** No occurrence in `apps/api/src/main.ts`.

Express therefore reads the socket address as the client address. Behind a load
balancer that is the balancer's IP, so every per-IP rate limit — login attempts,
OTP requests, registration — keys on one value shared by every user. The limits
still fire; they fire on the wrong subject, which means one noisy client can lock
out everybody, and a real attacker is never isolated.

Correct today, because nothing is in front of the API yet: with no proxy, trusting
one would let a caller forge `X-Forwarded-For` and evade the limits entirely.

**Before launch**
- [ ] Set `app.set('trust proxy', <hop count>)` to the real number of hops once
      the load balancer is in place. A number, never `true` — `true` trusts the
      whole chain, which is the forgery case above.
- [ ] Verify with a request through the balancer that the rate limiter sees the
      client address.

## 3. `DEV_SQL_CONSOLE_OPT_IN` — fails closed

**State: safe, twice over.** `dev-sql.module.ts:19` requires both
`DEV_SQL_CONSOLE === 'i-understand-this-runs-arbitrary-sql'` **and**
`NODE_ENV !== 'production'`. Production sets `NODE_ENV=production`, and
`DEV_SQL_CONSOLE` is absent from the live `.env`.

Either condition alone would close it. This endpoint was part of a live
compromise once (see the 2026-09-14 remediation), which is why it now has two
independent locks rather than one.

**Before launch**
- [ ] Confirm `DEV_SQL_CONSOLE` is absent from the production environment. It is
      today; this is a re-check, not a change.

## 4. Grievance officer — not appointed

**State: placeholder.** `packages/config/src/brand.ts:69` reads
`name: 'To be appointed before launch'`.

Consumer Protection (E-Commerce) Rules r.4(4)–(5) require a **named person
resident in India**, contactable, who acknowledges a complaint within 48 hours
and redresses it within one month. A placeholder on a live storefront is a
compliance failure on day one, and the name has to be a real person who knows
they hold the role.

**Before launch**
- [ ] Appoint the officer and put their name, designation, email and phone in
      `brand.ts`.
- [ ] Confirm the 48-hour acknowledgement path actually exists operationally —
      the rule is about response times, not about a page.

## 5. `LEGAL_DISCLOSURE.cin` — null

**State: null, and correctly so.** `brand.ts:41` is `cin: null`.

The PDF letterhead renders this as "Not yet published" rather than an empty line
or a fabricated number (`apps/api/src/shared/pdf/sheet.ts`). A CIN on an invoice
that does not match the MCA record is worse than an absent one.

**Before launch**
- [ ] Fill it once the MCA record is live. No code change — the letterhead reads
      the value.

## 6. Carrier credentials — fakes reachable

**State: fakes are the default and are reachable in production today.**
`adapters.module.ts` builds the registry from the in-process fakes and then
overrides a carrier **only** when its credentials are present:
BlueDart needs `BLUEDART_BASE_URL` + `BLUEDART_LOGIN_ID` + `BLUEDART_LICENCE_KEY`;
Porter needs `PORTER_BASE_URL` + `PORTER_API_KEY`. None of these is set in the
live `.env`, so **every carrier call in production today is a simulation.**

That fallback is deliberate — a half-configured environment falls back to a fake
rather than to an adapter that throws on every call — but it means a shipment can
be "booked" with an AWB no carrier has ever heard of. In-house is exempt: it has
no remote system, and its "provider" is our own rider app.

**Before launch**
- [ ] Set the real credentials for every carrier that will actually be used.
- [ ] Assert at boot that no fake carrier is registered when `NODE_ENV=production`,
      or accept the fallback knowingly and make the console say which carriers
      are simulated. **Stage 8's carrier board already shows this per carrier
      ("Live" / "Simulated")** — that column is the interim control.

## 7. Webhook signature secrets

**State: unset, and the endpoints refuse everything as a result.**
`BLUEDART_WEBHOOK_SECRET` and `PORTER_WEBHOOK_SECRET` are absent from the live
`.env`. `webhook.controller.ts:111` treats an unset secret as "this carrier's
callbacks are not live yet" and returns 401 — accepting unsigned calls "until we
get the secret" is how an open delivery endpoint ships, so refusing is right.

The consequence to understand: **no carrier webhook can mark anything delivered
in production today.** The manual override on the shipment record (Stage 8) is
the only path, and it is audited and requires a reason.

**Before launch**
- [ ] Obtain and set both secrets, stored outside the repository.
- [ ] Rotate them on a schedule, and after any contractor offboarding.
- [ ] Re-verify with a signed test callback per carrier.

---

## Two items this checklist adds

Neither is in the original list; both were found while building Stages 1–10 and
both block selling outside the NCR.

### 8. The platform prices exactly one lane

`prisma/seed/logistics-ncr.ts` seeds serviceability and rate cards for **NCR → NCR,
in-house only**, and deliberately writes no BlueDart rows — "a Blue Dart lane
here would quote a buyer a carrier we hold no account with."

The end-to-end walk found the consequence: a vendor warehouse in Pune makes
checkout refuse the order outright — *"We can't deliver this item to 122015 yet."*
The code handles the lane; the reference data does not exist.

- [ ] Seed serviceability and rate cards for every lane that will be sold,
      before a vendor outside the NCR is onboarded.

### 9. MFA is required for seats that have not enrolled

`MFA_REQUIRED_ROLES` includes `PLATFORM_SUPERADMIN`, `OPS_MANAGER`, `CONTROLLER`,
`TREASURY`, `CA`, `FINANCE`, `DPO`, `VENDOR_OWNER` and `VENDOR_FINANCE`. On the
live database none of the three platform staff accounts has `mfa_enabled = true`.

`AuthGuard` refuses a privileged call when a required role has not satisfied MFA.
Either those seats are being refused, or the path differs from that reading —
**this was flagged and is still unresolved**, and it should be settled before
more seats are issued rather than after.

- [ ] Enrol MFA for every account holding a role on `MFA_REQUIRED_ROLES`.
- [ ] Confirm the guard behaves as read, and write a test that pins it.
