import { Global, Injectable, Module } from '@nestjs/common';
import { TIMEZONE } from '@trugrade/contracts';

/**
 * The clock is injected, never read from the global.
 *
 * 04_TEST_PLAN.md §1.4.1: no test may call `Date.now()` directly, because the
 * rules that most need testing are the time-dependent ones — 90-day QC expiry,
 * the 2-day grade auto-apply, the 36-hour NDR window, the 48-hour inspection
 * window, OTP TTL, token rotation. A test that has to sleep is a test nobody runs.
 *
 * `no-restricted-syntax` in the shared ESLint config makes `Date.now()` a lint
 * error, so this is enforced rather than encouraged.
 */
export abstract class ClockPort {
  abstract now(): Date;

  nowMs(): number {
    return this.now().getTime();
  }

  /** ISO-8601 in UTC — the only form that goes into the database or an event. */
  nowIso(): string {
    return this.now().toISOString();
  }

  plusSeconds(seconds: number): Date {
    return new Date(this.nowMs() + seconds * 1000);
  }

  plusDays(days: number): Date {
    return new Date(this.nowMs() + days * 86_400_000);
  }

  /**
   * VR-160: storage is UTC, but every business window — cut-offs, working days,
   * "the inspection window closed on the 20th" — is reckoned in Asia/Kolkata.
   * A naive local-time comparison in business logic is a defect.
   */
  todayInIst(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(this.now());
  }
}

@Injectable()
export class SystemClock extends ClockPort {
  now(): Date {
    // The single sanctioned call site in the codebase.
    // eslint-disable-next-line no-restricted-syntax -- this is the implementation of the clock
    return new Date(Date.now());
  }
}

/** Test double. `advanceTo` / `advanceBy` replace every `sleep` in the suite. */
export class FixedClock extends ClockPort {
  constructor(private current: Date) {
    super();
  }
  now(): Date {
    return new Date(this.current);
  }
  advanceTo(when: Date | string): void {
    this.current = typeof when === 'string' ? new Date(when) : new Date(when);
  }
  advanceBy(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  advanceDays(days: number): void {
    this.advanceBy(days * 86_400_000);
  }
}

@Global()
@Module({ providers: [{ provide: ClockPort, useClass: SystemClock }], exports: [ClockPort] })
export class ClockModule {}
