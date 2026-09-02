/* eslint-disable no-console -- CLI seed script */
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { RequestContextService } from '../../src/shared/db/org-scope';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { AppConfig } from '../../src/shared/config';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { KycService } from '../../src/modules/kyc/kyc.service';
import { StepPromotionService } from '../../src/modules/kyc/internal/promotion.service';
import { DEV_PII_KEY } from '../../src/modules/kyc/internal/verification.service';

/** Login for the fully onboarded buyer this script creates. */
export const ONBOARDED_BUYER_EMAIL = 'priya.meridian@yopmail.com';
export const ONBOARDED_BUYER_PASSWORD = 'Meridian#Buy2026';

const LEGAL_NAME = 'Meridian Systems Pvt. Ltd.';
const GSTIN = '06AABCA1429B1Z8';
const PAN = 'AABCA1429B';
const CIN = 'U72200HR2019PTC082341';

const hashInput = (value: string): string =>
  createHash('sha256').update(value.toUpperCase().trim()).digest('hex');

function guardDatabase(url: string | undefined): void {
  const name = (url ?? '').split('/').pop()?.split('?')[0] ?? '';
  if (!/^trugrade(_test|_verify|_demo)?[a-z_]*$/.test(name)) {
    throw new Error(
      `Refusing to seed onboarded buyer into "${name}". This writes a known password.`,
    );
  }
}

async function findReviewer(prisma: PrismaService): Promise<string> {
  const row = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT ua.id
      FROM identity.user_account ua
      JOIN identity.user_role ur ON ur.user_id = ua.id
      JOIN identity.role r ON r.id = ur.role_id
     WHERE r.code IN ('KYC_REVIEWER', 'PLATFORM_SUPERADMIN')
     LIMIT 1`;
  if (row[0]?.id) return row[0].id;

  const platform = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.organization WHERE org_type = 'INTERNAL' LIMIT 1`;
  if (!platform[0]) {
    throw new Error('No platform org found — run reference + demo seed first, or create a reviewer.');
  }

  const reviewerId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, full_name, email, status)
    VALUES (${reviewerId}::uuid, ${platform[0].id}::uuid, 'Seed Reviewer', 'seed-reviewer@trugrade.local', 'ACTIVE')
    ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`
    INSERT INTO identity.user_role (user_id, role_id, org_id)
    SELECT ${reviewerId}::uuid, r.id, ${platform[0].id}::uuid
      FROM identity.role r WHERE r.code = 'KYC_REVIEWER'
    ON CONFLICT DO NOTHING`;
  return reviewerId;
}

async function seedVerificationPasses(
  prisma: PrismaService,
  orgId: string,
  userId: string,
): Promise<void> {
  const existing = await prisma.db.verification_check.count({
    where: { org_id: orgId, check_type: 'GSTIN', input_hash: hashInput(GSTIN), status: 'PASS' },
  });
  if (existing > 0) return;

  await prisma.db.verification_check.create({
    data: {
      org_id: orgId,
      check_type: 'GSTIN',
      input_value_masked: `${GSTIN.slice(0, 2)}****${GSTIN.slice(-4)}`,
      input_hash: hashInput(GSTIN),
      provider: 'seed',
      status: 'PASS',
      response_summary: {
        gstin: GSTIN,
        legalName: LEGAL_NAME,
        tradeName: 'Meridian',
        status: 'ACTIVE',
        stateCode: '06',
        registrationDate: '2019-07-01',
        taxpayerType: 'Regular',
      },
      triggered_by: userId,
    },
  });
  await prisma.db.verification_check.create({
    data: {
      org_id: orgId,
      check_type: 'PAN',
      input_value_masked: `${PAN.slice(0, 2)}****${PAN.slice(-1)}`,
      input_hash: hashInput(PAN),
      provider: 'seed',
      status: 'PASS',
      response_summary: { name: LEGAL_NAME },
      triggered_by: userId,
    },
  });
}

