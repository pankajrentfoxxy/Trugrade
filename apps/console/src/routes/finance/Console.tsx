import * as React from 'react';
import {
  DataBoard,
  EmptyState,
  KpiRow,
  Skeleton,
  StatusPill,
  type Column,
  type Kpi,
} from '@trugrade/ui';
import { Board, Datum, NotMeasured, PageHeader, Section } from '../../lib/controls';
import { useResource } from '../../lib/useResource';

/**
 * ARCHETYPE E — Workspace. A KPI row, then what is stopping money from moving.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * ## This is a reconciliation screen with almost nothing to reconcile, and it says so
 *
 * One tax invoice exists. Seventeen vendor payables and seventeen TDS accruals
 * exist. `payment.ledger_entry`, `payment.payment`, `payment.refund`,
 * `payment.settlement_run`, `procurement.payout_run`, `procurement.goods_receipt`
 * and `procurement.vendor_invoice` are all empty and none of them has a writer.
 *
 * The wrong screen over that is nine tiles reading ₹0, because ₹0 paid and no
 * payout mechanism are different facts and a zero renders them identically. The
 * right one is this: the money that does exist, then **the five conditions §4.8
 * puts between a delivered machine and a vendor being paid**, each with the rows
 * that answer it. Four of the five fail today, and the reasons are specific —
 * no vendor with a payable has a verified bank account, and two of the three
 * legs of the three-way match have no rows at all.
 *
 * ## The one cross-check that matters, and it passes
 *
 * `TT/2026-27/00001` totals ₹99,059.82 and its order's `grand_total` is
 * ₹99,059.82 to the paisa. That equality is the whole assertion that the invoice
 * and the order are one calculation rather than two that agree by luck, and it
 * is compared as integer paisa on the server, never as floats.
 *
 * ## Colour
 *
 * An unpaid invoice is not a FAIL and an accrued payable is not one either, so
 * neither is red. Green and red belong to PASS and FAIL. The payout gates are
 * the exception and are still not verdicts on a machine — an unmet condition
 * wears the outlined warn chip, and a condition that cannot be evaluated at all
 * wears a neutral one, because "we did not look" must never wear the same face
 * as "we looked and it failed". The measured amounts are the screen's amber.
 */

interface PayoutGate {
  key: string;
  label: string;
  verdict: 'MET' | 'UNMET' | 'UNMEASURABLE';
  passing: number | null;
  of: number;
  detail: string;
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
  fyPurchases: string;
  tdsAccrued: string;
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
  orderNumber: string | null;
  orderGrandTotal: string | null;
  agreesWithOrder: boolean | null;
}

