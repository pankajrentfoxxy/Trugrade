import { CUSTOMER_ROLES, ROLE_PERMISSIONS, type Permission } from '@trugrade/contracts';
import type { PermissionMark } from '@trugrade/ui';

/**
 * What each buyer role may do, read off `ROLE_PERMISSIONS` rather than typed
 * here: a matrix in the browser that disagrees with the one the guards enforce
 * is how a screen comes to promise a power that then 403s.
 */

export const TEAM_ROLE_COLUMNS = [
  'Owner',
  'Admin',
  'Buyer',
  'Approver',
  'Finance',
  'Viewer',
] as const;

export const ROLE_COLUMN_INDEX: Record<string, number> = Object.fromEntries(
  CUSTOMER_ROLES.map((role, i) => [role, i]),
);

/** Capability, in a buyer's words, and the permission the API checks for it. */
const CAPABILITIES: ReadonlyArray<[string, Permission]> = [
  ['Browse the catalogue', 'catalog.sku.read'],
  ['Build a cart and check out', 'ordering.cart.write'],
  ['Place orders', 'ordering.order.create'],
  ['Approve or reject orders', 'ordering.order.approve'],
  ['See every order on the account', 'ordering.own.read'],
  ['Read tax invoices', 'payment.invoice.read_own'],
  ['Raise returns and warranty claims', 'platform.ticket.write'],
  ['See the team', 'identity.user.read'],
  ['Change roles and switch accounts off', 'identity.role.assign'],
  ['Invite team members', 'identity.team.manage'],
];

export const CAPABILITY_MATRIX: readonly { capability: string; marks: readonly PermissionMark[] }[] =
  CAPABILITIES.map(([capability, permission]) => ({
    capability,
    marks: CUSTOMER_ROLES.map((role) =>
      ROLE_PERMISSIONS[role].includes(permission) ? 'full' : 'none',
    ),
  }));

/** The roles an owner may invite. An owner is promoted, never invited. */
export const ROLE_OPTIONS = [
  {
    value: 'CUSTOMER_ADMIN',
    label: 'Admin',
    description: 'Places orders and manages the team, but cannot approve orders.',
  },
  {
    value: 'CUSTOMER_BUYER',
    label: 'Buyer',
    description: 'Builds carts and places orders. Cannot approve their own.',
  },
  {
    value: 'CUSTOMER_APPROVER',
    label: 'Approver',
    description: 'Approves or rejects orders that need a signature. Cannot place them.',
  },
  {
    value: 'CUSTOMER_FINANCE',
    label: 'Finance',
    description: 'Reads orders and tax invoices, and raises returns and claims.',
  },
  {
    value: 'CUSTOMER_VIEWER',
    label: 'Viewer',
    description: 'Reads the catalogue and the account’s orders. Changes nothing.',
  },
] as const;

/** Every customer role, so no real role falls through to its code. */
export const ROLE_LABEL: Record<string, string> = {
  CUSTOMER_OWNER: 'Account owner',
  CUSTOMER_ADMIN: 'Admin',
  CUSTOMER_BUYER: 'Buyer',
  CUSTOMER_APPROVER: 'Approver',
  CUSTOMER_FINANCE: 'Finance',
  CUSTOMER_VIEWER: 'Viewer',
};
