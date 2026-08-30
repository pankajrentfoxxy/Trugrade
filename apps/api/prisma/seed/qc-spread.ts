import type { PrismaClient } from '@prisma/client';

/**
 * The QC estate, given the spread a real intake produces.
 *
 * Before this ran, every one of the 239 seeded reports was `PASS` / grade `A` /
 * seal `APPLIED`, and every measurement was present bar one battery. That is a
 * **monoculture**, and it is the most expensive kind of seed defect: a screen
 * built entirely of measurements — the buyer's per-serial order screen (T21),
 * the warranty board (T23), the return flow (T24), the ops queues — looks
 * finished against it and is wrong the first time a real machine fails. The
 * build ledger has carried "seed has no FAIL / PASS_WITH_NOTE / MISMATCH QC
 * report" as a known gap since Phase 4.
 *
 * Three rules govern what is written here.
 *
 * **1. A verdict follows the evidence, it is not sprinkled on.** `seedQcEvidence`
 * already writes `WARN` area results wherever an area scored below 8, under a
 * `PASS` verdict — which is a report saying "nothing to report" over twelve rows
 * several of which report something. So `PASS_WITH_NOTE` is *derived*: a report
 * carrying findings on `NOTE_WARN_AREAS` of its twelve areas is one. The
 * threshold is not one warned area, because it is generous — an area below 8 out
 * of 10 is a scuff, and a refurbished machine with one scuff is a PASS. Seven is
 * a machine somebody should read the notes on before signing, and it puts about
 * a sixth of the estate there, which is what a real intake looks like.
 *
 * **2. A failed machine is never on sale.** `listing.unit_is_sellable` looks at
 * status, QC dates and the seal — **not at the verdict** — so a `FAIL` written
 * onto a `LISTED` unit would put a failed laptop on the storefront. Every FAIL,
 * MISMATCH and broken seal below therefore lands only on units already allocated
 * to an order (`RESERVED`), where it is also the state the after-sale screens
 * need: a broken seal is what T24's return turns on, and a failed
 * re-verification is why a serial gets replaced before handover.
 *
 * **3. Nothing here invents a measurement.** `battery_health_pct` is never
 * written. One demo machine has no battery reading and it stays that way,
 * because "not measured" rendering as a pass is the defect this build has found
 * about ten times, and that single row is the only thing that exercises it.
 *
 * Idempotent: every statement below sets a value computed from data already in
 * the database, so a second run is a no-op. It exists as a separate pass rather
 * than inside `seedOffer` because `seedOffer` returns early for a listing it has
 * already written — a developer with a seeded database would otherwise never get
 * the spread, and the ordered machines whose reports this corrects were
 * allocated by the real checkout long after their listing was seeded.
 */

/**
 * A unit whose current report is not a clean pass carries no pass stamp.
 *
 * `verdict.service.ts` does exactly this in production — it nulls
 * `qc_passed_at` and `qc_valid_until` on anything short of a clean pass, which
 * is what makes a machine that was live yesterday and failed today leave the
 * storefront in the same statement rather than on the next job run.
 *
 * The seed has to mirror it, and originally did not. `listing.unit_is_sellable`
 * reads status, the QC dates and the seal — it never sees the verdict — so a
 * report flipped to FAIL while the unit kept its pass stamp is a FAILED LAPTOP
 * THAT THE VIEW CALLS SELLABLE. It was invisible here only because these
 * verdicts land on allocated units, whose status disqualifies them anyway;
 * proven by evaluating the function with the same rows and status LISTED, which
 * returned true for both the FAIL and the MISMATCH.
 *
 * Writing the stamp correctly is the fix. Confining failures to allocated units
 * is a habit that holds until someone seeds a failure somewhere else.
 */
