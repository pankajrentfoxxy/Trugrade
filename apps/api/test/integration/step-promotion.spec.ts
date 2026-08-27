/**
 * Step promotion — where a completed step's answers actually go.
 *
 * Measured on the dev database before this existed: 642 `onboarding_progress`
 * rows, and zero rows in `vendor_capability`, `vendor_facility`,
 * `vendor_profile`, `org_contact` and `gst_profile`. `completeStep` ran a
 * promotion and then cleared `draft_json`; nothing supplied a promotion, so
 * completing a step DESTROYED its answers.
 *
 * Every test here attempts the thing rather than asserting the guard exists —
 * the standard three shipped defects were caught failing. So:
 *
 *   - the destination table is read back and the values compared against what
 *     the screen sent, not "a row exists";
 *   - the transaction test injects a real failure mid-promotion and then reads
 *     the step and the draft;
 *   - the idempotency test does the full complete / request-fix / complete
 *     round trip and counts rows;
 *   - the two rules that read `organization.constitution` are made to FIRE,
 *     which means calling them and expecting the refusal.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { gstinCheckDigit } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { EventBus } from '../../src/shared/events/event-bus';
import { ContextModule, RequestContextService } from '../../src/shared/db/org-scope';
import { RedisService, RateLimiter, LockService } from '../../src/shared/redis/redis.service';
import { TokenService } from '../../src/shared/auth/token.service';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { PasswordService } from '../../src/modules/identity/internal/password.service';
import { OtpService } from '../../src/modules/identity/internal/otp.service';
import { AuditService } from '../../src/modules/identity/internal/audit.service';
import { OrgPromotionService } from '../../src/modules/identity/internal/promotion.service';
import { VendorPromotionService } from '../../src/modules/vendor/internal/promotion.service';
import { KycService } from '../../src/modules/kyc/kyc.service';
import { OnboardingService } from '../../src/modules/kyc/internal/onboarding.service';
import { VerificationService } from '../../src/modules/kyc/internal/verification.service';
import { ConsentService } from '../../src/modules/kyc/internal/consent.service';
import { StepPromotionService } from '../../src/modules/kyc/internal/promotion.service';
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
let onboarding: OnboardingService;
let verification: VerificationService;
let promotions: StepPromotionService;
let otp: OtpService;
let clock: FixedClock;
let raw: PrismaClient;
let redis: RedisService;
let ctx: RequestContextService;

/**
 * The GSTIN fake keys its outcome off the last two characters, and the last is
 * the mod-36 check digit — derived, not chosen. A GSTIN with a wrong check
 * digit never reaches the provider at all, so a hard-coded fixture would test
 * the local format rule instead of the promotion.
 */
function gstinWhoseCheckDigitIs(target: string, prefix = '06AAFCT'): string {
  for (let n = 0; n < 10_000; n++) {
    const body = `${prefix}${String(n).padStart(4, '0')}A1Z`;
    if (gstinCheckDigit(body) === target) return body + target;
  }
  throw new Error(`No GSTIN found under ${prefix} whose check digit is "${target}"`);
}

/** ACTIVE, name matches. Haryana (06). */
const GSTIN_HARYANA = gstinWhoseCheckDigitIs('5');
/** The same company's Karnataka registration — one entity, two states. */
const GSTIN_KARNATAKA = gstinWhoseCheckDigitIs('5', '29AAFCT');
/** The GST portal has no record of this one. */
const GSTIN_UNKNOWN = gstinWhoseCheckDigitIs('4');

/** `C` in position four: a company. Matches PVT_LTD under VR-008. */
const COMPANY_PAN = 'AAFCT1234A';
/** `P`: an individual. A proprietor's PAN. */
const INDIVIDUAL_PAN = 'AAFPT1234A';

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
      IdentityService,
      OrgPromotionService,
      VendorPromotionService,
      OnboardingService,
      VerificationService,
      ConsentService,
      KycService,
      StepPromotionService,
      EventBus,
    ],
  }).compile();

  await moduleRef.init();
  identity = moduleRef.get(IdentityService);
  kyc = moduleRef.get(KycService);
  onboarding = moduleRef.get(OnboardingService);
  verification = moduleRef.get(VerificationService);
  promotions = moduleRef.get(StepPromotionService);
  otp = moduleRef.get(OtpService);
  redis = moduleRef.get(RedisService);
  ctx = moduleRef.get(RequestContextService);
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  await redis.client.flushdb();
  clock.advanceTo(new Date('2026-08-27T06:00:00.000Z'));
});

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return ctx.run({ requestId: 'test', ip: '203.0.113.10', userAgent: 'jest' }, fn);
}

interface Applicant {
  orgId: string;
  userId: string;
}

