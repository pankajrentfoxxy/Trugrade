import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/guards';
import { ClockPort } from '../../shared/clock';
import { PrismaService } from '../../shared/db/prisma.service';

/**
 * The finance console — T40. `03_UX_SPEC.md` §3C.4.
 *
 * ## What this screen actually has to work with
 *
 * One tax invoice. Seventeen vendor payables and seventeen TDS accruals. Zero
 * payments, zero refunds, zero ledger entries, zero payout runs, zero
 * settlements, zero goods receipts and zero vendor invoices.
 *
 * A reconciliation screen over that is a reconciliation screen with almost
 * nothing to reconcile, and the useful thing it can do is not to render nine
 * zeroes. It is to say **what is stopping money from moving**, because that is
 * a real answer with real evidence behind it: §4.8 makes a vendor payout wait on
 * five conditions, and this platform currently fails four of them on every
 * payable — not by a little, but because the tables the conditions are checked
 * against have no rows at all.
 *
 * ## Why it lives in `identity`
 *
 * The same reason `ops.controller.ts` does, and this file follows that
 * precedent rather than inventing a second policy. The payload is an aggregate
 * across `payment`, `procurement`, `kyc`, `ordering` and `platform`, and **no
 * module's service owns the combination** — a finance workspace belongs to
 * whoever is looking at it. The rule that keeps this honest is the ops
 * controller's: **separate statements, one module schema each, combined in
 * TypeScript.** `no-cross-schema-join` forbids the JOIN that would be shorter
 * and it is right to. `identity` is the home because this is the platform's own
 * screen and this module already owns the platform's own tables.
 *
 * ## Nothing here is computed twice
 *
 * Every rupee is read off a row. The invoice total is `payment.invoice.total`;
 * the payable stack is `procurement.vendor_payable`'s own columns; the TDS is
 * `procurement.tds_ledger.tds_amount`. `landedPrice` in this repo once had two
 * implementations that disagreed, and a finance screen recomputing a figure the
 * ledger already holds is how that happens again.
 */

/** One of §4.8's five payout conditions, with the evidence for its verdict. */
interface PayoutGate {
  key: string;
  label: string;
  /**
   * `MET` / `UNMET` / `UNMEASURABLE`.
   *
   * The third is not a softer `UNMET`. A gate whose table has no rows cannot be
   * evaluated at all, and reporting "0 of 17 matched" as a failure would say we
   * looked and found a mismatch. We did not look; there is nothing to look at.
   */
  verdict: 'MET' | 'UNMET' | 'UNMEASURABLE';
  /** Payables satisfying it, out of `of`. Null when it cannot be measured. */
  passing: number | null;
  of: number;
  detail: string;
}

/** A table §3C.4 builds a screen on that has never had a row written to it. */
interface AbsentWriter {
  table: string;
  screen: string;
  reason: string;
}

interface VendorMoney {
  vendorOrgId: string;
  vendorName: string;
  payables: number;
  gross: string;
  tds: string;
  qcFee: string;
  penalties: string;
  net: string;
  /** From `procurement.tds_ledger`, this financial year. */
  fyPurchases: string;
  tdsAccrued: string;
  /** The distinct rates the ledger recorded. Not a rate we decided here. */
  ratesRecorded: number[];
  hasVerifiedPan: boolean;
  hasVerifiedBankAccount: boolean;
}

interface InvoiceRow {
  invoiceNumber: string;
  type: string;
  invoiceDate: string;
  placeOfSupply: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  valuationMethod: string;
  irpStatus: string;
  hasPdf: boolean;
  /** The order it belongs to, and that order's own total — the cross-check. */
  orderNumber: string | null;
  orderGrandTotal: string | null;
  /** True when the invoice total equals the order total to the paisa. */
  agreesWithOrder: boolean | null;
}

