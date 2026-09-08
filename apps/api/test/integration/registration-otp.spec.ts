/**
 * Registration OTP refuses an address that is already in use before a code is
 * sent — the applicant should not have to finish step 1 to learn that.
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
import { ValidationError } from '../../src/shared/errors/domain-errors';
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
  await makeUser(
    orgId,
    { email: KNOWN_EMAIL, full_name: 'Ishaan Malhotra' },
    raw,
  );
  await raw.$executeRaw`
    UPDATE identity.user_account SET mobile = ${KNOWN_MOBILE} WHERE email = ${KNOWN_EMAIL}`;
});

function inRequest<T>(fn: () => Promise<T>, ip = '203.0.113.10'): Promise<T> {
  return ctx.run({ requestId: 'test', ip, userAgent: 'jest' }, fn);
}

const thrown = async (fn: () => Promise<unknown>): Promise<ValidationError> => {
  try {
    await fn();
    throw new Error('Expected refusal');
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return error;
  }
};

describe('registration OTP availability', () => {
  it('refuses a work email that is already registered before sending a code', async () => {
    const error = await inRequest(() =>
      thrown(() =>
        controller.sendRegistrationOtp({ channel: 'EMAIL', value: KNOWN_EMAIL }),
      ),
    );

    expect(error.message).toMatch(/already registered/i);
    expect(error.fields?.value).toMatch(/already registered/i);
    expect(outbox.all()).toHaveLength(0);
  });

  it('refuses a mobile that is already registered before sending a code', async () => {
    const error = await inRequest(() =>
      thrown(() =>
        controller.sendRegistrationOtp({ channel: 'MOBILE', value: KNOWN_MOBILE }),
      ),
    );

    expect(error.message).toMatch(/already registered/i);
    expect(error.fields?.value).toMatch(/already registered/i);
    expect(outbox.all()).toHaveLength(0);
  });

  it('sends a code to an address nobody has registered yet', async () => {
    const reply = await inRequest(() =>
      controller.sendRegistrationOtp({
        channel: 'EMAIL',
        value: 'new.applicant@harbourpoint.example',
      }),
    );

    expect(reply.sentTo).toMatch(/new\./);
    expect(outbox.all().length).toBeGreaterThan(0);
  });
});