async function register(orgType: 'VENDOR' | 'BUYER' = 'VENDOR'): Promise<Applicant> {
  const email = orgType === 'VENDOR' ? 'priya@alphasystems.in' : 'ravi@zenithit.in';
  const mobile = orgType === 'VENDOR' ? '+919876543210' : '+919812345670';

  const lead = await inRequest(() =>
    kyc.createLead({
      intendedOrgType: orgType,
      companyName: orgType === 'VENDOR' ? 'Alpha Systems' : 'Zenith IT',
      contactName: orgType === 'VENDOR' ? 'Priya Sharma' : 'Ravi Menon',
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
      orgType,
      legalName: orgType === 'VENDOR' ? 'Alpha Systems Pvt Ltd' : 'Zenith IT Solutions Pvt Ltd',
      fullName: orgType === 'VENDOR' ? 'Priya Sharma' : 'Ravi Menon',
      email,
      mobile,
      password: 'Str0ng!Vendor#26',
      leadId: lead.leadId,
    }),
  );
  await kyc.startOnboarding(created.orgId);
  return { orgId: created.orgId, userId: created.userId };
}

/** Save the draft exactly as the wizard does, then complete through promotion. */
async function completeStep(who: Applicant, stepCode: string, answers: Record<string, unknown>) {
  await kyc.saveStepDraft(who.orgId, stepCode, answers, 100);
  await kyc.completeStep(who.orgId, stepCode, (draft) =>
    promotions.promote({ orgId: who.orgId, userId: who.userId, stepCode, answers: draft }),
  );
}

const postal = (over: Record<string, string> = {}) => ({
  line1: 'Plot 42, Udyog Vihar Phase IV',
  line2: '',
  city: 'Gurugram',
  state: '06',
  pincode: '122015',
  ...over,
});

/** Exactly the keys `StepVendorBusiness.toDraft` writes. */
const VENDOR_BUSINESS = {
  legalName: 'Alpha Systems Private Limited',
  tradeName: 'Alpha Systems',
  constitution: 'PVT_LTD',
  incorporationDate: '2019-06-11',
  category: 'REFURBISHER',
  website: 'https://alphasystems.in',
  staffBand: '51_200',
  registered: postal(),
  operating: postal({ line1: 'Shed 7, Sector 37', pincode: '122004' }),
  operatingSameAsRegistered: false,
};

/** Exactly the keys `StepCapability.toDraft` writes. */
const CAPABILITY = {
  categories: ['BUSINESS_LAPTOP', 'WORKSTATION'],
  brands: ['Lenovo', 'Dell'],
  otherBrands: '',
  monthlyCapacity: '300',
  gradeMix: { A_PLUS: '20', A: '50', B: '30' },
  priceBandMin: '14000',
  priceBandMax: '46000',
  sourcingChannels: ['CORPORATE_BUYBACK', 'ITAD_CONTRACT'],
  canProvideSerialsUpfront: true,
  hasInhouseTesting: true,
  hasInhouseRepair: false,
  leadTimeDays: '3',
  canDropship: false,
};

/** Exactly the keys `StepFacility.toDraft` writes. */
const FACILITY = {
  facilities: [
    {
      label: 'Gurugram warehouse',
      facilityType: 'WAREHOUSE',
      address: postal(),
      dispatchSameAsFacility: false,
      dispatchAddress: postal({ line1: 'Shed 7, Sector 37', pincode: '122004' }),
      storageCapacityUnits: '900',
      hasLoadingDock: true,
      vehicleAccess: 'TRUCK',
      liftAvailable: false,
      testingStations: '6',
      specialInstructions: 'Ring the bell at gate 2.',
      hours: {
        '1': { closed: false, opensAt: '09:00', closesAt: '18:00' },
        '2': { closed: false, opensAt: '09:00', closesAt: '18:00' },
        '0': { closed: true, opensAt: '', closesAt: '' },
      },
      holidays: [{ date: '2026-10-20', reason: 'Diwali' }],
    },
  ],
  contacts: {
    OWNER: {
      fullName: 'Priya Sharma',
      designation: 'Director',
      email: 'priya@alphasystems.in',
      mobile: '+919876543210',
      whatsapp: '+919876543210',
      language: 'EN',
    },
    LOGISTICS: {
      fullName: 'Sunil Verma',
      designation: 'Operations lead',
      email: 'sunil@alphasystems.in',
      mobile: '+919811112222',
      whatsapp: '',
      language: 'HI',
    },
    WAREHOUSE: {
      fullName: 'Ramesh Yadav',
      designation: 'Warehouse supervisor',
      email: 'ramesh@alphasystems.in',
      mobile: '+919833334444',
      whatsapp: '',
      language: 'HI',
    },
  },
};

// ===========================================================================
// BUSINESS_PROFILE — the constitution, and the three rules that read it
// ===========================================================================

