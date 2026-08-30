import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Which source files name each `platform_config` key.
 *
 * ## Why this file exists
 *
 * A configuration screen that renders 74 editable values implies 74 working
 * settings, and that implication is false. Three of this repo's config defects
 * were found in one day and every one of them was a *reachability* defect
 * rather than a wrong value: `price.guardrail_upper_multiple` is set to 3.0 and
 * consumed by nothing; `qc.visit_fee_waived_above` and
 * `qc.visit_fee_waiver_units` are the same number under two names, each reached
 * by a different half of the product; `msme.max_payment_days` was in the
 * baseline migration and missing from the seed, so a seed-built database paid
 * an MSME on 15-day terms instead of the statutory 45.
 *
 * None of those is visible in the value. All three are visible in the answer to
 * "which file reads this key". So that is the column the screen shows.
 *
 * ## Why it is a committed constant and not a runtime scan
 *
 * The API runs from `dist/`. There is no TypeScript source next to a deployed
 * process to grep, so the answer has to be computed while the source is still
 * there and carried along. `scan()` is exported and `config-consumers.spec.ts`
 * re-runs it against `src/` and demands the result equal `CONFIG_CONSUMERS` —
 * so a key that gains or loses a reader fails the suite instead of quietly
 * making this screen lie.
 *
 * ## What a reference means, and what it does not
 *
 * It means the literal string appears in that file. It does **not** mean the
 * value changes behaviour: `pricing-admin.controller.ts` names
 * `price.guardrail_upper_multiple` only in order to report that nothing reads
 * it. That distinction is not one a grep can make, so the screen shows the file
 * names rather than a verdict, and a key whose only reader is a console
 * controller reads for what it is — reported, not consumed.
 */

/** `src/`, relative to this file at `src/modules/platform/internal/`. */
const SRC = join(__dirname, '..', '..', '..');

/**
 * Excluded from its own scan. Every key literal appears in the map below, so
 * counting this file would report all 74 keys as reachable, which is the
 * failure mode the file exists to prevent.
 */
const SELF = 'modules/platform/internal/config-consumers.ts';

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Every non-spec `.ts` file under `src/`, with its text. Read once, reused. */
function corpus(srcDir: string): Array<{ path: string; text: string }> {
  return walk(srcDir, []).map((f) => ({
    path: relative(srcDir, f).split(sep).join('/'),
    text: readFileSync(f, 'utf8'),
  }));
}

/**
 * Source files containing `needle`, as forward-slashed paths under `src/`.
 *
 * Used for table names as well as config keys: `platform.feature_flag` and
 * `platform.notification_template` are named in SQL rather than quoted as
 * strings, and "which files mention this table" is the same question in a
 * different spelling.
 */
export function filesContaining(needle: string, srcDir: string = SRC): string[] {
  return corpus(srcDir)
    .filter((f) => f.path !== SELF && f.text.includes(needle))
    .map((f) => f.path)
    .sort();
}

/**
 * The files naming each of `keys`, as forward-slashed paths under `src/`.
 *
 * Keys with no reader are present with an empty array rather than absent: the
 * screen has to tell "nothing reads this" apart from "we did not look".
 */
export function scan(keys: readonly string[], srcDir: string = SRC): Record<string, string[]> {
  const files = corpus(srcDir);
  const out: Record<string, string[]> = {};
  for (const key of keys) {
    out[key] = files
      .filter((f) => f.path !== SELF && f.text.includes(`'${key}'`))
      .map((f) => f.path)
      .sort();
  }
  return out;
}

/** `prisma/`, relative to this file. Migrations and the seed both live under it. */
const PRISMA = join(__dirname, '..', '..', '..', '..', 'prisma');

/**
 * Where each key is WRITTEN — the migrations, the seed, or both.
 *
 * This is a different question from reachability and it has bitten this repo
 * harder. `msme.max_payment_days` was in the baseline migration and missing from
 * the seed, so a seed-built database paid an MSME on 15-day terms instead of the
 * statutory 45 — an s.16 compound-interest liability that no amount of reading
 * the value would have revealed, because the row simply was not there.
 *
 * `prisma/migrations/**.sql` and `prisma/seed/**.ts` both quote the key the same
 * way, so one substring test answers both.
 */
