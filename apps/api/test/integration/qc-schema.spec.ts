/**
 * The Phase 4 QC schema, proved against a real Postgres.
 *
 * Raw SQL only, no service layer. Several of Phase 4's exit criteria are about
 * guarantees the database makes on its own — exactly one live report per machine,
 * no seal without a photograph, an idempotent tool run — and those have to hold
 * whichever of the six services touching them is careless. Routing the assertions
 * through application code would prove the application instead.
 */

import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeOrganization, makeTechnician, seedSellableUnit } from '../support/factories';

let db: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
});

/** A unit with a technician, ready to hang reports and seals off. */
async function anchors(): Promise<{ unitId: string; technicianId: string; userId: string }> {
  const unit = await seedSellableUnit({}, db);
  const tech = await makeTechnician(db);
  return { unitId: unit.unitId, technicianId: tech.technicianId, userId: tech.userId };
}

async function insertReport(
  a: { unitId: string; technicianId: string },
  over: Partial<{
    isCurrent: boolean;
    verificationCode: string;
    gradeProposed: string | null;
    gradeFinal: string | null;
    overrideReason: string | null;
    nonce: string;
  }> = {},
): Promise<string> {
  const id = randomUUID();
  await db.$executeRawUnsafe(
    `INSERT INTO qc.qc_report (id, unit_id, technician_id, device_cert_id, agent_version,
                               started_at, completed_at, signature, nonce, qc_score, verdict,
                               grade_proposed, grade_final, grade_override_reason,
                               verification_code, valid_until, is_current)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'CERT-X', '2.3.1',
             now() - interval '20 minutes', now(), 'sig', $4, 92, 'PASS'::qc_verdict,
             $5::grade_type, $6::grade_type, $7, $8, CURRENT_DATE + 90, $9)`,
    id,
    a.unitId,
    a.technicianId,
    over.nonce ?? randomUUID(),
    over.gradeProposed ?? 'A',
    over.gradeFinal ?? 'A',
    over.overrideReason ?? null,
    over.verificationCode ?? randomUUID().replace(/-/g, '').slice(0, 16),
    over.isCurrent ?? true,
  );
  return id;
}

// ---------------------------------------------------------------------------
// Exactly one live report per machine
// ---------------------------------------------------------------------------

