/**
 * A payout account change needs a fresh code from the person making it, whatever
 * their role. VENDOR_ADMIN is not in MFA_REQUIRED_ROLES, and before this a
 * password-only admin session could redirect where the money goes.
 */
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { RedisService, RateLimiter, LockService } from '../../src/shared/redis/redis.service';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { NotificationOutbox } from '../../src/shared/adapters/fakes/infra.fakes';
import { OtpService } from '../../src/modules/identity';
import { VerificationService } from '../../src/modules/kyc/internal/verification.service';
import { BankChangeService } from '../../src/modules/kyc/internal/bank-change.service';
import { changeBankAccountBodySchema } from '../../src/modules/kyc/kyc.controller';
import {
  closeTestDb,
  migrateTestDatabase,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization } from '../support/factories';

const NOW = new Date('2030-01-15T06:00:00.000Z');
const GOOD_ACCOUNT = '50100234567012';
const HOLDER = 'Alpha Systems Private Limited';

let moduleRef: TestingModule;
let bankChange: BankChangeService;
let outbox: NotificationOutbox;
let redis: RedisService;
let raw: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule, AdaptersModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(NOW) },
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
      OtpService,
      VerificationService,
      BankChangeService,
    ],
  }).compile();
  await moduleRef.init();
  bankChange = moduleRef.get(BankChangeService);
  outbox = moduleRef.get(NotificationOutbox);
  redis = moduleRef.get(RedisService);
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

let orgId: string;
let adminId: string;
let colleagueId: string;

async function makeMember(email: string, owner: boolean): Promise<string> {
  const [row] = await raw.$queryRaw<Array<{ id: string }>>`
    INSERT INTO identity.user_account (org_id, full_name, mobile, email, status, is_org_owner)
    VALUES (${orgId}::uuid, 'Member', ${owner ? '+919810011223' : null}::text, ${email}::citext, 'ACTIVE', ${owner})
    RETURNING id`;
  return row!.id;
}

beforeEach(async () => {
  await truncateAll(raw);
  await redis.client.flushdb();
  outbox.clear();
  await raw.$executeRaw`
    INSERT INTO platform.platform_config (key, value_json, description, effective_from)
    VALUES ('kyc.bank_change_freeze_hours', '24'::jsonb, 'Test fixture.', '2020-01-01T00:00:00Z'::timestamptz)
    ON CONFLICT (key, effective_from) DO NOTHING`;
  orgId = await makeOrganization({ legal_name: HOLDER }, raw);
  await makeMember('owner@alphasystems.in', true);
  adminId = await makeMember('admin@alphasystems.in', false);
  colleagueId = await makeMember('ops@alphasystems.in', false);
});

const change = (actorUserId: string, otpCode: string) =>
  bankChange.changeWithCode({
    orgId,
    actorUserId,
    otpCode,
    accountNumber: GOOD_ACCOUNT,
    ifsc: 'HDFC0001234',
    accountHolderName: HOLDER,
  });

const accounts = async (): Promise<number> =>
  Number(
    (await raw.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM kyc.bank_account`)[0]!.n,
  );

describe('changing a payout account asks the actor for a fresh code', () => {
  it('the HTTP body is refused without a code', () => {
    const parsed = changeBankAccountBodySchema.safeParse({
      accountNumber: GOOD_ACCOUNT,
      ifsc: 'HDFC0001234',
      accountHolderName: HOLDER,
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses a wrong code and writes no account', async () => {
    await bankChange.requestCode(orgId, adminId);
    await expect(change(adminId, '000000')).rejects.toThrow();
    expect(await accounts()).toBe(0);
  });

  it('refuses a code nobody was sent', async () => {
    await expect(change(adminId, '123456')).rejects.toThrow();
    expect(await accounts()).toBe(0);
  });

  it('refuses a code issued to a different member', async () => {
    const sent = await bankChange.requestCode(orgId, colleagueId);
    await expect(change(adminId, sent.devCode!)).rejects.toThrow();
    expect(await accounts()).toBe(0);
  });

  it('sends the code to the actor, and a VENDOR_ADMIN with it can change the account', async () => {
    const sent = await bankChange.requestCode(orgId, adminId);
    expect(outbox.last('KYC_BANK_CHANGE_OTP')?.to).toBe('admin@alphasystems.in');
    expect(sent.sentTo).not.toContain('admin@alphasystems.in');

    const result = await change(adminId, sent.devCode!);

    expect(result.verification.outcome).toBe('PASS');
    expect(result.accountId).not.toBeNull();
    expect(await accounts()).toBe(1);
  });

  it('spends the code, so it cannot confirm a second change', async () => {
    const sent = await bankChange.requestCode(orgId, adminId);
    await change(adminId, sent.devCode!);
    await expect(change(adminId, sent.devCode!)).rejects.toThrow();
  });
});
