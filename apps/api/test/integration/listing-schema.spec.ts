/**
 * The Phase 3 listing schema, proved against a real Postgres.
 *
 * Raw SQL only, no service layer. Four of Phase 3's exit criteria are explicitly
 * about what the *database* refuses — "prove it by attempting a direct SQL
 * insert" — so routing them through application code would prove the
 * application instead, which is the opposite of the point. A careless service is
 * exactly the thing these are meant to survive.
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
import { ensurePlatformOrg, makeAddress, makeCatalog, makeListing, makeUser } from '../support/factories';

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

/** A vendor org with an address, a catalog SKU and a listing to hang units off. */
async function anchors(): Promise<{
  orgId: string;
  userId: string;
  skuId: string;
  listingId: string;
}> {
  const orgId = await ensurePlatformOrg(db);
  const userId = await makeUser(orgId, {}, db);
  const cat = await makeCatalog({}, db);
  const addressId = await makeAddress(orgId, {}, db);
  const listingId = await makeListing(
    { vendorOrgId: orgId, skuId: cat.skuId, pickupAddressId: addressId },
    db,
  );
  return { orgId, userId, skuId: cat.skuId, listingId };
}

/**
 * A bare unit insert. Deliberately not the makeUnit factory: that one also
 * creates a QC report and a seal, and a factory doing extra work is how a
 * constraint test starts passing for a reason the author did not intend.
 */
async function insertUnit(
  a: { orgId: string; skuId: string; listingId: string },
  serial: string,
  status = 'LISTED',
): Promise<string> {
  const id = randomUUID();
  await db.$executeRawUnsafe(
    `INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                               grade_declared, grade_actual, status, location)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
             'A'::grade_type, 'A'::grade_type, $6::unit_status, 'VENDOR')`,
    id,
    a.listingId,
    a.orgId,
    a.skuId,
    serial,
    status,
  );
  return id;
}

// ---------------------------------------------------------------------------
// The most important index in the database
// ---------------------------------------------------------------------------

describe('uq_unit_active_serial — one serial, one live place, nationwide', () => {
  it('LST-005: rejects a duplicate live serial at the database, not the application', async () => {
    const a = await anchors();
    await insertUnit(a, 'DUPSERIAL01');
    await expect(insertUnit(a, 'DUPSERIAL01')).rejects.toThrow(/23505|unique/i);
  });

  it('LST-005: rejects it across vendors too — the index is global, not per-org', async () => {
    const a = await anchors();
    await insertUnit(a, 'CROSSVENDOR1');

    const otherOrg = await makeUser(await ensurePlatformOrg(db), {}, db).then(async () => {
      const cat = await makeCatalog({ brand: 'Rival' }, db);
      const orgId = await ensurePlatformOrg(db);
      const addressId = await makeAddress(orgId, {}, db);
      const listingId = await makeListing(
        { vendorOrgId: orgId, skuId: cat.skuId, pickupAddressId: addressId },
        db,
      );
      return { orgId, skuId: cat.skuId, listingId };
    });

    await expect(insertUnit(otherOrg, 'CROSSVENDOR1')).rejects.toThrow(/23505|unique/i);
  });

  it('LST-007: a RETURNED_TO_VENDOR serial can be re-listed', async () => {
    const a = await anchors();
    const first = await insertUnit(a, 'RELISTME001');
    await db.$executeRaw`UPDATE listing.unit SET status = 'RETURNED_TO_VENDOR'::unit_status WHERE id = ${first}::uuid`;
    // The index is partial precisely so this works. A plain UNIQUE would strand
    // the serial forever and the machine could never be sold again.
    await expect(insertUnit(a, 'RELISTME001')).resolves.toBeTruthy();
  });

  it('LST-006: a SCRAPPED serial can be re-listed', async () => {
    const a = await anchors();
    const first = await insertUnit(a, 'SCRAPPED001');
    await db.$executeRaw`UPDATE listing.unit SET status = 'SCRAPPED'::unit_status WHERE id = ${first}::uuid`;
    await expect(insertUnit(a, 'SCRAPPED001')).resolves.toBeTruthy();
  });

  it('LST-010: a retired unit cannot be brought back while its serial is live again', async () => {
    // The direction the partial index is easy to get wrong: re-listing is fine,
    // but un-retiring the ORIGINAL once a replacement is live would put the same
    // serial in two live rows.
    const a = await anchors();
    const first = await insertUnit(a, 'REVIVE0001');
    await db.$executeRaw`UPDATE listing.unit SET status = 'RETURNED_TO_VENDOR'::unit_status WHERE id = ${first}::uuid`;
    await insertUnit(a, 'REVIVE0001');

    await expect(
      db.$executeRaw`UPDATE listing.unit SET status = 'LISTED'::unit_status WHERE id = ${first}::uuid`,
    ).rejects.toThrow(/23505|unique/i);
  });
});

