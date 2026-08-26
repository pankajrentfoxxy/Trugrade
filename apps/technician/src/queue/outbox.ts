import type { Clock, IdSource } from '../clock';
import type { Db } from '../db/db';

/**
 * The offline outbox: enqueue, read the head, mark the outcome, count.
 *
 * Pure TypeScript over the `Db` port. No React, no `expo-*`, no `fetch` — the
 * sending lives in `sync.ts` and the transport is injected, so everything below
 * is exercised by `test/outbox.spec.ts` against real SQLite.
 */

/**
 * One kind per row the server writes. `ABSENT` is its own action because a unit
 * the vendor could not produce is a finding the vendor signs off on, not an
 * omission — `qc_visit.units_absent` is a column for a reason.
 */
export const OUTBOX_KINDS = [
  'CHECK_IN',
  'TOOL_RUN',
  'PHOTO',
  'SEAL',
  'UNIT_RESULT',
  'ABSENT',
  'SIGNOFF',
  'EXPENSE',
] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export type OutboxStatus = 'PENDING' | 'SENT' | 'BLOCKED';

export interface OutboxItem {
  readonly id: number;
  readonly kind: OutboxKind;
  /** Minted once at enqueue. Every retry sends this same value. */
  readonly nonce: string;
  readonly dedupeKey: string;
  readonly visitId: string | null;
  readonly unitId: string | null;
  readonly body: Record<string, unknown>;
  /** `PHOTO` only: the local file, uploaded to a signed URL before the POST. */
  readonly fileUri: string | null;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly nextAttemptAt: number;
  readonly createdAt: number;
}

interface Row {
  id: number;
  kind: string;
  nonce: string;
  dedupe_key: string;
  visit_id: string | null;
  unit_id: string | null;
  body: string;
  file_uri: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: number;
  created_at: number;
}

const hydrate = (r: Row): OutboxItem => ({
  id: r.id,
  kind: r.kind as OutboxKind,
  nonce: r.nonce,
  dedupeKey: r.dedupe_key,
  visitId: r.visit_id,
  unitId: r.unit_id,
  body: JSON.parse(r.body) as Record<string, unknown>,
  fileUri: r.file_uri,
  status: r.status as OutboxStatus,
  attempts: r.attempts,
  lastError: r.last_error,
  nextAttemptAt: r.next_attempt_at,
  createdAt: r.created_at,
});

export interface EnqueueInput {
  kind: OutboxKind;
  /**
   * Stable and derived from the action, never from the moment — `SEAL:<unitId>`,
   * not `SEAL:<timestamp>`. It is what makes a double tap on Confirm one row.
   */
  dedupeKey: string;
  body: Record<string, unknown>;
  visitId?: string | null;
  unitId?: string | null;
  fileUri?: string | null;
}

export interface Deps {
  db: Db;
  now: Clock;
  newNonce: IdSource;
}

/**
 * Record an action. Returns the row — the existing one if this action was
 * already recorded, so a caller that re-enqueues gets the original nonce back
 * rather than silently creating a second inspection of the same machine.
 */