describe('uq_qcrep_current', () => {
  it('QC-045: refuses a second is_current report for the same unit', async () => {
    const a = await anchors();
    // seedSellableUnit already wrote one current report for this unit.
    await expect(insertReport(a, { isCurrent: true })).rejects.toThrow(/23505|unique/i);
  });

  it('QC-045: a re-inspection supersedes and PRESERVES the prior report', async () => {
    const a = await anchors();
    const prior = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM qc.qc_report WHERE unit_id = ${a.unitId}::uuid AND is_current`;
    const priorId = prior[0]!.id;

    const newId = randomUUID();
    await db.$transaction([
      db.$executeRaw`UPDATE qc.qc_report SET is_current = FALSE WHERE id = ${priorId}::uuid`,
      db.$executeRawUnsafe(
        `INSERT INTO qc.qc_report (id, unit_id, technician_id, device_cert_id, agent_version,
                                   started_at, completed_at, signature, nonce, qc_score, verdict,
                                   grade_final, verification_code, valid_until, is_current)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'CERT-Y', '2.3.1', now(), now(), 'sig', $4, 88,
                 'PASS'::qc_verdict, 'B'::grade_type, $5, CURRENT_DATE + 90, TRUE)`,
        newId,
        a.unitId,
        a.technicianId,
        randomUUID(),
        randomUUID().replace(/-/g, '').slice(0, 16),
      ),
      db.$executeRaw`UPDATE qc.qc_report SET superseded_by_id = ${newId}::uuid WHERE id = ${priorId}::uuid`,
    ]);

    const rows = await db.$queryRaw<Array<{ id: string; is_current: boolean; superseded_by_id: string | null }>>`
      SELECT id, is_current, superseded_by_id FROM qc.qc_report WHERE unit_id = ${a.unitId}::uuid`;
    expect(rows).toHaveLength(2);
    // The old report is still there. History is the evidence, so a re-inspection
    // must never be an UPDATE over the top of the finding it replaces.
    expect(rows.filter((r) => r.is_current)).toHaveLength(1);
    expect(rows.find((r) => r.id === priorId)?.superseded_by_id).toBe(newId);
  });
});

// ---------------------------------------------------------------------------
// One technician identity
// ---------------------------------------------------------------------------

describe('technician identity', () => {
  it('qc_report.technician_id refuses a user_account id', async () => {
    // Before Phase 4 this was the accepted value, and the seal pointed at a
    // different table. Two identities on one inspection meant nothing required
    // the inspector and the sealer to be the same person.
    const a = await anchors();
    await expect(
      insertReport({ unitId: a.unitId, technicianId: a.userId }, { isCurrent: false }),
    ).rejects.toThrow(/23503|foreign key/i);
  });

  it('the report and the seal now name the same technician', async () => {
    const unit = await seedSellableUnit({}, db);
    const rows = await db.$queryRaw<Array<{ same: boolean }>>`
      SELECT (r.technician_id = s.applied_by) AS same
        FROM qc.qc_report r
        JOIN qc.qc_seal s ON s.qc_report_id = r.id
       WHERE r.unit_id = ${unit.unitId}::uuid`;
    expect(rows[0]?.same).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotent ingestion
// ---------------------------------------------------------------------------

describe('qc_tool_run uniqueness', () => {
  async function insertRun(
    unitId: string,
    providerId: string,
    toolRunId: string,
    nonce: string,
  ) {
    return db.$executeRawUnsafe(
      `INSERT INTO qc.qc_tool_run (id, unit_id, tool_provider_id, tool_version, device_cert_id,
                                   raw_report_hash, tool_run_id, nonce, parse_status,
                                   serial_from_tool, serial_matches, ingested_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, '0.1.0', 'CERT-X', 'sha256:abc',
               $3, $4, 'PARSED', '4XK2LM9', TRUE, now())`,
      unitId,
      providerId,
      toolRunId,
      nonce,
    );
  }

  async function deviceSureId(): Promise<string> {
    const r = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM qc.qc_tool_provider WHERE code = 'DEVICESURE'`;
    return r[0]!.id;
  }

  it('QC-001: the same tool run twice collides on (tool_provider_id, tool_run_id)', async () => {
    const a = await anchors();
    const p = await deviceSureId();
    await insertRun(a.unitId, p, 'ds-cert-1', randomUUID());
    // The service turns this collision into a 200 returning the existing row.
    // The database is what makes that safe under concurrency.
    await expect(insertRun(a.unitId, p, 'ds-cert-1', randomUUID())).rejects.toThrow(
      /23505|unique/i,
    );
  });

  it('QC-004: a replayed nonce is rejected even under a different run id', async () => {
    const a = await anchors();
    const p = await deviceSureId();
    const nonce = randomUUID();
    await insertRun(a.unitId, p, 'ds-cert-2', nonce);
    await expect(insertRun(a.unitId, p, 'ds-cert-3', nonce)).rejects.toThrow(/23505|unique/i);
  });
});

// ---------------------------------------------------------------------------
// No seal without a photograph
// ---------------------------------------------------------------------------

