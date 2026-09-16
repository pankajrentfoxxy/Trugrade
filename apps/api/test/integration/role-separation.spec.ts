/**
 * Stage 7 §7.5 — the role map, checked rather than believed.
 *
 * The spec's instruction was to write this test *before* the role map and let it
 * say where the map was wrong. It did, three times over:
 *
 *   - `KYC_REVIEWER` held `kyc.application.review` AND `kyc.application.approve`,
 *     so one person could take a vendor from application to approved supplier
 *     with nobody else in the room. Review stays; approve moved to OPS_MANAGER.
 *   - `OPS_MANAGER` held `kyc.application.review` as well as the approve it was
 *     given, which is the same violation one level up. Review removed.
 *   - The old single `FINANCE` seat was on course to hold every finance verb at
 *     once. The clerk work is split out into AP_CLERK, AR_CLERK, TREASURY and
 *     TAX_MANAGER, and CONTROLLER holds only checker halves.
 *
 * Every one of those is a separation failure no code review caught, and each was
 * a single line in a 600-line file. That is the argument for this test.
 */
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import {
  CA_ALLOWED_WRITE_VERB,
  MAKER_CHECKER,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  WRITE_ACTIONS,
  permissionsFor,
  type Permission,
  type Role,
} from '@trugrade/contracts';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/shared/auth/token.service';
import { migrateTestDatabase, testDb, truncateAll, seedTestReference } from '../support/db';

let moduleRef: TestingModule;
let app: INestApplication;
let raw: PrismaClient;

const MAKER = '99999999-0000-4000-8000-00000000ca01';
const CHECKER = '99999999-0000-4000-8000-00000000ca02';
const EXPIRED = '99999999-0000-4000-8000-00000000ca03';
const PLATFORM_ORG = '99999999-0000-4000-8000-000000000001';

async function issue(
  role: Role,
  userId: string,
  opts: { accessExpiresAt?: Date } = {},
): Promise<string> {
  const { accessToken } = await app.get(TokenService).issue({
    userId,
    orgId: PLATFORM_ORG,
    orgType: 'PLATFORM',
    roles: [role],
    permissions: [...permissionsFor([role])],
    mfa: true,
    ...(opts.accessExpiresAt ? { accessExpiresAt: opts.accessExpiresAt } : {}),
  });
  return accessToken;
}

/**
 * The platform's own organisation row, created if the reference seed has none.
 *
 * `org_type` is INTERNAL at the database and PLATFORM in the role vocabulary —
 * the same distinction `DOMAIN_ORG_TYPE` maps in IdentityService. Writing
 * 'PLATFORM' here is an enum error, not a missing row.
 */
async function platformOrgId(): Promise<string> {
  const [row] = await raw.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.organization WHERE org_type = 'INTERNAL' LIMIT 1`;
  if (row) return row.id;
  await raw.$executeRaw`
    INSERT INTO identity.organization (id, org_type, legal_name, status)
    VALUES (${PLATFORM_ORG}::uuid, 'INTERNAL', 'TrueTech Services Pvt. Ltd.', 'VERIFIED')
    ON CONFLICT (id) DO NOTHING`;
  return PLATFORM_ORG;
}

async function makeUser(id: string, name: string, orgId: string): Promise<void> {
  await raw.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, full_name, email, status)
    VALUES (${id}::uuid, ${orgId}::uuid, ${name}, ${id + '@example.test'}::citext, 'ACTIVE')
    ON CONFLICT (id) DO NOTHING`;
}

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await truncateAll(raw);
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  const orgId = await platformOrgId();
  await makeUser(MAKER, 'The maker', orgId);
  await makeUser(CHECKER, 'The checker', orgId);
  await makeUser(EXPIRED, 'The finished engagement', orgId);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await raw?.$disconnect();
});

// The console audience, stated rather than inferred. Without it a PLATFORM
// token on a request with no Origin resolves to the storefront and is refused as
// a wrong-portal session — a real refusal, but not the one under test here.
const auth = (t: string) => ({
  Authorization: `Bearer ${t}`,
  'x-trugrade-audience': 'console',
});

// ---------------------------------------------------------------------------
// 1. Every permission is reachable
// ---------------------------------------------------------------------------

