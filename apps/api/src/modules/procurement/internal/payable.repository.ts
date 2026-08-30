import { Injectable } from '@nestjs/common';
import { OrgScope } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError } from '../../../shared/errors/domain-errors';

/**
 * Everything behind `/vendor/payables`, scoped to one org.
 *
 * Same discipline as `PurchaseOrderRepository`: the org predicate is in the
 * `WHERE`, no method takes a vendor id, and each statement touches one module
 * schema so `no-cross-schema-join` never has to be argued with. Five schemas are
 * involved — `procurement` for the payable, `ordering` for when the machines
 * actually arrived, `vendor` for the MSME registration, `kyc` for the bank
 * account, `platform` for the config that governs the clock — and they are five
 * statements.
 *
 * **Nothing here computes a date.** The repository returns what is recorded;
 * `PayableService` applies the rule against the injected clock, because every
 * date on this screen is a money deadline and a browser must not be able to move
 * one.
 */

export interface PayableRow {
  id: string;
  purchase_order_id: string;
  order_id: string;
  po_number: string;
  po_status: string;
  terms_days: number;
  units: bigint;
  gross: string;
  tds: string;
  penalties: string;
  qc_fee: string;
  net_payable: string;
  status: string;
  hold_reason: string | null;
  /**
   * **Null on all 17 rows in the dev database, and nothing writes it.**
   *
   * `04_TEST_PLAN`/§4.8 make this the instant a payable becomes eligible; no
   * code path sets it. It is carried through to the screen as null rather than
   * substituted, because "we have not recorded that this became payable" and
   * "it becomes payable on the 3rd" are different sentences.
   */
  eligible_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
}

/** When the machines on one purchase order actually reached the buyer. */
export interface DeliveryRow {
  order_id: string;
  delivered_at: Date | null;
  status: string;
}

export interface BankRow {
  account_number_last4: string;
  account_holder_name: string;
  bank_name: string | null;
  penny_drop_status: string;
  verified_at: Date | null;
  frozen_until: Date | null;
}

