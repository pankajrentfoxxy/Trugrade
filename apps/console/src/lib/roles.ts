/**
 * Role code -> what a human calls it, for every role in the system.
 *
 * Shared because `platform/Users.tsx` (roles on a board) and `shell/OpsShell.tsx`
 * (the signed-in seat's role in the masthead) both need the same word for the
 * same code, and two copies is how they drift.
 */
export const ROLE_LABEL: Record<string, string> = {
  PLATFORM_SUPERADMIN: 'Super admin',
  OPS_MANAGER: 'Operations',
  KYC_REVIEWER: 'KYC reviewer',
  CATALOG_ADMIN: 'Catalog',
  PRICING_ADMIN: 'Pricing',
  QC_MANAGER: 'QC manager',
  TECHNICIAN: 'Technician',
  LOGISTICS_MANAGER: 'Logistics',
  RIDER: 'Rider',
  FINANCE: 'Finance',
  SUPPORT: 'Support',
  AUDITOR: 'Auditor',
  DPO: 'DPO',
  VENDOR_OWNER: 'Owner',
  VENDOR_ADMIN: 'Admin',
  VENDOR_OPS: 'Operations',
  VENDOR_FINANCE: 'Finance',
  VENDOR_VIEWER: 'Viewer',
  CUSTOMER_OWNER: 'Account owner',
  CUSTOMER_ADMIN: 'Admin',
  CUSTOMER_BUYER: 'Procurer',
  CUSTOMER_APPROVER: 'Approver',
  CUSTOMER_FINANCE: 'Finance',
  CUSTOMER_VIEWER: 'Viewer',
};

export const roleLabel = (code: string): string => ROLE_LABEL[code] ?? code;