describe('qc_seal', () => {
  it('refuses a seal with no photograph key', async () => {
    const a = await anchors();
    const reportId = await insertReport(a, { isCurrent: false });
    await expect(
      db.$executeRaw`
        INSERT INTO qc.qc_seal (id, unit_id, qc_report_id, seal_code, applied_by, status, applied_at)
        VALUES (gen_random_uuid(), ${a.unitId}::uuid, ${reportId}::uuid, 'TRG-TEST-0001',
                ${a.technicianId}::uuid, 'APPLIED'::seal_status, now())`,
    ).rejects.toThrow(/23502|not-null|null value/i);
  });

  it('refuses a duplicate seal code', async () => {
    const a = await anchors();
    const reportId = await insertReport(a, { isCurrent: false });
    const insert = (code: string) =>
      db.$executeRawUnsafe(
        `INSERT INTO qc.qc_seal (id, unit_id, qc_report_id, seal_code, applied_by, status,
                                 applied_at, applied_photo_key)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::uuid, 'APPLIED'::seal_status,
                 now(), 'qc/seals/x.jpg')`,
        a.unitId,
        reportId,
        code,
        a.technicianId,
      );
    await insert('TRG-DUP-0001');
    await expect(insert('TRG-DUP-0001')).rejects.toThrow(/23505|unique/i);
  });
});

// ---------------------------------------------------------------------------
// A grade we cannot defend is a grade we do not publish
// ---------------------------------------------------------------------------

