/**
 * DeviceSure ingestion — `POST /qc/tool-runs`, against the real database.
 *
 * The four named cases (QC-001, QC-004, QC-008, QC-012) are here, and each one
 * is a property only Postgres can actually guarantee: an arbiter index that
 * short-circuits, a second unique index that does not, a partial unique index on
 * the live report, an enum-typed outcome column. A fake would agree with all of
 * them and prove none.
 *
 * The rest of the file covers the three rules the phase turns on, because they
 * are the ones a later refactor would quietly erode:
 *   - a certificate that contradicts itself is refused, never re-graded;
 *   - the raw payload survives every path, including refusal;
 *   - nothing here corrects an upstream defect — 15 GB stays 15 GB.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { generateKeyPairSync, randomUUID, sign as signEd25519 } from 'node:crypto';
import { signablePayload, type DeviceSureCertificate } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ObjectStorePort, QcPlatformPort } from '../../src/shared/adapters/ports';
import { FakeObjectStore } from '../../src/shared/adapters/fakes/infra.fakes';
import { NonceReplayError, QcRepository } from '../../src/modules/qc/internal/qc.repository';
import { DeviceSureClient } from '../../src/modules/qc/internal/devicesure.client';
import { IngestionService } from '../../src/modules/qc/internal/ingestion.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeTechnician, seedSellableUnit } from '../support/factories';

const NOW = new Date('2026-08-26T09:00:00.000Z');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;

let moduleRef: TestingModule;
let ingestion: IngestionService;
let repo: QcRepository;
let store: FakeObjectStore;
let config: AppConfig;
let raw: PrismaClient;

let unitId: string;
let serial: string;
let technicianId: string;
let visitId: string;
let visitUnitId: string;
let providerId: string;
let seededFieldMap: unknown;

/**
 * The map an operator would actually write, once DeviceSure's hardware block is
 * known. The migration seeds `"hardware": "hardware"` and nothing below it,
 * because §5.4 maps the block as a whole — so the per-column paths are the ops
 * edit the design expects ("change field_map_json and the parser, never the
 * tool"). Setting it here rather than in a migration is the point: it proves the
 * parser reads paths from data and holds no DeviceSure path of its own.
 */
const HARDWARE_MAP = {
  'hardware.ram_detected_gb': 'hardware.memory.usableGb',
  'hardware.ram_modules': 'hardware.memory.moduleCount',
  'hardware.ram_type': 'hardware.memory.type',
  'hardware.cpu_detected': 'hardware.cpu.model',
  'hardware.cores': 'hardware.cpu.cores',
  'hardware.storage_detected_gb': 'hardware.storage.usableGb',
  'hardware.storage_type': 'hardware.storage.bus',
  'hardware.smart_status': 'hardware.storage.smart',
  'hardware.screen_size': 'hardware.display.diagonalIn',
};

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(NOW) },
      {
        provide: PrismaService,
        useFactory: (cfg: AppConfig) => {
          Object.defineProperty(cfg, 'env', {
            value: { ...cfg.all, DATABASE_URL: testDatabaseUrl() },
            configurable: true,
          });
          return new PrismaService(cfg);
        },
        inject: [AppConfig],
      },
      { provide: ObjectStorePort, useClass: FakeObjectStore },
      {
        // Only `fetchPublicKey` is exercised here. The other three methods are
        // the outbound half of the port and belong to the licence lane, which
        // has its own suite (`licence-lifecycle.spec.ts`).
        provide: QcPlatformPort,
        useValue: {
          fetchPublicKey: async () => PUBLIC_KEY_PEM,
          createSession: async () => ({ sessionId: randomUUID() }),
          issueVendorLicence: async () => ({ licenceKey: 'DS-TEST' }),
          revokeVendorLicence: async () => undefined,
        },
      },
      QcRepository,
      DeviceSureClient,
      IngestionService,
    ],
  }).compile();

  ingestion = moduleRef.get(IngestionService);
  repo = moduleRef.get(QcRepository);
  store = moduleRef.get(ObjectStorePort);
  config = moduleRef.get(AppConfig);
  await moduleRef.get(PrismaService).$connect();

  seededFieldMap = (await repo.findToolProviderByCode('DEVICESURE'))!.fieldMapJson;
});