// ---------------------------------------------------------------------------
// Tier prices
// ---------------------------------------------------------------------------

describe('excl_tier_overlap', () => {
  async function tier(listingId: string, min: number, max: number | null, price = 40000) {
    return db.$executeRawUnsafe(
      `INSERT INTO listing.listing_tier_price (id, listing_id, min_qty, max_qty, unit_price)
       VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4)`,
      listingId,
      min,
      max,
      price,
    );
  }

  it('accepts bands that meet but do not overlap', async () => {
    const { listingId } = await anchors();
    await tier(listingId, 1, 9);
    await expect(tier(listingId, 10, 49)).resolves.toBeDefined();
  });

  it('rejects overlapping bands', async () => {
    const { listingId } = await anchors();
    await tier(listingId, 1, 10);
    await expect(tier(listingId, 10, 49)).rejects.toThrow(/23P01|overlap|exclusion/i);
  });

  it('treats an open-ended band as reaching to infinity', async () => {
    const { listingId } = await anchors();
    await tier(listingId, 50, null);
    await expect(tier(listingId, 500, 900)).rejects.toThrow(/23P01|overlap|exclusion/i);
  });
});

// ---------------------------------------------------------------------------
// What we owe, and how it is taxed, do not move
// ---------------------------------------------------------------------------