describe('BUSINESS_PROFILE promotes into organization and vendor_profile', () => {
  it('writes the constitution and the profile the screen sent', async () => {
    const who = await register();

    const before = await raw.organization.findUniqueOrThrow({ where: { id: who.orgId } });
    expect(before.constitution).toBeNull();
    expect(await raw.vendor_profile.count({ where: { org_id: who.orgId } })).toBe(0);

    await completeStep(who, 'BUSINESS_PROFILE', VENDOR_BUSINESS);

    const org = await raw.organization.findUniqueOrThrow({ where: { id: who.orgId } });
    expect(org.constitution).toBe('PVT_LTD');
    expect(org.legal_name).toBe('Alpha Systems Private Limited');
    expect(org.trade_name).toBe('Alpha Systems');
    expect(org.website).toBe('https://alphasystems.in');
    expect(org.employee_count_band).toBe('51_200');

    const profile = await raw.vendor_profile.findUniqueOrThrow({ where: { org_id: who.orgId } });
    expect(profile.business_category).toBe('REFURBISHER');
    expect(profile.incorporation_date?.toISOString()).toBe('2019-06-11T00:00:00.000Z');

    // The registered office goes on every purchase order we raise to them, and
    // the operating address is a different building.
    // `orderBy type` sorts by the ENUM's declaration order, not alphabetically:
    // REGISTERED, BILLING, SHIPPING, PICKUP.
    const addresses = await raw.org_address.findMany({
      where: { org_id: who.orgId },
      orderBy: { type: 'asc' },
    });
    expect(addresses.map((a) => [a.type, a.label, a.pincode, a.state])).toEqual([
      ['REGISTERED', 'Registered office', '122015', 'Haryana'],
      ['PICKUP', 'Operating address', '122004', 'Haryana'],
    ]);
    // `contact_name` is NOT NULL and this step asks for no contact. The person
    // named is the one who completed it, not a placeholder.
    expect(addresses.every((a) => a.contact_name === 'Priya Sharma')).toBe(true);
    expect(addresses.every((a) => a.contact_mobile === '+919876543210')).toBe(true);
  });

  it("does not let the applicant's typing become a constitution we do not have", async () => {
    const who = await register();
    await expect(
      completeStep(who, 'BUSINESS_PROFILE', { ...VENDOR_BUSINESS, constitution: 'PRIVATE_LIMITED' }),
    ).rejects.toThrow(/not a constitution we recognise/i);

    const org = await raw.organization.findUniqueOrThrow({ where: { id: who.orgId } });
    expect(org.constitution).toBeNull();
  });

  it('accepts the two business categories the form offers that the CHECK used to refuse', async () => {
    const who = await register();
    await completeStep(who, 'BUSINESS_PROFILE', { ...VENDOR_BUSINESS, category: 'LEASING' });
    const profile = await raw.vendor_profile.findUniqueOrThrow({ where: { org_id: who.orgId } });
    expect(profile.business_category).toBe('LEASING');
  });
});

describe('the three rules that read organization.constitution stop being inert', () => {
  it('makes CIN a required field for a PVT_LTD, and forbidden for a proprietorship', async () => {
    const who = await register();

    const cinBefore = (await onboarding.getProgress(who.orgId)).steps
      .find((s) => s.stepCode === 'STATUTORY')!
      .fields.find((f) => f.fieldCode === 'cin');
    // Present but optional — nothing has said which constitution this is.
    expect(cinBefore).toBeDefined();
    expect(cinBefore!.required).toBe(false);

    await completeStep(who, 'BUSINESS_PROFILE', VENDOR_BUSINESS);

    const cinAfter = (await onboarding.getProgress(who.orgId)).steps
      .find((s) => s.stepCode === 'STATUTORY')!
      .fields.find((f) => f.fieldCode === 'cin');
    expect(cinAfter!.required).toBe(true);

    // And the other direction: a proprietor is never asked for one at all.
    await raw.organization.update({
      where: { id: who.orgId },
      data: { constitution: 'PROPRIETORSHIP' },
    });
    const fields = (await onboarding.getProgress(who.orgId)).steps.find(
      (s) => s.stepCode === 'STATUTORY',
    )!.fields;
    expect(fields.map((f) => f.fieldCode)).not.toContain('cin');
  });

  it('gates the board resolution on the promoted constitution', async () => {
    const who = await register();

    const before = (await onboarding.getProgress(who.orgId)).steps
      .find((s) => s.stepCode === 'DOCUMENTS_BANK')!
      .fields.find((f) => f.fieldCode === 'board_resolution');
    expect(before!.required).toBe(false);

    await completeStep(who, 'BUSINESS_PROFILE', VENDOR_BUSINESS);

    const after = (await onboarding.getProgress(who.orgId)).steps
      .find((s) => s.stepCode === 'DOCUMENTS_BANK')!
      .fields.find((f) => f.fieldCode === 'board_resolution');
    expect(after!.required).toBe(true);
  });

  it('fires VR-008 against the promoted constitution, with no entity type from the client', async () => {
    const who = await register();

    // Before promotion the rule has no input and lets an individual's PAN
    // through for a company. This is the defect, reproduced.
    const unarmed = await inRequest(() => verification.verifyPan(INDIVIDUAL_PAN, { orgId: who.orgId }));
    expect(unarmed.outcome).toBe('PASS');

    await completeStep(who, 'BUSINESS_PROFILE', VENDOR_BUSINESS);

    await expect(
      inRequest(() => verification.verifyPan(INDIVIDUAL_PAN, { orgId: who.orgId })),
    ).rejects.toThrow(/belongs to an individual, but you selected "PVT_LTD"/);

    // The company's own PAN still passes — the rule refuses a contradiction,
    // not every PAN.
    const armed = await inRequest(() => verification.verifyPan(COMPANY_PAN, { orgId: who.orgId }));
    expect(armed.outcome).toBe('PASS');
  });
});

