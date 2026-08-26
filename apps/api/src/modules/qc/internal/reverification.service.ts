import { Injectable, Logger } from '@nestjs/common';
import { normaliseSerial } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { EventBus } from '../../../shared/events/event-bus';
import { NotFoundError } from '../../../shared/errors/domain-errors';
import { QcRepository, type QcReverificationRow } from './qc.repository';
import type { ReverificationOutcome, ReverificationTrigger } from '../dto/qc.dto';

/**
 * The two minutes at the door.
 *
 * The machine stays at the vendor's premises between inspection and sale, which
 * is the whole reason the tamper seal exists: an inspection three weeks old is
 * only a claim about *this* laptop if the seal on it is the one the technician
 * photographed and the serial under it is the one on the manifest. This service
 * turns those two facts into a ship / do-not-ship answer and records it as
 * evidence either way.
 *
 * It deliberately does **not** move the unit's status. Phase 8 owns dispatch: it
 * asks for the outcome and decides whether the driver loads the machine. A QC
 * service reaching into `listing.unit` on a pickup scan would give that decision
 * two authors, and the one at the door would win by accident. What this service
 * does own is the seal record and the `qc.seal.broken` event — those are QC's,
 * and everything downstream keys off them.
 *
 * The three failures are kept apart on purpose, because they mean different
 * things to whoever is standing there:
 *
 *   - a **broken or missing seal** is a unit that must go back through QC
 *     (`FAIL_RESEND_TO_QC`) — it may still be a good machine;
 *   - a **serial that does not match** is `FAIL_REJECT`. The label does not
 *     belong to the laptop. That is not a QC run to repeat, it is a different
 *     machine, and QC-012 says do not grade it, do not seal it, do not list it;
 *   - **no current report or no seal at all** is `ESCALATE`, because a driver
 *     cannot tell a records failure from a swapped unit and should not have to.
 */

export interface PickupCheckInput {
  unitId: string;
  /** What was read off the sticker. */
  sealCodeScanned: string;
  /** What was read off the machine. Normalised before comparison (VR-076). */
  serialScanned: string;
  /** An `identity.user_account.id` — the driver or hub operator, not a technician. */
  performedBy?: string | null;
  /** Photographs taken at the door. The seal photograph, if any, is the first. */
  photoKeys?: string[];
  notes?: string | null;
  /** DISPATCH_PICKUP unless an audit or a dispute is what brought us here. */
  trigger?: ReverificationTrigger;
}

export interface PickupCheck {
  outcome: ReverificationOutcome;
  sealIntact: boolean;
  serialMatches: boolean;
  /** True when the report expired while the machine sat on the shelf. */
  qcExpired: boolean;
  /** Plain enough to read off a phone screen at a warehouse door. */
  message: string;
  reverification: QcReverificationRow | null;
}

interface UnitIdentity {
  id: string;
  serialNumber: string;
}

interface Verdict {
  outcome: ReverificationOutcome;
  sealIntact: boolean;
  serialMatches: boolean;
  qcExpired: boolean;
  message: string;
  scannedCode: string;
  scannedSerial: string | null;
}

@Injectable()
export class ReverificationService {
  private readonly logger = new Logger(ReverificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QcRepository,
    private readonly clock: ClockPort,
    private readonly bus: EventBus,
  ) {}

  async verifyAtPickup(input: PickupCheckInput): Promise<PickupCheck> {
    const unit = await this.unit(input.unitId);
    if (!unit) throw new NotFoundError('unit', { unitId: input.unitId });

    const report = await this.repo.findCurrentReportByUnit(input.unitId);
    // Newest first, so [0] is the seal actually on the machine. A replaced seal
    // leaves its old row behind — that chain is the evidence, not clutter.
    const seal = (await this.repo.findSealsByUnit(input.unitId))[0] ?? null;

    const scannedCode = input.sealCodeScanned.trim().toUpperCase();
    const scannedSerial = normaliseSerial(input.serialScanned);

    const sealIntact =
      seal !== null && seal.sealCode === scannedCode && ['APPLIED', 'INTACT'].includes(seal.status);
    const serialMatches = scannedSerial !== null && scannedSerial === unit.serialNumber;
    // `valid_until` is the last day the report is a claim we stand behind, so the
    // comparison is inclusive and reckoned on the IST calendar (VR-160). Both
    // sides are `YYYY-MM-DD`, which sorts lexically exactly as it sorts by date.
    const qcExpired = report?.validUntil ? report.validUntil < this.clock.todayInIst() : false;

    if (!report || !seal) {
      return this.record(input, unit, report?.id ?? null, {
        outcome: 'ESCALATE',
        sealIntact: false,
        serialMatches,
        qcExpired,
        message: report
          ? 'This machine has no seal on file. Do not load it — raise it with the QC manager.'
          : 'This machine has no current inspection on file. Do not load it — raise it with the QC manager.',
        scannedCode,
        scannedSerial,
      });
    }

    // Order matters. A serial mismatch outranks everything else because it says
    // the object in front of you is not the object we inspected, and no amount
    // of intact sealing makes that shippable.
    if (!serialMatches) {
      return this.record(input, unit, report.id, {
        outcome: 'FAIL_REJECT',
        sealIntact,
        serialMatches: false,
        qcExpired,
        message: `The serial on this machine (${scannedSerial ?? '-'}) is not the one we inspected. Do not load it.`,
        scannedCode,
        scannedSerial,
      });
    }

    if (!sealIntact) {
      await this.markSealBroken(seal.sealCode, scannedCode, input.performedBy ?? null);
      return this.record(input, unit, report.id, {
        outcome: 'FAIL_RESEND_TO_QC',
        sealIntact: false,
        serialMatches: true,
        qcExpired,
        message:
          seal.sealCode === scannedCode
            ? `Seal ${seal.sealCode} is ${seal.status.toLowerCase()}. This machine goes back through QC before it ships.`
            : `Seal ${scannedCode} is not the seal we applied (${seal.sealCode}). This machine goes back through QC.`,
        scannedCode,
        scannedSerial,
      });
    }

    if (qcExpired) {
      return this.record(input, unit, report.id, {
        outcome: 'FAIL_RESEND_TO_QC',
        sealIntact: true,
        serialMatches: true,
        qcExpired: true,
        message: `The inspection on this machine expired on ${report.validUntil}. It needs re-inspecting before it ships.`,
        scannedCode,
        scannedSerial,
      });
    }

    // Only now is the seal marked verified, and by a user account rather than a
    // technician id: whoever is at the door is logistics staff, which is why
    // `verified_by` points at `identity.user_account` and `applied_by` does not.
    await this.repo.updateSealStatus(seal.sealCode, {
      status: 'INTACT',
      verifiedAt: this.clock.now(),
      verifiedBy: input.performedBy ?? null,
      verifiedPhotoKey: input.photoKeys?.[0] ?? null,
    });

    return this.record(input, unit, report.id, {
      outcome: 'PASS',
      sealIntact: true,
      serialMatches: true,
      qcExpired: false,
      message: `Seal ${seal.sealCode} intact, serial matches. Cleared for pickup.`,
      scannedCode,
      scannedSerial,
    });
  }