interface FinanceConsole {
  asAt: string;
  financialYear: string;
  invoices: {
    rows: InvoiceRow[];
    seriesLastNumber: number | null;
    seriesPrefix: string | null;
    issued: number;
    gap: number | null;
    deliveredWithoutInvoice: number;
    deliveredConsignments: number;
  };
  payables: {
    vendors: VendorMoney[];
    totals: {
      payables: number;
      gross: string;
      tds: string;
      qcFee: string;
      penalties: string;
      net: string;
    };
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
  ledger: { entries: number; batches: number; imbalancedBatches: number };
  absentWriters: Array<{ table: string; screen: string; reason: string }>;
  commission: { rules: number; ratesPct: number[]; subOrders: number; withCommission: number };
}

/** A decimal string from the API. Never parsed for arithmetic — only formatted. */
const RUPEES = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupees = (amount: string): string => `₹${RUPEES.format(Number(amount))}`;

function Num({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="font-mono tnum">{children}</span>;
}

/**
 * One §4.8 condition, with the rows behind its verdict.
 *
 * `UNMEASURABLE` is not a softer `UNMET` and does not share its chip. A gate
 * whose table has no rows was never evaluated, and reporting that as a failure
 * would claim we looked and found a mismatch.
 */
function Gate({ gate }: { gate: PayoutGate }): React.JSX.Element {
  return (
    <li className="border-b border-rule-2 py-4 last:border-0">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-body-sm font-semibold text-ink">{gate.label}</h3>
        {gate.verdict === 'MET' && <StatusPill tone="neutral" label="Satisfied" />}
        {gate.verdict === 'UNMET' && <StatusPill tone="warn" label="Not satisfied" />}
        {gate.verdict === 'UNMEASURABLE' && (
          <StatusPill tone="neutral" label="Cannot be evaluated" />
        )}
        {gate.passing === null ? (
          <NotMeasured
            why={gate.detail}
            label="Not measured"
          />
        ) : (
          <span className="text-body-sm text-ink-3">
            <Num>{gate.passing}</Num> of <Num>{gate.of}</Num>
          </span>
        )}
      </div>
      <p className="mt-1 max-w-prose text-body-sm text-ink-2">{gate.detail}</p>
    </li>
  );
}

const INVOICE_COLUMNS: ReadonlyArray<Column<InvoiceRow>> = [
  {
    key: 'number',
    header: 'Invoice',
    cell: (i) => (
      <div className="flex flex-col gap-1">
        <span className="font-mono text-body-sm text-ink">{i.invoiceNumber}</span>
        <span className="text-body-sm text-ink-3">
          {i.type} · {i.valuationMethod}
        </span>
      </div>
    ),
  },
  {
    key: 'date',
    header: 'Date',
    cell: (i) => (
      <div className="flex flex-col gap-1">
        <Num>{i.invoiceDate}</Num>
        <span className="text-body-sm text-ink-3">
          place of supply <Num>{i.placeOfSupply}</Num>
        </span>
      </div>
    ),
  },
  {
    key: 'tax',
    header: 'Tax',
    cell: (i) => (
      <div className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">
          Taxable <Num>{rupees(i.taxableValue)}</Num>
        </span>
        <span className="text-body-sm text-ink-3">
          {Number(i.igst) > 0 ? (
            <>
              IGST <Num>{rupees(i.igst)}</Num>
            </>
          ) : (
            <>
              CGST <Num>{rupees(i.cgst)}</Num> + SGST <Num>{rupees(i.sgst)}</Num>
            </>
          )}
        </span>
      </div>
    ),
  },
  {
    key: 'total',
    header: 'Total',
    // The measured value, and therefore the amber.
    cell: (i) => <span className="font-mono text-data tnum text-acc-ink">{rupees(i.total)}</span>,
  },
  {
    key: 'agrees',
    header: 'Against the order',
    cell: (i) => {
      if (i.orderNumber === null) {
        return (
          <NotMeasured
            why="This invoice names no sub-order, so there is no order total to compare it against."
            label="No order linked"
          />
        );
      }
      return (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-body-sm text-ink">{i.orderNumber}</span>
          {i.agreesWithOrder === true ? (
            <span className="text-body-sm text-ink-2">
              Order total <Num>{rupees(i.orderGrandTotal ?? '0')}</Num> — equal to the paisa
            </span>
          ) : (
            // Red is right here and only here: the invoice and the order
            // disagreeing is a genuine FAIL on an arithmetic check, not a
            // status. It has never fired.
            <span className="text-body-sm text-fail">
              Order total <Num>{rupees(i.orderGrandTotal ?? '0')}</Num> — does not match
            </span>
          )}
        </div>
      );
    },
  },
  {
    key: 'state',
    header: 'Document',
    cell: (i) => (
      <div className="flex flex-col gap-1">
        {i.hasPdf ? (
          <StatusPill tone="neutral" label="PDF stored" />
        ) : (
          <NotMeasured why="pdf_key is null: the document was never rendered." label="No PDF" />
        )}
        <span className="text-body-sm text-ink-3">IRP {i.irpStatus.toLowerCase()}</span>
      </div>
    ),
  },
];

const VENDOR_COLUMNS: ReadonlyArray<Column<VendorMoney>> = [
  {
    key: 'vendor',
    header: 'Supply point',
    cell: (v) => (
      <div className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{v.vendorName}</span>
        <span className="text-body-sm text-ink-3">
          <Num>{v.payables}</Num> {v.payables === 1 ? 'payable' : 'payables'}
        </span>
      </div>
    ),
  },
  {
    key: 'gross',
    header: 'Gross',
    cell: (v) => <span className="font-mono text-body-sm tnum text-ink">{rupees(v.gross)}</span>,
  },
  {
    key: 'deductions',
    header: 'Deductions',
    cell: (v) => (
      <div className="flex flex-col gap-1">
        <span className="text-body-sm text-ink-2">
          TDS <Num>{rupees(v.tds)}</Num>
        </span>
        <span className="text-body-sm text-ink-3">
          QC fee <Num>{rupees(v.qcFee)}</Num> · penalties <Num>{rupees(v.penalties)}</Num>
        </span>
      </div>
    ),
  },
  {
    key: 'net',
    header: 'Net owed',
    cell: (v) => <span className="font-mono text-data tnum text-acc-ink">{rupees(v.net)}</span>,
  },
  {
    key: 'tds',
    header: 'TDS position',
    cell: (v) => (
      <div className="flex flex-col gap-1">
        <span className="text-body-sm text-ink-2">
          <Num>{rupees(v.fyPurchases)}</Num> purchased this year
        </span>
        <span className="text-body-sm text-ink-3">
          Deducted at{' '}
          {v.ratesRecorded.length === 0 ? (
            'no recorded rate'
          ) : (
            <>
              <Num>{v.ratesRecorded.join(', ')}%</Num>
            </>
          )}{' '}
          on <Num>{rupees(v.fyPurchases)}</Num>
        </span>
      </div>
    ),
  },
  {
    key: 'ready',
    header: 'Can we pay them',
    cell: (v) => (
      <div className="flex flex-col gap-2">
        {/* Not a red chip: an unverified bank account is an onboarding step
            nobody has completed, not a failed check. */}
        <StatusPill
          tone={v.hasVerifiedBankAccount ? 'neutral' : 'warn'}
          label={v.hasVerifiedBankAccount ? 'Bank account verified' : 'No verified bank account'}
        />
        {v.hasVerifiedPan ? (
          <span className="text-body-sm text-ink-3">PAN verified</span>
        ) : (
          <NotMeasured
            why="kyc.pan_record holds no verified row for this organisation, so s.206AA's higher no-PAN rate would apply the moment they cross the threshold."
            label="No verified PAN"
          />
        )}
      </div>
    ),
  },
];

export function FinanceConsoleRoute(): React.JSX.Element {
  const { data, error } = useResource<FinanceConsole>(
    '/api/admin/finance',
    'The finance console did not load',
  );

  if (error) {
    return (
      <EmptyState
        title="The finance console did not load"
        body={`${error}. Nothing has been changed — this screen only ever reads.`}
      />
    );
  }
  if (!data) return <Skeleton lines={12} />;

  const { invoices, payables, tds, gates, ledger, commission } = data;
  const blocked = gates.filter((g) => g.verdict !== 'MET').length;

  const kpis: Kpi[] = [
    {
      key: 'invoices',
      label: 'Tax invoices issued',
      value: invoices.issued,
      unit: invoices.issued === 1 ? 'invoice' : 'invoices',
      hint: `Series ${invoices.seriesPrefix ?? '—'}/${data.financialYear}, counter at ${invoices.seriesLastNumber ?? 0}.`,
    },
    {
      key: 'owed',
      label: 'Owed to supply points',
      value: rupees(payables.totals.net),
      hint: `${payables.totals.payables} payables, none of them yet eligible to pay.`,
    },
    {
      key: 'tds',
      label: 'TDS withheld this year',
      value: rupees(tds.tdsAccrued),
      hint: `${tds.accruals} accruals over ${rupees(tds.grossAccrued)} of purchases, all below the per-vendor threshold.`,
    },
    {
      key: 'paid',
      // Null, not zero. Nothing has been paid AND nothing can be — those are
      // different facts, and "₹0 paid" reads as the first one alone.
      label: 'Paid out to supply points',
      value: null,
      unit: '',
      hint: 'No payout run has ever existed, and no code path creates one.',
    },
    {
      key: 'ledger',
      label: 'Ledger entries',
      value: ledger.entries,
      unit: 'lines',
      hint:
        ledger.entries === 0
          ? 'The books balance vacuously: there is nothing in them.'
          : `${ledger.batches} batches, ${ledger.imbalancedBatches} of them out of balance.`,
    },
    {
      key: 'blocked',
      label: 'Payout conditions unmet',
      value: blocked,
      unit: `of ${gates.length}`,
      hint: 'Each one is named below, with the rows behind it.',
    },
  ];

  return (
    <div className="tg-stack">
      <PageHeader title="Finance">
        What has been invoiced, what is owed, and what is stopping any of it from moving. Financial
        year <span className="font-mono tnum text-ink">{data.financialYear}</span>.
      </PageHeader>

      <KpiRow label="Money on this platform today" items={kpis} />

      <Section
        title="What stops a payout"
        subtitle="§4.8 makes a vendor payment wait on five conditions at once. Each is checked against the rows that would answer it, and a condition whose table has no rows is reported as unevaluated rather than as failed."
        aside={
          <span className="text-body-sm text-ink-3">
            <Num>{blocked}</Num> of <Num>{gates.length}</Num> not satisfied
          </span>
        }
      >
        <ul className="flex flex-col">
          {gates.map((g) => (
            <Gate key={g.key} gate={g} />
          ))}
        </ul>
        <p className="mt-4 max-w-prose text-body-sm text-ink-2">
          These are cumulative, not alternatives. Until all five hold for a payable, the money stays
          accrued — which is why <strong>{rupees(payables.totals.net)}</strong> is owed and{' '}
          <span className="font-mono tnum">0</span> rupees are payable.
        </p>
      </Section>

      <Section
        title="The invoice register"
        subtitle="Invoice-2, platform to customer. Numbering is sequential per GSTIN per financial year with no gaps, and a gap is an alarm rather than a warning."
        aside={
          invoices.gap === null ? (
            <NotMeasured
              why="No invoice_series row exists for this GSTIN and financial year, so the counter cannot be compared with the documents."
              label="Series not initialised"
            />
          ) : invoices.gap === 0 ? (
            <span className="text-body-sm text-ink-3">
              Counter <Num>{invoices.seriesLastNumber}</Num>, documents{' '}
              <Num>{invoices.issued}</Num> — no gap
            </span>
          ) : (
            <span className="text-body-sm text-fail">
              <Num>{invoices.gap}</Num> numbers consumed with no document behind them
            </span>
          )
        }
      >
        <Board tableMinWidth={1100}>
          <DataBoard
            caption="Tax invoices issued by TrueTech Services Pvt. Ltd."
            columns={INVOICE_COLUMNS}
            rows={invoices.rows}
            rowKey={(i) => i.invoiceNumber}
            empty={
              <EmptyState
                title="No invoice has been issued"
                body="An invoice is raised when a consignment is removed from a supply point. Nothing has reached that point yet."
              />
            }
          />
        </Board>

        {invoices.deliveredWithoutInvoice > 0 && (
          <p className="mt-4 max-w-prose text-body-sm text-warn">
            <span className="font-mono tnum">{invoices.deliveredWithoutInvoice}</span> of{' '}
            <span className="font-mono tnum">{invoices.deliveredConsignments}</span> consignments
            that carry a delivery date have no tax invoice against them. Under GST an invoice is due
            at removal, so this is a real exposure and not a display artefact — the seed marks
            deliveries directly rather than routing them through the issuing service, which is the
            only path that raises a document.
          </p>
        )}
      </Section>

      <Section
        title="What we owe supply points"
        subtitle="procurement.vendor_payable, one row per purchase order. Every figure is the row's own column — nothing on this table is recomputed here."
        aside={
          <span className="text-body-sm text-ink-3">
            {payables.byStatus.map((s) => `${s.count} ${s.status.toLowerCase()}`).join(' · ')}
          </span>
        }
      >
        <Board tableMinWidth={1100}>
          <DataBoard
            caption="Vendor payables by supply point, largest net first."
            columns={VENDOR_COLUMNS}
            rows={payables.vendors}
            rowKey={(v) => v.vendorOrgId}
            empty={
              <EmptyState
                title="Nothing is owed"
                body="A payable is accrued when a purchase order is raised. None exists."
              />
            }
          />
        </Board>
      </Section>

      <Section
        title="TDS under s.194Q"
        subtitle="Accrued at the earlier of credit or payment, per vendor per financial year. Section code 1031."
      >
        <div className="grid gap-x-7 sm:grid-cols-2 lg:grid-cols-4">
          <Datum label="Applicable to us">
            {tds.applicable === null ? (
              <NotMeasured why="tax.tds_applicable is not configured." />
            ) : tds.applicable ? (
              <>Yes — our turnover exceeded ₹10 crore last year</>
            ) : (
              <>No — the code path is inert, not zero-rated</>
            )}
          </Datum>
          <Datum label="Per-vendor threshold">
            {tds.thresholdInr === null ? (
              <NotMeasured why="tax.tds_vendor_threshold_inr is not configured." />
            ) : (
              <>
                <Num>{rupees(String(tds.thresholdInr))}</Num> per financial year
              </>
            )}
          </Datum>
          <Datum label="Rate above the threshold">
            {tds.ratePct === null ? (
              <NotMeasured why="tax.tds_rate_pct is not configured." />
            ) : (
              <>
                <Num>{tds.ratePct}%</Num> with a valid PAN
              </>
            )}
          </Datum>
          <Datum label="Rate without a PAN">
            {tds.noPanRatePct === null ? (
              <NotMeasured why="tax.tds_rate_no_pan_pct is not configured." />
            ) : (
              <>
                <Num>{tds.noPanRatePct}%</Num> — s.206AA
              </>
            )}
          </Datum>
        </div>

        <p className="mt-4 max-w-prose text-body-sm text-ink-2">
          <span className="font-mono tnum text-ink">{tds.accruals}</span> accruals have been recorded
          over <Num>{rupees(tds.grossAccrued)}</Num> of purchases, and{' '}
          <strong>
            <Num>{rupees(tds.tdsAccrued)}</Num> has been withheld
          </strong>{' '}
          — because{' '}
          <span className="font-mono tnum text-ink">{tds.vendorsOverThreshold}</span> of{' '}
          <span className="font-mono tnum text-ink">{tds.vendorsWithPayables}</span> supply points
          have crossed the{' '}
          {tds.thresholdInr === null ? 'threshold' : rupees(String(tds.thresholdInr))} threshold this
          year. The zero is a correct deduction, not a missing one.
        </p>
        <p className="mt-3 max-w-prose text-body-sm text-warn">
          What is worth knowing before one of them crosses it:{' '}
          <span className="font-mono tnum">{tds.vendorsWithVerifiedPan}</span> of{' '}
          <span className="font-mono tnum">{tds.vendorsWithPayables}</span> have a verified PAN on
          file. <span className="font-mono">kyc.pan_record</span> is empty across the whole platform,
          so the rate that would apply is{' '}
          {tds.noPanRatePct === null ? 'the no-PAN rate' : <Num>{tds.noPanRatePct}%</Num>} under
          s.206AA rather than {tds.ratePct === null ? 'the standard rate' : <Num>{tds.ratePct}%</Num>}{' '}
          — fifty times the deduction, taken out of a payment we have already agreed.
        </p>
      </Section>

      <Section
        title="Commission is priced and never charged"
        subtitle="payment.commission_rule holds a rate per vendor tier, and ordering.sub_order.commission_amount is where a charge would land."
      >
        <p className="max-w-prose text-body-sm text-ink-2">
          <span className="font-mono tnum text-ink">{commission.rules}</span> commission rules exist
          {commission.ratesPct.length > 0 && (
            <>
              , from <Num>{Math.min(...commission.ratesPct)}%</Num> to{' '}
              <Num>{Math.max(...commission.ratesPct)}%</Num> by vendor tier
            </>
          )}
          , and <strong>no file in the API reads the table.</strong>{' '}
          <span className="font-mono">commission_amount</span> is{' '}
          {commission.withCommission === 0 ? (
            <>
              zero on all <Num>{commission.subOrders}</Num> consignments
            </>
          ) : (
            <>
              set on <Num>{commission.withCommission}</Num> of{' '}
              <Num>{commission.subOrders}</Num> consignments
            </>
          )}
          . Under the merchant-of-record model our margin is the difference between what we pay and
          what we charge — which the margin rules already deliver — so a commission column may
          simply be the wrong shape for this business. Either way it is a rate somebody set, sitting
          beside a column nobody fills, and the two should not be left looking like a working pair.
        </p>
      </Section>

      <Section
        title="The screens §3C.4 asks for that have no data behind them"
        subtitle="Named rather than shipped as empty boards. A payments board over a table with no writer is a screen that will look identical the day the writer lands and the day it does not."
      >
        <ul className="flex flex-col gap-3">
          {data.absentWriters.map((a) => (
            <li key={a.table} className="border-b border-rule-2 pb-3 last:border-0">
              <span className="font-mono text-body-sm text-ink">{a.table}</span>
              <span className="ml-3 font-mono text-body-sm text-ink-4">{a.screen}</span>
              <p className="mt-1 max-w-prose text-body-sm text-ink-2">{a.reason}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
