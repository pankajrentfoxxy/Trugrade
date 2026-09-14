import type { PermissionMark } from '@trugrade/ui';

/** Stage 5.2 — capability matrix; this IS the documentation. */
export const TEAM_ROLE_COLUMNS = ['Owner', 'Operations', 'Finance', 'Warehouse'] as const;

export const VENDOR_ROLE_COLUMN_INDEX: Record<string, number> = {
  VENDOR_OWNER: 0,
  VENDOR_ADMIN: 1,
  VENDOR_FINANCE: 2,
  VENDOR_VIEWER: 3,
};

export const CAPABILITY_MATRIX: readonly {
  capability: string;
  marks: readonly PermissionMark[];
  mfa?: boolean;
}[] = [
  { capability: 'View listings', marks: ['full', 'full', 'full', 'full'] },
  { capability: 'Create and edit listings', marks: ['full', 'full', 'none', 'none'] },
  { capability: 'Change price', marks: ['full', 'limited', 'none', 'none'] },
  { capability: 'Request an inspection', marks: ['full', 'full', 'none', 'limited'] },
  { capability: 'Respond to grade correction', marks: ['full', 'full', 'none', 'none'] },
  { capability: 'Accept or reject a PO', marks: ['full', 'full', 'none', 'limited'] },
  { capability: 'Pick list and dispatch', marks: ['full', 'full', 'none', 'full'] },
  { capability: 'View payables and payouts', marks: ['full', 'none', 'full', 'none'], mfa: true },
  { capability: 'Edit bank details', marks: ['full', 'none', 'none', 'none'], mfa: true },
  { capability: 'Manage team', marks: ['full', 'none', 'none', 'none'], mfa: true },
  { capability: 'Sign agreements', marks: ['full', 'none', 'none', 'none'], mfa: true },
];

export const ROLE_OPTIONS = [
  {
    value: 'VENDOR_ADMIN',
    label: 'Operations Manager',
    description: 'Listings, POs, inspections and day-to-day fulfilment.',
  },
  {
    value: 'VENDOR_FINANCE',
    label: 'Finance',
    description: 'Payables, payouts and invoice uploads. Two-factor required.',
  },
  {
    value: 'VENDOR_VIEWER',
    label: 'Warehouse',
    description: 'Pick, dispatch and site-scoped PO actions.',
  },
] as const;

export const ROLE_LABEL: Record<string, string> = {
  VENDOR_OWNER: 'Owner',
  VENDOR_ADMIN: 'Operations Manager',
  VENDOR_FINANCE: 'Finance',
  VENDOR_VIEWER: 'Warehouse',
};

export const MFA_ROLES = new Set(['VENDOR_OWNER', 'VENDOR_FINANCE']);
