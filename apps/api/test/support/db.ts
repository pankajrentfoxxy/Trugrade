import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Integration-test database.
 *
 * These tests exist to prove things **only a real database enforces** — partial
 * unique indexes, EXCLUDE constraints, CHECK violations, trigger behaviour,
 * transaction atomicity. An in-memory fake would pass all of them and prove
 * nothing, so there is no in-memory option here by design.
 *
 * Deviation from PHASE_00 Task 8, stated plainly: the phase asks for
 * Testcontainers. We run against the real Postgres 16 the compose stack already
 * provides (`trugrade_test`), which is the same engine with the same constraints
 * and starts in zero seconds instead of forty. Set `USE_TESTCONTAINERS=1` to get
 * a throwaway container instead; CI uses a service container. The property that
 * matters — a real Postgres — holds either way.
 */
const TEST_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://trugrade:trugrade_dev@localhost:5442/trugrade_test?schema=public';

let client: PrismaClient | undefined;
let migrated = false;

export function testDatabaseUrl(): string {
  return TEST_URL;
}

/**
 * Apply every migration to the test database, once per run.
 *
 * `migrate deploy` on an empty database is itself the assertion behind the
 * `migrate:check` CI job: migrations must run clean on an empty database, every
 * time, or the whole suite fails here rather than mysteriously later.
 */
export function migrateTestDatabase(): void {
  if (migrated) return;
  // `prisma migrate deploy` costs ~30 s of CLI start-up even when there is
  // nothing to do, which is most runs. Shell out only when the database is
  // actually behind the migrations folder.
  if (isUpToDate()) {
    migrated = true;
    return;
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: process.env.VERBOSE_MIGRATIONS ? 'inherit' : 'pipe',
    shell: process.platform === 'win32',
  });
  migrated = true;
}

function isUpToDate(): boolean {
  try {
    const dirs = readdirSync(join(__dirname, '..', '..', 'prisma', 'migrations'), {
      withFileTypes: true,
    }).filter((d) => d.isDirectory()).length;

    const out = execFileSync(
      'docker',
      [
        'exec',
        'trugrade-postgres',
        'psql',
        '-U',
        'trugrade',
        '-d',
        'trugrade_test',
        '-tAc',
        'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim();

    return Number(out) === dirs && dirs > 0;
  } catch {
    return false;
  }
}

export function testDb(): PrismaClient {
  client ??= new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  return client;
}

let seeded = false;

/**
 * Reference data, from the same functions the CLI seed uses.
 *
 * Two copies of this was a real bug: the test database kept the fifteen legacy
 * roles while the code expected twenty-four, and every test that assigned a role
 * failed in a way that looked like a bug in the code rather than in the fixture.
 */
export async function seedTestReference(db: PrismaClient = testDb()): Promise<void> {
  if (seeded) return;
  const { seedReference } = await import('../../prisma/seed/reference');
  await seedReference(db);
  seeded = true;
}

export async function closeTestDb(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

/**
 * Empty every business table between tests, leaving the schema and the seeded
 * reference data that the migrations themselves inserted.
 *
 * TRUNCATE ... CASCADE rather than per-table deletes: it is one statement, it
 * resets identity sequences, and it cannot be defeated by an FK ordering mistake.
 *
 * **The exclusion list below is not sufficient on its own, and that is the whole
 * reason `restoreReference` exists.** CASCADE also truncates every table holding
 * a foreign key *into* one being truncated, and both `platform.platform_config`
 * (`changed_by`) and `procurement.margin_rule` (`approved_by`) point at
 * `identity.user_account`. So the two tables the list most carefully protects
 * were being emptied anyway — silently, because nothing read them until now.
 */
let truncateStatement: string | undefined;

export async function truncateAll(db: PrismaClient = testDb()): Promise<void> {
  if (truncateStatement) {
    await db.$executeRawUnsafe(truncateStatement);
    await restoreReference(db);
    return;
  }
  const rows = await db.$queryRaw<Array<{ full_name: string }>>`
    SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS full_name
    FROM pg_tables
    WHERE schemaname IN ('identity','customer','vendor','kyc','catalog','listing',
                         'ordering','qc','logistics','payment','platform','procurement')
      -- partition children are truncated via their parent
      AND tablename !~ '_[0-9]{4}_[0-9]{2}$'
      -- keep the seeded reference rows the migrations wrote
      -- Reference data. Some of it is seeded by the seed script, some by the
      -- migrations themselves — and truncating the latter is unrecoverable
      -- without re-migrating, which is how a suite starts failing on "0 steps".
      AND tablename NOT IN ('platform_config','qc_tolerance_rule','qc_sampling_rule',
                            'routing_rule','carrier','commission_rule','role','permission',
                            'role_permission','qc_tool_provider',
                            'onboarding_step_definition','onboarding_field_requirement',
                            'document_type_rule','partitioned_table',
                            -- Phase 2. hsn_code is not optional in this list:
                            -- catalog.sku defaults hsn_code to '84713010' and
                            -- has an FK to the master, so truncating it breaks
                            -- every SKU factory on the next insert.
                            'hsn_code','gst_rate','grade_definition',
                            -- Phase 3. margin_rule is ops-tunable reference data,
                            -- and listing.unit.margin_rule_id points at it. Without
                            -- a rule the pricing resolver has no price to return,
                            -- so every pricing test would fail on an empty table.
                            'margin_rule')
  `;
  if (!rows.length) return;
  truncateStatement = `TRUNCATE TABLE ${rows.map((r) => r.full_name).join(', ')} RESTART IDENTITY CASCADE`;
  await db.$executeRawUnsafe(truncateStatement);
  await restoreReference(db);
}

/**
 * Put back the two reference tables CASCADE took with it.
 *
 * Guarded by a count so the common case is two cheap queries rather than a
 * re-seed: only the run that actually emptied them pays for refilling them.
 */
async function restoreReference(db: PrismaClient): Promise<void> {
  // Two statements, not one with a pair of scalar subqueries: `no-cross-schema-join`
  // reads that as a cross-module read, and it is right to — the rule does not get
  // an exemption because this file happens to be a fixture.
  const [config] = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM platform.platform_config`;
  const [margin] = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM procurement.margin_rule`;
  if (Number(config?.n ?? 0) > 0 && Number(margin?.n ?? 0) > 0) return;

  if (Number(config?.n ?? 0) === 0) {
    const { seedConfig } = await import('../../prisma/seed/reference');
    await seedConfig(db);
  }
  if (Number(margin?.n ?? 0) === 0) {
    const { seedMarginRules } = await import('../../prisma/seed/margin-rules');
    await seedMarginRules(db);
  }
}
