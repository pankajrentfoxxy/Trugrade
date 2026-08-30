/* eslint-disable no-console -- this is a CLI script; console is the output */
import { PrismaClient } from '@prisma/client';
import { SystemClock } from '../../src/shared/clock';
import { seedReference } from './reference';
import { seedLogisticsNcr } from './logistics-ncr';
import { seedCatalog } from './catalog-seed';
import { seedDemo } from './demo';
import { seedInvoicing } from './invoicing';
import { seedAfterSale } from './after-sale';

const prisma = new PrismaClient();

/**
 * The same clock the API runs on, so a seeded delivery and the service that
 * measures the window from it are reading one source. `SystemClock` is the only
 * sanctioned caller of `Date.now()` in this codebase.
 */
const clock = new SystemClock();

async function main(): Promise<void> {
  console.log('Seeding reference data…');
  await seedReference(prisma, (msg) => console.log(msg));

  // Serviceability and the rate card are reference data too, but they belong to
  // `seedReference` only once the pincode master is a real India Post extract
  // rather than the pilot's twenty rows. Called from here in the meantime; the
  // integration suite calls `seedLogisticsNcr` directly for the same reason.
  console.log('Seeding the NCR pilot lane…');
  await seedLogisticsNcr(prisma, (msg) => console.log(msg));

  // The catalog is business data, not reference data: truncateAll wipes it
  // between tests, so seeding it from seedReference() would make every
  // integration suite pay for 200 SKUs and 608 images it then throws away.
  // It belongs to the CLI, which is where someone actually wants a catalog.
  console.log('Seeding the catalog…');
  await seedCatalog(prisma, (msg) => console.log(msg));

  // Demo accounts and walkable stock. Opt-in via SEED_DEMO=1 so a plain
  // `db:seed` never writes known passwords by surprise.
  if (process.env.SEED_DEMO === '1') {
    console.log('Seeding demo accounts and stock…');
    await seedDemo(prisma, (m) => console.log(m));

    // Our own GST registration and the invoice series. Demo-gated because it
    // depends on the INTERNAL organisation the demo seed creates, and because a
    // synthetic GSTIN has no business on a database that is not a demo.
    console.log('Seeding the seller registration and invoice series…');
    await seedInvoicing(prisma, (m) => console.log(m));

    // Orders far enough along that warranty, returns and the delivery check
    // have something to show. Demo-gated for the same reason: it advances real
    // order statuses, which has no business on a database that is not a demo.
    console.log('Advancing orders so the after-sale screens are reachable…');
    await seedAfterSale(prisma, clock.now(), (m) => console.log(m));
  }

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