afterAll(async () => {
  // `qc_tool_provider` survives TRUNCATE, so an edited field map would leak into
  // every suite that runs after this one.
  await raw.$executeRaw`
    UPDATE qc.qc_tool_provider SET field_map_json = ${JSON.stringify(seededFieldMap)}::jsonb
     WHERE code = 'DEVICESURE'`;
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  Object.defineProperty(config, 'env', {
    value: { ...config.all, NODE_ENV: 'test' },
    configurable: true,
  });

  const seeded = await seedSellableUnit({ sealed: false }, raw);
  ({ unitId, serial } = seeded);
  ({ technicianId } = await makeTechnician(raw));

  const [facility] = await raw.$queryRaw<Array<{ id: string }>>`
    INSERT INTO vendor.vendor_facility (org_id, address_id, facility_type)
    VALUES (${seeded.vendorOrgId}::uuid, ${seeded.pickupAddressId}::uuid, 'WAREHOUSE')
    RETURNING id`;

  const visit = await repo.createVisit({
    visitNumber: 'QCV-' + randomUUID().slice(0, 8),
    vendorOrgId: seeded.vendorOrgId,
    facilityId: facility!.id,
    addressId: seeded.pickupAddressId,
    unitsRequested: 1,
    technicianId,
    status: 'IN_PROGRESS',
  });
  visitId = visit.id;
  const [manifest] = await repo.addVisitUnits(visitId, [{ unitId, serialNumber: serial }]);
  visitUnitId = manifest!.id;

  providerId = (await repo.findToolProviderByCode('DEVICESURE'))!.id;
  await setFieldMap({ ...(seededFieldMap as object), ...HARDWARE_MAP });
});

