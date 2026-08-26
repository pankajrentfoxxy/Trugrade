import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import { BRAND } from '@trugrade/config';
import { TIMEZONE, normaliseSerial } from '@trugrade/contracts';
import { AppConfig } from '../../../shared/config';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { ObjectStorePort } from '../../../shared/adapters/ports';
import { PreconditionFailedError } from '../../../shared/errors/domain-errors';
import { QcRepository, type QcPhotoRow, type QcReportRow } from './qc.repository';
import { ToleranceService } from './tolerance.service';

/**
 * The printed QC report: one page of what we found, plus the photographs, with a
 * QR code that resolves to `/qc/verify/:verification_code`.
 *
 * **This document travels with the machine.** It is handed to a buyer's
 * receiving clerk at the door, who scans the QR with a phone, checks the seal
 * code on their screen against the sticker on the lid, and then signs. That is
 * the whole reason it exists, and it is also why the constraints below are hard
 * ones rather than preferences.
 *
 *   1. **No vendor identity, anywhere in the file.** We are the principal and
 *      the merchant of record; the vendor is our supplier and a buyer never
 *      learns who they are. "Anywhere" includes places a reader does not look:
 *      the **filename** (`Content-Disposition`), the **PDF metadata** —
 *      Title/Author/Subject/Producer/Creator are a real leak vector and default
 *      to whatever the writing library felt like — and any **object key**, since
 *      a vendor slug in an S3 path is the leak Phase 5 names explicitly. Photos
 *      are embedded as bytes here precisely so no key travels with the document.
 *      Every field drawn below is named individually: this is an allow-list, and
 *      a row is never handed to the renderer to iterate over.
 *
 *   2. **One verification path.** The QR encodes the existing public route and
 *      nothing else. A second code, a shortlink or a per-print token would each
 *      be a second thing to keep unguessable and a second thing to revoke.
 *
 *   3. **The grade is stated with the band it was awarded under.** Grading is a
 *      liability claim under CP e-Comm r.7(5), so a document making the claim
 *      carries the numbers that back it and the `rules_version` they came from —
 *      re-derivable months later against the rules in force on the inspection
 *      date, not against today's. If that rule set cannot be resolved we do not
 *      print a grade we cannot defend; `ToleranceService.resolve` raises and the
 *      report does not go out.
 *
 * The unit lookup by serial is this file's own, deliberately, rather than
 * reached through `QcPassportService`: that class lives on the public controller
 * and importing it here would close an import cycle. What it and this file share
 * is the *rule* — an explicit allow-list — not a code path, and each states its
 * own list where a reviewer can see it.
 */

/** A4 in points. The buyer's clerk prints this on the office printer. */
const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const LEAD = 13;
const BODY = 9.5;
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);

/** Big enough to scan from a phone at arm's length on a 300 dpi print. */
const QR_SIZE = 118;

/** Six angles, three across. Any that cannot be fetched are simply absent. */
const PHOTO_COLUMNS = 3;

export interface QcReportPdf {
  bytes: Buffer;
  /** Serial only — never a vendor name. Phase 5 names the filename as a leak. */
  filename: string;
  /** What the QR encodes. Returned so a caller can assert on it without a decoder. */
  verifyUrl: string;
}

