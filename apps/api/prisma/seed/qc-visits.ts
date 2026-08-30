import type { PrismaClient } from '@prisma/client';

/**
 * QC visits, given the spread a real week of inspections produces.
 *
 * Before this ran there were three `qc_visit` rows, all REQUESTED, and
 * `qc_visit_unit` was **completely empty**. A vendor's visit screen built against
 * that looks finished and is wrong the first time a visit is scheduled: no
 * manifest column has ever rendered, no outcome has ever been anything but
 * PENDING, and the difference between "not inspected yet" and "passed" has never
 * been drawn on one screen at the same time. T21 hit exactly this shape on the
 * QC reports — 46 ordered units all PASS / grade A / seal APPLIED — and the fix
 * there was the same as the fix here: give the seed the spread, rather than move
 * a row to take a screenshot.
 *
 * Four rules govern what is written below.
 *
 * **1. Every instant comes from the caller's clock.** `now` is passed in, the
 * way `seedAfterSale` takes it, and `Date.now()` appears nowhere. A seed that
 * stamps wall-clock time while a service measures with `ClockPort` puts a
 * fixed-clock test's window somewhere the seed never intended, and it reads as a
 * logic bug in the service. That has cost this build time twice.
 *
 * **2. An outcome follows the evidence; it is not sprinkled on.** Every
 * manifest row's outcome is *derived* from what the database already holds — the
 * report's own verdict, the existence of a `grade_correction`, or the absence of
 * a report at all. Nothing here writes a verdict, a score, a battery reading or
 * a seal. `MISMATCH` becomes `UNTESTABLE` because that is where a serial
 * mismatch lands (QC-012), and because "we could not measure it" is a different
 * claim from "it failed" — which is the distinction a vendor's appeal turns on.
 *
 * **3. A machine with no report is not a machine that failed.** The absent and
 * pending rows are units that genuinely have no `qc_report`, so the screen shows
 * "not inspected yet" over real data rather than over a value someone invented.
 *
 * **4. The counters are computed from the manifest, never typed.** `units_passed`
 * and its five siblings are denormalised on `qc_visit`, and a seed that types
 * them produces a visit whose header disagrees with its own table — which is
 * indistinguishable, on screen, from an aggregation bug.
 *
 * Idempotent: it returns early if a visit it has already written is present.
 */

/** Two vendors, because a scoping rule with one tenant behind it is untested. */
interface Seeded {
  visits: number;
  manifestRows: number;
  facilityHours: number;
  availabilityRows: number;
}

