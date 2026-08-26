import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  assessCertificate,
  normaliseSerial,
  type CertificateDefect,
  type DeviceSureCertificate,
} from '@trugrade/contracts';
import { AppConfig } from '../../../shared/config';
import { ClockPort } from '../../../shared/clock';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ObjectStorePort } from '../../../shared/adapters/ports';
import { PreconditionFailedError, ValidationError } from '../../../shared/errors/domain-errors';
import { SMART_STATUSES, uuidSchema, type ParseStatus, type SmartStatus } from '../dto/qc.dto';
import { QcRepository, type HardwareInput, type QcToolProviderRow } from './qc.repository';
import { DeviceSureClient } from './devicesure.client';

/**
 * `POST /qc/tool-runs` — DeviceSure's `qc.session.certified` webhook, and the
 * technician app's offline queue, arriving at the same door.
 *
 * The six steps of Phase 4 Task 2 run in the order the document gives them, and
 * the order is the point rather than a style choice:
 *
 *   1. **The raw payload is stored before anything is believed.** When a buyer
 *      disputes a grade in four months, the original is the evidence.
 *   2. Verify the Ed25519 signature over `signablePayload()`.
 *   3. Refuse a replayed nonce; treat a repeated `(provider, run id)` as one row
 *      and a 200 (QC-001, QC-004).
 *   4. Compare the serial against the manifest. A mismatch is an immediate hard
 *      stop (QC-012).
 *   5. Map through `field_map_json` into `qc_hardware_detected`.
 *   6. A parse failure keeps the payload, marks `PARSE_FAILED`, alerts
 *      engineering, and leaves the manual-entry path open (QC-008).
 *
 * Three rules from the phase brief are load-bearing here, and each is a thing a
 * later change would erode without noticing:
 *
 * **Nothing in this file corrects its source.** If DeviceSure reports 15 GB for
 * a 16 GB machine (07 §3.4), 15 is stored and `compareSpec()` renders "16 GB
 * installed (15 GB usable)" downstream. If it reports a cycle count of exactly 0
 * on a battery with 23% wear (§3.5), 0 is stored. Both are defects in their
 * Windows collector. A parser that quietly fixes its input is a parser nobody
 * can reason about six months later, and — worse — it hides the bug from the
 * only people who can fix it.
 *
 * **The three dispositions are three different things.** `REJECT` creates no
 * `qc_report`; `HARD_STOP` ingests and stops the unit; `FLAG` ingests and
 * records. Collapsing any pair of them loses information a human needs.
 *
 * **The certificate guards are not re-derived here.** `assessCertificate()` in
 * `@trugrade/contracts` owns them and is tested against them. This service
 * decides what to *do*, which is a different question from what is wrong.
 */

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/**
 * The certificate, validated only as far as we need it to address a row.
 *
 * `.passthrough()` everywhere is deliberate and is half of step 1: a schema that
 * strips unknown keys turns "store the payload verbatim" into "store the payload
 * we happened to understand in August". Everything DeviceSure sends and we do
 * not yet map survives into `raw_report_json` and `raw_json`, which is where the
 * answer lives when the field map turns out to be wrong.
 */
const certificateSchema = z
  .object({
    certificate: z.object({ id: z.string().min(1) }).passthrough(),
    session: z.object({ nonce: z.string().min(1) }).passthrough(),
    device: z.object({ serial: z.string().min(1) }).passthrough(),
  })
  .passthrough();

export const ingestToolRunSchema = z.object({
  /** `qc_tool_provider.code`. The field map is read from that row, never from here. */
  providerCode: z.string().min(1).default('DEVICESURE'),
  /** Falls back to `session.externalRef`, which 07 §5.2 defines as our unit id. */
  unitId: uuidSchema.optional(),
  /** The inspecting identity — a `qc.qc_technician.id`, not a user id. */
  technicianId: uuidSchema.optional(),
  /**
   * The agent's own metadata. Not on the certificate, because it describes the
   * thing that produced the certificate rather than the machine it describes.
   */
  agent: z.object({
    toolVersion: z.string().min(1),
    /** The desktop agent's device certificate. NOT NULL on both tables. */
    deviceCertId: z.string().min(1),
    agentVersion: z.string().min(1).optional(),
  }),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  /**
   * The path out of step 6, and the only way an unsigned certificate is accepted
   * in production. A reason and a named actor are both required: "manual entry"
   * with nobody's name on it is how an unverifiable grade becomes a legal claim.
   */
  manualEntry: z.object({ reason: z.string().min(10), actorUserId: uuidSchema }).optional(),
  certificate: certificateSchema,
});
export type IngestToolRunDto = z.infer<typeof ingestToolRunSchema>;

