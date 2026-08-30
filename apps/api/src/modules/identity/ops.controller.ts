import { Controller, Get } from '@nestjs/common';
import type { Permission } from '@trugrade/contracts';
import { ClockPort } from '../../shared/clock';
import { PrismaService } from '../../shared/db/prisma.service';
import { RequestContextService } from '../../shared/db/org-scope';
import { ForbiddenError } from '../../shared/errors/domain-errors';

/**
 * The ops workspace: today's exceptions, and nothing else.
 *
 * **Why it lives in `identity`.** The dashboard is an aggregate across seven
 * module schemas and no service owns the combination — the numbers belong to
 * whoever is looking at them, not to a domain. `VendorController.dashboard`
 * settled the same question the same way, and its rule holds here: separate
 * statements, **one module schema each**, combined in TypeScript.
 * `no-cross-schema-join` forbids the JOIN that would be shorter and it is right
 * to — a join across `kyc` and `procurement` is the seam gone. `identity` is
 * the home because this is the platform's own screen and this module already
 * owns the platform's own tables.
 *
 * **Every number here comes from a row, or does not appear.** The homepage
 * shipped `98% of 412 units inspected` on a platform with zero units once, and
 * archetype E invites exactly that: a KPI row has slots, and slots want filling.
 * `03_UX_SPEC.md` §3C.1 asks for eleven tiles. Four of them have no source in
 * this product at all — `logistics.shipment` has no writer, `platform.
 * return_request` and `payment.payment` are empty, `qc.qc_mismatch` is empty —
 * and rather than render four zeroes that read as "nothing is wrong", they are
 * returned in `unavailable` with the reason, and the screen prints the reason.
 *
 * **Every slice is gated on the permission the board behind it is gated on.**
 * §3C.1 says ADMIN_OPS and ADMIN_SUPER see the dashboard and "others see their
 * slice", and this is what that means in a permission system: a KYC_REVIEWER
 * gets the two application queues and no purchase orders, because
 * `procurement.po.read_any` is the permission the PO board itself checks. A
 * tile linking to a screen that will 403 is worse than no tile.
 */

/**
 * One queue, as `QueueItem` in `@trugrade/ui` wants it.
 *
 * **Every field is nullable and null means "we do not measure this here", never
 * "zero".** `QueueItem.slaHours` is optional precisely so a queue with no
 * promise renders without borrowing a 24 or a 48 from a queue that has one, and
 * `breachedCount: null` renders "Breaches not measured" rather than the
 * reassuring "Within SLA". Six of the eight queues below genuinely have no
 * promise behind them, and saying so is the whole point.
 */
interface OpsQueue {
  key: string;
  label: string;
  /**
   * The board that answers it. **A queue only exists here if one does.**
   *
   * Archetype E's queues are work instructions — "open this next" — so a queue
   * you cannot open is not a queue, it is a number, and it belongs on the KPI
   * row instead. T26 shipped three tiles pointing at routes that did not exist
   * and the ledger's conclusion stands: a number with no board beats a link to
   * the wrong one. Purchase orders, order approvals, payables and tickets are
   * therefore metrics below and not queues, until T39 builds their boards.
   */
  href: string;
  description: string;
  count: number;
  oldestWaitHours: number | null;
  breachedCount: number | null;
  slaHours: number | null;
}

/** A number on the KPI row. `value: null` renders "Not measured", never a zero. */
interface OpsMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  hint: string;
  href: string | null;
}

/** A tile §3C.1 asks for that this product cannot serve, and why. */
interface OpsGap {
  label: string;
  reason: string;
}

interface OpsDashboard {
  metrics: OpsMetric[];
  queues: OpsQueue[];
  gaps: OpsGap[];
}

/** `qc` owns the correction window; `platform_config` owns the number. */
const CORRECTION_WINDOW_KEY = 'qc.grade_correction_auto_days';

/** 48 working hours for a vendor application, 24 for a buyer. Mirrors `kyc.service`. */
const VENDOR_REVIEW_SLA_HOURS = 48;
const BUYER_REVIEW_SLA_HOURS = 24;