async function setFieldMap(map: unknown): Promise<void> {
  await raw.$executeRaw`
    UPDATE qc.qc_tool_provider SET field_map_json = ${JSON.stringify(map)}::jsonb
     WHERE code = 'DEVICESURE'`;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A DeviceSure certificate shaped the way §5 describes it, including the two
 * §3.4 defects on purpose: `usableGb: 15` on a machine with 16 GB installed, and
 * a 512 GB drive measured in binary as 477.
 */
function certificate(overrides: Record<string, unknown> = {}): DeviceSureCertificate {
  const cert = {
    certificate: {
      id: 'cert-' + randomUUID(),
      sha256: 'f'.repeat(64),
      validUntil: '2026-11-24',
    },
    session: { nonce: 'n-' + randomUUID(), rulesVersion: '1.0.0', externalRef: unitId },
    device: { serial, fingerprint: 'fp-' + randomUUID().slice(0, 12) },
    score: 92.4,
    grade: 'A',
    testResults: [
      { area: 'DISPLAY', status: 'PASS' },
      { area: 'STORAGE', status: 'PASS' },
      { area: 'BATTERY', status: 'WARN', detail: '78% health' },
    ],
    hardware: {
      memory: { usableGb: 15, installedGb: 16, moduleCount: 2, type: 'DDR5' },
      cpu: { model: 'Ryzen 7 7840HS', cores: 8 },
      storage: { usableGb: 477, nominalGb: 512, bus: 'NVMe', smart: 'OK' },
      display: { diagonalIn: 16.1 },
    },
    battery: { healthPct: 77.5, cycleCount: 0 },
    ...overrides,
  } as unknown as DeviceSureCertificate;
  return cert;
}

/** Sign in place, over `signablePayload` — the same bytes the service verifies. */
function signed(cert: DeviceSureCertificate): DeviceSureCertificate {
  const signature = signEd25519(null, Buffer.from(signablePayload(cert), 'utf8'), privateKey).toString(
    'base64',
  );
  return { ...cert, certificate: { ...cert.certificate, signature } };
}

function request(cert: DeviceSureCertificate, overrides: Record<string, unknown> = {}) {
  return {
    providerCode: 'DEVICESURE',
    agent: { toolVersion: '0.1.0', deviceCertId: 'AGENT-CERT-1' },
    certificate: cert as unknown as Record<string, unknown>,
    ...overrides,
  } as Parameters<IngestionService['ingest']>[0];
}

async function countToolRuns(): Promise<number> {
  const [row] = await raw.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM qc.qc_tool_run WHERE unit_id = ${unitId}::uuid`;
  return Number(row!.n);
}

// ---------------------------------------------------------------------------

describe('QC-001 — the same run submitted twice', () => {
  it('is ONE row, one report, and a 200 carrying the original', async () => {
    const cert = signed(certificate());

    const first = await ingestion.ingest(request(cert));
    expect(first.alreadyIngested).toBe(false);
    expect(first.qcReportId).not.toBeNull();

    // Byte-identical re-delivery: the same certificate id AND the same nonce.
    // This is what a webhook retry actually looks like, and it is the case the
    // repository's own suite could not cover — it had to vary the nonce. The
    // arbiter index on (tool_provider_id, tool_run_id) short-circuits before the
    // nonce index is consulted, which is why this is a 200 and not a 409.
    const second = await ingestion.ingest(request(cert));
    expect(second.alreadyIngested).toBe(true);
    expect(second.toolRunId).toBe(first.toolRunId);
    expect(second.qcReportId).toBe(first.qcReportId);
    expect(second.verificationCode).toBe(first.verificationCode);

    expect(await countToolRuns()).toBe(1);
    expect(await repo.findReportsByUnit(unitId)).toHaveLength(1);
  });
});

describe('QC-004 — a replayed nonce', () => {
  it('is refused even under a fresh run id, because the nonce is inside the signed payload', async () => {
    const first = certificate();
    await ingestion.ingest(request(signed(first)));

    const replay = certificate({
      certificate: { id: 'cert-' + randomUUID(), sha256: 'f'.repeat(64) },
      session: { ...first.session },
    });

    await expect(ingestion.ingest(request(signed(replay)))).rejects.toBeInstanceOf(NonceReplayError);
    expect(await countToolRuns()).toBe(1);
  });
});

describe('QC-008 — the constraint is the guarantee, not the service', () => {
  it('refuses a raw duplicate of (tool_provider_id, tool_run_id) at the database', async () => {
    const cert = signed(certificate());
    await ingestion.ingest(request(cert));

    const duplicate = raw.$executeRaw`
      INSERT INTO qc.qc_tool_run
        (unit_id, tool_provider_id, tool_version, tool_run_id, device_cert_id,
         raw_report_hash, parse_status, ingested_at)
      VALUES (${unitId}::uuid, ${providerId}::uuid, '0.1.0', ${cert.certificate.id},
              'AGENT-CERT-1', ${'a'.repeat(64)}, 'PENDING', now())`;

    // Not "the service refuses it" — anything that bypasses the service still
    // cannot produce a second row. That is the property offline sync relies on.
    await expect(duplicate).rejects.toMatchObject({ message: expect.stringMatching(/unique|23505/i) });
    expect(await countToolRuns()).toBe(1);
  });
});

describe('QC-012 — the label does not belong to the laptop', () => {
  it('hard-stops: no report, no grade, and the visit unit goes UNTESTABLE', async () => {
    const cert = signed(certificate({ device: { serial: 'XX-WRONG-9999' } }));

    const result = await ingestion.ingest(request(cert));

    expect(result.serialMatches).toBe(false);
    expect(result.hardStop).toBe(true);
    expect(result.accepted).toBe(false);
    // Nothing to grade: we do not know which machine this describes, so every
    // other number on the certificate is about something else.
    expect(result.qcReportId).toBeNull();
    expect(await repo.findReportsByUnit(unitId)).toHaveLength(0);

    const [manifest] = await repo.findVisitUnits({ visitId });
    expect(manifest!.outcome).toBe('UNTESTABLE');

    // Step 1 still held: the payload is evidence of exactly this attempt.
    const run = await repo.findToolRunById(result.toolRunId);
    expect(run!.serialMatches).toBe(false);
    expect(run!.rawReportJson).toMatchObject({ device: { serial: 'XX-WRONG-9999' } });
    expect(run!.parseError).toMatch(/Serial mismatch/);
  });

  it('reports the mismatch as a HARD_STOP defect rather than a silent flag', async () => {
    const result = await ingestion.ingest(
      request(signed(certificate({ device: { serial: 'XX-WRONG-9999' } }))),
    );
    expect(result.defects.map((d) => d.code)).toContain('SERIAL_MISMATCH');
    expect(result.defects.find((d) => d.code === 'SERIAL_MISMATCH')!.disposition).toBe('HARD_STOP');
  });
});

describe('step 1 — the raw payload, verbatim, first', () => {
  it('keeps fields nothing maps, in the row and in the object store', async () => {
    const cert = signed(
      certificate({ somethingWeHaveNeverSeen: { nested: [1, 2, 3] } }) as DeviceSureCertificate,
    );

    const result = await ingestion.ingest(request(cert));

    const run = await repo.findToolRunById(result.toolRunId);
    expect(run!.rawReportJson).toMatchObject({ somethingWeHaveNeverSeen: { nested: [1, 2, 3] } });
    expect(run!.rawReportKey).toBe(`qc/tool-runs/DEVICESURE/${cert.certificate.id}.json`);

    const stored = JSON.parse((await store.get(run!.rawReportKey!)).toString('utf8'));
    expect(stored.somethingWeHaveNeverSeen).toEqual({ nested: [1, 2, 3] });
  });

  it('stores our own digest, not the sender-supplied one, and records the disagreement', async () => {
    const result = await ingestion.ingest(request(signed(certificate())));
    const run = await repo.findToolRunById(result.toolRunId);
    // The fixture claims sha256 = 'ff…', which is not the digest of the payload.
    // A hash we did not compute is a claim, not a check.
    expect(run!.rawReportHash).not.toBe('f'.repeat(64));
    expect(run!.rawReportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(run!.parseError).toMatch(/disagrees with our digest/);
  });
});

describe('step 2 — the signature is what makes the certificate ours to publish', () => {
  it('accepts a certificate signed by the published key', async () => {
    const result = await ingestion.ingest(request(signed(certificate())));
    expect(result.accepted).toBe(true);
    expect(result.defects.map((d) => d.code)).not.toContain('UNSIGNED');
  });

  it('rejects a payload edited after signing — no report, payload retained', async () => {
    const cert = signed(certificate());
    // One field changed after the signature was computed. This is the whole
    // reason a hash is not enough: the tampered document still hashes to
    // something, it just is not what DeviceSure signed.
    const tampered = { ...cert, grade: 'A_PLUS' } as DeviceSureCertificate;

    const result = await ingestion.ingest(request(tampered));

    expect(result.accepted).toBe(false);
    expect(result.qcReportId).toBeNull();
    expect(result.defects.some((d) => d.disposition === 'REJECT')).toBe(true);
    // Still stored: being sent something that does not verify is itself evidence.
    expect((await repo.findToolRunById(result.toolRunId))!.rawReportJson).toBeTruthy();
  });

  it('refuses an unsigned certificate in production, and takes it outside it', async () => {
    const unsignedResult = await ingestion.ingest(request(certificate()));
    expect(unsignedResult.accepted).toBe(true);
    expect(unsignedResult.defects.find((d) => d.code === 'UNSIGNED')!.disposition).toBe('FLAG');

    Object.defineProperty(config, 'env', {
      value: { ...config.all, NODE_ENV: 'production' },
      configurable: true,
    });
    const inProduction = await ingestion.ingest(request(certificate()));
    expect(inProduction.accepted).toBe(false);
    expect(inProduction.qcReportId).toBeNull();
  });

  it('accepts an unsigned certificate in production on the manual-entry path', async () => {
    Object.defineProperty(config, 'env', {
      value: { ...config.all, NODE_ENV: 'production' },
      configurable: true,
    });

    const actorUserId = randomUUID();
    const result = await ingestion.ingest(
      request(certificate(), {
        manualEntry: { reason: 'Agent offline at the vendor site; entered from the printed report.', actorUserId },
      }),
    );

    expect(result.accepted).toBe(true);
    expect(result.parseStatus).toBe('MANUAL_ENTRY');
    // A reason and a named actor, or it does not happen.
    expect((await repo.findToolRunById(result.toolRunId))!.parseError).toContain(actorUserId);
  });
});

describe('the §3.1 defect — a grade that survives a component failure', () => {
  it('is refused, not re-graded: no qc_report, raw payload kept', async () => {
    const cert = signed(
      certificate({
        grade: 'A+',
        testResults: [
          { area: 'DISPLAY', status: 'PASS' },
          { area: 'PORTS', status: 'FAIL', detail: 'USB ports FAIL' },
        ],
      }),
    );

    const result = await ingestion.ingest(request(cert));

    expect(result.accepted).toBe(false);
    expect(result.qcReportId).toBeNull();
    expect(result.defects.map((d) => d.code)).toContain('GRADE_CONTRADICTS_FAILED_COMPONENT');
    // The point of refusing rather than downgrading: we do not substitute our
    // arithmetic for theirs and then publish the result as their finding.
    expect(await repo.findReportsByUnit(unitId)).toHaveLength(0);
    expect(await countToolRuns()).toBe(1);
  });

  it('ingests a not-listable grade but stops the unit', async () => {
    const result = await ingestion.ingest(request(signed(certificate({ grade: 'C' }))));

    // Different from a refusal: the machine was genuinely inspected and is
    // genuinely a C. The finding is real, so it is recorded; the unit still
    // stops, because we list nothing below B.
    expect(result.accepted).toBe(true);
    expect(result.hardStop).toBe(true);
    expect(result.qcReportId).not.toBeNull();
    expect(result.defects.map((d) => d.code)).toContain('GRADE_NOT_LISTABLE');
    expect((await repo.findReportById(result.qcReportId!))!.gradeProposed).toBeNull();
  });
});

describe('step 5 — the field map is data', () => {
  it('maps hardware through paths that exist only in the database', async () => {
    const result = await ingestion.ingest(request(signed(certificate())));
    expect(result.parseStatus).toBe('PARSED');

    const hw = await repo.findHardware(result.qcReportId!);
    expect(hw!.cpuDetected).toBe('Ryzen 7 7840HS');
    expect(hw!.cores).toBe(8);
    expect(hw!.ramModules).toBe(2);
    expect(hw!.storageType).toBe('NVMe');
    expect(hw!.smartStatus).toBe('OK');
    expect(hw!.screenSize).toBe(16.1);
    expect(hw!.batteryHealthPct).toBe(77.5);
  });

  it('does not correct its source: 15 GB stays 15, and the installed figure survives', async () => {
    const result = await ingestion.ingest(request(signed(certificate())));
    const hw = await repo.findHardware(result.qcReportId!);

    // 07 §3.4. The fix is in their Windows collector, not a +1 here — a parser
    // that quietly corrects its source is a parser nobody can reason about.
    expect(hw!.ramDetectedGb).toBe(15);
    expect(hw!.storageDetectedGb).toBe(477);
    // Nothing is lost, though: the whole block is kept, so `compareSpec()` can
    // render "16 GB installed (15 GB usable)" downstream.
    expect(hw!.rawJson).toMatchObject({ memory: { installedGb: 16 }, storage: { nominalGb: 512 } });
  });

  it('records a cycle count of 0 as reported (07 §3.5 is theirs to fix)', async () => {
    const result = await ingestion.ingest(request(signed(certificate())));
    const hw = await repo.findHardware(result.qcReportId!);
    expect(hw!.cycleCount).toBe(0);
  });

  it('carries the tool’s own score, grade and rules version onto the report', async () => {
    const result = await ingestion.ingest(request(signed(certificate())));
    const report = await repo.findReportById(result.qcReportId!);

    expect(report!.qcScore).toBe(92); // INT column; 92.4 rounds, it is not truncated to 4
    expect(report!.gradeProposed).toBe('A');
    expect(report!.rulesVersion).toBe('1.0.0');
    expect(report!.validUntil).toBe('2026-11-24');
    expect(report!.toolRunId).toBe(result.toolRunId);
    // Not yet a verdict of ours — that is the tolerance engine's to write.
    expect(report!.verdict).toBeNull();
    expect(report!.gradeFinal).toBeNull();
  });
});

describe('step 6 — the technician’s day does not stop because a parser regressed', () => {
  it('marks PARSE_FAILED, keeps the payload and the report, and leaves manual entry open', async () => {
    // The map without any path to RAM: exactly what a DeviceSure payload change
    // looks like from our side.
    await setFieldMap(seededFieldMap);

    const result = await ingestion.ingest(request(signed(certificate())));

    expect(result.parseStatus).toBe('PARSE_FAILED');
    expect(result.accepted).toBe(true);
    // The inspection still exists and can be completed by hand.
    expect(result.qcReportId).not.toBeNull();
    expect(await repo.findHardware(result.qcReportId!)).toBeNull();

    const run = await repo.findToolRunById(result.toolRunId);
    expect(run!.parseStatus).toBe('PARSE_FAILED');
    expect(run!.rawReportJson).toBeTruthy();
    // The error names the fix, so nobody has to read this file to find it.
    expect(run!.parseError).toMatch(/field_map_json/);
  });

  it('never defaults RAM to zero, because zero GB is a measurement and a false one', async () => {
    await setFieldMap(seededFieldMap);
    const result = await ingestion.ingest(request(signed(certificate())));
    const [row] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM qc.qc_hardware_detected
       WHERE qc_report_id = ${result.qcReportId!}::uuid`;
    expect(Number(row!.n)).toBe(0);
  });
});

describe('the linkage a certificate cannot supply', () => {
  it('resolves the unit from session.externalRef when the caller does not name one', async () => {
    const result = await ingestion.ingest(request(signed(certificate())));
    expect((await repo.findToolRunById(result.toolRunId))!.unitId).toBe(unitId);
  });

  it('takes the technician and the site from the visit, and links the run to the manifest', async () => {
    const result = await ingestion.ingest(request(signed(certificate())));
    const report = await repo.findReportById(result.qcReportId!);
    expect(report!.technicianId).toBe(technicianId);
    expect(report!.visitId).toBe(visitId);
    expect((await repo.findToolRunById(result.toolRunId))!.visitUnitId).toBe(visitUnitId);
  });

  it('refuses a certificate that names no machine we hold, and says so as a 422', async () => {
    const orphan = signed(
      certificate({ session: { nonce: 'n-' + randomUUID(), externalRef: 'not-a-uuid' } }),
    );
    await expect(ingestion.ingest(request(orphan))).rejects.toMatchObject({ httpStatus: 422 });
  });
});