export async function enqueue(
  { db, now, newNonce }: Deps,
  input: EnqueueInput,
): Promise<OutboxItem> {
  await db.run(
    `INSERT INTO outbox (kind, nonce, dedupe_key, visit_id, unit_id, body, file_uri, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      input.kind,
      newNonce(),
      input.dedupeKey,
      input.visitId ?? null,
      input.unitId ?? null,
      JSON.stringify(input.body),
      input.fileUri ?? null,
      now(),
    ],
  );
  const rows = await db.all<Row>('SELECT * FROM outbox WHERE dedupe_key = ?', [input.dedupeKey]);
  const row = rows[0];
  if (!row) throw new Error(`outbox row vanished for ${input.dedupeKey}`);
  return hydrate(row);
}

/**
 * The head of the queue, or null.
 *
 * Strictly the lowest-id `PENDING` row, and **null when that row is still in
 * backoff** rather than the next one along. That is head-of-line blocking, and
 * it is deliberate: photographs are enqueued before the unit result that names
 * their object keys, and a queue that reorders around a stalled item delivers
 * the result first and the evidence afterwards.
 *
 * `BLOCKED` rows are skipped, which is the escape valve — a permanently refused
 * action needs a human, and the rest of the day's work must not sit behind it.
 */
export async function head(db: Db, nowMs: number): Promise<OutboxItem | null> {
  const rows = await db.all<Row>(
    "SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY id LIMIT 1",
  );
  const row = rows[0];
  if (!row) return null;
  return row.next_attempt_at <= nowMs ? hydrate(row) : null;
}

export async function markSent({ db, now }: Pick<Deps, 'db' | 'now'>, id: number): Promise<void> {
  await db.run("UPDATE outbox SET status = 'SENT', sent_at = ?, last_error = NULL WHERE id = ?", [
    now(),
    id,
  ]);
}

/**
 * Exponential backoff, capped. No jitter: there is one device draining one
 * queue, so there is no herd to spread, and a deterministic schedule is one the
 * technician-support line can reason about ("it will try again in four minutes").
 */
export const BACKOFF_BASE_MS = 15_000;
export const BACKOFF_CAP_MS = 10 * 60_000;

export function backoffFor(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
}

/** The connection dropped, or the server is unwell. Retry the same nonce later. */
export async function markRetry(
  { db, now }: Pick<Deps, 'db' | 'now'>,
  id: number,
  error: string,
): Promise<void> {
  const rows = await db.all<{ attempts: number }>('SELECT attempts FROM outbox WHERE id = ?', [id]);
  const attempts = (rows[0]?.attempts ?? 0) + 1;
  await db.run('UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?', [
    attempts,
    error,
    now() + backoffFor(attempts),
    id,
  ]);
}

/**
 * The server refused this action and will refuse it again — a seal code from the
 * wrong roll, a unit that is not on this visit, a payload the DTO rejects.
 * Retrying is not a fix, so the row parks as BLOCKED, stays on the device as
 * evidence, and the queue moves on. It surfaces on the sync screen with the
 * server's own message, because the technician is standing next to the machine
 * and is the only person who can do anything about it.
 */
export async function markBlocked({ db }: Pick<Deps, 'db'>, id: number, error: string): Promise<void> {
  const rows = await db.all<{ attempts: number }>('SELECT attempts FROM outbox WHERE id = ?', [id]);
  await db.run("UPDATE outbox SET status = 'BLOCKED', attempts = ?, last_error = ? WHERE id = ?", [
    (rows[0]?.attempts ?? 0) + 1,
    error,
    id,
  ]);
}

/** Put a blocked row back in the queue, once the technician has fixed the cause. */
export async function retryBlocked(db: Db, id?: number): Promise<void> {
  const where = id === undefined ? '' : ' AND id = ?';
  await db.run(
    `UPDATE outbox SET status = 'PENDING', next_attempt_at = 0, last_error = NULL WHERE status = 'BLOCKED'${where}`,
    id === undefined ? [] : [id],
  );
}

export interface OutboxCounts {
  pending: number;
  blocked: number;
  sent: number;
  /** What the badge shows: work that has not reached the server. */
  outstanding: number;
  /** Photographs specifically — most of the bytes, and the slow part. */
  pendingPhotos: number;
  oldestPendingAt: number | null;
}

/**
 * What the always-visible badge reads.
 *
 * `oldestPendingAt` is here because a count on its own hides the failure that
 * matters: three items pending is fine at 11:04 and is a lost day at 17:30.
 */
export async function counts(db: Db): Promise<OutboxCounts> {
  const rows = await db.all<{ status: string; kind: string; n: number; oldest: number | null }>(
    'SELECT status, kind, COUNT(*) AS n, MIN(created_at) AS oldest FROM outbox GROUP BY status, kind',
  );
  const total = (s: string) =>
    rows.filter((r) => r.status === s).reduce((acc, r) => acc + Number(r.n), 0);

  const pending = total('PENDING');
  const blocked = total('BLOCKED');
  const oldest = rows
    .filter((r) => r.status !== 'SENT')
    .map((r) => r.oldest)
    .filter((v): v is number => v !== null);

  return {
    pending,
    blocked,
    sent: total('SENT'),
    outstanding: pending + blocked,
    pendingPhotos: rows
      .filter((r) => r.status === 'PENDING' && r.kind === 'PHOTO')
      .reduce((acc, r) => acc + Number(r.n), 0),
    oldestPendingAt: oldest.length ? Math.min(...oldest) : null,
  };
}

/** Everything still on the device, newest first. The sync screen's list. */
export async function outstanding(db: Db, limit = 200): Promise<OutboxItem[]> {
  const rows = await db.all<Row>(
    "SELECT * FROM outbox WHERE status <> 'SENT' ORDER BY id DESC LIMIT ?",
    [limit],
  );
  return rows.map(hydrate);
}

/**
 * Which units of a visit have been submitted, and how that submission is going.
 *
 * Keyed by `visit_unit_id` out of the body rather than by `unit_id`, because the
 * manifest screen lists visit units and a unit can appear on two visits over its
 * life. Only the two terminal actions count — a queued photograph is not a
 * finished inspection, and showing one as done is how a unit gets skipped.
 */
export async function submittedUnits(
  db: Db,
  visitId: string,
): Promise<Map<string, { status: OutboxStatus; kind: OutboxKind; lastError: string | null }>> {
  const rows = await db.all<Row>(
    "SELECT * FROM outbox WHERE visit_id = ? AND kind IN ('UNIT_RESULT','ABSENT') ORDER BY id",
    [visitId],
  );
  const out = new Map<string, { status: OutboxStatus; kind: OutboxKind; lastError: string | null }>();
  for (const r of rows) {
    const key = String((JSON.parse(r.body) as { visitUnitId?: string }).visitUnitId ?? '');
    if (key) out.set(key, { status: r.status as OutboxStatus, kind: r.kind as OutboxKind, lastError: r.last_error });
  }
  return out;
}

/**
 * Drop delivered rows older than the retention window.
 *
 * Kept for a week rather than deleted on send: "did that unit actually go up?"
 * is the first question a technician asks the next morning, and a table that
 * only remembers failures cannot answer it.
 */
export async function pruneSent(db: Db, nowMs: number, keepMs = 7 * 86_400_000): Promise<void> {
  await db.run("DELETE FROM outbox WHERE status = 'SENT' AND sent_at < ?", [nowMs - keepMs]);
}
