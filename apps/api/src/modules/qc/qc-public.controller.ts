import { Controller, Get, Header, Injectable, Param, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { normaliseSerial, serialNumberSchema, verificationCodeSchema } from '@trugrade/contracts';
import { Public } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { NotFoundError } from '../../shared/errors/domain-errors';
import { RateLimiter, type RateLimitRule } from '../../shared/redis/redis.service';
import { ObjectStorePort } from '../../shared/adapters/ports';
import { PrismaService } from '../../shared/db/prisma.service';
import { ClockPort } from '../../shared/clock';
import { QcRepository, type QcReportRow } from './internal/qc.repository';
import { ReportPdfService } from './internal/report-pdf.service';
import { QC_AREA_CODES } from './dto/qc.dto';
import type { QcAreaCode, QcAreaStatus, QcPhotoAngle, QcVerdictValue } from './dto/qc.dto';

/**
 * The unit passport: what we said about this machine, readable by anyone holding
 * it, before they have bought it and without an account.
 *
 * Three routes, one document. `/qc/verify/:code` is what the QR code on the
 * printed report resolves to — a buyer's receiving clerk scans it at the door
 * with the laptop open in front of them and checks the seal code on the screen
 * against the sticker on the lid, before signing. `/unit/:serial` is the same
 * document reached from the serial, for the storefront and for anyone who has
 * the machine but not the paperwork. `/unit/:serial/report.pdf` is the printed
 * form of it, the copy that ships in the box and carries that QR code.
 *
 * Per `07_DEVICESURE_INTEGRATION.md` §5.5 this is deliberately **not** a second
 * certificate page. DeviceSure's `/verify/:certificateId` stays canonical for the
 * certificate itself; this passport carries `deviceSure.certificateId` so the
 * page can embed and link back to it, and adds the commercial context DeviceSure
 * has no business knowing about — the seal, the validity window, the wipe.
 *
 * Three properties this file is responsible for and nothing else is:
 *
 *   1. **No vendor identity, at any depth.** The response is built from an
 *      explicit allow-list, never by returning a row. A blacklist fails open the
 *      first time somebody adds a column, and the column that gets added is
 *      always the one that matters.
 *   2. **Not enumerable.** `verification_code` is 14 characters of Crockford
 *      base32 from a CSPRNG (70 bits) with a `CHECK` behind it, and both routes
 *      are rate-limited — with a much tighter bucket on *misses*, because a
 *      person holding a laptop almost never gets a 404 and a for-loop gets
 *      nothing else. That asymmetry is the control; the volume limit alone is
 *      not, since a receiving bay legitimately checks forty machines in an hour.
 *   3. **Not indexed.** `X-Robots-Tag: noindex` on the response, which is the
 *      part we can actually enforce here. `robots.txt` lives with the storefront
 *      and is that app's to update; a header does not depend on a crawler
 *      choosing to read a file first.
 */

/** Signed photo links live as long as somebody stands at a door reading them. */
const PHOTO_URL_TTL_SECONDS = 900;

/**
 * Generous enough for a receiving bay working through a pallet, tight enough
 * that scraping the catalogue takes years.
 */
const LOOKUP_LIMIT: RateLimitRule = { name: 'qc-passport', limit: 60, windowSeconds: 300 };

/**
 * The bucket that actually protects the inventory. A miss is what enumeration
 * produces and what a real reader almost never sees.
 */
const MISS_LIMIT: RateLimitRule = { name: 'qc-passport-miss', limit: 10, windowSeconds: 3_600 };

export interface PassportPhoto {
  angle: QcPhotoAngle;
  /** A short-lived signed URL. The object key itself is never published. */
  url: string;
}

/**
 * One of the twelve areas — including the ones nobody looked at.
 *
 * `qc_area_result.status` has a CHECK of PASS/WARN/FAIL and no NOT_MEASURED, so
 * an unmeasured area is stored as an **absent row** (`qc.dto.ts` says so at
 * length, and the verdict engine reads that absence). An absent row is the right
 * storage and the wrong payload: a screen iterating eleven rows renders eleven
 * ticks and a twelfth area that simply is not mentioned, which is a missing
 * value rendering as a passing one — the failure CLAUDE.md names. So the
 * passport states the absence rather than omitting it: always twelve entries,
 * `NOT_MEASURED` with null scores for the ones we did not measure.
 */
export interface PassportArea {
  area: QcAreaCode;
  score: number | null;
  maxScore: number | null;
  status: QcAreaStatus | 'NOT_MEASURED';
}

export interface PassportHardware {
  model: string | null;
  cpu: string | null;
  ramDetectedGb: number;
  ramModules: number | null;
  ramType: string | null;
  storageType: string | null;
  storageDetectedGb: number | null;
  gpu: string | null;
  screenSizeIn: number | null;
  smartStatus: string | null;
  batteryHealthPct: number | null;
  cycleCount: number | null;
  tpmVersion: string | null;
  secureBoot: boolean | null;
}

export interface UnitPassport {
  serialNumber: string;
  /** PASS / PASS_WITH_NOTE / MISMATCH / FAIL — the large state at the top of the page. */
  verdict: QcVerdictValue | null;
  /** Our grade. Ours, not the tool's — CP e-Comm r.7(5). */
  grade: string | null;
  qcScore: number | null;
  /** `YYYY-MM-DD`, the day of the inspection. */
  inspectedOn: string | null;
  /** `YYYY-MM-DD`. Inclusive: the last day this claim stands. */
  validUntil: string | null;
  expired: boolean;
  /** The rule set the grade was derived under, so it can be re-derived. */
  rulesVersion: string | null;
  seal: { code: string; status: string; appliedOn: string } | null;
  hardware: PassportHardware | null;
  areas: PassportArea[];
  photos: PassportPhoto[];
  wipeCertificate: {
    standard: string;
    method: string;
    passes: number;
    verificationStatus: string;
    issuedAt: string;
  } | null;
  /** DeviceSure's own certificate, which stays canonical for the certificate. */
  deviceSure: { certificateId: string } | null;
}

/**
 * Assembles the passport.
 *
 * It lives in this file rather than in `internal/` because it exists only to
 * serve these two routes and has exactly one caller. A service in `internal/`
 * with one consumer, in the same module, is a folder with an extra file in it.
 */
@Injectable()
export class QcPassportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QcRepository,
    private readonly clock: ClockPort,
    private readonly store: ObjectStorePort,
  ) {}

  /**
   * The current report for a serial.
   *
   * `uq_qcrep_current` guarantees there is at most one, so "the passport" is
   * well defined. A unit with no current report is a 404 rather than an empty
   * passport: an uninspected or withdrawn machine has nothing we are willing to
   * say about it, and rule 1 of this phase is that such a unit is *absent*, not
   * shown greyed out.
   */
  async byserial(serial: string): Promise<UnitPassport | null> {
    const normalised = normaliseSerial(serial);
    if (!normalised) return null;

    const rows = await this.prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
      SELECT id, serial_number FROM listing.unit WHERE serial_number = ${normalised}`;
    const unit = rows[0];
    if (!unit) return null;

    const report = await this.repo.findCurrentReportByUnit(unit.id);
    return report ? this.assemble(report, unit.serial_number) : null;
  }

  /**
   * The report a printed code identifies — whatever its verdict.
   *
   * A superseded report is still served here, and deliberately: the code on a
   * document in somebody's hand identifies *that* document, and answering a
   * question about it with a different report is worse than useless. `expired`
   * and `validUntil` say what state it is in.
   */
  async byVerificationCode(code: string): Promise<UnitPassport | null> {
    const report = await this.repo.findReportByVerificationCode(code);
    if (!report) return null;

    const rows = await this.prisma.$queryRaw<Array<{ serial_number: string }>>`
      SELECT serial_number FROM listing.unit WHERE id = ${report.unitId}::uuid`;
    return this.assemble(report, rows[0]?.serial_number ?? '');
  }

  // -------------------------------------------------------------------------

  private async assemble(report: QcReportRow, serialNumber: string): Promise<UnitPassport> {
    const [hardware, areas, photos, seals, wipes, certificateId] = await Promise.all([
      this.repo.findHardware(report.id),
      this.repo.findAreaResults(report.id),
      this.repo.findPhotos(report.id),
      this.repo.findSealsByUnit(report.unitId),
      this.repo.findWipeCertificates(report.unitId),
      this.deviceSureCertificateId(report.toolRunId),
    ]);

    const seal = seals[0] ?? null;
    const wipe = wipes[0] ?? null;

    return {
      serialNumber,
      verdict: report.verdict,
      // `grade_final`, never `grade_proposed`. The proposed grade is the tool's
      // opinion; the final grade is our claim, and `chk_override_reason` is what
      // makes the difference between them accountable.
      grade: report.gradeFinal,
      qcScore: report.qcScore,
      inspectedOn: report.completedAt ? report.completedAt.toISOString().slice(0, 10) : null,
      validUntil: report.validUntil,
      // Inclusive, on the IST calendar. Both sides are `YYYY-MM-DD`, which sorts
      // lexically exactly as it sorts by date.
      expired: report.validUntil !== null && report.validUntil < this.clock.todayInIst(),
      rulesVersion: report.rulesVersion,
      seal: seal
        ? {
            code: seal.sealCode,
            status: seal.status,
            appliedOn: seal.appliedAt.toISOString().slice(0, 10),
          }
        : null,
      hardware: hardware
        ? {
            model: hardware.hwModel,
            cpu: hardware.cpuDetected,
            // Reported exactly as the tool measured it — 15 GB on a 16 GB
            // Windows machine (07 §3.4). `compareSpec()` in contracts renders
            // "16 GB installed (15 GB usable)" from the declared spec; a `+1`
            // anywhere in this stack would be us quietly correcting our source.
            ramDetectedGb: hardware.ramDetectedGb,
            ramModules: hardware.ramModules,
            ramType: hardware.ramType,
            storageType: hardware.storageType,
            storageDetectedGb: hardware.storageDetectedGb,
            gpu: hardware.gpuDetected,
            screenSizeIn: hardware.screenSize,
            smartStatus: hardware.smartStatus,
            batteryHealthPct: hardware.batteryHealthPct,
            // Null means not reported, which is not zero. A cycle count of 0 on
            // a worn battery is a collector defaulting, not a measurement.
            cycleCount: hardware.cycleCount,
            tpmVersion: hardware.tpmVersion,
            secureBoot: hardware.secureBoot,
            // `rawJson`, `biosVersion`, `panelId`, the lock flags and the serial
            // are all deliberately absent: an allow-list, and `raw_json` is an
            // untyped blob from a third party that no allow-list downstream
            // could vet.
          }
        : null,
      // Driven by the twelve codes, not by the rows: a code with no row is
      // reported as NOT_MEASURED rather than dropped. Ordered by the code list
      // so two passports for the same machine read identically.
      areas: QC_AREA_CODES.map((code) => {
        const measured = areas.find((a) => a.area === code);
        return measured
          ? {
              area: code,
              score: measured.score,
              maxScore: measured.maxScore,
              status: measured.status,
            }
          : { area: code, score: null, maxScore: null, status: 'NOT_MEASURED' as const };
      }),
      photos: await Promise.all(
        photos.map(async (p) => ({
          angle: p.angle,
          // Short-lived, opaque, and the key never appears in the response —
          // object keys are a place vendor identifiers have leaked before.
          url: await this.store.presignDownload(p.fileKey, PHOTO_URL_TTL_SECONDS),
        })),
      ),
      wipeCertificate: wipe
        ? {
            standard: wipe.standard,
            method: wipe.method,
            passes: wipe.passes,
            verificationStatus: wipe.verificationStatus,
            issuedAt: wipe.issuedAt.toISOString(),
          }
        : null,
      deviceSure: certificateId ? { certificateId } : null,
    };
  }

  /**
   * DeviceSure's certificate id, which is `qc_tool_run.tool_run_id` — the
   * provider's own run id, and the key `UNIQUE (tool_provider_id, tool_run_id)`
   * makes ingestion idempotent on. `qc_report.tool_run_id` is our row's id, not
   * theirs; the two names are one letter apart and mean different things.
   */
  private async deviceSureCertificateId(toolRunId: string | null): Promise<string | null> {
    if (!toolRunId) return null;
    const run = await this.repo.findToolRunById(toolRunId);
    return run?.toolRunId ?? null;
  }
}

@Controller()
export class QcPublicController {
  constructor(
    private readonly passports: QcPassportService,
    private readonly reportPdf: ReportPdfService,
    private readonly limiter: RateLimiter,
  ) {}

  /**
   * The storefront's link and the fallback for somebody holding a machine with
   * no paperwork. Serials are printed on the case, so this is a weaker secret
   * than a verification code — which is why the miss bucket exists.
   */
  @Get('unit/:serial')
  @Public()
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  @Header('Cache-Control', 'no-store')
  async byserial(
    @Param('serial', new ZodValidationPipe(serialNumberSchema)) serial: string,
    @Req() req: Request,
  ): Promise<UnitPassport> {
    return this.lookup(req, () => this.passports.byserial(serial));
  }

  /** What the QR code on the printed QC report resolves to. */
  @Get('qc/verify/:code')
  @Public()
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  @Header('Cache-Control', 'no-store')
  async byVerificationCode(
    @Param('code', new ZodValidationPipe(verificationCodeSchema)) code: string,
    @Req() req: Request,
  ): Promise<UnitPassport> {
    return this.lookup(req, () => this.passports.byVerificationCode(code));
  }

  /**
   * The same document, printed, with a QR code back to `/qc/verify/:code`.
   *
   * This is the copy that ships in the box with the machine: the receiving clerk
   * scans the QR, compares the seal code on their phone with the sticker on the
   * lid, and signs. It carries no vendor identity — not in the body, not in the
   * PDF metadata, and not in the filename, which is why the filename is built in
   * `ReportPdfService` from the serial alone rather than assembled here.
   *
   * Same buckets as the passport: a person reading a machine at a door reads the
   * page or the report, not both a hundred times.
   */
  @Get('unit/:serial/report.pdf')
  @Public()
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  @Header('Cache-Control', 'no-store')
  async reportPdfBySerial(
    @Param('serial', new ZodValidationPipe(serialNumberSchema)) serial: string,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    const pdf = await this.lookup(req, () => this.reportPdf.renderBySerial(serial));
    return new StreamableFile(pdf.bytes, {
      type: 'application/pdf',
      disposition: `inline; filename="${pdf.filename}"`,
      length: pdf.bytes.length,
    });
  }

  /**
   * One limiter for every route here, and the miss bucket charged only on a miss.
   *
   * `req.ip` is the subject, which means `trust proxy` has to be set correctly
   * on the app behind a load balancer or every request shares one bucket. That
   * is a deployment concern rather than something this file can assert, so it is
   * named here where somebody debugging a shared-bucket outage will find it.
   */
  private async lookup<T>(req: Request, find: () => Promise<T | null>): Promise<T> {
    const subject = req.ip ?? 'unknown';
    await this.limiter.consume(LOOKUP_LIMIT, subject);

    const found = await find();
    if (!found) {
      await this.limiter.consume(MISS_LIMIT, subject);
      // The message never distinguishes "no such serial" from "never inspected"
      // from "withdrawn". All three are the same answer to a prober, and the
      // person legitimately holding the machine is going to ring us anyway.
      throw new NotFoundError('qc_report', { reason: 'no_passport' });
    }
    return found;
  }
}