@Injectable()
export class ReportPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QcRepository,
    private readonly tolerance: ToleranceService,
    private readonly store: ObjectStorePort,
    private readonly clock: ClockPort,
    private readonly config: AppConfig,
  ) {}

  /**
   * The current report for a serial, as a PDF.
   *
   * `uq_qcrep_current` guarantees at most one, so "the report" is well defined.
   * A unit with no current report is `null` — a 404 to the caller — for the same
   * reason the passport is: an uninspected or withdrawn machine is *absent*, not
   * a document with empty fields.
   */
  async renderBySerial(serial: string): Promise<QcReportPdf | null> {
    const normalised = normaliseSerial(serial);
    if (!normalised) return null;

    const rows = await this.prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
      SELECT id, serial_number FROM listing.unit WHERE serial_number = ${normalised}`;
    const unit = rows[0];
    if (!unit) return null;

    const report = await this.repo.findCurrentReportByUnit(unit.id);
    if (!report) return null;

    return this.render(report, unit.serial_number);
  }

  // -------------------------------------------------------------------------

  private async render(report: QcReportRow, serialNumber: string): Promise<QcReportPdf> {
    if (!report.verificationCode) {
      // Without a code there is nothing for the QR to resolve to, and a printed
      // report a buyer cannot verify is worse than no printed report — it looks
      // like evidence and is not. Every report written by this system gets a
      // code at INSERT; reaching here means a row that predates that.
      throw new PreconditionFailedError(
        'This inspection has no public verification code, so a verifiable report cannot be printed.',
        { reportId: report.id, reason: 'no_verification_code' },
      );
    }

    const [hardware, areas, photos, seals, wipes, technician, band, certificateId] =
      await Promise.all([
        this.repo.findHardware(report.id),
        this.repo.findAreaResults(report.id),
        this.repo.findPhotos(report.id),
        this.repo.findSealsByUnit(report.unitId),
        this.repo.findWipeCertificates(report.unitId),
        this.repo.findTechnicianById(report.technicianId),
        this.gradeBand(report),
        this.deviceSureCertificateId(report.toolRunId),
      ]);

    const verifyUrl = this.verifyUrl(report.verificationCode);
    const doc = await PDFDocument.create();

    // Metadata is set explicitly, every field of it. pdf-lib otherwise stamps
    // its own Producer and Creator, and a field left to a default is a field
    // nobody is checking the day something vendor-shaped gets written into it.
    doc.setTitle(`QC inspection report ${serialNumber}`);
    doc.setSubject(`Inspection and grade for one unit, verifiable at ${verifyUrl}`);
    doc.setAuthor(BRAND.name);
    doc.setProducer(BRAND.name);
    doc.setCreator(BRAND.name);
    doc.setKeywords(['QC report', 'refurbished laptop', serialNumber]);
    doc.setCreationDate(this.clock.now());
    doc.setModificationDate(this.clock.now());

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const sheet = new Sheet(doc, font, bold);

    this.drawHeader(sheet, report, serialNumber, verifyUrl);
    this.drawVerdict(sheet, report, band);
    this.drawHardware(sheet, hardware);
    this.drawAreas(sheet, areas);
    this.drawSealAndWipe(sheet, seals[0] ?? null, wipes[0] ?? null);
    this.drawProvenance(sheet, report, technician?.employeeCode ?? null, certificateId);
    sheet.footer(verifyUrl);

    await this.drawPhotos(sheet, photos, verifyUrl);

    // `useObjectStreams: false` keeps the document's own dictionaries — the
    // metadata among them — as plain objects rather than inside a compressed
    // object stream. It costs a few hundred bytes and it means the anti-leak
    // sweep can read what it is asserting about.
    const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));

    return {
      bytes,
      filename: `${BRAND.name}-QC-report-${serialNumber}.pdf`,
      verifyUrl,
    };
  }

  /**
   * The URL the QR resolves to.
   *
   * The public route on this API, not a new one. When the storefront renders the
   * same passport at its own `/qc/verify/:code`, this constant is the only thing
   * that moves — the code in it stays the code in the database.
   */
  private verifyUrl(code: string): string {
    return `${this.config.get('API_PUBLIC_URL').replace(/\/+$/, '')}/api/qc/verify/${code}`;
  }

  /**
   * The band the final grade was awarded under, as of the inspection date.
   *
   * Resolved on the report's own start date rather than today: a report written
   * before a threshold changed has to stay readable against the numbers that
   * applied when it was written, which is the whole point of the effective
   * dating on `catalog.grade_definition`.
   */
  private async gradeBand(report: QcReportRow): Promise<string | null> {
    if (!report.gradeFinal) return null;
    const set = await this.tolerance.resolve(istDate(report.startedAt));
    const t = set.gradeThresholds[report.gradeFinal];
    const cycles = Number.isFinite(t.maxCycleCount)
      ? `at most ${t.maxCycleCount} charge cycles`
      : 'no charge-cycle ceiling';
    return `battery health ${t.minBatteryHealthPct}% or better, ${cycles} (rules ${set.version})`;
  }

  /** DeviceSure's own certificate id — `qc_tool_run.tool_run_id`, theirs not ours. */
  private async deviceSureCertificateId(toolRunId: string | null): Promise<string | null> {
    if (!toolRunId) return null;
    const run = await this.repo.findToolRunById(toolRunId);
    return run?.toolRunId ?? null;
  }

  // -------------------------------------------------------------------------
  // Sections. Every value drawn is named here; nothing is iterated off a row.
  // -------------------------------------------------------------------------

  private drawHeader(
    sheet: Sheet,
    report: QcReportRow,
    serialNumber: string,
    verifyUrl: string,
  ): void {
    const right = PAGE[0] - MARGIN - QR_SIZE;

    sheet.text(BRAND.name, { size: 17, font: 'bold' });
    sheet.text('Quality inspection report', { size: 11, colour: MUTED });
    sheet.gap(6);
    sheet.text(`Serial ${serialNumber}`, { size: 19, font: 'bold' });
    sheet.gap(2);

    drawQr(sheet.page, verifyUrl, right, PAGE[1] - MARGIN - QR_SIZE, QR_SIZE);
    sheet.page.drawText('Scan to verify this report', {
      x: right,
      y: PAGE[1] - MARGIN - QR_SIZE - 11,
      size: 7.5,
      font: sheet.fonts.bold,
      color: INK,
    });
    // The code in text as well as in the QR: a phone camera that will not focus
    // in a dim receiving bay still leaves a fourteen-character code somebody can
    // type. The alphabet has no I, L, O or U for exactly that reason.
    sheet.page.drawText(report.verificationCode ?? '', {
      x: right,
      y: PAGE[1] - MARGIN - QR_SIZE - 21,
      size: 7.5,
      font: sheet.fonts.regular,
      color: MUTED,
    });

    sheet.gap(10);
    sheet.rule();
  }

  private drawVerdict(sheet: Sheet, report: QcReportRow, band: string | null): void {
    const expired = report.validUntil !== null && report.validUntil < this.clock.todayInIst();

    sheet.gap(4);
    // `grade_final`, never `grade_proposed`. The proposed grade is the tool's
    // opinion; the final grade is our claim, and `chk_override_reason` is what
    // makes any difference between the two accountable.
    sheet.text(
      `${report.verdict ?? 'INCOMPLETE'}   Grade ${report.gradeFinal ?? 'not assigned'}   Score ${
        report.qcScore ?? '--'
      }/100`,
      { size: 15, font: 'bold' },
    );
    if (band) sheet.text(`Grade band: ${band}`, { size: 8.5, colour: MUTED });
    sheet.gap(4);

    sheet.kv('Inspected on', report.completedAt ? istDate(report.completedAt) : 'in progress');
    sheet.kv(
      'Valid until',
      report.validUntil
        ? `${report.validUntil}${expired ? '   THIS INSPECTION HAS EXPIRED' : ''}`
        : 'not applicable',
    );
    sheet.gap(6);
  }

  private drawHardware(sheet: Sheet, hw: Awaited<ReturnType<QcRepository['findHardware']>>): void {
    sheet.heading('Hardware detected by the inspection tool');
    if (!hw) {
      sheet.text('No tool reading is on file for this inspection.', { colour: MUTED });
      sheet.gap(6);
      return;
    }

    sheet.kv('Model', hw.hwModel);
    sheet.kv('Processor', hw.cpuDetected);
    // Reported exactly as the tool measured it — 15 GB on a 16 GB Windows
    // machine (07 §3.4). A `+1` anywhere in this stack would be us quietly
    // correcting our own source in a document a buyer relies on.
    sheet.kv(
      'Memory',
      `${hw.ramDetectedGb} GB usable${hw.ramModules ? ` · ${hw.ramModules} module(s)` : ''}${
        hw.ramType ? ` · ${hw.ramType}` : ''
      }`,
    );
    sheet.kv(
      'Storage',
      hw.storageDetectedGb
        ? `${hw.storageDetectedGb} GB${hw.storageType ? ` ${hw.storageType}` : ''}`
        : hw.storageType,
    );
    sheet.kv('Graphics', hw.gpuDetected);
    sheet.kv('Screen', hw.screenSize === null ? null : `${hw.screenSize} in`);
    sheet.kv('Drive SMART status', hw.smartStatus);
    sheet.kv(
      'Battery health',
      hw.batteryHealthPct === null ? null : `${hw.batteryHealthPct}% of design capacity`,
    );
    // Null is "not reported", which is not zero. A cycle count of 0 on a worn
    // battery is a collector defaulting, and printing it as 0 would be a claim.
    sheet.kv('Charge cycles', hw.cycleCount === null ? null : String(hw.cycleCount));
    sheet.kv('TPM', hw.tpmVersion);
    sheet.kv('Secure Boot', hw.secureBoot === null ? null : hw.secureBoot ? 'enabled' : 'disabled');
    sheet.gap(6);
  }

  private drawAreas(
    sheet: Sheet,
    areas: Awaited<ReturnType<QcRepository['findAreaResults']>>,
  ): void {
    sheet.heading('Condition, area by area');
    if (areas.length === 0) {
      sheet.text('No area scores are on file for this inspection.', { colour: MUTED });
      sheet.gap(6);
      return;
    }

    // Two columns; the twelve areas are a fixed set, so this never wraps oddly.
    const half = Math.ceil(areas.length / 2);
    const top = sheet.y;
    let lowest = top;
    areas.forEach((a, i) => {
      const column = i < half ? 0 : 1;
      const x = MARGIN + column * 250;
      const y = top - (i - column * half) * LEAD;
      sheet.at(x, y, a.area.replace(/_/g, ' '), { size: BODY, font: 'bold' });
      sheet.at(x + 130, y, `${a.score}/${a.maxScore}   ${a.status}`, { size: BODY });
      lowest = Math.min(lowest, y);
    });
    sheet.y = lowest - LEAD - 6;
  }

  private drawSealAndWipe(
    sheet: Sheet,
    seal: Awaited<ReturnType<QcRepository['findSealsByUnit']>>[number] | null,
    wipe: Awaited<ReturnType<QcRepository['findWipeCertificates']>>[number] | null,
  ): void {
    sheet.heading('Seal and data wipe');
    // The seal is what makes a twelve-minute inspection mean something three
    // weeks later, because the machine stays with our supplier in between. The
    // clerk checks this code against the sticker before signing.
    sheet.kv(
      'Tamper seal',
      seal ? `${seal.sealCode} · ${seal.status} · applied ${istDate(seal.appliedAt)}` : null,
    );
    sheet.kv(
      'Data wipe',
      wipe
        ? `${wipe.standard} · ${wipe.method} · ${wipe.passes} pass(es) · ${
            wipe.verificationStatus
          } · ${istDate(wipe.issuedAt)}`
        : null,
    );
    sheet.gap(6);
  }

  private drawProvenance(
    sheet: Sheet,
    report: QcReportRow,
    employeeCode: string | null,
    certificateId: string | null,
  ): void {
    sheet.heading('Provenance');
    // The technician's employee code, never their name: pseudonymous by design
    // (03_UX_SPEC.md §3A), and enough to trace an inspection internally.
    sheet.kv('Inspected by', employeeCode);
    sheet.kv('Rule set', report.rulesVersion);
    sheet.kv(`${BRAND.qcProduct} certificate`, certificateId);
    sheet.gap(6);
  }

  /**
   * The photographs, embedded as bytes.
   *
   * Embedded rather than linked on purpose: a link would carry an object key,
   * and an object key is a place a supplier's slug has leaked before. A photo we
   * cannot fetch or decode is left out rather than failing the document — the
   * grade, the seal code and the QR are what the clerk at the door needs, and
   * they do not depend on the images.
   */
  private async drawPhotos(sheet: Sheet, photos: QcPhotoRow[], verifyUrl: string): Promise<void> {
    const embedded: Array<{ angle: string; image: PDFImage }> = [];
    for (const photo of photos) {
      const image = await this.embed(sheet.doc, photo.fileKey);
      if (image) embedded.push({ angle: photo.angle, image });
    }
    if (embedded.length === 0) return;

    sheet.newPage();
    sheet.text('Photographs taken at inspection', { size: 13, font: 'bold' });
    sheet.gap(4);
    sheet.rule();
    sheet.gap(8);

    const cellWidth = (PAGE[0] - MARGIN * 2 - 16 * (PHOTO_COLUMNS - 1)) / PHOTO_COLUMNS;
    const cellHeight = 150;
    embedded.forEach((p, i) => {
      const column = i % PHOTO_COLUMNS;
      if (column === 0 && i > 0) sheet.y -= cellHeight + 26;
      const x = MARGIN + column * (cellWidth + 16);
      const box = p.image.scaleToFit(cellWidth, cellHeight);
      sheet.page.drawImage(p.image, {
        x,
        y: sheet.y - box.height,
        width: box.width,
        height: box.height,
      });
      sheet.at(x, sheet.y - cellHeight - 12, p.angle.replace(/_/g, ' '), {
        size: 8,
        font: 'bold',
      });
    });
    sheet.y -= cellHeight + 26;
    sheet.footer(verifyUrl);
  }

  private async embed(doc: PDFDocument, key: string): Promise<PDFImage | null> {
    try {
      const bytes = await this.store.get(key);
      const png = bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50;
      return png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      // A missing object or a frame in a format the embedder does not read.
      // Neither is a reason to withhold the report.
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * A cursor over the document: pages, a running `y`, and the four kinds of line
 * this report draws. It exists so the section methods above read as content
 * rather than as coordinates, which is the difference between a layout somebody
 * can change and one nobody dares to.
 */
class Sheet {
  page: PDFPage;
  y: number;
  readonly fonts: { regular: PDFFont; bold: PDFFont };

  constructor(
    readonly doc: PDFDocument,
    regular: PDFFont,
    bold: PDFFont,
  ) {
    this.fonts = { regular, bold };
    this.page = doc.addPage(PAGE);
    this.y = PAGE[1] - MARGIN - 12;
  }

  newPage(): void {
    this.page = this.doc.addPage(PAGE);
    this.y = PAGE[1] - MARGIN - 12;
  }

  gap(points: number): void {
    this.y -= points;
  }

  at(
    x: number,
    y: number,
    value: string,
    opts: { size?: number; font?: 'regular' | 'bold'; colour?: typeof INK } = {},
  ): void {
    this.page.drawText(pdfSafe(value), {
      x,
      y,
      size: opts.size ?? BODY,
      font: opts.font === 'bold' ? this.fonts.bold : this.fonts.regular,
      color: opts.colour ?? INK,
    });
  }

  text(
    value: string,
    opts: { size?: number; font?: 'regular' | 'bold'; colour?: typeof INK } = {},
  ): void {
    this.at(MARGIN, this.y, value, opts);
    this.y -= (opts.size ?? BODY) + 4;
  }

  heading(value: string): void {
    this.gap(4);
    this.text(value.toUpperCase(), { size: 8.5, font: 'bold', colour: MUTED });
    this.rule();
    this.gap(6);
  }

  /** A labelled value. `null` prints as "not recorded", never as a blank line. */
  kv(label: string, value: string | null): void {
    this.at(MARGIN, this.y, label, { font: 'bold' });
    this.at(MARGIN + 130, this.y, value ?? 'not recorded', {
      colour: value === null ? MUTED : INK,
    });
    this.y -= LEAD;
  }

  rule(): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE[0] - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 4;
  }

  footer(verifyUrl: string): void {
    this.at(
      MARGIN,
      MARGIN - 8,
      `This report describes the single machine identified by the serial above. Verify it at ${verifyUrl}`,
      { size: 7.5, colour: MUTED },
    );
  }
}

/**
 * The QR, drawn as filled squares rather than embedded as a raster.
 *
 * A vector QR stays sharp at any print size and costs no image encoder. The
 * modules are drawn a third of a point oversized because adjacent rectangles at
 * fractional coordinates leave hairline gaps under some renderers' anti-aliasing,
 * and a hairline through a finder pattern is a code a phone will not read.
 */
function drawQr(page: PDFPage, url: string, x: number, y: number, size: number): void {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();

  const count = qr.getModuleCount();
  // Four modules of quiet zone is what the spec requires; without it a reader
  // cannot find the edges against a busy page.
  const quiet = 4;
  const module = size / (count + quiet * 2);

  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (!qr.isDark(row, column)) continue;
      page.drawRectangle({
        x: x + (column + quiet) * module,
        y: y + size - (row + quiet + 1) * module,
        width: module + 0.3,
        height: module + 0.3,
        color: rgb(0, 0, 0),
      });
    }
  }
}

/**
 * The standard PDF fonts encode WinAnsi, which stops at U+00FF — and model and
 * CPU strings arrive from a third-party tool that emits trademark signs and
 * smart quotes above it. An unencodable character makes the writer throw, so
 * without this the whole report fails to generate because a laptop's model name
 * ends in a "™". Latin-1 and below is kept, which covers everything this
 * document says, the middle dot included; anything above it becomes a space.
 */
function pdfSafe(value: string): string {
  return value.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A `Date` on the Asia/Kolkata calendar, as `YYYY-MM-DD` (VR-160). */
function istDate(when: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(when);
}