export function scanSources(
  keys: readonly string[],
  prismaDir: string = PRISMA,
): Record<string, { migration: boolean; seed: boolean }> {
  const read = (sub: string, exts: readonly string[]): string => {
    const files: string[] = [];
    const walkAny = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walkAny(full);
        else if (exts.some((e) => entry.name.endsWith(e))) files.push(full);
      }
    };
    walkAny(join(prismaDir, sub));
    return files.map((f) => readFileSync(f, 'utf8')).join('\n');
  };

  // Lower-cased on both sides. The baseline migration writes
  // `warranty.default.A_PLUS` and a later migration lower-cases every key in
  // place, so a case-sensitive match would report three live keys as written by
  // nothing — which is the one answer here that must never be wrong by accident.
  const migrations = read('migrations', ['.sql']).toLowerCase();
  const seed = read('seed', ['.ts']).toLowerCase();
  const out: Record<string, { migration: boolean; seed: boolean }> = {};
  for (const key of keys) {
    const needle = `'${key.toLowerCase()}'`;
    out[key] = { migration: migrations.includes(needle), seed: seed.includes(needle) };
  }
  return out;
}

/**
 * The statutory consequence of changing a key, where there is one.
 *
 * §3C.7 asks for a dedicated "legal-effect" section: keys that change what we
 * owe, or what we may say, under a statute rather than under a policy. Curated
 * deliberately — `platform_config` has no column marking a key statutory, and
 * deriving it from the name would be a guess about the law. Each entry names the
 * instrument, because "legal-effect" with nothing after it is decoration.
 *
 * Declared HERE and not in the controller that renders it. This file is excluded
 * from its own scan, and every key named below would otherwise be reported as
 * *read* by the very screen whose job is to say whether anything reads it. A
 * reachability column that counts its own renderer always says yes.
 */
export const LEGAL_EFFECT: Readonly<Record<string, string>> = Object.freeze({
  'ordering.inspection_window_hours':
    'Consumer Protection (e-Commerce) Rules r.7(4) — the take-back window, and the clock every vendor payout waits on.',
  'msme.max_payment_days':
    'MSMED Act s.15/16 — beyond 45 days we owe compound interest at three times the RBI bank rate.',
  'tax.tds_applicable':
    'Income-tax s.194Q — applicable only if our turnover exceeded Rs 10 crore last year. Wrong in either direction is a disallowance.',
  'tax.tds_rate_pct': 'Income-tax s.194Q — 0.1% on the part above the per-vendor threshold.',
  'tax.tds_rate_no_pan_pct':
    'Income-tax s.206AA — the higher rate where the vendor has no valid PAN.',
  'tax.tds_vendor_threshold_inr': 'Income-tax s.194Q — Rs 50 lakh per vendor per financial year.',
  'tax.gst_rate_laptop_pct': 'GST rate for HSN 8471.',
  'tax.eway_bill_threshold_inr':
    'CGST Rules r.138 — the consignment value above which an e-way bill is required.',
  'qc.report_validity_days':
    'CP e-Comm r.7(5) — how long an inspection may still be offered as the basis of a grade claim.',
  'platform.grievance_ack_hours': 'CP e-Comm r.4(4) — acknowledge a grievance within 48 hours.',
  'platform.grievance_redress_days': 'CP e-Comm r.4(5) — redress within one month.',
  'return.window_hours': 'CP e-Comm r.7(4) — the return window offered to the buyer.',
  'identity.document_max_age_days': 'PMLA/KYC — how recent an address proof must be.',
});

/**
 * The scan's answer, committed on 31 Aug 2026 against the 74 keys then in
 * `platform.v_current_config`. **34 of them have a reader; 40 have none.**
 *
 * When this goes stale `config-consumers.spec.ts` fails and prints the object to
 * paste back in. There is no generator script to remember to run, because the
 * spec IS the generator and it runs on every `pnpm test`.
 *
 * A key absent from this map is reported to the screen as *unknown*, never as
 * unreachable: a key seeded after this scan has not been looked for, and
 * "nothing reads it" is a claim that has to be earned.
 */
