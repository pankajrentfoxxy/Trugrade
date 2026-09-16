/**
 * Carriers marking their own deliveries.
 *
 * The properties here are the ones that decide whether this endpoint is safe to
 * expose at all. It is unauthenticated by necessity — a carrier cannot hold one
 * of our sessions — so the signature IS the authentication, and a webhook that
 * can mark an order delivered without one is a way to make this platform pay a
 * vendor for goods that never moved.
 */

import { randomUUID, createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { AuthModule } from '../../src/shared/auth/auth.module';
import { EventBusModule } from '../../src/shared/events/event-bus';
import { AutomationModule } from '../../src/shared/automation/automation.service';
import { RedisModule, RedisService } from '../../src/shared/redis/redis.service';
import { LogisticsModule } from '../../src/modules/logistics';
import { CarrierWebhookController } from '../../src/modules/logistics/webhook.controller';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization } from '../support/factories';

const NOW = new Date(new Date().toISOString().slice(0, 10) + 'T09:00:00.000Z');
const SECRET = 'test-webhook-secret';

let moduleRef: TestingModule;
let webhooks: CarrierWebhookController;
let redis: RedisService;
let db: PrismaClient;

let shipmentId: string;
let deliveryTaskId: string;
const AWB = 'BD-4471928365';

