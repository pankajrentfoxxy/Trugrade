/* eslint-disable no-console -- this is a CLI script; console is the output */
import { PrismaClient } from '@prisma/client';
import {
  GRADE_CORRECTION_AUTO_APPLY_DAYS,
  INSPECTION_WINDOW_HOURS,
  OTP_POLICY,
  PAYOUT_MIN_THRESHOLD_INR,
  QC_EXPIRY_WARNING_DAYS,
  QC_GEO_VARIANCE_ALERT_METRES,
  QC_REPORT_VALIDITY_DAYS,
  RESERVATION_TTL_MINUTES,
  SEAL_CODE_PREFIX_DEFAULT,
  ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  ROLE_SCOPE,
} from '@trugrade/contracts';

const prisma = new PrismaClient();

/**
 * Reference seed.
 *
 * Everything ops might want to tune lives in `platform_config` with an effective
 * date, so changing a threshold is a config edit and not a deploy
 * (PHASE_10 Task 1). The values here are the documented defaults; where the pack
 * left a question open, `docs/DECISIONS_OPEN.md` records which way we went.
 */
const CONFIG: Array<[string, unknown, string]> = [
  // --- QC ------------------------------------------------------------------
  [
    'qc.report_validity_days',
    QC_REPORT_VALIDITY_DAYS,
    'Q16 — how long an inspection stays current',
  ],
  ['qc.expiry_warning_days', QC_EXPIRY_WARNING_DAYS, 'Warn the vendor this far ahead of expiry'],
  ['qc.min_units_per_visit', 25, 'Q4 — below this a visit fee applies'],
  ['qc.visit_fee_inr', 1500, 'Q4 — the visit fee'],
  ['qc.visit_fee_waiver_units', 50, 'Q4 — waived above this many units'],
  ['qc.fee_bearer', 'TRUETECH', 'Q4 — TRUETECH | VENDOR | SPLIT | WAIVED'],
  [
    'qc.geo_variance_alert_metres',
    QC_GEO_VARIANCE_ALERT_METRES,
    'Check-in this far from the facility is a signal',
  ],
  ['qc.audit_recheck_pct', 5, 'Share of units re-inspected by a second technician'],
  [
    'qc.grade_correction_auto_days',
    GRADE_CORRECTION_AUTO_APPLY_DAYS,
    'No vendor response after this many days auto-applies',
  ],
  ['qc.seal_code_prefix', SEAL_CODE_PREFIX_DEFAULT, 'Physical seal rolls are printed against this'],
  [
    'qc.mode_first_listing',
    'SUPERVISED',
    'Q15 — our QC expert attends a vendor first listing in person. One visit, per vendor.',
  ],
  [
    'qc.mode_steady_state',
    'VENDOR_SELF_SERVE',
    'Q15 — thereafter the vendor runs DeviceSure themselves on an activation key + USB agent.',
  ],
  [
    'qc.auto_approve_min_score',
    75,
    'Q15 — a score STRICTLY ABOVE this auto-approves the listing. Necessary, not sufficient: see the five gates below.',
  ],
  [
    'qc.auto_approve_block_on_fail',
    true,
    'A FAIL on a required area blocks whatever the aggregate says. 07 §3.1: a weighted mean of twelve components swallows one failure — eleven at 100 and one at 30 averages ~94, and the dead USB port disappears.',
  ],
  [
    'qc.auto_approve_block_on_not_measured',
    true,
    'An unmeasured required area is a material unknown we would be vouching for under CP e-Comm r.7(5). A missing value is not a passing value.',
  ],
  [
    'qc.auto_approve_require_grade_match',
    true,
    'Auto-listing at the vendor-declared grade when inspection found a different one is OUR misrepresentation under r.7(2), not theirs.',
  ],
  ['qc.auto_approve_require_seal', true, 'No seal, and no seal without a photograph.'],
  [
    'qc.auto_approve_require_serial_match',
    true,
    'serial_matches = FALSE is a hard stop: the label does not belong to the laptop.',
  ],
  [
    'qc.score_clustering_alert_band',
    5,
    'Q15 risk — publishing the threshold creates an incentive to hit exactly 76. Flags a vendor with an anomalous share of units landing in [75, 80) for 100% audit recheck.',
  ],
  [
    'qc.score_clustering_ratio_alert',
    2.5,
    'Observed-to-expected share in the band above which clustering is treated as gaming rather than chance.',
  ],
  [
    'qc.score_clustering_min_sample',
    20,
    'Never flag clustering on a small sample — the same honesty rule as the headline average.',
  ],
  [
    'qc.min_sample_for_headline',
    10,
    'Q23 — below this a supply point shows "New supplier · N units", never a percentage. CCPA Misleading Advertisements Guidelines 2022.',
  ],

  // --- ordering ------------------------------------------------------------
  [
    'ordering.inspection_window_hours',
    INSPECTION_WINDOW_HOURS,
    'Q5 — the r.7(4) take-back window, and the payout-eligibility clock',
  ],
  ['ordering.reservation_ttl_minutes', RESERVATION_TTL_MINUTES, 'Checkout stock hold'],
  [
    'ordering.approval_hold_ttl_hours',
    24,
    'Stock cannot be held indefinitely waiting for a manager',
  ],
  ['ordering.credit_enabled', false, 'Q10 — prepaid-only at pilot'],

  // --- tax -----------------------------------------------------------------
  [
    'tax.tds_applicable',
    true,
    'Q7 ANSWERED 26 Aug 2026 — TrueTech exceeded Rs 10 crore in FY 2025-26, so s.393(1) Table Sl. No. 8(ii) applies to our purchases. Getting this wrong costs 30% of the purchase value as disallowed expenditure.',
  ],
  ['tax.tds_vendor_threshold_inr', 5000000, 'Rs 50 lakh per vendor per financial year'],
  ['tax.tds_rate_pct', 0.1, '0.1% above the threshold'],
  ['tax.tds_rate_no_pan_pct', 5, '5% where the vendor has no valid PAN'],
  [
    'tax.einvoice_enabled',
    false,
    'Q8 — payload and numbering are built; generation is off until the CA confirms',
  ],
  [
    'tax.eway_bill_threshold_inr',
    50000,
    'Strictly greater than. Rs 50,000.00 exactly does not need one.',
  ],
  ['tax.gst_rate_laptop_pct', 18, 'HSN 8471'],

  // --- procurement ---------------------------------------------------------
  [
    'procurement.min_payout_threshold_inr',
    PAYOUT_MIN_THRESHOLD_INR,
    'Below this the balance rolls forward. Nobody wants a Rs 400 NEFT.',
  ],
  ['procurement.default_payout_cycle', 'T_PLUS_2', 'Q6 — requested by the vendor, granted by tier'],
  ['procurement.price_variance_tolerance_pct', 0.5, 'Three-way match price tolerance'],
  ['procurement.price_variance_tolerance_inr', 100, 'Whichever is greater'],

  // --- logistics -----------------------------------------------------------
  ['dispatch.rto_after_attempts', 3, 'Three failed attempts and a fourth cannot be recorded'],
  ['dispatch.ndr_response_window_hours', 36, 'Nearly every NDR unresolved inside this ends in RTO'],
  ['logistics.max_stops_per_route', 8, 'Enforced in the application, not only in config'],

  // --- identity ------------------------------------------------------------
  ['identity.otp_ttl_seconds', OTP_POLICY.ttlSeconds, 'VR-051'],
  ['identity.otp_max_verify_attempts', OTP_POLICY.maxVerifyAttempts, 'VR-052'],
  ['identity.otp_resend_cooldown_seconds', OTP_POLICY.resendCooldownSeconds, 'VR-053'],
  ['identity.kyc_sla_hours_vendor', 48, 'Working hours to a decision'],
  ['identity.kyc_sla_hours_buyer', 24, 'Working hours to a decision'],
  ['identity.document_max_age_days', 90, 'VR-072 — age-sensitive documents only'],

  // --- platform ------------------------------------------------------------
  ['platform.grievance_ack_hours', 48, 'CP e-Comm r.4(4) — acknowledge within 48 hours'],
  ['platform.grievance_redress_days', 30, 'CP e-Comm r.4(5) — redress within one month'],
  ['platform.warranty_top_up_months', 3, 'Q22 — vendor term plus this, floor 6 total'],
  ['platform.warranty_min_total_months', 6, 'Q22 — the floor we sell'],
  [
    'platform.sourcing_declaration_threshold_inr',
    50000,
    'Above this a supporting document is required',
  ],
];