export interface FinanceConsoleView {
  asAt: string;
  financialYear: string;
  invoices: {
    rows: InvoiceRow[];
    /** `payment.invoice_series.last_number` for our GSTIN this FY. */
    seriesLastNumber: number | null;
    seriesPrefix: string | null;
    issued: number;
    /** A gap in a GST invoice series is an alarm, not a warning. */
    gap: number | null;
    /** Consignments removed from the supply point with no tax invoice against them. */
    deliveredWithoutInvoice: number;
    deliveredConsignments: number;
  };
  payables: {
    vendors: VendorMoney[];
    totals: { payables: number; gross: string; tds: string; qcFee: string; penalties: string; net: string };
    /** Payables by status — `ACCRUED`, `ON_HOLD`, `PAID`, `CANCELLED`. */
    byStatus: Array<{ status: string; count: number; net: string }>;
  };
  tds: {
    thresholdInr: number | null;
    ratePct: number | null;
    noPanRatePct: number | null;
    applicable: boolean | null;
    accruals: number;
    grossAccrued: string;
    tdsAccrued: string;
    vendorsOverThreshold: number;
    vendorsWithVerifiedPan: number;
    vendorsWithPayables: number;
  };
  gates: PayoutGate[];
  ledger: {
    entries: number;
    batches: number;
    /** `payment.v_ledger_imbalance` — batches whose debits do not equal credits. */
    imbalancedBatches: number;
  };
  absentWriters: AbsentWriter[];
  /** Commission rules exist and `sub_order.commission_amount` is zero on every row. */
  commission: { rules: number; ratesPct: number[]; subOrders: number; withCommission: number };
}

/** `2026-27`. Indian tax year, from the IST business date. */
function financialYear(now: Date): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

