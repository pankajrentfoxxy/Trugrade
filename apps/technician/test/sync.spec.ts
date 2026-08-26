import { describe, expect, it } from 'vitest';
import { enqueue, counts, backoffFor, outstanding, type Deps, type OutboxItem } from '../src/queue/outbox';
import { drain, isPermanentStatus, type SendOutcome, type Transport } from '../src/queue/sync';
import { fakeClock, seqNonce, testDb } from './node-db';

/**
 * The sync worker's three guarantees, each with the failure it prevents:
 *
 *   order        — a photograph reaches the server before the result citing it
 *   idempotency  — a retry is the same nonce, so a replay is one row
 *   containment  — a refused item parks, a dropped connection waits
 */

/** Records what was sent, in order, and answers however the test says to. */
function recorder(answers: SendOutcome[] | ((item: OutboxItem, n: number) => SendOutcome)) {
  const sent: OutboxItem[] = [];
  let n = 0;
  const transport: Transport = {
    online: async () => true,
    async send(item) {
      sent.push(item);
      const out = typeof answers === 'function' ? answers(item, n) : (answers[n] ?? { ok: true });
      n += 1;
      return out;
    },
  };
  return { transport, sent };
}

async function deps(): Promise<Deps & { advance: (ms: number) => void }> {
  const db = await testDb();
  const { clock, advance } = fakeClock();
  return { db, now: clock, newNonce: seqNonce(), advance };
}

/** The rows one finished unit produces, in the order the app enqueues them. */
async function queueOneUnit(d: Deps) {
  await enqueue(d, { kind: 'TOOL_RUN', dedupeKey: 'TOOL_RUN:DEVICESURE:cert-1', body: { toolRunId: 'cert-1' }, visitId: 'v1' });
  for (const angle of ['LID', 'PALMREST', 'SCREEN_ON', 'PORTS', 'BASE', 'SEAL']) {
    await enqueue(d, { kind: 'PHOTO', dedupeKey: `PHOTO:u1:${angle}`, body: { angle }, visitId: 'v1', fileUri: `file:///${angle}.jpg` });
  }
  await enqueue(d, { kind: 'SEAL', dedupeKey: 'SEAL:TRG-26HR-0004821', body: {}, visitId: 'v1' });
  await enqueue(d, { kind: 'UNIT_RESULT', dedupeKey: 'UNIT_RESULT:u1:100', body: { visitUnitId: 'u1' }, visitId: 'v1' });
}

