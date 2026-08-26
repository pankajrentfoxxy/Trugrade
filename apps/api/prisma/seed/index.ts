/* eslint-disable no-console -- this is a CLI script; console is the output */
import { PrismaClient } from '@prisma/client';
import { seedReference } from './reference';
import { seedCatalog } from './catalog-seed';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding reference data…');
  await seedReference(prisma, (msg) => console.log(msg));

  // The catalog is business data, not reference data: truncateAll wipes it
  // between tests, so seeding it from seedReference() would make every
  // integration suite pay for 200 SKUs and 608 images it then throws away.
  // It belongs to the CLI, which is where someone actually wants a catalog.
  console.log('Seeding the catalog…');
  await seedCatalog(prisma, (msg) => console.log(msg));

  const runway = await prisma.$queryRaw<Array<{ table_name: string; runway_days: number }>>`
    SELECT table_name, runway_days FROM ops.v_partition_runway ORDER BY runway_days LIMIT 1`;
  console.log(`  partition runway: ${runway[0]?.runway_days ?? '?'} days minimum`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