export const CONFIG_CONSUMERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "dispatch.direct_allowed": [],
  "dispatch.ndr_response_window_hours": [],
  "dispatch.rto_after_attempts": [],
  "eway.threshold_inr": [],
  "grade_b.min_photos": [],
  "identity.document_max_age_days": [],
  "identity.kyc_sla_hours_buyer": [],
  "identity.kyc_sla_hours_vendor": [],
  "identity.otp_max_verify_attempts": [],
  "identity.otp_resend_cooldown_seconds": [],
  "identity.otp_ttl_seconds": [],
  "kyc.bank_change_freeze_hours": [
    "modules/kyc/internal/verification.service.ts",
  ],
  "kyc.four_eyes_gmv_threshold": [],
  "listing.stale_days": [],
  "logistics.max_stops_per_route": [],
  "msme.max_payment_days": [
    "modules/procurement/internal/payable.service.ts",
  ],
  "ordering.approval_hold_ttl_hours": [
    "modules/ordering/internal/checkout.service.ts",
  ],
  "ordering.credit_enabled": [],
  "ordering.inspection_window_hours": [
    "modules/identity/finance.controller.ts",
    "modules/ordering/internal/delivery-check.service.ts",
    "modules/platform/internal/returns.service.ts",
    "modules/procurement/internal/payable.service.ts",
  ],
  "ordering.reservation_ttl_minutes": [
    "modules/ordering/internal/checkout.service.ts",
  ],
  "platform.grievance_ack_hours": [],
  "platform.grievance_redress_days": [],
  "platform.sourcing_declaration_threshold_inr": [
    "modules/listing/internal/sourcing.service.ts",
  ],
  "platform.warranty_min_total_months": [
    "modules/listing/internal/pricing.service.ts",
    "modules/listing/pricing-admin.controller.ts",
    "modules/platform/internal/warranty.service.ts",
  ],
  "platform.warranty_top_up_months": [
    "modules/platform/internal/warranty.service.ts",
  ],
  "price.guardrail_lower_multiple": [
    "modules/listing/internal/pricing.service.ts",
    "modules/listing/pricing-admin.controller.ts",
  ],
  "price.guardrail_upper_multiple": [
    "modules/listing/pricing-admin.controller.ts",
  ],
  "procurement.default_payout_cycle": [],
  "procurement.min_payout_threshold_inr": [],
  "procurement.price_variance_tolerance_inr": [],
  "procurement.price_variance_tolerance_pct": [],
  "qc.audit_recheck_pct": [
    "modules/qc/internal/audit-recheck.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.auto_approve_block_on_fail": [
    "modules/qc/internal/verdict.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.auto_approve_block_on_not_measured": [
    "modules/qc/internal/verdict.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.auto_approve_min_score": [
    "modules/qc/internal/verdict.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.auto_approve_require_grade_match": [
    "modules/qc/internal/verdict.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.auto_approve_require_seal": [
    "modules/qc/internal/verdict.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.auto_approve_require_serial_match": [
    "modules/qc/internal/verdict.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.auto_approve_require_spec_match": [
    "modules/qc/internal/verdict.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.expiry_warning_days": [
    "modules/qc/internal/qc-expiry.service.ts",
  ],
  "qc.fee_bearer": [
    "modules/listing/internal/pricing.service.ts",
    "modules/listing/pricing-admin.controller.ts",
  ],
  "qc.geo_variance_alert_metres": [
    "modules/qc/internal/scheduling.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.grade_correction_auto_days": [
    "modules/identity/ops.controller.ts",
    "modules/qc/internal/grade-correction.service.ts",
    "modules/qc/qc.controller.ts",
    "modules/qc/vendor-corrections.controller.ts",
    "modules/vendor/vendor.controller.ts",
  ],
  "qc.location_model": [],
  "qc.min_sample_for_headline": [
    "modules/qc/internal/vendor-quality.service.ts",
  ],
  "qc.min_sellable_score": [],
  "qc.min_units_per_visit": [
    "modules/listing/internal/submit.service.ts",
  ],
  "qc.mode_first_listing": [],
  "qc.mode_steady_state": [],
  "qc.report_validity_days": [
    "modules/qc/internal/grade-correction.service.ts",
    "modules/qc/internal/verdict.service.ts",
    "modules/qc/qc.controller.ts",
  ],
  "qc.reverification_method": [],
  "qc.score_clustering_alert_band": [],
  "qc.score_clustering_min_sample": [],
  "qc.score_clustering_ratio_alert": [],
  "qc.seal_code_prefix": [
    "modules/qc/internal/sealing.service.ts",
  ],
  "qc.spec_match_cpu_blocking": [
    "modules/qc/internal/tolerance.service.ts",
    "modules/qc/internal/verdict.service.ts",
  ],
  "qc.spec_match_screen_tolerance_in": [
    "modules/qc/internal/tolerance.service.ts",
    "modules/qc/internal/verdict.service.ts",
  ],
  "qc.visit_fee_inr": [
    "modules/listing/internal/pricing.service.ts",
    "modules/listing/internal/submit.service.ts",
    "modules/listing/pricing-admin.controller.ts",
    "modules/qc/vendor-visits.controller.ts",
  ],
  "qc.visit_fee_waived_above": [
    "modules/listing/internal/pricing.service.ts",
    "modules/listing/internal/submit.service.ts",
    "modules/listing/pricing-admin.controller.ts",
    "modules/qc/vendor-visits.controller.ts",
  ],
  "qc.visit_fee_waiver_units": [],
  "return.window_hours": [],
  "serial.deadline_hours": [],
  "stock.hold_minutes": [],
  "tax.einvoice_enabled": [],
  "tax.eway_bill_threshold_inr": [],
  "tax.gst_rate_laptop_pct": [],
  "tax.tds_applicable": [
    "modules/identity/finance.controller.ts",
    "modules/listing/internal/pricing.service.ts",
    "modules/ordering/internal/order-transaction.service.ts",
    "modules/procurement/internal/payable.service.ts",
  ],
  "tax.tds_rate_no_pan_pct": [
    "modules/identity/finance.controller.ts",
    "modules/listing/internal/pricing.service.ts",
    "modules/ordering/internal/order-transaction.service.ts",
    "modules/procurement/internal/payable.service.ts",
  ],
  "tax.tds_rate_pct": [
    "modules/identity/finance.controller.ts",
    "modules/listing/internal/pricing.service.ts",
    "modules/ordering/internal/order-transaction.service.ts",
    "modules/procurement/internal/payable.service.ts",
  ],
  "tax.tds_vendor_threshold_inr": [
    "modules/identity/finance.controller.ts",
    "modules/listing/internal/pricing.service.ts",
    "modules/ordering/internal/order-transaction.service.ts",
    "modules/procurement/internal/payable.service.ts",
  ],
  "tds.section_194o_rate": [],
  "warranty.default.a": [],
  "warranty.default.a_plus": [],
  "warranty.default.b": [],
});

/**
 * `scanSources`'s answer, committed alongside `CONFIG_CONSUMERS` and checked by
 * the same spec.
 *
 * **The two writers of this table have substantially diverged.** Of the 74 keys
 * a fully-built database holds, only a small minority are written by both the
 * migrations and the seed: most are in one or the other, so neither source alone
 * produces a working platform. That is not a theory — `msme.max_payment_days`
 * was migration-only and a seed-built database paid an MSME on 15-day terms
 * instead of the statutory 45, and `qc.visit_fee_waived_above` /
 * `qc.visit_fee_waiver_units` were the same number under one name in each.
 *
 * A key written by neither is a leftover: a row a previous migration or seed
 * created under a name nothing uses any more.
 */
export const CONFIG_SOURCES: Readonly<Record<string, { migration: boolean; seed: boolean }>> =
  Object.freeze({
    "dispatch.direct_allowed": { migration: true, seed: false },
    "dispatch.ndr_response_window_hours": { migration: false, seed: true },
    "dispatch.rto_after_attempts": { migration: true, seed: true },
    "eway.threshold_inr": { migration: true, seed: false },
    "grade_b.min_photos": { migration: true, seed: false },
    "identity.document_max_age_days": { migration: false, seed: true },
    "identity.kyc_sla_hours_buyer": { migration: false, seed: true },
    "identity.kyc_sla_hours_vendor": { migration: false, seed: true },
    "identity.otp_max_verify_attempts": { migration: false, seed: true },
    "identity.otp_resend_cooldown_seconds": { migration: false, seed: true },
    "identity.otp_ttl_seconds": { migration: false, seed: true },
    "kyc.bank_change_freeze_hours": { migration: true, seed: false },
    "kyc.four_eyes_gmv_threshold": { migration: true, seed: false },
    "listing.stale_days": { migration: true, seed: false },
    "logistics.max_stops_per_route": { migration: true, seed: true },
    "msme.max_payment_days": { migration: true, seed: true },
    "ordering.approval_hold_ttl_hours": { migration: false, seed: true },
    "ordering.credit_enabled": { migration: false, seed: true },
    "ordering.inspection_window_hours": { migration: false, seed: true },
    "ordering.reservation_ttl_minutes": { migration: false, seed: true },
    "platform.grievance_ack_hours": { migration: false, seed: true },
    "platform.grievance_redress_days": { migration: false, seed: true },
    "platform.sourcing_declaration_threshold_inr": { migration: false, seed: true },
    "platform.warranty_min_total_months": { migration: false, seed: true },
    "platform.warranty_top_up_months": { migration: false, seed: true },
    "price.guardrail_lower_multiple": { migration: true, seed: true },
    "price.guardrail_upper_multiple": { migration: true, seed: false },
    "procurement.default_payout_cycle": { migration: false, seed: true },
    "procurement.min_payout_threshold_inr": { migration: false, seed: true },
    "procurement.price_variance_tolerance_inr": { migration: false, seed: true },
    "procurement.price_variance_tolerance_pct": { migration: false, seed: true },
    "qc.audit_recheck_pct": { migration: true, seed: true },
    "qc.auto_approve_block_on_fail": { migration: false, seed: true },
    "qc.auto_approve_block_on_not_measured": { migration: false, seed: true },
    "qc.auto_approve_min_score": { migration: false, seed: true },
    "qc.auto_approve_require_grade_match": { migration: false, seed: true },
    "qc.auto_approve_require_seal": { migration: false, seed: true },
    "qc.auto_approve_require_serial_match": { migration: false, seed: true },
    "qc.auto_approve_require_spec_match": { migration: false, seed: true },
    "qc.expiry_warning_days": { migration: false, seed: true },
    "qc.fee_bearer": { migration: false, seed: true },
    "qc.geo_variance_alert_metres": { migration: true, seed: true },
    "qc.grade_correction_auto_days": { migration: true, seed: true },
    "qc.location_model": { migration: true, seed: false },
    "qc.min_sample_for_headline": { migration: false, seed: true },
    "qc.min_sellable_score": { migration: true, seed: false },
    "qc.min_units_per_visit": { migration: true, seed: true },
    "qc.mode_first_listing": { migration: false, seed: true },
    "qc.mode_steady_state": { migration: false, seed: true },
    "qc.report_validity_days": { migration: true, seed: true },
    "qc.reverification_method": { migration: true, seed: false },
    "qc.score_clustering_alert_band": { migration: false, seed: true },
    "qc.score_clustering_min_sample": { migration: false, seed: true },
    "qc.score_clustering_ratio_alert": { migration: false, seed: true },
    "qc.seal_code_prefix": { migration: false, seed: true },
    "qc.spec_match_cpu_blocking": { migration: false, seed: true },
    "qc.spec_match_screen_tolerance_in": { migration: false, seed: true },
    "qc.visit_fee_inr": { migration: true, seed: true },
    "qc.visit_fee_waived_above": { migration: true, seed: true },
    "qc.visit_fee_waiver_units": { migration: false, seed: false },
    "return.window_hours": { migration: true, seed: false },
    "serial.deadline_hours": { migration: true, seed: false },
    "stock.hold_minutes": { migration: true, seed: false },
    "tax.einvoice_enabled": { migration: false, seed: true },
    "tax.eway_bill_threshold_inr": { migration: false, seed: true },
    "tax.gst_rate_laptop_pct": { migration: false, seed: true },
    "tax.tds_applicable": { migration: false, seed: true },
    "tax.tds_rate_no_pan_pct": { migration: false, seed: true },
    "tax.tds_rate_pct": { migration: false, seed: true },
    "tax.tds_vendor_threshold_inr": { migration: false, seed: true },
    "tds.section_194o_rate": { migration: true, seed: false },
    "warranty.default.a": { migration: true, seed: false },
    "warranty.default.a_plus": { migration: true, seed: false },
    "warranty.default.b": { migration: true, seed: false },
  });