/** A request as the carrier sends it: raw bytes, and an HMAC over exactly those. */
function signed(body: unknown): { req: { rawBody: Buffer }; signature: string; body: unknown } {
  const raw = Buffer.from(JSON.stringify(body));
  return {
    req: { rawBody: raw },
    signature: createHmac('sha256', SECRET).update(raw).digest('hex'),
    body,
  };
}

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ContextModule,
      RedisModule,
      EventBusModule,
      AutomationModule,
      AuthModule,
      AdaptersModule,
      LogisticsModule,
    ],
  })
    .overrideProvider(ClockPort)
    .useValue(new FixedClock(NOW))
    .overrideProvider(PrismaService)
    .useFactory({
      factory: (config: AppConfig) => {
        Object.defineProperty(config, 'env', {
          value: {
            ...config.all,
            DATABASE_URL: testDatabaseUrl(),
            BLUEDART_WEBHOOK_SECRET: SECRET,
            PORTER_WEBHOOK_SECRET: SECRET,
          },
        });
        return new PrismaService(config);
      },
      inject: [AppConfig],
    })
    .compile();

  webhooks = moduleRef.get(CarrierWebhookController);
  redis = moduleRef.get(RedisService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

/**
 * A shipment with an AWB and a delivery task, and nothing else.
 *
 * Deliberately not a whole order: these assertions are about what a webhook
 * does to a consignment, and building a checkout to reach one would make the
 * failures harder to read rather than the test stronger.
 */
beforeEach(async () => {
  await truncateAll(db);
  await redis.client.flushdb();

  const vendorOrgId = await makeOrganization({ legal_name: 'Northgate IT' }, db);
  const fromId = randomUUID();
  const toId = randomUUID();
  for (const [id, city] of [
    [fromId, 'Gurugram'],
    [toId, 'New Delhi'],
  ] as const) {
    await db.$executeRaw`
      INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                        contact_name, contact_mobile)
      VALUES (${id}::uuid, ${vendorOrgId}::uuid, 'PICKUP'::address_type, 'Plot 42',
              ${city}, 'Haryana', '06', '122015', 'Supervisor', '+919876543210')`;
  }

  const [carrier] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM logistics.carrier WHERE code = 'BLUEDART'`;

  shipmentId = randomUUID();
  await db.$executeRaw`
    INSERT INTO logistics.shipment
      (id, leg, carrier_id, from_address_id, to_address_id, mode, declared_value,
       boxes, status, route_type, awb_number, created_at)
    VALUES (${shipmentId}::uuid, 'OUTBOUND'::public.shipment_leg, ${carrier!.id}::uuid,
            ${fromId}::uuid, ${toId}::uuid, 'SURFACE', 42000, 1,
            'SCHEDULED'::public.shipment_status, 'DIRECT'::public.route_type, ${AWB}, ${NOW})`;

  deliveryTaskId = randomUUID();
  await db.$executeRaw`
    INSERT INTO logistics.delivery_task (id, shipment_id, status)
    VALUES (${deliveryTaskId}::uuid, ${shipmentId}::uuid, 'PENDING')`;
});

const shipmentRow = async (): Promise<{ status: string; delivered_at: Date | null }> => {
  const [row] = await db.$queryRaw<Array<{ status: string; delivered_at: Date | null }>>`
    SELECT status::text AS status, delivered_at FROM logistics.shipment
     WHERE id = ${shipmentId}::uuid`;
  return row!;
};

const countOf = async (sql: Promise<Array<{ n: bigint }>>): Promise<number> =>
  Number((await sql)[0]!.n);

/* ========================================================================== */

describe('a signed carrier webhook', () => {
  it('marks the consignment delivered at the carrier’s own timestamp', async () => {
    const carrierInstant = '2026-09-16T06:30:00.000Z';
    const { req, signature, body } = signed({
      awb: AWB,
      statusCode: 'DL',
      occurredAt: carrierInstant,
    });

    const result = await webhooks.bluedart(req as never, signature, body as never);
    expect(result.accepted).toBe(true);

    const shipment = await shipmentRow();
    expect(shipment.status).toBe('DELIVERED');
    // The carrier's instant, not ours. The return window that decides when a
    // vendor is paid runs from this, so an hour of drift is an hour of money.
    expect(shipment.delivered_at?.toISOString()).toBe(carrierInstant);

    const [task] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM logistics.delivery_task WHERE id = ${deliveryTaskId}::uuid`;
    expect(task!.status).toBe('DELIVERED');
  });

  it('is idempotent: a replayed delivery changes nothing and still answers 200', async () => {
    const { req, signature, body } = signed({
      awb: AWB,
      statusCode: 'DL',
      occurredAt: '2026-09-16T06:30:00.000Z',
    });

    await webhooks.bluedart(req as never, signature, body as never);
    const first = await shipmentRow();
    const result = await webhooks.bluedart(req as never, signature, body as never);

    expect(result.accepted).toBe(true);
    const second = await shipmentRow();
    expect(second.delivered_at?.toISOString()).toBe(first.delivered_at?.toISOString());

    // Two tracking rows (the carrier sent two messages) but ONE delivery.
    const custody = await countOf(
      db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM logistics.custody_event`,
    );
    expect(custody).toBe(0); // no shipment_unit rows in this fixture
    const delivered = await countOf(
      db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM logistics.shipment_tracking
         WHERE shipment_id = ${shipmentId}::uuid AND status_code = 'DELIVERED'`,
    );
    expect(delivered).toBe(1);
  });

  it('refuses a bad signature and writes nothing', async () => {
    const { req, body } = signed({ awb: AWB, statusCode: 'DL' });

    await expect(
      webhooks.bluedart(req as never, 'not-the-signature', body as never),
    ).rejects.toMatchObject({ httpStatus: 401, code: 'UNAUTHENTICATED' });

    expect((await shipmentRow()).status).toBe('SCHEDULED');
    const tracking = await countOf(
      db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM logistics.shipment_tracking`,
    );
    expect(tracking).toBe(0);
  });

  it('refuses an unsigned call even when the body is perfect', async () => {
    const { req, body } = signed({ awb: AWB, statusCode: 'DL' });
    await expect(webhooks.bluedart(req as never, undefined, body as never)).rejects.toMatchObject({
      httpStatus: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('stores an unknown status, tells a person, and changes nothing', async () => {
    const { req, signature, body } = signed({ awb: AWB, statusCode: 'ZZ-NEW-CODE' });
    await webhooks.bluedart(req as never, signature, body as never);

    expect((await shipmentRow()).status).toBe('SCHEDULED');

    const [tracking] = await db.$queryRaw<Array<{ status_code: string; raw_payload: unknown }>>`
      SELECT status_code, raw_payload FROM logistics.shipment_tracking
       WHERE shipment_id = ${shipmentId}::uuid`;
    expect(tracking!.status_code).toBe('ZZ-NEW-CODE');
    expect(tracking!.raw_payload).toMatchObject({ statusCode: 'ZZ-NEW-CODE' });

    const [task] = await db.$queryRaw<Array<{ kind: string; severity: string }>>`
      SELECT kind, severity FROM ordering.ops_task WHERE kind = 'UNKNOWN_CARRIER_STATUS'`;
    expect(task).toMatchObject({ severity: 'FYI' });
  });

  it('records an NDR with only the actions the carrier will accept', async () => {
    const { req, signature, body } = signed({
      awb: AWB,
      statusCode: 'UD',
      reason: 'Consignee premises closed',
    });
    await webhooks.bluedart(req as never, signature, body as never);

    const [attempt] = await db.$queryRaw<Array<{ attempt_no: number; outcome: string }>>`
      SELECT attempt_no, outcome FROM logistics.delivery_attempt`;
    expect(attempt).toMatchObject({ attempt_no: 1, outcome: 'OFFICE_CLOSED' });

    const [task] = await db.$queryRaw<
      Array<{ kind: string; severity: string; detail: { legalActions: string[] } }>
    >`
      SELECT kind, severity, detail FROM ordering.ops_task WHERE kind = 'NDR'`;
    expect(task).toMatchObject({ kind: 'NDR', severity: 'ATTENTION' });
    // The carrier's own list, not ours: firing a refused action burns hours of
    // a 36-hour window.
    expect(task!.detail.legalActions).toContain('REATTEMPT');
    expect(task!.detail.legalActions).toContain('RTO');
  });

  it('accepts an AWB it does not know without writing anything', async () => {
    const { req, signature, body } = signed({ awb: 'BD-0000000000', statusCode: 'DL' });
    const result = await webhooks.bluedart(req as never, signature, body as never);

    expect(result.accepted).toBe(true);
    expect((await shipmentRow()).status).toBe('SCHEDULED');
  });

  it('moves a Porter trip through its own vocabulary', async () => {
    const { req, signature, body } = signed({ awb: AWB, statusCode: 'live' });
    await webhooks.porter(req as never, signature, body as never);
    expect((await shipmentRow()).status).toBe('IN_TRANSIT');
  });
});
