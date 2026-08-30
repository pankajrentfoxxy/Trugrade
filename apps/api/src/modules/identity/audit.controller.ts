import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermissions } from '../../shared/auth/guards';
import { ClockPort } from '../../shared/clock';
import { PrismaService } from '../../shared/db/prisma.service';
import { ZodValidationPipe } from '../../shared/http/http';

/**
 * The audit-log viewer — T41. `03_UX_SPEC.md` §3C.7.
 *
 * ## There is no write route in this file, and there never will be
 *
 * `identity.audit_log` is evidence. It is append-only in the database, enforced
 * by `trg_append_only` calling `ops.reject_mutation()` on UPDATE and DELETE —
 * **a trigger and not a REVOKE**, because a REVOKE cannot bind the table owner
 * and the owner is who the application connects as. `AuditService` has no update
 * or delete method to call, this controller exposes none, and the console
 * renders no such action. Three layers agreeing is the point; the trigger is the
 * one that would still hold if the other two were wrong.
 *
 * ## A filter that drops rows says how many
 *
 * The most dangerous thing an evidence viewer can do is show an empty table.
 * Empty means one of four different things here — nothing happened, your filter
 * excluded everything, the range predates the earliest partition, or the log
 * itself is empty — and only the first is reassuring. So every response carries
 * `total` (the whole log), `matching` (after the filter) and `returned` (after
 * the page cap), and the partition bounds that decide whether the range was even
 * searchable.
 *
 * ## Partitions
 *
 * The table is RANGE-partitioned by month with **no DEFAULT partition** (schema
 * gap #1). A query for a month with no partition is not an error — Postgres
 * simply matches nothing — so a range outside the bounds returns zero rows and
 * looks exactly like a clean history. `coverage` is what stops that reading: it
 * reports the earliest and latest instants the table can hold, and the screen
 * states plainly when the range asked for falls outside them.
 */

