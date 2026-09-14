import { OtpService } from '../../src/modules/identity/internal/otp.service';
import { loadEnv } from '../../src/shared/config/env';
import { FixedClock } from '../../src/shared/clock';
import type { PrismaService } from '../../src/shared/db/prisma.service';
import type { RateLimiter } from '../../src/shared/redis/redis.service';
import type { NotificationPort } from '../../src/shared/adapters/ports';

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as NodeJS.ProcessEnv;
const db = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('OTP_DEV_CODE_IN_RESPONSE is an explicit switch, never implied by NODE_ENV', () => {
  it('is off on NODE_ENV=development when unset — the configuration that leaked live codes', () => {
    expect(loadEnv(env({ ...db, NODE_ENV: 'development' })).OTP_DEV_CODE_IN_RESPONSE).toBe(false);
  });

  it('turns on only when set', () => {
    expect(
      loadEnv(
        env({
          ...db,
          NODE_ENV: 'production',
          PII_ENCRYPTION_KEY: 'k',
          JWT_PRIVATE_KEY: 'x',
          JWT_PUBLIC_KEY: 'y',
          OTP_DEV_CODE_IN_RESPONSE: 'true',
        }),
      ).OTP_DEV_CODE_IN_RESPONSE,
    ).toBe(true);
  });
});

describe('OtpService.issue returns the code only when told to expose it', () => {
  const prisma = {
    db: {
      otp_request: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
    },
  } as unknown as PrismaService;
  const limiter = { consume: jest.fn().mockResolvedValue(1) } as unknown as RateLimiter;
  const notifications = {
    send: jest.fn().mockResolvedValue({ providerMessageId: 'm', accepted: true }),
  } as unknown as NotificationPort;
  const service = new OtpService(
    prisma,
    new FixedClock(new Date('2026-09-14T00:00:00Z')),
    limiter,
    notifications,
  );

  const issue = (exposeDevCode: boolean, deliver?: boolean) =>
    service.issue({
      target: 'owner@example.com',
      purpose: 'PASSWORD_RESET',
      channel: 'EMAIL',
      templateCode: 'AUTH_PASSWORD_RESET',
      exposeDevCode,
      ...(deliver === undefined ? {} : { deliver }),
    });

  it('withholds the code when the switch is off', async () => {
    expect((await issue(false)).devCode).toBeUndefined();
  });

  it('returns the code when the switch is on', async () => {
    expect((await issue(true)).devCode).toMatch(/^[0-9]{6}$/);
  });

  it('withholds the code when nothing was delivered, even with the switch on', async () => {
    expect((await issue(true, false)).devCode).toBeUndefined();
  });
});
