/**
 * Stage 5 — a rail and a set of controls that tell the truth about permissions.
 *
 * `shell/nav.ts` had no permission field and the rail rendered all eight entries
 * for all six customer roles. Three screens handled their own refusal well; six
 * paths rendered a control that 403s on submit, and the sharpest was the address
 * book — a `CUSTOMER_BUYER` could add a delivery site and then not edit the one
 * they had just added, with nothing on screen saying so.
 *
 * The sweep below is role × control rather than role × screen: what matters is
 * not that a screen renders, but that **no enabled control would be refused by
 * its own endpoint**. Each control is paired here with the permission its
 * handler actually checks, read off the `@RequirePermissions` decorator.
 */
import { permissionsFor, type Role } from '@trugrade/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORTAL_NAV, mayOpen } from './shell/nav';

const CUSTOMER_ROLES = [
  'CUSTOMER_OWNER',
  'CUSTOMER_ADMIN',
  'CUSTOMER_BUYER',
  'CUSTOMER_APPROVER',
  'CUSTOMER_FINANCE',
  'CUSTOMER_VIEWER',
] as const;

const held = (role: string): string[] => [...permissionsFor([role as Role])];

const read = (...p: string[]): string => readFileSync(join(__dirname, ...p), 'utf8');

/**
 * Whether a screen gates on a permission at all.
 *
 * Two honest spellings: read it inline, or name it in a table the screen filters
 * with `session.permissions`. What is NOT a gate is naming it in a comment, so
 * both halves have to be present.
 */
const gatesOn = (source: string, permission: string): boolean =>
  source.includes(`session.permissions.includes('${permission}')`) ||
  (source.includes(`'${permission}'`) && source.includes('session.permissions.includes('));

/**
 * Every write control the portal renders, and the permission its endpoint checks.
 *
 * `guardedBy` is the expression the screen must gate on. A control missing from
 * this table is one nobody has checked; a control here whose file does not
 * mention its permission is one that would 403 on submit.
 */
const CONTROLS = [
  {
    what: 'Confirm receipt of a delivery, and the seal scan box',
    file: ['orders', '[orderNumber]', 'delivery', 'DeliveryCheck.tsx'],
    permission: 'platform.ticket.write',
  },
  {
    what: 'Send a machine back',
    file: ['returns', 'ReturnsBoard.tsx'],
    permission: 'platform.ticket.write',
  },
  {
    what: 'Start a warranty claim',
    file: ['warranty', 'WarrantyBoard.tsx'],
    permission: 'platform.ticket.write',
  },
  {
    what: 'Add a delivery site, and edit one',
    file: ['addresses', 'AddressBook.tsx'],
    permission: 'ordering.order.create',
  },
  {
    what: 'The order Documents tab',
    file: ['orders', '[orderNumber]', 'OrderNav.tsx'],
    permission: 'payment.invoice.read_own',
  },
  {
    what: 'Invite and manage team members',
    file: ['team', 'TeamBoard.tsx'],
    permission: 'identity.team.manage',
  },
] as const;

/* ==========================================================================
 * 1. The rail
 * ======================================================================== */

describe('the rail', () => {
  it('names only permissions the contract actually carries', () => {
    // This check caught two dead nav entries on the console side. It is cheap
    // and it works: a permission the union does not carry can never be held.
    const everyPermission = new Set(held('PLATFORM_SUPERADMIN'));
    for (const entry of PORTAL_NAV) {
      if (entry.permission) expect(everyPermission.has(entry.permission)).toBe(true);
    }
  });

  it('shows every entry to every role, locking rather than hiding what they cannot open', () => {
    for (const role of CUSTOMER_ROLES) {
      // Eight entries, always. Somebody who cannot find a screen files a
      // ticket; somebody who can see it is not theirs does not.
      expect(PORTAL_NAV).toHaveLength(8);
      const openable = PORTAL_NAV.filter((n) => mayOpen(n, held(role)));
      expect(openable.length).toBeGreaterThan(0);
    }
  });

  it('locks exactly the entries a viewer cannot open', () => {
    const viewer = held('CUSTOMER_VIEWER');
    const locked = PORTAL_NAV.filter((n) => !mayOpen(n, viewer)).map((n) => n.label);
    // A viewer holds `ordering.own.read` but no `identity.user.read`.
    expect(locked).toEqual(['Team']);
  });

  it('lets an owner open everything', () => {
    const owner = held('CUSTOMER_OWNER');
    expect(PORTAL_NAV.filter((n) => !mayOpen(n, owner))).toEqual([]);
  });
});

