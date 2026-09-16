/**
 * Loads .env.test before any module reads process.env.
 *
 * Kept separate from the app's own env loading so a stray DATABASE_URL in a
 * developer's shell cannot point an integration run at the dev database.
 *
 * WHY THIS DOES NOT OVERWRITE
 * ---------------------------
 * It used to assign unconditionally, which made `.env.test` the last word on
 * every variable. That looked like the safe choice and was the opposite: since
 * `.env.test` hard-codes DATABASE_URL_TEST at `trugrade_test`, it was
 * IMPOSSIBLE to point a run at a private database, so every concurrent run —
 * two agents, two sessions, a developer and CI — silently landed on the same
 * one. `truncateAll` uses TRUNCATE ... CASCADE, which takes AccessExclusiveLock
 * on every cascaded table, and a second run reading those tables holds
 * RowShareLock. The result is a deadlock storm that reads as 147 unrelated test
 * failures across 19 suites and sends you hunting for 19 bugs that do not exist.
 *
 * So an explicitly exported variable now wins, which is ordinary dotenv
 * semantics: a file supplies defaults, the environment overrides them. Setting
 * DATABASE_URL_TEST on purpose is a deliberate act, not a stray shell variable.
 *
 * The danger the old behaviour was actually guarding against — running the
 * destructive suite against the DEV database — is now guarded directly, below,
 * by refusing rather than by silently overwriting. A refusal names the problem;
 * an overwrite hides both the mistake and the intent.
 */
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `.env.test` first, then the repo root `.env` — both as defaults.
 *
 * The root file is read here for one reason, and it is a bug this harness had
 * until Stage 7 found it: when `apps/api/.env.test` does not exist (it is
 * git-ignored, so on a fresh checkout it never does) DATABASE_URL_TEST was
 * undefined at this point, the override at the bottom of this file did not
 * fire, and the app's own `loadEnv` then defaulted DATABASE_URL from the root
 * `.env` — to the DEV database. The fixtures kept talking to `trugrade_test`
 * while every request through Nest talked to `trugrade`. That does not fail
 * loudly; it fails as "column does not exist" on a migration that is plainly
 * applied, or worse, as a test that passes against data it did not write.
 *
 * The root `.env` already declares DATABASE_URL_TEST. Reading it here is what
 * makes the two halves of a run agree on one database.
 */
for (const file of [
  join(__dirname, '..', '..', '.env.test'),
  join(__dirname, '..', '..', '..', '..', '.env'),
]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    // Defaults, not overrides. An exported value is an intentional one.
    process.env[key] ??= trimmed.slice(eq + 1);
  }
}

/**
 * The one thing `.env.test` was really protecting: this suite truncates every
 * table it can reach, so pointing it at a database holding real work destroys
 * it. Names rather than URLs, because credentials and query strings differ
 * while the database is the same.
 */
const databaseOf = (url: string | undefined): string =>
  url?.split('?')[0]?.split('/').pop() ?? '';

const testDb = databaseOf(process.env.DATABASE_URL_TEST);
if (testDb && !/^trugrade_(test|verify)/.test(testDb)) {
  throw new Error(
    `Refusing to run the integration suite against "${testDb}". It truncates every table ` +
      `it can reach. The target database name must start with trugrade_test or ` +
      `trugrade_verify — set DATABASE_URL_TEST to a private one to run concurrently with ` +
      `another suite, e.g. .../trugrade_test_myfeature.`,
  );
}

// The app's own PrismaService reads DATABASE_URL, not DATABASE_URL_TEST. If a
// test boots a Nest module while these disagree, half the run talks to one
// database and half to another, and the failures make no sense in either.
// The suites drive OTP flows by reading `devCode` off the response. It is an
// explicit switch now (never implied by NODE_ENV), so the harness turns it on.
process.env.OTP_DEV_CODE_IN_RESPONSE ??= 'true';
// PII columns have no fallback key any more; the suites need one of their own.
process.env.PII_ENCRYPTION_KEY ??= 'integration-suite-only-pii-key';

if (process.env.DATABASE_URL_TEST && process.env.DATABASE_URL !== process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

// The object store is durable now — `FakeObjectStore` writes to disk so the
// seed and the API, two processes, can see the same bytes. That makes it shared
// state in exactly the way the test database is, and for exactly the same
// reason: a suite that asserts an object is ABSENT would otherwise be answered
// by whatever an earlier run left behind, including the developer's own seed.
// Keyed on the database name so a private database gets a private bucket.
process.env.OBJECT_STORE_DIR ??= join(
  tmpdir(),
  `trugrade-object-store-${testDb || 'test'}`,
);