async function seedCheckoutReady(prisma: PrismaService, orgId: string, userId: string): Promise<void> {
  const gurugram = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO identity.org_address
      (id, org_id, type, label, line1, city, state, state_code, pincode,
       contact_name, contact_mobile, is_default, is_billing_enabled, is_active)
    VALUES (${gurugram}::uuid, ${orgId}::uuid, 'SHIPPING'::address_type, 'Gurugram warehouse',
            'Plot 42, Udyog Vihar Phase IV', 'Gurugram', 'Haryana', '06', '122015',
            'Priya Sharma', '+919988776655', TRUE, TRUE, TRUE)
    ON CONFLICT DO NOTHING`;

  const gst = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM kyc.gst_profile WHERE org_id = ${orgId}::uuid AND is_primary LIMIT 1`;

  if (gst[0]) {
    await prisma.$executeRaw`
      INSERT INTO customer.org_preference (org_id, po_required, default_shipping_address_id,
                                           default_billing_gst_profile_id)
      VALUES (${orgId}::uuid, FALSE, ${gurugram}::uuid, ${gst[0].id}::uuid)
      ON CONFLICT (org_id) DO UPDATE
        SET default_shipping_address_id = EXCLUDED.default_shipping_address_id,
            default_billing_gst_profile_id = EXCLUDED.default_billing_gst_profile_id`;
  }

  await prisma.$executeRaw`
    INSERT INTO customer.buyer_profile (org_id, credit_limit, credit_terms_days, credit_used,
                                        payment_mode_allowed, onboarding_status, verified_at)
    VALUES (${orgId}::uuid, 2000000, 30, 0,
            ARRAY['PREPAID','CREDIT']::public.payment_mode[], 'VERIFIED'::org_status, now())
    ON CONFLICT (org_id) DO UPDATE
      SET payment_mode_allowed = EXCLUDED.payment_mode_allowed,
          onboarding_status = EXCLUDED.onboarding_status,
          verified_at = EXCLUDED.verified_at`;

  for (const docType of ['GST_CERTIFICATE', 'PAN_CARD', 'SIGNATORY_ID'] as const) {
    await prisma.$executeRaw`
      INSERT INTO kyc.kyc_document
        (org_id, doc_type, file_key, file_hash_sha256, mime, size_bytes, status, original_filename)
      SELECT ${orgId}::uuid, ${docType}, ${'kyc/seed/' + orgId + '/' + docType.toLowerCase()},
             repeat('c', 64), 'application/pdf', 120000, 'UPLOADED', ${docType + '.pdf'}
       WHERE NOT EXISTS (
         SELECT 1 FROM kyc.kyc_document WHERE org_id = ${orgId}::uuid AND doc_type = ${docType})`;
  }

  await prisma.$executeRaw`
    UPDATE identity.user_account SET email_verified_at = now(), mobile_verified_at = now()
     WHERE id = ${userId}::uuid`;
}

