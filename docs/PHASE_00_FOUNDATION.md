# PHASE 0 — Foundation, schema hardening, design system

**Paste everything between the `═══` markers into Claude Code as a single prompt.**
**Prerequisite:** `_CONTEXT.md`, `02_ARCHITECTURE.md`, `03_UX_SPEC.md` and `04_TEST_PLAN.md` are in the repo root under `docs/`.
**Estimated size:** 1 senior engineer, 5–7 days.

---

═══════════════════════════════════════════════════════════════════

You are building **gorefurbo**, a B2B platform for refurbished laptops in India, operating as a **merchant of record** (we buy from vendors and sell on our own invoice — we are *not* a marketplace facilitator).

**Before writing any code, read these files completely and treat them as binding:**
- `docs/_CONTEXT.md` — the business model, stack, module map, and the vendor-anonymity rule
- `docs/02_ARCHITECTURE.md` — the technical contract
- `docs/03_UX_SPEC.md` — Part 1 (design system) and Part 2 (component inventory) only, for this phase
- `docs/04_TEST_PLAN.md` — Part 1 (strategy) and Part 2 (validation catalogue)

Also read the existing SQL in `docs/legacy/`: `truetech_complete_schema.sql` (109 tables, 11 schemas) and `truetech_schema_migration_v3_qc_at_source.sql` (17 tables). **You are adopting this schema, not replacing it.**

## Your objective for Phase 0

Produce a repository where `docker compose up` gives a working stack, migrations run clean on an empty database, the design system renders, CI enforces the module boundaries, and **all ten known schema defects listed in `02_ARCHITECTURE.md` §2.4 are closed**. No business feature ships in this phase. Every later phase depends on getting this right.

## Task 1 — Monorepo skeleton

Create a Turborepo with pnpm workspaces:

```
gorefurbo/
├── apps/api/                 NestJS 10, TypeScript strict
├── apps/storefront/          Next.js 15 App Router
├── apps/console/             Next.js 15 App Router
├── packages/ui/              shadcn/ui + the gorefurbo design system
├── packages/contracts/       zod schemas, shared DTO types
├── packages/config/          eslint-config, tsconfig, tailwind-preset
├── packages/qc-report-schema/ the QC tool report contract (zod + JSON Schema)
├── infra/docker/             docker-compose.yml
├── infra/github/             workflow definitions
└── docs/
```

`apps/technician` and `apps/rider` (Expo) are scaffolded in Phase 4 — do not create them now.

Root `package.json` scripts: `dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`, `db:migrate`, `db:seed`, `db:reset`.

## Task 2 — Local stack

`infra/docker/docker-compose.yml` bringing up:
- `postgres:16` with `pgcrypto` and `btree_gist` extensions enabled (the latter is required for the `EXCLUDE USING gist` constraints)
- `redis:7`
- `minio` (S3-compatible) with a pre-created `gorefurbo-dev` bucket
- `mailpit` for outbound email in dev

A single `pnpm dev` must bring up the compose stack, run migrations, seed, and start all apps. If a developer needs a README paragraph to get running, you have failed this task.

## Task 3 — NestJS module skeleton with enforced seams

Create twelve empty modules under `apps/api/src/modules/`: `identity`, `kyc`, `customer`, `vendor`, `catalog`, `listing`, `qc`, `ordering`, `procurement`, `payment`, `logistics`, `platform`.

Each module gets this exact shape:

```
modules/<name>/
├── <name>.module.ts
├── <name>.service.ts          implements I<Name>Service — the PUBLIC interface
├── <name>.controller.ts
├── dto/                       request DTOs (zod) and response DTOs (explicit allow-lists)
├── entities/                  Prisma-derived types, module-internal
├── events/                    the events this module publishes
└── internal/                  repositories — NEVER imported across modules
```

**Then write the ESLint rule that makes this real.** A custom rule `no-cross-module-import` in `packages/config`:
- A file under `modules/A/**` may import from `modules/B/` **only** the public barrel `modules/B/index.ts`, which re-exports `IBService` and the module's event types and nothing else.
- Any import reaching `modules/B/internal/**`, `modules/B/entities/**`, or `modules/B/dto/**` from outside module B is an **error**, not a warning.
- Any raw SQL string containing a cross-schema join (a `FROM`/`JOIN` naming two different schema prefixes) is an error, with an explicit `// eslint-disable-next-line no-cross-module-import -- <written justification>` escape hatch that CI reports on.

Write at least six unit tests for this rule, covering both allowed and forbidden shapes. **A boundary rule without tests is a comment.**

## Task 4 — The typed in-process event bus

Implement `shared/events/`:

```ts
// The event catalogue is a discriminated union, exhaustively typed.
export type DomainEvent =
  | { name: 'order.confirmed';       payload: OrderConfirmedPayload }
  | { name: 'po.raised';             payload: PoRaisedPayload }
  | { name: 'qc.report.completed';   payload: QcReportCompletedPayload }
  | { name: 'vendor.verified';       payload: VendorVerifiedPayload }
  | { name: 'payment.captured';      payload: PaymentCapturedPayload }
  | { name: 'shipment.delivered';    payload: ShipmentDeliveredPayload }
  // …extended per phase
```

