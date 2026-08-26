# Trugrade

B2B platform for refurbished laptops in India. **TrueTech Services Pvt. Ltd.**

```bash
pnpm install
pnpm dev
```

That is the whole setup. `pnpm dev` starts Postgres, Redis, MinIO and Mailpit,
waits for them, migrates, seeds and starts every app. API on `:4000`, Mailpit on
`:8026`, MinIO console on `:9011`.

---

## The one fact everything else follows from

**The platform is the principal and the merchant of record, operating
back-to-back. It is not a marketplace facilitator, and it never holds stock.**

Both halves matter and they are easy to confuse:

- **We never buy inventory.** Nothing is purchased until a customer has committed
  to buy it. No warehouse, no capital tied up in laptops.
- **We are still the seller.** At the instant a customer orders, we buy that
  specific serial from the vendor and sell it to the customer on our own invoice.
  The goods go vendor → customer directly and never touch us.

This is not a legal footnote; it is the architecture. It makes vendor anonymity
lawful (CP e-Comm Rule 5 binds marketplaces, not inventory entities), removes GST
TCS u/s 52, escrow and the RBI payment-aggregator question — and in exchange makes
take-back (r.7(4)) and authenticity (r.7(5)) **ours and non-delegable**, and adds
a whole procurement domain.

If someone proposes a change that only makes sense for a marketplace — a split
settlement, a seller-name field on a listing, routing a defect claim to the vendor
— that is the signal it has drifted.

## Layout

```
apps/
  api/            NestJS. One deployable, twelve modules, twelve Postgres schemas.
packages/
  config/         BRAND token, the module-boundary ESLint rules, Tailwind preset
  contracts/      The VR-001..VR-160 validation catalogue, Money, events, RBAC
  ui/             The "Anodised" design system
infra/docker/     Postgres 16, Redis 7, MinIO, Mailpit
docs/             The build pack, verbatim, plus DECISIONS_OPEN.md
```

### Four rules make `apps/api` an architecture rather than folders

1. Each module owns its Postgres schema. No cross-schema `JOIN`.
2. A module reaches another **only** through its public barrel (`modules/x`).
3. Cross-module communication is the typed event bus, using the names a real
   queue would use later.
4. Every module exposes an `I<Name>Service` — the future network contract.

Rules 1 and 2 are enforced by `@trugrade/no-cross-module-import` and
`@trugrade/no-cross-schema-join` at **error** level in CI. A boundary you can
merge past is not a boundary. Try it:

```bash
echo "import { X } from '../../listing/internal/unit.repository';" \
  > apps/api/src/modules/ordering/internal/oops.ts
pnpm --filter @trugrade/api lint    # fails, and tells you to use the barrel
```

## Things worth knowing before you change something

**The database enforces the invariants that matter.** `is_sellable` is recomputed
by a trigger, not written by a caller. `valuation_method` becomes immutable the
moment `purchase_price` is set, because flipping it would retrospectively destroy
the GST position on a unit already invoiced. A serial can be live in exactly one
place nationwide — a partial unique index, so a returned unit's serial can be
re-listed. Read `20260826000200_hardening/migration.sql`; it is commented.

**Money is `bigint` paise and never a float.** `packages/contracts/src/money.ts`.
A `number` in the money path is a defect, not a style preference.

**The clock is injected.** `Date.now()` is an ESLint error. Ninety-day QC expiry,
the two-day grade auto-apply, the 36-hour NDR window and token TTLs all have to be
testable without sleeping.

**Publishing an event writes a row; it does not dispatch.** The outbox drains
after commit, so a rolled-back order raises no purchase order.

**A missing value is never a passing value.** The `ToleranceBand` renders no dot
when nothing was measured, and `Evidence` shows no headline percentage below the
sample threshold. Both are liability controls under CP e-Comm r.7(2) and r.7(5)
wearing UI costumes.

**Every external integration has a `Fake` and runs on it by default.**
`INTEGRATION_MODE=live` outside production is refused at boot. The carrier fakes
encode the quirks — Delhivery's five rejected characters and case-sensitive
warehouse name, Blue Dart's undocumented JWT TTL, Porter's 1 req/min tracking —
because the quirks are what break a first integration.

## Commands

|                                                |                                          |
| ---------------------------------------------- | ---------------------------------------- |
| `pnpm dev`                                     | Everything, from nothing                 |
| `pnpm test:unit`                               | Fast, no I/O                             |
| `pnpm --filter @trugrade/api test:integration` | Real Postgres, real constraints          |
| `pnpm --filter @trugrade/ui storybook`         | The design system                        |
| `pnpm lint` / `pnpm typecheck`                 | Includes the boundary rules              |
| `pnpm --filter @trugrade/api db:introspect`    | After changing SQL: re-pull + regenerate |

**The SQL is the source of truth, not `schema.prisma`.** The schema language
cannot express partial unique indexes, `EXCLUDE` constraints, partitions or
triggers, so migrations are plain SQL and Prisma introspects them. Never hand-edit
the generated models.

## Where the decisions are written down

- `docs/_CONTEXT.md` — the binding business context
- `docs/DECISIONS_OPEN.md` — **every assumption this build took, and where to
  change it.** Also the eight items blocked on counsel or a CA.
- `docs/02_ARCHITECTURE.md` — the technical contract
- `docs/04_TEST_PLAN.md` — the 160 validation rules and 477 test cases

## Two operational facts

**The partition runway was going to expire on 2026-10-01.** The adopted schema had
no creation job, so inserts would simply have started failing. `/health` now
reports the runway in days per table and pages below 30. Watch it.

**Working capital is the number that constrains growth.** As principal we owe
vendors on delivery-plus-window while buyers on credit pay us later. That gap
grows linearly with volume and no amount of software fixes it.