@Controller('ops')
export class OpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContextService,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Platform staff only, refused here rather than by a permission.
   *
   * There is no single permission that means "you work here" — every one of
   * them names a resource — and a vendor holding none of the six below would
   * otherwise get an empty dashboard with a 200 rather than a refusal. An empty
   * screen is not an answer to a question that has none.
   */
  private requirePlatform(): ReadonlySet<Permission> {
    const principal = this.ctx.requirePrincipal();
    if (principal.orgType !== 'PLATFORM') {
      throw new ForbiddenError('This is the platform’s own workspace.', {
        reason: 'ops_dashboard_outside_platform',
      });
    }
    return principal.permissions;
  }

  @Get('dashboard')
  async dashboard(): Promise<OpsDashboard> {
    const held = this.requirePlatform();
    const can = (p: Permission): boolean => held.has(p);

    const metrics: OpsMetric[] = [];
    const queues: OpsQueue[] = [];
    const gaps: OpsGap[] = [];

    const nowMs = this.clock.nowMs();
    const waitedHours = (since: Date | null | undefined): number | null =>
      since ? Math.max(0, Math.round((nowMs - since.getTime()) / 3_600_000)) : null;

    // -----------------------------------------------------------------------
    // Onboarding. Two queues and not one, because they carry two different
    // promises: a vendor is owed 48 working hours and a buyer 24. `QueueItem`
    // has one `slaHours`, and a single "applications" queue would either state
    // one number over both — the defect T36 found on the review board — or drop
    // the promise entirely, which would throw away the only real SLA on this
    // screen.
    // -----------------------------------------------------------------------
    if (can('kyc.application.read')) {
      // `${now}` and not `now()`. T25 found an approval SLA measured against
      // two clocks — `requested_at` from the database's DEFAULT and
      // `expires_at` from `ClockPort` — reporting 22 hours where it should have
      // reported 24, and drifting with any app/DB skew. `KycService.reviewQueue`
      // measures this same breach with `ClockPort`, so a dashboard measuring it
      // with the database's clock would disagree with the board it links to.
      const now = this.clock.now();
      const rows = await this.prisma.$queryRaw<
        Array<{ org_type: string; waiting: bigint; breached: bigint; oldest: Date | null }>
      >`
        SELECT org_type::text                                                    AS org_type,
               count(*)                                                          AS waiting,
               count(*) FILTER (WHERE review_sla_due_at < ${now}::timestamptz)    AS breached,
               min(submitted_for_review_at)                                       AS oldest
          FROM identity.organization
         WHERE status IN ('KYC_SUBMITTED','UNDER_REVIEW','INFO_REQUESTED')
           AND submitted_for_review_at IS NOT NULL
         GROUP BY org_type`;

      for (const [orgType, label, sla] of [
        ['VENDOR', 'Vendor applications', VENDOR_REVIEW_SLA_HOURS],
        ['BUYER', 'Buyer applications', BUYER_REVIEW_SLA_HOURS],
      ] as const) {
        const row = rows.find((r) => r.org_type === orgType);
        queues.push({
          key: `onboarding-${orgType.toLowerCase()}`,
          label,
          href: `/kyc?view=${orgType.toLowerCase()}`,
          description: `Waiting on a decision from us. We promise ${sla} working hours from submission.`,
          count: Number(row?.waiting ?? 0),
          oldestWaitHours: waitedHours(row?.oldest),
          breachedCount: Number(row?.breached ?? 0),
          slaHours: sla,
        });
      }

      const waiting = rows.reduce((n, r) => n + Number(r.waiting), 0);
      const breached = rows.reduce((n, r) => n + Number(r.breached), 0);
      metrics.push({
        key: 'onboarding-breached',
        label: 'Past our promise',
        value: breached,
        unit: `of ${waiting} applications`,
        hint: `Measured against each applicant’s own promise — ${VENDOR_REVIEW_SLA_HOURS} working hours for a vendor, ${BUYER_REVIEW_SLA_HOURS} for a buyer.`,
        href: '/kyc?view=breached',
      });
    }

    // -----------------------------------------------------------------------
    // Stock and grade corrections
    // -----------------------------------------------------------------------
    if (can('listing.any.read')) {
      const [config] = await this.prisma.$queryRaw<Array<{ value_json: unknown }>>`
        SELECT value_json FROM platform.v_current_config WHERE key = ${CORRECTION_WINDOW_KEY}`;
      const windowDays = typeof config?.value_json === 'number' ? config.value_json : null;
      // A window we cannot read is not a window of zero. Everything downstream
      // reports "not measured" rather than declaring the queue on time.
      const deadline = windowDays === null ? null : this.clock.plusDays(-windowDays);

      const [counts] = await this.prisma.$queryRaw<
        Array<{
          corrections: bigint;
          corrections_oldest: Date | null;
          corrections_late: bigint;
        }>
      >`
        SELECT
          (SELECT count(*) FROM listing.grade_correction
            WHERE vendor_responded_at IS NULL AND auto_applied_at IS NULL)       AS corrections,
          (SELECT min(vendor_notified_at) FROM listing.grade_correction
            WHERE vendor_responded_at IS NULL AND auto_applied_at IS NULL)       AS corrections_oldest,
          (SELECT count(*) FROM listing.grade_correction
            WHERE vendor_responded_at IS NULL AND auto_applied_at IS NULL
              AND ${deadline}::timestamptz IS NOT NULL
              AND vendor_notified_at < ${deadline}::timestamptz)                 AS corrections_late`;

      queues.push({
        key: 'grade-corrections',
        label: 'Grade corrections awaiting a vendor',
        href: '/qc/grade-corrections',
        description:
          'A correction the vendor has not answered. It applies to their stock by itself when the window closes.',
        count: Number(counts?.corrections ?? 0),
        oldestWaitHours: waitedHours(counts?.corrections_oldest),
        // Null, not zero, when the window could not be read.
        breachedCount: windowDays === null ? null : Number(counts?.corrections_late ?? 0),
        slaHours: windowDays === null ? null : windowDays * 24,
      });
    }

    // -----------------------------------------------------------------------
    // Inspections
    // -----------------------------------------------------------------------
    if (can('qc.visit.read')) {
      const [visits] = await this.prisma.$queryRaw<
        Array<{ unstaffed: bigint; oldest: Date | null }>
      >`
        SELECT count(*)            AS unstaffed,
               min(requested_at)   AS oldest
          FROM qc.qc_visit
         WHERE status IN ('REQUESTED','SCHEDULED')`;

      queues.push({
        key: 'qc-unstaffed',
        label: 'Inspections without a technician',
        href: '/qc/visits',
        description:
          'Raised or dated, with nobody assigned. A vendor’s stock cannot go on sale until one of these happens.',
        count: Number(visits?.unstaffed ?? 0),
        oldestWaitHours: waitedHours(visits?.oldest),
        // **Deliberately null.** Nothing in `platform_config` commits us to a
        // date by which a declared machine is inspected, so there is no promise
        // to be past. T33 made the same call on the vendor's side of this queue.
        breachedCount: null,
        slaHours: null,
      });
    }

    // -----------------------------------------------------------------------
    // Orders
    // -----------------------------------------------------------------------
    if (can('ordering.any.read')) {
      const [approvals] = await this.prisma.$queryRaw<
        Array<{ pending: bigint; oldest: Date | null }>
      >`
        SELECT count(*)            AS pending,
               min(requested_at)   AS oldest
          FROM ordering.order_approval
         WHERE status = 'PENDING'`;

      const oldestApproval = waitedHours(approvals?.oldest);
      metrics.push({
        key: 'order-approvals',
        label: 'Orders held for a buyer’s approver',
        value: Number(approvals?.pending ?? 0),
        unit: 'waiting',
        // The approval carries an `expires_at`, but it is the buyer's own
        // deadline and not a promise we made, so nothing here is our breach.
        hint:
          oldestApproval === null
            ? 'Stock stays reserved while they wait. There is no ops board for these yet.'
            : `Stock stays reserved while they wait; the oldest has waited ${oldestApproval} hours. There is no ops board for these yet.`,
        href: null,
      });
    }

    // -----------------------------------------------------------------------
    // Procurement and money
    // -----------------------------------------------------------------------
    if (can('procurement.po.read_any')) {
      const [pos] = await this.prisma.$queryRaw<
        Array<{ unacked: bigint; oldest: Date | null }>
      >`
        SELECT count(*)          AS unacked,
               min(created_at)   AS oldest
          FROM procurement.purchase_order
         WHERE status = 'RAISED'`;

      const [payables] = await this.prisma.$queryRaw<
        Array<{ accrued: bigint; oldest: Date | null; runs: bigint }>
      >`
        SELECT (SELECT count(*) FROM procurement.vendor_payable
                 WHERE status IN ('ACCRUED','ELIGIBLE'))          AS accrued,
               (SELECT min(created_at) FROM procurement.vendor_payable
                 WHERE status IN ('ACCRUED','ELIGIBLE'))          AS oldest,
               (SELECT count(*) FROM procurement.payout_run)      AS runs`;

      const oldestPo = waitedHours(pos?.oldest);
      metrics.push({
        key: 'po-unacknowledged',
        label: 'Purchase orders not acknowledged',
        value: Number(pos?.unacked ?? 0),
        unit: 'of ours, unaccepted',
        // T32: there is no acceptance window in `platform_config` and no penalty
        // rule behind one, so none of these is late — there is no deadline to be
        // past, and saying so beats inventing 24 hours.
        hint:
          oldestPo === null
            ? 'No acceptance deadline exists in this product, so none of these is late.'
            : `The oldest has waited ${oldestPo} hours. No acceptance deadline exists in this product, so none of these is late.`,
        href: null,
      });

      metrics.push({
        key: 'payout-runs',
        label: 'Payout runs executed',
        value: Number(payables?.runs ?? 0),
        unit: 'ever',
        // A meaningful zero, which is why it is a zero and not "Not measured":
        // `procurement.payout_run` exists, is readable, and has never had a row.
        hint: `${Number(payables?.accrued ?? 0)} payables have accrued behind it, the oldest ${
          waitedHours(payables?.oldest) ?? 0
        } hours ago. Nothing in this product writes a payout run.`,
        href: null,
      });
    }

    // -----------------------------------------------------------------------
    // Support
    // -----------------------------------------------------------------------
    if (can('platform.ticket.read')) {
      const [tickets] = await this.prisma.$queryRaw<
        Array<{ open: bigint; oldest: Date | null; with_sla: bigint; breached: bigint }>
      >`
        SELECT count(*)                                                        AS open,
               min(created_at)                                                 AS oldest,
               count(*) FILTER (WHERE sla_due_at IS NOT NULL)                  AS with_sla,
               count(*) FILTER (WHERE sla_due_at < ${this.clock.now()}::timestamptz) AS breached
          FROM platform.ticket
         WHERE status <> 'CLOSED'`;

      // **`sla_due_at` is nullable and nothing populates it.** With no ticket
      // carrying a deadline there is no breach to count, and reporting 0 would
      // tell an ops manager every ticket is on time when not one of them has
      // ever been timed. Null the moment any row lacks one.
      const timed = Number(tickets?.with_sla ?? 0);
      const open = Number(tickets?.open ?? 0);
      const oldestTicket = waitedHours(tickets?.oldest);
      metrics.push({
        key: 'tickets',
        label: 'Support tickets open',
        value: open,
        unit: 'not yet closed',
        hint:
          timed === open && open > 0
            ? `${Number(tickets?.breached ?? 0)} are past their due date. The oldest has waited ${oldestTicket ?? 0} hours.`
            : `Not one of them carries a due date, so none can be shown as late. ${
                oldestTicket === null ? '' : `The oldest has waited ${oldestTicket} hours.`
              }`.trim(),
        href: null,
      });
    }

    // -----------------------------------------------------------------------
    // Partition runway — §3C.1 puts schema gap #1 on this screen deliberately,
    // "because it is an operational risk, so it is on the ops dashboard, not
    // hidden in a runbook". Shown to every member of platform staff: it is our
    // own capacity, names no org and no person, and the day it runs out every
    // insert into five tables fails.
    // -----------------------------------------------------------------------
    const [runway] = await this.prisma.$queryRaw<
      Array<{ table_schema: string; table_name: string; runway_days: number }>
    >`
      SELECT table_schema, table_name, runway_days
        FROM ops.v_partition_runway
       ORDER BY runway_days
       LIMIT 1`;

    metrics.push({
      key: 'partition-runway',
      label: 'Partition runway',
      // Null rather than 0 when the view returns nothing: "no partitioned table
      // is registered" and "we run out today" are opposite facts.
      value: runway ? Number(runway.runway_days) : null,
      unit: 'days',
      hint: runway
        ? `${runway.table_schema}.${runway.table_name} is the tightest. New partitions are created by hand; at zero, every insert into it fails.`
        : 'No partitioned table is registered in ops.partitioned_table, so there is nothing to measure.',
      href: null,
    });

    // -----------------------------------------------------------------------
    // What this screen cannot yet tell you
    // -----------------------------------------------------------------------
    if (can('logistics.shipment.read')) {
      gaps.push({
        label: 'Shipments with a failed delivery attempt',
        reason:
          'logistics.shipment has no writer anywhere in this product and zero rows. A count would be a zero that means "we are not recording deliveries", not "none failed".',
      });
    }
    if (can('platform.return.approve')) {
      gaps.push({
        label: 'Returns inside the inspection window',
        reason:
          'platform.return_request has zero rows and no buyer-facing route raises one yet.',
      });
    }
    if (can('payment.invoice.read_any')) {
      gaps.push({
        label: 'Unmatched payments',
        reason:
          'payment.payment has zero rows — nothing collects money yet, so nothing can fail to match.',
      });
    }
    if (can('qc.report.read')) {
      gaps.push({
        label: 'Units failing QC above the divergence threshold',
        reason:
          'qc.qc_mismatch has zero rows and no audit recheck has ever been ordered, so there is no divergence to measure against the threshold.',
      });
    }

    return { metrics, queues, gaps };
  }
}
