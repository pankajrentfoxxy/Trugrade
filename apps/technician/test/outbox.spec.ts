import { describe, expect, it } from 'vitest';
import {
  backoffFor,
  BACKOFF_CAP_MS,
  counts,
  enqueue,
  head,
  markBlocked,
  markRetry,
  markSent,
  outstanding,
  pruneSent,
  retryBlocked,
  submittedUnits,
  type Deps,
} from '../src/queue/outbox';
import { fakeClock, seqNonce, testDb } from './node-db';

async function deps(): Promise<Deps & { advance: (ms: number) => void }> {
  const db = await testDb();
  const { clock, advance } = fakeClock();
  return { db, now: clock, newNonce: seqNonce(), advance };
}

describe('outbox', () => {
  it('records an action and returns it as the head of the queue', async () => {
    const d = await deps();
    await enqueue(d, { kind: 'CHECK_IN', dedupeKey: 'CHECK_IN:v1', body: { visitId: 'v1' }, visitId: 'v1' });

    const item = await head(d.db, d.now());
    expect(item?.kind).toBe('CHECK_IN');
    expect(item?.body).toEqual({ visitId: 'v1' });
    expect(item?.status).toBe('PENDING');
  });

  // The double-tap case. Two taps on Confirm must not become two inspections.
  it('is idempotent on the dedupe key and keeps the ORIGINAL nonce', async () => {
    const d = await deps();
    const first = await enqueue(d, {
      kind: 'UNIT_RESULT',
      dedupeKey: 'UNIT_RESULT:u1:100',
      body: { visitUnitId: 'u1', pass: 1 },
    });
    const second = await enqueue(d, {
      kind: 'UNIT_RESULT',
      dedupeKey: 'UNIT_RESULT:u1:100',
      body: { visitUnitId: 'u1', pass: 2 },
    });

    expect(second.id).toBe(first.id);
    // The nonce is what makes the server-side replay safe. A second enqueue that
    // minted a fresh one would defeat the whole mechanism.
    expect(second.nonce).toBe(first.nonce);
    // And the first payload wins — the row was already recorded.
    expect(second.body).toEqual({ visitUnitId: 'u1', pass: 1 });
    expect((await counts(d.db)).pending).toBe(1);
  });

  it('a restarted inspection is a different dedupe key and a new row', async () => {
    const d = await deps();
    const a = await enqueue(d, { kind: 'UNIT_RESULT', dedupeKey: 'UNIT_RESULT:u1:100', body: {} });
    const b = await enqueue(d, { kind: 'UNIT_RESULT', dedupeKey: 'UNIT_RESULT:u1:900', body: {} });
    expect(b.id).not.toBe(a.id);
    expect(b.nonce).not.toBe(a.nonce);
  });

  it('serves the queue strictly in insertion order', async () => {
    const d = await deps();
    for (const k of ['TOOL_RUN', 'PHOTO', 'SEAL', 'UNIT_RESULT'] as const) {
      await enqueue(d, { kind: k, dedupeKey: `${k}:u1`, body: {} });
    }

    const seen: string[] = [];
    for (;;) {
      const item = await head(d.db, d.now());
      if (!item) break;
      seen.push(item.kind);
      await markSent(d, item.id);
    }
    expect(seen).toEqual(['TOOL_RUN', 'PHOTO', 'SEAL', 'UNIT_RESULT']);
  });

  // Head-of-line blocking, deliberately: photographs must land before the result
  // that names their keys, so a stalled item pauses the queue rather than being
  // skipped over.
  it('holds the line while the head is in backoff', async () => {
    const d = await deps();
    await enqueue(d, { kind: 'PHOTO', dedupeKey: 'PHOTO:u1:aa', body: {} });
    await enqueue(d, { kind: 'UNIT_RESULT', dedupeKey: 'UNIT_RESULT:u1:100', body: {} });

    const first = (await head(d.db, d.now()))!;
    await markRetry(d, first.id, 'network down');

    expect(await head(d.db, d.now())).toBeNull();

    d.advance(backoffFor(1) + 1);
    expect((await head(d.db, d.now()))!.id).toBe(first.id);
  });

  it('backs off exponentially and caps', () => {
    expect(backoffFor(1)).toBe(15_000);
    expect(backoffFor(2)).toBe(30_000);
    expect(backoffFor(3)).toBe(60_000);
    expect(backoffFor(50)).toBe(BACKOFF_CAP_MS);
  });

  // The escape valve. One bad payload must not cost a technician the other 39
  // units, so a permanently refused row parks and the queue moves on.
  it('steps over a blocked item', async () => {
    const d = await deps();
    await enqueue(d, { kind: 'SEAL', dedupeKey: 'SEAL:TRG-26HR-0000001', body: {} });
    await enqueue(d, { kind: 'UNIT_RESULT', dedupeKey: 'UNIT_RESULT:u1:100', body: {} });

    const first = (await head(d.db, d.now()))!;
    await markBlocked(d, first.id, '400 Seal code is not on the roll issued for this visit.');

    const next = await head(d.db, d.now());
    expect(next?.kind).toBe('UNIT_RESULT');

    const c = await counts(d.db);
    expect(c.blocked).toBe(1);
    expect(c.pending).toBe(1);
    expect(c.outstanding).toBe(2);
  });

  it('a blocked item keeps the server message and can be retried by hand', async () => {
    const d = await deps();
    const item = await enqueue(d, { kind: 'SEAL', dedupeKey: 'SEAL:x', body: {} });
    await markBlocked(d, item.id, '409 nonce already spent');

    const [stuck] = await outstanding(d.db);
    expect(stuck!.status).toBe('BLOCKED');
    expect(stuck!.lastError).toContain('409');

    await retryBlocked(d.db);
    const back = await head(d.db, d.now());
    expect(back!.id).toBe(item.id);
    // Same nonce after a manual retry — otherwise "retry" would mean "duplicate".
    expect(back!.nonce).toBe(item.nonce);
  });

  it('counts what the badge shows, including the oldest waiting item', async () => {
    const d = await deps();
    await enqueue(d, { kind: 'PHOTO', dedupeKey: 'PHOTO:u1:a', body: {} });
    const at = d.now();
    d.advance(60_000);
    await enqueue(d, { kind: 'PHOTO', dedupeKey: 'PHOTO:u1:b', body: {} });
    await enqueue(d, { kind: 'UNIT_RESULT', dedupeKey: 'UNIT_RESULT:u1:1', body: {} });

    const c = await counts(d.db);
    expect(c.outstanding).toBe(3);
    expect(c.pendingPhotos).toBe(2);
    expect(c.oldestPendingAt).toBe(at);
  });

  it('reports which units of a visit have been submitted', async () => {
    const d = await deps();
    await enqueue(d, { kind: 'PHOTO', dedupeKey: 'PHOTO:u1:a', body: { visitUnitId: 'u1' }, visitId: 'v1' });
    await enqueue(d, { kind: 'UNIT_RESULT', dedupeKey: 'UNIT_RESULT:u1:1', body: { visitUnitId: 'u1' }, visitId: 'v1' });
    await enqueue(d, { kind: 'ABSENT', dedupeKey: 'ABSENT:u2', body: { visitUnitId: 'u2' }, visitId: 'v1' });
    await enqueue(d, { kind: 'UNIT_RESULT', dedupeKey: 'UNIT_RESULT:z9:1', body: { visitUnitId: 'z9' }, visitId: 'other' });

    const map = await submittedUnits(d.db, 'v1');
    expect([...map.keys()].sort()).toEqual(['u1', 'u2']);
    // A queued photograph is not a finished inspection.
    expect(map.get('u1')!.kind).toBe('UNIT_RESULT');
    expect(map.has('z9')).toBe(false);
  });

  it('keeps delivered rows for the retention window, then prunes them', async () => {
    const d = await deps();
    const item = await enqueue(d, { kind: 'CHECK_IN', dedupeKey: 'CHECK_IN:v1', body: {} });
    await markSent(d, item.id);

    d.advance(3 * 86_400_000);
    await pruneSent(d.db, d.now());
    expect((await counts(d.db)).sent).toBe(1);

    d.advance(8 * 86_400_000);
    await pruneSent(d.db, d.now());
    expect((await counts(d.db)).sent).toBe(0);
  });
});
