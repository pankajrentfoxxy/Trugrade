import type { Clock } from '../clock';
import type { Db } from '../db/db';
import { head, markBlocked, markRetry, markSent, type OutboxItem } from './outbox';

/**
 * The sync worker: drain the outbox in order, once, safely.
 *
 * Everything interesting about offline-first is in three decisions here, and
 * each of them is one a warehouse day turns on.
 *
 * **1. Order is the dependency graph.** Photographs are enqueued before the unit
 * result that cites their object keys, and the seal before the confirmation that
 * asserts one was applied. Draining strictly by `id` means those arrive in the
 * order they were taken, so there is no dependency graph to build and none to
 * get wrong. The cost is head-of-line blocking, which is paid for by decision 3.
 *
 * **2. A retry is the same request, byte for byte.** The nonce was minted when
 * the action was recorded and is re-sent unchanged. `qc_tool_run.nonce UNIQUE`
 * and `UNIQUE (tool_provider_id, tool_run_id)` then make a replay one row and a
 * 200 rather than a duplicate inspection. This is the reason `send` is handed
 * the whole `OutboxItem` instead of a freshly built payload: there is no code
 * path here that can mint a second nonce for the same action.
 *
 * **3. Permanent failures step aside; transient ones hold the line.** A dropped
 * connection or a 503 must not lose the action, so it backs off and the queue
 * waits — reordering around it would break decision 1. A 400 or a 409 will never
 * succeed on retry, so it parks as BLOCKED and the queue continues; a technician
 * with thirty-nine good units must not lose them behind one bad payload.
 */

export type SendOutcome =
  | { ok: true }
  /** Will fail again on retry. Needs a human. */
  | { ok: false; permanent: true; error: string }
  /** Network, timeout, 5xx, expired token. Same nonce, later. */
  | { ok: false; permanent: false; error: string };

export interface Transport {
  /** True when there is a usable connection. Checked before each item. */
  online(): Promise<boolean>;
  send(item: OutboxItem): Promise<SendOutcome>;
}

export interface DrainReport {
  sent: number;
  blocked: number;
  /** The queue stopped here and will resume from the same item. */
  stalled: boolean;
  offline: boolean;
}

export interface DrainDeps {
  db: Db;
  now: Clock;
  transport: Transport;
  /**
   * A ceiling on one pass, so the loop cannot spin forever if a transport starts
   * reporting success without advancing the row. Forty units is roughly 300
   * actions, so a day fits inside one drain.
   */
  maxItems?: number;
}

export async function drain({
  db,
  now,
  transport,
  maxItems = 500,
}: DrainDeps): Promise<DrainReport> {
  const report: DrainReport = { sent: 0, blocked: 0, stalled: false, offline: false };

  if (!(await transport.online())) {
    report.offline = true;
    return report;
  }

  for (let i = 0; i < maxItems; i += 1) {
    const item = await head(db, now());
    if (!item) {
      // Either the queue is empty or its head is in backoff. Both mean "come
      // back later", and neither is an error.
      return report;
    }

    const outcome = await transport.send(item);

    if (outcome.ok) {
      await markSent({ db, now }, item.id);
      report.sent += 1;
      continue;
    }

    if (outcome.permanent) {
      await markBlocked({ db }, item.id, outcome.error);
      report.blocked += 1;
      continue;
    }

    await markRetry({ db, now }, item.id, outcome.error);
    report.stalled = true;
    // Stop rather than try the next item: see decision 1. If the network is
    // down, the next item fails too and we would burn the battery proving it.
    return report;
  }

  report.stalled = true;
  return report;
}

/**
 * Which HTTP statuses are worth retrying.
 *
 * `401` is deliberately **transient**. An expired access token is not a reason
 * to discard a day of inspections; the technician signs in again and the queue
 * drains. The only thing that permanently discards work here is the server
 * saying the payload itself is wrong.
 *
 * `409` is permanent, and that is not a contradiction of the idempotency rule:
 * our own replay carries the same nonce and the same `tool_run_id`, which the
 * ingestion endpoint answers with a 200. A 409 therefore means a *different*
 * payload arrived under a nonce that is already spent — a bug, not a retry, and
 * it needs to be visible rather than looped on.
 */
export function isPermanentStatus(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return false;
  if (status === 401) return false;
  return status >= 400 && status < 500;
}