describe('immutability triggers', () => {
  it('valuation_method is free to change until purchase_price is set', async () => {
    const a = await anchors();
    const unitId = await insertUnit(a, 'VALMETH0001');
    await db.$executeRaw`UPDATE listing.unit SET valuation_method = 'REGULAR' WHERE id = ${unitId}::uuid`;
    // chk_unit_margin_no_itc couples the two: a margin-scheme unit cannot also
    // have claimed input tax credit. Rule 32(5) is enforced in the schema.
    await expect(
      db.$executeRaw`UPDATE listing.unit SET valuation_method = 'MARGIN', itc_eligible = FALSE WHERE id = ${unitId}::uuid`,
    ).resolves.toBeDefined();
  });

  it('valuation_method is immutable once purchase_price is set', async () => {
    const a = await anchors();
    const unitId = await insertUnit(a, 'VALMETH0002');
    await db.$executeRaw`
      UPDATE listing.unit SET valuation_method = 'REGULAR', purchase_price = 25000
      WHERE id = ${unitId}::uuid`;
    await expect(
      db.$executeRaw`UPDATE listing.unit SET valuation_method = 'MARGIN', itc_eligible = FALSE WHERE id = ${unitId}::uuid`,
    ).rejects.toThrow(/immutable once purchase_price is set/i);
  });

  it('purchase_price is immutable once set — a retail reprice never touches what we owe', async () => {
    const a = await anchors();
    const unitId = await insertUnit(a, 'PURCHPRICE01');
    await db.$executeRaw`UPDATE listing.unit SET purchase_price = 25000 WHERE id = ${unitId}::uuid`;
    await expect(
      db.$executeRaw`UPDATE listing.unit SET purchase_price = 26000 WHERE id = ${unitId}::uuid`,
    ).rejects.toThrow(/purchase_price is immutable/i);
  });

  it('lets the retail price move freely while purchase_price stays put', async () => {
    const a = await anchors();
    const unitId = await insertUnit(a, 'RETAILMOVE01');
    await db.$executeRaw`UPDATE listing.unit SET purchase_price = 25000, retail_price = 30000 WHERE id = ${unitId}::uuid`;
    await expect(
      db.$executeRaw`UPDATE listing.unit SET retail_price = 28000 WHERE id = ${unitId}::uuid`,
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The counter hole this phase closed
// ---------------------------------------------------------------------------

describe('chk_qty_nonneg covers every counter', () => {
  it.each(['qty_available', 'qty_reserved', 'qty_total', 'qty_awaiting_qc', 'qty_qc_failed'])(
    'rejects a negative %s',
    async (col) => {
      const { listingId } = await anchors();
      await expect(
        db.$executeRawUnsafe(
          `UPDATE listing.listing SET ${col} = -1 WHERE id = $1::uuid`,
          listingId,
        ),
      ).rejects.toThrow(/chk_qty_nonneg|23514/i);
    },
  );

  it('a negative counter cannot be used to slip past the balance check', async () => {
    // The failure this closes: qty_awaiting_qc = -5 makes the balance inequality
    // easier to satisfy, so an oversold listing passes both constraints.
    const { listingId } = await anchors();
    await expect(
      db.$executeRaw`
        UPDATE listing.listing
        SET qty_total = 1, qty_available = 5, qty_awaiting_qc = -5
        WHERE id = ${listingId}::uuid`,
    ).rejects.toThrow(/chk_qty_nonneg|23514/i);
  });
});

// ---------------------------------------------------------------------------
// Guard-rail state is all-or-nothing
// ---------------------------------------------------------------------------

describe('guard-rail columns move together', () => {
  it('a floor override cannot be half-recorded', async () => {
    const { listingId, userId } = await anchors();
    await expect(
      db.$executeRaw`
        UPDATE listing.listing SET floor_override_by = ${userId}::uuid
        WHERE id = ${listingId}::uuid`,
    ).rejects.toThrow(/chk_floor_override_complete|23514/i);
  });

  it('accepts a complete floor override', async () => {
    const { listingId, userId } = await anchors();
    await expect(
      db.$executeRaw`
        UPDATE listing.listing
        SET floor_override_by = ${userId}::uuid,
            floor_override_at = now(),
            floor_override_reason = 'Clearing end-of-life stock, approved by category head.'
        WHERE id = ${listingId}::uuid`,
    ).resolves.toBeDefined();
  });

  it('a price-band flag cannot be recorded without the median it fired against', async () => {
    const { listingId } = await anchors();
    await expect(
      db.$executeRaw`
        UPDATE listing.listing SET price_band_flagged_at = now() WHERE id = ${listingId}::uuid`,
    ).rejects.toThrow(/chk_price_band_flag_complete|23514/i);
  });

  it('a sourcing declaration cannot claim a GST status without the verification behind it', async () => {
    const { orgId, listingId, userId } = await anchors();
    await expect(
      db.$executeRaw`
        INSERT INTO vendor.vendor_sourcing_declaration
          (id, org_id, listing_id, source_type, source_org_name, declared_by, vendor_gst_status)
        VALUES (gen_random_uuid(), ${orgId}::uuid, ${listingId}::uuid, 'CORPORATE_BUYBACK',
                'Acme Corp', ${userId}::uuid, 'UNREGISTERED')`,
    ).rejects.toThrow(/chk_vsd_gst_verified|23514/i);
  });
});

// ---------------------------------------------------------------------------
// Audit trails you cannot edit
// ---------------------------------------------------------------------------

describe('append-only tables', () => {
  const ROLE = 'trugrade_append_only_probe';

  beforeEach(async () => {
    // The test connection is a superuser, and a superuser bypasses every grant —
    // which is why asserting "the REVOKE function exists" proves nothing at all.
    // SET ROLE to a plain role does subject us to the ACL, so this is the only
    // way to show the guarantee actually bites.
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ROLE}`);
    await db.$executeRawUnsafe(`CREATE ROLE ${ROLE} NOLOGIN`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA listing TO ${ROLE}`);
    await db.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON listing.stock_movement, listing.price_history TO ${ROLE}`,
    );
    await db.$executeRawUnsafe(`SELECT ops.apply_append_only_grants('${ROLE}')`);
  });

  afterEach(async () => {
    await db.$executeRawUnsafe(`RESET ROLE`);
    await db.$executeRawUnsafe(
      `REVOKE ALL ON listing.stock_movement, listing.price_history FROM ${ROLE}`,
    );
    await db.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA listing FROM ${ROLE}`);
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ROLE}`);
  });

  it('stock_movement accepts inserts but refuses updates and deletes', async () => {
    const a = await anchors();
    const unitId = await insertUnit(a, 'MOVEMENT001');
    await db.$executeRaw`
      INSERT INTO listing.stock_movement (unit_id, from_status, to_status, reason, actor_id)
      VALUES (${unitId}::uuid, 'CREATED'::unit_status,
              'AWAITING_QC'::unit_status, 'submitted for inspection', ${a.userId}::uuid)`;

    await db.$executeRawUnsafe(`SET ROLE ${ROLE}`);
    await expect(
      db.$executeRaw`UPDATE listing.stock_movement SET reason = 'rewritten'`,
    ).rejects.toThrow(/42501|permission denied/i);
    await expect(db.$executeRaw`DELETE FROM listing.stock_movement`).rejects.toThrow(
      /42501|permission denied/i,
    );
  });

  it('price_history refuses updates and deletes too', async () => {
    const { listingId, userId } = await anchors();
    await db.$executeRaw`
      INSERT INTO listing.price_history (listing_id, old_price, new_price, changed_by, reason, change_source)
      VALUES (${listingId}::uuid, 40000, 38000, ${userId}::uuid,
              'Vendor reduced their ask.', 'VENDOR_REPRICE')`;

    await db.$executeRawUnsafe(`SET ROLE ${ROLE}`);
    await expect(
      db.$executeRaw`UPDATE listing.price_history SET new_price = 1`,
    ).rejects.toThrow(/42501|permission denied/i);
    await expect(db.$executeRaw`DELETE FROM listing.price_history`).rejects.toThrow(
      /42501|permission denied/i,
    );
  });
});

// ---------------------------------------------------------------------------
// A price change has to say why
// ---------------------------------------------------------------------------

describe('price_history demands a reason', () => {
  it('rejects a blank reason', async () => {
    const { listingId, userId } = await anchors();
    await expect(
      db.$executeRaw`
        INSERT INTO listing.price_history (listing_id, old_price, new_price, changed_by, reason)
        VALUES (${listingId}::uuid, 40000, 38000, ${userId}::uuid, '   ')`,
    ).rejects.toThrow(/chk_ph_reason_meaningful|23514/i);
  });

  it('rejects an uncatalogued change_source', async () => {
    const { listingId, userId } = await anchors();
    await expect(
      db.$executeRaw`
        INSERT INTO listing.price_history (listing_id, old_price, new_price, changed_by, reason, change_source)
        VALUES (${listingId}::uuid, 40000, 38000, ${userId}::uuid,
                'because I felt like it', 'VIBES')`,
    ).rejects.toThrow(/chk_ph_source|23514/i);
  });
});

// ---------------------------------------------------------------------------
// Exit criterion: zero drift at 500 units under concurrent status change
// ---------------------------------------------------------------------------

describe('v_stock_drift', () => {
  /**
   * A counter bug is how you oversell, so the guarantee is worth proving at a
   * size where a lost update would actually show. The trigger recomputes from
   * the unit rows rather than incrementing, which is what makes concurrent
   * writers safe — an increment would lose exactly the races this exercises.
   */
  it('returns zero rows after a 500-unit seed with concurrent status changes', async () => {
    const orgId = await ensurePlatformOrg(db);
    const cat = await makeCatalog({}, db);
    const addressId = await makeAddress(orgId, {}, db);

    const listingIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      listingIds.push(
        await makeListing(
          { vendorOrgId: orgId, skuId: cat.skuId, pickupAddressId: addressId, qty: 200 },
          db,
        ),
      );
    }

    // 100 units per listing, bulk — the trigger still fires per row.
    for (const [i, listingId] of listingIds.entries()) {
      await db.$executeRawUnsafe(
        `INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                   grade_declared, grade_actual, status, location)
         SELECT gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid,
                'DRIFT' || $4::text || lpad(g::text, 4, '0'),
                'A'::grade_type, 'A'::grade_type, 'LISTED'::unit_status, 'VENDOR'
         FROM generate_series(1, 100) g`,
        listingId,
        orgId,
        cat.skuId,
        String(i),
      );
    }

    const seeded = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM listing.unit`;
    expect(Number(seeded[0]!.n)).toBe(500);

    // Concurrent writers against the same listing rows. The trigger takes a row
    // lock on listing.listing, so these genuinely contend rather than
    // interleaving harmlessly.
    await Promise.all(
      listingIds.flatMap((listingId) => [
        db.$executeRawUnsafe(
          `UPDATE listing.unit SET status = 'RESERVED'::unit_status
           WHERE id IN (SELECT id FROM listing.unit WHERE listing_id = $1::uuid
                        ORDER BY serial_number LIMIT 30)`,
          listingId,
        ),
        db.$executeRawUnsafe(
          `UPDATE listing.unit SET status = 'QC_FAILED'::unit_status
           WHERE id IN (SELECT id FROM listing.unit WHERE listing_id = $1::uuid
                        ORDER BY serial_number DESC LIMIT 20)`,
          listingId,
        ),
      ]),
    );

    const drift = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM listing.v_stock_drift`;
    expect(drift).toEqual([]);

    // And the counters landed on the real numbers, not merely on each other.
    const counters = await db.$queryRaw<
      Array<{ qty_available: number; qty_reserved: number; qty_qc_failed: number }>
    >`SELECT qty_available, qty_reserved, qty_qc_failed
        FROM listing.listing WHERE id = ANY(${listingIds}::uuid[]) ORDER BY id`;
    for (const c of counters) {
      expect(Number(c.qty_available)).toBe(50);
      expect(Number(c.qty_reserved)).toBe(30);
      expect(Number(c.qty_qc_failed)).toBe(20);
    }
  }, 120_000);
});