export async function seedOnboardedBuyer(log: (m: string) => void = console.log): Promise<void> {
  guardDatabase(process.env.DATABASE_URL);

  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();

  const ctx = moduleRef.get(RequestContextService);
  const identity = moduleRef.get(IdentityService);
  const kyc = moduleRef.get(KycService);
  const promotions = moduleRef.get(StepPromotionService);
  const prisma = moduleRef.get(PrismaService);
  const config = moduleRef.get(AppConfig);

  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.run({ requestId: 'seed-buyer', ip: '127.0.0.1', userAgent: 'seed' }, fn);

  const existing = await prisma.db.user_account.findFirst({
    where: { email: ONBOARDED_BUYER_EMAIL.toLowerCase() },
    select: { id: true, org_id: true },
  });

  let orgId: string;
  let userId: string;

  if (existing) {
    orgId = existing.org_id!;
    userId = existing.id;
    log(`Buyer already exists (${ONBOARDED_BUYER_EMAIL}) — completing any outstanding steps.`);
  } else {
    const created = await run(() =>
      identity.createOrganizationWithOwner({
        orgType: 'BUYER',
        legalName: LEGAL_NAME,
        fullName: 'Priya Sharma',
        email: ONBOARDED_BUYER_EMAIL,
        mobile: '+919988776655',
        password: ONBOARDED_BUYER_PASSWORD,
      }),
    );
    orgId = created.orgId;
    userId = created.userId;
    await kyc.startOnboarding(orgId);
  }

  const org = await prisma.db.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (org.status === 'REGISTERED') {
    const stepCount = await prisma.db.onboarding_progress.count({ where: { org_id: orgId } });
    if (stepCount === 0) await kyc.startOnboarding(orgId);
  }

  const complete = async (stepCode: string, answers: Record<string, unknown>): Promise<void> => {
    const step = await prisma.db.onboarding_progress.findFirst({
      where: { org_id: orgId, step_code: stepCode },
    });
    if (step?.status === 'COMPLETE') return;
    await kyc.saveStepDraft(orgId, stepCode, answers, 100);
    await kyc.completeStep(orgId, stepCode, (draft) =>
      promotions.promote({ orgId, userId, stepCode, answers: draft }),
    );
  };

  await complete('ACCOUNT', {
    fullName: 'Priya Sharma',
    companyName: LEGAL_NAME,
    email: ONBOARDED_BUYER_EMAIL,
    mobile: '+919988776655',
  });

  await complete('BUSINESS_PROFILE', {
    legalName: LEGAL_NAME,
    tradeName: 'Meridian',
    constitution: 'PVT_LTD',
    industry: 'IT_SERVICES',
    yearEstablished: '2019',
    employeeBand: '51-200',
    website: 'https://www.meridiansys.in',
    annualVolume: '51-200',
  });

  await seedVerificationPasses(prisma, orgId, userId);

  await complete('STATUTORY', {
    legalName: LEGAL_NAME,
    pan: PAN,
    panOutcome: null,
    panDeferred: false,
    cin: CIN,
    gstins: [{ gstin: GSTIN, isPrimary: true, outcome: null, confirmed: true, deferred: false }],
    primaryGstin: GSTIN,
  });

  await complete('CONTACTS_ADDRESSES', {
    contacts: {
      PROCUREMENT: {
        fullName: 'Priya Sharma',
        designation: 'Head of Procurement',
        email: ONBOARDED_BUYER_EMAIL,
        mobile: '+919988776655',
      },
      FINANCE: {
        fullName: 'Rahul Mehta',
        designation: 'Finance Manager',
        email: 'finance@meridiansys.in',
        mobile: '+919876501234',
      },
      IT_ADMIN: { fullName: '', designation: '', email: '', mobile: '' },
    },
    billing: [
      {
        gstin: GSTIN,
        line1: 'Plot 42, Udyog Vihar Phase IV',
        line2: 'Sector 18',
        city: 'Gurugram',
        state: '06',
        pincode: '122015',
      },
    ],
    delivery: [
      {
        gstin: GSTIN,
        line1: 'Plot 42, Udyog Vihar Phase IV',
        line2: '',
        city: 'Gurugram',
        state: '06',
        pincode: '122015',
        label: 'Gurugram warehouse',
        contactName: 'Priya Sharma',
        contactMobile: '+919988776655',
        landmark: 'Near NH-48 flyover',
        gateInstructions: 'Gate 2, security desk',
        days: 'MON_FRI',
        opensAt: '09:00',
        closesAt: '18:00',
      },
    ],
  });

  await complete('DOCUMENTS', {
    channels: ['EMAIL'],
    language: 'EN',
    poRequired: false,
  });

  const orgAfterSteps = await prisma.db.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (orgAfterSteps.status === 'REGISTERED') {
    await run(() => kyc.submitForReview(orgId, userId));
  }

  const orgBeforeApproval = await prisma.db.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (!['VERIFIED', 'REJECTED'].includes(orgBeforeApproval.status)) {
    const reviewerId = await findReviewer(prisma);
    await run(() =>
      kyc.decide({
        orgId,
        reviewerId,
        decision: 'APPROVED',
        reasonCodes: ['ALL_CHECKS_PASSED'],
        notes: 'Seeded buyer — automatic approval for local development.',
      }),
    );
  }

  await seedCheckoutReady(prisma, orgId, userId);

  const progress = await kyc.getOnboarding(orgId);
  const incomplete = progress.progress.steps.filter((s) => s.isRequired && s.status !== 'COMPLETE');
  if (incomplete.length > 0) {
    throw new Error(`Onboarding incomplete: ${incomplete.map((s) => s.stepCode).join(', ')}`);
  }

  log('Onboarded buyer created.');
  log(`  Company:  ${LEGAL_NAME}`);
  log(`  Email:    ${ONBOARDED_BUYER_EMAIL}`);
  log(`  Password: ${ONBOARDED_BUYER_PASSWORD}`);
  log(`  Org ID:   ${orgId}`);
  log(`  Status:   VERIFIED (all 5 steps complete)`);
  log(`  Sign in:  http://localhost:3000/sign-in`);

  if (!config.get('PII_ENCRYPTION_KEY')) {
    log(`  Note: PII key unset — using dev default (${DEV_PII_KEY.slice(0, 8)}…)`);
  }

  await moduleRef.close();
}

if (require.main === module) {
  seedOnboardedBuyer()
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
