import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent, EventName } from '@trugrade/contracts';
import { PrismaService } from '../db/prisma.service';
import { ClockPort } from '../clock';
import { EventBus } from './event-bus';

/**
 * Drains the outbox after commit.
 *
 * Retry schedule is exponential with a cap; after `MAX_ATTEMPTS` the row moves to
 * DEAD_LETTER and stays there to be inspected and replayed from the ops console.
 * A handler that throws must never silently vanish — that is the failure mode
 * where a payout quietly never happens and nobody finds out for a month.
 */
const MAX_ATTEMPTS = 6;
const BACKOFF_SECONDS = [30, 120, 600, 3_600, 21_600, 86_400];
const BATCH_SIZE = 100;

@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Drain one batch. Returns how many rows were dispatched.
   *
   * Called on a short interval by the scheduler and directly by integration tests,
   * which is why it returns a count rather than logging one.
   */
  async drain(): Promise<{ dispatched: number; failed: number; deadLettered: number }> {
    if (this.draining) return { dispatched: 0, failed: 0, deadLettered: 0 };
    this.draining = true;
    try {
      const now = this.clock.now();

      // SKIP LOCKED so two API instances draining concurrently take different
      // rows instead of blocking on each other.
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          event_name: string;
          payload_json: unknown;
          trace_id: string | null;
          actor_user_id: string | null;
          occurred_at: Date;
          attempts: number;
        }>
      >`
        SELECT id, event_name, payload_json, trace_id, actor_user_id, occurred_at, attempts
        FROM platform.event_outbox
        WHERE (status = 'PENDING')
           OR (status = 'FAILED' AND next_retry_at IS NOT NULL AND next_retry_at <= ${now})
        ORDER BY occurred_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;

      let dispatched = 0;
      let failed = 0;
      let deadLettered = 0;

      for (const row of rows) {
        const event = {
          eventId: row.id,
          name: row.event_name as EventName,
          payload: row.payload_json,
          occurredAt: row.occurred_at.toISOString(),
          traceId: row.trace_id ?? undefined,
          actorUserId: row.actor_user_id,
        } as DomainEvent;

        const handlers = this.bus.handlersFor(event.name);
        const errors: string[] = [];

        for (const { handlerId, handler } of handlers) {
          try {
            await handler(event as never);
          } catch (e) {
            errors.push(`${handlerId}: ${(e as Error).message}`);
            this.logger.error(
              `Handler ${handlerId} failed for ${event.name} (${row.id}): ${(e as Error).message}`,
            );
          }
        }

        if (errors.length === 0) {
          await this.prisma.event_outbox.update({
            where: { id: row.id },
            data: { status: 'DISPATCHED', dispatched_at: now, attempts: row.attempts + 1 },
          });
          dispatched++;
        } else {
          const attempts = row.attempts + 1;
          const dead = attempts >= MAX_ATTEMPTS;
          await this.prisma.event_outbox.update({
            where: { id: row.id },
            data: {
              status: dead ? 'DEAD_LETTER' : 'FAILED',
              attempts,
              last_error: errors.join(' | ').slice(0, 2000),
              next_retry_at: dead
                ? null
                : new Date(
                    now.getTime() +
                      (BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)] ?? 3600) * 1000,
                  ),
            },
          });
          if (dead) {
            deadLettered++;
            this.logger.error(
              `Event ${event.name} (${row.id}) dead-lettered after ${attempts} attempts. Needs a human.`,
            );
          } else {
            failed++;
          }
        }
      }

      return { dispatched, failed, deadLettered };
    } finally {
      this.draining = false;
    }
  }

  /** Ops action: put a dead-lettered event back in the queue. Audit-logged by the caller. */
  async replay(eventId: string): Promise<void> {
    await this.prisma.event_outbox.update({
      where: { id: eventId },
      data: { status: 'PENDING', attempts: 0, next_retry_at: null, last_error: null },
    });
  }

  async deadLetterCount(): Promise<number> {
    return this.prisma.event_outbox.count({ where: { status: 'DEAD_LETTER' } });
  }
}
