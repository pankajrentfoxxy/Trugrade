/**
 * Phase 1 exit criteria, end to end.
 *
 * The headline one: *a vendor completes all 7 steps, abandons at step 4, returns
 * two days later and resumes at step 4 with the form repopulated.* That single
 * journey exercises the stepper, the draft, the resume point and the clock all at
 * once, which is why it is the criterion rather than four separate assertions.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { EventBus } from '../../src/shared/events/event-bus';
import { ContextModule, RequestContextService } from '../../src/shared/db/org-scope';
import { RedisService, RateLimiter, LockService } from '../../src/shared/redis/redis.service';
import { TokenService } from '../../src/shared/auth/token.service';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import {
  BankVerificationPort,
  GstinVerificationPort,
  NotificationPort,
  PanVerificationPort,
} from '../../src/shared/adapters/ports';
import { NotificationOutbox } from '../../src/shared/adapters/fakes/infra.fakes';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { PasswordService } from '../../src/modules/identity/internal/password.service';
import { OtpService } from '../../src/modules/identity/internal/otp.service';
import { AuditService } from '../../src/modules/identity/internal/audit.service';
import { KycService } from '../../src/modules/kyc/kyc.service';
import { OnboardingService } from '../../src/modules/kyc/internal/onboarding.service';
import { VerificationService } from '../../src/modules/kyc/internal/verification.service';
import { ConsentService } from '../../src/modules/kyc/internal/consent.service';
import { gstinCheckDigit } from '@trugrade/contracts';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';

let moduleRef: TestingModule;
let identity: IdentityService;
let kyc: KycService;
let otp: OtpService;
let clock: FixedClock;
let raw: PrismaClient;
let redis: RedisService;
let ctx: RequestContextService;
let outbox: NotificationOutbox;

/**
 * The fake keys its outcome off the LAST TWO characters of the GSTIN — but the
 * last character is the mod-36 check digit, which is derived, not chosen. So a
 * fixture asking for "the outage case" has to search for a prefix whose check
 * digit happens to be the one it wants.
 *
 * Doing this properly rather than hard-coding a string matters: a GSTIN with a
 * bad check digit is rejected locally and never reaches the provider at all,
 * which is itself one of the behaviours under test.
 */
function gstinWhoseCheckDigitIs(target: string): string {
  for (let n = 0; n < 10_000; n++) {
    const body = `06AAFCT${String(n).padStart(4, '0')}A1Z`;
    const check = gstinCheckDigit(body);
    if (check === target) return body + check;
  }
  throw new Error(`No GSTIN prefix found whose check digit is "${target}"`);
}

/** ACTIVE, name matches. */
const VENDOR_GSTIN = gstinWhoseCheckDigitIs('5');

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);
  clock = new FixedClock(new Date('2026-08-26T06:00:00.000Z'));

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
      IdentityService,
      OnboardingService,
      VerificationService,
      ConsentService,
      KycService,
      // Approving a vendor now publishes vendor.verified, so the module that
      // owns the outbox has to be here too.
      EventBus,
    ],
  }).compile();

  await moduleRef.init();
  identity = moduleRef.get(IdentityService);
  kyc = moduleRef.get(KycService);
  otp = moduleRef.get(OtpService);
  redis = moduleRef.get(RedisService);
  ctx = moduleRef.get(RequestContextService);
  outbox = moduleRef.get(NotificationOutbox);

  expect(moduleRef.get(GstinVerificationPort)).toBeDefined();
  expect(moduleRef.get(PanVerificationPort)).toBeDefined();
  expect(moduleRef.get(BankVerificationPort)).toBeDefined();
  expect(moduleRef.get(NotificationPort)).toBeDefined();
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  await redis.client.flushdb();
  outbox.clear();
  // The clock is shared across this file and several tests advance it by days.
  // Without this reset, a later test reads a clock a previous one moved — which
  // is exactly how the account-lockout test started passing its own assertions
  // and then failing on a lock that had already "expired".
  clock.advanceTo(new Date('2026-08-26T06:00:00.000Z'));
});

/** Run inside a request context, as the guard would establish it. */
function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return ctx.run({ requestId: 'test', ip: '203.0.113.10', userAgent: 'jest' }, fn);
}

async function registerVendor(over: { email?: string; mobile?: string } = {}) {
  const email = over.email ?? 'priya@alphasystems.in';
  const mobile = over.mobile ?? '+919876543210';

  const lead = await inRequest(() =>
    kyc.createLead({
      intendedOrgType: 'VENDOR',
      companyName: 'Alpha Systems',
      contactName: 'Priya Sharma',
      mobile,
      email,
      city: 'Gurugram',
      source: 'GOOGLE_ADS',
    }),
  );

  const issued = await otp.issue({
    target: mobile,
    purpose: 'REGISTRATION',
    channel: 'SMS',
    templateCode: 'OTP_REGISTER',
    isProduction: false,
    refType: 'registration_lead',
    refId: lead.leadId,
  });
  await otp.verify({ target: mobile, purpose: 'REGISTRATION', code: issued.devCode! });

  const created = await inRequest(() =>
    identity.createOrganizationWithOwner({
      orgType: 'VENDOR',
      legalName: 'Alpha Systems Pvt Ltd',
      fullName: 'Priya Sharma',
      email,
      mobile,
      password: 'Str0ng!Vendor#26',
      leadId: lead.leadId,
    }),
  );

  await kyc.startOnboarding(created.orgId);
  return { ...created, leadId: lead.leadId, email, mobile };
}

