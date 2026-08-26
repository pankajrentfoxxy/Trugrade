import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { EventBus } from '../../../shared/events/event-bus';
import { NotificationPort } from '../../../shared/adapters/ports';

/**
 * Ninety days, and then the stock quietly stops being sellable.
 *
 * A QC report is a claim about a machine on a date. Battery health and storage
 * wear move, and a six-month-old inspection is not a current claim — so
 * `qc_report.valid_until` is `completed_at + qc.report_validity_days` and the
 * unit falls out of the storefront when it passes. That is the cost of
 * inspecting stock that has not sold, and the vendor is the only person who can
 * do anything about it, which is why the warning matters as much as the expiry.
 *
 * Three things about this file are deliberate:
 *
 *   1. **It does not use `qc.v_expiring_qc`.** The view hard-codes
 *      `CURRENT_DATE + 14` and reads the *database's* clock, so it ignores
 *      `qc.expiry_warning_days` entirely and cannot be moved by a test clock.
 *      It is the right thing for the ops dashboard and the wrong thing for a
 *      job whose whole behaviour is time-dependent (04_TEST_PLAN §1.4.1). The
 *      job reads `listing.unit` against `ClockPort` instead; the view stays
 *      where it is, and the divergence is flagged rather than papered over.
 *   2. **`is_sellable` is never written here.** `trg_recompute_sellable` derives
 *      it from status, `qc_passed_at`, `qc_valid_until` and the seal, and forces
 *      it FALSE the moment the status leaves LISTED. Writing it by hand would
 *      give the column two authors and hide the day they stop agreeing —
 *      exactly what `listing.v_sellability_drift` exists to catch.
 *   3. **The vendor is warned once per cohort, not once per unit.** Forty
 *      messages about forty machines at one warehouse is how a vendor mutes the
 *      channel that later has to tell them something urgent.
 */

/** The one `platform_config` key this file is tuned by. */
const WARNING_DAYS_KEY = 'qc.expiry_warning_days';

/** Fallback only if the key is missing. The seeded value is 14. */
const DEFAULT_WARNING_DAYS = 14;

const WARNING_TEMPLATE = 'QC_EXPIRY_WARNING';

export interface ExpiryWarning {
  vendorOrgId: string;
  unitsExpiring: number;
  /** `YYYY-MM-DD` — the day the first of them stops being sellable. */
  earliestExpiry: string;
  notified: boolean;
}

export interface ExpiryRun {
  /** `YYYY-MM-DD`, the IST calendar day this run reckoned against. */
  onDate: string;
  warned: ExpiryWarning[];
  expiredUnitIds: string[];
}

interface ExpiringUnitRow {
  id: string;
  vendor_org_id: string;
  qc_valid_until: string;
}

@Injectable()
export class QcExpiryService {
  private readonly logger = new Logger(QcExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly bus: EventBus,
    private readonly notifications: NotificationPort,
  ) {}

  /**
   * Warn first, then expire.
   *
   * The order is not arbitrary: expiring first would move today's cohort off
   * `is_sellable` and the warning query — which only considers sellable stock —
   * would then miss anything that expired and was due a final warning in the
   * same run.
   *
   * Runs after the nightly drift checks so an expiry storm shows up in the
   * morning's numbers rather than the previous evening's.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'qc-expiry' })
  async runDaily(): Promise<ExpiryRun> {
    const onDate = this.clock.todayInIst();
    const warned = await this.warnExpiring();
    const expiredUnitIds = await this.expireDue();

    if (warned.length || expiredUnitIds.length) {
      this.logger.log(
        `QC expiry ${onDate}: warned ${warned.length} vendor(s), expired ${expiredUnitIds.length} unit(s).`,
      );
    }
    return { onDate, warned, expiredUnitIds };
  }

  /**
   * The 14-day warning, sent on the day a unit crosses the threshold.
   *
   * Matching the threshold day exactly is what makes this idempotent without a
   * `warned_at` column: run it twice on one day and the vendor is warned twice,
   * run it every day and each unit is warned once. Nothing on `listing.unit`
   * records that a warning went out, and adding a column to a table this lane
   * does not own is not a call to make here.
   *
   * ponytail: an exact-day cohort means a missed run misses that day's units
   * entirely. Upgrade path is a `qc_expiry_warned_at` column on `listing.unit`
   * and a `<=` window — worth it the first time the job actually misses a night.
   */
  async warnExpiring(): Promise<ExpiryWarning[]> {
    const warningDays = await this.warningDays();
    const onDate = this.clock.todayInIst();
    const threshold = addDays(onDate, warningDays);

    const rows = await this.prisma.$queryRaw<Array<{ vendor_org_id: string; units: bigint }>>`
      SELECT vendor_org_id, count(*)::bigint AS units
        FROM listing.unit
       WHERE is_sellable AND qc_valid_until = ${threshold}::date
       GROUP BY vendor_org_id`;

    const warnings: ExpiryWarning[] = [];
    for (const row of rows) {
      const unitsExpiring = Number(row.units);
      const notified = await this.notifyVendor(row.vendor_org_id, unitsExpiring, threshold);
      warnings.push({
        vendorOrgId: row.vendor_org_id,
        unitsExpiring,
        earliestExpiry: threshold,
        notified,
      });
    }
    return warnings;
  }

