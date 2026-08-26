/**
 * The two controls that stop this being a data breach:
 *
 *   1. **Org scope at the repository layer** (IDN-050…IDN-079). A missing `where`
 *      clause in a service must not be able to leak another org's rows. So the
 *      test below writes a service that *deliberately forgets* the filter and
 *      asserts the scope catches it anyway.
 *
 *   2. **Refresh-token rotation with reuse detection** (VR-059). A second use of
 *      an already-rotated token has no benign explanation, so it kills the whole
 *      family — logging the attacker out along with the victim, which is the
 *      correct trade.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { permissionsFor, type Permission, type Role } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { ContextModule, OrgScope, RequestContextService, type Principal } from '../../src/shared/db/org-scope';
import { RedisService, LockService, RateLimiter } from '../../src/shared/redis/redis.service';
import { TokenService } from '../../src/shared/auth/token.service';
import { ForbiddenError, RateLimitedError, UnauthenticatedError } from '../../src/shared/errors/domain-errors';

let moduleRef: TestingModule;
let scope: OrgScope;
let ctx: RequestContextService;
let tokens: TokenService;
let redis: RedisService;
let limiter: RateLimiter;
let locks: LockService;
let clock: FixedClock;

const VENDOR_A = '11111111-0000-4000-8000-00000000000a';
const VENDOR_B = '11111111-0000-4000-8000-00000000000b';

function principal(overrides: Partial<Principal> = {}): Principal {
  const roles: Role[] = overrides.roles ? [...overrides.roles] : ['VENDOR_OWNER'];
  return {
    userId: '99999999-0000-4000-8000-000000000001',
    orgId: VENDOR_A,
    orgType: 'VENDOR',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 'sess-1',
    ...overrides,
  };
}

/** Run `fn` as this principal, exactly as the AuthGuard would establish it. */
function as<T>(p: Principal | undefined, fn: () => T): T {
  return ctx.run({ requestId: 'test' }, () => {
    if (p) ctx.setPrincipal(p);
    return fn();
  });
}

beforeAll(async () => {
  clock = new FixedClock(new Date('2026-08-26T06:00:00.000Z'));
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: clock },
      RedisService,
      LockService,
      RateLimiter,
      TokenService,
    ],
  }).compile();
  await moduleRef.init();

  scope = moduleRef.get(OrgScope);
  ctx = moduleRef.get(RequestContextService);
  tokens = moduleRef.get(TokenService);
  redis = moduleRef.get(RedisService);
  limiter = moduleRef.get(RateLimiter);
  locks = moduleRef.get(LockService);
  expect(moduleRef.get(AppConfig)).toBeDefined();
});

afterAll(async () => {
  await moduleRef.close();
});

beforeEach(async () => {
  await redis.client.flushdb();
});

// ---------------------------------------------------------------------------

describe('IDN-050…IDN-079 — org scope at the repository layer', () => {
  it('pins a vendor query to their own org even when the service forgot to', () => {
    // This is the bug the control exists for: a service that filters on status
    // and nothing else.
    const serviceWhere = { status: 'ACTIVE' };
    const scoped = as(principal(), () => scope.scoped(serviceWhere, 'vendor_org_id'));

    expect(scoped).toEqual({ status: 'ACTIVE', vendor_org_id: VENDOR_A });
  });

  it('refuses an explicit request for another org rather than quietly overriding it', () => {
    expect(() =>
      as(principal(), () => scope.scoped({ vendor_org_id: VENDOR_B }, 'vendor_org_id')),
    ).toThrow(ForbiddenError);
  });

  it('lets a vendor ask for their own org id explicitly', () => {
    const scoped = as(principal(), () => scope.scoped({ vendor_org_id: VENDOR_A }, 'vendor_org_id'));
    expect(scoped).toEqual({ vendor_org_id: VENDOR_A });
  });

  it('platform staff read across orgs, because that is their job', () => {
    const ops = principal({ orgId: null, orgType: 'PLATFORM', roles: ['OPS_MANAGER'] });
    const scoped = as(ops, () => scope.scoped({ status: 'ACTIVE' }, 'vendor_org_id'));
    expect(scoped).toEqual({ status: 'ACTIVE' });
  });

  it('refuses a scoped read with no caller at all — that is a programming error, not an access decision', () => {
    expect(() => as(undefined, () => scope.scoped({}, 'vendor_org_id'))).toThrow(ForbiddenError);
  });

  it('assertOwns rejects a row fetched by id that belongs to someone else', () => {
    expect(() => as(principal(), () => scope.assertOwns(VENDOR_B, 'listing'))).toThrow(ForbiddenError);
    expect(() => as(principal(), () => scope.assertOwns(VENDOR_A, 'listing'))).not.toThrow();
  });

  it('assertOwns rejects a null owner rather than treating it as public', () => {
    expect(() => as(principal(), () => scope.assertOwns(null))).toThrow(ForbiddenError);
  });

  it('a buyer is scoped by buyer_org_id on their own tables', () => {
    const buyer = principal({ orgType: 'BUYER', roles: ['CUSTOMER_BUYER'], orgId: VENDOR_B });
    const scoped = as(buyer, () => scope.scoped({ status: 'CONFIRMED' }, 'buyer_org_id'));
    expect(scoped).toEqual({ status: 'CONFIRMED', buyer_org_id: VENDOR_B });
  });
});