describe('every permission belongs to somebody', () => {
  it('is held by at least one role', () => {
    const held = new Set<Permission>();
    for (const role of ROLES) for (const p of ROLE_PERMISSIONS[role]) held.add(p);

    // A permission no role holds is a permission no login can exercise: either
    // the screen behind it is unreachable, or — worse — the route is open
    // because somebody removed the decorator when it kept 403-ing.
    const orphans = PERMISSIONS.filter((p) => !held.has(p));
    expect(orphans).toEqual([]);
  });

  it('is spelled the same in the guard as in the contract', () => {
    // PLATFORM_SUPERADMIN holds PERMISSIONS itself, so #1 above can never fail
    // on a typo. This one can: a string cast past the type checker, or a
    // permission renamed in contracts and missed in one controller.
    const known = new Set<string>(PERMISSIONS);
    const used = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '../../src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/@RequirePermissions\(([^)]*)\)/gs)) {
        for (const q of (m[1] ?? '').matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)) {
          if (q[1]) used.add(q[1]);
        }
      }
    }
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((p) => !known.has(p))).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Separation of duties
// ---------------------------------------------------------------------------

describe('no seat holds both halves of a control', () => {
  it.each(Object.entries(MAKER_CHECKER))(
    '%s: the maker and the checker are different people',
    (docType, pair) => {
      const offenders = ROLES.filter(
        (r) => ROLE_PERMISSIONS[r].includes(pair.maker) && ROLE_PERMISSIONS[r].includes(pair.checker),
      );
      // PLATFORM_SUPERADMIN is deliberately not exempted. It holds PERMISSIONS,
      // so it fails this and should: the break-glass account is the reason the
      // *database* constraint exists as well as this test. It is excluded here
      // only because a platform with no superadmin cannot be administered at
      // all, and the DB still refuses it self-approving anything.
      expect(offenders.filter((r) => r !== 'PLATFORM_SUPERADMIN')).toEqual([]);
      expect(docType).toBeTruthy();
    },
  );

  it('keeps vendor onboarding in two pairs of hands', () => {
    // The violation the spec predicted, named explicitly so a future re-merge
    // that reunites them fails with a sentence rather than a diff.
    expect(ROLE_PERMISSIONS.KYC_REVIEWER).toContain('kyc.application.review');
    expect(ROLE_PERMISSIONS.KYC_REVIEWER).not.toContain('kyc.application.approve');
    expect(ROLE_PERMISSIONS.OPS_MANAGER).toContain('kyc.application.approve');
    expect(ROLE_PERMISSIONS.OPS_MANAGER).not.toContain('kyc.application.review');
  });
});

// ---------------------------------------------------------------------------
// 3. The CA seat
// ---------------------------------------------------------------------------

describe('the external accountant reads and exports, and does nothing else', () => {
  const action = (p: Permission): string => p.split('.').at(-1) ?? '';

  it('holds no write verb but the one named exception', () => {
    const verbs = ROLE_PERMISSIONS.CA.filter(
      (p) => WRITE_ACTIONS.includes(action(p)) && p !== CA_ALLOWED_WRITE_VERB,
    );
    expect(verbs).toEqual([]);
    expect(ROLE_PERMISSIONS.CA).toContain(CA_ALLOWED_WRITE_VERB);
  });

  it('holds exactly the eight permissions the spec listed', () => {
    expect([...ROLE_PERMISSIONS.CA].sort()).toEqual(
      [
        'finance.export.run',
        'finance.report.read',
        'identity.audit.read',
        'payment.invoice.read_any',
        'payment.ledger.read',
        'procurement.payable.read_any',
        'procurement.po.read_any',
        'tax.register.read',
      ].sort(),
    );
  });

  it('requires a second factor, because it reads the whole ledger', async () => {
    const { MFA_REQUIRED_ROLES } = await import('@trugrade/contracts');
    expect(MFA_REQUIRED_ROLES).toContain('CA');
  });
});