export interface IngestionResult {
  toolRunId: string;
  /** Null when the certificate was refused, or when we do not know which machine it describes. */
  qcReportId: string | null;
  /** True when this exact run had already been ingested. The response is still a 200. */
  alreadyIngested: boolean;
  parseStatus: ParseStatus;
  /** `assessCertificate().accept` — false means no report was created. */
  accepted: boolean;
  /** The unit cannot proceed: not graded, not sealed, not listed. */
  hardStop: boolean;
  serialMatches: boolean | null;
  defects: readonly CertificateDefect[];
  /** Present only when a report was created; this is the public passport code. */
  verificationCode: string | null;
}

// ---------------------------------------------------------------------------

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly repo: QcRepository,
    private readonly prisma: PrismaService,
    private readonly store: ObjectStorePort,
    private readonly devicesure: DeviceSureClient,
    private readonly clock: ClockPort,
    private readonly config: AppConfig,
  ) {}

  async ingest(input: IngestToolRunDto): Promise<IngestionResult> {
    const cert = input.certificate as unknown as DeviceSureCertificate;
    const provider = await this.provider(input.providerCode);
    const map = fieldMap(provider.fieldMapJson);

    // -- Step 1: the raw payload, verbatim, first --------------------------
    //
    // Resolving which unit this is does read two fields, and there is no version
    // of this that does not: `qc_tool_run.unit_id` is NOT NULL and carries a
    // foreign key, so a row cannot exist before we know the machine. What
    // "verbatim first" forbids is interpretation — grading, mapping, believing —
    // and none of that has happened yet.
    //
    // The object-store write is unconditional and comes before the row, so being
    // sent something we cannot even file is still recorded. S3 has no foreign
    // keys; that is the property being used here.
    const hash = this.devicesure.hashPayload(input.certificate);
    const rawKey = `qc/tool-runs/${provider.code}/${cert.certificate.id}.json`;
    await this.store.put(
      rawKey,
      Buffer.from(JSON.stringify(input.certificate), 'utf8'),
      'application/json',
    );

    const unitId = input.unitId ?? asString(at(cert, 'session.externalRef'));
    if (!unitId || !uuidSchema.safeParse(unitId).success) {
      // The payload is filed under `rawKey` and the log names it, so an
      // unaddressable certificate is still recoverable by hand.
      this.logger.error(
        `Certificate ${cert.certificate.id} names no resolvable unit; payload retained at ${rawKey}.`,
      );
      throw new ValidationError('We could not tell which machine this inspection belongs to.', {
        'certificate.session.externalRef': 'Expected the Gorefurbo unit id.',
      });
    }

    const target = await this.target(unitId);
    const serialFromTool = normaliseSerial(cert.device.serial);
    const serialMatches = target.manifestSerial ? serialFromTool === target.manifestSerial : null;

    // -- Step 2: is it signed, and by them? --------------------------------
    const signature = await this.devicesure.verifySignature(cert);
    const manual = input.manualEntry;
    const signatureDefects = this.signatureDefects(signature, manual !== undefined);

    // -- The certificate's own guards --------------------------------------
    //
    // `requireSignature` is left unset because the UNSIGNED question is already
    // decided above with more information than `assessCertificate` has — whether
    // the key was readable, and whether a manual-entry path was declared.
    // Passing it here as well would report the same problem twice.
    const verdict = assessCertificate(cert, {
      expectedSerial: target.manifestSerial ?? undefined,
    });
    const defects = [...signatureDefects, ...verdict.defects];
    const accepted = verdict.accept && !signatureDefects.some((d) => d.disposition === 'REJECT');
    const hardStop = verdict.hardStop || serialMatches === false;

    // -- Step 3: store the run; idempotent on (provider, run id) -----------
    //
    // A replayed nonce raises `NonceReplayError` out of the repository and
    // becomes a 409 (QC-004). A repeated run id does not: `ON CONFLICT DO
    // NOTHING` on the arbiter index short-circuits before the nonce index is
    // ever consulted, so the identical webhook delivered twice — same nonce and
    // all — is one row and a 200 (QC-001).
    const startedAt = input.startedAt ? new Date(input.startedAt) : this.clock.now();
    const completedAt = input.completedAt ? new Date(input.completedAt) : null;
    const { row: run, alreadyIngested } = await this.repo.insertToolRun({
      unitId,
      visitUnitId: target.visitUnitId,
      toolProviderId: provider.id,
      toolVersion: input.agent.toolVersion,
      toolRunId: cert.certificate.id,
      deviceCertId: input.agent.deviceCertId,
      rawReportKey: rawKey,
      rawReportJson: input.certificate,
      rawReportHash: hash,
      parseStatus: manual ? 'MANUAL_ENTRY' : 'PENDING',
      parseError: this.parseNote(defects, signature, hash, cert, manual),
      serialFromTool: cert.device.serial,
      serialMatches,
      startedAt,
      completedAt,
      signature: cert.certificate.signature ?? null,
      nonce: cert.session.nonce,
    });

    if (alreadyIngested) {
      // Re-delivery. Nothing is re-parsed and nothing is re-graded: the answer to
      // "we already have this" is the record we already made, not a second
      // attempt at making it.
      const existing = (await this.repo.findReportsByUnit(unitId)).find(
        (r) => r.toolRunId === run.id,
      );
      return {
        toolRunId: run.id,
        qcReportId: existing?.id ?? null,
        alreadyIngested: true,
        parseStatus: run.parseStatus,
        accepted,
        hardStop,
        serialMatches: run.serialMatches,
        defects,
        verificationCode: existing?.verificationCode ?? null,
      };
    }

    // -- Step 4: the serial is the whole basis of the record ---------------
    if (serialMatches === false) {
      await this.hardStopOnSerial(target, run.id, cert.device.serial);
      return {
        toolRunId: run.id,
        qcReportId: null,
        alreadyIngested: false,
        parseStatus: 'PENDING',
        accepted: false,
        hardStop: true,
        serialMatches: false,
        defects,
        verificationCode: null,
      };
    }

    if (!accepted) {
      // REJECT. The raw payload stays — being sent something incoherent is itself
      // evidence — but nothing downstream may treat this as a finding, so there
      // is no report to hang a grade on. `parse_status` stays PENDING rather than
      // PARSE_FAILED: the payload parsed perfectly well, it just contradicts
      // itself, and `ix_toolrun_parse` surfaces PENDING for a human either way.
      this.logger.error(
        `Refused certificate ${cert.certificate.id} for unit ${unitId}: ` +
          defects.map((d) => `${d.code} ${d.message}`).join(' | '),
      );
      return {
        toolRunId: run.id,
        qcReportId: null,
        alreadyIngested: false,
        parseStatus: run.parseStatus,
        accepted: false,
        hardStop,
        serialMatches,
        defects,
        verificationCode: null,
      };
    }

    // -- The report shell --------------------------------------------------
    //
    // `supersedeReport` unconditionally, not `createReport`: it returns
    // `supersededId: null` when there is no prior report, so one code path covers
    // a first inspection and a re-inspection, and nothing is ever overwritten
    // (QC-045). The alternative — read, then branch — is a race against a
    // concurrent delivery for the same unit.
    const technicianId = input.technicianId ?? target.visitTechnicianId;
    if (!technicianId) {
      // `qc_report.technician_id` is NOT NULL and now points at `qc_technician`.
      // On the self-serve path (vendor runs DeviceSure under our licence) there
      // is no Gorefurbo technician, and the accommodation the schema already has
      // is a `qc_technician` row with `employment_type = 'PARTNER'` for the
      // vendor's operator. Creating that row is the technician lane's job, so
      // this refuses rather than inventing an identity to satisfy a constraint.
      throw new PreconditionFailedError(
        'This inspection is not linked to a technician, so it cannot be recorded yet.',
        { reason: 'no_technician', unitId, toolRunId: run.id },
      );
    }

    const { report } = await this.repo.supersedeReport(unitId, {
      unitId,
      visitId: target.visitId,
      toolRunId: run.id,
      technicianId,
      deviceCertId: input.agent.deviceCertId,
      agentVersion: input.agent.agentVersion ?? input.agent.toolVersion,
      startedAt,
      completedAt,
      // NOT NULL, and there is no signature on the manual-entry path. A marker
      // that cannot be mistaken for one — a real Ed25519 signature is 88 base64
      // characters — beats inventing something signature-shaped.
      signature: cert.certificate.signature ?? `MANUAL_ENTRY:${manual?.actorUserId ?? 'unknown'}`,
      nonce: cert.session.nonce,
      // The tool's numbers, recorded as the tool's. The verdict lane overwrites
      // both through `completeReport` once it has run the tolerance rules: this
      // is what DeviceSure said, not yet what we are claiming.
      qcScore: roundScore(at(cert, map.qc_score)),
      gradeProposed: verdict.gradeProposed,
      validUntil: asDate(at(cert, map.valid_until)),
      rulesVersion: asString(at(cert, map.rules_version)),
      deviceFingerprint: asString(at(cert, map.device_fingerprint)),
      locationType: 'VENDOR_SITE',
      locationAddressId: target.addressId,
    });

    // -- Steps 5 and 6: the field map, and what happens when it is wrong ---
    let parseStatus: ParseStatus = manual ? 'MANUAL_ENTRY' : 'PARSED';
    let parseError = this.parseNote(defects, signature, hash, cert, manual);
    try {
      await this.repo.upsertHardware(report.id, this.mapHardware(cert, map, serialFromTool!));
    } catch (e) {
      // The technician's day does not stop because a parser regressed. The run,
      // the raw payload and the report all survive; the console's manual-entry
      // form fills in what the map could not.
      parseStatus = 'PARSE_FAILED';
      parseError = `Hardware mapping failed: ${(e as Error).message}`;
      this.logger.error(
        `Field map for ${provider.code} could not produce hardware for unit ${unitId} ` +
          `(tool run ${run.id}, payload at ${rawKey}): ${(e as Error).message}`,
      );
    }
    await this.repo.updateToolRunParse(run.id, { parseStatus, parseError });

    if (hardStop) {
      // A not-listable grade, or an area nobody could test. The report exists
      // because the machine was genuinely inspected and the finding is real; the
      // unit still stops. Rule 1 — a failed unit is absent from the storefront,
      // not dimmed — is enforced downstream on `is_sellable`.
      this.logger.warn(
        `Unit ${unitId} hard-stopped on ingestion: ` +
          verdict.defects
            .filter((d) => d.disposition === 'HARD_STOP')
            .map((d) => d.code)
            .join(', '),
      );
    }

    return {
      toolRunId: run.id,
      qcReportId: report.id,
      alreadyIngested: false,
      parseStatus,
      accepted: true,
      hardStop,
      serialMatches,
      defects,
      verificationCode: report.verificationCode,
    };
  }

  // -------------------------------------------------------------------------
  // The steps in detail
  // -------------------------------------------------------------------------

  private async provider(code: string): Promise<QcToolProviderRow> {
    const provider = await this.repo.findToolProviderByCode(code);
    if (!provider?.isActive) {
      // Not a 404. The certificate is fine and the inspection really happened;
      // our configuration is what is missing, and the agent should retry.
      throw new PreconditionFailedError('We cannot accept inspections from that tool right now.', {
        reason: 'tool_provider_unavailable',
        code,
      });
    }
    return provider;
  }

  /**
   * Everything about the machine this certificate claims to describe.
   *
   * Two separate queries rather than a join, because `listing.unit` is in another
   * Postgres schema and `no-cross-schema-join` refuses to let that seam become a
   * query plan. The manifest serial wins over the unit's own — the manifest is
   * what the technician was sent to inspect — and the unit's is the fallback for
   * the self-serve path, where there is no visit at all.
   */
  private async target(unitId: string): Promise<{
    manifestSerial: string | null;
    visitUnitId: string | null;
    visitId: string | null;
    visitTechnicianId: string | null;
    addressId: string | null;
  }> {
    const units = await this.prisma.$queryRaw<Array<{ serial_number: string }>>`
      SELECT serial_number FROM listing.unit WHERE id = ${unitId}::uuid`;
    if (!units[0]) {
      throw new ValidationError('That machine is not one of ours.', { unitId: 'Unknown unit.' });
    }

    const visitUnits = await this.repo.findVisitUnits({ unitId });
    // The newest manifest entry wins: a re-inspection is a second visit, and the
    // serial to check against is the one on the visit happening now.
    const visitUnit = visitUnits[visitUnits.length - 1] ?? null;
    const visit = visitUnit ? await this.repo.findVisitById(visitUnit.visitId) : null;

    return {
      manifestSerial: normaliseSerial(visitUnit?.serialNumber ?? units[0].serial_number),
      visitUnitId: visitUnit?.id ?? null,
      visitId: visitUnit?.visitId ?? null,
      visitTechnicianId: visit?.technicianId ?? null,
      addressId: visit?.addressId ?? null,
    };
  }

  /**
   * Step 4. The label does not belong to the laptop.
   *
   * Everything else on the certificate is a measurement of *some* machine and we
   * do not know which — so there is nothing to grade, nothing to seal and nothing
   * to list. The visit unit goes UNTESTABLE pending investigation rather than
   * FAIL, because the machine has not failed anything; the paperwork has.
   */
  private async hardStopOnSerial(
    target: { visitUnitId: string | null },
    toolRunId: string,
    serialFromTool: string,
  ): Promise<void> {
    if (target.visitUnitId) {
      await this.repo.updateVisitUnit(target.visitUnitId, {
        outcome: 'UNTESTABLE',
        absentReason: `Serial ${serialFromTool} does not match the manifest.`,
        completedAt: this.clock.now(),
      });
    }
    await this.repo.updateToolRunParse(toolRunId, {
      parseStatus: 'PENDING',
      parseError:
        `Serial mismatch: the tool read ${serialFromTool}, the manifest says otherwise. ` +
        `Not parsed, not graded, not sealed — raised to the QC manager.`,
    });
    // The exception to the QC manager. There is no `qc.exception.raised` name in
    // the event catalogue, so this is a log line and an operations alert rather
    // than an outbox row — flagged rather than invented, because adding an event
    // name is a change to `@trugrade/contracts`.
    this.logger.error(
      `QC-012 serial mismatch on tool run ${toolRunId}: the tool read ${serialFromTool}. ` +
        `Unit marked UNTESTABLE. A QC manager must investigate before this machine moves.`,
    );
  }

  /**
   * What to do about the signature, before the certificate's own guards run.
   *
   * Three cases, genuinely different, and the phase document treats them as one —
   * which is the mistake worth not making:
   *
   *   - **Present and wrong** — REJECT, everywhere, always. Somebody produced
   *     something that wants to look signed.
   *   - **Absent** — REJECT in production unless the manual-entry path was
   *     declared with a reason and a named actor. Outside production it is a
   *     FLAG, because no environment but production has real keys.
   *   - **Key unreadable** — REJECT in production, FLAG elsewhere. Our own key
   *     distribution being broken is not a vendor's forgery, and answering a
   *     botched rotation by declaring every certificate fraudulent is the wrong
   *     failure. Production still stops, because an unverifiable certificate is
   *     an unverifiable certificate.
   *
   * `UNSIGNED` is reused as the code for all three because it is the only
   * signature-related `DefectCode` in the contract; the message says which case
   * it was. A `SIGNATURE_INVALID` code would be a better wire signal and is a
   * change to `@trugrade/contracts`, not something to fork a vocabulary over.
   */
  private signatureDefects(
    signature: { verified: boolean; absent?: boolean; keyUnavailable?: boolean; reason?: string },
    manualEntry: boolean,
  ): CertificateDefect[] {
    if (signature.verified) return [];

    if (signature.absent) {
      if (manualEntry) return [];
      return [
        {
          code: 'UNSIGNED',
          disposition: this.config.isProduction ? 'REJECT' : 'FLAG',
          message:
            'Certificate carries no signature. Unsigned reports are accepted only via the manual-entry path, with a reason and a named actor.',
        },
      ];
    }

    if (signature.keyUnavailable) {
      return [
        {
          code: 'UNSIGNED',
          disposition: this.config.isProduction ? 'REJECT' : 'FLAG',
          message: `Signature could not be verified: ${signature.reason}`,
        },
      ];
    }

    return [
      {
        code: 'UNSIGNED',
        disposition: 'REJECT',
        message: `Signature is present and does not verify: ${signature.reason}`,
      },
    ];
  }

  /** The note that goes on `parse_error`, or null when there is nothing to say. */
  private parseNote(
    defects: readonly CertificateDefect[],
    signature: { verified: boolean },
    ourHash: string,
    cert: DeviceSureCertificate,
    manual: { reason: string; actorUserId: string } | undefined,
  ): string | null {
    const notes: string[] = [];
    // There is no column for who authorised a manual entry, so it goes here with
    // the actor named. Flagged rather than worked around: the right home is two
    // columns on `qc_tool_run`, and that is a schema change.
    if (manual) notes.push(`MANUAL_ENTRY by ${manual.actorUserId}: ${manual.reason}`);
    // Their hash against ours. Recorded, never resolved: a disagreement means one
    // of the two producers is wrong and a human decides which. The signature is
    // the control that actually matters, so this gates nothing.
    const theirs = asString(at(cert, 'certificate.sha256'));
    if (theirs && theirs.toLowerCase() !== ourHash) {
      notes.push(`certificate.sha256 (${theirs}) disagrees with our digest (${ourHash}).`);
    }
    if (!signature.verified) notes.push('Signature not verified.');
    for (const d of defects) notes.push(`${d.disposition} ${d.code}: ${d.message}`);
    return notes.length ? notes.join(' ') : null;
  }

  // -------------------------------------------------------------------------
  // Step 5 — the field map
  // -------------------------------------------------------------------------

  /**
   * `field_map_json` into `qc_hardware_detected`. **The map is data.**
   *
   * Not one DeviceSure path appears below. Every value is fetched through the
   * provider row, which is why adding a second diagnostic tool is a row in
   * `qc_tool_provider` and not a code release — and why DeviceSure moving its
   * payload is an ops edit rather than a deploy.
   *
   * Two resolution rules, in order, because §5.4 maps `hardware` as a whole block
   * rather than field by field:
   *
   *   1. An explicit `hardware.<our column>` entry in the map wins. That is how
   *      ops points a column at a path nobody anticipated.
   *   2. Otherwise the column name is looked up inside the mapped hardware block,
   *      snake_case then camelCase. That is our vocabulary applied to their
   *      object, which is exactly what the column comment says `field_map_json`
   *      is for — "maps the tool's own field names onto our
   *      qc_hardware_detected columns" — and not a hard-coded path.
   *
   * `ram_detected_gb` is the one field that can fail the whole parse, because it
   * is NOT NULL and there is no honest default. Zero GB of RAM is a measurement,
   * and a false one; a missing value is not a passing value, so this raises and
   * step 6 catches it.
   */
  private mapHardware(
    cert: DeviceSureCertificate,
    map: Readonly<Record<string, string>>,
    hwSerial: string,
  ): HardwareInput {
    const root = map.hardware;
    const block = at(cert, root);
    const value = (column: string): unknown => {
      const explicit = map[`hardware.${column}`];
      if (explicit) return at(cert, explicit);
      if (block === null || typeof block !== 'object') return undefined;
      const record = block as Record<string, unknown>;
      return record[column] ?? record[camel(column)];
    };

    const ram = asInt(value('ram_detected_gb'));
    if (ram === null) {
      throw new Error(
        `No path to ram_detected_gb. The map has ` +
          `${root ? `hardware -> "${root}"` : 'no hardware entry'}; add a ` +
          `"hardware.ram_detected_gb" entry to field_map_json rather than defaulting it.`,
      );
    }

    return {
      hwSerial,
      ramDetectedGb: ram,
      hwModel: asString(value('hw_model')),
      biosVersion: asString(value('bios_version')),
      biosDate: asDate(value('bios_date')),
      cpuDetected: asString(value('cpu_detected')),
      cores: asInt(value('cores')),
      threads: asInt(value('threads')),
      ramModules: asInt(value('ram_modules')),
      ramType: asString(value('ram_type')),
      ramSpeedMhz: asInt(value('ram_speed_mhz')),
      storageType: asString(value('storage_type')),
      storageDetectedGb: asInt(value('storage_detected_gb')),
      storageModel: asString(value('storage_model')),
      smartStatus: asSmartStatus(value('smart_status')),
      powerOnHours: asInt(value('power_on_hours')),
      tbwGb: asInt(value('tbw_gb')),
      gpuDetected: asString(value('gpu_detected')),
      panelId: asString(value('panel_id')),
      screenSize: asNumber(value('screen_size')),
      batteryDesignWh: asInt(value('battery_design_wh')),
      batteryFullWh: asInt(value('battery_full_wh')),
      // These two have their own top-level entries in §5.4 (`battery.healthPct`,
      // `battery.cycleCount`) because DeviceSure reports them outside the
      // hardware block. A cycle count of 0 is stored as 0 — §3.5 says that is
      // almost certainly their collector defaulting rather than a measurement,
      // and the fix for that lives in their collector, not in this function.
      batteryHealthPct: asNumber(at(cert, map.battery_health_pct) ?? value('battery_health_pct')),
      cycleCount: asInt(at(cert, map.cycle_count) ?? value('cycle_count')),
      wifiChip: asString(value('wifi_chip')),
      btPresent: asBoolean(value('bt_present')),
      tpmVersion: asString(value('tpm_version')),
      secureBoot: asBoolean(value('secure_boot')),
      biosLocked: asBoolean(value('bios_locked')) ?? false,
      mdmLocked: asBoolean(value('mdm_locked')) ?? false,
      computraceActive: asBoolean(value('computrace_active')) ?? false,
      // The tool's whole hardware view, kept intact. This is where the *installed*
      // RAM figure survives while there is only a `ram_detected_gb` column for the
      // usable one (07 §3.4), and where anything we have not mapped lives until
      // somebody needs it.
      rawJson: block ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
// Coercion. Every one of these returns null rather than a default, because a
// default here is a fabricated measurement, and this whole phase turns on the
// difference (07 §2, `never-fabricate.md`).
// ---------------------------------------------------------------------------

/**
 * `field_map_json` is `Record<string, unknown>` because it is ops-editable JSON,
 * and a non-string entry there is a typo rather than a path. Dropping it is
 * quieter than crashing on it, and the affected column simply reads as
 * not-reported — which is the honest outcome for a path we cannot follow.
 */
function fieldMap(raw: Record<string, unknown>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(raw ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

/** Dotted-path read. Missing is `undefined`; nothing throws on a shape surprise. */
function at(source: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let cursor: unknown = source;
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

const camel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asInt(v: unknown): number | null {
  const n = asNumber(v);
  return n === null ? null : Math.round(n);
}

function asBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

/**
 * `qc_report.qc_score` is an INT with a CHECK of 0–100, and DeviceSure sends
 * 98.24. Rounding here rather than letting Postgres cast keeps the stored value
 * predictable. Note that 07 §3.2 — their header block printing `24` for `98.24` —
 * is a rendering bug of theirs and is not something this rounding hides.
 */
function roundScore(v: unknown): number | null {
  const n = asNumber(v);
  if (n === null || n < 0 || n > 100) return null;
  return Math.round(n);
}

/** `YYYY-MM-DD`, or null. An ISO instant is narrowed to its date; junk is not a date. */
function asDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const date = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** The column's CHECK allows three values. Anything else is not a SMART reading. */
function asSmartStatus(v: unknown): SmartStatus | null {
  const s = asString(v)?.toUpperCase();
  return s && (SMART_STATUSES as readonly string[]).includes(s) ? (s as SmartStatus) : null;
}
