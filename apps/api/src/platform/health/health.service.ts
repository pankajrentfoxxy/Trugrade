import { Controller, Get, Injectable, Logger, Module } from '@nestjs/common';
import { PrismaModule, PrismaService } from '../../shared/db/prisma.service';
import { RedisModule, RedisService } from '../../shared/redis/redis.service';
import { AdaptersModule } from '../../shared/adapters/adapters.module';
import { ObjectStorePort } from '../../shared/adapters/ports';
import { ClockModule, ClockPort } from '../../shared/clock';
import { Public } from '../../shared/auth/guards';
import { PARTITION_RUNWAY_DAYS } from '@trugrade/contracts';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  checks: Record<string, { ok: boolean; detail?: string; value?: unknown }>;
}

/**
 * `/health` answers one question honestly: can this process do its job right now?
 *
 * Two things here are not standard boilerplate and both exist because of a real
 * failure mode:
 *
 *   - **Partition runway.** The adopted schema's partitions expire on a date. When
 *     they do, INSERTs fail — silently at first, because nothing was watching.
 *     Runway in days per table is therefore a first-class health signal, and
 *     below 30 days it is a page, not a warning (DATA-05, DATA-06).
 *
 *   - **Last successful run of each nightly integrity job.** A drift view that
 *     stopped running looks exactly like a drift view returning zero rows. Only
 *     the timestamp tells them apart.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly store: ObjectStorePort,
    private readonly clock: ClockPort,
  ) {}

  async liveness(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  async readiness(): Promise<HealthReport> {
    const checks: HealthReport['checks'] = {};

    checks.database = await this.safe(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
      return {};
    });

    checks.redis = await this.safe(async () => {
      const ok = await this.redis.ping();
      if (!ok) throw new Error('PING did not return PONG');
      return {};
    });

    checks.objectStore = await this.safe(async () => {
      const key = `healthcheck/${this.clock.nowIso()}`;
      await this.store.put(key, Buffer.from('ok'), 'text/plain');
      await this.store.delete(key);
      return {};
    });

    checks.partitionRunway = await this.safe(async () => {
      const rows = await this.prisma.$queryRaw<
        Array<{ table_schema: string; table_name: string; runway_days: number; is_critical: boolean }>
      >`SELECT table_schema, table_name, runway_days, is_critical FROM ops.v_partition_runway ORDER BY runway_days`;

      const worst = rows[0];
      const critical = rows.filter((r) => r.is_critical);
      if (critical.length) {
        throw Object.assign(
          new Error(
            `${critical.length} partitioned table(s) below ${PARTITION_RUNWAY_DAYS.alertBelow} days of runway: ` +
              critical.map((c) => `${c.table_schema}.${c.table_name} (${c.runway_days}d)`).join(', '),
          ),
          { value: rows },
        );
      }
      return {
        value: {
          minRunwayDays: worst?.runway_days ?? null,
          tables: rows.map((r) => ({ table: `${r.table_schema}.${r.table_name}`, days: r.runway_days })),
        },
      };
    });

    checks.integrityJobs = await this.safe(async () => {
      const rows = await this.prisma.$queryRaw<
        Array<{ job_name: string; started_at: Date; status: string; rows_affected: number | null }>
      >`SELECT job_name, started_at, status, rows_affected FROM ops.v_job_health ORDER BY job_name`;

      const stale = rows.filter(
        (r) => this.clock.nowMs() - r.started_at.getTime() > 36 * 3600 * 1000,
      );
      const failed = rows.filter((r) => r.status === 'FAILED');
      if (failed.length || stale.length) {
        throw Object.assign(
          new Error(
            [
              failed.length ? `failed: ${failed.map((f) => f.job_name).join(', ')}` : '',
              stale.length ? `stale (>36h): ${stale.map((s) => s.job_name).join(', ')}` : '',
            ]
              .filter(Boolean)
              .join('; '),
          ),
          { value: rows },
        );
      }
      return { value: rows.map((r) => ({ job: r.job_name, at: r.started_at, status: r.status })) };
    });

    checks.outbox = await this.safe(async () => {
      const dead = await this.prisma.db.event_outbox.count({ where: { status: 'DEAD_LETTER' } });
      if (dead > 0) throw Object.assign(new Error(`${dead} dead-lettered event(s) need a human`), { value: dead });
      const pending = await this.prisma.db.event_outbox.count({ where: { status: 'PENDING' } });
      return { value: { pending, deadLettered: 0 } };
    });

    const failedCount = Object.values(checks).filter((c) => !c.ok).length;
    const hardDown = !checks.database?.ok || !checks.redis?.ok;

    return {
      status: hardDown ? 'down' : failedCount > 0 ? 'degraded' : 'ok',
      checkedAt: this.clock.nowIso(),
      checks,
    };
  }

  private async safe(
    fn: () => Promise<{ detail?: string; value?: unknown }>,
  ): Promise<{ ok: boolean; detail?: string; value?: unknown }> {
    try {
      const r = await fn();
      return { ok: true, ...r };
    } catch (e) {
      const err = e as Error & { value?: unknown };
      return { ok: false, detail: err.message, value: err.value };
    }
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Container liveness. Cheap, and never touches a dependency. */
  @Public()
  @Get('live')
  live(): Promise<{ status: 'ok' }> {
    return this.health.liveness();
  }

  /** Load-balancer readiness and the ops dashboard. */
  @Public()
  @Get()
  ready(): Promise<HealthReport> {
    return this.health.readiness();
  }
}

@Module({
  imports: [PrismaModule, RedisModule, AdaptersModule, ClockModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