describe('sync ordering', () => {
  it('delivers a unit as certificate, photographs, seal, result — in that order', async () => {
    const d = await deps();
    await queueOneUnit(d);

    const { transport, sent } = recorder([]);
    const report = await drain({ db: d.db, now: d.now, transport });

    expect(report.sent).toBe(9);
    expect(sent.map((i) => i.kind)).toEqual([
      'TOOL_RUN',
      'PHOTO',
      'PHOTO',
      'PHOTO',
      'PHOTO',
      'PHOTO',
      'PHOTO',
      'SEAL',
      'UNIT_RESULT',
    ]);
    // The seal photograph must be on the server before the seal row that names
    // its hash — `applied_photo_key` is NOT NULL.
    const sealPhotoAt = sent.findIndex((i) => i.body.angle === 'SEAL');
    expect(sealPhotoAt).toBeLessThan(sent.findIndex((i) => i.kind === 'SEAL'));
    expect((await counts(d.db)).outstanding).toBe(0);
  });

  it('stops at the first transient failure and does not reorder around it', async () => {
    const d = await deps();
    await queueOneUnit(d);

    // The third item fails: the connection went away mid-sync.
    const { transport, sent } = recorder((_item, n) =>
      n === 2 ? { ok: false, permanent: false, error: 'network' } : { ok: true },
    );
    const report = await drain({ db: d.db, now: d.now, transport });

    expect(report.sent).toBe(2);
    expect(report.stalled).toBe(true);
    expect(sent).toHaveLength(3);
    // Nothing behind the stalled item was tried.
    expect((await counts(d.db)).pending).toBe(7);
  });

  // The whole offline promise, end to end: the queue survives a dead link and
  // finishes the day's work on reconnect without duplicating anything.
  it('resumes from the same item on the next pass and re-sends the SAME nonce', async () => {
    const d = await deps();
    await queueOneUnit(d);

    let fail = true;
    const attempts: Array<{ id: number; nonce: string }> = [];
    const transport: Transport = {
      online: async () => true,
      async send(item) {
        attempts.push({ id: item.id, nonce: item.nonce });
        if (fail && item.kind === 'PHOTO') return { ok: false, permanent: false, error: 'network' };
        return { ok: true };
      },
    };

    await drain({ db: d.db, now: d.now, transport });
    const stalledAttempt = attempts.at(-1)!;

    // Too soon: the head is still in backoff, so nothing goes.
    const early = await drain({ db: d.db, now: d.now, transport });
    expect(early.sent).toBe(0);

    d.advance(backoffFor(1) + 1);
    fail = false;
    const second = await drain({ db: d.db, now: d.now, transport });

    const retry = attempts.find((a, i) => i > attempts.indexOf(stalledAttempt) && a.id === stalledAttempt.id)!;
    expect(retry.nonce).toBe(stalledAttempt.nonce);
    expect(second.sent).toBe(8);
    expect((await counts(d.db)).outstanding).toBe(0);
  });

  it('parks a refused item and finishes everything behind it', async () => {
    const d = await deps();
    await queueOneUnit(d);

    const { transport } = recorder((item) =>
      item.kind === 'SEAL'
        ? { ok: false, permanent: true, error: '400 Seal code is not on the roll issued for this visit.' }
        : { ok: true },
    );
    const report = await drain({ db: d.db, now: d.now, transport });

    expect(report.blocked).toBe(1);
    expect(report.sent).toBe(8);
    expect(report.stalled).toBe(false);

    const c = await counts(d.db);
    expect(c.pending).toBe(0);
    expect(c.blocked).toBe(1);

    // The message survives for the sync screen — a technician standing next to
    // the machine is the only person who can fix this one.
    const [stuck] = await outstanding(d.db);
    expect(stuck!.lastError).toContain('roll issued for this visit');
  });

  it('does nothing at all when there is no connection', async () => {
    const d = await deps();
    await queueOneUnit(d);

    let calls = 0;
    const report = await drain({
      db: d.db,
      now: d.now,
      transport: {
        online: async () => false,
        async send() {
          calls += 1;
          return { ok: true };
        },
      },
    });

    expect(report.offline).toBe(true);
    expect(calls).toBe(0);
    expect((await counts(d.db)).pending).toBe(9);
  });

  it('cannot loop forever on a transport that never advances the row', async () => {
    const d = await deps();
    await queueOneUnit(d);

    let calls = 0;
    // Reports success without the row ever being marked — the shape of a bug,
    // and the reason `maxItems` exists.
    const report = await drain({
      db: d.db,
      now: d.now,
      maxItems: 5,
      transport: {
        online: async () => true,
        async send() {
          calls += 1;
          return { ok: true };
        },
      },
    });

    expect(calls).toBeLessThanOrEqual(5);
    expect(report.stalled).toBe(true);
  });
});

describe('failure classification', () => {
  it.each([
    [400, true],
    [403, true],
    [404, true],
    [409, true],
    [422, true],
  ])('treats %i as permanent — retrying will not help', (status, permanent) => {
    expect(isPermanentStatus(status)).toBe(permanent);
  });

  it.each([
    // 0 is "never reached a server". A basement, not a bad payload.
    [0, false],
    // An expired token is never a reason to discard a day of inspections.
    [401, false],
    [408, false],
    [429, false],
    [500, false],
    [503, false],
  ])('treats %i as transient — the same nonce goes again later', (status, permanent) => {
    expect(isPermanentStatus(status)).toBe(permanent);
  });
});
