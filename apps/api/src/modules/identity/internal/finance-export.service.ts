import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { ValidationError } from '../../../shared/errors/domain-errors';
import { AuditService } from './audit.service';

/**
 * Registers, as CSV, for whoever is doing the books.
 *
 * **Every pull writes an audit row naming the register, the period and the row
 * count.** That is the reason the CA seat is allowed to hold a `run` verb at
 * all: the alternative to an audited export is the same data leaving as a
 * screenshot or a database dump, with no record that it left. "Does the CA have
 * a copy of the September ledger" has to be answerable, and this is what makes
 * it answerable.
 *
 * The register list is closed. An export endpoint that takes a table name, or a
 * period predicate, or anything else the caller composes, is a SQL injection
 * surface wearing a reporting hat — and it is handed to the one login in the
 * system that belongs to somebody outside the company.
 *
 * Each register is one module schema per statement. `no-cross-schema-join`
 * forbids the join that would put a vendor's name next to their payable, and it
 * is right to: a CA reconciling creditors needs the org id, and the console
 * resolves names on the platform side where that is allowed.
 */

export type RegisterKey =
  | 'LEDGER'
  | 'SALES'
  | 'PURCHASE'
  | 'TDS'
  | 'PAYABLES';

export interface ExportResult {
  register: RegisterKey;
  from: string;
  to: string;
  rowCount: number;
  filename: string;
  csv: string;
}

/** Column order is part of the contract: a CA's import template depends on it. */
const REGISTERS: Readonly<Record<RegisterKey, { label: string; columns: readonly string[] }>> =
  Object.freeze({
    LEDGER: {
      label: 'General ledger',
      columns: [
        'entry_date',
        'batch_id',
        'account_code',
        'debit',
        'credit',
        'currency',
        'ref_type',
        'ref_id',
        'narration',
      ],
    },
    SALES: {
      label: 'Sales register',
      columns: [
        'invoice_date',
        'invoice_number',
        'type',
        'recipient_org_id',
        'place_of_supply',
        'taxable_value',
        'cgst',
        'sgst',
        'igst',
        'cess',
        'total',
        'irn',
      ],
    },
    PURCHASE: {
      label: 'Purchase register',
      columns: [
        'created_at',
        'po_number',
        'vendor_org_id',
        'status',
        'total_net',
        'tds_rate_pct',
        'tds_amount',
        'supply_point_label',
      ],
    },
    TDS: {
      label: 'TDS register (s.194Q)',
      columns: [
        'occurred_at',
        'financial_year',
        'vendor_org_id',
        'entry_type',
        'gross_amount',
        'tds_rate_pct',
        'tds_amount',
        'reason',
      ],
    },
    PAYABLES: {
      label: 'Creditors',
      columns: [
        'created_at',
        'vendor_org_id',
        'status',
        'gross',
        'tds',
        'penalties',
        'qc_fee',
        'net_payable',
        'eligible_at',
        'paid_at',
      ],
    },
  });

export const REGISTER_KEYS = Object.keys(REGISTERS) as readonly RegisterKey[];

@Injectable()
export class FinanceExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
  ) {}

  async run(input: { register: string; from: string; to: string }): Promise<ExportResult> {
    const register = input.register as RegisterKey;
    const spec = REGISTERS[register];
    if (!spec) {
      throw new ValidationError(`There is no ${input.register} register.`, {
        register: `Pick one of: ${REGISTER_KEYS.join(', ')}.`,
      });
    }

    const from = this.day(input.from, 'from');
    const to = this.day(input.to, 'to');
    if (to < from) {
      throw new ValidationError('The period ends before it starts.', {
        to: 'Pick a date on or after the start of the period.',
      });
    }

    const rows = await this.rowsFor(register, from, to);
    const csv = toCsv(spec.columns, rows);

    const me = this.ctx.principal;
    await this.audit.record({
      action: 'finance.export.run',
      entityType: 'register',
      entityId: register,
      ...(me?.userId ? { actorUserId: me.userId } : {}),
      after: {
        register,
        label: spec.label,
        from: input.from,
        to: input.to,
        rowCount: rows.length,
      },
    });

    return {
      register,
      from: input.from,
      to: input.to,
      rowCount: rows.length,
      filename: `${register.toLowerCase()}-${input.from}-to-${input.to}.csv`,
      csv,
    };
  }

  /**
   * One statement per register, each against a single module schema.
   *
   * The `to` bound is exclusive-by-day — `< to + 1 day` — rather than `<= to`,
   * because these columns are timestamptz and `<= '2026-09-30'` silently drops
   * every row posted after midnight on the last day of the month. A ledger
   * export that is short by one day's postings is worse than one that fails.
   */
  private async rowsFor(
    register: RegisterKey,
    from: Date,
    to: Date,
  ): Promise<Array<Record<string, unknown>>> {
    switch (register) {
      case 'LEDGER':
        return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT entry_date, batch_id, account_code, debit, credit, currency,
                 ref_type, ref_id, narration
            FROM payment.ledger_entry
           WHERE entry_date >= ${from} AND entry_date < ${to}
           ORDER BY entry_date, batch_id, account_code`;
      case 'SALES':
        return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT invoice_date, invoice_number, type::text AS type, recipient_org_id,
                 place_of_supply, taxable_value, cgst, sgst, igst, cess, total, irn
            FROM payment.invoice
           WHERE invoice_date >= ${from} AND invoice_date < ${to}
           ORDER BY invoice_date, invoice_number`;
      case 'PURCHASE':
        return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT created_at, po_number, vendor_org_id, status::text AS status,
                 total_net, tds_rate_pct, tds_amount, supply_point_label
            FROM procurement.purchase_order
           WHERE created_at >= ${from} AND created_at < ${to}
           ORDER BY created_at, po_number`;
      case 'TDS':
        return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT occurred_at, financial_year, vendor_org_id, entry_type,
                 gross_amount, tds_rate_pct, tds_amount, reason
            FROM procurement.tds_ledger
           WHERE occurred_at >= ${from} AND occurred_at < ${to}
           ORDER BY occurred_at`;
      case 'PAYABLES':
        return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT created_at, vendor_org_id, status, gross, tds, penalties, qc_fee,
                 net_payable, eligible_at, paid_at
            FROM procurement.vendor_payable
           WHERE created_at >= ${from} AND created_at < ${to}
           ORDER BY created_at`;
    }
  }

  private day(value: string, field: 'from' | 'to'): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
      throw new ValidationError('A period is two dates, as YYYY-MM-DD.', {
        [field]: 'For example 2026-09-01.',
      });
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError(`${value} is not a date.`, { [field]: 'Use YYYY-MM-DD.' });
    }
    if (date.getTime() > this.clock.nowMs() + 86_400_000) {
      throw new ValidationError('That period has not happened yet.', {
        [field]: 'Pick a date that has passed.',
      });
    }
    // The exclusive upper bound described above.
    return field === 'to' ? new Date(date.getTime() + 86_400_000) : date;
  }
}

/**
 * RFC 4180 quoting, and one thing beyond it: a value starting with `=`, `+`,
 * `-` or `@` is prefixed with a quote, because Excel executes those as formulas
 * and a narration field is attacker-influenced text.
 */
function toCsv(columns: readonly string[], rows: Array<Record<string, unknown>>): string {
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    let s = value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