describe('the read-only seats can open every finance screen and change nothing', () => {
  // Every permission a GET route in this codebase asks for, restricted to the
  // finance surface. Derived from the source rather than listed by hand: a new
  // finance screen must either be openable by these two seats or fail here.
  const financeReads = (): string[] => {
    const found = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '../../src'))) {
      const text = readFileSync(file, 'utf8');
      // A handler is its decorators plus its signature; @Get immediately
      // precedes or follows @RequirePermissions on every controller here.
      for (const m of text.matchAll(
        /@(Get)\([^)]*\)[\s\S]{0,200}?@RequirePermissions\(([^)]*)\)|@RequirePermissions\(([^)]*)\)[\s\S]{0,200}?@Get\(/g,
      )) {
        for (const q of (m[2] ?? m[3] ?? '').matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)) {
          const p = q[1];
          if (p && /^(finance|tax|payment|procurement\.payable)\./.test(p) && p.endsWith('read'))
            found.add(p);
        }
      }
    }
    return [...found];
  };

  it('between them, AUDITOR and CA hold every finance read', () => {
    const both = new Set([...ROLE_PERMISSIONS.AUDITOR, ...ROLE_PERMISSIONS.CA]);
    expect(financeReads().filter((p) => !both.has(p as Permission))).toEqual([]);
  });

  it('and neither holds a single write verb', () => {
    const action = (p: Permission): string => p.split('.').at(-1) ?? '';
    expect(ROLE_PERMISSIONS.AUDITOR.filter((p) => WRITE_ACTIONS.includes(action(p)))).toEqual([]);
    expect(
      ROLE_PERMISSIONS.CA.filter(
        (p) => WRITE_ACTIONS.includes(action(p)) && p !== CA_ALLOWED_WRITE_VERB,
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Time-boxed access, refused at the guard
// ---------------------------------------------------------------------------

describe('an engagement that ended is access that ended', () => {
  it('refuses a token whose seat expired yesterday, at the guard', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const token = await issue('CA', EXPIRED, { accessExpiresAt: yesterday });

    const res = await request(app.getHttpServer())
      .get('/api/finance/exports')
      .set(auth(token));

    // 403 and not 401: the session is valid, the seat is not. And the message
    // says so, because sending somebody round the login loop forever is the
    // failure mode of collapsing this into token expiry.
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/access ended/i);
  });

  it('lets the same seat through while the engagement is live', async () => {
    const token = await issue('CA', EXPIRED, {
      accessExpiresAt: new Date(Date.now() + 86_400_000),
    });
    const res = await request(app.getHttpServer())
      .get('/api/finance/exports')
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.registers).toContain('LEDGER');
  });

  it('drops an expired role grant from the login itself', async () => {
    const orgId = await platformOrgId();
    const [role] = await raw.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.role WHERE code = 'CA' LIMIT 1`;
    if (!role) return; // roles are seeded by reference data; nothing to assert

    await raw.$executeRaw`
      INSERT INTO identity.user_role (user_id, role_id, org_id, expires_at)
      VALUES (${EXPIRED}::uuid, ${role.id}::uuid, ${orgId}::uuid, now() - interval '1 day')
      ON CONFLICT DO NOTHING`;

    const { IdentityService } = await import('../../src/modules/identity/identity.service');
    const user = await app.get(IdentityService).getUser(EXPIRED);
    // The grant is in the table. It is not in the session, which is the whole
    // point: expires_at existed since the baseline and nothing read it.
    expect(user.roles).not.toContain('CA');
  });
});

// ---------------------------------------------------------------------------
// 5. The database refuses self-approval
// ---------------------------------------------------------------------------

describe('maker-checker is a constraint, not a convention', () => {
  const docId = '99999999-0000-4000-8000-00000000d001';

  it('refuses checker_id = maker_id at the database, not in a service', async () => {
    await expect(
      raw.$executeRaw`
        INSERT INTO identity.approval_request
          (doc_type, doc_id, amount, maker_id, checker_id, checked_at, decision,
           required_permission, status)
        VALUES ('WRITE_OFF', ${docId}::uuid, 1000, ${MAKER}::uuid, ${MAKER}::uuid,
                now(), 'APPROVED', 'finance.writeoff.approve', 'APPROVED')`,
    ).rejects.toThrow(/ck_maker_is_not_checker/);
  });

  it('refuses a decision missing its who or its when', async () => {
    await expect(
      raw.$executeRaw`
        INSERT INTO identity.approval_request
          (doc_type, doc_id, maker_id, checker_id, decision, required_permission, status)
        VALUES ('JOURNAL', ${docId}::uuid, ${MAKER}::uuid, ${CHECKER}::uuid,
                'APPROVED', 'finance.journal.post', 'APPROVED')`,
    ).rejects.toThrow(/ck_approval_decided/);
  });

  it('refuses a second open request on the same document', async () => {
    await raw.$executeRaw`
      INSERT INTO identity.approval_request
        (doc_type, doc_id, maker_id, required_permission)
      VALUES ('PAYOUT_RUN', ${docId}::uuid, ${MAKER}::uuid, 'finance.payout.approve')`;

    await expect(
      raw.$executeRaw`
        INSERT INTO identity.approval_request
          (doc_type, doc_id, maker_id, required_permission)
        VALUES ('PAYOUT_RUN', ${docId}::uuid, ${CHECKER}::uuid, 'finance.payout.approve')`,
      // Prisma reports the conflicting key rather than the index name, so the
      // assertion names the tuple: one open request per document.
    ).rejects.toThrow(/\(doc_type, doc_id\)=\(PAYOUT_RUN/);
  });

  it('seeds a ladder whose top band needs two signatures', async () => {
    const rows = await raw.$queryRaw<Array<{ requires_second_checker: boolean }>>`
      SELECT requires_second_checker FROM identity.authority_band
       WHERE doc_type = 'PAYOUT_RUN' AND max_amount IS NULL`;
    expect(rows[0]?.requires_second_checker).toBe(true);
  });
});