@Injectable()
export class PayableRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrgScope,
  ) {}

  vendorOrgId(): string {
    const orgId = this.scope.currentOrgId;
    if (!orgId) {
      throw new ForbiddenError(
        'This is one vendor’s money, so one has to be signed in.',
        { reason: 'vendor_route_without_org' },
      );
    }
    return orgId;
  }

  /**
   * The vendor's payables, newest first.
   *
   * Not paginated. Seventeen rows exist across six vendors and the largest
   * single position is five; more to the point, this screen is a statement — a
   * vendor reading what they are owed and finding it stopped at row 25 would
   * reconcile against an incomplete figure without noticing. If a vendor ever
   * carries hundreds of open payables this needs paging AND a server-side total
   * that does not come from the page, in that order.
   */
  async list(status?: string): Promise<PayableRow[]> {
    const orgId = this.vendorOrgId();
    const wanted = status ?? null;
    return this.prisma.$queryRaw<PayableRow[]>`
      SELECT vp.id, vp.purchase_order_id, po.order_id, po.po_number,
             po.status::text AS po_status, po.terms_days,
             (SELECT count(*) FROM procurement.purchase_order_line l
               WHERE l.po_id = po.id)                       AS units,
             vp.gross::text        AS gross,
             vp.tds::text          AS tds,
             vp.penalties::text    AS penalties,
             vp.qc_fee::text       AS qc_fee,
             vp.net_payable::text  AS net_payable,
             vp.status, vp.hold_reason, vp.eligible_at, vp.paid_at, vp.created_at
        FROM procurement.vendor_payable vp
        JOIN procurement.purchase_order po ON po.id = vp.purchase_order_id
       WHERE vp.vendor_org_id = ${orgId}::uuid
         AND (${wanted}::text IS NULL OR vp.status = ${wanted}::text)
       ORDER BY vp.created_at DESC`;
  }


  /**
   * When each of those orders was delivered.
   *
   * `ordering.sub_order` and not `logistics.shipment`: the sub-order is the
   * vendor's own half of an order (`uq_po_order_vendor` gives one purchase order
   * per vendor per order, so the two are one to one), and `delivered_at` on it
   * is the instant the 48-hour inspection window starts from. `logistics` has
   * the same column and no rows behind it — no writer exists there yet.
   *
   * Scoped on `vendor_org_id` on its own terms rather than trusting the caller
   * to have filtered the order ids first.
   */
  async deliveriesFor(orderIds: readonly string[]): Promise<Map<string, DeliveryRow>> {
    if (orderIds.length === 0) return new Map();
    const orgId = this.vendorOrgId();
    const rows = await this.prisma.$queryRaw<DeliveryRow[]>`
      SELECT order_id, delivered_at, status::text AS status
        FROM ordering.sub_order
       WHERE order_id = ANY(${[...orderIds]}::uuid[]) AND vendor_org_id = ${orgId}::uuid`;
    return new Map(rows.map((r) => [r.order_id, r]));
  }

  /**
   * The MSME registration, if there is one.
   *
   * `vendor.vendor_profile.msme_udyam_no` is where a verified Udyam number
   * lands (`/vendor/register/statutory` step 3, promoted by
   * `vendor/internal/promotion.service.ts`). A non-null value is the whole
   * signal: `kyc.verification_check` has no UDYAM check type, so the record IS
   * the registration and the screen says "on record" rather than claiming an
   * API verification this platform does not perform.
   */
  async msmeUdyamNumber(): Promise<string | null> {
    const orgId = this.vendorOrgId();
    const [row] = await this.prisma.$queryRaw<Array<{ msme_udyam_no: string | null }>>`
      SELECT msme_udyam_no FROM vendor.vendor_profile WHERE org_id = ${orgId}::uuid`;
    return row?.msme_udyam_no ?? null;
  }

  /**
   * The account the money would go to.
   *
   * Four display fields and the verification state. **Never `account_number_enc`
   * and never the decrypted number** — the last four digits are what a person
   * uses to recognise their own account, and the full number on a screen is a
   * number in a screenshot.
   */
  async payoutBankAccount(): Promise<BankRow | null> {
    const orgId = this.vendorOrgId();
    const [row] = await this.prisma.$queryRaw<BankRow[]>`
      SELECT account_number_last4, account_holder_name, bank_name,
             penny_drop_status, verified_at, frozen_until
        FROM kyc.bank_account
       WHERE org_id = ${orgId}::uuid AND purpose = 'PAYOUT'
       ORDER BY is_default DESC, created_at DESC
       LIMIT 1`;
    return row ?? null;
  }

  /**
   * How many payout runs have ever included this vendor.
   *
   * Zero, on every database this has been run against, because nothing writes
   * `procurement.payout_run` or `payout_line` — the tables exist and no code
   * path creates a row. The count is read rather than assumed so the screen
   * stops saying "no payout has been run" the day one is.
   */
  async payoutLineCount(): Promise<number> {
    const orgId = this.vendorOrgId();
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM procurement.payout_line
       WHERE vendor_org_id = ${orgId}::uuid`;
    return Number(row?.n ?? 0);
  }

  /** Purchases from this vendor so far this tax year — the TDS threshold base. */
  async purchasesThisFinancialYear(financialYear: string): Promise<string | null> {
    const orgId = this.vendorOrgId();
    const [row] = await this.prisma.$queryRaw<Array<{ gross_to_date: string | null }>>`
      SELECT gross_to_date::text AS gross_to_date
        FROM procurement.v_vendor_fy_purchases
       WHERE vendor_org_id = ${orgId}::uuid AND financial_year = ${financialYear}`;
    return row?.gross_to_date ?? null;
  }

  /** Whether this vendor has a verified PAN — it decides the TDS rate, not the amount. */
  async hasVerifiedPan(): Promise<boolean> {
    const orgId = this.vendorOrgId();
    const [row] = await this.prisma.$queryRaw<Array<{ verified: boolean }>>`
      SELECT verified FROM kyc.pan_record WHERE org_id = ${orgId}::uuid`;
    return row?.verified === true;
  }

  /**
   * The config keys this screen's clock and its TDS line are built from.
   *
   * `v_current_config` and not `platform_config`: config is effective-dated, and
   * reading the table directly is how a future-dated row goes live early. A key
   * that is absent comes back absent — the caller renders "not configured"
   * rather than substituting a plausible number, because a payment deadline
   * nobody set is not 45 days.
   */
  async config(keys: readonly string[]): Promise<Map<string, unknown>> {
    const rows = await this.prisma.$queryRaw<Array<{ key: string; value_json: unknown }>>`
      SELECT key, value_json FROM platform.v_current_config
       WHERE key = ANY(${[...keys]}::text[])`;
    return new Map(rows.map((r) => [r.key, r.value_json]));
  }
}