async function seedConfig(): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;

  for (const [key, value, note] of CONFIG) {
    const [current] = await prisma.$queryRaw<
      Array<{ value_json: unknown; changed_by: string | null }>
    >`
      SELECT value_json, changed_by FROM platform.platform_config
      WHERE key = ${key} ORDER BY effective_from DESC LIMIT 1`;

    const desired = JSON.stringify(value);

    if (!current) {
      await prisma.$executeRaw`
        INSERT INTO platform.platform_config (key, value_json, description, effective_from)
        VALUES (${key}, ${desired}::jsonb, ${note}, now())
        ON CONFLICT (key, effective_from) DO NOTHING`;
      added++;
      continue;
    }

    if (JSON.stringify(current.value_json) === desired) continue;

    // The default changed — a decision was answered, or a threshold retuned.
    // Config is effective-dated, so that is a NEW row, never an overwrite: the
    // old value stays readable, which is what lets you explain a report produced
    // under the previous threshold.
    //
    // But only when nobody has edited it by hand. `changed_by` is set by the
    // admin config editor, and a seed re-run must never quietly revert an ops
    // decision made at 2am during an incident.
    if (current.changed_by !== null) {
      console.warn(
        `  ! ${key}: default is now ${desired} but the live value was set by a person. Left alone.`,
      );
      continue;
    }

    await prisma.$executeRaw`
      INSERT INTO platform.platform_config (key, value_json, description, effective_from)
      VALUES (${key}, ${desired}::jsonb, ${note}, now())
      ON CONFLICT (key, effective_from) DO NOTHING`;
    updated++;
  }

  return { added, updated };
}