Requirements:
- Publishing inside a database transaction **must not** dispatch until the transaction commits. Implement a transactional outbox: events are written to an `platform.event_outbox` table inside the same transaction, and a dispatcher drains it after commit. Getting this wrong means a subscriber acts on an order that was rolled back.
- Handlers run through BullMQ, not synchronously, except where a phase explicitly says otherwise.
- The OpenTelemetry trace ID propagates through the payload so a cross-module flow is one trace.
- A handler that throws retries with exponential backoff, then lands in a dead-letter queue with an ops alert. It must never silently vanish.

## Task 5 — Adopt and harden the schema

Set up Prisma with `previewFeatures = ["multiSchema"]` and all twelve schemas declared.

Import the existing SQL as the **baseline migration**, then write a hardening migration that closes every defect in `02_ARCHITECTURE.md` §2.4. Specifically:

**5.1 — Partitions. This is the highest-severity item; do it first.**
The existing partitions expire **2026-10-01** (`ordering.order_event`, `logistics.shipment_tracking`, `platform.notification_log`, `platform.integration_log`) and **2026-11-01** (`identity.audit_log`). There is no DEFAULT partition and no creation job. Inserts will begin failing.
- Add a BullMQ cron job that creates monthly partitions **three months ahead**, running nightly and idempotently.
- Add a health check that reports the runway in days per partitioned table and **alerts below 30 days**.
- Write a test that drops the future partitions, runs the job, and asserts they are recreated. Write a second test that asserts the health check reports a shortfall when a partition is missing (`DATA-05`, `DATA-06` in the test plan).
- Do **not** add DEFAULT partitions — a DEFAULT partition silently accepts rows that then block future partition creation.

**5.2 — Triggers.** The existing schema has none. Add:
- A generic `set_updated_at()` trigger on every table carrying an `updated_at` column.
- `listing.recompute_is_sellable()` — recomputes `unit.is_sellable` from status + `qc_passed_at` + `qc_valid_until` + seal status on any relevant update.
- `qc.enforce_single_current_report()` — flips the prior report's `is_current` to FALSE and sets `superseded_by_id` when a new current report is inserted.
- `listing.lock_valuation_method()` — exactly as written in `02_ARCHITECTURE.md` §2.3. This is a tax control, not a data-hygiene nicety.
- Counter-maintenance triggers for `qc.qc_visit` unit counters and `listing.listing.qty_*`.

**5.3 — Fix `listing.v_sellability_drift`.** The current view uses a `LEFT JOIN` to `qc.qc_seal`; when a unit has no seal, `s.status` is NULL, the comparison yields NULL, and the row is filtered out — so a unit marked sellable **with no seal at all** never appears in the drift report. That is precisely the anti-swap failure the model exists to prevent. Wrap the seal condition in `COALESCE(s.status IN ('APPLIED','INTACT'), FALSE)` and write a test that inserts a seal-less sellable unit and asserts the view returns it (`LST-051`, `DATA-03`).

**5.4 — `UNIQUE (key, effective_from)` on `platform.platform_config`**, plus a `platform.v_current_config` view returning the latest effective row per key.

**5.5 — CHECK constraints on nine free-text status columns:** `logistics.delivery_task.status`, `payment.eway_bill.status`, `payment.refund.status`, `payment.payout.status`, `platform.return_request.status`, `platform.ticket.status`, `platform.warranty_claim.status`, `platform.dispute.status`, `platform.data_subject_request.status`. Note that `ix_ewb_expiry` currently filters on `status = 'ACTIVE'`, a value nothing ever writes — fix the enum and the index together.

**5.6 — Deprecate the hub-QC path.** Two QC models coexist and nothing marks which is canonical. **Vendor-site QC is canonical.** Add a comment on `qc.qc_batch` marking it deprecated, add a CHECK preventing new rows, and keep the existing data for history.

**5.7 — Roles and secrets.** The existing SQL creates `tt_app` and `tt_readonly` with the password `CHANGE_ME_IN_PRODUCTION`. Remove role creation from SQL entirely; provision roles through Terraform with credentials in AWS Secrets Manager. Keep and extend the `REVOKE UPDATE, DELETE` grants listed in `02_ARCHITECTURE.md` §2.5, including the new `procurement.tds_ledger`.

**5.8 — The new `procurement` schema.** Create it now, empty of tables. Phase 7 fills it. Creating the schema now means the Prisma `multiSchema` config and the boundary lint rule are complete from the start.

**5.9 — Nightly drift jobs.** Wire `payment.v_ledger_imbalance`, `listing.v_stock_drift`, `listing.v_sellability_drift`, `kyc.v_expiring_documents`, `qc.v_expiring_qc` into scheduled jobs. **Each must return zero rows; a non-zero result raises a P1 alert with the offending row IDs.**

## Task 6 — Auth primitives