// ---------------------------------------------------------------------------

describe('the lead is captured before the organisation exists', () => {
  it('records the attempt, so abandonment has a denominator', async () => {
    const lead = await inRequest(() =>
      kyc.createLead({
        intendedOrgType: 'VENDOR',
        companyName: 'Beta Infotech',
        contactName: 'Rakesh Kumar',
        mobile: '9812345678',
        source: 'WHATSAPP',
        utm: { source: 'google', campaign: 'vendor-q3' },
      }),
    );

    const row = await raw.registration_lead.findUniqueOrThrow({ where: { id: lead.leadId } });
    expect(row.status).toBe('NEW');
    expect(row.mobile).toBe('+919812345678'); // normalised on the way in
    expect(row.utm_campaign).toBe('vendor-q3');
    expect(row.converted_org_id).toBeNull();
  });

  it('marks the lead CONVERTED once the organisation is created', async () => {
    const { leadId, orgId } = await registerVendor();
    const row = await raw.registration_lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(row.status).toBe('CONVERTED');
    expect(row.converted_org_id).toBe(orgId);
  });

  it('records where an abandoner stopped', async () => {
    const lead = await inRequest(() =>
      kyc.createLead({
        intendedOrgType: 'VENDOR',
        companyName: 'Gone Away Traders',
        contactName: 'Someone',
        mobile: '9800000001',
      }),
    );
    await kyc.markLeadStatus(lead.leadId, 'ABANDONED', 'CAPABILITY');

    const row = await raw.registration_lead.findUniqueOrThrow({ where: { id: lead.leadId } });
    expect(row.abandoned_at_step).toBe('CAPABILITY');
  });
});

// ---------------------------------------------------------------------------

describe('the stepper is data, not two hard-coded flows', () => {
  it('a vendor gets 7 steps, in order', async () => {
    const { orgId } = await registerVendor();
    const { progress } = await kyc.getOnboarding(orgId);

    expect(progress.steps).toHaveLength(7);
    expect(progress.steps.map((s) => s.stepCode)).toEqual([
      'ACCOUNT',
      'BUSINESS_PROFILE',
      'STATUTORY',
      'CAPABILITY',
      'FACILITY_CONTACTS',
      'DOCUMENTS_BANK',
      'AGREEMENT',
    ]);
    expect(progress.requiredSteps).toBe(7);
    expect(progress.resumeAt).toBe('ACCOUNT');
  });

  it('a buyer gets 5 steps from the same engine', async () => {
    const { orgId } = await inRequest(() =>
      identity.createOrganizationWithOwner({
        orgType: 'BUYER',
        legalName: 'Nimbus Solutions Pvt Ltd',
        fullName: 'Arjun Mehta',
        email: 'arjun@nimbus.in',
        mobile: '9811111111',
        password: 'Str0ng!Buyer#26',
      }),
    );
    await kyc.startOnboarding(orgId);

    const { progress } = await kyc.getOnboarding(orgId);
    expect(progress.steps).toHaveLength(5);
    expect(progress.steps.map((s) => s.stepCode)).toEqual([
      'ACCOUNT',
      'BUSINESS_PROFILE',
      'STATUTORY',
      'CONTACTS_ADDRESSES',
      'DOCUMENTS',
    ]);
  });

  it('each step carries the right-rail copy explaining why we are asking', async () => {
    const { orgId } = await registerVendor();
    const { progress } = await kyc.getOnboarding(orgId);

    const facility = progress.steps.find((s) => s.stepCode === 'FACILITY_CONTACTS')!;
    expect(facility.purposeNote).toMatch(/Dispatch From.*e-way bill/);
    expect(facility.estimatedMinutes).toBeGreaterThan(0);
  });
});

