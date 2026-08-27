import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { AuditService } from '../../identity';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors/domain-errors';

/**
 * The onboarding engine.
 *
 * **One generic stepper, not two hard-coded flows** (PHASE_01 Task 2). The vendor
 * 7-step and buyer 5-step journeys differ only in their rows in
 * `kyc.onboarding_step_definition`, which means reordering a step, adding one, or
 * changing which constitutions need it is a data change rather than a release.
 *
 * Three design points that are easy to get wrong:
 *
 *   1. **`draft_json` holds partial form data and is cleared on COMPLETE.**
 *      Deliberately: we never write half-valid rows into `gst_profile`. A draft is
 *      a draft until it is promoted, and the promotion is the validation boundary.
 *
 *   2. **`is_required` derives from org_type AND constitution.** A proprietorship
 *      skips incorporation; an LLP does not. The source document asserts this
 *      derivation exists but never gives it, so it is a table here and it is tested.
 *
 *   3. **`blocking_reason` is shown to the applicant verbatim.** "Address proof is
 *      dated Jan 2025. We need one from the last 3 months." — never "Validation
 *      failed". A vague rejection is a support ticket; a specific one is a fix.
 */

export type StepStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'NEEDS_FIX' | 'COMPLETE';

export interface StepView {
  stepCode: string;
  stepOrder: number;
  title: string;
  /** The right-rail copy: why we are asking, and what happens next. */
  purposeNote: string | null;
  estimatedMinutes: number | null;
  isRequired: boolean;
  status: StepStatus;
  completionPct: number;
  /** Verbatim, from the reviewer. Empty unless the step is NEEDS_FIX. */
  blockingReason: string | null;
  lastSavedAt: Date | null;
  completedAt: Date | null;
  /** Fields this org must supply, after the constitution gate. */
  fields: FieldRequirement[];
}

/** A step as defined, before any org has answered it. */
export interface StepDefinitionView {
  stepCode: string;
  stepOrder: number;
  title: string;
  purposeNote: string | null;
  estimatedMinutes: number | null;
}

export interface FieldRequirement {
  fieldCode: string;
  label: string;
  required: boolean;
  helpText: string | null;
}

