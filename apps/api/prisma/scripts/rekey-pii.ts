/**
 * Re-encrypt every PII column from one pgcrypto key to another.
 *
 * Until 2026-09 three call sites fell back to a key committed to this repository
 * when PII_ENCRYPTION_KEY was unset, and the live server never set it. Setting a
 * real key without this step would leave every PAN and bank account already
 * stored undecryptable.
 *
 * Safety properties, each of which is the point rather than a nicety:
 *   - One transaction. Every column moves or none does.
 *   - Keys come from the environment (PII_KEY_OLD, PII_KEY_NEW), never argv, so
 *     they are not in `ps` output or shell history, and they reach Postgres as
 *     bind parameters, so a failing statement cannot write them to the server log.
 *   - Before and after, each column is fingerprinted: a SHA-256 over every row's
 *     id and the SHA-256 of its decrypted value. The run aborts unless the "after"
 *     fingerprint under the new key equals the "before" fingerprint under the old
 *     key. Plaintext is never printed.
 *   - Dry run by default: everything happens, then rolls back. `--apply` commits.
 *
 * Run from apps/api:
 *   PII_KEY_OLD=… PII_KEY_NEW=… DATABASE_URL=… \
 *     ts-node -T --project tsconfig.json prisma/scripts/rekey-pii.ts [--apply]
 */
import { Prisma, PrismaClient } from '@prisma/client';

export interface PiiColumn {
  table: string;
  column: string;
}

/** Every pgcrypto-encrypted column in the schema. All three are keyed on `id`. */
export const PII_COLUMNS: readonly PiiColumn[] = [
  { table: 'kyc.pan_record', column: 'pan_enc' },
  { table: 'kyc.bank_account', column: 'account_number_enc' },
  { table: 'identity.user_account', column: 'mfa_secret_enc' },
];

export interface ColumnReport {
  table: string;
  column: string;
  rows: number;
  fingerprint: string;
}

export interface RekeyReport {
  applied: boolean;
  columns: ColumnReport[];
}

class DryRunRollback extends Error {
  constructor(readonly report: RekeyReport) {
    super('dry run');
  }
}

type Tx = Prisma.TransactionClient;

async function fingerprint(tx: Tx, col: PiiColumn, key: string): Promise<ColumnReport> {
  const table = Prisma.raw(col.table);
  const column = Prisma.raw(col.column);
  // pgp_sym_decrypt raises on a wrong key, which aborts the transaction: a row
  // the old key cannot open stops the run instead of being skipped.
  const [row] = await tx.$queryRaw<Array<{ rows: bigint; fp: string | null }>>`
    SELECT count(*) AS rows,
           encode(digest(coalesce(string_agg(
             id::text || ':' || encode(digest(pgp_sym_decrypt(${column}, ${key}), 'sha256'), 'hex'),
             ',' ORDER BY id), ''), 'sha256'), 'hex') AS fp
    FROM ${table}
    WHERE ${column} IS NOT NULL`;
  return {
    table: col.table,
    column: col.column,
    rows: Number(row?.rows ?? 0),
    fingerprint: row?.fp ?? '',
  };
}

export async function rekeyPii(
  prisma: PrismaClient,
  opts: { oldKey: string; newKey: string; apply: boolean },
): Promise<RekeyReport> {
  if (!opts.oldKey || !opts.newKey) throw new Error('Both the old and the new key are required.');
  if (opts.oldKey === opts.newKey) throw new Error('The new key is the same as the old key.');

  try {
    return await prisma.$transaction(
      async (tx) => {
        const columns: ColumnReport[] = [];
        for (const col of PII_COLUMNS) {
          const before = await fingerprint(tx, col, opts.oldKey);
          const table = Prisma.raw(col.table);
          const column = Prisma.raw(col.column);
          const updated = await tx.$executeRaw`
            UPDATE ${table}
               SET ${column} = pgp_sym_encrypt(pgp_sym_decrypt(${column}, ${opts.oldKey}), ${opts.newKey})
             WHERE ${column} IS NOT NULL`;
          if (updated !== before.rows) {
            throw new Error(
              `${col.table}.${col.column}: counted ${before.rows} rows, re-encrypted ${updated}.`,
            );
          }
          const after = await fingerprint(tx, col, opts.newKey);
          if (after.rows !== before.rows || after.fingerprint !== before.fingerprint) {
            throw new Error(
              `${col.table}.${col.column}: decrypted values changed under the new key. Rolled back.`,
            );
          }
          columns.push(before);
        }
        const report = { applied: opts.apply, columns };
        if (!opts.apply) throw new DryRunRollback(report);
        return report;
      },
      { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof DryRunRollback) return e.report;
    throw e;
  }
}

/** Fingerprint without changing anything — to compare two databases or two runs. */
export async function fingerprintPii(prisma: PrismaClient, key: string): Promise<ColumnReport[]> {
  return prisma.$transaction(async (tx) => {
    const out: ColumnReport[] = [];
    for (const col of PII_COLUMNS) out.push(await fingerprint(tx, col, key));
    return out;
  });
}

const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const printColumns = (columns: ColumnReport[]): void => {
  for (const c of columns)
    print(`${c.table}.${c.column}\trows=${c.rows}\tfingerprint=${c.fingerprint}`);
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const fingerprintOnly = process.argv.includes('--fingerprint');
  const prisma = new PrismaClient();
  try {
    if (fingerprintOnly) {
      const key = process.env.PII_KEY ?? '';
      if (!key) throw new Error('PII_KEY is required with --fingerprint.');
      printColumns(await fingerprintPii(prisma, key));
      return;
    }
    const report = await rekeyPii(prisma, {
      oldKey: process.env.PII_KEY_OLD ?? '',
      newKey: process.env.PII_KEY_NEW ?? '',
      apply,
    });
    printColumns(report.columns);
    print(report.applied ? 'COMMITTED.' : 'Dry run: verified, then rolled back. Nothing changed.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