// ===========================================================================
// STATUTORY
// ===========================================================================

describe('STATUTORY promotes into gst_profile and pan_record', () => {
  async function verifiedStatutoryDraft(who: Applicant) {
    await inRequest(() =>
      verification.verifyGstin(GSTIN_HARYANA, { orgId: who.orgId }, {
        expectedLegalName: 'Alpha Systems Private Limited',
      }),
    );
    await inRequest(() =>
      verification.verifyGstin(GSTIN_KARNATAKA, { orgId: who.orgId }, {
        expectedLegalName: 'Alpha Systems Private Limited',
      }),
    );
    await inRequest(() => verification.verifyPan(COMPANY_PAN, { orgId: who.orgId }));

    return {
      legalName: 'Alpha Systems Private Limited',
      pan: COMPANY_PAN,
      panOutcome: null,
      panDeferred: false,
      cin: 'U72200HR2019PTC012345',
      incorporation_date: '2019-06-11',
      gstins: [
        { gstin: GSTIN_HARYANA, isPrimary: true, outcome: null, confirmed: true, deferred: false },
        { gstin: GSTIN_KARNATAKA, isPrimary: false, outcome: null, confirmed: true, deferred: false },
      ],
      primaryGstin: GSTIN_HARYANA,
    };
  }

  it('writes one row per verified registration, with the portal name and one primary', async () => {
    const who = await register();
    const draft = await verifiedStatutoryDraft(who);

    expect(await raw.gst_profile.count({ where: { org_id: who.orgId } })).toBe(0);
    await completeStep(who, 'STATUTORY', draft);

    const rows = await raw.gst_profile.findMany({
      where: { org_id: who.orgId },
      orderBy: { state_code: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.gstin).toBe(GSTIN_HARYANA);
    expect(rows[0]!.state_code).toBe('06');
    expect(rows[0]!.is_primary).toBe(true);
    expect(rows[0]!.status).toBe('ACTIVE');
    // The legal name is the portal's answer, not what the applicant typed.
    expect(rows[0]!.legal_name_as_per_gst).toBe('Alpha Systems Private Limited');
    expect(rows[0]!.api_verified_at).toBeInstanceOf(Date);
    expect(rows[1]!.state_code).toBe('29');
    expect(rows[1]!.is_primary).toBe(false);
  });

  it('refuses to record a registration the portal never confirmed', async () => {
    const who = await register();
    // ONE verified registration, not two: `checkForValueShopping` pauses an
    // application at the third distinct GSTIN in 24h, and this test needs the
    // unconfirmed one to be the second. (That rule is wrong for GSTIN and is
    // already an open question in the build ledger; it is not this test's to
    // settle, but it does decide how many registrations fit in one fixture.)
    await inRequest(() =>
      verification.verifyGstin(GSTIN_HARYANA, { orgId: who.orgId }, {
        expectedLegalName: 'Alpha Systems Private Limited',
      }),
    );
    await inRequest(() => verification.verifyPan(COMPANY_PAN, { orgId: who.orgId }));
    const failed = await inRequest(() =>
      verification.verifyGstin(GSTIN_UNKNOWN, { orgId: who.orgId }),
    );
    expect(failed.outcome).toBe('FAIL');

    // The client posts a draft claiming a PASS for the GSTIN the portal has no
    // record of. `draft_json` is client-supplied, so this is the attack rather
    // than a typo — and the promotion reads `verification_check`, not this.
    await completeStep(who, 'STATUTORY', {
      legalName: 'Alpha Systems Private Limited',
      pan: COMPANY_PAN,
      gstins: [
        { gstin: GSTIN_HARYANA, isPrimary: true, outcome: null, confirmed: true, deferred: false },
        {
          gstin: GSTIN_UNKNOWN,
          isPrimary: false,
          outcome: { outcome: 'PASS', resolved: { legalName: 'Whatever I Like' } },
          confirmed: true,
          deferred: false,
        },
      ],
      primaryGstin: GSTIN_HARYANA,
    });

    const gstins = (await raw.gst_profile.findMany({ where: { org_id: who.orgId } })).map(
      (g) => g.gstin,
    );
    expect(gstins).toEqual([GSTIN_HARYANA]);
  });

  it('stores the PAN encrypted, hashed and marked verified', async () => {
    const who = await register();
    await completeStep(who, 'STATUTORY', await verifiedStatutoryDraft(who));

    const pan = await raw.pan_record.findUniqueOrThrow({ where: { org_id: who.orgId } });
    expect(pan.pan_last4).toBe('234A');
    expect(pan.verified).toBe(true);
    expect(pan.api_verified_at).toBeInstanceOf(Date);
    // The column is named `_enc` and it has to earn the name.
    expect(Buffer.from(pan.pan_enc).toString('utf8')).not.toContain(COMPANY_PAN);

    const [decrypted] = await raw.$queryRaw<Array<{ pan: string }>>`
      SELECT pgp_sym_decrypt(pan_enc, 'trugrade-local-pii-key') AS pan
        FROM kyc.pan_record WHERE org_id = ${who.orgId}::uuid`;
    expect(decrypted!.pan).toBe(COMPANY_PAN);
  });
});

// ===========================================================================
// CAPABILITY
// ===========================================================================

describe('CAPABILITY promotes into vendor_capability', () => {
  it('writes one row per category with the values the screen sent', async () => {
    const who = await register();
    expect(await raw.vendor_capability.count({ where: { org_id: who.orgId } })).toBe(0);

    await completeStep(who, 'CAPABILITY', CAPABILITY);

    const rows = await raw.vendor_capability.findMany({
      where: { org_id: who.orgId },
      orderBy: { category: 'asc' },
    });
    expect(rows.map((r) => r.category)).toEqual(['BUSINESS_LAPTOP', 'WORKSTATION']);
    expect(rows[0]!.monthly_capacity_units).toBe(300);
    expect(rows[0]!.lead_time_days).toBe(3);
    expect(rows[0]!.sourcing_channels).toEqual(['CORPORATE_BUYBACK', 'ITAD_CONTRACT']);
    expect(rows[0]!.typical_grade_mix).toEqual({ A_PLUS: 20, A: 50, B: 30 });
    expect(Number(rows[0]!.avg_price_band_min)).toBe(14000);
    expect(rows[0]!.has_inhouse_testing).toBe(true);
    expect(rows[0]!.has_inhouse_repair).toBe(false);
    // The column defaults TRUE. A supplier who said no must read as no.
    expect(rows[0]!.can_dropship).toBe(false);
  });

  it('refuses to invent the two answers whose column default is the convenient one', async () => {
    const who = await register();
    await expect(
      completeStep(who, 'CAPABILITY', { ...CAPABILITY, canDropship: null }),
    ).rejects.toThrow(/we do not assume either/i);
    expect(await raw.vendor_capability.count({ where: { org_id: who.orgId } })).toBe(0);
  });

  it('stops routing enquiries for a category the supplier removed', async () => {
    const who = await register();
    await completeStep(who, 'CAPABILITY', CAPABILITY);
    await onboarding.requestFix(
      who.orgId,
      'CAPABILITY',
      'Your monthly capacity looks like a typo — 300 laptops a month with six test stations. Please confirm.',
      who.userId,
    );
    await completeStep(who, 'CAPABILITY', { ...CAPABILITY, categories: ['BUSINESS_LAPTOP'] });

    const rows = await raw.vendor_capability.findMany({
      where: { org_id: who.orgId },
      orderBy: { category: 'asc' },
    });
    // Two rows, not four — and the removed one is inactive rather than gone.
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.category === 'BUSINESS_LAPTOP')!.is_active).toBe(true);
    expect(rows.find((r) => r.category === 'WORKSTATION')!.is_active).toBe(false);
  });
});

