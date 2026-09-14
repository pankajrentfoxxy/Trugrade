import type { PrismaClient } from '@prisma/client';
import { fingerprintPii, rekeyPii } from '../../prisma/scripts/rekey-pii';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization } from '../support/factories';

const OLD = 'trugrade-local-pii-key';
const NEW = 'a-real-key-from-the-secret-store';

let db: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await seedTestReference(db);
  const orgA = await makeOrganization({ legal_name: 'Alpha Systems Pvt Ltd' }, db);
  const orgB = await makeOrganization({ legal_name: 'Beta Traders LLP' }, db);
  for (const [org, pan, account] of [
    [orgA, 'AAFFA1234K', '000123456789'],
    [orgB, 'BBGFB5678L', '998877665544'],
  ] as const) {
    await db.$executeRaw`
      INSERT INTO kyc.pan_record (org_id, pan_enc, pan_last4, pan_hash)
      VALUES (${org}::uuid, pgp_sym_encrypt(${pan}, ${OLD}), ${pan.slice(-4)}, ${pan})`;
    await db.$executeRaw`
      INSERT INTO kyc.bank_account (org_id, account_holder_name, account_number_enc, account_number_last4, ifsc)
      VALUES (${org}::uuid, 'Holder', pgp_sym_encrypt(${account}, ${OLD}), ${account.slice(-4)}, 'HDFC0001234')`;
  }
});

const decryptAll = async (key: string): Promise<string[]> => {
  const rows = await db.$queryRaw<Array<{ v: string }>>`
    SELECT pgp_sym_decrypt(pan_enc, ${key}) AS v FROM kyc.pan_record
    UNION ALL
    SELECT pgp_sym_decrypt(account_number_enc, ${key}) FROM kyc.bank_account
    ORDER BY 1`;
  return rows.map((r) => r.v);
};

describe('rekeyPii moves every PII column to a new key without changing a value', () => {
  it('a dry run verifies and changes nothing', async () => {
    const report = await rekeyPii(db, { oldKey: OLD, newKey: NEW, apply: false });

    expect(report.applied).toBe(false);
    expect(report.columns.find((c) => c.column === 'pan_enc')?.rows).toBe(2);
    expect(await decryptAll(OLD)).toEqual([
      '000123456789',
      '998877665544',
      'AAFFA1234K',
      'BBGFB5678L',
    ]);
  });

  it('an applied run decrypts under the new key to the same values, and the old key no longer opens them', async () => {
    const before = await fingerprintPii(db, OLD);

    await rekeyPii(db, { oldKey: OLD, newKey: NEW, apply: true });

    expect(await fingerprintPii(db, NEW)).toEqual(before);
    expect(await decryptAll(NEW)).toEqual([
      '000123456789',
      '998877665544',
      'AAFFA1234K',
      'BBGFB5678L',
    ]);
    await expect(decryptAll(OLD)).rejects.toThrow();
  });

  it('aborts and changes nothing when any row does not open with the old key', async () => {
    const org = await makeOrganization({ legal_name: 'Gamma Pvt Ltd' }, db);
    await db.$executeRaw`
      INSERT INTO kyc.bank_account (org_id, account_holder_name, account_number_enc, account_number_last4, ifsc)
      VALUES (${org}::uuid, 'Holder', pgp_sym_encrypt('111122223333', 'some-other-key'), '3333', 'HDFC0001234')`;

    await expect(rekeyPii(db, { oldKey: OLD, newKey: NEW, apply: true })).rejects.toThrow();

    const pans = await db.$queryRaw<Array<{ v: string }>>`
      SELECT pgp_sym_decrypt(pan_enc, ${OLD}) AS v FROM kyc.pan_record ORDER BY 1`;
    expect(pans.map((r) => r.v)).toEqual(['AAFFA1234K', 'BBGFB5678L']);
  });

  it('refuses identical keys', async () => {
    await expect(rekeyPii(db, { oldKey: OLD, newKey: OLD, apply: true })).rejects.toThrow(/same/);
  });
});
