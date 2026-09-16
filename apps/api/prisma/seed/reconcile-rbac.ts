/**
 * Bring `identity.role_permission` back in step with `ROLE_PERMISSIONS`.
 *
 * `seedRbac` only ever INSERTs — `ON CONFLICT DO NOTHING` — which is right for a
 * seed and wrong for a deploy that takes a permission away. Stage 7 moved
 * `kyc.application.approve` off KYC_REVIEWER and `kyc.application.review` off
 * OPS_MANAGER, and an insert-only seed leaves both grants sitting in the table.
 *
 * **The stale row is not a security hole today**, and it is worth being precise
 * about why: a session's permissions come from `permissionsFor(roles)` in
 * `@trugrade/contracts`, resolved at login in `IdentityService.getUser` — the
 * database table is not read on the authorisation path. So the guard is already
 * correct the moment the API restarts.
 *
 * It is still worth fixing, because the table is what a person reads when they
 * ask "what can this seat do", and a table that disagrees with the code is a
 * table that will be believed at exactly the wrong moment.
 *
 * Run with the production DATABASE_URL. Idempotent, and it prints what it did
 * rather than exiting silently.
 */
import { PrismaClient } from '@prisma/client';
import { ROLES, ROLE_PERMISSIONS, ROLE_SCOPE, PERMISSIONS } from '@trugrade/contracts';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const code of PERMISSIONS) {
      // The live table is (code, module, description, is_sensitive) — NOT the
      // (code, description, is_dangerous) shape `reference.ts` writes. The two
      // have drifted, which is worth knowing: `seedRbac` would fail against
      // production today. Written here against the columns that actually exist.
      const module = code.split('.')[0] ?? 'platform';
      await prisma.$executeRaw`
        INSERT INTO identity.permission (code, module, description, is_sensitive)
        VALUES (${code}, ${module}, ${code},
                ${/\.(post|issue|approve|run|override|write|handle|delete)$/.test(code)})
        ON CONFLICT (code) DO NOTHING`;
    }

    let newRoles = 0;
    for (const role of ROLES) {
      newRoles += await prisma.$executeRaw`
        INSERT INTO identity.role (code, scope, description)
        VALUES (${role}, ${ROLE_SCOPE[role] === 'PLATFORM' ? 'PLATFORM' : 'ORG'}, ${role})
        ON CONFLICT (code) DO NOTHING`;
    }

    let granted = 0;
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        granted += await prisma.$executeRaw`
          INSERT INTO identity.role_permission (role_id, permission_id)
          SELECT r.id, p.id FROM identity.role r, identity.permission p
           WHERE r.code = ${role} AND p.code = ${permission}
          ON CONFLICT DO NOTHING`;
      }
    }

    // The half a seed cannot do. Deleted per role, from the contract's own list,
    // so a role the contract does not mention is left completely alone.
    let revoked = 0;
    for (const role of ROLES) {
      const held = [...ROLE_PERMISSIONS[role]];
      const removed = await prisma.$queryRaw<Array<{ code: string }>>`
        DELETE FROM identity.role_permission rp
         USING identity.role r, identity.permission p
         WHERE rp.role_id = r.id AND rp.permission_id = p.id
           AND r.code = ${role}
           AND NOT (p.code = ANY(${held}::text[]))
        RETURNING p.code`;
      for (const row of removed) {
        console.log(`  revoked ${role} → ${row.code}`);
        revoked += 1;
      }
    }

    console.log(`roles added ${newRoles}, grants added ${granted}, grants revoked ${revoked}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
