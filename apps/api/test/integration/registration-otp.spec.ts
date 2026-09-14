/**
 * Registration OTP must not reveal whether an address is already registered.
 * The send response is byte-identical; only delivery differs.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule, RequestContextService } from '../../src/shared/db/org-scope';
import { RedisService, RateLimiter, LockService } from '../../src/shared/redis/redis.service';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { NotificationOutbox } from '../../src/shared/adapters/fakes/infra.fakes';
import { TokenService } from '../../src/shared/auth/token.service';
import { EventBus } from '../../src/shared/events';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { IdentityController } from '../../src/modules/identity/identity.controller';
import { PasswordService } from '../../src/modules/identity/internal/password.service';
import { OtpService } from '../../src/modules/identity/internal/otp.service';
import { AuditService } from '../../src/modules/identity/internal/audit.service';
import { ContactChangeService } from '../../src/modules/identity/internal/contact-change.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization, makeUser } from '../support/factories';

let moduleRef: TestingModule;
let controller: IdentityController;
let redis: RedisService;
let ctx: RequestContextService;
let outbox: NotificationOutbox;
let clock: FixedClock;
let raw: PrismaClient;

const KNOWN_EMAIL = 'procurement@harbourpoint.example';
const KNOWN_MOBILE = '+919876543210';
const NEW_EMAIL = 'new.applicant@harbourpoint.example';
const NEW_MOBILE = '+919123456789';

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);
  clock = new FixedClock(new Date('2026-08-27T06:00:00.000Z'));

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule, AdaptersModule],
    providers: [
      { provide: ClockPort, useValue: clock },
      {
        provide: PrismaService,
        useFactory: (config: AppConfig) => {
          Object.defineProperty(config, 'env', {
            value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
          });
          return new PrismaService(config);
        },
        inject: [AppConfig],
      },
      RedisService,
      RateLimiter,
      LockService,
      TokenService,
      PasswordService,
      OtpService,
      AuditService,
      ContactChangeService,
      IdentityService,
      EventBus,
      IdentityController,
    ],
  }).compile();

  await moduleRef.init();
  controller = moduleRef.get(IdentityController);
  redis = moduleRef.get(RedisService);
  ctx = moduleRef.get(RequestContextService);
  outbox = moduleRef.get(NotificationOutbox);
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  await redis.client.flushdb();
  outbox.clear();
  clock.advanceTo(new Date('2026-08-27T06:00:00.000Z'));

  const orgId = await makeOrganization({ legal_name: 'Harbourpoint Devices Pvt Ltd' }, raw);
  await makeUser(orgId, { email: KNOWN_EMAIL, full_name: 'Ishaan Malhotra' }, raw);
  await raw.$executeRaw`
    UPDATE identity.user_account SET mobile = ${KNOWN_MOBILE} WHERE email = ${KNOWN_EMAIL}`;
});

function inRequest<T>(fn: () => Promise<T>, ip = '203.0.113.10'): Promise<T> {
  return ctx.run({ requestId: 'test', ip, userAgent: 'jest' }, fn);
}

function withoutDevCode(body: Record<string, unknown>): Record<string, unknown> {
  const { devCode: _d, ...rest } = body;
  return rest;
}

describe('registration OTP — enumeration-safe send', () => {
  it('returns the same response shape for a known and an unknown email', async () => {
    const known = await inRequest(() =>
      controller.sendRegistrationOtp({ channel: 'EMAIL', value: KNOWN_EMAIL }),
    );
    outbox.clear();
    const unknown = await inRequest(() =>
      controller.sendRegistrationOtp({ channel: 'EMAIL', value: NEW_EMAIL }),
    );

    expect(Object.keys(withoutDevCode(known)).sort()).toEqual(
      Object.keys(withoutDevCode(unknown)).sort(),
    );
    expect(known.channel).toBe('EMAIL');
    expect(unknown.channel).toBe('EMAIL');
    expect(outbox.all()).toHaveLength(1);
  });

  it('returns the same response shape for a known and an unknown mobile', async () => {
    const known = await inRequest(() =>
      controller.sendRegistrationOtp({ channel: 'MOBILE', value: KNOWN_MOBILE }),
    );
    outbox.clear();
    const unknown = await inRequest(() =>
      controller.sendRegistrationOtp({ channel: 'MOBILE', value: NEW_MOBILE }),
    );

    expect(Object.keys(withoutDevCode(known)).sort()).toEqual(
      Object.keys(withoutDevCode(unknown)).sort(),
    );
    expect(outbox.all()).toHaveLength(1);
  });

  it('sends nothing to an address that is already registered', async () => {
    await inRequest(() =>
      controller.sendRegistrationOtp({ channel: 'EMAIL', value: KNOWN_EMAIL }),
    );
    expect(outbox.all()).toHaveLength(0);
  });
});

describe('registration OTP — duplicate caught at register', () => {
  it('names a duplicate mobile when register is attempted', async () => {
    const identity = moduleRef.get(IdentityService);
    await expect(
      identity.assertRegistrationContactAvailable('MOBILE', KNOWN_MOBILE),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/already registered/i) as unknown,
    });
  });
});
