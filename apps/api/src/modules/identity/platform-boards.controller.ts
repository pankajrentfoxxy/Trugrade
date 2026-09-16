import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  boardSlice,
  type BoardEnvelope,
  type BoardQuery,
  type BoardViewCount,
} from '@trugrade/contracts';
import { CurrentUser, RequirePermissions } from '../../shared/auth/guards';
import type { Principal } from '../../shared/db/org-scope';
import { PrismaService } from '../../shared/db/prisma.service';
import { ZodValidationPipe } from '../../shared/http/http';
import { AutomationService, type RuleRow } from '../../shared/automation/automation.service';

/**
 * Platform boards: the automation run log, and the approvals inbox.
 *
 * **The run log opens on Failed.** A rule that fired four thousand times
 * successfully is not news; the eleven that did not are the entire reason this
 * screen exists.
 */

export interface AutomationRunRow {
  id: string;
  ruleId: string;
  ruleName: string | null;
  objectRef: string;
  startedAt: string;
  durationMs: number | null;
  status: string;
  error: string | null;
}

export interface ApprovalRow {
  id: string;
  docType: string;
  docId: string;
  amount: string | null;
  makerId: string;
  makerName: string | null;
  madeAt: string;
  requiredPermission: string;
  status: string;
  checkerId: string | null;
  checkerName: string | null;
  decision: string | null;
  /** False when the viewer raised it. The control is disabled, and this is why. */
  canDecide: boolean;
  blockedReason: string | null;
}

const toggleSchema = z.object({ enabled: z.boolean() });

