import { DatabaseSync } from 'node:sqlite';
import { migrate, type Db, type SqlValue } from '../src/db/db';

/**
 * The `Db` port on `node:sqlite`.
 *
 * This is not a mock. It is real SQLite running the same schema and the same SQL
 * the device runs, which is what makes the tests below worth anything: the
 * `UNIQUE (dedupe_key)` conflict, the `ORDER BY id` head-of-line rule and the
 * `status IN (…)` CHECK are all enforced by the engine, not by a fixture that
 * agrees with the code because the same person wrote both.
 *
 * `node:sqlite` is in Node 22 and the workspace requires >= 22, so this costs no
 * dependency and no native build.
 */
export async function testDb(): Promise<Db> {
  const native = new DatabaseSync(':memory:');
  const db: Db = {
    async exec(sql) {
      native.exec(sql);
    },
    async run(sql, params = []) {
      native.prepare(sql).run(...(params as never[]));
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return native.prepare(sql).all(...(params as never[])) as T[];
    },
  };
  await migrate(db);
  return db;
}

/** A clock the test drives by hand, so backoff is provable without waiting. */
export function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  const clock = () => t;
  return {
    clock,
    advance(ms: number) {
      t += ms;
    },
    set(ms: number) {
      t = ms;
    },
  };
}

/** Deterministic nonces, so a test can assert that a retry sent the same one. */
export function seqNonce(prefix = 'n') {
  let i = 0;
  return () => `${prefix}${++i}`;
}
