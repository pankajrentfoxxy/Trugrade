import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError } from '../../../shared/errors/domain-errors';
import { RequestContextService } from '../../../shared/db/org-scope';
import type { ValuationMethod } from '../dto/invoice.dto';

/**
 * Every statement that touches `payment.invoice`, `payment.invoice_line`,
 * `payment.eway_bill` and `payment.invoice_series`.
 *
 * Three jobs, and the first is the one that must not be anywhere else.
 *
 *   1. **The recipient predicate is welded into the SQL.** 02_ARCHITECTURE.md
 *      §3.2 layer 3: a missing `where` in a service must not be able to leak
 *      another organisation's rows. `recipient_org_id = <the caller's org>` is
 *      in the statement, not in a guard a new endpoint can forget to wear, and
 *      `readerOrgId()` refuses outright when there is no principal. A buyer
 *      asking for another buyer's invoice gets an empty result, which the
 *      service turns into 404 — never 403, because invoice numbers are a
 *      gapless sequence and a refusal would confirm the row exists.
 *
 *   2. **The number is allocated by the database.** `payment.next_invoice_number`
 *      takes `FOR UPDATE` on the series row, so two concurrent issuers queue
 *      behind it rather than both reading the same `last_number`. Called inside
 *      the same transaction as the INSERT, so a rolled-back invoice gives its
 *      number back and the series stays gapless — which a sequence would not do.
 *      There is no application-side counter here and there must never be one.
 *
 *   3. **Money crosses as strings.** Every amount is NUMERIC(14,2); `Number()`
 *      on one is the float bug this codebase keeps nearly shipping (VR-126), so
 *      nothing above this file sees a `Decimal`.
 *
 * Column lists are written out per query rather than shared in a constant:
 * `$queryRaw` is a tagged template, so a shared fragment would have to be
 * concatenated in as text, which is how a repository becomes an injection point.
 */

export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  type: string;
  subOrderId: string | null;
  invoiceDate: Date;
  placeOfSupply: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  valuationMethod: ValuationMethod;
  pdfKey: string | null;
}

export interface EwayBillRow {
  invoiceId: string;
  ewbNumber: string | null;
  ewbDate: Date | null;
  validUpto: Date | null;
  status: string;
}

/** Everything an INSERT needs. Built by the issuing service, never by a caller. */
export interface InvoiceWrite {
  subOrderId: string;
  issuerOrgId: string;
  recipientOrgId: string;
  invoiceDate: string;
  placeOfSupply: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  valuationMethod: ValuationMethod;
  lines: ReadonlyArray<{
    skuId: string | null;
    description: string;
    hsn: string;
    qty: number;
    unitPrice: string;
    taxableValue: string;
    gstRate: number;
    gstAmount: string;
    serialNumbers: readonly string[];
    valuationMethod: ValuationMethod;
    purchasePrice: string | null;
    marginValue: string | null;
  }>;
}

