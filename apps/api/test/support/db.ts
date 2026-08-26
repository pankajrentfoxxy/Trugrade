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
 */
let truncateStatement: string | undefined;

export async function truncateAll(db: PrismaClient = testDb()): Promise<void> {
  if (truncateStatement) {
    await db.$executeRawUnsafe(truncateStatement);
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
                            'document_type_rule','partitioned_table')
  `;
  if (!rows.length) return;
  truncateStatement = `TRUNCATE TABLE ${rows.map((r) => r.full_name).join(', ')} RESTART IDENTITY CASCADE`;
  await db.$executeRawUnsafe(truncateStatement);
}