/**
 * Roles and permissions, from the single matrix in `@trugrade/contracts`.
 *
 * Seeding from the same constant the guards read is what stops the database and
 * the code disagreeing about what a role can do — which is the kind of drift
 * nobody notices until an auditor asks.
 */
async function seedRbac(): Promise<{ roles: number; permissions: number; grants: number }> {
  for (const code of PERMISSIONS) {
    const [module] = code.split('.');
    await prisma.$executeRaw`
      INSERT INTO identity.permission (code, module, description, is_sensitive)
      VALUES (${code}, ${module}, ${code},
              ${/\.(post|issue|approve|run|override|write|handle|delete)$/.test(code)})
      ON CONFLICT (code) DO NOTHING`;
  }

  for (const role of ROLES) {
    await prisma.$executeRaw`
      INSERT INTO identity.role (code, scope, description)
      VALUES (${role}, ${ROLE_SCOPE[role] === 'PLATFORM' ? 'PLATFORM' : 'ORG'}, ${role})
      ON CONFLICT (code) DO NOTHING`;
  }

  let grants = 0;
  for (const role of ROLES) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      const n = await prisma.$executeRaw`
        INSERT INTO identity.role_permission (role_id, permission_id)
        SELECT r.id, p.id
        FROM identity.role r, identity.permission p
        WHERE r.code = ${role} AND p.code = ${permission}
        ON CONFLICT DO NOTHING`;
      grants += n;
    }
  }

  return { roles: ROLES.length, permissions: PERMISSIONS.length, grants };
}

async function main(): Promise<void> {
  console.log('Seeding reference data…');

  const config = await seedConfig();
  console.log(
    `  platform_config: ${config.added} added, ${config.updated} re-dated, ${CONFIG.length} total`,
  );

  const rbac = await seedRbac();
  console.log(
    `  RBAC: ${rbac.roles} roles, ${rbac.permissions} permissions, ${rbac.grants} new grant(s)`,
  );

  // Partition maintenance, so a freshly seeded database is not already expiring.
  const partitions = await prisma.$queryRaw<Array<{ created_count: number }>>`
    SELECT created_count FROM ops.ensure_partitions(6)`;
  const created = partitions.reduce((a, r) => a + Number(r.created_count), 0);
  console.log(`  partitions: ${created} created`);

  const runway = await prisma.$queryRaw<Array<{ table_name: string; runway_days: number }>>`
    SELECT table_name, runway_days FROM ops.v_partition_runway ORDER BY runway_days LIMIT 1`;
  console.log(`  partition runway: ${runway[0]?.runway_days ?? '?'} days minimum`);

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
