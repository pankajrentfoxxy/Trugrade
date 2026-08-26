/**
 * The retrofit guarantees that only a database can hold.
 *
 * The freeze rule is the one that matters commercially: what we owe a vendor is
 * fixed when the purchase order is raised, and nothing that happens to the
 * retail price afterwards may touch it. A promotion, a grade correction, a price
 * match — all of them rewrite the selling price, and any one of them reaching
 * `purchase_price` is a dispute the vendor is right to raise.
 *
 * These are L2 tests: they write raw SQL on purpose, bypassing every line of
 * application code, because the point is that the database refuses regardless of
 * which service is careless.
 */

import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { closeTestDb, migrateTestDatabase, testDb, truncateAll } from '../support/db';
import { seedSellableUnit } from '../support/factories';

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

async function aUnit(): Promise<string> {
  const { unitId } = await seedSellableUnit({}, db);
  return unitId;
}

describe('CHANGE 5 — purchase_price is frozen when the PO is raised', () => {
  it('accepts the first write, because that is the PO', async () => {
    const unitId = await aUnit();
    await db.$executeRaw`
      UPDATE listing.unit SET purchase_price = 28000.00 WHERE id = ${unitId}::uuid`;

    const [row] = await db.$queryRaw<Array<{ purchase_price: unknown }>>`
      SELECT purchase_price FROM listing.unit WHERE id = ${unitId}::uuid`;
    expect(String(row!.purchase_price)).toBe('28000');
  });

  it('refuses to change it afterwards, even by raw SQL', async () => {
    const unitId = await aUnit();
    await db.$executeRaw`
      UPDATE listing.unit SET purchase_price = 28000.00 WHERE id = ${unitId}::uuid`;

    await expect(
      db.$executeRaw`UPDATE listing.unit SET purchase_price = 26000.00 WHERE id = ${unitId}::uuid`,
    ).rejects.toThrow(/immutable once set/);

    // And the original survived the attempt.
    const [row] = await db.$queryRaw<Array<{ purchase_price: unknown }>>`
      SELECT purchase_price FROM listing.unit WHERE id = ${unitId}::uuid`;
    expect(String(row!.purchase_price)).toBe('28000');
  });

  it('refuses to clear it to NULL — the cheapest way to defeat the lock', async () => {
    const unitId = await aUnit();
    await db.$executeRaw`
      UPDATE listing.unit SET purchase_price = 28000.00 WHERE id = ${unitId}::uuid`;

    // IS DISTINCT FROM is what makes this fail; a plain `<>` would let NULL past.
    await expect(
      db.$executeRaw`UPDATE listing.unit SET purchase_price = NULL WHERE id = ${unitId}::uuid`,
    ).rejects.toThrow(/immutable once set/);
  });

  it('lets everything else about the unit keep moving', async () => {
    const unitId = await aUnit();
    await db.$executeRaw`
      UPDATE listing.unit SET purchase_price = 28000.00 WHERE id = ${unitId}::uuid`;

    // A grade correction after the PO is a normal, expected event. The whole
    // point of the freeze is that this no longer touches what we owe.
    await db.$executeRaw`
      UPDATE listing.unit SET grade_actual = 'B'::grade_type WHERE id = ${unitId}::uuid`;

    const [row] = await db.$queryRaw<Array<{ grade_actual: string; purchase_price: unknown }>>`
      SELECT grade_actual, purchase_price FROM listing.unit WHERE id = ${unitId}::uuid`;
    expect(row!.grade_actual).toBe('B');
    expect(String(row!.purchase_price)).toBe('28000');
  });

  it('is a no-op on an unpriced unit, so ordinary updates are unaffected', async () => {
    const unitId = await aUnit();
    await expect(
      db.$executeRaw`UPDATE listing.unit SET status = 'RESERVED'::unit_status WHERE id = ${unitId}::uuid`,
    ).resolves.toBeGreaterThan(0);
  });

  it('tolerates a re-write of the same value, which a retried PO job will do', async () => {
    const unitId = await aUnit();
    await db.$executeRaw`
      UPDATE listing.unit SET purchase_price = 28000.00 WHERE id = ${unitId}::uuid`;
    // Idempotent by value: an at-least-once job must not dead-letter on its own retry.
    await expect(
      db.$executeRaw`UPDATE listing.unit SET purchase_price = 28000.00 WHERE id = ${unitId}::uuid`,
    ).resolves.toBeGreaterThan(0);
  });
});

describe('CHANGE 6.1 — the warranty split must always add up', () => {
  async function insertWarranty(total: number, vendor: number, platform: number): Promise<void> {
    const unitId = await aUnit();
    await db.$executeRaw`
      INSERT INTO platform.warranty (id, unit_id, start_date, end_date, terms_version,
                                     total_months, vendor_backed_months, platform_backed_months)
      VALUES (${randomUUID()}::uuid, ${unitId}::uuid, CURRENT_DATE,
              CURRENT_DATE + ${total * 30}::int, 'v1',
              ${total}::int, ${vendor}::int, ${platform}::int)`;
  }

  it('accepts a split that reconciles', async () => {
    await expect(insertWarranty(6, 3, 3)).resolves.toBeUndefined();
    await expect(insertWarranty(9, 6, 3)).resolves.toBeUndefined();
  });

  it('rejects a term nobody is funding', async () => {
    // 12 months sold, 6 funded. The unpriced liability the reserve exists to stop.
    await expect(insertWarranty(12, 3, 3)).rejects.toThrow(/chk_warranty_split/);
  });

  it('has no customer-visible provider column', async () => {
    // A `provider` field defeats both the trust play and the anonymity model:
    // the customer deals only with us, for the whole term.
    const rows = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'platform' AND table_name = 'warranty'`;
    expect(rows.map((r) => r.column_name)).not.toContain('provider');
  });
});

describe('CHANGE 4 — the four captures are on the tables that own them', () => {
  it.each([
    ['vendor', 'vendor_facility', 'dispatch_address_id'],
    ['vendor', 'vendor_capability', 'can_dropship'],
    ['vendor', 'vendor_profile', 'default_warranty_months'],
    ['vendor', 'vendor_profile', 'default_warranty_scope'],
    ['vendor', 'vendor_payout_preference', 'pricing_mode'],
    ['listing', 'listing', 'vendor_warranty_months'],
  ])('%s.%s.%s exists', async (schema, table, column) => {
    const rows = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = ${table} AND column_name = ${column}`;
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('defaults pricing_mode to the decided basis', async () => {
    const rows = await db.$queryRaw<Array<{ column_default: string | null }>>`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'vendor' AND table_name = 'vendor_payout_preference'
        AND column_name = 'pricing_mode'`;
    expect(rows[0]!.column_default).toMatch(/NET_PAYOUT/);
  });
});

describe('CHANGE 6.5 — a vendor starts supervised, whatever their licence says', () => {
  it('defaults qc_mode to SUPERVISED, so the first listing gets a visit', async () => {
    const rows = await db.$queryRaw<Array<{ column_default: string | null }>>`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'vendor' AND table_name = 'vendor_profile'
        AND column_name = 'qc_mode'`;
    expect(rows[0]!.column_default).toMatch(/SUPERVISED/);
  });

  it('defaults devicesure_status to NONE — nobody holds a licence by accident', async () => {
    const rows = await db.$queryRaw<Array<{ column_default: string | null }>>`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'vendor' AND table_name = 'vendor_profile'
        AND column_name = 'devicesure_status'`;
    expect(rows[0]!.column_default).toMatch(/NONE/);
  });
});