// ===========================================================================
// FACILITY_CONTACTS — two modules, one transaction
// ===========================================================================

describe('FACILITY_CONTACTS promotes across the identity/vendor seam', () => {
  it('writes the facility, its address, its hours, its holiday and the contacts', async () => {
    const who = await register();
    await completeStep(who, 'FACILITY_CONTACTS', FACILITY);

    const facility = await raw.vendor_facility.findFirstOrThrow({
      where: { org_id: who.orgId },
      include: { facility_hours: true, facility_holiday: true, org_address: true },
    });
    expect(facility.facility_type).toBe('WAREHOUSE');
    expect(facility.vehicle_access).toBe('TRUCK');
    expect(facility.has_loading_dock).toBe(true);
    expect(facility.lift_available).toBe(false);
    expect(facility.storage_capacity_units).toBe(900);
    expect(facility.testing_stations).toBe(6);

    expect(facility.org_address.label).toBe('Gurugram warehouse');
    expect(facility.org_address.pincode).toBe('122015');
    expect(facility.org_address.state).toBe('Haryana');
    // Not asked per facility, and not invented: the warehouse contact from the
    // same screen is the person the driver calls.
    expect(facility.org_address.contact_name).toBe('Ramesh Yadav');
    expect(facility.org_address.contact_mobile).toBe('+919833334444');

    // The dispatch address is a DIFFERENT building and is recorded as such —
    // NULL here would mean "the facility's own address" on every e-way bill.
    expect(facility.dispatch_address_id).not.toBeNull();
    const dispatch = await raw.org_address.findUniqueOrThrow({
      where: { id: facility.dispatch_address_id! },
    });
    expect(dispatch.line1).toBe('Shed 7, Sector 37');
    expect(dispatch.pincode).toBe('122004');

    const hours = facility.facility_hours.sort((a, b) => a.day_of_week - b.day_of_week);
    expect(hours.map((h) => h.day_of_week)).toEqual([0, 1, 2]);
    // Sunday is shut, which is an answer and not a blank.
    expect(hours[0]!.is_closed).toBe(true);
    expect(hours[0]!.open_time).toBeNull();
    expect(hours[1]!.is_closed).toBe(false);
    expect(hours[1]!.open_time?.toISOString()).toBe('1970-01-01T09:00:00.000Z');

    expect(facility.facility_holiday).toHaveLength(1);
    expect(facility.facility_holiday[0]!.reason).toBe('Diwali');

    const contacts = await raw.org_contact.findMany({
      where: { org_id: who.orgId },
      orderBy: { contact_type: 'asc' },
    });
    expect(contacts.map((c) => [c.contact_type, c.full_name])).toEqual([
      ['LOGISTICS', 'Sunil Verma'],
      ['OWNER', 'Priya Sharma'],
      ['WAREHOUSE', 'Ramesh Yadav'],
    ]);
    expect(contacts.find((c) => c.contact_type === 'LOGISTICS')!.preferred_language).toBe('hi');
  });

  it('falls back to the operations contact when there is no warehouse one', async () => {
    const who = await register();
    const { WAREHOUSE: _dropped, ...rest } = FACILITY.contacts;
    await completeStep(who, 'FACILITY_CONTACTS', { ...FACILITY, contacts: rest });

    const facility = await raw.vendor_facility.findFirstOrThrow({
      where: { org_id: who.orgId },
      include: { org_address: true },
    });
    expect(facility.org_address.contact_name).toBe('Sunil Verma');
  });

  it('refuses rather than writing a placeholder into contact_name', async () => {
    const who = await register();
    await expect(
      completeStep(who, 'FACILITY_CONTACTS', { ...FACILITY, contacts: {} }),
    ).rejects.toThrow(/warehouse or operations contact/i);

    expect(await raw.org_address.count({ where: { org_id: who.orgId } })).toBe(0);
    expect(await raw.vendor_facility.count({ where: { org_id: who.orgId } })).toBe(0);
  });

  it('refuses to record a dispatch address nobody answered for', async () => {
    const who = await register();
    const unanswered = {
      ...FACILITY,
      facilities: [{ ...FACILITY.facilities[0], dispatchSameAsFacility: null }],
    };
    await expect(completeStep(who, 'FACILITY_CONTACTS', unanswered)).rejects.toThrow(
      /Dispatch From/,
    );
    expect(await raw.vendor_facility.count({ where: { org_id: who.orgId } })).toBe(0);
  });

  it('updates rather than duplicating when a reviewer sends the step back', async () => {
    const who = await register();
    await completeStep(who, 'FACILITY_CONTACTS', FACILITY);
    await onboarding.requestFix(
      who.orgId,
      'FACILITY_CONTACTS',
      'The warehouse mobile is one digit short. Please check it and resubmit the step.',
      who.userId,
    );

    const corrected = {
      ...FACILITY,
      contacts: {
        ...FACILITY.contacts,
        WAREHOUSE: { ...FACILITY.contacts.WAREHOUSE, mobile: '+919833334455' },
      },
    };
    await completeStep(who, 'FACILITY_CONTACTS', corrected);

    expect(await raw.vendor_facility.count({ where: { org_id: who.orgId } })).toBe(1);
    // Two rows: the facility and its separate dispatch address. Not four.
    expect(await raw.org_address.count({ where: { org_id: who.orgId } })).toBe(2);
    expect(await raw.org_contact.count({ where: { org_id: who.orgId } })).toBe(3);
    expect(await raw.facility_hours.count()).toBe(3);
    expect(await raw.facility_holiday.count()).toBe(1);

    const warehouse = await raw.org_contact.findFirstOrThrow({
      where: { org_id: who.orgId, contact_type: 'WAREHOUSE' },
    });
    expect(warehouse.mobile).toBe('+919833334455');
    const address = await raw.org_address.findFirstOrThrow({
      where: { org_id: who.orgId, label: 'Gurugram warehouse' },
    });
    expect(address.contact_mobile).toBe('+919833334455');
  });
});

