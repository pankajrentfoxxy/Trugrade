import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { VERIFICATION_CODE_ALPHABET, VERIFICATION_CODE_LENGTH } from '@trugrade/contracts';
import { FakeObjectStore } from '../../src/shared/adapters/fakes/infra.fakes';
import { ObjectUrlSigner } from '../../src/shared/adapters/object-url';
import { AppConfig } from '../../src/shared/config';
import { SystemClock } from '../../src/shared/clock';

/** The object store the API resolves, built by hand because a seed has no container. */
function newObjectStore(): FakeObjectStore {
  const config = new AppConfig();
  return new FakeObjectStore(new ObjectUrlSigner(config, new SystemClock()), config);
}
import { generateVerificationCode } from '../../src/modules/qc/internal/qc.repository';
import { QC_AREA_CODES, QC_PHOTO_ANGLES } from '../../src/modules/qc/dto/qc.dto';
import { standInImage } from './stand-in-image';

/**
 * The evidence a unit passport is supposed to show, for units that already have
 * a QC report.
 *
 * Three of the passport's five evidence panels had no data at all: `qc_photo`,
 * `qc_area_result` and `wipe_certificate` were empty against 239 reports and 239
 * seals. A screen built on that renders "Not available" five times and gets
 * screenshotted as finished.
 *
 * It runs as a pass over existing reports rather than inside `seedOffer`,
 * because `seedOffer` returns early for a listing it has already written — so a
 * developer with a seeded database would never get the evidence at all.
 *
 * WHAT IS DELIBERATELY MISSING, AND WHY. Some areas are not measured, some units
 * have no wipe certificate. `A missing value never renders as a passing one` is
 * the rule this evidence exists to demonstrate, and it cannot be demonstrated
 * against data where everything is present. The gaps are not random: an area
 * read from the diagnostic tool is absent exactly where the tool reported no
 * hardware, which is what would actually have happened.
 */

/** How many marks an area is scored out of. */
const MAX_AREA_SCORE = 10;

/** Below this an area carries a finding. Nothing here goes to FAIL — see below. */
const WARN_BELOW = 8;

/**
 * The floor an area score is clamped to.
 *
 * Every seeded report is a `PASS`, and PHASE_04 Task 2 says a certificate whose
 * grade is inconsistent with a FAIL component must be rejected rather than
 * trusted. Writing a FAIL area under a PASS verdict would seed exactly the
 * corruption the ingestion path exists to refuse.
 */
const PASS_AREA_FLOOR = 6;

interface ReportRow {
  id: string;
  unit_id: string;
  qc_score: number | null;
  has_hardware: boolean;
  seal_photo_key: string | null;
}

export interface QcEvidenceCounts {
  areaResults: number;
  photos: number;
  wipeCertificates: number;
  sealPhotos: number;
  verificationCodesRepaired: number;
}

/**
 * Rewrite verification codes the public route will not accept.
 *
 * An earlier seed minted them as `randomBytes(9).toString('base64url')` — twelve
 * characters of mixed-case base64, which satisfies the
 * `chk_verification_code_unguessable` length backstop and fails
 * `verificationCodeSchema` outright. So `GET /qc/verify/:code` answered **422 on
 * every demo unit**: the QR on the printed report resolved to a validation
 * error, and the whole certificate-verification screen had nothing to load.
 *
 * Rewriting a code that is already printed on a document would be wrong. These
 * cannot be: a code the route refuses has never verified anything, so there is
 * no working link to break. New rows come from `generateVerificationCode()`,
 * which is the one generator, so this repair deletes itself.
 */