  /**
   * Units whose inspection ran out. `valid_until` is the last valid day, so the
   * comparison is strictly less than today.
   *
   * One statement: the UPDATE and the `stock_movement` row are written together,
   * because a unit whose status changed with nothing on the trail is a unit
   * nobody can explain during a dispute — and the dispute is always about the
   * one machine with no trail. This mirrors `StockMovementService.transition`
   * in the listing module, which owns that rule and which `no-cross-module-import`
   * correctly stops this lane from reaching into. Two copies of a five-line
   * statement is the cheaper of the two mistakes available here.
   */
  async expireDue(): Promise<string[]> {
    const onDate = this.clock.todayInIst();
    const now = this.clock.now();

    const rows = await this.prisma.$queryRaw<ExpiringUnitRow[]>`
      WITH due AS (
        SELECT id, vendor_org_id, status, location, qc_valid_until
          FROM listing.unit
         WHERE is_sellable AND qc_valid_until < ${onDate}::date
         ORDER BY id
           FOR UPDATE
      ),
      moved AS (
        UPDATE listing.unit u
           SET status = 'QC_EXPIRED'::public.unit_status
          FROM due d
         WHERE u.id = d.id
        RETURNING u.id, u.vendor_org_id, d.status AS from_status, d.location,
                  d.qc_valid_until::text AS qc_valid_until
      ),
      logged AS (
        INSERT INTO listing.stock_movement
          (unit_id, from_status, to_status, from_location, to_location,
           reason, actor_id, ref_type, ref_id, occurred_at)
        SELECT m.id, m.from_status, 'QC_EXPIRED'::public.unit_status, m.location, m.location,
               'QC report expired; the unit is no longer sellable.',
               NULL::uuid, 'QC_EXPIRY', NULL::uuid, ${now}
          FROM moved m
        RETURNING unit_id
      )
      SELECT id, vendor_org_id, qc_valid_until FROM moved`;

    for (const row of rows) {
      await this.bus.publish('qc.expired', {
        unitId: row.id,
        vendorOrgId: row.vendor_org_id,
        expiredAt: this.clock.nowIso(),
      });
    }

    return rows.map((r) => r.id);
  }

  // -------------------------------------------------------------------------

  /**
   * One message to the vendor's primary contact, and a `notification_log` row so
   * "the vendor was warned at 14 days" is a fact somebody can look up rather
   * than a belief. A send failure is logged and does not stop the run — the rest
   * of the vendors still need warning, and the unsent row is visible in the log.
   */
  private async notifyVendor(
    vendorOrgId: string,
    unitsExpiring: number,
    expiresOn: string,
  ): Promise<boolean> {
    const contact = await this.primaryContact(vendorOrgId);
    const variables = {
      units: String(unitsExpiring),
      expires_on: expiresOn,
    };

    let accepted = false;
    let providerRef: string | null = null;

    if (contact) {
      try {
        const receipt = await this.notifications.send({
          channel: 'SMS',
          to: contact.mobile,
          templateCode: WARNING_TEMPLATE,
          locale: contact.locale === 'hi' ? 'hi' : 'en',
          variables,
          // Stock silently unlisting costs the vendor money. That is
          // transactional by any reading, and it ignores marketing preferences.
          isTransactional: true,
        });
        accepted = receipt.accepted;
        providerRef = receipt.providerMessageId;
        if (!receipt.accepted) {
          this.logger.warn(`QC expiry warning to ${vendorOrgId} was refused: ${receipt.reason}`);
        }
      } catch (e) {
        this.logger.error(`QC expiry warning to ${vendorOrgId} failed: ${(e as Error).message}`);
      }
    } else {
      this.logger.warn(
        `Vendor ${vendorOrgId} has ${unitsExpiring} unit(s) expiring on ${expiresOn} and no active primary contact to warn.`,
      );
    }

    await this.prisma.$executeRaw`
      INSERT INTO platform.notification_log
        (org_id, user_id, channel, template_code, payload_json, status, provider_ref, sent_at)
      VALUES
        (${vendorOrgId}::uuid, ${contact?.userId ?? null}::uuid, 'SMS', ${WARNING_TEMPLATE},
         ${JSON.stringify(variables)}::jsonb, ${accepted ? 'SENT' : 'FAILED'},
         ${providerRef}, ${this.clock.now()})`;

    return accepted;
  }

  /**
   * Who to tell. A warehouse contact knows where the machines are; the owner
   * knows what it costs. Preference order, and any active primary after that.
   */
  private async primaryContact(
    orgId: string,
  ): Promise<{ mobile: string; locale: string; userId: string | null } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ mobile: string; preferred_language: string; user_id: string | null }>
    >`
      SELECT mobile, preferred_language, user_id
        FROM identity.org_contact
       WHERE org_id = ${orgId}::uuid AND is_active AND is_primary
       ORDER BY array_position(ARRAY['WAREHOUSE','OWNER','PROCUREMENT'], contact_type) NULLS LAST,
                contact_type
       LIMIT 1`;
    const row = rows[0];
    return row
      ? { mobile: row.mobile, locale: row.preferred_language, userId: row.user_id }
      : null;
  }

  /**
   * `platform.v_current_config`, read fresh — the view is effective-dated and
   * reading `platform_config` directly is how a future-dated row goes live early.
   * Missing keys fall back rather than throw: a job that refuses to run because
   * a knob is unset stops expiring stock as well as warning about it, and stale
   * sellable inventory is the worse of the two failures.
   */
  private async warningDays(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = ${WARNING_DAYS_KEY}`;
    const value = rows[0]?.value_json;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
    this.logger.warn(`${WARNING_DAYS_KEY} is unset or malformed; using ${DEFAULT_WARNING_DAYS}.`);
    return DEFAULT_WARNING_DAYS;
  }
}

/**
 * Calendar arithmetic on a `YYYY-MM-DD` string.
 *
 * Deliberately not `clock.plusDays()`: that adds 86 400 000 ms to an instant,
 * and the answer is then read back in UTC. Here the question is which *calendar
 * day* in Asia/Kolkata is fourteen days after today, which is a date question
 * and has no time component to get wrong.
 */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