  /** Every re-verification a unit has been through, newest first. */
  history(unitId: string): Promise<QcReverificationRow[]> {
    return this.repo.findReverifications(unitId);
  }

  // -------------------------------------------------------------------------

  /**
   * A seal that is not the one we applied is as broken as one that is torn: in
   * both cases the chain of custody between inspection and door is unproven.
   * `qc.seal.broken` is what Phase 8's routing rule (priority 10) listens for,
   * so it is published for both.
   */
  private async markSealBroken(
    appliedCode: string,
    scannedCode: string,
    performedBy: string | null,
  ): Promise<void> {
    const reason =
      appliedCode === scannedCode
        ? 'Found broken at pickup.'
        : `A different seal (${scannedCode}) was found on the machine at pickup.`;

    const updated = await this.repo.updateSealStatus(appliedCode, {
      status: 'BROKEN',
      brokenAt: this.clock.now(),
      brokenReason: reason,
    });
    if (!updated) return;

    await this.bus.publish('qc.seal.broken', {
      unitId: updated.unitId,
      sealCode: appliedCode,
      detectedAt: this.clock.nowIso(),
      detectedBy: 'PICKUP',
    });
    this.logger.warn(
      `Seal ${appliedCode} broken at pickup by ${performedBy ?? 'unknown'}: ${reason}`,
    );
  }

  private async record(
    input: PickupCheckInput,
    unit: UnitIdentity,
    reportId: string | null,
    verdict: Verdict,
  ): Promise<PickupCheck> {
    const { scannedCode, scannedSerial, ...answer } = verdict;

    // `qc_reverification.original_report_id` is NOT NULL, so the ESCALATE case
    // with no report on file has nowhere to be written. The driver still needs
    // the answer, so it comes back with a null row and a loud log rather than a
    // 500 at a warehouse door — the missing report is the incident, and an
    // exception here would only bury it under a stack trace.
    if (!reportId) {
      this.logger.error(
        `Re-verification of unit ${unit.id} (${unit.serialNumber}) has no current QC report to attach to. Nothing recorded.`,
      );
      return { ...answer, reverification: null };
    }

    const row = await this.repo.insertReverification({
      unitId: unit.id,
      originalReportId: reportId,
      trigger: input.trigger ?? 'DISPATCH_PICKUP',
      method: 'SEAL_CHECK',
      outcome: answer.outcome,
      performedBy: input.performedBy ?? null,
      sealCodeScanned: scannedCode,
      sealIntact: answer.sealIntact,
      serialScanned: scannedSerial,
      serialMatches: answer.serialMatches,
      photoKeys: input.photoKeys ?? [],
      notes: input.notes ?? answer.message,
    });

    return { ...answer, reverification: row };
  }

  /**
   * The manifest serial, from `listing.unit`.
   *
   * A separate statement rather than a join: `qc_seal` and `qc_report` live in
   * the `qc` schema and `unit` lives in `listing`, and joining the two welds the
   * modules together somewhere no type system would ever show us
   * (`no-cross-schema-join`). Two reads and a comparison in TypeScript is the
   * price of a seam that survives the modules being pulled apart.
   */
  private async unit(unitId: string): Promise<UnitIdentity | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
      SELECT id, serial_number FROM listing.unit WHERE id = ${unitId}::uuid`;
    return rows[0] ? { id: rows[0].id, serialNumber: rows[0].serial_number } : null;
  }
}