- JWT access token, 15-minute TTL, RS256.
- Rotating refresh token in an httpOnly, Secure, SameSite=Lax cookie. Session record in Redis so revocation is real. Reuse of a rotated refresh token invalidates the entire session family — that is the token-theft signal.
- `@Roles()` decorator + `RolesGuard`, with the sixteen roles in `02_ARCHITECTURE.md` §6.
- **`OrgScopeInterceptor`** — every vendor- and customer-scoped repository query is filtered by the caller's `org_id` **at the repository layer**. A missing `where` clause in a service must not be able to leak another org's rows. Write the failing test first.
- TOTP MFA scaffold, enforced in Phase 1 for admin roles and the vendor-owner role.
- Rate limiting via Redis: per IP, per user, per org, with tighter buckets on OTP and verification endpoints.

## Task 7 — The design system

Implement `packages/ui` from `docs/03_UX_SPEC.md` Part 1 and Part 2.

**Non-negotiables:**
- The token set is the "New_plan" palette in `_CONTEXT.md`. **Discard the `home_1.html` dark tokens and the teal/Archivo blueprint tokens entirely** — three incompatible palettes currently exist in the prototypes and only one survives.
- Add the missing spacing scale (2·4·8·12·16·20·24·32·40·48·64·80). It does not exist anywhere in the prototypes; every value is currently hard-coded inline.
- **Orange is reserved for the primary action.** Nothing else uses it.
- The UX spec flags accessibility defects in the prototypes that must not be reproduced: white-on-orange CTA text (2.09:1) and cyan text and focus rings (2.64:1 — the focus indicator itself fails). Use the corrected navy-on-orange primary and the `-ink` colour family the spec defines.
- Build the components listed in UX spec Part 2 with every state: default, hover, focus, active, disabled, loading, error, empty.
- Set up Storybook, and write a story per component per state.
- Wire `axe-core` into the Storybook test runner. **A component with an axe violation fails CI.**

## Task 8 — Testing and CI

- Jest + `ts-jest` for unit tests.
- Supertest + **Testcontainers** for integration tests against a real Postgres. Not an in-memory fake — you are testing constraints that only a real database enforces.
- Playwright for E2E, configured but with only a smoke test for now.
- k6 scaffolding in `infra/k6/`.
- **Test data factories** for every entity, and the persona seed set from test plan §1.4.
- **Every external integration gets an adapter interface with a `Fake` implementation, selected by config, from this phase.** GSTIN, PAN, penny-drop, SMS, WhatsApp, Razorpay, Delhivery, Blue Dart, DTDC, Shiprocket, Porter, e-invoice, e-way bill. Write the interfaces and the fakes now, even though no real implementation exists. This is what stops a third party's onboarding delay from blocking the build.

GitHub Actions workflow:
1. `lint` — includes the `no-cross-module-import` rule
2. `typecheck`
3. `test:unit` — coverage gate per `04_TEST_PLAN.md` §1.2
4. `test:integration` — Testcontainers
5. `test:storybook` — axe
6. `migrate:check` — migrations must run clean on an **empty** database, every time
7. `build`

Merge to `main` deploys to staging. A tag deploys to production.

## Task 9 — Observability

Sentry (API + both web apps), OpenTelemetry traces with the trace ID flowing through the event bus, structured JSON logging with a request ID, and a `/health` endpoint reporting: database, Redis, S3, partition runway in days, and the last successful run of each nightly drift job.

## Exit criteria — all must be objectively true

- [ ] `pnpm dev` on a clean machine brings the full stack up and seeds it, with no manual steps
- [ ] `pnpm db:reset && pnpm db:migrate` runs clean on an empty database
- [ ] All twelve module folders exist, each with a public barrel and an `I<Name>Service`
- [ ] The `no-cross-module-import` ESLint rule exists, has ≥6 passing tests, and **fails the build** on a violation — prove it with a deliberately broken branch
- [ ] Partition-creation job runs, is idempotent, and `/health` reports ≥90 days of runway on every partitioned table
- [ ] A test proves a missing partition is detected (`DATA-05`, `DATA-06`)
- [ ] `listing.v_sellability_drift` returns a seal-less sellable unit (`LST-051`) — the pre-fix version does not
- [ ] All five nightly drift views run as jobs and return zero rows on seeded data
- [ ] `listing.lock_valuation_method()` raises on an attempt to change `valuation_method` after `purchase_price` is set
- [ ] No SQL file anywhere contains `CHANGE_ME_IN_PRODUCTION`
- [ ] Storybook builds, every component has stories for every state, and axe reports zero violations
- [ ] A refresh-token reuse test proves the whole session family is invalidated
- [ ] An `OrgScopeInterceptor` test proves org A cannot read org B's rows even when the service omits a `where` clause
- [ ] CI runs all seven jobs and is green

## Do not do in this phase

Do not build any business feature. Do not create the Expo apps. Do not write the `procurement` tables. Do not integrate any real third party. If you find yourself writing a controller that returns business data, stop — you are in Phase 1.

═══════════════════════════════════════════════════════════════════
