import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression, ScheduleModule } from '@nestjs/schedule';
import { PrismaModule, PrismaService } from '../../shared/db/prisma.service';
import { ClockModule, ClockPort } from '../../shared/clock';
import { EventBusModule } from '../../shared/events/event-bus';
import { OutboxDispatcher } from '../../shared/events/outbox-dispatcher';

/**
 * A drift view is a *detective* control: it asserts that the invariants the
 * application believes it maintains actually hold in the data.
 *
 * **Each must return zero rows. A non-zero result is a P1 page, not a warning.**
 * A row here means we are either showing a buyer stock we cannot ship, or holding
 * a ledger that does not balance.
 *
 * 02_ARCHITECTURE.md §6, PHASE_00 Task 5.9.
 */
interface DriftCheck {
  name: string;
  view: string;
  /** What a human should understand from a non-zero result. */
  meaning: string;
}

const DRIFT_CHECKS: readonly DriftCheck[] = [
  {
    name: 'ledger_imbalance',
    view: 'payment.v_ledger_imbalance',
    meaning: 'A double-entry batch does not sum to zero. The books are wrong; stop and reconcile.',
  },
  {
    name: 'stock_drift',
    view: 'listing.v_stock_drift',
    meaning: 'Listing counters disagree with actual unit counts. This is how an oversell happens.',
  },
  {
    name: 'sellability_drift',
    view: 'listing.v_sellability_drift',
    meaning:
      'A unit is flagged sellable when it is not — expired QC, broken seal, or no seal at all.',
  },
  {
    name: 'expiring_documents',
    view: 'kyc.v_expiring_documents',
    // This one legitimately returns rows; it drives a notification, not a page.
    meaning: 'KYC documents or certifications expiring within 30 days. Notify, do not page.',
  },
  {
    name: 'expiring_qc',
    view: 'qc.v_expiring_qc',
    meaning:
      'Inspections expiring within 14 days. Warn the vendor so stock does not silently unlist.',
  },
];

/** These two are informational; the rest must be empty. */
const ADVISORY_CHECKS = new Set(['expiring_documents', 'expiring_qc']);

@Injectable()
export class IntegrityJobs {
  private readonly logger = new Logger(IntegrityJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly outbox: OutboxDispatcher,
  ) {}

  /**
   * Keeps three months of partitions ahead of today, every night, idempotently.
   * This is the job whose absence made the adopted schema expire on 2026-10-01.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'partition-maintenance' })
  async maintainPartitions(): Promise<{ created: number }> {
    return this.tracked('partition_maintenance', async () => {
      const rows = await this.prisma.$queryRaw<
        Array<{ table_schema: string; table_name: string; created_count: number }>
      >`SELECT * FROM ops.ensure_partitions(NULL)`;

      const created = rows.reduce((a, r) => a + Number(r.created_count), 0);
      if (created > 0) {
        this.logger.log(
          `Created ${created} partition(s): ` +
            rows
              .filter((r) => r.created_count > 0)
              .map((r) => `${r.table_schema}.${r.table_name} x${r.created_count}`)
              .join(', '),
        );
      }

      const runway = await this.prisma.$queryRaw<
        Array<{
          table_schema: string;
          table_name: string;
          runway_days: number;
          is_critical: boolean;
        }>
      >`SELECT * FROM ops.v_partition_runway WHERE is_critical`;

      if (runway.length) {
        // Should be impossible immediately after ensure_partitions — which is
        // exactly why it is worth shouting about.
        this.logger.error(
          `PARTITION RUNWAY CRITICAL after maintenance: ${runway
            .map((r) => `${r.table_schema}.${r.table_name}=${r.runway_days}d`)
            .join(', ')}`,
        );
      }

      return { rows: created, detail: { created: rows } };
    }).then((r) => ({ created: r.rows }));
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'drift-checks' })
  async runDriftChecks(): Promise<Record<string, number>> {
    const results: Record<string, number> = {};

    for (const check of DRIFT_CHECKS) {
      await this.tracked(`drift_${check.name}`, async () => {
        // The view name is from a compile-time constant list, never user input.
        const counted = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*)::bigint AS count FROM ${check.view}`,
        );
        const n = Number(counted[0]?.count ?? 0n);
        results[check.name] = n;

        if (n > 0 && !ADVISORY_CHECKS.has(check.name)) {
          // Pull a few offending ids so the alert is actionable rather than a number.
          const sample = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT * FROM ${check.view} LIMIT 10`,
          );
          this.logger.error(
            `DRIFT: ${check.view} returned ${n} row(s). ${check.meaning} Sample: ${JSON.stringify(sample)}`,
          );
          return { rows: n, detail: { sample }, fail: true };
        }

        if (n > 0) {
          this.logger.warn(`${check.view}: ${n} row(s). ${check.meaning}`);
        }
        return { rows: n };
      });
    }

    return results;
  }

  /** The outbox drains far more often than nightly; this is the safety net. */
  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'outbox-drain' })
  async drainOutbox(): Promise<void> {
    const r = await this.outbox.drain();
    if (r.deadLettered > 0) {
      this.logger.error(
        `${r.deadLettered} event(s) dead-lettered. Inspect and replay from the ops console.`,
      );
    }
  }

  /**
   * Wrap a job so `ops.job_run` records that it ran, what it found and whether it
   * succeeded. `/health` reads the latest row per job, which is the only way to
   * tell "clean" apart from "never ran".
   */
  private async tracked(
    jobName: string,
    fn: () => Promise<{ rows?: number; detail?: unknown; fail?: boolean }>,
  ): Promise<{ rows: number }> {
    const started = this.clock.now();
    const inserted = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO ops.job_run (job_name, started_at, status)
      VALUES (${jobName}, ${started}, 'RUNNING') RETURNING id`;
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error(`Could not open a job_run row for ${jobName}`);

    try {
      const result = await fn();
      await this.prisma.$executeRaw`
        UPDATE ops.job_run
           SET finished_at = ${this.clock.now()},
               status = ${result.fail ? 'FAILED' : 'SUCCESS'},
               rows_affected = ${result.rows ?? 0},
               detail_json = ${JSON.stringify(result.detail ?? null)}::jsonb
         WHERE id = ${id}`;
      return { rows: result.rows ?? 0 };
    } catch (e) {
      await this.prisma.$executeRaw`
        UPDATE ops.job_run
           SET finished_at = ${this.clock.now()}, status = 'FAILED', error = ${(e as Error).message}
         WHERE id = ${id}`;
      this.logger.error(`Job ${jobName} threw: ${(e as Error).message}`);
      throw e;
    }
  }
}

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, ClockModule, EventBusModule],
  providers: [IntegrityJobs, OutboxDispatcher],
  exports: [IntegrityJobs, OutboxDispatcher],
})
export class JobsModule {}
