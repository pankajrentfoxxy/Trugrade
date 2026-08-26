/**
 * Domain errors and the deterministic fakes.
 *
 * The assertions about error *messages* are not style checks. VR-META-03 forbids
 * stack detail, SQL, internal ids and vendor identity in anything a user sees,
 * and the KYC distinction between a provider being down and an applicant being
 * wrong is the single most common onboarding-UX failure in Indian KYC flows.
 */

import { loadEnv } from '../../src/shared/config/env';
import {
  DomainError,
  ForbiddenError,
  IllegalStateTransitionError,
  InsufficientStockError,
  NotFoundError,
  ProviderError,
  RateLimitedError,
  ValidationError,
} from '../../src/shared/errors/domain-errors';
import { nameSimilarity } from '../../src/shared/adapters/fakes/kyc.fakes';
import { FixedClock } from '../../src/shared/clock';

describe('errors carry two audiences and never mix them', () => {
  it('a NotFoundError names neither the entity id nor the table', () => {
    const e = new NotFoundError('order', { id: '8f3c1d2e-0000-4000-8000-000000000001' });
    expect(e.message).toBe("We couldn't find that order.");
    expect(e.message).not.toMatch(/8f3c/);
    // The id is still available to the log, just not to the response.
    expect(e.detail).toMatchObject({ id: expect.stringContaining('8f3c') });
  });

  it('a ForbiddenError never names the permission the caller lacked', () => {
    const e = new ForbiddenError(undefined, { missing: ['payment.ledger.post'] });
    expect(e.message).toBe("You don't have permission to do that.");
    expect(e.message).not.toContain('ledger');
  });

  it('InsufficientStock tells the buyer the number they can actually have', () => {
    const some = new InsufficientStockError(20, 12, 'Supply Point A');
    expect(some.message).toBe(
      'Only 12 of the 20 units you selected are still available at Supply Point A.',
    );

    const none = new InsufficientStockError(20, 0, 'Supply Point A');
    expect(none.message).toMatch(/just been taken/);
  });

  it('a PROVIDER_ERROR says "nothing for you to do" — it is our problem, not the applicant\'s', () => {
    const e = new ProviderError('gstn', { endpoint: '/search' });
    expect(e.code).toBe('PROVIDER_ERROR');
    expect(e.httpStatus).toBe(502);
    expect(e.message).toMatch(/nothing for you to do/i);
    expect(e.message).not.toContain('gstn');
    expect(e.message).not.toContain('/search');
  });

  it('a timeout is distinguishable from a generic provider failure', () => {
    expect(new ProviderError('gstn', {}, true).code).toBe('PROVIDER_TIMEOUT');
  });

  it('an illegal transition records from and to for the audit log', () => {
    const e = new IllegalStateTransitionError('order', 'DELIVERED', 'CONFIRMED');
    expect(e.message).toBe("That action isn't available from the current status.");
    expect(e.detail).toEqual({ entity: 'order', from: 'DELIVERED', to: 'CONFIRMED' });
  });

  it('a validation error carries field-level messages for a form', () => {
    const e = new ValidationError('Some of the details need fixing.', {
      gstin: 'This GSTIN fails its check-digit test. Please re-enter.',
    });
    expect(e.httpStatus).toBe(422);
    expect(e.fields?.gstin).toMatch(/check-digit/);
  });

  it('a rate-limit error carries a retry hint for the header', () => {
    const e = new RateLimitedError(900);
    expect(e.httpStatus).toBe(429);
    expect(e.detail).toEqual({ retryAfterSeconds: 900 });
  });

  it('every error message is safe to show a stranger', () => {
    const all: DomainError[] = [
      new NotFoundError('order'),
      new ForbiddenError(),
      new ValidationError('Some of the details need fixing.'),
      new InsufficientStockError(5, 2, 'Supply Point B'),
      new ProviderError('razorpay'),
      new IllegalStateTransitionError('unit', 'A', 'B'),
      new RateLimitedError(60),
    ];
    for (const e of all) {
      expect(e.message).not.toMatch(/\b(select|insert|update|delete)\b\s+\w+\./i);
      expect(e.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(e.message).not.toMatch(/\bat\s+\w+\.\w+\s*\(/);
      expect(e.message.length).toBeGreaterThan(10);
    }
  });
});

describe('VR-026 — penny-drop name matching', () => {
  it('scores an exact match at 1', () => {
    expect(nameSimilarity('Alpha Systems Pvt Ltd', 'Alpha Systems Pvt Ltd')).toBe(1);
  });

  it('ignores entity suffixes, which banks and registrars write differently', () => {
    expect(nameSimilarity('Alpha Systems Pvt Ltd', 'Alpha Systems Private Limited')).toBe(1);
  });

  it('lands a near-miss in the review band rather than passing or failing it outright', () => {
    const score = nameSimilarity('Alpha Systems Pvt Ltd', 'Alpha Systems Enterprises');
    expect(score).toBeGreaterThanOrEqual(0.7);
    expect(score).toBeLessThan(0.9);
  });

  it('fails an unrelated name', () => {
    expect(nameSimilarity('Alpha Systems Pvt Ltd', 'Unrelated Person')).toBeLessThan(0.7);
  });

  it('returns 0 rather than NaN on an empty input', () => {
    expect(nameSimilarity('', 'Alpha')).toBe(0);
  });
});

describe('the clock is injectable, so time-dependent rules are testable', () => {
  it('advances without sleeping', () => {
    const clock = new FixedClock(new Date('2026-08-26T00:00:00.000Z'));
    expect(clock.nowIso()).toBe('2026-08-26T00:00:00.000Z');

    clock.advanceDays(90);
    expect(clock.nowIso()).toBe('2026-11-24T00:00:00.000Z');
  });

  it('reckons the business day in Asia/Kolkata even though storage is UTC', () => {
    // 20:00 UTC is already the next day in IST (+5:30). A naive local-time
    // comparison here is how an inspection window closes a day early.
    const clock = new FixedClock(new Date('2026-08-26T20:00:00.000Z'));
    expect(clock.todayInIst()).toBe('2026-08-27');
  });
});

describe('environment validation', () => {
  const base = {
    DATABASE_URL: 'postgresql://x@localhost:5442/db',
    REDIS_URL: 'redis://localhost:6389',
  };

  it('accepts a valid development environment', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('refuses INTEGRATION_MODE=live outside production — CI must not book a real pickup', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'test', INTEGRATION_MODE: 'live' } as NodeJS.ProcessEnv),
    ).toThrow(/only permitted when NODE_ENV=production/);
  });

  it('requires a PII encryption key in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY: 'x',
        JWT_PUBLIC_KEY: 'y',
      } as NodeJS.ProcessEnv),
    ).toThrow(/PII_ENCRYPTION_KEY/);
  });

  it('requires the JWT keypair from a secret store in production, not a file in the image', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', PII_ENCRYPTION_KEY: 'k' } as NodeJS.ProcessEnv),
    ).toThrow(/Secrets Manager/);
  });

  it('reports every problem at once rather than one per restart', () => {
    try {
      loadEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('REDIS_URL');
      expect(msg).toContain('PII_ENCRYPTION_KEY');
    }
  });
});
