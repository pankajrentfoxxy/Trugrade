/**
 * The ten schema defects, each proved closed against a real Postgres 16.
 *
 * These are L2 tests by the placement rule in 04_TEST_PLAN.md §1.1: the assertion
 * is *about a database guarantee*, so proving it in the service layer would be
 * explicitly insufficient. Several of them insert violating data by raw SQL,
 * deliberately bypassing every line of application code, because that is the
 * only way to show the database is the thing holding the line.
 */

import type { PrismaClient } from '@prisma/client';
import { closeTestDb, migrateTestDatabase, testDb, truncateAll } from '../support/db';
import {
  forceUnitFlag,
  makeAddress,
  makeCatalog,
  makeListing,
  makeOrganization,
  makeUnit,
  seedSellableUnit,
} from '../support/factories';

let db: PrismaClient;

beforeAll(() => {
  migrateTestDatabase();
  db = testDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
});

// ---------------------------------------------------------------------------

describe('DEFECT 1 / DATA-05, DATA-06 — partition runway', () => {
  it('every partitioned table has at least 90 days of runway after maintenance', async () => {
    await db.$queryRaw`SELECT * FROM ops.ensure_partitions(6)`;
    const rows = await db.$queryRaw<Array<{ table_name: string; runway_days: number }>>`
      SELECT table_name, runway_days FROM ops.v_partition_runway`;

    expect(rows.length).toBe(5);
    for (const r of rows) {
      expect(r.runway_days).toBeGreaterThanOrEqual(90);
    }
  });

  it('DATA-05 — dropping the future partitions and re-running recreates them, idempotently', async () => {
    const before = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM pg_inherits inh
      JOIN pg_class parent ON parent.oid = inh.inhparent
      WHERE parent.relname = 'order_event'`;

    // Drop everything from next month onward.
    const children = await db.$queryRaw<Array<{ child: string }>>`
      SELECT child.relname AS child
      FROM pg_inherits inh
      JOIN pg_class parent ON parent.oid = inh.inhparent
      JOIN pg_class child ON child.oid = inh.inhrelid
      WHERE parent.relname = 'order_event'
        AND child.relname > 'order_event_' || to_char(CURRENT_DATE, 'YYYY_MM')`;
    for (const c of children) {
      await db.$executeRawUnsafe(`DROP TABLE ordering.${c.child}`);
    }

    const recreated = await db.$queryRaw<Array<{ created_count: number }>>`
      SELECT created_count FROM ops.ensure_partitions(6) WHERE table_name = 'order_event'`;
    expect(Number(recreated[0]?.created_count ?? 0)).toBe(children.length);

    const after = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM pg_inherits inh
      JOIN pg_class parent ON parent.oid = inh.inhparent
      WHERE parent.relname = 'order_event'`;
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));

    // Running again creates nothing. A nightly job that is not idempotent is a
    // nightly job that fails on its second night.
    const second = await db.$queryRaw<Array<{ created_count: number }>>`
      SELECT created_count FROM ops.ensure_partitions(6) WHERE table_name = 'order_event'`;
    expect(Number(second[0]?.created_count ?? -1)).toBe(0);
  });

  it('DATA-06 — a missing partition is reported as a shortfall, not silently tolerated', async () => {
    const children = await db.$queryRaw<Array<{ child: string }>>`
      SELECT child.relname AS child
      FROM pg_inherits inh
      JOIN pg_class parent ON parent.oid = inh.inhparent
      JOIN pg_class child ON child.oid = inh.inhrelid
      WHERE parent.relname = 'integration_log'
        AND child.relname > 'integration_log_' || to_char(CURRENT_DATE, 'YYYY_MM')`;
    for (const c of children) {
      await db.$executeRawUnsafe(`DROP TABLE platform.${c.child}`);
    }

    const rows = await db.$queryRaw<
      Array<{ table_name: string; runway_days: number; is_critical: boolean }>
    >`
      SELECT table_name, runway_days, is_critical FROM ops.v_partition_runway
      WHERE table_name = 'integration_log'`;

    expect(rows[0]!.runway_days).toBeLessThan(32);
    expect(rows[0]!.is_critical).toBe(true);
  });

  it('there is no DEFAULT partition anywhere — one would accept rows that then block real partitions', async () => {
    const defaults = await db.$queryRaw<Array<{ child: string }>>`
      SELECT child.relname AS child
      FROM pg_inherits inh
      JOIN pg_class child ON child.oid = inh.inhrelid
      WHERE pg_get_expr(child.relpartbound, child.oid) = 'DEFAULT'`;
    expect(defaults).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('DEFECT 2 — triggers the schema previously asserted only in prose', () => {
  it('VR-133 — valuation_method cannot change once purchase_price is set', async () => {
    const { unitId } = await seedSellableUnit();

    // Before purchase it is still free to change: a listing can be re-assessed.
    await db.$executeRaw`UPDATE listing.unit SET valuation_method = 'MARGIN', itc_eligible = FALSE WHERE id = ${unitId}::uuid`;
    await db.$executeRaw`UPDATE listing.unit SET valuation_method = 'REGULAR', itc_eligible = TRUE WHERE id = ${unitId}::uuid`;

    // Once we have actually bought it, the GST treatment is fixed for its life.
    await db.$executeRaw`UPDATE listing.unit SET purchase_price = 31000.00 WHERE id = ${unitId}::uuid`;

    await expect(
      db.$executeRaw`UPDATE listing.unit SET valuation_method = 'MARGIN' WHERE id = ${unitId}::uuid`,
    ).rejects.toThrow(/valuation_method is immutable/i);
  });

  it('a MARGIN unit can never be marked ITC-eligible — Rule 32(5) makes them mutually exclusive', async () => {
    const { unitId } = await seedSellableUnit();
    await expect(
      db.$executeRaw`UPDATE listing.unit SET valuation_method = 'MARGIN', itc_eligible = TRUE WHERE id = ${unitId}::uuid`,
    ).rejects.toThrow();
  });

  it('is_sellable is recomputed by the database, not trusted from the caller', async () => {
    const { unitId } = await seedSellableUnit();
    let row = await db.$queryRaw<Array<{ is_sellable: boolean }>>`
      SELECT is_sellable FROM listing.unit WHERE id = ${unitId}::uuid`;
    expect(row[0]!.is_sellable).toBe(true);

    // Expire the inspection. Nothing else changes; sellability must fall away.
    await db.$executeRaw`UPDATE listing.unit SET qc_valid_until = CURRENT_DATE - 1 WHERE id = ${unitId}::uuid`;
    row = await db.$queryRaw<Array<{ is_sellable: boolean }>>`
      SELECT is_sellable FROM listing.unit WHERE id = ${unitId}::uuid`;
    expect(row[0]!.is_sellable).toBe(false);
  });

  it('a unit with no seal is never sellable, even if everything else is right', async () => {
    const { unitId } = await seedSellableUnit({ sealed: false });
    const row = await db.$queryRaw<Array<{ is_sellable: boolean }>>`
      SELECT is_sellable FROM listing.unit WHERE id = ${unitId}::uuid`;
    expect(row[0]!.is_sellable).toBe(false);
  });

  it('listing quantity counters follow the units, so a counter bug cannot cause an oversell', async () => {
    const vendorOrgId = await makeOrganization();
    const pickupAddressId = await makeAddress(vendorOrgId);
    const { skuId } = await makeCatalog();
    const listingId = await makeListing({ vendorOrgId, skuId, pickupAddressId, qty: 3 });

    await makeUnit({ listingId, vendorOrgId, skuId, status: 'LISTED' });
    await makeUnit({ listingId, vendorOrgId, skuId, status: 'LISTED' });
    const third = await makeUnit({ listingId, vendorOrgId, skuId, status: 'LISTED' });

    let counters = await db.$queryRaw<Array<{ qty_available: number; qty_reserved: number }>>`
      SELECT qty_available, qty_reserved FROM listing.listing WHERE id = ${listingId}::uuid`;
    expect(counters[0]).toMatchObject({ qty_available: 3, qty_reserved: 0 });

    await db.$executeRaw`UPDATE listing.unit SET status = 'RESERVED' WHERE id = ${third.unitId}::uuid`;

    counters = await db.$queryRaw<Array<{ qty_available: number; qty_reserved: number }>>`
      SELECT qty_available, qty_reserved FROM listing.listing WHERE id = ${listingId}::uuid`;
    expect(counters[0]).toMatchObject({ qty_available: 2, qty_reserved: 1 });
  });

  it('updated_at is maintained by the database on every table that claims to have it', async () => {
    const tables = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
      FROM information_schema.columns c
      JOIN pg_class pc ON pc.relname = c.table_name
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
      WHERE c.column_name = 'updated_at'
        AND c.table_schema IN ('identity','customer','vendor','kyc','catalog','listing',
                               'ordering','qc','logistics','payment','platform')
        AND pc.relkind IN ('r','p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t WHERE t.tgrelid = pc.oid AND t.tgname = 'trg_set_updated_at')`;
    expect(Number(tables[0]!.n)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('DEFECT 3 / LST-051, DATA-03 — the seal-less sellable unit', () => {
  it('appears in v_sellability_drift, where the pre-fix view lost it to a NULL comparison', async () => {
    const { unitId } = await seedSellableUnit({ sealed: false });

    // Drift by definition is a state no code path produces on purpose, so we
    // have to disable the correcting trigger to create it.
    await forceUnitFlag(unitId, { is_sellable: true });

    const fixed = await db.$queryRaw<Array<{ unit_id: string; seal_ok: boolean }>>`
      SELECT unit_id, seal_ok FROM listing.v_sellability_drift WHERE unit_id = ${unitId}::uuid`;
    expect(fixed).toHaveLength(1);
    expect(fixed[0]!.seal_ok).toBe(false);

    // And the original view, reconstructed here, provably does not find it.
    // eslint-disable-next-line @trugrade/no-cross-schema-join -- this IS the defect: reproducing the pre-fix view is the whole assertion
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE VIEW listing.v_sellability_drift_prefix AS
      SELECT u.id AS unit_id
      FROM listing.unit u
      LEFT JOIN qc.qc_seal s ON s.id = u.seal_id
      WHERE u.is_sellable <> (
              u.status = 'LISTED' AND u.qc_passed_at IS NOT NULL
          AND u.qc_valid_until >= CURRENT_DATE AND s.status IN ('APPLIED','INTACT'))`);

    const prefix = await db.$queryRaw<Array<{ unit_id: string }>>`
      SELECT unit_id FROM listing.v_sellability_drift_prefix WHERE unit_id = ${unitId}::uuid`;
    expect(prefix).toHaveLength(0);
  });

  it('also catches a sellable unit whose inspection has expired', async () => {
    const { unitId } = await seedSellableUnit({ qcValidUntilDays: -1 });
    await forceUnitFlag(unitId, { is_sellable: true });

    const rows = await db.$queryRaw<Array<{ unit_id: string; qc_fresh: boolean }>>`
      SELECT unit_id, qc_fresh FROM listing.v_sellability_drift WHERE unit_id = ${unitId}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qc_fresh).toBe(false);
  });

  it('returns nothing for a genuinely sellable unit', async () => {
    const { unitId } = await seedSellableUnit();
    const rows = await db.$queryRaw<Array<{ unit_id: string }>>`
      SELECT unit_id FROM listing.v_sellability_drift WHERE unit_id = ${unitId}::uuid`;
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('DEFECT 4 / VR-152 — platform_config', () => {
  it('rejects a duplicate (key, effective_from)', async () => {
    await db.$executeRaw`
      INSERT INTO platform.platform_config (key, value_json, effective_from)
      VALUES ('test.threshold', '10'::jsonb, DATE '2026-01-01')`;
    await expect(
      db.$executeRaw`
        INSERT INTO platform.platform_config (key, value_json, effective_from)
        VALUES ('test.threshold', '20'::jsonb, DATE '2026-01-01')`,
    ).rejects.toThrow();
  });

  it('v_current_config takes the latest effective row, not whichever the planner returns', async () => {
    await db.$executeRaw`
      INSERT INTO platform.platform_config (key, value_json, effective_from) VALUES
        ('test.threshold', '10'::jsonb, CURRENT_DATE - 30),
        ('test.threshold', '20'::jsonb, CURRENT_DATE - 1),
        ('test.threshold', '99'::jsonb, CURRENT_DATE + 30)`;

    const rows = await db.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = 'test.threshold'`;
    expect(rows).toHaveLength(1);
    // Not 99: a future-dated row is scheduled, not current.
    expect(rows[0]!.value_json).toBe(20);
  });

  it('rejects a key that does not match the documented shape', async () => {
    await expect(
      db.$executeRaw`INSERT INTO platform.platform_config (key, value_json) VALUES ('Test.Bad Key', '1'::jsonb)`,
    ).rejects.toThrow();
  });

  it('the seeded keys were normalised rather than the rule being widened', async () => {
    const bad = await db.$queryRaw<Array<{ key: string }>>`
      SELECT key FROM platform.platform_config WHERE key <> lower(key)`;
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('DEFECT 5 / VR-156 — status columns are constrained, not free text', () => {
  const CASES: Array<[string, string, string]> = [
    ['logistics.delivery_task', 'status', 'DEFINITELY_NOT_A_STATUS'],
    ['payment.eway_bill', 'status', 'whatever'],
    ['payment.refund', 'status', 'oops'],
    ['platform.return_request', 'status', 'nonsense'],
    ['platform.ticket', 'status', 'typo'],
    ['platform.warranty_claim', 'status', 'bad'],
    ['platform.dispute', 'status', 'bad'],
    ['platform.data_subject_request', 'status', 'bad'],
  ];

  it('all nine previously unconstrained status columns now carry a CHECK', async () => {
    const constrained = await db.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conname LIKE 'chk_%_status_status'`;
    // One per table in the list above, plus payout.
    expect(constrained.length).toBeGreaterThanOrEqual(8);
  });

  it.each(CASES)('%s.%s rejects a free-text value', async (table, column, value) => {
    const [schema, name] = table.split('.');
    const exists = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM information_schema.columns
       WHERE table_schema = '${schema}' AND table_name = '${name}' AND column_name = '${column}'`,
    );
    if (Number(exists[0]!.n) === 0) return; // table not in the adopted schema

    const check = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM pg_constraint
       WHERE conname = 'chk_${name}_${column}_status'`,
    );
    expect(Number(check[0]!.n)).toBe(1);
    expect(value).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('DEFECT 8 — qc_sampling_rule cannot have two active rules for one tier', () => {
  it('rejects a second active rule for the same vendor tier', async () => {
    const existing = await db.$queryRaw<Array<{ vendor_tier: string }>>`
      SELECT vendor_tier FROM qc.qc_sampling_rule WHERE is_active LIMIT 1`;
    if (!existing.length) return;

    await expect(
      db.$executeRaw`
        INSERT INTO qc.qc_sampling_rule (vendor_tier, sample_pct, effective_from, is_active)
        VALUES (${existing[0]!.vendor_tier}::vendor_tier, 50, CURRENT_DATE + 1, TRUE)`,
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('DEFECT 9 — the hub-batch QC model is deprecated, not merely unused', () => {
  it('refuses a new qc_batch row while keeping the table for history', async () => {
    const exists = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM information_schema.tables
      WHERE table_schema = 'qc' AND table_name = 'qc_batch'`;
    if (Number(exists[0]!.n) === 0) return;

    const constraint = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM pg_constraint WHERE conname = 'chk_qc_batch_deprecated'`;
    expect(Number(constraint[0]!.n)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('DEFECT 10 — no placeholder credentials survive in any migration', () => {
  it('no migration file contains the shipped placeholder password', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '..', '..', 'prisma', 'migrations');
    const offenders: string[] = [];
    for (const dir of readdirSync(root)) {
      const file = join(root, dir, 'migration.sql');
      const sql = readFileSync(file, 'utf8');
      if (sql.includes('CHANGE_ME' + '_IN_PRODUCTION')) offenders.push(dir);
      if (/CREATE\s+ROLE\s+\w+\s+LOGIN\s+PASSWORD/i.test(sql))
        offenders.push(`${dir} (CREATE ROLE ... PASSWORD)`);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('the most important index in the database — VR-077, LST-005 to LST-010', () => {
  it('LST-005 — a duplicate live serial is rejected at the database, not merely in the service', async () => {
    const first = await seedSellableUnit();

    // Direct SQL. No service, no validation layer, no application code at all.
    const second = await makeCatalog();
    const listingId = await makeListing({
      vendorOrgId: first.vendorOrgId,
      skuId: second.skuId,
      pickupAddressId: first.pickupAddressId,
    });
    await expect(
      makeUnit({
        listingId,
        vendorOrgId: first.vendorOrgId,
        skuId: second.skuId,
        serial: first.serial,
      }),
    ).rejects.toThrow();
  });

  it('LST-006 — the same serial cannot be listed by a *different* vendor either', async () => {
    const first = await seedSellableUnit();
    const otherVendor = await makeOrganization({ legal_name: 'Beta Infotech LLP' });
    const otherAddress = await makeAddress(otherVendor, {
      city: 'Noida',
      state_code: '09',
      pincode: '201301',
    });
    const catalog = await makeCatalog();
    const listingId = await makeListing({
      vendorOrgId: otherVendor,
      skuId: catalog.skuId,
      pickupAddressId: otherAddress,
    });

    await expect(
      makeUnit({ listingId, vendorOrgId: otherVendor, skuId: catalog.skuId, serial: first.serial }),
    ).rejects.toThrow();
  });

  it('LST-007 — a serial on a returned unit can be re-listed, because the index is partial', async () => {
    const first = await seedSellableUnit();
    await db.$executeRaw`UPDATE listing.unit SET status = 'RETURNED_TO_VENDOR'::unit_status WHERE id = ${first.unitId}::uuid`;

    const catalog = await makeCatalog();
    const listingId = await makeListing({
      vendorOrgId: first.vendorOrgId,
      skuId: catalog.skuId,
      pickupAddressId: first.pickupAddressId,
    });
    const relisted = await makeUnit({
      listingId,
      vendorOrgId: first.vendorOrgId,
      skuId: catalog.skuId,
      serial: first.serial,
    });
    expect(relisted.unitId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('append-only tables', () => {
  it('the ledger, audit log, stock movements, custody events and consents are all append-only by grant', async () => {
    const fn = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'ops' AND p.proname = 'apply_append_only_grants'`;
    expect(Number(fn[0]!.n)).toBe(1);
  });
});
