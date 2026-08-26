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
import { join } from 'node:path';

const file = join(__dirname, '..', '..', '.env.test');
if (existsSync(file)) {
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
if (process.env.DATABASE_URL_TEST && process.env.DATABASE_URL !== process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
