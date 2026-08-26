/**
 * The three SQLite calls this app needs, and the schema behind them.
 *
 * Deliberately a port rather than a direct `expo-sqlite` import. Not for
 * swappability — there is exactly one production driver and there will only ever
 * be one — but so that the queue, which is the only code here whose failure
 * costs a technician a day's work, can be tested against real SQLite in CI
 * instead of only in a simulator. `test/node-db.ts` is the same SQL on
 * `node:sqlite`; `src/db/expo-db.ts` is the same SQL on the device.
 *
 * Nothing in this file may import from `expo-*`. That is the whole point of it.
 */

export type SqlValue = string | number | null;

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/**
 * The outbox is the app.
 *
 * Every action a technician takes becomes a row here first and reaches the
 * server second, including the photographs — a warehouse has no signal, so a
 * design where the network call is the primary write and the local copy is the
 * fallback has the dependency the wrong way round.
 *
 * Two uniqueness rules carry the offline guarantee:
 *
 *   `nonce`      is minted **once**, when the action is recorded, and every
 *                retry sends the same one. That is what `qc_tool_run.nonce
 *                UNIQUE` and `UNIQUE (tool_provider_id, tool_run_id)` are for:
 *                a replay is one row and a 200. Minting a fresh nonce per
 *                attempt would defeat the entire mechanism and turn a flaky
 *                connection into duplicate inspections.
 *
 *   `dedupe_key` stops the *local* duplicate — a double tap on "Confirm" on a
 *                laggy screen, or a screen remounting after the OS reclaims
 *                memory. `INSERT OR IGNORE` on it means enqueue is idempotent
 *                too, not just delivery.
 *
 * `id` is the send order. It is an INTEGER PRIMARY KEY AUTOINCREMENT rather than
 * a timestamp because the ordering has to survive a clock that jumps, and
 * because photographs must reach the server before the unit result that cites
 * their keys. FIFO gives that dependency ordering for free; a dependency graph
 * would be a second way to express the same thing and a second thing to get
 * wrong.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT    NOT NULL,
  nonce           TEXT    NOT NULL UNIQUE,
  dedupe_key      TEXT    NOT NULL UNIQUE,
  visit_id        TEXT,
  unit_id         TEXT,
  body            TEXT    NOT NULL,
  file_uri        TEXT,
  status          TEXT    NOT NULL DEFAULT 'PENDING',
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  sent_at         INTEGER,
  CHECK (status IN ('PENDING','SENT','BLOCKED'))
);

CREATE INDEX IF NOT EXISTS ix_outbox_queue ON outbox (status, id);

-- Everything the technician needs on site, fetched at check-in while there is
-- still signal: the manifest, its serials, the tolerance rules in force today,
-- the grade thresholds and the auto-approval policy. Held as one JSON blob per
-- visit because it is read-only reference data for at most ~40 units — a
-- relational shape here would be schema to maintain for no query it enables.
CREATE TABLE IF NOT EXISTS snapshot (
  visit_id   TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  payload    TEXT NOT NULL
);

-- A part-finished inspection. A technician puts the phone down mid-unit, the OS
-- reclaims the app, and the four photographs already taken must still be there.
CREATE TABLE IF NOT EXISTS unit_draft (
  visit_unit_id TEXT PRIMARY KEY,
  visit_id      TEXT NOT NULL,
  payload       TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Small non-secret device state: the bound device id, the visit in progress.
-- Tokens do NOT live here; they are in expo-secure-store, see src/session.ts.
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA);
}

// --- kv -------------------------------------------------------------------

export async function kvGet(db: Db, key: string): Promise<string | null> {
  const rows = await db.all<{ v: string }>('SELECT v FROM kv WHERE k = ?', [key]);
  return rows[0]?.v ?? null;
}

export async function kvSet(db: Db, key: string, value: string): Promise<void> {
  await db.run('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', [
    key,
    value,
  ]);
}