// ===========================================================================
// AGREEMENT
// ===========================================================================

describe('AGREEMENT promotes into agreement_acceptance and vendor_payout_preference', () => {
  const AGREEMENT = {
    accepted: {
      VENDOR_AGREEMENT: true,
      GRADING_POLICY: true,
      DATA_WIPE_UNDERTAKING: true,
      RETURNS_POLICY: true,
    },
    signatoryName: 'Priya Sharma',
    pricingMode: 'COMMISSION',
    commissionRate: '8.5',
    payoutCycle: 'T_PLUS_2',
    payoutThreshold: '2500',
    invoiceUploadRequired: true,
    channels: ['EMAIL', 'WHATSAPP'],
    language: 'EN',
  };

  it('records who accepted which version, and the payout basis', async () => {
    const who = await register();
    await completeStep(who, 'BUSINESS_PROFILE', VENDOR_BUSINESS);
    await completeStep(who, 'AGREEMENT', AGREEMENT);

    const accepted = await raw.agreement_acceptance.findMany({
      where: { org_id: who.orgId },
      orderBy: { agreement_code: 'asc' },
    });
    expect(accepted.map((a) => a.agreement_code)).toEqual([
      'DATA_WIPE_UNDERTAKING',
      'GRADING_POLICY',
      'RETURNS_POLICY',
      'VENDOR_AGREEMENT',
    ]);
    expect(accepted.every((a) => a.version === '1.0')).toBe(true);
    expect(accepted.every((a) => a.user_id === who.userId)).toBe(true);
    // Nothing is e-signed and there is no document store, so the column says so
    // rather than carrying a hash of nothing.
    expect(accepted[0]!.doc_hash).toBe('unhashed:no-document-store');

    const payout = await raw.vendor_payout_preference.findUniqueOrThrow({
      where: { org_id: who.orgId },
    });
    expect(payout.pricing_mode).toBe('COMMISSION');
    expect(Number(payout.min_payout_threshold)).toBe(2500);
    expect(payout.invoice_upload_required).toBe(true);
    // The cycle is a REQUEST. What they are actually paid on is unchanged.
    expect(payout.preferred_cycle).toBe('T_PLUS_2');
    const profile = await raw.vendor_profile.findUniqueOrThrow({ where: { org_id: who.orgId } });
    expect(profile.settlement_cycle).toBe('WEEKLY');
    expect(Number(profile.commission_rate_override)).toBe(8.5);
  });

  it('does not stack a second acceptance of the same version', async () => {
    const who = await register();
    await completeStep(who, 'AGREEMENT', AGREEMENT);
    await onboarding.requestFix(
      who.orgId,
      'AGREEMENT',
      'The signatory name does not match the board resolution you uploaded. Please correct it.',
      who.userId,
    );
    await completeStep(who, 'AGREEMENT', { ...AGREEMENT, signatoryName: 'Priya R Sharma' });

    expect(await raw.agreement_acceptance.count({ where: { org_id: who.orgId } })).toBe(4);
    expect(await raw.vendor_payout_preference.count({ where: { org_id: who.orgId } })).toBe(1);
  });
});

