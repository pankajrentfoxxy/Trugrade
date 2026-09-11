import type { TeamMember, TeamRole } from './usersApi';

const MODULE_LABEL: Record<string, string> = {
  catalog: 'Catalog',
  identity: 'Identity',
  kyc: 'KYC',
  listing: 'Listing',
  logistics: 'Logistics',
  ordering: 'Ordering',
  payment: 'Payment',
  platform: 'Platform',
  procurement: 'Procurement',
  qc: 'QC',
};

export interface PermissionOption {
  code: string;
  module: string;
  moduleLabel: string;
  /** Roles in this org that grant the permission. */
  grantedBy: string[];
}

/** Every permission any org role may grant, deduplicated and sorted. */
export function permissionCatalog(roles: readonly TeamRole[]): PermissionOption[] {
  const map = new Map<string, PermissionOption>();
  for (const role of roles) {
    for (const code of role.permissions) {
      const module = code.split('.')[0] ?? code;
      const existing = map.get(code);
      if (existing) {
        existing.grantedBy.push(role.code);
      } else {
        map.set(code, {
          code,
          module,
          moduleLabel: MODULE_LABEL[module] ?? module,
          grantedBy: [role.code],
        });
      }
    }
  }
  return [...map.values()].sort((a, b) =>
    a.module === b.module ? a.code.localeCompare(b.code) : a.module.localeCompare(b.module),
  );
}

/** Union of permissions from the member's current roles. */
export function memberPermissions(
  member: TeamMember,
  roles: readonly TeamRole[],
): string[] {
  const byCode = new Map(roles.map((r) => [r.code, r] as const));
  const out = new Set<string>();
  for (const code of member.roles) {
    byCode.get(code)?.permissions.forEach((p) => out.add(p));
  }
  return [...out].sort();
}

export function permissionsByModule(
  options: readonly PermissionOption[],
): ReadonlyArray<{ module: string; label: string; permissions: PermissionOption[] }> {
  const groups = new Map<string, PermissionOption[]>();
  for (const option of options) {
    const list = groups.get(option.module) ?? [];
    list.push(option);
    groups.set(option.module, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, permissions]) => ({
      module,
      label: MODULE_LABEL[module] ?? module,
      permissions,
    }));
}
