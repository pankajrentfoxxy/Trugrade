/**
 * The printed QC report, against the real database.
 *
 * This document is the one artefact of the whole system that leaves our control
 * completely: it is printed, put in the box, and handed to a stranger at a
 * receiving bay. Two properties have to hold every time, and neither can be
 * checked by reading the source once.
 *
 *   1. **The QR resolves to this machine's verification code.** Asserted by
 *      rebuilding the QR matrix for the URL the service says it encoded and
 *      comparing it module by module against the squares actually drawn in the
 *      page's content stream — so a report that draws a stale or a wrong code
 *      fails here rather than at a customer's door — and then by looking that
 *      code up through the same passport service the public route serves.
 *
 *   2. **No vendor identity anywhere in the file.** We are the principal; the
 *      buyer never learns who supplied the machine. "Anywhere" is the hard part,
 *      so the sweep below reads the raw bytes, inflates every compressed stream,
 *      decodes the hex strings PDF text is written as, and reads the document
 *      metadata back through a parser — then greps all of it, plus the filename.
 *      The vendor's GSTIN is planted in an S3 object key that this report legitimately
 *      reads from, which is exactly the leak `PHASE_05` names: a key path with a
 *      supplier identifier in it, travelling inside a customer document.
 *
 * The positive assertions in the sweep are not decoration. A test that greps an
 * empty haystack passes forever; asserting the serial and the seal code *are*
 * found is what proves the extraction works and the absences mean something.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { ObjectStorePort } from '../../src/shared/adapters/ports';
import { FakeObjectStore } from '../../src/shared/adapters/fakes/infra.fakes';
import { ObjectUrlSigner } from '../../src/shared/adapters/object-url';
import { PreconditionFailedError } from '../../src/shared/errors/domain-errors';
import {
  QcRepository,
  generateVerificationCode,
  type AreaResultInput,
} from '../../src/modules/qc/internal/qc.repository';
import { ToleranceService } from '../../src/modules/qc/internal/tolerance.service';
import {
  ReportPdfService,
  type QcReportPdf,
} from '../../src/modules/qc/internal/report-pdf.service';
import { QcPassportService } from '../../src/modules/qc/qc-public.controller';
import { QC_AREA_CODES } from '../../src/modules/qc/dto/qc.dto';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization, seedSellableUnit } from '../support/factories';

/**
 * The supplier nobody buying a laptop is allowed to learn about. Every string
 * here is planted somewhere the report reads from, so the sweep is testing a
 * real path rather than an imaginary one.
 */
const VENDOR = {
  legalName: 'Northwind Refurb Traders Private Limited',
  tradeName: 'Northwind Devices',
  gstin: '06AABCN1234M1Z7',
};

