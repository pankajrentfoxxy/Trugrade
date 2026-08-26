import * as React from 'react';
import type { Permission } from '@trugrade/contracts';
import { AuditRecheckRoute } from './AuditRecheck';
import { GradeCorrectionsRoute } from './GradeCorrections';
import { ManualInspectionRoute } from './ManualInspection';
import { SamplingRulesRoute } from './SamplingRules';
import { ScheduleRoute } from './Schedule';
import { ToolProvidersRoute } from './ToolProviders';
import { VisitBoardRoute } from './VisitBoard';
import { VisitDetailRoute } from './VisitDetail';

/**
 * The QC console's routes, for the orchestrator to wire into `App.tsx`.
 *
 * A plain array rather than JSX so the app shell keeps deciding how a route is
 * wrapped — `RequirePermission` and `Shell` are its business, not this lane's.
 * `permission` is the string to guard with; `label` is present only on the
 * entries that belong in the header, which is why the two detail routes and the
 * inspection form omit it.
 *
 * The permissions come from `ROLE_PERMISSIONS` in `@trugrade/contracts`, and the
 * split is the one that already exists there: a TECHNICIAN holds `qc.visit.read`
 * and `qc.visit.execute`, so they get the board, a visit and the inspection form.
 * Everything administrative sits behind a permission only QC_MANAGER holds.
 *
 * One gap worth naming rather than papering over: **there is no
 * `qc.tool_provider.write` permission.** Tool-provider administration is guarded
 * with `qc.report.ingest` — the closest existing permission, held by QC_MANAGER
 * alone, and the one that actually describes what a field map governs. If that
 * reads wrong, the fix is a new permission in `contracts/roles.ts`, which this
 * lane does not own.
 */

export interface ConsoleRoute {
  path: string;
  element: React.ReactElement;
  /**
   * Guard with `RequirePermission`.
   *
   * The closed union out of `@trugrade/contracts`, not `string`: a permission
   * that is not in `ROLE_PERMISSIONS` matches no principal the API will ever
   * issue, so the screen behind it is simply unreachable and nothing says so at
   * runtime. Two nav entries elsewhere in the console were dead for exactly that
   * reason. Here it is a compile error instead.
   */
  permission: Permission;
  /** Present only where the route belongs in the header navigation. */
  label?: string;
}

export const qcRoutes: ConsoleRoute[] = [
  {
    path: '/qc/visits',
    element: React.createElement(VisitBoardRoute),
    permission: 'qc.visit.read',
    label: 'QC visits',
  },
  {
    path: '/qc/schedule',
    element: React.createElement(ScheduleRoute),
    permission: 'qc.visit.schedule',
    label: 'Scheduling',
  },
  {
    path: '/qc/visits/:visitId',
    element: React.createElement(VisitDetailRoute),
    permission: 'qc.visit.read',
  },
  {
    path: '/qc/visits/:visitId/inspect',
    element: React.createElement(ManualInspectionRoute),
    permission: 'qc.visit.execute',
  },
  {
    path: '/qc/grade-corrections',
    element: React.createElement(GradeCorrectionsRoute),
    permission: 'qc.report.read',
    label: 'Grade corrections',
  },
  {
    path: '/qc/audit',
    element: React.createElement(AuditRecheckRoute),
    permission: 'qc.audit.recheck',
    label: 'Audit rechecks',
  },
  {
    path: '/qc/sampling-rules',
    element: React.createElement(SamplingRulesRoute),
    permission: 'qc.sampling.write',
    label: 'Sampling rules',
  },
  {
    path: '/qc/tool-providers',
    element: React.createElement(ToolProvidersRoute),
    permission: 'qc.report.ingest',
    label: 'Tool providers',
  },
];

export {
  AuditRecheckRoute,
  GradeCorrectionsRoute,
  ManualInspectionRoute,
  SamplingRulesRoute,
  ScheduleRoute,
  ToolProvidersRoute,
  VisitBoardRoute,
  VisitDetailRoute,
};