describe('the role x permission matrix', () => {
  it('a vendor role holds no *.any.* permission — the cross-org read simply does not exist for them', () => {
    for (const role of ['VENDOR_OWNER', 'VENDOR_ADMIN', 'VENDOR_OPS', 'VENDOR_FINANCE', 'VENDOR_VIEWER'] as Role[]) {
      const perms = [...permissionsFor([role])];
      expect(perms.filter((p) => p.includes('.any.'))).toEqual([]);
    }
  });

  it('a customer role can never read another org, nor touch procurement', () => {
    for (const role of ['CUSTOMER_OWNER', 'CUSTOMER_BUYER', 'CUSTOMER_APPROVER'] as Role[]) {
      const perms = [...permissionsFor([role])];
      expect(perms.filter((p) => p.includes('.any.'))).toEqual([]);
      expect(perms.filter((p) => p.startsWith('procurement.'))).toEqual([]);
    }
  });

  it('the auditor role is read-only everywhere, including the audit log', () => {
    const perms = [...permissionsFor(['AUDITOR'])] as Permission[];
    const writes = perms.filter((p) => /\.(write|issue|post|approve|run|execute|assign|action|plan|handle|acknowledge|upload|ingest|recheck|triage|resolve|override|create|respond|schedule)$/.test(p));
    expect(writes).toEqual([]);
  });

  it('only FINANCE and the superadmin can post to the ledger', () => {
    const canPost = (['FINANCE', 'PLATFORM_SUPERADMIN', 'OPS_MANAGER', 'SUPPORT', 'VENDOR_OWNER'] as Role[]).filter(
      (r) => permissionsFor([r]).has('payment.ledger.post'),
    );
    expect(canPost.sort()).toEqual(['FINANCE', 'PLATFORM_SUPERADMIN']);
  });

  it('only FINANCE and the superadmin can run a payout', () => {
    const canRun = (['FINANCE', 'PLATFORM_SUPERADMIN', 'OPS_MANAGER', 'VENDOR_FINANCE'] as Role[]).filter((r) =>
      permissionsFor([r]).has('procurement.payout.run'),
    );
    expect(canRun.sort()).toEqual(['FINANCE', 'PLATFORM_SUPERADMIN']);
  });
});

// ---------------------------------------------------------------------------

