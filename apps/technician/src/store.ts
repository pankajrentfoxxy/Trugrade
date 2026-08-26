import type { Db } from './db/db';
import type { UnitDraft, VisitSnapshot } from './domain/model';

/**
 * Reading and writing the two JSON-shaped tables: the visit snapshot and the
 * per-unit drafts. Thin on purpose — the interesting code is the queue.
 */

export async function saveSnapshot(db: Db, snapshot: VisitSnapshot): Promise<void> {
  await db.run(
    `INSERT INTO snapshot (visit_id, fetched_at, payload) VALUES (?, ?, ?)
     ON CONFLICT (visit_id) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload`,
    [snapshot.visit.id, snapshot.fetchedAt, JSON.stringify(snapshot)],
  );
}

export async function loadSnapshot(db: Db, visitId: string): Promise<VisitSnapshot | null> {
  const rows = await db.all<{ payload: string }>('SELECT payload FROM snapshot WHERE visit_id = ?', [
    visitId,
  ]);
  return rows[0] ? (JSON.parse(rows[0].payload) as VisitSnapshot) : null;
}

/** Every visit still cached on the device. The route screen falls back to this offline. */
export async function cachedVisits(db: Db): Promise<VisitSnapshot[]> {
  const rows = await db.all<{ payload: string }>(
    'SELECT payload FROM snapshot ORDER BY fetched_at DESC',
  );
  return rows.map((r) => JSON.parse(r.payload) as VisitSnapshot);
}

/**
 * Save the in-progress unit.
 *
 * Called on every step transition and after every photograph, not on a debounce.
 * The failure this guards against is the OS reclaiming the app while the camera
 * is open, and a debounce is precisely the window in which that happens.
 */
export async function saveDraft(db: Db, draft: UnitDraft, now: number): Promise<void> {
  await db.run(
    `INSERT INTO unit_draft (visit_unit_id, visit_id, payload, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (visit_unit_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [draft.visitUnitId, draft.visitId, JSON.stringify(draft), now],
  );
}

export async function loadDraft(db: Db, visitUnitId: string): Promise<UnitDraft | null> {
  const rows = await db.all<{ payload: string }>(
    'SELECT payload FROM unit_draft WHERE visit_unit_id = ?',
    [visitUnitId],
  );
  return rows[0] ? (JSON.parse(rows[0].payload) as UnitDraft) : null;
}

export async function listDrafts(db: Db, visitId: string): Promise<UnitDraft[]> {
  const rows = await db.all<{ payload: string }>(
    'SELECT payload FROM unit_draft WHERE visit_id = ? ORDER BY updated_at',
    [visitId],
  );
  return rows.map((r) => JSON.parse(r.payload) as UnitDraft);
}

/**
 * Drop a draft once its result is queued.
 *
 * Safe only because the outbox row now owns the data: the photographs are
 * referenced by their local file paths in `outbox.file_uri`, and the result is a
 * row of its own. Deleting the draft before enqueueing would lose the unit.
 */
export async function deleteDraft(db: Db, visitUnitId: string): Promise<void> {
  await db.run('DELETE FROM unit_draft WHERE visit_unit_id = ?', [visitUnitId]);
}