describe('grade integrity', () => {
  it('chk_override_reason: departing from the proposed grade demands a written reason', async () => {
    const a = await anchors();
    await expect(
      insertReport(a, { isCurrent: false, gradeProposed: 'A_PLUS', gradeFinal: 'B' }),
    ).rejects.toThrow(/chk_override_reason|23514/i);
  });

  it('accepts the override when the reason is given', async () => {
    const a = await anchors();
    await expect(
      insertReport(a, {
        isCurrent: false,
        gradeProposed: 'A_PLUS',
        gradeFinal: 'B',
        overrideReason: 'Lid dent not detected by the tool; photographed and downgraded on site.',
      }),
    ).resolves.toBeTruthy();
  });

  it('verification_code must be long enough to be unguessable', async () => {
    // It is a public URL. An enumerable one publishes the whole inventory.
    const a = await anchors();
    await expect(
      insertReport(a, { isCurrent: false, verificationCode: 'abc123' }),
    ).rejects.toThrow(/chk_verification_code_unguessable|23514/i);
  });

  it('refuses a duplicate verification code', async () => {
    const a = await anchors();
    const code = randomUUID().replace(/-/g, '').slice(0, 16);
    await insertReport(a, { isCurrent: false, verificationCode: code });
    await expect(
      insertReport(a, { isCurrent: false, verificationCode: code }),
    ).rejects.toThrow(/23505|unique/i);
  });

  it('rejects an area name outside the catalogued twelve', async () => {
    const a = await anchors();
    const reportId = await insertReport(a, { isCurrent: false });
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO qc.qc_area_result (qc_report_id, area, score, max_score, status)
         VALUES ($1::uuid, 'palmrest', 10, 10, 'PASS')`,
        reportId,
      ),
    ).rejects.toThrow(/qc_area_result_area_check|23514/i);
  });

  it('qc_area_result records each of the twelve areas at most once', async () => {
    const a = await anchors();
    const reportId = await insertReport(a, { isCurrent: false });
    const area = (name: string, status: string) =>
      db.$executeRawUnsafe(
        `INSERT INTO qc.qc_area_result (qc_report_id, area, score, max_score, status)
         VALUES ($1::uuid, $2, 10, 10, $3)`,
        reportId,
        name,
        status,
      );
    // The twelve areas the SCHEMA recognises are functional and upper-case:
    // DISPLAY, KEYBOARD, BATTERY, STORAGE, MEMORY_CPU, PORTS, CONNECTIVITY,
    // CAMERA_AUDIO, THERMAL, BIOS_SECURITY, DATA_SECURITY, PHYSICAL. PHASE_04_QC.md
    // lists a different twelve (chassis, lid, palmrest, trackpad, hinges, screen...)
    // which are cosmetic areas. SQL is the source of truth, so these are the values;
    // the cosmetic vocabulary belongs to grade_definition, not to qc_area_result.
    await area('PORTS', 'PASS');
    await expect(area('PORTS', 'FAIL')).rejects.toThrow(/23505|unique/i);
  });
});

// ---------------------------------------------------------------------------
// A correction has to actually correct something
// ---------------------------------------------------------------------------

describe('listing.grade_correction', () => {
  it('refuses a correction from a grade to itself', async () => {
    const unit = await seedSellableUnit({}, db);
    await expect(
      db.$executeRaw`
        INSERT INTO listing.grade_correction
          (id, unit_id, qc_report_id, grade_declared, grade_corrected, reason, vendor_notified_at)
        VALUES (gen_random_uuid(), ${unit.unitId}::uuid, ${unit.qcReportId}::uuid,
                'A'::grade_type, 'A'::grade_type, 'no change', now())`,
    ).rejects.toThrow(/chk_actually_different|23514/i);
  });
});

// ---------------------------------------------------------------------------
// One QC model, and it is the vendor-site one
// ---------------------------------------------------------------------------

describe('deprecated hub batch QC', () => {
  it('is still marked with an unsatisfiable CHECK', async () => {
    const rows = await db.$queryRaw<Array<{ def: string; validated: boolean }>>`
      SELECT pg_get_constraintdef(oid) AS def, convalidated AS validated
        FROM pg_constraint WHERE conname = 'chk_qc_batch_deprecated'`;
    // NOT VALID on purpose: historical rows stay readable, new ones cannot exist.
    expect(rows[0]?.def).toMatch(/CHECK \(false\) NOT VALID/i);
    expect(rows[0]?.validated).toBe(false);
  });

  it('refuses any new qc_batch row', async () => {
    // "Two live QC models with nothing marking which is authoritative is the most
    // dangerous ambiguity in the existing schema." The marker is a CHECK (false).
    // Every NOT NULL and the hub FK are satisfied first, so the only thing left
    // that can reject this row is the deprecation marker itself.
    const orgId = await makeOrganization({}, db);
    const addressId = await makeAddress(orgId, {}, db);
    const hubId = randomUUID();
    await db.$executeRaw`
      INSERT INTO logistics.hub (id, code, name, address_id)
      VALUES (${hubId}::uuid, 'HUB-DEP-1', 'Deprecation probe hub', ${addressId}::uuid)`;

    await expect(
      db.$executeRaw`
        INSERT INTO qc.qc_batch (id, batch_number, hub_id, source_type, expected_units,
                                 received_units, status, opened_at)
        VALUES (gen_random_uuid(), 'BATCH-NEW-1', ${hubId}::uuid, 'VENDOR_DELIVERY',
                10, 0, 'OPEN', now())`,
    ).rejects.toThrow(/chk_qc_batch_deprecated|23514/i);
  });
});

// ---------------------------------------------------------------------------
// Sampling rules
// ---------------------------------------------------------------------------

describe('qc_sampling_rule', () => {
  it('refuses two active rules for one tier', async () => {
    // Two active rules per tier means the sample percentage depends on which row
    // the planner happens to return first.
    await expect(
      db.$executeRaw`
        INSERT INTO qc.qc_sampling_rule
          (id, vendor_tier, sample_pct, always_full_above_value, effective_from, is_active)
        VALUES (gen_random_uuid(), 'GOLD', 10, 0, CURRENT_DATE + 1, TRUE)`,
    ).rejects.toThrow(/23505|unique/i);
  });
});

// ---------------------------------------------------------------------------
// The DeviceSure provider row
// ---------------------------------------------------------------------------

describe('qc_tool_provider DEVICESURE', () => {
  it('is seeded, active, and maps our field to their path — not the reverse', async () => {
    const rows = await db.$queryRaw<
      Array<{ integration_type: string; is_active: boolean; serial: string | null }>
    >`SELECT integration_type, is_active, field_map_json->>'serial' AS serial
        FROM qc.qc_tool_provider WHERE code = 'DEVICESURE'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_active).toBe(true);
    expect(rows[0]!.integration_type).toBe('WEBHOOK');
    // Reversed, the generic parser reads garbage for every provider.
    expect(rows[0]!.serial).toBe('device.serial');
  });
});