/* ==========================================================================
 * 2. Every write control is gated on its own endpoint's permission
 * ======================================================================== */

describe('the write controls', () => {
  it.each(CONTROLS)('$what is gated on $permission', ({ file, permission }) => {
    const source = read(...file);
    // The screen must read this permission off the session, the way TeamBoard
    // does — rendering the control unconditionally is what produced the 403 on
    // submit. Either spelling counts: a direct `includes('x')`, or the
    // permission named in a table the screen then filters on.
    expect(gatesOn(source, permission)).toBe(true);
  });

  it('covers the role × control sweep, and reports its size', () => {
    const combinations: string[] = [];
    const refused: string[] = [];
    for (const role of CUSTOMER_ROLES) {
      const permissions = held(role);
      for (const c of CONTROLS) {
        combinations.push(`${role}×${c.what}`);
        const source = read(...c.file);
        const gated = gatesOn(source, c.permission);
        const allowed = permissions.includes(c.permission);
        // The defect this sweep exists to catch: a control that renders for a
        // seat whose endpoint would refuse it.
        if (!allowed && !gated) refused.push(`${role} would be refused by ${c.what}`);
      }
    }
    expect(combinations).toHaveLength(CUSTOMER_ROLES.length * CONTROLS.length);
    expect(refused).toEqual([]);
  });
});

/* ==========================================================================
 * 3. A panel that vanishes reads as a bug
 * ======================================================================== */

describe('a seat refused a read', () => {
  it('is told so on the home team panel, rather than shown nothing', () => {
    const source = read('home', 'Home.tsx');
    expect(source).toContain('The team list is not on this seat');
    // The bare `if (!team) return null` that made the section disappear.
    expect(source).not.toMatch(/if \(!team\) return null;/);
  });
});

/* ==========================================================================
 * 4. A granted permission that opens nothing
 * ======================================================================== */

describe('platform.ticket.read', () => {
  it('is no longer granted to a customer seat, because it opened nothing', () => {
    // No route in the API guards on it, and there is no support screen under
    // the buyer portal. It stays on the platform and vendor roles, where the
    // ops dashboard reads it and an integration test pins that it is in scope.
    for (const role of CUSTOMER_ROLES) {
      expect(held(role)).not.toContain('platform.ticket.read');
    }
    expect(held('OPS_MANAGER')).toContain('platform.ticket.read');
    expect(held('VENDOR_OWNER')).toContain('platform.ticket.read');
  });

  it('took the button that implied a support thread with it', () => {
    // "Add something to this return" was the one amber action on the record and
    // it went to a policy page. A settled case keeps its real escalation.
    // Both records are now one component, so the assertion is about that one.
    const shared = read('cases', 'CaseRecord.tsx');
    expect(shared).toContain('Dispute this outcome');
    // And it is a secondary control, not the screen's one amber action.
    expect(shared).toContain(String.raw`pill wire crside-a" href="/legal/grievance"`);
    for (const f of [
      ['returns', '[returnNumber]', 'ReturnRecord.tsx'],
      ['warranty', 'claims', '[claimNumber]', 'ClaimRecord.tsx'],
    ] as const) {
      expect(read(...f)).not.toMatch(/Add something to this/);
    }
  });
});