/** A 1x1 PNG. Enough to prove the embedder ran; nothing is being looked at. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const ALL_PASS: AreaResultInput[] = QC_AREA_CODES.map((area) => ({
  area,
  score: 9,
  maxScore: 10,
  status: 'PASS' as const,
}));

let moduleRef: TestingModule;
let prisma: PrismaService;
let repo: QcRepository;
let pdfs: ReportPdfService;
let passports: QcPassportService;
let store: FakeObjectStore;
let clock: FixedClock;
let raw: PrismaClient;

let vendorOrgId: string;
let unitId: string;
let reportId: string;
let serial: string;
let sealCode: string;
let verificationCode: string;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  // Pinned to the database's own CURRENT_DATE. The seeded tolerance rules and
  // grade definitions take `effective_from = CURRENT_DATE` at migration time, so
  // a clock in the past resolves an empty rule set and the grade band cannot be
  // stated — which this service treats, correctly, as a reason not to print.
  const [today] = await raw.$queryRaw<Array<{ d: string }>>`SELECT CURRENT_DATE::text AS d`;
  clock = new FixedClock(new Date(`${today!.d}T06:00:00.000Z`));
  // The store mints photo URLs for the passport, so it needs the same signer
  // the app wires in — on the pinned clock, so a token expiry is testable.
  const storeConfig = new AppConfig();
  store = new FakeObjectStore(new ObjectUrlSigner(storeConfig, clock), storeConfig);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: clock },
      { provide: ObjectStorePort, useValue: store },
      {
        provide: PrismaService,
        useFactory: (config: AppConfig) => {
          Object.defineProperty(config, 'env', {
            value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
          });
          return new PrismaService(config);
        },
        inject: [AppConfig],
      },
      QcRepository,
      ToleranceService,
      ReportPdfService,
      QcPassportService,
    ],
  }).compile();

  prisma = moduleRef.get(PrismaService);
  repo = moduleRef.get(QcRepository);
  pdfs = moduleRef.get(ReportPdfService);
  passports = moduleRef.get(QcPassportService);
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);

  vendorOrgId = await makeOrganization({ legal_name: VENDOR.legalName }, raw);
  await raw.$executeRaw`
    UPDATE identity.organization SET trade_name = ${VENDOR.tradeName}
     WHERE id = ${vendorOrgId}::uuid`;

  const unit = await seedSellableUnit({ vendorOrgId }, raw);
  unitId = unit.unitId;
  serial = unit.serial;
  reportId = unit.qcReportId!;

  verificationCode = generateVerificationCode();
  await raw.$executeRaw`
    UPDATE qc.qc_report SET verification_code = ${verificationCode}
     WHERE id = ${reportId}::uuid`;

  const [seal] = await raw.$queryRaw<Array<{ seal_code: string }>>`
    SELECT seal_code FROM qc.qc_seal WHERE unit_id = ${unitId}::uuid`;
  sealCode = seal!.seal_code;

  await repo.upsertAreaResults(reportId, ALL_PASS);
  await repo.upsertHardware(reportId, {
    hwSerial: serial,
    // A trademark sign, straight from a third-party tool's model string. The
    // standard PDF fonts cannot encode it, so an unsanitised renderer throws
    // here and a buyer's report fails on the model name.
    hwModel: 'Latitude 5420™',
    cpuDetected: 'Intel Core i5-1145G7',
    ramDetectedGb: 15,
    ramModules: 2,
    ramType: 'DDR4',
    storageType: 'NVME',
    storageDetectedGb: 512,
    smartStatus: 'OK',
    screenSize: 14,
    batteryHealthPct: 91,
    cycleCount: 142,
    tpmVersion: '2.0',
    secureBoot: true,
  });

  // Both keys carry the supplier's GSTIN, which is how object keys are built by
  // anyone who has not been told not to. The report reads the bytes behind them
  // and must carry neither key.
  const photoKey = `qc/photos/${VENDOR.gstin}/${unitId}/LID.png`;
  await store.put(photoKey, PIXEL_PNG, 'image/png');
  await repo.insertPhotos(reportId, [{ angle: 'LID', fileKey: photoKey, hash: 'sha256:lid' }]);

  await repo.insertWipeCertificate({
    unitId,
    method: 'NVME_SANITIZE',
    standard: 'NIST_800_88_PURGE',
    passes: 1,
    verificationStatus: 'VERIFIED',
    certificateKey: `wipe/${VENDOR.gstin}/${unitId}.pdf`,
  });
});

describe('generating the report', () => {
  it('prints the current report for a passed unit', async () => {
    const pdf = await pdfs.renderBySerial(serial);

    expect(pdf).not.toBeNull();
    expect(pdf!.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf!.filename).toBe(`Trugrade-QC-report-${serial}.pdf`);

    // Two pages: the report, and the photographs that were embeddable.
    const parsed = await PDFDocument.load(pdf!.bytes, { updateMetadata: false });
    expect(parsed.getPageCount()).toBe(2);

    const text = extract(pdf!);
    expect(text).toContain(serial.toLowerCase());
    expect(text).toContain(sealCode.toLowerCase());
    expect(text).toContain('pass');
    expect(text).toContain('grade a');
    // The tool's own reading, uncorrected, and the model name with the sign the
    // font cannot encode stripped rather than thrown on.
    expect(text).toContain('15 gb usable');
    expect(text).toContain('latitude 5420');
    // The band the grade was awarded under, and the rule version behind it.
    expect(text).toContain('grade band');
    expect(text).toContain('rules tol:');
  });

  it('is absent for a machine with no inspection on file', async () => {
    expect(await pdfs.renderBySerial('NOSUCHSERIAL9')).toBeNull();
  });

  it('refuses to print a report that has no verification code', async () => {
    // A printed report a buyer cannot verify looks like evidence and is not.
    await raw.$executeRaw`
      UPDATE qc.qc_report SET verification_code = NULL WHERE id = ${reportId}::uuid`;
    await expect(pdfs.renderBySerial(serial)).rejects.toBeInstanceOf(PreconditionFailedError);
  });
});

describe('the QR code', () => {
  it('encodes the public verification URL for this machine, module for module', async () => {
    const pdf = (await pdfs.renderBySerial(serial))!;

    expect(pdf.verifyUrl).toBe(`http://localhost:4000/api/qc/verify/${verificationCode}`);

    // Rebuild the matrix for that URL and compare it against the squares that
    // were actually drawn. A QR built from a different code — a superseded
    // report's, or a serial-shaped guess — produces a different matrix and fails
    // here, which is the only way to prove the scan lands on the right machine
    // without shipping a decoder into the test suite.
    const qr = qrcode(0, 'M');
    qr.addData(pdf.verifyUrl);
    qr.make();
    const count = qr.getModuleCount();

    const expected: string[] = [];
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (qr.isDark(row, column)) expected.push(`${row},${column}`);
      }
    }

    const dark = rectangles(pdf).filter((r) => r.colour === '0 0 0');
    expect(dark.length).toBe(expected.length);

    // The three finder patterns put a dark module in the left-most column, the
    // right-most column and the top row, so the extremes of what was drawn are
    // the extremes of the matrix and the grid can be recovered from them.
    const minX = Math.min(...dark.map((r) => r.x));
    const maxX = Math.max(...dark.map((r) => r.x));
    const topY = Math.max(...dark.map((r) => r.y));
    const module = (maxX - minX) / (count - 1);
    const drawn = dark.map(
      (r) => `${Math.round((topY - r.y) / module)},${Math.round((r.x - minX) / module)}`,
    );

    expect(drawn.sort()).toEqual(expected.sort());
  });

  it('resolves to the passport the public route serves for this machine', async () => {
    const pdf = (await pdfs.renderBySerial(serial))!;
    const code = pdf.verifyUrl.split('/').pop()!;

    // The same call `GET /api/qc/verify/:code` makes. Nothing about this path is
    // new: the printed report points at the verification route that already
    // exists, and a second one would be a second thing to keep unguessable.
    const passport = await passports.byVerificationCode(code);

    expect(passport).not.toBeNull();
    expect(passport!.serialNumber).toBe(serial);
    expect(passport!.seal?.code).toBe(sealCode);
  });
});

describe('the anonymity sweep', () => {
  it('carries no vendor identity in the bytes, the filename or the metadata', async () => {
    const pdf = (await pdfs.renderBySerial(serial))!;
    // `updateMetadata: false`, or the reader rewrites Producer to its own name
    // on the way in and the assertions below would be testing the parser.
    const parsed = await PDFDocument.load(pdf.bytes, { updateMetadata: false });

    const haystack = [
      extract(pdf),
      pdf.filename,
      parsed.getTitle() ?? '',
      parsed.getAuthor() ?? '',
      parsed.getSubject() ?? '',
      parsed.getProducer() ?? '',
      parsed.getCreator() ?? '',
      parsed.getKeywords() ?? '',
    ]
      .join('\n')
      .toLowerCase();

    // Proof the haystack is real before anything is asserted absent from it.
    expect(haystack).toContain(serial.toLowerCase());
    expect(haystack).toContain(sealCode.toLowerCase());

    expect(haystack).not.toContain(VENDOR.legalName.toLowerCase());
    expect(haystack).not.toContain('northwind');
    expect(haystack).not.toContain(VENDOR.tradeName.toLowerCase());
    // The GSTIN reached this document twice over, through the photograph key and
    // the wipe-certificate key, and travelled in neither.
    expect(haystack).not.toContain(VENDOR.gstin.toLowerCase());
    expect(haystack).not.toContain(vendorOrgId.toLowerCase());
    // Nor the object keys themselves, in any form.
    expect(haystack).not.toContain('qc/photos/');
    expect(haystack).not.toContain('qc/seals/');
    expect(haystack).not.toContain('wipe/');

    // The metadata is ours and stated, not the writing library's default.
    expect(parsed.getAuthor()).toBe('Trugrade');
    expect(parsed.getProducer()).toBe('Trugrade');
    expect(parsed.getCreator()).toBe('Trugrade');
  });
});

// ---------------------------------------------------------------------------
// Reading a PDF back
// ---------------------------------------------------------------------------

/**
 * Everything legible in the file, lower-cased: the raw bytes, every inflated
 * stream, and the hex strings PDF text is written as.
 *
 * The raw bytes alone would prove nothing — page content is Flate-compressed and
 * text inside it is hex-encoded, so a supplier's name could sit in a file that a
 * naive `bytes.includes(name)` swears is clean.
 */