/** `YYYY-MM-DD` in Asia/Kolkata, which is the only day this business has. */
function istDate(at: Date, plusDays = 0): string {
  const ms = at.getTime() + plusDays * 86_400_000 + 5.5 * 3_600_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 0 = Sunday, matching `facility_hours.day_of_week` and Postgres `EXTRACT(DOW)`. */
function istWeekday(at: Date, plusDays = 0): number {
  return new Date(at.getTime() + plusDays * 86_400_000 + 5.5 * 3_600_000).getUTCDay();
}

const at = (now: Date, deltaDays: number, hour: number): Date =>
  new Date(now.getTime() + deltaDays * 86_400_000 + hour * 3_600_000);

/** The manifest rows one visit gets, before the counters are derived from them. */
interface ManifestSpec {
  unitId: string;
  serialNumber: string;
  listingId: string | null;
  outcome: string;
  qcReportId: string | null;
  absentReason: string | null;
  /** Null on a machine nobody has opened. Never a zero. */
  durationSeconds: number | null;
}

interface VisitSpec {
  visitNumber: string;
  vendorOrgId: string;
  facilityId: string;
  addressId: string;
  status: string;
  unitsRequested: number;
  requestedAt: Date;
  scheduledDate: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  technicianId: string | null;
  toolProviderId: string | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  vendorSignoffAt: Date | null;
  vendorSignoffName: string | null;
  visitFee: string;
  feeBearer: string;
  feeWaiverReason: string | null;
  cancellationReason: string | null;
  notes: string | null;
  manifest: ManifestSpec[];
}

interface UnitRow {
  id: string;
  serial_number: string;
  listing_id: string | null;
  report_id: string | null;
  verdict: string | null;
  has_correction: boolean;
  /** `qc_hardware_detected.battery_health_pct` — 48 of 239 reports have none. */
  has_battery: boolean;
}

/**
 * A unit's outcome, read off what the database already says about it.
 *
 * A corrected grade outranks the verdict: `PASS` with a `grade_correction`
 * against it is `PASS_GRADE_CORRECTED`, which is the row a vendor is actually
 * looking for when they open a completed visit.
 */
function outcomeFor(u: UnitRow): string {
  if (u.report_id === null) return 'PENDING';
  if (u.has_correction) return 'PASS_GRADE_CORRECTED';
  switch (u.verdict) {
    case 'FAIL':
      return 'FAIL';
    // A serial that does not match the machine was never measured, so it is not
    // a failure — QC-012 lands it here and the screen must not paint it red.
    case 'MISMATCH':
      return 'UNTESTABLE';
    case 'PASS_WITH_NOTE':
      return 'PASS_WITH_NOTE';
    case 'PASS':
      return 'PASS';
    default:
      return 'PENDING';
  }
}

export async function seedQcVisits(
  prisma: PrismaClient,
  now: Date,
  log: (message: string) => void,
): Promise<Seeded> {
  const done: Seeded = { visits: 0, manifestRows: 0, facilityHours: 0, availabilityRows: 0 };

  // -- 1. Opening hours, for every facility -----------------------------------
  //
  // `vendor.facility_hours` had ZERO rows, on ten facilities, which is the same
  // shape of gap T27 found in `vendor_facility` itself. `assertSiteOpen` reads a
  // missing calendar as "no constraint recorded" and lets any day through, so
  // nothing was failing — but §3B says facility hours drive scheduling and that
  // the screen states a closed day cannot be booked, and a screen cannot state a
  // rule that has no data behind it. Monday to Saturday, 09:00–18:00; Sunday
  // shut, which is what the onboarding form's "at least 3 working days" produces
  // for a warehouse.
  const facilities = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM vendor.vendor_facility ORDER BY id`;
  for (const f of facilities) {
    for (let dow = 0; dow <= 6; dow += 1) {
      const closed = dow === 0;
      await prisma.$executeRaw`
        INSERT INTO vendor.facility_hours (facility_id, day_of_week, open_time, close_time, is_closed)
        VALUES (${f.id}::uuid, ${dow},
                ${closed ? null : '09:00:00'}::time, ${closed ? null : '18:00:00'}::time,
                ${closed})
        ON CONFLICT (facility_id, day_of_week) DO NOTHING`;
      done.facilityHours += 1;
    }
  }

  // -- 2. The demo vendors, their facilities and the one technician ------------
  //
  // Two statements and not one join: `identity.organization` and
  // `vendor.vendor_facility` are two modules' schemas, and `no-cross-schema-join`
  // is a design rule rather than a lint preference. The rule caught this file on
  // its first lint; splitting the query is the fix, not an exemption.
  const orgs = await prisma.$queryRaw<Array<{ id: string; legal_name: string }>>`
    SELECT id, legal_name FROM identity.organization
     WHERE legal_name IN ('Northgate IT Assets Pvt. Ltd.', 'Faridabad TechCycle Pvt. Ltd.')`;
  const orgIds = orgs.map((o) => o.id);
  const sites =
    orgIds.length === 0
      ? []
      : await prisma.$queryRaw<Array<{ org_id: string; id: string; address_id: string }>>`
          SELECT org_id, id, address_id FROM vendor.vendor_facility
           WHERE org_id = ANY(${orgIds}::text[]::uuid[])`;
  const vendors = sites.flatMap((f) => {
    const org = orgs.find((o) => o.id === f.org_id);
    return org
      ? [
          {
            org_id: f.org_id,
            facility_id: f.id,
            address_id: f.address_id,
            legal_name: org.legal_name,
          },
        ]
      : [];
  });
  const northgate = vendors.find((v) => v.legal_name.startsWith('Northgate'));
  const faridabad = vendors.find((v) => v.legal_name.startsWith('Faridabad'));
  if (!northgate || !faridabad) {
    log('  qc visits: the two demo supply points are not present — skipped.');
    return done;
  }

  const [tech] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM qc.qc_technician WHERE is_active ORDER BY employee_code LIMIT 1`;
  const [tool] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM qc.qc_tool_provider WHERE code = 'DEVICESURE'`;

  // -- 3. A holiday and three weeks of offered slots ---------------------------
  //
  // Both exist so the REAL scheduling path can be driven rather than imitated.
  // `SchedulingService.schedule()` refuses a technician who has not offered the
  // slot, and refuses any date the site is shut — so without these rows the only
  // way to a SCHEDULED visit is to write the row, which proves nothing except
  // that rows can be written.
  const holiday = istDate(now, 9);
  await prisma.$executeRaw`
    INSERT INTO vendor.facility_holiday (facility_id, holiday_date, reason)
    VALUES (${northgate.facility_id}::uuid, ${holiday}::date, 'Half-yearly stock audit — warehouse closed')
    ON CONFLICT (facility_id, holiday_date) DO NOTHING`;

  if (tech) {
    for (let d = 0; d <= 21; d += 1) {
      if (istWeekday(now, d) === 0) continue; // The sites are shut; so is the day.
      for (const [from, to] of [
        ['09:00:00', '13:00:00'],
        ['14:00:00', '18:00:00'],
      ]) {
        await prisma.$executeRaw`
          INSERT INTO qc.technician_availability (technician_id, the_date, slot_from, slot_to, status)
          VALUES (${tech.id}::uuid, ${istDate(now, d)}::date, ${from}::time, ${to}::time, 'AVAILABLE')
          ON CONFLICT (technician_id, the_date, slot_from) DO NOTHING`;
        done.availabilityRows += 1;
      }
    }
  }

  // -- 4. Manifests for the three visits the listing wizard already raised -----
  //
  // These are REAL visits — `SubmitService` raised them when a vendor submitted a
  // listing, which is the only way a visit is ever raised in production. They had
  // no manifest, so the machines the technician is coming for existed nowhere.
  // The last one is deliberately left bare: "the manifest is not prepared yet" is
  // a state this screen has to render, and a seed in which every visit has one
  // means it never does.
  const requested = await prisma.$queryRaw<Array<{ id: string; visit_number: string }>>`
    SELECT id, visit_number FROM qc.qc_visit
     WHERE vendor_org_id = ${northgate.org_id}::uuid AND status = 'REQUESTED'
     ORDER BY requested_at`;
  for (const v of requested.slice(0, -1)) {
    const units = await prisma.$queryRaw<
      Array<{ id: string; serial_number: string; listing_id: string }>
    >`
      SELECT u.id, u.serial_number, l.id AS listing_id
        FROM listing.listing l
        JOIN listing.unit u ON u.listing_id = l.id
       WHERE l.qc_visit_id = ${v.id}::uuid
       ORDER BY u.serial_number`;
    done.manifestRows += await writeManifest(
      prisma,
      v.id,
      units.map((u) => ({
        unitId: u.id,
        serialNumber: u.serial_number,
        listingId: u.listing_id,
        outcome: 'PENDING',
        qcReportId: null,
        absentReason: null,
        durationSeconds: null,
      })),
    );
    await syncCounters(prisma, v.id);
  }

  // -- 5. The spread ----------------------------------------------------------
  const stamp = istDate(now).replace(/-/g, '');
  const already = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM qc.qc_visit WHERE visit_number LIKE 'QCV-%-SEED%'`;
  if (Number(already[0]?.n ?? 0) > 0) {
    log(`  qc visits: the spread is already present (${done.facilityHours} hour rows checked).`);
    return done;
  }

  // Fetched once and sliced disjointly: `qc_visit_unit` is unique on
  // (visit_id, unit_id) and not on unit_id, so the same laptop CAN be put on two
  // visits — which is a re-inspection, and is not what these two are.
  const northgateAll = await vendorUnits(prisma, northgate.org_id);
  const northgateUnits = inspected(northgateAll, 10);
  // **One machine in the spread has no battery reading, on purpose.** A missing
  // measurement rendering as a passing one is the defect this build has found
  // about ten times, and a seed in which every reading is present never once
  // exercises the branch that catches it. 48 of the 239 reports genuinely have
  // no `qc_hardware_detected` row; this puts one of them on a finished visit.
  const unmeasured = withoutBattery(northgateAll);
  const liveUnits = northgateUnits.slice(0, 6);
  const finishedUnits = dedupe([
    ...northgateUnits.slice(6, 7),
    ...(unmeasured ? [unmeasured] : northgateUnits.slice(7, 8)),
  ]);
  const claimed = new Set([...liveUnits, ...finishedUnits].map((u) => u.id));
  const partialUnits = northgateUnits.filter((u) => !claimed.has(u.id)).slice(0, 2);
  // Machines with no report of their own: the only honest source of an ABSENT
  // row, because a unit that was never produced was never measured.
  const notProduced = uninspected(northgateAll, 2);
  const faridabadAll = await vendorUnits(prisma, faridabad.org_id);
  const faridabadUnits = inspected(faridabadAll, 4);

  const specs: VisitSpec[] = [];

  // A visit happening right now: the technician is on site and three of six
  // machines are done. The live half of the screen has never been rendered.
  if (liveUnits.length >= 4) {
    const halfway = Math.ceil(liveUnits.length / 2);
    specs.push({
      visitNumber: `QCV-${stamp}-SEED0001`,
      vendorOrgId: northgate.org_id,
      facilityId: northgate.facility_id,
      addressId: northgate.address_id,
      status: 'IN_PROGRESS',
      unitsRequested: liveUnits.length,
      requestedAt: at(now, -3, 0),
      scheduledDate: istDate(now),
      slotFrom: '09:00:00',
      slotTo: '13:00:00',
      technicianId: tech?.id ?? null,
      toolProviderId: tool?.id ?? null,
      arrivedAt: at(now, 0, -2),
      startedAt: at(now, 0, -2),
      completedAt: null,
      vendorSignoffAt: null,
      vendorSignoffName: null,
      // Twelve machines is under the 50-unit waiver, so the fee stands and the
      // screen has to say whose it is rather than showing a bare figure.
      visitFee: '1500.00',
      feeBearer: 'TRUETECH',
      feeWaiverReason: null,
      cancellationReason: null,
      notes: null,
      manifest: liveUnits.map((u, i) => ({
        unitId: u.id,
        serialNumber: u.serial_number,
        listingId: u.listing_id,
        // The second half has not been reached yet, so it has no report on this
        // visit and no outcome — which is the whole point of the row.
        outcome: i < halfway ? outcomeFor(u) : 'PENDING',
        qcReportId: i < halfway ? u.report_id : null,
        absentReason: null,
        durationSeconds: i < halfway ? 420 + i * 35 : null,
      })),
    });
  }

  // A visit that finished cleanly a fortnight ago, signed off by the vendor.
  if (finishedUnits.length >= 2) {
    specs.push({
      visitNumber: `QCV-${stamp}-SEED0002`,
      vendorOrgId: northgate.org_id,
      facilityId: northgate.facility_id,
      addressId: northgate.address_id,
      status: 'COMPLETED',
      unitsRequested: finishedUnits.length,
      requestedAt: at(now, -21, 0),
      scheduledDate: istDate(now, -14),
      slotFrom: '14:00:00',
      slotTo: '18:00:00',
      technicianId: tech?.id ?? null,
      toolProviderId: tool?.id ?? null,
      arrivedAt: at(now, -14, 0),
      startedAt: at(now, -14, 0.25),
      completedAt: at(now, -14, 3),
      vendorSignoffAt: at(now, -14, 3.1),
      vendorSignoffName: 'R. Mehta',
      // Nothing to pay and a reason on the record: `WAIVED` with a sentence
      // beside it, never a bare zero, which reads as "no charge" whether the
      // truth is a waiver, our cost, or a fee nobody has priced yet.
      visitFee: '0.00',
      feeBearer: 'WAIVED',
      feeWaiverReason: 'First inspection at this supply point.',
      cancellationReason: null,
      notes: null,
      manifest: finishedUnits.map((u) => ({
        unitId: u.id,
        serialNumber: u.serial_number,
        listingId: u.listing_id,
        outcome: outcomeFor(u),
        qcReportId: u.report_id,
        absentReason: null,
        durationSeconds: 505,
      })),
    });
  }

  // The vendor was not there. Not red — a no-show is not a verdict on a machine
  // — but it carries a consequence, and the consequence is the fee.
  specs.push({
    visitNumber: `QCV-${stamp}-SEED0003`,
    vendorOrgId: northgate.org_id,
    facilityId: northgate.facility_id,
    addressId: northgate.address_id,
    status: 'NO_SHOW_VENDOR',
    unitsRequested: 8,
    requestedAt: at(now, -12, 0),
    scheduledDate: istDate(now, -6),
    slotFrom: '09:00:00',
    slotTo: '13:00:00',
    technicianId: tech?.id ?? null,
    toolProviderId: tool?.id ?? null,
    arrivedAt: at(now, -6, 3.5),
    startedAt: null,
    completedAt: null,
    vendorSignoffAt: null,
    vendorSignoffName: null,
    visitFee: '1500.00',
    feeBearer: 'VENDOR',
    feeWaiverReason: null,
    cancellationReason:
      'Nobody was at the warehouse at the agreed slot and the site contact did not answer.',
    notes: null,
    manifest: [],
  });

  // The one that did not go to plan, on the OTHER vendor — which is where the
  // only FAIL and the only MISMATCH in the database live, because `qc-spread`
  // deliberately keeps a failed machine off a LISTED unit. Two machines were not
  // produced, one could not be measured, one failed.
  if (faridabadUnits.length >= 2) {
    specs.push({
      visitNumber: `QCV-${stamp}-SEED0004`,
      vendorOrgId: faridabad.org_id,
      facilityId: faridabad.facility_id,
      addressId: faridabad.address_id,
      status: 'COMPLETED',
      unitsRequested: faridabadUnits.length,
      requestedAt: at(now, -10, 0),
      scheduledDate: istDate(now, -4),
      slotFrom: '09:00:00',
      slotTo: '13:00:00',
      technicianId: tech?.id ?? null,
      toolProviderId: tool?.id ?? null,
      arrivedAt: at(now, -4, 0),
      startedAt: at(now, -4, 0.2),
      completedAt: at(now, -4, 2.5),
      vendorSignoffAt: at(now, -4, 2.6),
      vendorSignoffName: 'S. Chauhan',
      visitFee: '1500.00',
      feeBearer: 'VENDOR',
      feeWaiverReason: null,
      cancellationReason: null,
      notes: null,
      manifest: faridabadUnits.map((u) => ({
        unitId: u.id,
        serialNumber: u.serial_number,
        listingId: u.listing_id,
        outcome: outcomeFor(u),
        qcReportId: u.report_id,
        absentReason: null,
        durationSeconds: 600,
      })),
    });
  }

  // The other way a visit goes wrong, and the one that costs the vendor a day:
  // machines on the manifest that were not produced. ABSENT is not a verdict —
  // nobody opened these laptops — so they carry no report, no grade and no
  // score, and the screen has to say "not presented" rather than leaving a blank
  // that reads as a pass.
  if (partialUnits.length >= 1 && notProduced.length >= 1) {
    specs.push({
      visitNumber: `QCV-${stamp}-SEED0005`,
      vendorOrgId: northgate.org_id,
      facilityId: northgate.facility_id,
      addressId: northgate.address_id,
      status: 'PARTIALLY_COMPLETED',
      unitsRequested: partialUnits.length + notProduced.length,
      requestedAt: at(now, -16, 0),
      scheduledDate: istDate(now, -9),
      slotFrom: '14:00:00',
      slotTo: '18:00:00',
      technicianId: tech?.id ?? null,
      toolProviderId: tool?.id ?? null,
      arrivedAt: at(now, -9, 0),
      startedAt: at(now, -9, 0.2),
      completedAt: at(now, -9, 1.5),
      vendorSignoffAt: at(now, -9, 1.6),
      vendorSignoffName: 'R. Mehta',
      visitFee: '1500.00',
      feeBearer: 'VENDOR',
      feeWaiverReason: null,
      cancellationReason: null,
      notes:
        'Two machines on the manifest were not produced. They stay on your own stock and are not listed; put them on a later inspection when you have them.',
      manifest: [
        ...partialUnits.map((u) => ({
          unitId: u.id,
          serialNumber: u.serial_number,
          listingId: u.listing_id,
          outcome: outcomeFor(u),
          qcReportId: u.report_id,
          absentReason: null,
          durationSeconds: 545,
        })),
        ...notProduced.map((u) => ({
          unitId: u.id,
          serialNumber: u.serial_number,
          listingId: u.listing_id,
          outcome: 'ABSENT',
          qcReportId: null,
          absentReason: 'Not produced at the visit — the warehouse could not locate it.',
          durationSeconds: null,
        })),
      ],
    });
  }

  for (const spec of specs) {
    const [row] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO qc.qc_visit
        (visit_number, vendor_org_id, facility_id, address_id, requested_at, units_requested,
         technician_id, tool_provider_id, scheduled_date, slot_from, slot_to, status,
         arrived_at, started_at, completed_at, vendor_signoff_at, vendor_signoff_name,
         visit_fee, fee_bearer, fee_waiver_reason, cancellation_reason, notes)
      VALUES
        (${spec.visitNumber}, ${spec.vendorOrgId}::uuid, ${spec.facilityId}::uuid,
         ${spec.addressId}::uuid, ${spec.requestedAt}, ${spec.unitsRequested},
         ${spec.technicianId}::uuid, ${spec.toolProviderId}::uuid,
         ${spec.scheduledDate}::date, ${spec.slotFrom}::time, ${spec.slotTo}::time,
         ${spec.status}::public.qc_visit_status,
         ${spec.arrivedAt}, ${spec.startedAt}, ${spec.completedAt},
         ${spec.vendorSignoffAt}, ${spec.vendorSignoffName},
         ${spec.visitFee}::numeric, ${spec.feeBearer}, ${spec.feeWaiverReason},
         ${spec.cancellationReason}, ${spec.notes})
      RETURNING id`;
    const visitId = row!.id;
    done.visits += 1;
    done.manifestRows += await writeManifest(prisma, visitId, spec.manifest);
    await syncCounters(prisma, visitId);
    await alignToEvidence(prisma, visitId);
  }

  log(
    `  qc visits: ${done.visits} added across two supply points, ${done.manifestRows} manifest rows, ` +
      `${done.availabilityRows} offered slots, one holiday on ${holiday}.`,
  );
  return done;
}

/**
 * Every unit this vendor owns, with what `qc` knows about it — in three
 * single-schema statements.
 *
 * `listing.unit`, `listing.grade_correction`, `qc.qc_report` and
 * `qc.qc_visit_unit` are two modules' schemas. The obvious join was written
 * first, `no-cross-schema-join` refused it, and the fix is the split rather than
 * a disable: the day `qc` becomes its own service these become two calls and one
 * `Array.filter`, and the join would have become a rewrite.
 *
 * Units already on somebody's manifest are dropped, so two visits in one run
 * cannot claim the same laptop.
 */
async function vendorUnits(prisma: PrismaClient, orgId: string): Promise<UnitRow[]> {
  const units = await prisma.$queryRaw<
    Array<{ id: string; serial_number: string; listing_id: string | null; has_correction: boolean }>
  >`
    SELECT u.id, u.serial_number, u.listing_id,
           EXISTS (SELECT 1 FROM listing.grade_correction c WHERE c.unit_id = u.id) AS has_correction
      FROM listing.unit u
     WHERE u.vendor_org_id = ${orgId}::uuid
     ORDER BY u.serial_number`;
  if (units.length === 0) return [];

  const ids = units.map((u) => u.id);
  const reports = await prisma.$queryRaw<
    Array<{ unit_id: string; id: string; verdict: string | null; has_battery: boolean }>
  >`
    SELECT r.unit_id, r.id, r.verdict::text AS verdict,
           (h.battery_health_pct IS NOT NULL) AS has_battery
      FROM qc.qc_report r
      LEFT JOIN qc.qc_hardware_detected h ON h.qc_report_id = r.id
     WHERE r.unit_id = ANY(${ids}::text[]::uuid[]) AND r.is_current`;
  const onAManifest = await prisma.$queryRaw<Array<{ unit_id: string }>>`
    SELECT DISTINCT unit_id FROM qc.qc_visit_unit
     WHERE unit_id = ANY(${ids}::text[]::uuid[])`;

  const byUnit = new Map(reports.map((r) => [r.unit_id, r]));
  const taken = new Set(onAManifest.map((r) => r.unit_id));
  return units
    .filter((u) => !taken.has(u.id))
    .map((u) => {
      const report = byUnit.get(u.id);
      return {
        id: u.id,
        serial_number: u.serial_number,
        listing_id: u.listing_id,
        report_id: report?.id ?? null,
        verdict: report?.verdict ?? null,
        has_correction: u.has_correction,
        has_battery: report?.has_battery ?? false,
      };
    });
}

/**
 * Inspected units, most interesting first.
 *
 * FAIL and MISMATCH lead deliberately: there is one of each in the whole
 * database, and a visit built from an arbitrary slice misses both — which is how
 * a screen ends up never once rendering its two most important states.
 */
function inspected(units: readonly UnitRow[], limit: number): UnitRow[] {
  const rank = (u: UnitRow): number =>
    u.verdict === 'FAIL' || u.verdict === 'MISMATCH'
      ? 0
      : u.has_correction
        ? 1
        : u.verdict === 'PASS_WITH_NOTE'
          ? 2
          : 3;
  return units
    .filter((u) => u.report_id !== null)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        // A measured battery first, so a manifest is not a column of "not
        // measured". `withoutBattery` puts one back deliberately — see below.
        Number(b.has_battery) - Number(a.has_battery) ||
        a.serial_number.localeCompare(b.serial_number),
    )
    .slice(0, limit);
}

/** By unit id, because the same row can be reached two ways. */
function dedupe(units: readonly UnitRow[]): UnitRow[] {
  const seen = new Set<string>();
  return units.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
}

/** The first inspected unit whose battery could NOT be read, if there is one. */
function withoutBattery(units: readonly UnitRow[]): UnitRow | undefined {
  return units.find((u) => u.report_id !== null && !u.has_battery);
}

/** Units with no report at all — the honest source of PENDING and ABSENT rows. */
function uninspected(units: readonly UnitRow[], limit: number): UnitRow[] {
  return units.filter((u) => u.report_id === null).slice(0, limit);
}

/**
 * The manifest rows, and the back-link from the report to the visit it came from.
 *
 * `qc_report.visit_id` was NULL on all 239 reports, which means the ops console's
 * visit record has never had a tool run, a photograph or a seal to show. Writing
 * it here is not decoration: it is the same fact the manifest row already
 * asserts, recorded on the side that `QcConsoleService.detail()` reads.
 */
async function writeManifest(
  prisma: PrismaClient,
  visitId: string,
  rows: readonly ManifestSpec[],
): Promise<number> {
  let n = 0;
  for (const [i, r] of rows.entries()) {
    const inserted = await prisma.$executeRaw`
      INSERT INTO qc.qc_visit_unit
        (visit_id, unit_id, serial_number, listing_id, sequence_no, outcome, qc_report_id,
         absent_reason, duration_seconds)
      VALUES
        (${visitId}::uuid, ${r.unitId}::uuid, ${r.serialNumber}, ${r.listingId}::uuid,
         ${i + 1}, ${r.outcome}::public.qc_unit_outcome, ${r.qcReportId}::uuid,
         ${r.absentReason}, ${r.durationSeconds})
      ON CONFLICT (visit_id, unit_id) DO NOTHING`;
    n += Number(inserted);
    if (r.qcReportId) {
      await prisma.$executeRaw`
        UPDATE qc.qc_report SET visit_id = ${visitId}::uuid
         WHERE id = ${r.qcReportId}::uuid AND visit_id IS NULL`;
    }
  }
  return n;
}

/**
 * The six denormalised counters, recomputed from the manifest that now exists.
 *
 * Never typed into the spec above. A visit header that disagrees with its own
 * table is indistinguishable on screen from an aggregation bug, and the seed is
 * the last place that difference should have to be diagnosed.
 *
 * `units_presented` stays NULL on a visit nobody has arrived at: "the vendor
 * produced zero machines" and "nobody has counted yet" are different facts, and
 * a zero would render as the first.
 */
/**
 * A visit that carries reports happened on the day those reports were written.
 *
 * The dates above are offsets from `now`, and the reports attached to them were
 * completed by an earlier seed on its own day — so a visit dated the 16th could
 * end up holding an inspection dated the 26th. Nothing on a vendor screen shows
 * both at once today, which is exactly why it would have survived until a screen
 * did. The evidence is the fact; the visit's clock is moved onto it, never the
 * other way round, because those reports are read by the buyer's order screens
 * and by every warranty window derived from them.
 *
 * `completed_at` is left alone when the visit is not finished: an inspection
 * that opened on the 26th and was never closed is a stalled visit, which is a
 * real thing and one the ops console raises an exception row for.
 */
async function alignToEvidence(prisma: PrismaClient, visitId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE qc.qc_visit v
       SET scheduled_date = w.day,
           arrived_at     = w.first - interval '25 minutes',
           started_at     = w.first - interval '20 minutes',
           completed_at   = CASE WHEN v.completed_at IS NULL THEN NULL ELSE w.last END
      FROM (SELECT max(r.completed_at)::date AS day,
                   min(r.completed_at)       AS first,
                   max(r.completed_at)       AS last
              FROM qc.qc_report r
             WHERE r.visit_id = ${visitId}::uuid AND r.completed_at IS NOT NULL) w
     WHERE v.id = ${visitId}::uuid
       AND v.arrived_at IS NOT NULL
       AND w.day IS NOT NULL`;
}

async function syncCounters(prisma: PrismaClient, visitId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE qc.qc_visit v
       SET units_presented = CASE WHEN v.arrived_at IS NULL THEN NULL
                                  ELSE (SELECT count(*) FROM qc.qc_visit_unit m
                                         WHERE m.visit_id = v.id AND m.outcome <> 'ABSENT')::int END,
           units_inspected = (SELECT count(*) FROM qc.qc_visit_unit m
                               WHERE m.visit_id = v.id AND m.qc_report_id IS NOT NULL)::int,
           units_passed = (SELECT count(*) FROM qc.qc_visit_unit m
                            WHERE m.visit_id = v.id
                              AND m.outcome IN ('PASS', 'PASS_WITH_NOTE'))::int,
           units_grade_corrected = (SELECT count(*) FROM qc.qc_visit_unit m
                                     WHERE m.visit_id = v.id
                                       AND m.outcome = 'PASS_GRADE_CORRECTED')::int,
           units_failed = (SELECT count(*) FROM qc.qc_visit_unit m
                            WHERE m.visit_id = v.id AND m.outcome = 'FAIL')::int,
           units_absent = (SELECT count(*) FROM qc.qc_visit_unit m
                            WHERE m.visit_id = v.id AND m.outcome = 'ABSENT')::int
     WHERE v.id = ${visitId}::uuid`;
}
