import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Money, moneyFromDb } from '@trugrade/contracts';
import { OtpService } from '../../identity';
import { PrismaService } from '../../../shared/db/prisma.service';
import { AppConfig } from '../../../shared/config';
import { ClockPort } from '../../../shared/clock';
import { EventBus } from '../../../shared/events';
import {
  IllegalStateTransitionError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { QcRepository, type QcVisitRow } from './qc.repository';
import type { QcUnitOutcome } from '../dto/qc.dto';

/**
 * Closing the visit: the vendor's signature, the money, and the moment the
 * passed units go live.
 *
 * Three things happen here and the order they happen in is the whole design.
 *
 * **The vendor signs first.** An OTP to the site contact, against a summary of
 * what was found — how many were inspected, how many passed, how many failed,
 * how many were never produced. This is the document that stops "you never told
 * me it failed" six weeks later when a machine is not on the storefront and
 * nobody remembers the conversation. `close()` refuses without it. The OTP
 * itself is never stored: `vendor_otp_hash` holds a SHA-256 of the code bound to
 * the visit, which is enough to prove the signature and useless to anyone who
 * reads the row.
 *
 * **Then the units move.** A passed unit goes QC_SEALED → LISTED, which is the
 * status `listing.unit_is_sellable()` requires; a failed one goes QC_FAILED and
 * stays there. That single-step difference is rule 1 of this phase: **a failed
 * unit is absent from the storefront, not dimmed and not out-of-stock.** It
 * never becomes sellable, so `listing.v_sellable_unit` — the only source a
 * buyer-facing query may read — never returns it. There is no "hidden" flag to
 * get wrong, because there is no row to hide.
 *
 * A passed unit that was never sealed cannot be listed and `close()` refuses the
 * whole visit rather than skipping it quietly. A seal-less sellable unit is
 * precisely what `listing.v_sellability_drift` exists to catch, and a close that
 * creates one at 6pm on a Friday is worse than a close that fails loudly at 5pm.
 *
 * **Then the listing catches up.** All units sellable → ACTIVE. Some →
 * PARTIALLY_ACTIVE. None → PAUSED, because a listing whose entire batch failed
 * is withdrawn pending the vendor's action, and OUT_OF_STOCK would be a claim
 * about supply that is not true.
 *
 * Expenses sit alongside all of this rather than inside it. `qc.v_visit_economics`
 * divides them by units inspected, and that number — cost per inspected unit — is
 * the one that says whether QC-at-source is a business or a subsidy.
 */

/** `qc_visit_expense.expense_type`, exactly as the CHECK allows it. */
export const EXPENSE_TYPES = Object.freeze([
  'TRAVEL',
  'FUEL',
  'TOLL',
  'PARKING',
  'FOOD',
  'ACCOMMODATION',
  'TOOL_LICENCE',
  'OTHER',
] as const);
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

/** The SMS the site contact reads before they type six digits back. */
const SIGNOFF_TEMPLATE = 'QC_VISIT_SIGNOFF';

const PASSED_OUTCOMES: readonly QcUnitOutcome[] = [
  'PASS',
  'PASS_WITH_NOTE',
  'PASS_GRADE_CORRECTED',
];
const FAILED_OUTCOMES: readonly QcUnitOutcome[] = ['FAIL', 'UNTESTABLE'];

export interface ExpenseInput {
  expenseType: ExpenseType;
  amount: Money;
  distanceKm?: number | null;
  receiptKey?: string | null;
}

export interface ExpenseRow {
  id: string;
  visitId: string;
  expenseType: ExpenseType;
  amount: Money;
  distanceKm: number | null;
  receiptKey: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface SignoffSummary {
  visitNumber: string;
  unitsPresented: number;
  unitsInspected: number;
  unitsPassed: number;
  unitsGradeCorrected: number;
  unitsFailed: number;
  unitsAbsent: number;
}

export interface SignoffRequest {
  otpId: string;
  expiresAt: Date;
  /** Masked, so a QC manager can confirm which number it went to. */
  sentTo: string;
  summary: SignoffSummary;
  /** Non-production only, so an E2E test does not need a mail-server scrape. */
  devCode?: string;
}

export interface CloseResult {
  visit: QcVisitRow;
  unitsListed: number;
  unitsFailed: number;
  /** Per listing: what it became and how many units a buyer can actually see. */
  listings: Array<{
    listingId: string;
    status: 'ACTIVE' | 'PARTIALLY_ACTIVE' | 'PAUSED';
    sellableUnits: number;
    totalUnits: number;
  }>;
}

@Injectable()
export class VisitClosingService {
  private readonly logger = new Logger(VisitClosingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly config: AppConfig,
    private readonly repo: QcRepository,
    private readonly otp: OtpService,
    private readonly bus: EventBus,
  ) {}

  // =========================================================================
  // Expenses
  // =========================================================================

  /**
   * One expense line against the visit.
   *
   * `receipt_key` is nullable in the schema and stays optional here. That is a
   * deliberate reading of SQL-is-the-source-of-truth rather than an oversight:
   * a ₹40 toll and a ₹20 parking charge in an Indian field operation frequently
   * have no receipt, and a service that refuses them produces one of two
   * outcomes — an unreimbursed technician, or a receipt that was invented. The
   * control on an unreceipted expense is `approved_by`, not a NOT NULL.
   */
  async recordExpense(visitId: string, input: ExpenseInput): Promise<ExpenseRow> {
    await this.mustFind(visitId);
    if (input.amount.isNegative()) {
      throw new ValidationError('An expense cannot be a negative amount.', {
        amount: 'Enter the amount spent.',
      });
    }
    if (input.distanceKm !== undefined && input.distanceKm !== null && input.distanceKm < 0) {
      throw new ValidationError('Distance cannot be negative.', {
        distanceKm: 'Enter the distance travelled.',
      });
    }

    const [row] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO qc.qc_visit_expense
        (visit_id, expense_type, amount, distance_km, receipt_key, created_at)
      VALUES
        (${visitId}::uuid, ${input.expenseType}, ${input.amount.toString()}::numeric,
         ${input.distanceKm === undefined || input.distanceKm === null ? null : String(input.distanceKm)}::numeric,
         ${input.receiptKey ?? null}, ${this.clock.now()})
      RETURNING id, visit_id, expense_type, amount, distance_km, receipt_key,
                approved_by, approved_at, created_at`;
    return toExpense(row!);
  }

  /** Every expense on a visit, and what they add up to. */
  async expenses(visitId: string): Promise<{ rows: ExpenseRow[]; total: Money }> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, visit_id, expense_type, amount, distance_km, receipt_key,
             approved_by, approved_at, created_at
        FROM qc.qc_visit_expense WHERE visit_id = ${visitId}::uuid
       ORDER BY created_at`;
    const mapped = rows.map(toExpense);
    return { rows: mapped, total: Money.sum(mapped.map((r) => r.amount)) };
  }

  // =========================================================================
  // Vendor sign-off
  // =========================================================================

  /**
   * Send the site contact a code, against the counters as they stand.
   *
   * The counters are recomputed from `qc_visit_unit` before the message goes
   * out, so the numbers the vendor is asked to sign for are the rows rather than
   * a cached total that drifted during the day. A summary that disagrees with
   * the manifest is worse than no summary: it is a document that will be quoted
   * back at us.
   */
  async requestSignoff(visitId: string): Promise<SignoffRequest> {
    const visit = await this.mustFind(visitId);
    if (visit.status !== 'IN_PROGRESS') {
      throw new IllegalStateTransitionError('qc_visit', visit.status, 'COMPLETED');
    }

    const counted = (await this.repo.recountVisit(visitId)) ?? visit;
    const contact = await this.siteContact(counted);

    const summary: SignoffSummary = {
      visitNumber: counted.visitNumber,
      unitsPresented: counted.unitsPresented ?? 0,
      unitsInspected: counted.unitsInspected,
      unitsPassed: counted.unitsPassed,
      unitsGradeCorrected: counted.unitsGradeCorrected,
      unitsFailed: counted.unitsFailed,
      unitsAbsent: counted.unitsAbsent,
    };

    const issued = await this.otp.issue({
      target: contact.mobile,
      purpose: 'QC_VISIT_SIGNOFF',
      channel: 'SMS',
      templateCode: SIGNOFF_TEMPLATE,
      refType: 'qc_visit',
      refId: visitId,
      isProduction: this.config.isProduction,
      variables: {
        visit_number: summary.visitNumber,
        inspected: String(summary.unitsInspected),
        passed: String(summary.unitsPassed),
        failed: String(summary.unitsFailed),
        absent: String(summary.unitsAbsent),
      },
    });

    return {
      otpId: issued.otpId,
      expiresAt: issued.expiresAt,
      sentTo: maskMobile(contact.mobile),
      summary,
      ...(issued.devCode ? { devCode: issued.devCode } : {}),
    };
  }

  /**
   * The signature.
   *
   * `vendor_otp_hash` is `sha256(visitId:code)` — salted with the visit, so the
   * same code used on two visits produces two different hashes and one leaked
   * row does not help against another. The plaintext code is never written
   * anywhere: the OTP lifecycle (TTL, attempt budget, burn on the last wrong
   * guess) belongs to `identity.OtpService`, which already does it properly, and
   * this column exists only so the signed document carries its own proof rather
   * than a foreign key into a table that gets pruned.
   */
  async signOff(visitId: string, input: { code: string; signedName: string }): Promise<QcVisitRow> {
    const visit = await this.mustFind(visitId);
    if (visit.status !== 'IN_PROGRESS') {
      throw new IllegalStateTransitionError('qc_visit', visit.status, 'COMPLETED');
    }
    const name = input.signedName?.trim();
    if (!name || name.length < 2) {
      throw new ValidationError('We need the name of the person signing off.', {
        signedName: 'Enter the signatory’s name.',
      });
    }

    const contact = await this.siteContact(visit);
    const verified = await this.otp.verify({
      target: contact.mobile,
      purpose: 'QC_VISIT_SIGNOFF',
      code: input.code,
    });
    if (verified.refType === 'qc_visit' && verified.refId !== visitId) {
      // VR-055 in miniature: a code issued for yesterday's visit at the same
      // warehouse must not sign today's.
      throw new ValidationError("This code isn't valid for this visit.", {
        code: 'Request a new code for this visit.',
      });
    }

    const updated = await this.repo.updateVisit(visitId, {
      vendorContactId: contact.id,
      vendorOtpHash: createHash('sha256').update(`${visitId}:${input.code}`).digest('hex'),
      vendorSignoffAt: this.clock.now(),
      vendorSignoffName: name,
    });
    return updated!;
  }

  // =========================================================================
  // Closing
  // =========================================================================

  /**
   * Total the counters, move the units, publish the listings, close the visit.
   *
   * One transaction. A close that listed the units and then failed to mark the
   * visit complete would leave stock live against a visit that ops still see as
   * in progress — and the obvious fix, running it again, would publish
   * `listing.published` twice.
   */
  async close(visitId: string): Promise<CloseResult> {
    const visit = await this.mustFind(visitId);
    if (visit.status !== 'IN_PROGRESS') {
      throw new IllegalStateTransitionError('qc_visit', visit.status, 'COMPLETED');
    }
    if (!visit.vendorSignoffAt) {
      throw new PreconditionFailedError(
        'The vendor has to sign off on what was found before the visit can be closed.',
        { visitId, reason: 'no_vendor_signoff' },
      );
    }

    const manifest = await this.repo.findVisitUnits({ visitId });
    const pending = manifest.filter((u) => u.outcome === 'PENDING');
    if (pending.length > 0) {
      // Closing over a PENDING row would silently record a machine as neither
      // inspected nor absent, and the vendor has just signed a summary that
      // counted it as presented.
      throw new PreconditionFailedError(
        `${pending.length} machine${pending.length === 1 ? '' : 's'} on this visit ${pending.length === 1 ? 'has' : 'have'} no outcome yet. Record each one as inspected or absent first.`,
        { visitId, pendingUnitIds: pending.map((u) => u.unitId), reason: 'units_pending' },
      );
    }

    const passed = manifest.filter((u) => PASSED_OUTCOMES.includes(u.outcome));
    const failed = manifest.filter((u) => FAILED_OUTCOMES.includes(u.outcome));
    const absent = manifest.filter((u) => u.outcome === 'ABSENT');

    return this.prisma.runInTransaction(async () => {
      await this.assertAllSealed(passed.map((u) => u.unitId));

      // Passed and sealed becomes LISTED, which is the last of the four things
      // `listing.unit_is_sellable()` wants. Failed becomes QC_FAILED and is
      // therefore invisible to every buyer-facing query — not hidden, absent.
      const listed = await this.setUnitStatus(
        passed.map((u) => u.unitId),
        'LISTED',
        'QC_SEALED',
      );
      await this.setUnitStatus(
        failed.map((u) => u.unitId),
        'QC_FAILED',
      );

      const counted = (await this.repo.recountVisit(visitId))!;
      const status = failed.length + absent.length > 0 ? 'PARTIALLY_COMPLETED' : 'COMPLETED';

      const listings = await this.republishListings(visitId, [
        ...new Set(manifest.map((u) => u.listingId).filter((id): id is string => !!id)),
      ]);

      const updated = await this.repo.updateVisit(visitId, {
        status,
        completedAt: this.clock.now(),
      });

      this.logger.log(
        `Visit ${counted.visitNumber} closed ${status}: ${listed} listed, ${failed.length} failed, ${absent.length} absent.`,
      );

      return {
        visit: updated!,
        unitsListed: listed,
        unitsFailed: failed.length,
        listings,
      };
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private async mustFind(visitId: string): Promise<QcVisitRow> {
    const visit = await this.repo.findVisitById(visitId);
    if (!visit) throw new NotFoundError('inspection visit', { visitId });
    return visit;
  }

  /**
   * Who signs. The warehouse contact was in the room; the owner is accountable.
   *
   * The visit's own `vendor_contact_id` wins when one was recorded at booking —
   * that is the person the technician arranged the day with.
   */
  private async siteContact(visit: QcVisitRow): Promise<{ id: string; mobile: string }> {
    const [row] = await this.prisma.$queryRaw<Array<{ id: string; mobile: string }>>`
      SELECT id, mobile
        FROM identity.org_contact
       WHERE is_active
         AND (id = ${visit.vendorContactId ?? null}::uuid
              OR (${visit.vendorContactId ?? null}::uuid IS NULL
                  AND org_id = ${visit.vendorOrgId}::uuid
                  AND contact_type IN ('WAREHOUSE', 'OWNER', 'AUTHORISED_SIGNATORY')))
       ORDER BY CASE contact_type
                  WHEN 'WAREHOUSE' THEN 0 WHEN 'OWNER' THEN 1 ELSE 2 END,
                is_primary DESC
       LIMIT 1`;
    if (!row) {
      throw new PreconditionFailedError(
        'This vendor has no active site contact to sign off the visit. Add one to their profile first.',
        { vendorOrgId: visit.vendorOrgId, reason: 'no_site_contact' },
      );
    }
    return row;
  }

  /**
   * Every passed unit must already carry a seal, or nothing is listed.
   *
   * The seal is what makes the inspection meaningful three weeks later, so a
   * passed-but-unsealed unit is not a listable machine with a missing sticker —
   * it is a machine we cannot make a claim about. Refusing the close names the
   * units so the technician can go and seal them.
   */
  private async assertAllSealed(unitIds: readonly string[]): Promise<void> {
    if (unitIds.length === 0) return;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
      SELECT id, serial_number FROM listing.unit
       WHERE id = ANY(${[...unitIds]}::text[]::uuid[])
         AND (status <> 'QC_SEALED' OR seal_id IS NULL)`;
    if (rows.length > 0) {
      throw new PreconditionFailedError(
        `${rows.length} machine${rows.length === 1 ? '' : 's'} passed inspection but ${rows.length === 1 ? 'is' : 'are'} not sealed yet. Apply and photograph the seal before closing.`,
        { serials: rows.map((r) => r.serial_number), reason: 'passed_but_unsealed' },
      );
    }
  }

  /**
   * Move units, optionally only from an expected status.
   *
   * `from` is the guard that keeps a unit from skipping the seal: LISTED is only
   * ever reachable from QC_SEALED, so a unit that never went through
   * `SealingService` simply does not move — and `assertAllSealed` has already
   * made that impossible to reach silently.
   */
  private async setUnitStatus(
    unitIds: readonly string[],
    to: string,
    from?: string,
  ): Promise<number> {
    if (unitIds.length === 0) return 0;
    return this.prisma.$executeRaw`
      UPDATE listing.unit
         SET status = ${to}::public.unit_status
       WHERE id = ANY(${[...unitIds]}::text[]::uuid[])
         AND (${from ?? null}::text IS NULL OR status = ${from ?? null}::public.unit_status)
         AND status <> ${to}::public.unit_status`;
  }

  /**
   * Bring each listing's status in line with what a buyer can actually see.
   *
   * The sellable count is read from `listing.v_sellable_unit`, not derived from
   * the outcomes above. That matters: the view applies the live predicate — QC
   * fresh *today*, seal still APPLIED or INTACT — so a unit that passed but whose
   * QC report was never dated, or whose seal was broken between sealing and
   * closing, is counted as what it is rather than as what the visit expected.
   * The number in `listing.published` is therefore the number a buyer will see.
   */
  private async republishListings(
    visitId: string,
    listingIds: readonly string[],
  ): Promise<CloseResult['listings']> {
    if (listingIds.length === 0) return [];

    const rows = await this.prisma.$queryRaw<
      Array<{ listing_id: string; sku_id: string; total: number; sellable: number }>
    >`
      SELECT u.listing_id,
             l.sku_id,
             COUNT(*)::int      AS total,
             COUNT(sv.id)::int  AS sellable
        FROM listing.unit u
        JOIN listing.listing l ON l.id = u.listing_id
        LEFT JOIN listing.v_sellable_unit sv ON sv.id = u.id
       WHERE u.listing_id = ANY(${[...listingIds]}::text[]::uuid[])
       GROUP BY u.listing_id, l.sku_id`;

    const out: CloseResult['listings'] = [];
    for (const row of rows) {
      const status =
        row.sellable === 0
          ? // Nothing to sell. PAUSED rather than OUT_OF_STOCK: the batch did not
            // sell out, it did not pass, and the vendor has something to fix.
            'PAUSED'
          : row.sellable === row.total
            ? 'ACTIVE'
            : 'PARTIALLY_ACTIVE';

      await this.prisma.$executeRaw`
        UPDATE listing.listing
           SET status          = ${status}::public.listing_status,
               qc_completed_at = ${this.clock.now()},
               qc_visit_id     = ${visitId}::uuid,
               updated_at      = ${this.clock.now()}
         WHERE id = ${row.listing_id}::uuid`;

      await this.bus.publish('listing.published', {
        listingId: row.listing_id,
        skuId: row.sku_id,
        sellableUnitCount: row.sellable,
        partial: row.sellable !== row.total,
      });

      out.push({
        listingId: row.listing_id,
        status,
        sellableUnits: row.sellable,
        totalUnits: row.total,
      });
    }
    return out;
  }
}

function toExpense(r: Record<string, unknown>): ExpenseRow {
  return {
    id: r.id as string,
    visitId: r.visit_id as string,
    expenseType: r.expense_type as ExpenseType,
    // NUMERIC(14,2) and genuinely money. `Number(r.amount)` here is the float
    // bug that turns ₹1,234.56 of fuel into a cost-per-unit nobody can tie out.
    amount: moneyFromDb(r.amount as string) ?? Money.ZERO,
    // A distance, not money.
    distanceKm:
      r.distance_km === null || r.distance_km === undefined ? null : Number(r.distance_km),
    receiptKey: r.receipt_key as string | null,
    approvedBy: r.approved_by as string | null,
    approvedAt: r.approved_at as Date | null,
    createdAt: r.created_at as Date,
  };
}

/** `91xxxxxx21` — enough for a QC manager to confirm which number it went to, not to dial it. */
function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 6) return '••••';
  return `${digits.slice(0, 2)}${'x'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
}