describe('is_required derives from constitution — the derivation the source document asserts but never gives', () => {
  it("a proprietorship's STATUTORY step does not ask for a CIN at all", async () => {
    const { orgId } = await registerVendor();
    await raw.organization.update({
      where: { id: orgId },
      data: { constitution: 'PROPRIETORSHIP' },
    });

    const { progress } = await kyc.getOnboarding(orgId);
    const statutory = progress.steps.find((s) => s.stepCode === 'STATUTORY')!;
    const codes = statutory.fields.map((f) => f.fieldCode);

    // Not merely optional — absent. An optional field a person cannot possibly
    // have is a field they will try to fill in.
    expect(codes).not.toContain('cin');
    expect(codes).not.toContain('llpin');
    expect(codes).not.toContain('incorporation_date');
    expect(codes).toContain('udyam_number');
  });

  it("an LLP's does ask, and marks LLPIN required", async () => {
    const { orgId } = await registerVendor();
    await raw.organization.update({ where: { id: orgId }, data: { constitution: 'LLP' } });

    const { progress } = await kyc.getOnboarding(orgId);
    const statutory = progress.steps.find((s) => s.stepCode === 'STATUTORY')!;

    const llpin = statutory.fields.find((f) => f.fieldCode === 'llpin');
    expect(llpin?.required).toBe(true);
    expect(statutory.fields.find((f) => f.fieldCode === 'cin')).toBeUndefined();
  });

  it('a private limited company is asked for a CIN and a board resolution', async () => {
    const { orgId } = await registerVendor();
    await raw.organization.update({
      where: { id: orgId },
      data: { constitution: 'PVT_LTD' },
    });

    const { progress } = await kyc.getOnboarding(orgId);
    const statutory = progress.steps.find((s) => s.stepCode === 'STATUTORY')!;
    const docs = progress.steps.find((s) => s.stepCode === 'DOCUMENTS_BANK')!;

    expect(statutory.fields.find((f) => f.fieldCode === 'cin')?.required).toBe(true);
    expect(docs.fields.find((f) => f.fieldCode === 'board_resolution')?.required).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('THE EXIT CRITERION — 7 steps, abandon at 4, resume 2 days later', () => {
  it('repopulates the form and lands on the step they left', async () => {
    const { orgId, userId } = await registerVendor();

    // Steps 1 to 3.
    for (const step of ['ACCOUNT', 'BUSINESS_PROFILE', 'STATUTORY']) {
      await kyc.saveStepDraft(orgId, step, { done: true }, 100);
      await kyc.completeStep(orgId, step, async () => undefined);
    }

    // Step 4: they fill most of it in and walk away.
    const partial = {
      categories: ['LAPTOP'],
      brands: ['DELL', 'HP'],
      monthlyCapacity: 120,
      canDropship: true,
      // ...and stop before the lead time.
    };
    await kyc.saveStepDraft(orgId, 'CAPABILITY', partial, 60);

    let summary = await kyc.getOnboarding(orgId);
    expect(summary.progress.resumeAt).toBe('CAPABILITY');
    expect(summary.progress.completedSteps).toBe(3);

    // Two days pass.
    clock.advanceDays(2);

    // They come back. The draft is exactly as they left it.
    const restored = await kyc.getStepDraft(orgId, 'CAPABILITY');
    expect(restored).toEqual(partial);

    summary = await kyc.getOnboarding(orgId);
    expect(summary.progress.resumeAt).toBe('CAPABILITY');
    const step4 = summary.progress.steps.find((s) => s.stepCode === 'CAPABILITY')!;
    expect(step4.status).toBe('IN_PROGRESS');
    expect(step4.completionPct).toBe(60);

    // They finish, and go on to the end.
    await kyc.saveStepDraft(orgId, 'CAPABILITY', { ...partial, leadTimeHours: 24 }, 100);
    await kyc.completeStep(orgId, 'CAPABILITY', async () => undefined);

    for (const step of ['FACILITY_CONTACTS', 'DOCUMENTS_BANK', 'AGREEMENT']) {
      await kyc.saveStepDraft(orgId, step, { done: true }, 100);
      await kyc.completeStep(orgId, step, async () => undefined);
    }

    summary = await kyc.getOnboarding(orgId);
    expect(summary.progress.completedSteps).toBe(7);
    expect(summary.progress.isSubmittable).toBe(true);
    expect(summary.progress.resumeAt).toBeNull();

    const { slaDueAt } = await inRequest(() => kyc.submitForReview(orgId, userId));
    expect(slaDueAt.getTime()).toBeGreaterThan(clock.nowMs());
  });

  it('the draft is cleared on COMPLETE — we never keep a second copy of the answer', async () => {
    const { orgId } = await registerVendor();
    await kyc.saveStepDraft(orgId, 'ACCOUNT', { gstin: 'draft-value' }, 80);
    await kyc.completeStep(orgId, 'ACCOUNT', async () => undefined);

    expect(await kyc.getStepDraft(orgId, 'ACCOUNT')).toBeNull();
  });

  it('a failed promotion leaves the step incomplete and the draft intact', async () => {
    const { orgId } = await registerVendor();
    await kyc.saveStepDraft(orgId, 'STATUTORY', { gstin: VENDOR_GSTIN }, 100);

    await expect(
      kyc.completeStep(orgId, 'STATUTORY', async () => {
        throw new Error('GSTIN row rejected by the database');
      }),
    ).rejects.toThrow('GSTIN row rejected');

    // Which is what a person hitting Submit expects when something is wrong.
    const { progress } = await kyc.getOnboarding(orgId);
    expect(progress.steps.find((s) => s.stepCode === 'STATUTORY')!.status).not.toBe('COMPLETE');
    expect(await kyc.getStepDraft(orgId, 'STATUTORY')).toEqual({ gstin: VENDOR_GSTIN });
  });

  it('refuses to submit with steps outstanding, and names them', async () => {
    const { orgId, userId } = await registerVendor();
    await kyc.completeStep(orgId, 'ACCOUNT', async () => undefined);

    await expect(inRequest(() => kyc.submitForReview(orgId, userId))).rejects.toThrow(
      /Business, Statutory, Capability/,
    );
  });
});

// ---------------------------------------------------------------------------

describe("NEEDS_FIX shows the reviewer's reason verbatim", () => {
  it('sends the step back with the exact words the applicant reads', async () => {
    const { orgId } = await registerVendor();
    const reviewer = await makeReviewer();
    const reason = 'Address proof is dated Jan 2025. We need one from the last 3 months.';

    await completeAllSteps(orgId);
    await inRequest(() => kyc.requestFix(orgId, 'DOCUMENTS_BANK', reason, reviewer));

    const { progress } = await kyc.getOnboarding(orgId);
    const step = progress.steps.find((s) => s.stepCode === 'DOCUMENTS_BANK')!;

    expect(step.status).toBe('NEEDS_FIX');
    expect(step.blockingReason).toBe(reason);
    // And "resume" lands back on it, which is the whole point of the state.
    expect(progress.resumeAt).toBe('DOCUMENTS_BANK');
  });

  it('refuses a reason too vague to act on', async () => {
    const { orgId } = await registerVendor();
    const reviewer = await makeReviewer();

    await expect(
      inRequest(() => kyc.requestFix(orgId, 'DOCUMENTS_BANK', 'rejected', reviewer)),
    ).rejects.toThrow(/at least a sentence/);
  });

  it('answering clears the note, so the fix visibly registers', async () => {
    const { orgId } = await registerVendor();
    const reviewer = await makeReviewer();

    await kyc.completeStep(orgId, 'BUSINESS_PROFILE', async () => undefined);
    await inRequest(() =>
      kyc.requestFix(
        orgId,
        'BUSINESS_PROFILE',
        'The trade name does not match your GST certificate.',
        reviewer,
      ),
    );
    await kyc.saveStepDraft(orgId, 'BUSINESS_PROFILE', { tradeName: 'Alpha Systems' }, 100);

    const { progress } = await kyc.getOnboarding(orgId);
    expect(
      progress.steps.find((s) => s.stepCode === 'BUSINESS_PROFILE')!.blockingReason,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("KYC-041…KYC-048 — PROVIDER_ERROR is our problem, FAIL is the applicant's", () => {
  it('a provider outage says "nothing for you to do" and does NOT consume an attempt', async () => {
    const { orgId } = await registerVendor();
    // The fake returns a provider error for a GSTIN ending Z9.
    const outage = await inRequest(() => kyc.verifyGstin(gstinEndingIn('Z9'), { orgId }));

    expect(outage.outcome).toBe('PROVIDER_ERROR');
    expect(outage.willRetryAutomatically).toBe(true);
    expect(outage.message).toMatch(/nothing for you to do/i);
    // The distinction that matters: the budget is untouched.
    expect(outage.attemptsRemaining).toBe(5);
  });

  it('a genuine failure names what to check and DOES consume one', async () => {
    const { orgId } = await registerVendor();
    const fail = await inRequest(() => kyc.verifyGstin(gstinEndingIn('Z4'), { orgId }));

    expect(fail.outcome).toBe('FAIL');
    expect(fail.willRetryAutomatically).toBe(false);
    expect(fail.message).toMatch(/no record of this GSTIN/);
    expect(fail.attemptsRemaining).toBe(4);
  });

  it('a cancelled GSTIN fails with the reason, not a generic error', async () => {
    const { orgId } = await registerVendor();
    const cancelled = await inRequest(() => kyc.verifyGstin(gstinEndingIn('Z3'), { orgId }));
    expect(cancelled.message).toMatch(/cancelled on the GST portal/);
  });

  it("a name mismatch is MISMATCH — neither a pass nor the applicant's fault", async () => {
    const { orgId } = await registerVendor();
    const mismatch = await inRequest(() =>
      kyc.verifyGstin(
        gstinEndingIn('Z2'),
        { orgId },
        { expectedLegalName: 'Alpha Systems Pvt Ltd' },
      ),
    );
    expect(mismatch.outcome).toBe('MISMATCH');
    expect(mismatch.message).toMatch(/doesn't match the business name you entered/);
  });

  it('a passing check returns the resolved entity, so the tick means something', async () => {
    const { orgId } = await registerVendor();
    const pass = await inRequest(() =>
      kyc.verifyGstin(VENDOR_GSTIN, { orgId }, { expectedLegalName: 'Alpha Systems Pvt Ltd' }),
    );

    expect(pass.outcome).toBe('PASS');
    expect(pass.message).toMatch(/Active · Alpha Systems Pvt Ltd · Haryana \(06\)/);
  });

  it('a bad check digit never reaches the provider at all', async () => {
    const { orgId } = await registerVendor();
    const wrong = VENDOR_GSTIN.slice(0, 14) + (VENDOR_GSTIN[14] === 'Z' ? 'Y' : 'Z');

    await expect(inRequest(() => kyc.verifyGstin(wrong, { orgId }))).rejects.toThrow(/check-digit/);
    // No attempt spent on a value that cannot exist.
    const history = await kyc.verificationHistory({ orgId });
    expect(history).toHaveLength(0);
  });

  it('every attempt is recorded with a masked value, the provider, cost and latency', async () => {
    const { orgId } = await registerVendor();
    await inRequest(() => kyc.verifyGstin(VENDOR_GSTIN, { orgId }));

    const [entry] = await kyc.verificationHistory({ orgId });
    expect(entry!.maskedInput).not.toContain('AAFCT1234A');
    expect(entry!.maskedInput).toMatch(/^06AA\*+.{3}$/);
    expect(entry!.provider).toBe('fake');
    expect(entry!.latencyMs).toBeGreaterThan(0);
    expect(entry!.costPaise).toBeGreaterThan(0);
  });

  it('a lead can be verified before any organisation exists — the schema fix', async () => {
    const lead = await inRequest(() =>
      kyc.createLead({
        intendedOrgType: 'VENDOR',
        companyName: 'Pre-org Traders',
        contactName: 'Someone',
        mobile: '9800000009',
      }),
    );

    const result = await inRequest(() => kyc.verifyGstin(VENDOR_GSTIN, { leadId: lead.leadId }));
    expect(result.outcome).toBe('PASS');

    const history = await kyc.verificationHistory({ leadId: lead.leadId });
    expect(history).toHaveLength(1);
  });
});

describe('the retry policy the source document leaves open', () => {
  it('three attempts with three DIFFERENT values is a fraud signal, not a coincidence', async () => {
    const { orgId } = await registerVendor();

    await inRequest(() => kyc.verifyGstin(gstinEndingIn('Z4'), { orgId }));
    await inRequest(() => kyc.verifyGstin(anotherGstinEndingIn('Z4', 0), { orgId }));

    await expect(
      inRequest(() => kyc.verifyGstin(anotherGstinEndingIn('Z4', 1), { orgId })),
    ).rejects.toThrow(/several different values/);
  });

  it('a run of provider errors does not exhaust the budget', async () => {
    const { orgId } = await registerVendor();
    for (let i = 0; i < 6; i++) {
      const r = await inRequest(() => kyc.verifyGstin(gstinEndingIn('Z9'), { orgId }));
      expect(r.outcome).toBe('PROVIDER_ERROR');
    }
    // Still able to try for real.
    const real = await inRequest(() => kyc.verifyGstin(gstinEndingIn('Z9'), { orgId }));
    expect(real.attemptsRemaining).toBe(5);
  });
});

// ---------------------------------------------------------------------------

describe('OTP', () => {
  it('is delivered, verified once, and cannot be replayed', async () => {
    const target = '+919876500001';
    const issued = await otp.issue({
      target,
      purpose: 'LOGIN',
      channel: 'SMS',
      templateCode: 'OTP_LOGIN',
      isProduction: false,
    });

    expect(outbox.last('OTP_LOGIN')?.to).toBe(target);
    await expect(
      otp.verify({ target, purpose: 'LOGIN', code: issued.devCode! }),
    ).resolves.toBeTruthy();

    await expect(otp.verify({ target, purpose: 'LOGIN', code: issued.devCode! })).rejects.toThrow();
  });

  it('VR-055 — a LOGIN code cannot verify a BANK_CHANGE', async () => {
    const target = '+919876500002';
    const issued = await otp.issue({
      target,
      purpose: 'LOGIN',
      channel: 'SMS',
      templateCode: 'OTP_LOGIN',
      isProduction: false,
    });

    await expect(
      otp.verify({ target, purpose: 'BANK_CHANGE', code: issued.devCode! }),
    ).rejects.toThrow();
  });

  it('VR-052 — burns the code on the fifth wrong guess and says how many are left', async () => {
    const target = '+919876500003';
    await otp.issue({
      target,
      purpose: 'LOGIN',
      channel: 'SMS',
      templateCode: 'OTP_LOGIN',
      isProduction: false,
    });

    for (let i = 1; i <= 4; i++) {
      await expect(otp.verify({ target, purpose: 'LOGIN', code: '000000' })).rejects.toThrow(
        new RegExp(`${5 - i} attempt`),
      );
    }
    await expect(otp.verify({ target, purpose: 'LOGIN', code: '000000' })).rejects.toThrow(
      /Too many incorrect attempts/,
    );
  });

  it('VR-051 — expires, and the message tells you to resend', async () => {
    const target = '+919876500004';
    const issued = await otp.issue({
      target,
      purpose: 'LOGIN',
      channel: 'SMS',
      templateCode: 'OTP_LOGIN',
      isProduction: false,
    });

    clock.advanceBy(301_000);
    await expect(otp.verify({ target, purpose: 'LOGIN', code: issued.devCode! })).rejects.toThrow(
      /expired/,
    );
  });

  it('VR-053 — a second code inside the cooldown is refused', async () => {
    const target = '+919876500005';
    await otp.issue({
      target,
      purpose: 'LOGIN',
      channel: 'SMS',
      templateCode: 'OTP_LOGIN',
      isProduction: false,
    });
    await expect(
      otp.issue({
        target,
        purpose: 'LOGIN',
        channel: 'SMS',
        templateCode: 'OTP_LOGIN',
        isProduction: false,
      }),
    ).rejects.toThrow(/Too many attempts/);
  });

  it('issuing a new code supersedes the old one — two live codes double the guess surface', async () => {
    const target = '+919876500006';
    const first = await otp.issue({
      target,
      purpose: 'LOGIN',
      channel: 'SMS',
      templateCode: 'OTP_LOGIN',
      isProduction: false,
    });

    clock.advanceBy(61_000);
    await redis.client.flushdb(); // clear the cooldown the way 60s would
    const second = await otp.issue({
      target,
      purpose: 'LOGIN',
      channel: 'SMS',
      templateCode: 'OTP_LOGIN',
      isProduction: false,
    });

    await expect(otp.verify({ target, purpose: 'LOGIN', code: first.devCode! })).rejects.toThrow();
    await expect(
      otp.verify({ target, purpose: 'LOGIN', code: second.devCode! }),
    ).resolves.toBeTruthy();
  });

  it('the code is never stored in plaintext', async () => {
    const target = '+919876500007';
    const issued = await otp.issue({
      target,
      purpose: 'LOGIN',
      channel: 'SMS',
      templateCode: 'OTP_LOGIN',
      isProduction: false,
    });

    const row = await raw.otp_request.findFirstOrThrow({ where: { target } });
    expect(row.code_hash).not.toContain(issued.devCode!);
    expect(row.code_hash).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------

describe('login', () => {
  it('signs a verified vendor in', async () => {
    const { email } = await registerVendor();
    const result = await inRequest(() =>
      identity.loginWithPassword({
        identifier: email,
        password: 'Str0ng!Vendor#26',
        ip: '203.0.113.10',
      }),
    );

    expect(result.user.roles).toContain('VENDOR_OWNER');
    expect(result.tokens.accessToken).toBeTruthy();
    // VENDOR_OWNER is on the MFA list: that login can change where money is paid.
    expect(result.mfaRequired).toBe(true);
  });

  it('gives the same answer for a wrong password and a user that does not exist', async () => {
    const { email } = await registerVendor();

    const wrongPassword = await inRequest(() =>
      identity.loginWithPassword({ identifier: email, password: 'Wr0ng!Password#26' }),
    ).catch((e: Error) => e.message);
    const noSuchUser = await inRequest(() =>
      identity.loginWithPassword({
        identifier: 'nobody@example.com',
        password: 'Wr0ng!Password#26',
      }),
    ).catch((e: Error) => e.message);

    expect(wrongPassword).toBe(noSuchUser);
  });

  it('locks the account after five failures', async () => {
    const { email, userId } = await registerVendor();
    for (let i = 0; i < 5; i++) {
      await expect(
        inRequest(() =>
          identity.loginWithPassword({ identifier: email, password: 'Wr0ng!Password#26' }),
        ),
      ).rejects.toThrow();
    }

    // Assert the counter actually moved. Swallowing these errors hid a real SQL
    // bug for three runs — the lockout was never being written at all.
    const account = await raw.user_account.findUniqueOrThrow({ where: { id: userId } });
    expect(account.failed_login_count).toBe(5);
    expect(account.locked_until).not.toBeNull();

    await redis.client.flushdb(); // prove it is the DB lock, not the rate limiter

    await expect(
      inRequest(() =>
        identity.loginWithPassword({ identifier: email, password: 'Str0ng!Vendor#26' }),
      ),
    ).rejects.toThrow(/Try again in 15 minutes/);
  });

  it('a suspended organisation cannot sign in, and is told why', async () => {
    const { email, orgId, userId } = await registerVendor();
    await inRequest(() =>
      identity.suspendOrganization(orgId, 'Grade accuracy below threshold', userId),
    );

    await expect(
      inRequest(() =>
        identity.loginWithPassword({ identifier: email, password: 'Str0ng!Vendor#26' }),
      ),
    ).rejects.toThrow(/organisation account is suspended/);
  });

  it('suspension kills live sessions immediately, not at expiry', async () => {
    const { email, orgId, userId } = await registerVendor();
    const session = await inRequest(() =>
      identity.loginWithPassword({ identifier: email, password: 'Str0ng!Vendor#26' }),
    );

    await inRequest(() => identity.suspendOrganization(orgId, 'Fraud investigation', userId));

    // Under self-serve QC a suspended vendor with fifteen more minutes of token
    // could list AND certify stock in those fifteen minutes.
    await expect(
      moduleRef.get(TokenService).verifyAccess(session.tokens.accessToken),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('review and approval', () => {
  it('a named person decides, and it is recorded', async () => {
    const { orgId, userId } = await registerVendor();
    const reviewer = await makeReviewer();
    await completeAllSteps(orgId);
    await inRequest(() => kyc.submitForReview(orgId, userId));

    await inRequest(() =>
      kyc.decide({
        orgId,
        reviewerId: reviewer,
        decision: 'APPROVED',
        reasonCodes: ['ALL_CHECKS_PASSED'],
      }),
    );

    const org = await raw.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.status).toBe('VERIFIED');

    const review = await raw.kyc_review.findFirstOrThrow({ where: { org_id: orgId } });
    expect(review.reviewer_id).toBe(reviewer);
    expect(review.decision).toBe('APPROVE'); // stored vocabulary is imperative
  });

  it('a rejection without a reason is refused', async () => {
    const { orgId, userId } = await registerVendor();
    const reviewer = await makeReviewer();
    await completeAllSteps(orgId);
    await inRequest(() => kyc.submitForReview(orgId, userId));

    await expect(
      inRequest(() => kyc.decide({ orgId, reviewerId: reviewer, decision: 'REJECTED' })),
    ).rejects.toThrow(/Give a reason/);
  });

  it('the queue sorts by SLA, and a breach is visible', async () => {
    const { orgId, userId } = await registerVendor();
    await completeAllSteps(orgId);
    await inRequest(() => kyc.submitForReview(orgId, userId));

    let queue = await kyc.reviewQueue();
    expect(queue[0]!.orgId).toBe(orgId);
    expect(queue[0]!.slaBreached).toBe(false);
    expect(queue[0]!.hoursRemaining!).toBeGreaterThan(0);

    clock.advanceDays(7);
    queue = await kyc.reviewQueue();
    expect(queue[0]!.slaBreached).toBe(true);
    expect(queue[0]!.hoursRemaining!).toBeLessThan(0);
  });

  it('the SLA clock counts working hours, not weekend hours', async () => {
    const { orgId, userId } = await registerVendor();
    await completeAllSteps(orgId);

    // Friday 18:00 IST = 12:30 UTC.
    clock.advanceTo(new Date('2026-08-28T12:30:00.000Z'));
    const { slaDueAt } = await inRequest(() => kyc.submitForReview(orgId, userId));

    // 48 working hours from Friday evening spans the Sunday, so the deadline is
    // more than 48 wall-clock hours out — and lands on a working day.
    const elapsedHours = (slaDueAt.getTime() - clock.nowMs()) / 3_600_000;
    expect(elapsedHours).toBeGreaterThan(48);
    expect(elapsedHours).toBeLessThan(96); // ...but not a week, which is the other failure mode

    const istDay = new Date(slaDueAt.getTime() + 5.5 * 3_600_000).getUTCDay();
    expect(istDay).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('consent, under the DPDP Act', () => {
  it('records the notice version and language, because "they agreed" is not a record', async () => {
    const { orgId, userId } = await registerVendor();
    await inRequest(() =>
      kyc.recordConsent({
        orgId,
        userId,
        purpose: 'MARKETING',
        granted: true,
        noticeVersion: '2026-08-01',
        noticeLanguage: 'hi',
        channel: 'WEB',
      }),
    );

    const state = await kyc.consentState(orgId);
    const marketing = state.find((s) => s.purpose === 'MARKETING')!;
    expect(marketing.granted).toBe(true);
    expect(marketing.noticeLanguage).toBe('hi');
    expect(marketing.noticeVersion).toBe('2026-08-01');
  });

  it('withdrawal writes a timestamp; nothing is deleted', async () => {
    const { orgId, userId } = await registerVendor();
    await inRequest(() =>
      kyc.recordConsent({
        orgId,
        userId,
        purpose: 'MARKETING',
        granted: true,
        noticeVersion: '2026-08-01',
        noticeLanguage: 'en',
        channel: 'WEB',
      }),
    );
    await kyc.withdrawConsent(orgId, 'MARKETING', userId);

    expect((await kyc.consentState(orgId)).find((s) => s.purpose === 'MARKETING')!.granted).toBe(
      false,
    );
    // The grant is still there — it is the evidence consent ever existed.
    const rows = await raw.consent_record.findMany({
      where: { org_id: orgId, purpose: 'MARKETING' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.withdrawn_at).not.toBeNull();
  });

  it('an essential purpose cannot be declined into a broken account', async () => {
    const { orgId, userId } = await registerVendor();
    await expect(
      inRequest(() =>
        kyc.recordConsent({
          orgId,
          userId,
          purpose: 'KYC_VERIFICATION',
          granted: false,
          noticeVersion: '2026-08-01',
          noticeLanguage: 'en',
          channel: 'WEB',
        }),
      ),
    ).rejects.toThrow(/cannot open the account/);
  });

  it('a transactional message ignores the marketing flag entirely', async () => {
    const { orgId, userId } = await registerVendor();
    await kyc.withdrawConsent(orgId, 'MARKETING', userId).catch(() => undefined);

    // An OTP is not marketing, and withholding it would break the service they
    // did consent to.
    expect(await kyc.maySend({ orgId, userId, purpose: 'MARKETING', isTransactional: true })).toBe(
      true,
    );
    expect(await kyc.maySend({ orgId, userId, purpose: 'MARKETING', isTransactional: false })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------

describe('blacklist', () => {
  it('a blacklisted mobile cannot open a lead, and the message names no identifier', async () => {
    const { createHash } = await import('node:crypto');
    const mobile = '+919812340000';
    const hash = createHash('sha256').update(mobile.toUpperCase().trim()).digest('hex');
    await raw.$executeRaw`
      INSERT INTO kyc.blacklist_entry (entity_type, value_hash, reason, source)
      VALUES ('MOBILE', ${hash}, 'Prior fraud', 'INTERNAL_FRAUD')`;

    const attempt = inRequest(() =>
      kyc.createLead({
        intendedOrgType: 'VENDOR',
        companyName: 'Blocked Traders',
        contactName: 'Someone',
        mobile,
      }),
    );

    await expect(attempt).rejects.toThrow(/not able to open an account with these details/);

    // The message must be IDENTICAL whichever identifier matched — a message
    // that varies tells the applicant which value to change and try again.
    const emailHash = createHash('sha256').update('BANNED@EXAMPLE.COM').digest('hex');
    await raw.$executeRaw`
      INSERT INTO kyc.blacklist_entry (entity_type, value_hash, reason, source)
      VALUES ('EMAIL', ${emailHash}, 'Prior fraud', 'INTERNAL_FRAUD')`;

    const byEmail = await inRequest(() =>
      kyc.createLead({
        intendedOrgType: 'VENDOR',
        companyName: 'Other Traders',
        contactName: 'Someone Else',
        mobile: '9899999999',
        email: 'banned@example.com',
      }),
    ).catch((e: Error) => e.message);
    const byMobile = await attempt.catch((e: Error) => e.message);

    expect(byEmail).toBe(byMobile);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * A valid GSTIN whose final character drives the fake's outcome.
 * `Z9` -> provider error, `Z4` -> not found, `Z3` -> cancelled, `Z2` -> name mismatch.
 */
function gstinEndingIn(suffix: string): string {
  return gstinWhoseCheckDigitIs(suffix.slice(-1));
}

/**
 * A DIFFERENT valid GSTIN with the same outcome, for the value-shopping test.
 * Varies the entity segment while keeping the check digit fixed.
 */
function anotherGstinEndingIn(suffix: string, skip: number): string {
  const target = suffix.slice(-1);
  let seen = 0;
  for (let n = 0; n < 100_000; n++) {
    const body = `06AAFCT${String(n).padStart(4, '0')}B1Z`;
    if (gstinCheckDigit(body) === target && seen++ === skip) return body + target;
  }
  throw new Error('No alternative GSTIN found');
}

async function makeReviewer(): Promise<string> {
  const org = await raw.organization.create({
    data: { org_type: 'INTERNAL', legal_name: 'TrueTech Services Pvt. Ltd.', status: 'VERIFIED' },
  });
  const user = await raw.user_account.create({
    data: {
      org_id: org.id,
      full_name: 'Ops Reviewer',
      email: `ops-${org.id.slice(0, 8)}@trugrade.in`,
      status: 'ACTIVE',
    },
  });
  await raw.$executeRaw`
    INSERT INTO identity.user_role (user_id, role_id, org_id)
    SELECT ${user.id}::uuid, id, ${org.id}::uuid FROM identity.role WHERE code = 'KYC_REVIEWER'`;
  return user.id;
}

async function completeAllSteps(orgId: string): Promise<void> {
  const { progress } = await kyc.getOnboarding(orgId);
  for (const step of progress.steps.filter((s) => s.isRequired)) {
    await kyc.saveStepDraft(orgId, step.stepCode, { done: true }, 100);
    await kyc.completeStep(orgId, step.stepCode, async () => undefined);
  }
}