describe('VR-058 / VR-059 — tokens', () => {
  const issueFor = () =>
    tokens.issue({
      userId: '99999999-0000-4000-8000-000000000001',
      orgId: VENDOR_A,
      orgType: 'VENDOR',
      roles: ['VENDOR_OWNER'],
      permissions: [...permissionsFor(['VENDOR_OWNER'])],
      mfa: true,
    });

  it('issues an access token carrying the flattened permission set, so a guard never hits the database', async () => {
    const issued = await issueFor();
    const claims = await tokens.verifyAccess(issued.accessToken);

    expect(claims.sub).toBe('99999999-0000-4000-8000-000000000001');
    expect(claims.org_id).toBe(VENDOR_A);
    expect(claims.roles).toEqual(['VENDOR_OWNER']);
    expect(claims.scope).toContain('listing.own.write');
    expect(claims.scope).not.toContain('listing.any.write');
    expect(claims.mfa).toBe(true);
  });

  it('rejects a tampered token', async () => {
    const issued = await issueFor();
    const [h, p, s] = issued.accessToken.split('.');
    const forged = `${h}.${Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), org_id: VENDOR_B }),
    ).toString('base64url')}.${s}`;

    await expect(tokens.verifyAccess(forged)).rejects.toThrow(UnauthenticatedError);
  });

  it('a revoked session invalidates a token that has not expired — that is why the session exists', async () => {
    const issued = await issueFor();
    await expect(tokens.verifyAccess(issued.accessToken)).resolves.toBeTruthy();

    await tokens.revokeSession(issued.sessionId);
    await expect(tokens.verifyAccess(issued.accessToken)).rejects.toThrow(/session has ended/i);
  });

  it('rotation issues a new refresh token and retires the old one', async () => {
    const first = await issueFor();
    const second = await tokens.rotate(first.refreshToken, async () => ({
      orgType: 'VENDOR',
      roles: ['VENDOR_OWNER'],
      permissions: [...permissionsFor(['VENDOR_OWNER'])],
    }));

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.sessionId).toBe(first.sessionId); // rotation, not a new login
  });

  it('VR-059 — reusing a rotated refresh token revokes the entire family', async () => {
    const first = await issueFor();
    const second = await tokens.rotate(first.refreshToken, async () => ({
      orgType: 'VENDOR',
      roles: ['VENDOR_OWNER'],
      permissions: [...permissionsFor(['VENDOR_OWNER'])],
    }));

    // The attacker replays the token we already retired.
    await expect(
      tokens.rotate(first.refreshToken, async () => ({
        orgType: 'VENDOR',
        roles: ['VENDOR_OWNER'],
        permissions: [],
      })),
    ).rejects.toThrow(UnauthenticatedError);

    // And the legitimate holder is signed out too. That is deliberate: we cannot
    // tell which of the two is the thief, so neither keeps the session.
    await expect(
      tokens.rotate(second.refreshToken, async () => ({
        orgType: 'VENDOR',
        roles: ['VENDOR_OWNER'],
        permissions: [],
      })),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(tokens.verifyAccess(second.accessToken)).rejects.toThrow(UnauthenticatedError);
  });

  it('revoking a user signs out every one of their sessions', async () => {
    const a = await issueFor();
    const b = await issueFor();
    const revoked = await tokens.revokeAllForUser('99999999-0000-4000-8000-000000000001');

    expect(revoked).toBeGreaterThanOrEqual(2);
    await expect(tokens.verifyAccess(a.accessToken)).rejects.toThrow();
    await expect(tokens.verifyAccess(b.accessToken)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('VR-060 — rate limiting', () => {
  const rule = { name: 'test-otp', limit: 3, windowSeconds: 60 };

  it('allows up to the limit, then refuses with a fixed-duration message', async () => {
    expect(await limiter.consume(rule, 'user-1')).toBe(2);
    expect(await limiter.consume(rule, 'user-1')).toBe(1);
    expect(await limiter.consume(rule, 'user-1')).toBe(0);
    await expect(limiter.consume(rule, 'user-1')).rejects.toThrow(RateLimitedError);
  });

  it('counts per subject, so one abusive caller does not lock out everyone', async () => {
    await limiter.consume(rule, 'user-1');
    await limiter.consume(rule, 'user-1');
    await limiter.consume(rule, 'user-1');
    await expect(limiter.consume(rule, 'user-1')).rejects.toThrow();
    await expect(limiter.consume(rule, 'user-2')).resolves.toBe(2);
  });

  it('the message names a duration, never a live countdown (a countdown is a dark pattern)', async () => {
    for (let i = 0; i < rule.limit; i++) await limiter.consume(rule, 'user-3');
    await expect(limiter.consume(rule, 'user-3')).rejects.toThrow(/Try again in \d+ minutes?\./);
  });

  it('an idempotency key can be claimed exactly once', async () => {
    expect(await limiter.claimIdempotencyKey('order-abc')).toBe(true);
    expect(await limiter.claimIdempotencyKey('order-abc')).toBe(false);
  });
});

describe('locks are an optimisation, and they sort their keys', () => {
  it('acquires several locks and releases them all', async () => {
    let ran = false;
    await locks.withLocks(['listing:b', 'listing:a'], async () => {
      // Sorted acquisition is what stops a multi-supply-point cart deadlocking.
      expect(await redis.client.exists('listing:a')).toBe(1);
      expect(await redis.client.exists('listing:b')).toBe(1);
      ran = true;
    });
    expect(ran).toBe(true);
    expect(await redis.client.exists('listing:a')).toBe(0);
    expect(await redis.client.exists('listing:b')).toBe(0);
  });

  it('releases the locks even when the body throws', async () => {
    await expect(
      locks.withLock('listing:x', async () => {
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    expect(await redis.client.exists('listing:x')).toBe(0);
  });

  it('a second holder cannot steal a lock that is still held', async () => {
    await locks.withLock('listing:y', async () => {
      await expect(locks.withLock('listing:y', async () => undefined, { waitMs: 100 })).rejects.toThrow(
        RateLimitedError,
      );
    });
  });

  it('does not delete a lock it no longer owns after its TTL expired', async () => {
    // Hold with a very short TTL, let it lapse, let someone else take it, and
    // prove the first holder's release does not remove the second holder's lock.
    await locks.withLock(
      'listing:z',
      async () => {
        await new Promise((r) => setTimeout(r, 120));
        await redis.client.set('listing:z', 'someone-else');
      },
      { ttlMs: 50 },
    );
    expect(await redis.client.get('listing:z')).toBe('someone-else');
  });
});