async function repairVerificationCodes(prisma: PrismaClient): Promise<number> {
  const broken = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM qc.qc_report
     WHERE verification_code IS NOT NULL
       AND verification_code !~ ${`^[${VERIFICATION_CODE_ALPHABET}]{${VERIFICATION_CODE_LENGTH}}$`}`;

  for (const row of broken) {
    await prisma.$executeRaw`
      UPDATE qc.qc_report SET verification_code = ${generateVerificationCode()}
       WHERE id = ${row.id}::uuid`;
  }
  return broken.length;
}

/** Stable across runs and machines, which is what makes the gaps reproducible. */
function stableHash(value: string): number {
  return createHash('sha256').update(value).digest().readUInt32BE(0);
}

/**
 * Which of the twelve areas this inspection did not measure.
 *
 * Returned as codes to LEAVE OUT: `qc_area_result.status` has a CHECK of
 * PASS/WARN/FAIL and no NOT_MEASURED, so an unmeasured area is an absent row.
 * The passport turns that absence back into an explicit `NOT_MEASURED`.
 */
function unmeasuredAreas(report: ReportRow, serial: string): Set<string> {
  const out = new Set<string>();
  // BATTERY, STORAGE and MEMORY_CPU are read off the diagnostic tool. No
  // detected-hardware row means the tool did not report, so claiming a result
  // for the three areas it feeds would be inventing a measurement.
  if (!report.has_hardware) {
    out.add('BATTERY').add('STORAGE').add('MEMORY_CPU');
  }
  // One area a technician plausibly could not check on site, on a sixth of the
  // fleet — so the not-measured state is reachable on a unit whose tool run was
  // otherwise complete, rather than only on the few with no hardware at all.
  if (stableHash(`camera:${serial}`) % 6 === 0) out.add('CAMERA_AUDIO');
  return out;
}

export async function seedQcEvidence(
  prisma: PrismaClient,
  log: (m: string) => void = () => undefined,
): Promise<QcEvidenceCounts> {
  const store = newObjectStore();
  const verificationCodesRepaired = await repairVerificationCodes(prisma);

  // The seed's own seal keys, normalised to the extension the bytes actually
  // are. Scoped to `qc/seals/%` because a seal applied through the API takes its
  // key from `photoKey()` and lives under `qc/photos/`; those are a technician's
  // real uploads and are not this script's to rewrite.
  await prisma.$executeRaw`
    UPDATE qc.qc_seal SET applied_photo_key = regexp_replace(applied_photo_key, '\.jpg$', '.svg')
     WHERE applied_photo_key LIKE 'qc/seals/%.jpg'`;

  const reports = await prisma.$queryRaw<ReportRow[]>`
    SELECT r.id, r.unit_id, r.qc_score,
           (h.qc_report_id IS NOT NULL) AS has_hardware,
           s.applied_photo_key AS seal_photo_key
      FROM qc.qc_report r
      LEFT JOIN qc.qc_hardware_detected h ON h.qc_report_id = r.id
      LEFT JOIN qc.qc_seal s ON s.qc_report_id = r.id
     WHERE r.is_current
     ORDER BY r.id`;
  if (reports.length === 0) {
    log('  qc evidence: no current reports to attach evidence to');
    return {
      areaResults: 0,
      photos: 0,
      wipeCertificates: 0,
      sealPhotos: 0,
      verificationCodesRepaired,
    };
  }

  // Two queries and a join in memory rather than one cross-schema JOIN. The
  // serial is the label on every stand-in, so it has to be here.
  const units = await prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
    SELECT id, serial_number FROM listing.unit
     WHERE id = ANY(${reports.map((r) => r.unit_id)}::uuid[])`;
  const serialOf = new Map(units.map((u) => [u.id, u.serial_number]));

  const counts: QcEvidenceCounts = {
    areaResults: 0,
    photos: 0,
    wipeCertificates: 0,
    sealPhotos: 0,
    verificationCodesRepaired,
  };

  for (const report of reports) {
    const serial = serialOf.get(report.unit_id) ?? report.unit_id;
    const skip = unmeasuredAreas(report, serial);
    const base = (report.qc_score ?? 85) / 10;

    // --- the twelve areas, minus the ones nobody measured --------------------
    const measured = QC_AREA_CODES.filter((a) => !skip.has(a));
    const scores = measured.map((area) => {
      // Centred on the report's own headline score so the areas and the number
      // above them are one story. A passport showing 80 over twelve perfect
      // areas is two claims that contradict each other.
      const wobble = ((stableHash(`${serial}:${area}`) % 25) - 12) / 10;
      const raw = Math.min(MAX_AREA_SCORE, Math.max(PASS_AREA_FLOOR, base + wobble));
      return Math.round(raw * 10) / 10;
    });

    await prisma.$executeRaw`
      INSERT INTO qc.qc_area_result (qc_report_id, area, score, max_score, status)
      SELECT ${report.id}::uuid, a, s::numeric, ${MAX_AREA_SCORE}::numeric,
             CASE WHEN s::numeric >= ${WARN_BELOW}::numeric THEN 'PASS' ELSE 'WARN' END
        FROM unnest(${measured as string[]}::text[], ${scores.map(String)}::text[]) AS t(a, s)
      ON CONFLICT (qc_report_id, area) DO UPDATE
        SET score = EXCLUDED.score, max_score = EXCLUDED.max_score, status = EXCLUDED.status`;
    counts.areaResults += measured.length;

    // --- the technician's photographs ---------------------------------------
    for (const angle of QC_PHOTO_ANGLES) {
      const stand = standInImage({
        heading: angle.replace(/_/g, ' '),
        detail: [serial, 'TECHNICIAN PHOTOGRAPH', `SCORE ${report.qc_score ?? '—'} / 100`],
      });
      // Content-addressed, exactly as `photoKey()` builds a real one: the hash
      // column and the key agree because they are the same hash of the same
      // bytes, which is what makes a re-uploaded photograph land on itself.
      const hash = createHash('sha256').update(stand.bytes).digest('hex');
      const key = `qc/photos/${hash}.svg`;
      await store.put(key, stand.bytes, stand.contentType);

      // No unique constraint on (report, angle) to conflict against, so the
      // guard is the insert's own WHERE. A re-run adds nothing and rewrites
      // nothing.
      counts.photos += await prisma.$executeRaw`
        INSERT INTO qc.qc_photo (qc_report_id, angle, file_key, hash)
        SELECT ${report.id}::uuid, ${angle}, ${key}, ${hash}
         WHERE NOT EXISTS (SELECT 1 FROM qc.qc_photo
                            WHERE qc_report_id = ${report.id}::uuid AND angle = ${angle})`;
    }

    // --- the seal photograph ------------------------------------------------
    // PHASE_04 Task 6: `applied_photo_key` is NOT NULL because there is no seal
    // without a photograph. The key was there and the object was not, which is
    // the same as no photograph to anyone trying to look at one.
    if (report.seal_photo_key) {
      const stand = standInImage({
        heading: 'SEAL APPLIED',
        // Same rule as the catalog stand-ins: the key stays out of the picture.
        detail: [serial, 'TAMPER SEAL, ON THE MACHINE'],
      });
      await store.put(report.seal_photo_key, stand.bytes, stand.contentType);
      counts.sealPhotos += 1;
    }

    // --- the wipe certificate -----------------------------------------------
    // One unit in twelve has none. A buyer's data-security policy asks for this
    // per machine, and a screen that has only ever seen the present case renders
    // the absent one as a tick.
    if (stableHash(`wipe:${serial}`) % 12 !== 0) {
      counts.wipeCertificates += await prisma.$executeRaw`
        INSERT INTO qc.wipe_certificate
          (unit_id, method, standard, passes, verification_status, hash)
        SELECT ${report.unit_id}::uuid,
               ${stableHash(`method:${serial}`) % 2 === 0 ? 'ATA_SECURE_ERASE' : 'NVME_CRYPTO_ERASE'},
               'NIST_800_88_PURGE', 1, 'VERIFIED',
               ${createHash('sha256').update(`wipe:${serial}`).digest('hex')}
         WHERE NOT EXISTS (SELECT 1 FROM qc.wipe_certificate WHERE unit_id = ${report.unit_id}::uuid)`;
    }
  }

  log(
    `  qc evidence: ${counts.areaResults} area results, ${counts.photos} new photograph(s), ` +
      `${counts.sealPhotos} seal photograph(s), ${counts.wipeCertificates} new wipe certificate(s) ` +
      `across ${reports.length} current report(s); ` +
      `${counts.verificationCodesRepaired} unusable verification code(s) rewritten`,
  );
  return counts;
}