function extract(pdf: QcReportPdf): string {
  const parts = [pdf.bytes.toString('latin1'), inflated(pdf.bytes)];
  const hex = /<([0-9A-Fa-f]{2,})>/g;
  for (const part of [...parts]) {
    let match: RegExpExecArray | null;
    while ((match = hex.exec(part)) !== null) {
      parts.push(Buffer.from(match[1]!, 'hex').toString('latin1'));
    }
  }
  return parts.join('\n').toLowerCase();
}

function inflated(bytes: Buffer): string {
  const text = bytes.toString('latin1');
  const starts = /stream\r?\n/g;
  let out = '';
  let match: RegExpExecArray | null;
  while ((match = starts.exec(text)) !== null) {
    const from = match.index + match[0].length;
    const to = text.indexOf('endstream', from);
    if (to < 0) continue;
    try {
      out += `\n${inflateSync(Buffer.from(text.slice(from, to), 'latin1')).toString('latin1')}`;
    } catch {
      // An image stream, or anything else not Flate. Not what this is reading.
    }
  }
  return out;
}

/**
 * The filled rectangles in the content streams.
 *
 * pdf-lib emits a rectangle as a fill colour, a translation and a four-sided
 * path rather than as a `re` operator, so this matches that shape: colour, then
 * the `cm` that carries the origin, then the corner the width and height fall
 * out of.
 */
function rectangles(pdf: QcReportPdf): Array<{ colour: string; x: number; y: number }> {
  const shape =
    /(\d[\d. ]*?) rg\s+0 w\s+\[\] 0 d\s+1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\s+1 0 0 1 0 0 cm\s+1 0 0 1 0 0 cm\s+0 0 m/g;
  const found: Array<{ colour: string; x: number; y: number }> = [];
  let match: RegExpExecArray | null;
  const content = inflated(pdf.bytes);
  while ((match = shape.exec(content)) !== null) {
    found.push({ colour: match[1]!.trim(), x: Number(match[2]), y: Number(match[3]) });
  }
  return found;
}