async function clearPassStamp(prisma: PrismaClient, reportId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE listing.unit
       SET qc_passed_at = NULL, qc_valid_until = NULL
     WHERE id = (SELECT unit_id FROM qc.qc_report WHERE id = ${reportId}::uuid)`;
}

export interface QcSpreadCounts {
  passWithNote: number;
  mismatch: number;
  failed: number;
  brokenSeals: number;
  gradeCorrections: number;
}

/**
 * How many of the twelve areas have to carry a finding before the verdict says
 * so. See rule 1 above for why this is not one.
 */
const NOTE_WARN_AREAS = 7;

/** Deterministic and machine-independent, so the same serial is always picked. */
const pick = <T>(rows: readonly T[], nth: number): T | undefined => rows[nth];

export async function seedQcSpread(
  prisma: PrismaClient,
  log: (message: string) => void = () => {},
): Promise<QcSpreadCounts> {
  const counts: QcSpreadCounts = {
    passWithNote: 0,
    mismatch: 0,
    failed: 0,
    brokenSeals: 0,
    gradeCorrections: 0,
  };

  // --- 1. PASS_WITH_NOTE, derived from the areas ---------------------------
  // The whole estate, listed stock included: a cosmetic finding is not a reason
  // to withhold a machine from sale, it is a reason to say so on the passport.
  //
  // Convergent rather than additive — it sets the verdict BOTH ways from the
  // evidence, so changing the threshold re-derives the whole estate instead of
  // leaving yesterday's answer behind on the rows that no longer qualify.
  // `FAIL` and `MISMATCH` are outside the CASE and are never overwritten: they
  // are conclusions the area scores do not carry.
  counts.passWithNote = await prisma.$executeRaw`
    UPDATE qc.qc_report r
       SET verdict = CASE
             WHEN (SELECT count(*) FROM qc.qc_area_result a
                    WHERE a.qc_report_id = r.id AND a.status = 'WARN') >= ${NOTE_WARN_AREAS}
             THEN 'PASS_WITH_NOTE'::qc_verdict
             ELSE 'PASS'::qc_verdict
           END
     WHERE r.is_current
       AND r.verdict IN ('PASS'::qc_verdict, 'PASS_WITH_NOTE'::qc_verdict)
       AND r.verdict IS DISTINCT FROM CASE
             WHEN (SELECT count(*) FROM qc.qc_area_result a
                    WHERE a.qc_report_id = r.id AND a.status = 'WARN') >= ${NOTE_WARN_AREAS}
             THEN 'PASS_WITH_NOTE'::qc_verdict
             ELSE 'PASS'::qc_verdict
           END`;

  // --- 2. The after-sale states, on allocated machines only ----------------
  // Ordered by serial so the same machines are picked on every database.
  const ordered = await prisma.$queryRaw<
    Array<{ serial_number: string; qc_report_id: string | null }>
  >`
    SELECT serial_number, qc_report_id
      FROM ordering.order_line_unit
     WHERE qc_report_id IS NOT NULL
     ORDER BY serial_number`;

  if (ordered.length === 0) {
    log('  qc spread: no allocated machines yet — after-sale states not seeded');
    log(`  qc spread: ${counts.passWithNote} report(s) restated as PASS_WITH_NOTE`);
    return counts;
  }

  /**
   * The pre-dispatch re-verification that failed.
   *
   * We re-check a machine before it leaves. When that check fails, the report on
   * the order line IS the failing one — the buyer sees the FAIL against that
   * serial on their own asset register, which is how they know the machine is
   * being replaced rather than quietly swapped. Rule 7(4) take-back is ours and
   * non-delegable, so a buyer being told is the point.
   */
  const failed = pick(ordered, 6);
  if (failed?.qc_report_id) {
    counts.failed = await prisma.$executeRaw`
      UPDATE qc.qc_report
         SET verdict = 'FAIL'::qc_verdict, qc_score = 41
       WHERE id = ${failed.qc_report_id}::uuid`;
    await clearPassStamp(prisma, failed.qc_report_id);
  }

  /**
   * The declared spec did not match what the tool detected.
   *
   * The hardware row is corrected too, because a MISMATCH verdict over a
   * hardware capture that agrees with the SKU is a verdict with no evidence
   * behind it — and `compareSpec()` in contracts renders the comparison from
   * exactly this column.
   */
  const mismatched = pick(ordered, 17);
  if (mismatched?.qc_report_id) {
    counts.mismatch = await prisma.$executeRaw`
      UPDATE qc.qc_report
         SET verdict = 'MISMATCH'::qc_verdict
       WHERE id = ${mismatched.qc_report_id}::uuid`;
    await prisma.$executeRaw`
      UPDATE qc.qc_hardware_detected
         SET ram_detected_gb = 8
       WHERE qc_report_id = ${mismatched.qc_report_id}::uuid`;
    await clearPassStamp(prisma, mismatched.qc_report_id);
  }

  /**
   * A seal found broken at the door.
   *
   * On a machine that passed inspection, deliberately: an intact verdict with a
   * broken seal is the case the delivery screen exists for, and the one a screen
   * that draws seal state off the verdict gets wrong. `broken_reason` is what
   * the site contact recorded, not our guess.
   */
  const broken = pick(ordered, 29);
  if (broken?.qc_report_id) {
    counts.brokenSeals = await prisma.$executeRaw`
      UPDATE qc.qc_seal
         SET status = 'BROKEN'::seal_status,
             broken_at = now(),
             broken_reason = 'Tamper seal found split on the lid at handover; recorded by the site contact.'
       WHERE qc_report_id = ${broken.qc_report_id}::uuid`;
  }

  // --- 3. Grade corrections ------------------------------------------------
  // `chk_override_reason` refuses a report whose proposed and final grades
  // differ without a stated reason, which is the constraint that makes a
  // downgrade accountable. Both directions occur in a real estate: a machine
  // marked down for chassis wear, and two that came back better than the line
  // they were sold on. `listing.unit.grade_actual` is moved with it — it is the
  // inspected grade the grade facet counts, and the two disagreeing is drift.
  const corrections: ReadonlyArray<[number, string, string]> = [
    [3, 'B', 'Chassis wear and a scuffed palm rest found on re-verification before dispatch.'],
    [
      11,
      'A_PLUS',
      'Re-verification found no cosmetic defect; graded up from the line it was sold on.',
    ],
    [
      24,
      'A_PLUS',
      'Re-verification found no cosmetic defect; graded up from the line it was sold on.',
    ],
  ];
  for (const [nth, grade, reason] of corrections) {
    const row = pick(ordered, nth);
    if (!row?.qc_report_id) continue;
    counts.gradeCorrections += await prisma.$executeRaw`
      UPDATE qc.qc_report
         SET grade_final = ${grade}::grade_type, grade_override_reason = ${reason}
       WHERE id = ${row.qc_report_id}::uuid`;
    await prisma.$executeRaw`
      UPDATE listing.unit
         SET grade_actual = ${grade}::grade_type
       WHERE serial_number = ${row.serial_number}`;
  }

  log(
    `  qc spread: ${counts.passWithNote} PASS_WITH_NOTE, ${counts.failed} FAIL, ` +
      `${counts.mismatch} MISMATCH, ${counts.brokenSeals} broken seal, ` +
      `${counts.gradeCorrections} grade correction(s)`,
  );
  return counts;
}