const listQuery = z.object({
  actor: z.string().uuid().optional(),
  action: z.string().min(1).max(120).optional(),
  entityType: z.string().min(1).max(120).optional(),
  entityId: z.string().min(1).max(120).optional(),
  /** Inclusive, ISO date or datetime. */
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type AuditListQuery = z.infer<typeof listQuery>;

interface AuditActor {
  userId: string;
  /** Null when the row names a user who no longer exists. Never "System". */
  fullName: string | null;
  email: string | null;
}

interface AuditRow {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  /** Null means the action had no signed-in actor — a job, or a failed login. */
  actor: AuditActor | null;
  actorOrgId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
}

interface Facet {
  value: string;
  count: number;
}

export interface AuditLogView {
  asAt: string;
  rows: AuditRow[];
  counts: {
    /** Every row in the table, ignoring every filter. */
    total: number;
    /** Rows the filter matched. */
    matching: number;
    /** Rows on this page. */
    returned: number;
    /** `matching` minus `returned` — what the page cap is holding back. */
    beyondThisPage: number;
    /** `total` minus `matching` — what the filter excluded. */
    excludedByFilter: number;
  };
  /** The distinct actions and entity types in the whole log, with their counts. */
  facets: { actions: Facet[]; entityTypes: Facet[] };
  coverage: {
    /** Earliest instant any partition can hold, and latest. Null if unpartitioned. */
    partitionedFrom: string | null;
    partitionedTo: string | null;
    partitions: number;
    hasDefaultPartition: boolean;
    /** The oldest and newest rows actually present. */
    oldestRow: string | null;
    newestRow: string | null;
    /** True when the requested window lies wholly inside the partition bounds. */
    rangeIsCovered: boolean;
  };
  applied: AuditListQuery;
}

@Controller('admin/audit-log')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  /**
   * `identity.audit.read` — the permission AUDITOR, DPO, FINANCE, OPS_MANAGER
   * and KYC_REVIEWER already hold, and the one §3C.7 means by ADMIN_AUDIT.
   *
   * Deliberately not scoped to the caller's organisation: every row in this
   * table belongs to the platform, the five roles above are platform roles, and
   * no vendor or buyer role holds this permission at all.
   */
  @Get()
  @RequirePermissions('identity.audit.read')
  async list(
    @Query(new ZodValidationPipe(listQuery)) q: AuditListQuery,
  ): Promise<AuditLogView> {
    const now = this.clock.now();
    const from = q.from ? new Date(q.from) : undefined;
    // A bare date means the whole of that day. `2026-08-27` as an instant is
    // midnight, and a `to` of midnight silently excludes the day somebody asked
    // for — which is the filter dropping rows without saying so.
    const to = q.to ? endOf(q.to) : undefined;

    const where = {
      ...(q.actor ? { actor_user_id: q.actor } : {}),
      ...(q.action ? { action: { contains: q.action } } : {}),
      ...(q.entityType ? { entity_type: q.entityType } : {}),
      ...(q.entityId ? { entity_id: q.entityId } : {}),
      ...(from || to
        ? { created_at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    const [rows, matching, total] = await Promise.all([
      this.prisma.db.audit_log.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: q.limit,
        skip: q.offset,
      }),
      this.prisma.db.audit_log.count({ where }),
      this.prisma.db.audit_log.count(),
    ]);

    // The actors, resolved in one statement inside this module's own schema.
    // `identity.audit_log` to `identity.user_account` is not a cross-schema join
    // and never was — but it is still done as a separate query, because a LEFT
    // JOIN would quietly turn a deleted user into a row with a null name that
    // reads the same as a row that never had one.
    const actorIds = [...new Set(rows.map((r) => r.actor_user_id).filter(isString))];
    const users =
      actorIds.length === 0
        ? []
        : await this.prisma.db.user_account.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, full_name: true, email: true },
          });
    const byId = new Map(users.map((u) => [u.id, u]));

    const [actions, entityTypes, coverage, extent] = await Promise.all([
      this.facet('action'),
      this.facet('entity_type'),
      this.partitions(),
      this.extent(),
    ]);

    const rangeIsCovered =
      coverage.from === null ||
      coverage.to === null ||
      ((from === undefined || from >= coverage.from) && (to === undefined || to <= coverage.to));

    return {
      asAt: now.toISOString(),
      rows: rows.map((r) => {
        const u = r.actor_user_id === null ? undefined : byId.get(r.actor_user_id);
        return {
          id: String(r.id),
          occurredAt: r.created_at.toISOString(),
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          actor:
            r.actor_user_id === null
              ? null
              : {
                  userId: r.actor_user_id,
                  fullName: u?.full_name ?? null,
                  email: u?.email ?? null,
                },
          actorOrgId: r.actor_org_id,
          ip: r.ip,
          userAgent: r.user_agent,
          requestId: r.request_id,
          // Already redacted on the way in by `AuditService.record` — a PAN or a
          // bank account never reaches this table in full, so there is nothing
          // to mask on the way out and no "reveal" action to audit.
          before: r.before_json,
          after: r.after_json,
        };
      }),
      counts: {
        total,
        matching,
        returned: rows.length,
        beyondThisPage: Math.max(0, matching - q.offset - rows.length),
        excludedByFilter: total - matching,
      },
      facets: { actions, entityTypes },
      coverage: {
        partitionedFrom: coverage.from?.toISOString() ?? null,
        partitionedTo: coverage.to?.toISOString() ?? null,
        partitions: coverage.count,
        hasDefaultPartition: coverage.hasDefault,
        oldestRow: extent.oldest?.toISOString() ?? null,
        newestRow: extent.newest?.toISOString() ?? null,
        rangeIsCovered,
      },
      applied: q,
    };
  }

  /**
   * The distinct values of one column with their counts, over the WHOLE log.
   *
   * Unfiltered on purpose: these are the filter's own options, and a facet list
   * narrowed by the current filter cannot offer the action you have not selected
   * yet. The counts are therefore the log's, not the page's, and the screen says
   * so.
   *
   * Two hard-coded statements rather than one with an interpolated column name:
   * a column name cannot be parameterised, and building this SQL from a string
   * is how `no-unsafe-raw-sql` gets disabled "just this once".
   */
  private async facet(column: 'action' | 'entity_type'): Promise<Facet[]> {
    const rows =
      column === 'action'
        ? await this.prisma.$queryRaw<Array<{ value: string | null; n: bigint }>>`
            SELECT action AS value, count(*)::bigint AS n
              FROM identity.audit_log GROUP BY action ORDER BY n DESC, value ASC`
        : await this.prisma.$queryRaw<Array<{ value: string | null; n: bigint }>>`
            SELECT entity_type AS value, count(*)::bigint AS n
              FROM identity.audit_log WHERE entity_type IS NOT NULL
             GROUP BY entity_type ORDER BY n DESC, value ASC`;
    return rows
      .filter((r): r is { value: string; n: bigint } => r.value !== null)
      .map((r) => ({ value: r.value, count: Number(r.n) }));
  }

  /**
   * What the partitions can physically hold.
   *
   * `pg_catalog` rather than a module schema, so `no-cross-schema-join` has
   * nothing to say about it — and there is no other source for this. The bounds
   * are parsed out of `pg_get_expr(relpartbound)`, which is the only place
   * Postgres publishes them.
   */
  private async partitions(): Promise<{
    from: Date | null;
    to: Date | null;
    count: number;
    hasDefault: boolean;
  }> {
    const rows = await this.prisma.$queryRaw<Array<{ bound: string }>>`
      SELECT pg_get_expr(c.relpartbound, c.oid) AS bound
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
       WHERE i.inhparent = 'identity.audit_log'::regclass`;

    let from: Date | null = null;
    let to: Date | null = null;
    let hasDefault = false;
    for (const { bound } of rows) {
      if (bound.includes('DEFAULT')) {
        hasDefault = true;
        continue;
      }
      const m = /FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(bound);
      if (!m?.[1] || !m[2]) continue;
      const lo = new Date(m[1]);
      const hi = new Date(m[2]);
      if (from === null || lo < from) from = lo;
      if (to === null || hi > to) to = hi;
    }
    return { from, to, count: rows.length, hasDefault };
  }

  /** The oldest and newest rows actually present, which is a different fact. */
  private async extent(): Promise<{ oldest: Date | null; newest: Date | null }> {
    const [row] = await this.prisma.$queryRaw<Array<{ oldest: Date | null; newest: Date | null }>>`
      SELECT min(created_at) AS oldest, max(created_at) AS newest FROM identity.audit_log`;
    return { oldest: row?.oldest ?? null, newest: row?.newest ?? null };
  }
}

const isString = (v: string | null): v is string => v !== null;

/**
 * `2026-08-27` means the end of that day, not the start of it.
 *
 * A date-only `to` treated as an instant excludes every row on the day the
 * operator asked for, and returns fewer rows with no indication that it did —
 * the exact silent drop this screen exists to refuse.
 */
function endOf(value: string): Date {
  return value.length === 10 ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
}