export interface ProgressView {
  orgId: string;
  orgType: string;
  constitution: string | null;
  steps: StepView[];
  /** Where "resume" should land. The first step that is not COMPLETE. */
  resumeAt: string | null;
  completedSteps: number;
  requiredSteps: number;
  isSubmittable: boolean;
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly audit: AuditService,
  ) {}

  /**
   * Materialise the step rows for an org, from the definitions.
   *
   * Idempotent: called on org creation and again whenever the constitution
   * changes, because changing from PROPRIETORSHIP to PRIVATE_LIMITED genuinely
   * changes which steps apply.
   */
  async initialiseSteps(orgId: string): Promise<void> {
    const org = await this.prisma.db.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundError('organisation');

    const definitions = await this.prisma.db.onboarding_step_definition.findMany({
      where: { org_type: org.org_type, is_active: true },
      orderBy: { step_order: 'asc' },
    });

    for (const def of definitions) {
      const required =
        this.stepApplies(def.applies_to_constitutions, org.constitution) && def.is_required;

      await this.prisma.$executeRaw`
        INSERT INTO kyc.onboarding_progress (org_id, step_code, step_order, is_required, status)
        VALUES (${orgId}::uuid, ${def.step_code}, ${def.step_order}, ${required}, 'NOT_STARTED')
        ON CONFLICT (org_id, step_code)
        DO UPDATE SET step_order = EXCLUDED.step_order, is_required = EXCLUDED.is_required`;
    }
  }

  /**
   * The constitution gate, as one function so it is testable in isolation.
   * NULL applies-to means "every constitution"; an org with no constitution yet
   * gets the step, because we cannot rule it out.
   */
  private stepApplies(appliesTo: string[] | null, constitution: string | null): boolean {
    if (!appliesTo || appliesTo.length === 0) return true;
    if (!constitution) return true;
    return appliesTo.includes(constitution);
  }

  /**
   * The step definitions for an org type, with nothing org-specific in them.
   *
   * `getProgress` cannot serve the first screen of registration: it needs an
   * org, and at that moment there is not one. Without this the client would
   * have to hold its own copy of the five step titles, which is a list that
   * goes stale the first time a definition row is edited — and editing a row
   * instead of shipping a release is the entire point of the generic stepper.
   *
   * Safe to serve anonymously: a title, a purpose note and a duration are the
   * same for every applicant, and they are already printed on the form.
   */
  async listDefinitions(orgType: 'VENDOR' | 'BUYER'): Promise<StepDefinitionView[]> {
    const definitions = await this.prisma.db.onboarding_step_definition.findMany({
      where: { org_type: orgType, is_active: true },
      orderBy: { step_order: 'asc' },
    });

    return definitions.map((def) => ({
      stepCode: def.step_code,
      stepOrder: def.step_order,
      title: def.title,
      purposeNote: def.purpose_note,
      estimatedMinutes: def.estimated_minutes,
    }));
  }

  async getProgress(orgId: string): Promise<ProgressView> {
    const org = await this.prisma.db.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundError('organisation');

    const [definitions, progress, fieldRules] = await Promise.all([
      this.prisma.db.onboarding_step_definition.findMany({
        where: { org_type: org.org_type, is_active: true },
        orderBy: { step_order: 'asc' },
      }),
      this.prisma.db.onboarding_progress.findMany({ where: { org_id: orgId } }),
      this.prisma.db.onboarding_field_requirement.findMany({ where: { org_type: org.org_type } }),
    ]);

    const byCode = new Map(progress.map((p) => [p.step_code, p]));

    const steps: StepView[] = definitions.map((def) => {
      const p = byCode.get(def.step_code);
      return {
        stepCode: def.step_code,
        stepOrder: def.step_order,
        title: def.title,
        purposeNote: def.purpose_note,
        estimatedMinutes: def.estimated_minutes,
        isRequired:
          p?.is_required ??
          (def.is_required && this.stepApplies(def.applies_to_constitutions, org.constitution)),
        status: (p?.status ?? 'NOT_STARTED') as StepStatus,
        completionPct: p?.completion_pct ?? 0,
        blockingReason: p?.blocking_reason ?? null,
        lastSavedAt: p?.last_saved_at ?? null,
        completedAt: p?.completed_at ?? null,
        fields: this.fieldsFor(fieldRules, def.step_code, org.constitution),
      };
    });

    const required = steps.filter((s) => s.isRequired);
    const completed = required.filter((s) => s.status === 'COMPLETE');

    return {
      orgId,
      orgType: org.org_type,
      constitution: org.constitution,
      steps,
      // Resume at the first step that still needs work — including one sent back
      // as NEEDS_FIX, which is the whole point of the state.
      resumeAt: steps.find((s) => s.isRequired && s.status !== 'COMPLETE')?.stepCode ?? null,
      completedSteps: completed.length,
      requiredSteps: required.length,
      isSubmittable: completed.length === required.length && required.length > 0,
    };
  }

  /**
   * Which fields this org must supply on this step.
   *
   * `forbidden_for_constitutions` matters as much as `required_for`: a
   * proprietorship should not merely have CIN optional, it should never be asked
   * for one. An optional field a person cannot possibly have is a field they will
   * try to fill in.
   */
  private fieldsFor(
    rules: Array<{
      step_code: string;
      field_code: string;
      label: string;
      required_for_constitutions: string[] | null;
      forbidden_for_constitutions: string[] | null;
      help_text: string | null;
    }>,
    stepCode: string,
    constitution: string | null,
  ): FieldRequirement[] {
    return rules
      .filter((r) => r.step_code === stepCode)
      .filter((r) => !(constitution && r.forbidden_for_constitutions?.includes(constitution)))
      .map((r) => ({
        fieldCode: r.field_code,
        label: r.label,
        required:
          !r.required_for_constitutions ||
          (constitution !== null && r.required_for_constitutions.includes(constitution)),
        helpText: r.help_text,
      }));
  }

  /**
   * Save a partial step. This is "save and finish later" — it validates nothing
   * beyond shape, because a half-filled form is the normal state of a form.
   */
  async saveDraft(
    orgId: string,
    stepCode: string,
    draft: Record<string, unknown>,
    completionPct: number,
  ): Promise<void> {
    const existing = await this.prisma.db.onboarding_progress.findFirst({
      where: { org_id: orgId, step_code: stepCode },
    });
    if (!existing) throw new NotFoundError('onboarding step');
    if (existing.status === 'COMPLETE') {
      throw new ConflictError(
        'This step is already complete. Use the change-request flow to alter a verified detail.',
      );
    }

    const now = this.clock.now();
    await this.prisma.db.onboarding_progress.update({
      where: { id: existing.id },
      data: {
        draft_json: draft as object,
        completion_pct: Math.max(0, Math.min(100, Math.round(completionPct))),
        status: existing.status === 'NEEDS_FIX' ? 'IN_PROGRESS' : 'IN_PROGRESS',
        first_started_at: existing.first_started_at ?? now,
        last_saved_at: now,
        // Answering the reviewer clears their note; leaving it would make the
        // applicant think the fix did not register.
        blocking_reason: null,
      },
    });
  }

  async getDraft(orgId: string, stepCode: string): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.db.onboarding_progress.findFirst({
      where: { org_id: orgId, step_code: stepCode },
    });
    return (row?.draft_json as Record<string, unknown> | null) ?? null;
  }

  /**
   * Promote a step to COMPLETE.
   *
   * `promote` does the real writes — into `gst_profile`, `vendor_capability`,
   * whatever the step owns — inside the same transaction that marks the step
   * done. If the promotion throws, the step stays IN_PROGRESS and the draft is
   * intact, which is the behaviour a person hitting Submit expects when something
   * is wrong.
   */
  async completeStep(
    orgId: string,
    stepCode: string,
    promote: (draft: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const existing = await this.prisma.db.onboarding_progress.findFirst({
      where: { org_id: orgId, step_code: stepCode },
    });
    if (!existing) throw new NotFoundError('onboarding step');

    const draft = (existing.draft_json as Record<string, unknown> | null) ?? {};
    const now = this.clock.now();

    await this.prisma.runInTransaction(async () => {
      await promote(draft);

      await this.prisma.db.onboarding_progress.update({
        where: { id: existing.id },
        data: {
          status: 'COMPLETE',
          completion_pct: 100,
          completed_at: now,
          last_saved_at: now,
          blocking_reason: null,
          // Cleared on COMPLETE: the real tables are now the source of truth, and
          // a stale draft is a second copy of the answer that can disagree.
          draft_json: undefined,
        },
      });
    });

    await this.prisma.$executeRaw`
      UPDATE kyc.onboarding_progress SET draft_json = NULL
      WHERE org_id = ${orgId}::uuid AND step_code = ${stepCode}`;

    await this.audit.record({
      action: 'kyc.onboarding.step_completed',
      entityType: 'onboarding_progress',
      entityId: existing.id,
      after: { stepCode, orgId },
      actorOrgId: orgId,
    });
  }

  /**
   * Send a step back with a reason the applicant reads verbatim.
   *
   * The reason is required and length-checked precisely because the failure mode
   * is a reviewer typing "rejected" and a person having no idea what to change.
   */
  async requestFix(
    orgId: string,
    stepCode: string,
    blockingReason: string,
    reviewerId: string,
  ): Promise<void> {
    if (blockingReason.trim().length < 15) {
      throw new ValidationError(
        'Tell the applicant specifically what to fix — at least a sentence. They see this exactly as you write it.',
        { blockingReason: 'Please give a specific, actionable reason.' },
      );
    }

    const existing = await this.prisma.db.onboarding_progress.findFirst({
      where: { org_id: orgId, step_code: stepCode },
    });
    if (!existing) throw new NotFoundError('onboarding step');

    await this.prisma.db.onboarding_progress.update({
      where: { id: existing.id },
      data: { status: 'NEEDS_FIX', blocking_reason: blockingReason.trim(), completed_at: null },
    });

    await this.audit.record({
      action: 'kyc.onboarding.fix_requested',
      entityType: 'onboarding_progress',
      entityId: existing.id,
      after: { stepCode, blockingReason },
      actorUserId: reviewerId,
      actorOrgId: orgId,
    });
  }

  /**
   * Admin/report view: how far a cohort gets, and where they stop.
   *
   * Takes org ids rather than an org type on purpose. Filtering by type would
   * mean joining `identity.organization`, which is another module's table — the
   * caller asks `identity` for the cohort and passes it in, which is the seam
   * working as designed rather than a JOIN that quietly couples two schemas.
   *
   * ponytail: fine at pilot scale (hundreds of orgs). If the cohort ever gets
   * large enough that the id list is the problem, the answer is a read model
   * refreshed on `vendor.verified`, not a cross-schema join.
   */
  async funnel(
    orgIds: readonly string[],
  ): Promise<Array<{ stepCode: string; reached: number; completed: number }>> {
    if (orgIds.length === 0) return [];
    return this.prisma.$queryRaw<Array<{ stepCode: string; reached: number; completed: number }>>`
      SELECT step_code AS "stepCode",
             COUNT(*) FILTER (WHERE status <> 'NOT_STARTED')::int AS reached,
             COUNT(*) FILTER (WHERE status = 'COMPLETE')::int AS completed
      FROM kyc.onboarding_progress
      WHERE org_id = ANY(${orgIds}::uuid[])
      GROUP BY step_code, step_order
      ORDER BY step_order`;
  }
}
