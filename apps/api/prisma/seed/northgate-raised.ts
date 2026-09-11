/* eslint-disable no-console -- CLI */
import { PrismaClient } from '@prisma/client';
import { SystemClock } from '../../src/shared/clock';
import { seedNorthgateRaisedPurchaseOrders } from './purchase-orders';

const prisma = new PrismaClient();
const clock = new SystemClock();

seedNorthgateRaisedPurchaseOrders(prisma, clock.now(), (m) => console.log(m))
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