@Injectable()
export class InvoiceRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContextService,
  ) {}

  /**
   * The organisation whose invoices the caller may read.
   *
   * Platform staff read across organisations — `OrgScope` already grants that
   * everywhere else and finance genuinely needs it — and everyone else is
   * pinned. `null` means "no predicate", which only a PLATFORM principal gets.
   */
  private readerOrgId(): string | null {
    const p = this.ctx.requirePrincipal();
    if (p.orgType === 'PLATFORM') return null;
    if (!p.orgId) {
      throw new ForbiddenError('Invoices belong to an organisation.', {
        reason: 'principal_without_org',
      });
    }
    return p.orgId;
  }

  /**
   * The invoices raised against one order, scoped to the caller.
   *
   * Addressed by the order's sub-order ids rather than by a join to
   * `ordering.sub_order`: no cross-schema JOIN, and `payment` has no business
   * knowing how an order decomposes. `ordering` already resolved that.
   */
  async findBySubOrders(subOrderIds: readonly string[]): Promise<InvoiceRow[]> {
    if (subOrderIds.length === 0) return [];
    const orgId = this.readerOrgId();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        invoice_number: string;
        type: string;
        sub_order_id: string | null;
        invoice_date: Date;
        place_of_supply: string;
        taxable_value: string;
        cgst: string;
        sgst: string;
        igst: string;
        total: string;
        valuation_method: string;
        pdf_key: string | null;
      }>
    >`
      SELECT id, invoice_number, type::text AS type, sub_order_id, invoice_date,
             place_of_supply, taxable_value::text AS taxable_value, cgst::text AS cgst,
             sgst::text AS sgst, igst::text AS igst, total::text AS total,
             valuation_method, pdf_key
        FROM payment.invoice
       WHERE sub_order_id = ANY(${[...subOrderIds]}::uuid[])
         AND (${orgId}::uuid IS NULL OR recipient_org_id = ${orgId}::uuid)
       ORDER BY invoice_number`;
    return rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      type: r.type,
      subOrderId: r.sub_order_id,
      invoiceDate: r.invoice_date,
      placeOfSupply: r.place_of_supply,
      taxableValue: r.taxable_value,
      cgst: r.cgst,
      sgst: r.sgst,
      igst: r.igst,
      total: r.total,
      valuationMethod: r.valuation_method as ValuationMethod,
      pdfKey: r.pdf_key,
    }));
  }

  /**
   * One invoice by id, scoped to the caller.
   *
   * The scope is in this statement rather than checked afterwards: a service
   * that fetched first and compared second is one early `return` away from
   * handing over another organisation's document.
   */
  async findById(invoiceId: string): Promise<InvoiceRow | null> {
    const orgId = this.readerOrgId();
    const [row] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        invoice_number: string;
        type: string;
        sub_order_id: string | null;
        invoice_date: Date;
        place_of_supply: string;
        taxable_value: string;
        cgst: string;
        sgst: string;
        igst: string;
        total: string;
        valuation_method: string;
        pdf_key: string | null;
      }>
    >`
      SELECT id, invoice_number, type::text AS type, sub_order_id, invoice_date,
             place_of_supply, taxable_value::text AS taxable_value, cgst::text AS cgst,
             sgst::text AS sgst, igst::text AS igst, total::text AS total,
             valuation_method, pdf_key
        FROM payment.invoice
       WHERE id = ${invoiceId}::uuid
         AND (${orgId}::uuid IS NULL OR recipient_org_id = ${orgId}::uuid)`;
    if (!row) return null;
    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      type: row.type,
      subOrderId: row.sub_order_id,
      invoiceDate: row.invoice_date,
      placeOfSupply: row.place_of_supply,
      taxableValue: row.taxable_value,
      cgst: row.cgst,
      sgst: row.sgst,
      igst: row.igst,
      total: row.total,
      valuationMethod: row.valuation_method as ValuationMethod,
      pdfKey: row.pdf_key,
    };
  }

  /** The e-way bills against a set of invoices. Absent is the normal case. */
  async findEwayBills(invoiceIds: readonly string[]): Promise<EwayBillRow[]> {
    if (invoiceIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{
        invoice_id: string;
        ewb_number: string | null;
        ewb_date: Date | null;
        valid_upto: Date | null;
        status: string;
      }>
    >`
      SELECT e.invoice_id, e.ewb_number, e.ewb_date, e.valid_upto, e.status
        FROM payment.eway_bill e
       WHERE e.invoice_id = ANY(${[...invoiceIds]}::uuid[])`;
    return rows.map((r) => ({
      invoiceId: r.invoice_id,
      ewbNumber: r.ewb_number,
      ewbDate: r.ewb_date,
      validUpto: r.valid_upto,
      status: r.status,
    }));
  }

  /**
   * Credit notes raised against a set of invoices.
   *
   * There is no `payment.credit_note` table and there does not need to be: a
   * credit note IS an invoice, of `type = 'CREDIT_NOTE'`, pointing at the one it
   * reverses through `original_invoice_id`. Modelling it as its own table would
   * duplicate the line structure, the tax split and the numbering series.
   */
  async countCreditNotes(invoiceIds: readonly string[]): Promise<number> {
    if (invoiceIds.length === 0) return 0;
    const orgId = this.readerOrgId();
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM payment.invoice
       WHERE type = 'CREDIT_NOTE'::public.invoice_type
         AND original_invoice_id = ANY(${[...invoiceIds]}::uuid[])
         AND (${orgId}::uuid IS NULL OR recipient_org_id = ${orgId}::uuid)`;
    return Number(row?.n ?? 0n);
  }

  /**
   * Write one tax invoice and its lines, numbered inside the transaction.
   *
   * **The whole concurrency story is `payment.next_invoice_number` being called
   * here rather than before the transaction opens.** It takes `FOR UPDATE` on
   * the `(gstin, financial_year)` counter row and holds it to COMMIT, so a
   * second issuer blocks on the row instead of reading the same `last_number`.
   * A gap in a GST invoice series is a question asked in an audit; a duplicate
   * is worse. Neither is reachable from here.
   *
   * `UNIQUE (invoice_number)` is the belt to that braces. If it ever fires,
   * something is allocating numbers outside this function and the right answer
   * is to find it, not to retry.
   *
   * ponytail: `ordering.sub_order.invoice_id` is left NULL. The authoritative
   * link is `payment.invoice.sub_order_id`, written here; the column on the
   * sub-order is the redundant half of the pair, and setting it would be a
   * cross-module write for a denormalisation nothing reads. Add it the day a
   * query needs to go from a sub-order to its invoice without a second lookup.
   */
  async insertTaxInvoice(
    write: InvoiceWrite,
    gstin: string,
    financialYear: string,
  ): Promise<{ id: string; invoiceNumber: string }> {
    return this.prisma.runInTransaction(async () => {
      const [numbered] = await this.prisma.$queryRaw<Array<{ n: string }>>`
        SELECT payment.next_invoice_number(${gstin}, ${financialYear}) AS n`;
      const invoiceNumber = numbered!.n;

      const [invoice] = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO payment.invoice
          (invoice_number, type, issuer_org_id, recipient_org_id, sub_order_id, invoice_date,
           place_of_supply, taxable_value, cgst, sgst, igst, total, irp_status, valuation_method)
        VALUES
          (${invoiceNumber}, 'TAX'::public.invoice_type, ${write.issuerOrgId}::uuid,
           ${write.recipientOrgId}::uuid, ${write.subOrderId}::uuid, ${write.invoiceDate}::date,
           ${write.placeOfSupply}, ${write.taxableValue}::numeric, ${write.cgst}::numeric,
           ${write.sgst}::numeric, ${write.igst}::numeric, ${write.total}::numeric,
           'NOT_APPLICABLE', ${write.valuationMethod})
        RETURNING id`;
      const invoiceId = invoice!.id;

      for (const line of write.lines) {
        await this.prisma.$executeRaw`
          INSERT INTO payment.invoice_line
            (invoice_id, sku_id, description, hsn, qty, unit_price, taxable_value, gst_rate,
             gst_amount, serial_numbers, valuation_method, purchase_price, margin_value)
          VALUES
            (${invoiceId}::uuid, ${line.skuId}::uuid, ${line.description}, ${line.hsn},
             ${line.qty}, ${line.unitPrice}::numeric, ${line.taxableValue}::numeric,
             ${line.gstRate}::numeric, ${line.gstAmount}::numeric,
             ${[...line.serialNumbers]}::text[], ${line.valuationMethod},
             ${line.purchasePrice}::numeric, ${line.marginValue}::numeric)`;
      }

      return { id: invoiceId, invoiceNumber };
    });
  }

  /** Record where the rendered document landed. Separate write: the PDF is not the invoice. */
  async setPdfKey(invoiceId: string, key: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE payment.invoice SET pdf_key = ${key} WHERE id = ${invoiceId}::uuid`;
  }

  /**
   * Our own GST registration, as the issuer.
   *
   * Read rather than taken from config: `LEGAL_DISCLOSURE` has our state code
   * but a GSTIN is a verified fact about a legal entity and it belongs with the
   * other verified facts, in `kyc.gst_profile`. A constant in the repository
   * would be a second copy of it that nothing keeps true.
   */
  async issuer(): Promise<{
    orgId: string;
    gstin: string;
    legalName: string;
    tradeName: string | null;
    stateCode: string;
  } | null> {
    // Two statements, one per schema, and NOT a join. `no-cross-schema-join` is
    // load-bearing and this is exactly the seam it protects: an invoice needs
    // facts from `ordering`, `identity`, `kyc` and `catalog` at once, and a
    // document assembled by joining across all four is the easiest place in the
    // system for a supplier field to arrive somewhere it must never be. Both
    // queries below are single-table and neither can reach a vendor row.
    const [org] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.organization WHERE org_type = 'INTERNAL' LIMIT 1`;
    if (!org) return null;

    const [row] = await this.prisma.$queryRaw<
      Array<{
        gstin: string;
        legal_name_as_per_gst: string;
        trade_name: string | null;
        state_code: string;
      }>
    >`
      SELECT gstin, legal_name_as_per_gst, trade_name, state_code
        FROM kyc.gst_profile
       WHERE org_id = ${org.id}::uuid AND is_primary AND status = 'ACTIVE'
       LIMIT 1`;
    return row
      ? {
          orgId: org.id,
          gstin: row.gstin.trim(),
          legalName: row.legal_name_as_per_gst,
          tradeName: row.trade_name,
          stateCode: row.state_code.trim(),
        }
      : null;
  }

  /** Whether a series is configured. `next_invoice_number` raises without one. */
  async hasSeries(gstin: string, financialYear: string): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM payment.invoice_series
       WHERE gstin = ${gstin} AND financial_year = ${financialYear}`;
    return Number(row?.n ?? 0n) > 0;
  }
}


