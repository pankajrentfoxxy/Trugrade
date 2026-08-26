import { Injectable } from '@nestjs/common';
import { SEAL_CODE, SEAL_CODE_PREFIX_DEFAULT } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { EventBus } from '../../../shared/events';
import {
  IllegalStateTransitionError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { QcRepository, type QcSealRow } from './qc.repository';
import { fileKeySchema, type SealStatus } from '../dto/qc.dto';

/**
 * The tamper seal, and the photograph that makes it mean anything.
 *
 * The seal exists because of a gap in the model that nothing else closes: the
 * machine stays at the vendor's warehouse between the twelve-minute inspection
 * and the sale, sometimes for weeks. Without a seal, "inspected on 12 August" is
 * a claim about a laptop nobody has looked at since. With one, it is a claim
 * about *this* laptop, checkable at the door by someone with no account and no
 * training: the code on the sticker matches the code on the invoice, and the
 * sticker is not broken.
 *
 * **There is no seal without a photograph.** `applied_photo_key` is NOT NULL in
 * the schema, `SealApplication.appliedPhotoKey` is a required `string` here, and
 * `applySeal` is the only write path to `qc.qc_seal` in this service. Those three
 * together are what "structurally impossible" means: not a validation somebody
 * can be talked into skipping on a bad day in a warehouse, but no code path that
 * produces an unphotographed seal at all. The photograph is the evidence that the
 * seal was on *this* machine rather than in the technician's bag.
 *
 * Seal codes are **not generated here.** They are printed on physical rolls with
 * a two-to-three week lead time, the technician scans one off the sticker, and
 * this service validates the shape (VR-100) and the prefix from
 * `qc.seal_code_prefix` before recording it. A generator would invent codes that
 * do not exist on any roll — and `seal_code` being UNIQUE means the first
 * collision with a real roll is a hard failure at a vendor site.
 *
 * Lifecycle: APPLIED → INTACT | BROKEN | MISSING | REPLACED. BROKEN is terminal
 * and MISSING is as serious: both take the unit off the storefront immediately,
 * because `listing.unit_is_sellable()` requires a seal in APPLIED or INTACT and
 * neither survives. A broken seal is not a paperwork problem — it is a machine
 * whose contents nobody can vouch for, and it goes back through QC.
 */

/** `qc.seal_code_prefix`. Physical rolls are printed against it. */
const SEAL_PREFIX_KEY = 'qc.seal_code_prefix';

/**
 * VR-103, minus VOID.
 *
 * `SEAL_TRANSITIONS` in `@trugrade/contracts` lists a VOID state that
 * `public.seal_status` does not have; writing it fails as an enum cast, which
 * surfaces as a driver error rather than a domain one. So the legal moves are
 * restated here against the five values the database actually holds. When the
 * enum gains VOID — the 15-minute misapplication window in
 * `SEAL_VOID_WINDOW_MINUTES` is presumably what it is for — this map goes back
 * to importing the contract.
 */
const SEAL_TRANSITIONS: Readonly<Record<SealStatus, readonly SealStatus[]>> = Object.freeze({
  APPLIED: ['INTACT', 'BROKEN', 'MISSING', 'REPLACED'],
  INTACT: ['BROKEN', 'MISSING', 'REPLACED'],
  BROKEN: [],
  MISSING: ['REPLACED'],
  REPLACED: [],
});

/** The verdicts a unit may be sealed on. A failed machine is never sealed. */
const SEALABLE_VERDICTS = ['PASS', 'PASS_WITH_NOTE'];

export interface SealApplication {
  unitId: string;
  qcReportId: string;
  /** As scanned off the physical sticker. */
  sealCode: string;
  /** A `qc.qc_technician.id` — the inspecting identity, not a login. */
  appliedBy: string;
  /** Required, here and in the schema. The seal on the machine, photographed. */
  appliedPhotoKey: string;
}

export interface SealReplacement extends SealApplication {
  /** The seal being replaced. */
  supersedesSealCode: string;
  reason: string;
}

export type BreakDetectedBy = 'PICKUP' | 'DELIVERY' | 'AUDIT';

@Injectable()
export class SealingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly repo: QcRepository,
    private readonly bus: EventBus,
  ) {}

  /**
   * Apply a seal to a passed unit and record the photograph of it in place.
   *
   * The unit moves QC_PASSED → QC_SEALED. It does **not** become sellable here:
   * `listing.unit_is_sellable()` also wants status LISTED, which happens when the
   * visit closes and the vendor has signed off on what was found. Sealing is the
   * physical act; listing is the commercial one, and keeping them apart is what
   * makes "sealed but not yet listed" a state that can exist for the hours
   * between the last machine and the vendor's signature.
   */
  async applySeal(input: SealApplication): Promise<QcSealRow> {
    const sealCode = await this.validateSealCode(input.sealCode);
    const photoKey = this.requirePhotograph(input.appliedPhotoKey);

    const report = await this.repo.findReportById(input.qcReportId);
    if (!report) throw new NotFoundError('inspection report', { qcReportId: input.qcReportId });
    if (report.unitId !== input.unitId) {
      // Sealing unit B against unit A's report is how a failed machine acquires
      // a passing certificate. The FK cannot catch it: both ids are valid.
      throw new ValidationError('That inspection report belongs to a different machine.', {
        qcReportId: 'This report is not for this unit.',
      });
    }
    if (!report.isCurrent) {
      throw new PreconditionFailedError(
        'That inspection has been superseded by a later one. Seal against the current report.',
        { qcReportId: report.id, reason: 'report_superseded' },
      );
    }
    if (!report.verdict || !SEALABLE_VERDICTS.includes(report.verdict)) {
      // Rule 1 of this phase: a failed unit is absent from the storefront. The
      // cheapest place to enforce it is here, because a seal is what a later
      // check reads as "this machine was signed off".
      throw new PreconditionFailedError(
        `A ${report.verdict ?? 'not yet decided'} inspection cannot be sealed. Only a passed machine gets a seal.`,
        { qcReportId: report.id, verdict: report.verdict, reason: 'not_a_pass' },
      );
    }

    const existing = await this.repo.findSealsByUnit(input.unitId);
    const live = existing.find((s) => s.status === 'APPLIED' || s.status === 'INTACT');
    if (live) {
      throw new PreconditionFailedError(
        `This machine already carries seal ${live.sealCode}. Replace it rather than adding a second.`,
        { unitId: input.unitId, sealCode: live.sealCode, reason: 'seal_already_applied' },
      );
    }

    return this.prisma.runInTransaction(async () => {
      const seal = await this.repo.applySeal({
        sealCode,
        unitId: input.unitId,
        qcReportId: input.qcReportId,
        appliedBy: input.appliedBy,
        appliedPhotoKey: photoKey,
      });
      await this.pointUnitAtSeal(input.unitId, seal.id, 'QC_SEALED');
      return seal;
    });
  }

  /**
   * The check at the door: scan the code, look at the sticker, confirm intact.
   *
   * `verified_by` is an `identity.user_account.id` and not a technician id, on
   * purpose — whoever is at the door is a driver or a hub operator, not the
   * person who inspected the machine three weeks ago. Two columns, two tables,
   * and conflating them would make the divergence dashboard measure nobody.
   */
  async verifyIntact(input: {
    sealCode: string;
    verifiedBy: string;
    verifiedPhotoKey?: string;
  }): Promise<QcSealRow> {
    const seal = await this.mustFind(input.sealCode);
    this.assertTransition(seal, 'INTACT');

    const updated = await this.repo.updateSealStatus(seal.sealCode, {
      status: 'INTACT',
      verifiedAt: this.clock.now(),
      verifiedBy: input.verifiedBy,
      verifiedPhotoKey: input.verifiedPhotoKey ?? null,
    });
    return updated!;
  }

  /**
   * A seal found broken. The unit stops here.
   *
   * Three things happen together, in one transaction, because any two of them
   * without the third is worse than none: the seal is recorded BROKEN, the unit
   * goes to SEAL_BROKEN (which drops `is_sellable` through the trigger and takes
   * it off the storefront on the spot), and `qc.seal.broken` goes on the outbox
   * for logistics to route it back through QC.
   *
   * BROKEN is terminal. Re-inspection produces a *new* seal chained through
   * `replaced_by_seal_id`; it never revives this one, because the history of a
   * broken seal is the reason anybody trusts an intact one.
   */
  async reportBroken(input: {
    sealCode: string;
    reason: string;
    detectedBy: BreakDetectedBy;
  }): Promise<QcSealRow> {
    return this.markCompromised(input.sealCode, 'BROKEN', input.reason, input.detectedBy);
  }

  /**
   * A seal that is not there at all.
   *
   * Treated exactly as a broken one. A missing seal is not a lesser finding — it
   * is the same claim ("nobody can vouch for what is inside this machine") with
   * less evidence about how it happened, and a model that treats it as milder is
   * a model that rewards removing the sticker cleanly.
   */
  async reportMissing(input: {
    sealCode: string;
    reason: string;
    detectedBy: BreakDetectedBy;
  }): Promise<QcSealRow> {
    return this.markCompromised(input.sealCode, 'MISSING', input.reason, input.detectedBy);
  }

  /**
   * Replace a seal, chaining the old one to the new through `replaced_by_seal_id`.
   *
   * Both rows survive. The chain is what answers "this machine is on its third
   * seal" — which is a question worth being able to ask about a vendor, and one
   * that an UPDATE of the seal code in place destroys.
   *
   * The replacement needs its own photograph. The same rule, for the same
   * reason: an unphotographed replacement is an unphotographed seal.
   */
  async replaceSeal(input: SealReplacement): Promise<{ replaced: QcSealRow; applied: QcSealRow }> {
    const old = await this.mustFind(input.supersedesSealCode);
    this.assertTransition(old, 'REPLACED');
    if (old.unitId !== input.unitId) {
      throw new ValidationError('That seal is on a different machine.', {
        supersedesSealCode: 'This seal does not belong to this unit.',
      });
    }
    const reason = requireReason(input.reason);
    const sealCode = await this.validateSealCode(input.sealCode);
    const photoKey = this.requirePhotograph(input.appliedPhotoKey);

    return this.prisma.runInTransaction(async () => {
      // The new seal first: `replaced_by_seal_id` on the old row needs an id
      // that exists, and the FK is not deferrable.
      const applied = await this.repo.applySeal({
        sealCode,
        unitId: input.unitId,
        qcReportId: input.qcReportId,
        appliedBy: input.appliedBy,
        appliedPhotoKey: photoKey,
      });
      const replaced = await this.repo.updateSealStatus(old.sealCode, {
        status: 'REPLACED',
        brokenAt: this.clock.now(),
        brokenReason: reason,
        replacedBySealId: applied.id,
      });
      await this.pointUnitAtSeal(input.unitId, applied.id, 'QC_SEALED');
      return { replaced: replaced!, applied };
    });
  }

  /** The seal currently on a machine, or null. Newest first, so `[0]` is it. */
  async currentSeal(unitId: string): Promise<QcSealRow | null> {
    const seals = await this.repo.findSealsByUnit(unitId);
    return seals.find((s) => s.status === 'APPLIED' || s.status === 'INTACT') ?? null;
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private async markCompromised(
    sealCode: string,
    status: 'BROKEN' | 'MISSING',
    reason: string,
    detectedBy: BreakDetectedBy,
  ): Promise<QcSealRow> {
    const seal = await this.mustFind(sealCode);
    this.assertTransition(seal, status);
    const written = requireReason(reason);
    const at = this.clock.now();

    return this.prisma.runInTransaction(async () => {
      const updated = await this.repo.updateSealStatus(seal.sealCode, {
        status,
        brokenAt: at,
        brokenReason: written,
      });
      await this.setUnitStatus(seal.unitId, 'SEAL_BROKEN');
      // One event for both outcomes. `qc.seal.broken` is the name logistics
      // already subscribes to for "this unit does not ship"; a second name for
      // MISSING would be a topic with one subscriber that forgets it exists.
      await this.bus.publish('qc.seal.broken', {
        unitId: seal.unitId,
        sealCode: seal.sealCode,
        detectedAt: at.toISOString(),
        detectedBy,
      });
      return updated!;
    });
  }

  private async mustFind(sealCode: string): Promise<QcSealRow> {
    const seal = await this.repo.findSealByCode(sealCode.trim().toUpperCase());
    if (!seal) throw new NotFoundError('seal', { sealCode });
    return seal;
  }

  private assertTransition(seal: QcSealRow, to: SealStatus): void {
    if (!SEAL_TRANSITIONS[seal.status].includes(to)) {
      throw new IllegalStateTransitionError('qc_seal', seal.status, to);
    }
  }

  /**
   * The shape (VR-100) and the prefix currently being printed.
   *
   * The prefix comes from `qc.seal_code_prefix` rather than the constant,
   * because the rolls in a technician's bag were printed against whatever the
   * config said on the day they were ordered. `SEAL_CODE_PREFIX_DEFAULT` is the
   * fallback for a database that has not been seeded, not the authority.
   */
  private async validateSealCode(raw: string): Promise<string> {
    const code = raw.trim().toUpperCase();
    if (!SEAL_CODE.pattern!.test(code)) {
      throw new ValidationError(SEAL_CODE.message, { sealCode: SEAL_CODE.message });
    }
    const prefix = await this.sealPrefix();
    if (!code.startsWith(`${prefix}-`)) {
      throw new ValidationError(
        `That seal is not from one of our rolls — ours start ${prefix}-. Check the sticker.`,
        { sealCode: `Expected a code beginning ${prefix}-.` },
      );
    }
    return code;
  }

  /**
   * The photograph key. Required, non-empty, and checked before anything is
   * written — so a caller that forgot it fails before a seal row exists rather
   * than after.
   */
  private requirePhotograph(key: string): string {
    const parsed = fileKeySchema.safeParse(key?.trim());
    if (!parsed.success) {
      throw new ValidationError(
        'Photograph the seal on the machine before confirming — a seal with no photograph is not a seal.',
        { appliedPhotoKey: 'Upload the seal photograph first.' },
      );
    }
    return parsed.data;
  }

  /**
   * Point the unit at its seal and move its status.
   *
   * Two columns and a status in one statement, because `trg_recompute_sellable`
   * fires on exactly these and splitting them would recompute sellability
   * against a half-written row. `listing.unit` is another module's table, read
   * and written directly for the same reason `listing.submit` reaches into
   * `vendor.vendor_facility` — one single-schema statement rather than a port
   * for a single pointer. It is a boundary crossing taken deliberately, not one
   * nobody noticed.
   */
  private async pointUnitAtSeal(unitId: string, sealId: string, status: string): Promise<void> {
    const affected = await this.prisma.$executeRaw`
      UPDATE listing.unit
         SET seal_id   = ${sealId}::uuid,
             sealed_at = ${this.clock.now()},
             status    = ${status}::public.unit_status
       WHERE id = ${unitId}::uuid
         AND status IN ('QC_PASSED', 'QC_SEALED', 'SEAL_BROKEN')`;
    if (affected === 0) {
      // The unit is not in a state a seal belongs on. Refusing loudly beats
      // writing a seal row that points at a machine still under inspection.
      throw new PreconditionFailedError(
        'This machine has not passed inspection yet, so it cannot be sealed.',
        { unitId, reason: 'unit_not_sealable' },
      );
    }
  }

  private async setUnitStatus(unitId: string, status: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE listing.unit SET status = ${status}::public.unit_status WHERE id = ${unitId}::uuid`;
  }

  private async sealPrefix(): Promise<string> {
    const [row] = await this.prisma.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = ${SEAL_PREFIX_KEY}`;
    const v = row?.value_json;
    return typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : SEAL_CODE_PREFIX_DEFAULT;
  }
}

/** The `reason` columns have `CHECK (length(btrim(reason)) >= 3)` behind them. */
function requireReason(reason: string): string {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < 3) {
    throw new ValidationError(
      'Say what happened, in a few words at least — this goes on the record.',
      {
        reason: 'Give a reason of at least 3 characters.',
      },
    );
  }
  return trimmed;
}