@Controller('ops/platform')
export class PlatformBoardsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automation: AutomationService,
  ) {}

  @Get('automation/rules')
  @RequirePermissions('automation.rule.read')
  rules(): Promise<RuleRow[]> {
    return this.automation.rules();
  }

  @Post('automation/rules/:id/enabled')
  @HttpCode(200)
  @RequirePermissions('automation.rule.write')
  toggle(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(toggleSchema)) body: { enabled: boolean },
    @CurrentUser() actor: Principal,
  ): Promise<RuleRow> {
    return this.automation.setEnabled(id, body.enabled, actor.userId);
  }

  @Get('automation/runs')
  @RequirePermissions('automation.rule.read')
  async runs(@Query() query: Record<string, string>): Promise<BoardEnvelope<AutomationRunRow>> {
    const q = parse(query);
    const view = q.view ?? 'failed';
    const rule = q.facet?.rule ?? null;

    const [counts] = await this.prisma.$queryRaw<Array<Record<string, bigint>>>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE status = 'FAILED') AS failed,
             count(*) FILTER (WHERE status = 'SKIPPED') AS skipped,
             count(*) FILTER (WHERE status = 'OK') AS ok
        FROM platform.automation_run
       WHERE (${rule}::text IS NULL OR rule_id = ${rule})`;

    const views: BoardViewCount[] = [
      { key: 'failed', label: 'Failed', count: Number(counts?.failed ?? 0) },
      { key: 'skipped', label: 'Skipped', count: Number(counts?.skipped ?? 0) },
      { key: 'ok', label: 'Succeeded', count: Number(counts?.ok ?? 0) },
      { key: 'all', label: 'All', count: Number(counts?.all_rows ?? 0) },
    ];
    const total = views.find((v) => v.key === view)?.count ?? Number(counts?.all_rows ?? 0);
    const { page, per, pages, offset } = boardSlice(total, q.page, q.per);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        rule_id: string;
        object_ref: string;
        started_at: Date;
        duration_ms: number | null;
        status: string;
        error: string | null;
      }>
    >(
      `SELECT id, rule_id, object_ref, started_at, duration_ms, status, error
         FROM platform.automation_run
        WHERE ($1::text IS NULL OR rule_id = $1)
          AND ${RUN_VIEW_SQL[view] ?? 'TRUE'}
        ORDER BY started_at DESC
        LIMIT $2 OFFSET $3`,
      rule,
      per,
      offset,
    );

    const rules = await this.automation.rules();
    const names = new Map(rules.map((r) => [r.id, r.name]));
    const facet = await this.prisma.$queryRaw<Array<{ rule_id: string; n: bigint }>>`
      SELECT rule_id, count(*) AS n FROM platform.automation_run GROUP BY 1 ORDER BY 1`;

    return {
      rows: rows.map((r) => ({
        id: r.id,
        ruleId: r.rule_id,
        ruleName: names.get(r.rule_id) ?? null,
        objectRef: r.object_ref,
        startedAt: r.started_at.toISOString(),
        durationMs: r.duration_ms,
        status: r.status,
        error: r.error,
      })),
      page,
      per,
      total,
      pages,
      grandTotal: Number(counts?.all_rows ?? 0),
      views,
      facets: {
        rule: facet.map((f) => ({
          value: f.rule_id,
          label: `${f.rule_id} ${names.get(f.rule_id) ?? ''}`.trim(),
          count: Number(f.n),
        })),
      },
    };
  }

  /**
   * The approvals inbox.
   *
   * Requests the viewer raised are **shown and disabled**, not hidden. Hiding
   * them would leave a maker wondering whether their request was ever raised;
   * showing them greyed, with "You raised this" as the control's own label,
   * answers both questions at once.
   */
  @Get('approvals')
  @RequirePermissions('identity.audit.read')
  async approvals(
    @Query() query: Record<string, string>,
    @CurrentUser() me: Principal,
  ): Promise<BoardEnvelope<ApprovalRow>> {
    const q = parse(query);
    const view = q.view ?? 'pending';

    const [counts] = await this.prisma.$queryRaw<Array<Record<string, bigint>>>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE status = 'PENDING') AS pending,
             count(*) FILTER (WHERE status = 'PENDING' AND maker_id = ${me.userId}::uuid) AS mine,
             count(*) FILTER (WHERE status IN ('APPROVED','REJECTED')) AS decided
        FROM identity.approval_request`;

    const views: BoardViewCount[] = [
      { key: 'pending', label: 'Waiting', count: Number(counts?.pending ?? 0) },
      { key: 'mine', label: 'Raised by me', count: Number(counts?.mine ?? 0) },
      { key: 'decided', label: 'Decided', count: Number(counts?.decided ?? 0) },
      { key: 'all', label: 'All', count: Number(counts?.all_rows ?? 0) },
    ];
    const total = views.find((v) => v.key === view)?.count ?? Number(counts?.all_rows ?? 0);
    const { page, per, pages, offset } = boardSlice(total, q.page, q.per);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        doc_type: string;
        doc_id: string;
        amount: string | null;
        maker_id: string;
        made_at: Date;
        required_permission: string;
        status: string;
        checker_id: string | null;
        decision: string | null;
      }>
    >(
      `SELECT id, doc_type, doc_id, amount::text AS amount, maker_id, made_at,
              required_permission, status, checker_id, decision
         FROM identity.approval_request
        WHERE ${APPROVAL_VIEW_SQL[view] ?? 'TRUE'}
          -- $1 is referenced unconditionally because only the 'mine' predicate
          -- uses it, and Postgres refuses a bind that supplies a parameter the
          -- statement never mentions. Cheaper than building the parameter list
          -- per view and getting the positions wrong.
          AND ($1::uuid IS NOT NULL OR TRUE)
        ORDER BY made_at DESC
        LIMIT $2 OFFSET $3`,
      me.userId,
      per,
      offset,
    );

    const ids = rows.flatMap((r) => [r.maker_id, r.checker_id].filter((v): v is string => v !== null));
    const names = ids.length
      ? new Map(
          (
            await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
              SELECT id, full_name FROM identity.user_account
               WHERE id = ANY(${[...new Set(ids)]}::uuid[])`
          ).map((u) => [u.id, u.full_name]),
        )
      : new Map<string, string>();

    return {
      rows: rows.map((r) => {
        const own = r.maker_id === me.userId;
        const holds = me.permissions.has(r.required_permission as never);
        return {
          id: r.id,
          docType: r.doc_type,
          docId: r.doc_id,
          amount: r.amount,
          makerId: r.maker_id,
          makerName: names.get(r.maker_id) ?? null,
          madeAt: r.made_at.toISOString(),
          requiredPermission: r.required_permission,
          status: r.status,
          checkerId: r.checker_id,
          checkerName: r.checker_id ? (names.get(r.checker_id) ?? null) : null,
          decision: r.decision,
          canDecide: r.status === 'PENDING' && !own && holds,
          blockedReason: own
            ? 'You raised this'
            : !holds
              ? 'Not your signature'
              : r.status !== 'PENDING'
                ? 'Already decided'
                : null,
        };
      }),
      page,
      per,
      total,
      pages,
      grandTotal: Number(counts?.all_rows ?? 0),
      views,
      facets: {},
    };
  }
}

const RUN_VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  failed: `status = 'FAILED'`,
  skipped: `status = 'SKIPPED'`,
  ok: `status = 'OK'`,
  all: 'TRUE',
});

const APPROVAL_VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  pending: `status = 'PENDING'`,
  mine: `status = 'PENDING' AND maker_id = $1::uuid`,
  decided: `status IN ('APPROVED','REJECTED')`,
  all: 'TRUE',
});

function parse(query: Record<string, string>): BoardQuery {
  const facet: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('facet.') && value) facet[key.slice(6)] = value;
  }
  const page = Number(query.page);
  const per = Number(query.per);
  return {
    ...(query.view ? { view: query.view } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(Number.isFinite(page) && page > 0 ? { page } : {}),
    ...(Number.isFinite(per) && per > 0 ? { per } : {}),
    facet,
  };
}
