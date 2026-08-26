import { Global, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { AppConfig, ConfigModule } from '../config';
import { ClockModule, ClockPort } from '../clock';
import { RateLimitedError } from '../errors/domain-errors';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(config.get('REDIS_URL'), {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.client.on('error', (e) => this.logger.error(`Redis: ${e.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }
}

/**
 * Distributed lock.
 *
 * Read the comment in 02_ARCHITECTURE.md §4.1 before relying on this: **the lock
 * is an optimisation, not the correctness mechanism.** The real guarantee that
 * stock cannot be oversold is the database CHECK
 * `qty_available + qty_reserved + qty_awaiting_qc + qty_qc_failed <= qty_total`.
 * The lock exists to stop two checkouts wasting work on the same rows, and
 * ORD-018 is the test that force-expires it mid-transaction and proves the
 * constraint still holds.
 *
 * Release is a compare-and-delete via Lua so a slow holder whose TTL expired
 * cannot delete the lock a second holder now owns.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

@Injectable()
export class LockService {
  private readonly logger = new Logger(LockService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Acquire several locks in one go, **always in sorted key order**.
   *
   * The ordering is not tidiness. A multi-supply-point cart that locks in cart
   * order will deadlock under concurrency — intermittently, in production, at
   * volume. Sorting here means callers cannot get it wrong, and ORD-014 proves
   * the reverse order deadlocks.
   */
  async withLocks<T>(
    keys: readonly string[],
    fn: () => Promise<T>,
    opts: { ttlMs?: number; waitMs?: number } = {},
  ): Promise<T> {
    const ttl = opts.ttlMs ?? 10_000;
    const deadline = Date.now() + (opts.waitMs ?? 5_000);
    const sorted = [...new Set(keys)].sort();
    const held: Array<{ key: string; token: string }> = [];

    try {
      for (const key of sorted) {
        const token = randomUUID();
        let acquired = false;
        for (;;) {
          const ok = await this.redis.client.set(key, token, 'PX', ttl, 'NX');
          if (ok === 'OK') {
            acquired = true;
            break;
          }
          if (Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 25 + Math.floor(Math.random() * 50)));
        }
        if (!acquired) {
          throw new RateLimitedError(
            2,
            'That stock is being checked out by someone else right now. Try again in a moment.',
          );
        }
        held.push({ key, token });
      }
      return await fn();
    } finally {
      // Release in reverse, best-effort. A failed release is survivable — the TTL
      // reclaims it — so it must never mask the original error.
      for (const { key, token } of held.reverse()) {
        try {
          await this.redis.client.eval(RELEASE_SCRIPT, 1, key, token);
        } catch (e) {
          this.logger.warn(`Lock release failed for ${key}: ${(e as Error).message}`);
        }
      }
    }
  }

  withLock<T>(key: string, fn: () => Promise<T>, opts?: { ttlMs?: number; waitMs?: number }): Promise<T> {
    return this.withLocks([key], fn, opts);
  }
}

/**
 * Sliding-window rate limiting, per whatever key the caller chooses — IP, user,
 * org, or a hash of a GSTIN. Tighter buckets on OTP, verification, search and
 * login are configured at the call site rather than centrally, because the
 * sensible limit for "resend an OTP" and "search the catalog" have nothing in
 * common.
 */
export interface RateLimitRule {
  /** Stable name, used in the Redis key and in the audit trail. */
  name: string;
  limit: number;
  windowSeconds: number;
}

@Injectable()
export class RateLimiter {
  constructor(
    private readonly redis: RedisService,
    private readonly clock: ClockPort,
  ) {}

  /** Returns remaining allowance. Throws `RateLimitedError` when exhausted. */
  async consume(rule: RateLimitRule, subject: string, cost = 1): Promise<number> {
    const key = `rl:${rule.name}:${subject}`;
    const results = await this.redis.client
      .multi()
      .incrby(key, cost)
      .ttl(key)
      .exec();

    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[1]?.[1] ?? -1);
    if (ttl < 0) await this.redis.client.expire(key, rule.windowSeconds);

    if (count > rule.limit) {
      const retryAfter = ttl > 0 ? ttl : rule.windowSeconds;
      throw new RateLimitedError(
        retryAfter,
        // A fixed-duration message, not a live countdown: VR-060, and a ticking
        // clock on a login screen is a dark pattern the CCPA guidelines name.
        `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute${retryAfter > 60 ? 's' : ''}.`,
      );
    }
    return rule.limit - count;
  }

  /** Read the current count without consuming. For showing "2 attempts left". */
  async peek(rule: RateLimitRule, subject: string): Promise<number> {
    const count = Number((await this.redis.client.get(`rl:${rule.name}:${subject}`)) ?? 0);
    return Math.max(0, rule.limit - count);
  }

  async reset(rule: RateLimitRule, subject: string): Promise<void> {
    await this.redis.client.del(`rl:${rule.name}:${subject}`);
  }

  /** Idempotency: remember a request key so a retried POST does not act twice. */
  async claimIdempotencyKey(key: string, ttlSeconds = 86_400): Promise<boolean> {
    const ok = await this.redis.client.set(
      `idem:${key}`,
      this.clock.nowIso(),
      'EX',
      ttlSeconds,
      'NX',
    );
    return ok === 'OK';
  }
}

@Global()
@Module({
  imports: [ConfigModule, ClockModule],
  providers: [RedisService, LockService, RateLimiter],
  exports: [RedisService, LockService, RateLimiter],
})
export class RedisModule {}