// ===========================================================================
// CONTACTS_ADDRESSES — the buyer's step
// ===========================================================================

describe('CONTACTS_ADDRESSES promotes into org_address and org_contact', () => {
  it('writes one billing address per registration, the docks, and the people', async () => {
    const who = await register('BUYER');
    await completeStep(who, 'CONTACTS_ADDRESSES', {
      contacts: {
        PROCUREMENT: {
          fullName: 'Ravi Menon',
          designation: 'Head of IT',
          email: 'ravi@zenithit.in',
          mobile: '+919812345670',
        },
        FINANCE: {
          fullName: 'Anita Rao',
          designation: 'Financial controller',
          email: 'anita@zenithit.in',
          mobile: '+919812345671',
        },
        IT_ADMIN: { fullName: '', designation: '', email: '', mobile: '' },
      },
      billing: [{ gstin: GSTIN_HARYANA, ...postal() }],
      delivery: [
        {
          gstin: GSTIN_HARYANA,
          ...postal({ line1: 'Tower B, Cyber Hub', pincode: '122002' }),
          label: 'Gurugram office',
          contactName: 'Ravi Menon',
          contactMobile: '+919812345670',
          landmark: 'Opposite the metro exit',
          gateInstructions: 'Deliveries via the basement ramp.',
          days: 'MON_FRI',
          opensAt: '10:00',
          closesAt: '17:00',
        },
      ],
    });

    const addresses = await raw.org_address.findMany({
      where: { org_id: who.orgId },
      orderBy: { type: 'asc' },
    });
    expect(addresses.map((a) => a.type)).toEqual(['BILLING', 'SHIPPING']);

    const billing = addresses[0]!;
    expect(billing.label).toBe(GSTIN_HARYANA);
    expect(billing.is_billing_enabled).toBe(true);
    // The tax invoice goes to finance, so finance is who is named on it.
    expect(billing.contact_name).toBe('Anita Rao');

    const dock = addresses[1]!;
    expect(dock.label).toBe('Gurugram office');
    expect(dock.contact_name).toBe('Ravi Menon');
    expect(dock.landmark).toBe('Opposite the metro exit');
    // The receiving window has no columns; it reaches the driver anyway.
    expect(dock.delivery_instructions).toBe(
      'Monday to Friday, 10:00 to 17:00. Deliveries via the basement ramp.',
    );

    const contacts = await raw.org_contact.findMany({ where: { org_id: who.orgId } });
    // The unfilled optional IT contact is not a row.
    expect(contacts.map((c) => c.contact_type).sort()).toEqual(['FINANCE', 'PROCUREMENT']);
    expect(contacts.find((c) => c.contact_type === 'FINANCE')!.email).toBe('anita@zenithit.in');
  });
});

