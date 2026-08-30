import * as React from 'react';
import type { Permission } from '@trugrade/contracts';
import { AuditLogRoute } from './AuditLog';
import { ConfigRoute } from './Config';
import { FlagsRoute } from './Flags';
import { FinanceConsoleRoute } from '../finance/Console';

/**
 * The platform-administration and finance routes, as data — T40 and T41.
 *
 * An array rather than JSX in `App.tsx`, following `routes/qc`: the orchestrator
 * wires every lane's routes at the end, and a lane that hand-edits that file is
 * a lane that conflicts with the other three. The elements come back bare;
 * guarding and chroming them is the shell's business.
 *
 * `label` is what puts an entry in the navigation rail. All four have one — none
 * of these is a detail screen reached from a board.
 *
 * `permission` is the one the API actually checks, restated here so the nav
 * cannot drift from the route. Two entries in this console have already been
 * gated on strings that are not in `ROLE_PERMISSIONS` at all, which made the
 * screens behind them invisible to every account ever issued.
 */
export interface PlatformRoute {
  path: string;
  label: string;
  permission: Permission;
  group: string;
  element: React.ReactElement;
}

export const platformRoutes: readonly PlatformRoute[] = [
  // T40. `payment.ledger.read` and not `payment.invoice.read_any`: the latter
  // also reaches OPS_MANAGER and SUPPORT, who look up a buyer's invoice on a
  // ticket and have no business with the vendor payout stack. FINANCE, AUDITOR
  // and PLATFORM_SUPERADMIN hold this one, which is the room this screen is for.
  {
    path: '/finance',
    label: 'Finance',
    permission: 'payment.ledger.read',
    group: 'Money',
    element: React.createElement(FinanceConsoleRoute),
  },
  // T41. `platform.config.write` guards a READ because §3C.7 gives the screen to
  // ADMIN_SUPER alone and that permission is held by exactly PLATFORM_SUPERADMIN.
  // There is no `platform.config.read` to gate it on.
  {
    path: '/platform/config',
    label: 'Configuration',
    permission: 'platform.config.write',
    group: 'Platform',
    element: React.createElement(ConfigRoute),
  },
  {
    path: '/platform/flags',
    label: 'Flags & templates',
    permission: 'platform.config.write',
    group: 'Platform',
    element: React.createElement(FlagsRoute),
  },
  // `identity.audit.read`, which AUDITOR, DPO, FINANCE, OPS_MANAGER and
  // KYC_REVIEWER hold — a wider room than the two above, deliberately: §3C.7
  // gives the viewer to ADMIN_AUDIT and ADMIN_SUPER, and an auditor who cannot
  // read the audit log is not an auditor.
  {
    path: '/platform/audit-log',
    label: 'Audit log',
    permission: 'identity.audit.read',
    group: 'Platform',
    element: React.createElement(AuditLogRoute),
  },
];