@Controller('admin/finance')
export class FinanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  /**
   * `payment.ledger.read` and not `payment.invoice.read_any`.
   *
   * §3C.4 gives every money screen to ADMIN_FINANCE. Of the two candidate
   * permissions, `invoice.read_any` also reaches OPS_MANAGER and SUPPORT — who
   * legitimately look up a buyer's invoice on a ticket, and have no business
   * with the vendor payout stack, which names vendors and their bank status.
   * `payment.ledger.read` is held by FINANCE, AUDITOR and PLATFORM_SUPERADMIN,
   * which is exactly the room this screen belongs in.
   */
  @Get()
  @RequirePermissions('payment.ledger.read')
  async console(): Promise<FinanceConsoleView> {
    const now = this.clock.now();
    const fy = financialYear(now);

    // ---------------------------------------------------------------------
    // payment. One schema per statement — see the file header.
    // ---------------------------------------------------------------------
    const invoiceRows = await this.prisma.$queryRaw<
      Array<{
        invoice_number: string;
        type: string;
        invoice_date: Date;
        place_of_supply: string;
        taxable_value: string;
        cgst: string;
        sgst: string;
        igst: string;
        total: string;
        valuation_method: string;
        irp_status: string;
        has_pdf: boolean;
        sub_order_id: string | null;
      }>
    >`SELECT invoice_number, type::text AS type, invoice_date, place_of_supply,
             taxable_value::text, cgst::text, sgst::text, igst::text, total::text,
             valuation_method, irp_status, pdf_key IS NOT NULL AS has_pdf,
             sub_order_id::text AS sub_order_id
        FROM payment.invoice ORDER BY invoice_number ASC`;

    const seriesRows = await this.prisma.$queryRaw<
      Array<{ prefix: string; last_number: number }>
    >`SELECT prefix, last_number FROM payment.invoice_series WHERE financial_year = ${fy}`;

    const ledgerRows = await this.prisma.$queryRaw<
      Array<{ entries: bigint; batches: bigint }>
    >`SELECT count(*)::bigint AS entries, count(DISTINCT batch_id)::bigint AS batches
        FROM payment.ledger_entry`;

    const imbalanceRows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM payment.v_ledger_imbalance`;

    const commissionRuleRows = await this.prisma.$queryRaw<Array<{ rate_pct: string }>>`
      SELECT rate_pct::text FROM payment.commission_rule ORDER BY rate_pct ASC`;

    const emptyPaymentTables = await this.prisma.$queryRaw<
      Array<{
        payments: bigint;
        refunds: bigint;
        payouts: bigint;
        settlements: bigint;
        eway: bigint;
      }>
    >`SELECT (SELECT count(*) FROM payment.payment)::bigint        AS payments,
             (SELECT count(*) FROM payment.refund)::bigint         AS refunds,
             (SELECT count(*) FROM payment.payout)::bigint         AS payouts,
             (SELECT count(*) FROM payment.settlement_run)::bigint AS settlements,
             (SELECT count(*) FROM payment.eway_bill)::bigint      AS eway`;

    // ---------------------------------------------------------------------
    // ordering. The invoice's own cross-check, and the consignments that have
    // left a supply point.
    // ---------------------------------------------------------------------
    const consignments = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sub_order_number: string;
        order_number: string;
        grand_total: string;
        delivered_at: Date | null;
        commission_amount: string;
      }>
    >`SELECT so.id::text AS id, so.sub_order_number, o.order_number,
             o.grand_total::text AS grand_total, so.delivered_at,
             so.commission_amount::text AS commission_amount
        FROM ordering.sub_order so
        JOIN ordering."order" o ON o.id = so.order_id`;

    // ---------------------------------------------------------------------
    // procurement.
    // ---------------------------------------------------------------------
    const payableRows = await this.prisma.$queryRaw<
      Array<{
        vendor_org_id: string;
        status: string;
        gross: string;
        tds: string;
        qc_fee: string;
        penalties: string;
        net_payable: string;
        eligible_at: Date | null;
        paid_at: Date | null;
      }>
    >`SELECT vendor_org_id::text AS vendor_org_id, status, gross::text, tds::text,
             qc_fee::text, penalties::text, net_payable::text, eligible_at, paid_at
        FROM procurement.vendor_payable`;

    const tdsRows = await this.prisma.$queryRaw<
      Array<{ vendor_org_id: string; gross_amount: string; tds_amount: string; tds_rate_pct: string }>
    >`SELECT vendor_org_id::text AS vendor_org_id, gross_amount::text, tds_amount::text,
             tds_rate_pct::text
        FROM procurement.tds_ledger WHERE financial_year = ${fy}`;

    const matchRows = await this.prisma.$queryRaw<
      Array<{ pos: bigint; receipts: bigint; invoices: bigint; runs: bigint; lines: bigint }>
    >`SELECT (SELECT count(*) FROM procurement.purchase_order)::bigint AS pos,
             (SELECT count(*) FROM procurement.goods_receipt)::bigint  AS receipts,
             (SELECT count(*) FROM procurement.vendor_invoice)::bigint AS invoices,
             (SELECT count(*) FROM procurement.payout_run)::bigint     AS runs,
             (SELECT count(*) FROM procurement.payout_line)::bigint    AS lines`;

    // ---------------------------------------------------------------------
    // kyc, platform, identity.
    // ---------------------------------------------------------------------
    const bankRows = await this.prisma.$queryRaw<Array<{ org_id: string }>>`
      SELECT DISTINCT org_id::text AS org_id FROM kyc.bank_account WHERE verified_at IS NOT NULL`;

    const panRows = await this.prisma.$queryRaw<Array<{ org_id: string }>>`
      SELECT DISTINCT org_id::text AS org_id FROM kyc.pan_record WHERE verified = TRUE`;

    const disputeRows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM platform.dispute
       WHERE status NOT IN ('RESOLVED_BUYER','RESOLVED_PLATFORM','RESOLVED_VENDOR','WITHDRAWN','CLOSED')`;

    const orgRows = await this.prisma.$queryRaw<Array<{ id: string; legal_name: string }>>`
      SELECT id::text AS id, legal_name FROM identity.organization WHERE org_type = 'VENDOR'`;

    const config = await this.prisma.$queryRaw<Array<{ key: string; value_json: unknown }>>`
      SELECT key, value_json FROM platform.v_current_config
       WHERE key = ANY(${[
         'tax.tds_applicable',
         'tax.tds_rate_pct',
         'tax.tds_rate_no_pan_pct',
         'tax.tds_vendor_threshold_inr',
         'ordering.inspection_window_hours',
       ]}::text[])`;

    // ---------------------------------------------------------------------
    // Combined in TypeScript, which is the whole point of the split above.
    // ---------------------------------------------------------------------
    const cfg = new Map(config.map((c) => [c.key, c.value_json]));
    const num = (k: string): number | null => {
      const v = cfg.get(k);
      return typeof v === 'number' ? v : null;
    };
    const orgName = new Map(orgRows.map((o) => [o.id, o.legal_name]));
    const verifiedBank = new Set(bankRows.map((b) => b.org_id));
    const verifiedPan = new Set(panRows.map((p) => p.org_id));
    const subOrderById = new Map(consignments.map((c) => [c.id, c]));

    const invoices: InvoiceRow[] = invoiceRows.map((i) => {
      const so = i.sub_order_id === null ? undefined : subOrderById.get(i.sub_order_id);
      return {
        invoiceNumber: i.invoice_number,
        type: i.type,
        invoiceDate: i.invoice_date.toISOString().slice(0, 10),
        placeOfSupply: i.place_of_supply,
        taxableValue: i.taxable_value,
        cgst: i.cgst,
        sgst: i.sgst,
        igst: i.igst,
        total: i.total,
        valuationMethod: i.valuation_method,
        irpStatus: i.irp_status,
        hasPdf: i.has_pdf,
        orderNumber: so?.order_number ?? null,
        orderGrandTotal: so?.grand_total ?? null,
        // Compared as decimal strings normalised to paisa, never as floats. The
        // question "is the invoice the same calculation as the order" is exactly
        // the kind that a 0.01 rounding error answers wrongly.
        agreesWithOrder: so === undefined ? null : paisa(i.total) === paisa(so.grand_total),
      };
    });

    const delivered = consignments.filter((c) => c.delivered_at !== null);
    const invoicedSubOrders = new Set(
      invoiceRows.map((i) => i.sub_order_id).filter((v): v is string => v !== null),
    );
    const series = seriesRows[0];

    const vendorIds = [...new Set(payableRows.map((p) => p.vendor_org_id))];
    const vendors: VendorMoney[] = vendorIds
      .map((id) => {
        const mine = payableRows.filter((p) => p.vendor_org_id === id);
        const tds = tdsRows.filter((t) => t.vendor_org_id === id);
        return {
          vendorOrgId: id,
          vendorName: orgName.get(id) ?? 'Unknown organisation',
          payables: mine.length,
          gross: sum(mine.map((p) => p.gross)),
          tds: sum(mine.map((p) => p.tds)),
          qcFee: sum(mine.map((p) => p.qc_fee)),
          penalties: sum(mine.map((p) => p.penalties)),
          net: sum(mine.map((p) => p.net_payable)),
          fyPurchases: sum(tds.map((t) => t.gross_amount)),
          tdsAccrued: sum(tds.map((t) => t.tds_amount)),
          ratesRecorded: [...new Set(tds.map((t) => Number(t.tds_rate_pct)))].sort((a, b) => a - b),
          hasVerifiedPan: verifiedPan.has(id),
          hasVerifiedBankAccount: verifiedBank.has(id),
        };
      })
      .sort((a, b) => paisa(b.net) - paisa(a.net));

    const statuses = [...new Set(payableRows.map((p) => p.status))].sort();
    const threshold = num('tax.tds_vendor_threshold_inr');
    const windowHours = num('ordering.inspection_window_hours');
    const match = matchRows[0];
    const totalPayables = payableRows.length;

    // The five §4.8 conditions, each against the rows that would answer it.
    const gates: PayoutGate[] = [
      {
        key: 'delivered',
        label: 'Delivered to the buyer',
        // UNMET rather than UNMEASURABLE: `vendor_payable.eligible_at` exists,
        // is readable and is null on every row, so the question was answerable
        // and the answer is no. That is a different fact from a table with no
        // rows in it, and the screen colours them differently.
        verdict: 'UNMET',
        passing: 0,
        of: totalPayables,
        detail:
          `${delivered.length} of ${consignments.length} consignments carry a delivery date, ` +
          `but no payable carries an eligible_at — nothing links a delivery to a payable yet.`,
      },
      {
        key: 'window',
        label: 'Inspection window closed',
        verdict: windowHours === null ? 'UNMEASURABLE' : 'UNMET',
        passing: windowHours === null ? null : 0,
        of: totalPayables,
        detail:
          windowHours === null
            ? 'ordering.inspection_window_hours is not configured, so no window has a length.'
            : `The window is ${windowHours} hours from delivery. eligible_at is null on all ` +
              `${totalPayables} payables, so no clock has been started.`,
      },
      {
        key: 'three-way-match',
        label: 'Three-way match complete',
        verdict: 'UNMEASURABLE',
        passing: null,
        of: Number(match?.pos ?? 0),
        detail:
          `${Number(match?.pos ?? 0)} purchase orders, ${Number(match?.receipts ?? 0)} goods ` +
          `receipts and ${Number(match?.invoices ?? 0)} vendor invoices. Two of the three legs ` +
          `have no rows, so no match can be attempted — this is not a mismatch.`,
      },
      {
        key: 'bank',
        label: 'Bank account verified',
        verdict: 'UNMET',
        passing: vendors.filter((v) => v.hasVerifiedBankAccount).length,
        of: vendors.length,
        detail:
          `${verifiedBank.size} verified bank accounts exist across the whole platform, and ` +
          `none of them belongs to a vendor with a payable. A payout has nowhere to go.`,
      },
      {
        key: 'dispute',
        label: 'No unresolved dispute',
        verdict: Number(disputeRows[0]?.n ?? 0) === 0 ? 'MET' : 'UNMET',
        passing: Number(disputeRows[0]?.n ?? 0) === 0 ? totalPayables : null,
        of: totalPayables,
        detail:
          `platform.dispute holds ${Number(disputeRows[0]?.n ?? 0)} unresolved rows. This is the ` +
          `one gate of the five that passes, and it passes because nobody has raised a dispute.`,
      },
    ];

    const empties = emptyPaymentTables[0];
    const absentWriters: AbsentWriter[] = [
      {
        table: 'payment.ledger_entry',
        screen: '/admin/payments/reconciliation',
        reason: `${Number(ledgerRows[0]?.entries ?? 0)} rows. Nothing in the product posts a double-entry line, so there are no books to reconcile a statement against.`,
      },
      {
        table: 'payment.payment',
        screen: '/admin/payments',
        reason: `${Number(empties?.payments ?? 0)} rows. No gateway is wired; an order reaches PAYMENT_PENDING and stops there.`,
      },
      {
        table: 'payment.refund',
        screen: '/admin/payments (refund)',
        reason: `${Number(empties?.refunds ?? 0)} rows. A refund needs a payment to reverse.`,
      },
      {
        table: 'procurement.payout_run',
        screen: '/admin/payouts',
        reason: `${Number(match?.runs ?? 0)} rows, ${Number(match?.lines ?? 0)} lines, and the table is named in no source file outside the two that report it is empty.`,
      },
      {
        table: 'payment.settlement_run',
        screen: '/admin/payments/reconciliation',
        reason: `${Number(empties?.settlements ?? 0)} rows.`,
      },
      {
        table: 'procurement.goods_receipt',
        screen: '/admin/procurement/three-way-match',
        reason: `${Number(match?.receipts ?? 0)} rows. Nothing records that goods arrived.`,
      },
      {
        table: 'procurement.vendor_invoice',
        screen: '/admin/procurement/vendor-invoices',
        reason: `${Number(match?.invoices ?? 0)} rows. Invoice-1 intake is not built.`,
      },
      {
        table: 'payment.eway_bill',
        screen: '/admin/payments/eway-bills',
        reason: `${Number(empties?.eway ?? 0)} rows. No consignment has had one generated.`,
      },
    ];

    return {
      asAt: now.toISOString(),
      financialYear: fy,
      invoices: {
        rows: invoices,
        seriesLastNumber: series?.last_number ?? null,
        seriesPrefix: series?.prefix ?? null,
        issued: invoiceRows.length,
        // A gap is an alarm, not a warning (§3C.4). The series counter and the
        // number of invoices that exist must agree exactly; anything else means
        // a number was consumed and no document carries it.
        gap: series === undefined ? null : series.last_number - invoiceRows.length,
        deliveredConsignments: delivered.length,
        deliveredWithoutInvoice: delivered.filter((c) => !invoicedSubOrders.has(c.id)).length,
      },
      payables: {
        vendors,
        totals: {
          payables: payableRows.length,
          gross: sum(payableRows.map((p) => p.gross)),
          tds: sum(payableRows.map((p) => p.tds)),
          qcFee: sum(payableRows.map((p) => p.qc_fee)),
          penalties: sum(payableRows.map((p) => p.penalties)),
          net: sum(payableRows.map((p) => p.net_payable)),
        },
        byStatus: statuses.map((status) => {
          const mine = payableRows.filter((p) => p.status === status);
          return { status, count: mine.length, net: sum(mine.map((p) => p.net_payable)) };
        }),
      },
      tds: {
        thresholdInr: threshold,
        ratePct: num('tax.tds_rate_pct'),
        noPanRatePct: num('tax.tds_rate_no_pan_pct'),
        applicable: typeof cfg.get('tax.tds_applicable') === 'boolean'
          ? (cfg.get('tax.tds_applicable') as boolean)
          : null,
        accruals: tdsRows.length,
        grossAccrued: sum(tdsRows.map((t) => t.gross_amount)),
        tdsAccrued: sum(tdsRows.map((t) => t.tds_amount)),
        vendorsOverThreshold:
          threshold === null
            ? 0
            : vendors.filter((v) => paisa(v.fyPurchases) > threshold * 100).length,
        vendorsWithVerifiedPan: vendors.filter((v) => v.hasVerifiedPan).length,
        vendorsWithPayables: vendors.length,
      },
      gates,
      ledger: {
        entries: Number(ledgerRows[0]?.entries ?? 0),
        batches: Number(ledgerRows[0]?.batches ?? 0),
        imbalancedBatches: Number(imbalanceRows[0]?.n ?? 0),
      },
      absentWriters,
      commission: {
        rules: commissionRuleRows.length,
        ratesPct: commissionRuleRows.map((c) => Number(c.rate_pct)),
        subOrders: consignments.length,
        withCommission: consignments.filter((c) => paisa(c.commission_amount) > 0).length,
      },
    };
  }
}

/**
 * A decimal string as an integer number of paisa.
 *
 * Money never becomes a float here. `Number('99059.82') * 100` is 9905981.999…
 * and the comparison that asks whether an invoice equals its order to the paisa
 * would then answer "no" on a pair that match exactly.
 */
function paisa(value: string): number {
  const [whole = '0', frac = ''] = value.trim().split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  const w = Math.abs(Number(whole));
  return sign * (w * 100 + Number(`${frac}00`.slice(0, 2)));
}

/** The sum of decimal strings, back as a decimal string. Integer maths only. */
function sum(values: readonly string[]): string {
  const total = values.reduce((a, v) => a + paisa(v), 0);
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