// ===========================================================================
// The two properties the whole design rests on
// ===========================================================================

describe('a promotion that fails half way takes the completion with it', () => {
  it('leaves the step incomplete AND the draft intact', async () => {
    const who = await register();

    // Half a promotion: the organisation is updated, then it throws. Injected
    // rather than asserted about, because the thing under test is whether the
    // FIRST write survives — and it must not.
    await kyc.saveStepDraft(who.orgId, 'BUSINESS_PROFILE', VENDOR_BUSINESS, 100);
    await expect(
      kyc.completeStep(who.orgId, 'BUSINESS_PROFILE', async (draft) => {
        await promotions.promote({
          orgId: who.orgId,
          userId: who.userId,
          stepCode: 'BUSINESS_PROFILE',
          answers: draft,
        });
        throw new Error('the second half of this promotion failed');
      }),
    ).rejects.toThrow('the second half of this promotion failed');

    const org = await raw.organization.findUniqueOrThrow({ where: { id: who.orgId } });
    expect(org.constitution).toBeNull();
    expect(await raw.vendor_profile.count({ where: { org_id: who.orgId } })).toBe(0);
    expect(await raw.org_address.count({ where: { org_id: who.orgId } })).toBe(0);

    const step = await raw.onboarding_progress.findFirstOrThrow({
      where: { org_id: who.orgId, step_code: 'BUSINESS_PROFILE' },
    });
    expect(step.status).not.toBe('COMPLETE');
    expect(step.completed_at).toBeNull();
    // The answers are still there. This is the half that used to be lost.
    expect(step.draft_json).toMatchObject({ constitution: 'PVT_LTD' });
    expect(await kyc.getStepDraft(who.orgId, 'BUSINESS_PROFILE')).toMatchObject(VENDOR_BUSINESS);
  });

  it('rolls the identity half back when the vendor half fails', async () => {
    const who = await register();
    // A facility whose vehicle access is not one the column accepts. The
    // addresses and contacts are planned and written FIRST, so if the rollback
    // is not real this leaves orphan addresses behind.
    await expect(
      completeStep(who, 'FACILITY_CONTACTS', {
        ...FACILITY,
        facilities: [{ ...FACILITY.facilities[0], vehicleAccess: 'HELICOPTER' }],
      }),
    ).rejects.toThrow(/largest vehicle/i);

    expect(await raw.org_address.count({ where: { org_id: who.orgId } })).toBe(0);
    expect(await raw.org_contact.count({ where: { org_id: who.orgId } })).toBe(0);
    expect(await raw.vendor_facility.count({ where: { org_id: who.orgId } })).toBe(0);
  });
});

describe("a completed step's answers are readable afterwards", () => {
  it('survives the clearing of draft_json — the Wave 2 defect', async () => {
    const who = await register();
    await completeStep(who, 'BUSINESS_PROFILE', VENDOR_BUSINESS);
    await completeStep(who, 'CAPABILITY', CAPABILITY);

    // `draft_json` is cleared on purpose: the promoted tables are the source of
    // truth now. Before promotion existed, that clearing was the only thing
    // that happened and the answers were gone.
    const step = await raw.onboarding_progress.findFirstOrThrow({
      where: { org_id: who.orgId, step_code: 'CAPABILITY' },
    });
    expect(step.status).toBe('COMPLETE');
    expect(step.draft_json).toBeNull();

    // Read back from the tables the rest of the product reads.
    const summary = await kyc.getOnboarding(who.orgId);
    expect(summary.progress.constitution).toBe('PVT_LTD');
    const capability = await raw.vendor_capability.findMany({ where: { org_id: who.orgId } });
    expect(capability).toHaveLength(2);
    expect(capability[0]!.monthly_capacity_units).toBe(300);
  });
});
