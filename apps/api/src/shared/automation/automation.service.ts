import { Injectable, Logger } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { PrismaModule, PrismaService } from '../db/prisma.service';
import { ClockModule, ClockPort } from '../clock';
import { ForbiddenError, NotFoundError } from '../errors/domain-errors';

/**
 * The rules, and the evidence that they ran.
 *
 * **Nothing in this repository subscribes to an event.** `events.publish` writes
 * to an outbox with no reader, so `trigger_event` here is a label for the screen
 * and the audit trail rather than a subscription: the rule body runs inline at
 * the point the event would have been published — in the same transaction where
 * that is safe, immediately after commit where it makes an external call.
 *
 * It lives in `shared/` beside `EventBus` rather than inside the platform
 * module, and for the same reason: every module's rule bodies have to be able to
 * record a run, and a module that had to import another one to do it would close
 * a cycle. The tables are `platform.automation_rule` and `platform.automation_run`.
 *
 * What makes the engine real is this service's other half. Every attempt writes
 * an `automation_run`, including the ones that did nothing and the ones that
 * failed, because a rule nobody can see run is indistinguishable from a rule
 * that was never wired up.
 */

export interface RuleRow {
  id: string;
  name: string;
  triggerEvent: string;
  conditionNote: string;
  actionNote: string;
  failureNote: string;
  mode: 'AUTO' | 'SUGGEST' | 'MANUAL';
  enabled: boolean;
  updatedAt: Date;
}

export interface RunRow {
  id: string;
  ruleId: string;
  objectRef: string;
  startedAt: Date;
  durationMs: number | null;
  status: 'OK' | 'FAILED' | 'SKIPPED';
  error: string | null;
  payload: Record<string, unknown>;
}

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Run a rule body and record what happened, whatever happened.
   *
   * A disabled rule is a SKIPPED run rather than silence: "why did this order
   * not book" is answered on the run log, and an absence answers nothing. The
   * caller gets `null` back and decides — most callers do nothing, which is the
   * point of the switch.
   *
   * A throwing body is recorded as FAILED and **re-thrown**. Swallowing it here
   * would turn a rule into a thing that sometimes silently does not happen,
   * which is the failure mode this whole table exists to remove.
   */
  async run<T>(
    ruleId: string,
    objectRef: string,
    body: () => Promise<T>,
    options: { payload?: Record<string, unknown> } = {},
  ): Promise<T | null> {
    const rule = await this.rule(ruleId);
    const startedAt = this.clock.now();

    if (!rule.enabled || rule.mode === 'MANUAL') {
      await this.record(ruleId, objectRef, startedAt, 'SKIPPED', 0, null, {
        ...options.payload,
        reason: rule.enabled ? 'Rule is manual' : 'Rule is switched off',
      });
      return null;
    }

    const began = performance.now();
    try {
      const result = await body();
      await this.record(
        ruleId,
        objectRef,
        startedAt,
        'OK',
        Math.round(performance.now() - began),
        null,
        options.payload ?? {},
      );
      return result;
    } catch (err) {
      await this.record(
        ruleId,
        objectRef,
        startedAt,
        'FAILED',
        Math.round(performance.now() - began),
        (err as Error).message,
        options.payload ?? {},
      );
      this.logger.error(`${ruleId} failed on ${objectRef}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Record a run the caller performed itself.
   *
   * For the cases where the work has to happen inside somebody else's
   * transaction — a PO raised inside the order transaction, for instance — so
   * the rule cannot wrap it. The run row is still written, because the log is
   * what makes the engine visible.
   */
  async note(
    ruleId: string,
    objectRef: string,
    status: 'OK' | 'FAILED' | 'SKIPPED',
    payload: Record<string, unknown> = {},
    error: string | null = null,
  ): Promise<void> {
    await this.record(ruleId, objectRef, this.clock.now(), status, null, error, payload);
  }

  async rules(): Promise<RuleRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        trigger_event: string;
        condition_note: string;
        action_note: string;
        failure_note: string;
        mode: 'AUTO' | 'SUGGEST' | 'MANUAL';
        enabled: boolean;
        updated_at: Date;
      }>
    >`
      SELECT id, name, trigger_event, condition_note, action_note, failure_note,
             mode, enabled, updated_at
        FROM platform.automation_rule ORDER BY id`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      triggerEvent: r.trigger_event,
      conditionNote: r.condition_note,
      actionNote: r.action_note,
      failureNote: r.failure_note,
      mode: r.mode,
      enabled: r.enabled,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Switch a rule off, or back on.
   *
   * Audited with the actor, because "who turned booking off at 2am" is the first
   * question asked the next morning — and being able to answer it is what makes
   * turning it off an acceptable thing to do at 2am.
   */
  async setEnabled(ruleId: string, enabled: boolean, actorUserId: string | null): Promise<RuleRow> {
    if (!actorUserId) {
      throw new ForbiddenError('Only a signed-in operator can change an automation rule.', {
        reason: 'no_principal',
      });
    }
    const rule = await this.rule(ruleId);
    await this.prisma.$executeRaw`
      UPDATE platform.automation_rule
         SET enabled = ${enabled}, updated_by = ${actorUserId}::uuid, updated_at = ${this.clock.now()}
       WHERE id = ${ruleId}`;
    await this.prisma.db.audit_log.create({
      data: {
        actor_user_id: actorUserId,
        action: 'platform.automation.rule_toggled',
        entity_type: 'automation_rule',
        entity_id: ruleId,
        before_json: { enabled: rule.enabled },
        after_json: { enabled },
        created_at: this.clock.now(),
      },
    });
    return { ...rule, enabled };
  }

  /** The run log, newest first. `status` narrows it to the failures. */
  async runs(filter: { ruleId?: string; status?: string; limit?: number } = {}): Promise<RunRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        rule_id: string;
        object_ref: string;
        started_at: Date;
        duration_ms: number | null;
        status: 'OK' | 'FAILED' | 'SKIPPED';
        error: string | null;
        payload: Record<string, unknown>;
      }>
    >`
      SELECT id, rule_id, object_ref, started_at, duration_ms, status, error, payload
        FROM platform.automation_run
       WHERE (${filter.ruleId ?? null}::text IS NULL OR rule_id = ${filter.ruleId ?? null})
         AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
       ORDER BY started_at DESC
       LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      ruleId: r.rule_id,
      objectRef: r.object_ref,
      startedAt: r.started_at,
      durationMs: r.duration_ms,
      status: r.status,
      error: r.error,
      payload: r.payload,
    }));
  }

  private async rule(ruleId: string): Promise<RuleRow> {
    const [row] = await this.rules().then((rules) => rules.filter((r) => r.id === ruleId));
    if (!row) throw new NotFoundError('automation_rule', { ruleId });
    return row;
  }

  private async record(
    ruleId: string,
    objectRef: string,
    startedAt: Date,
    status: 'OK' | 'FAILED' | 'SKIPPED',
    durationMs: number | null,
    error: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO platform.automation_run
        (rule_id, object_ref, started_at, duration_ms, status, error, payload)
      VALUES (${ruleId}, ${objectRef}, ${startedAt}, ${durationMs}, ${status}, ${error},
              ${JSON.stringify(payload)}::jsonb)`;
  }
}

@Global()
@Module({
  imports: [PrismaModule, ClockModule],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
