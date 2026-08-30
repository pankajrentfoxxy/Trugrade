import { Injectable } from '@nestjs/common';
import { Money, computeTds, financialYearOf, moneyFromDb } from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { PayableRepository, type PayableRow } from './payable.repository';

/**
 * What we owe this vendor, when it becomes payable, and what is honestly
 * unknown — T33, `03_UX_SPEC.md` §3B.4.
 *
 * **The shape of this file is decided by what the database can actually
 * answer.** Three things it cannot:
 *
 *   1. `procurement.payout_run` and `payout_line` are empty and **nothing
 *      writes them**. No payout has ever been executed on this platform, so
 *      there is no payout statement keyed to a run. What §3B.4 calls the
 *      statement — the full deduction stack — is built here from the payables
 *      that genuinely exist, and `payoutsEver` is read rather than assumed so
 *      the screen stops saying "none" the day one is run.
 *   2. **Nothing sets `vendor_payable.eligible_at`.** It is carried through as
 *      null. The rule's answer (delivery + the inspection window) is computed
 *      separately and labelled as the rule rather than as a record, because
 *      "this is when it becomes payable under the policy" and "we have recorded
 *      it as payable" are different claims and only one of them is true.
 *   3. There is no payout cycle to promise against. `procurement.default_payout_cycle`
 *      says `T_PLUS_2` and `vendor.vendor_payout_preference` has no rows; deriving
 *      an "expected on" from either would be a date a vendor plans cash against
 *      and we invented. `expectedPaymentOn` therefore does not exist on any type
 *      in this file. What does exist is `payBy` — a deadline we are *bound* by,
 *      keyed off a real recorded delivery.
 *
 * **The MSME case is the one real clock.** A vendor with a Udyam registration on
 * record is an MSME, and s.15 of the MSMED Act 2006 requires payment within the
 * agreed period or 45 days of acceptance of the goods, whichever is earlier —
 * with compound interest at three times the RBI bank rate on any delay (s.16).
 * That is an obligation, not a cycle, so it is the one date this screen will
 * put a number on. It is keyed off `vendor_profile.msme_udyam_no` actually being
 * there and off `msme.max_payment_days` actually being configured; either one
 * missing and the answer is null.
 */

/** Why a payable has not been paid, decided on the server against its clock. */
export type PayableWaitingOn =
  | 'PAID'
  | 'ON_HOLD'
  | 'CANCELLED'
  /** The machines have not reached the buyer, so no clock has started. */
  | 'NOT_DELIVERED'
  /** Delivered, and the buyer's 48-hour inspection window is still open. */
  | 'INSPECTION_WINDOW_OPEN'
  /** Payable by the rule. Nothing has paid it, and nothing can yet. */
  | 'NO_PAYOUT_RUN'
  /** Delivered, but `ordering.inspection_window_hours` is not configured. */
  | 'WINDOW_NOT_CONFIGURED';

export interface VendorPayableRow {
  payableId: string;
  poId: string;
  poNumber: string;
  units: number;
  gross: Money;
  tds: Money;
  penalties: Money;
  qcFee: Money;
  net: Money;
  /** `procurement.vendor_payable.status` — ACCRUED on every row today. */
  status: string;
  holdReason: string | null;
  accruedAt: Date;
  /** `ordering.sub_order.delivered_at`. Null until the machines arrive. */
  deliveredAt: Date | null;
  /** `deliveredAt + ordering.inspection_window_hours`. Null when either is. */
  inspectionWindowClosesAt: Date | null;
  /**
   * What the system has RECORDED as the eligibility instant.
   *
   * Null on every payable in existence — see the file header. Deliberately kept
   * beside `inspectionWindowClosesAt` rather than merged with it: one is the
   * rule, the other is the record, and the screen shows the gap instead of
   * hiding it.
   */
  eligibleAt: Date | null;
  paidAt: Date | null;
  /** The date we are bound to pay by. Null when nothing has been delivered. */
  payBy: Date | null;
  payByBasis: 'MSMED_ACT' | 'PO_TERMS' | null;
  payByDays: number | null;
  /** True when `payBy` is in the past and the money has not moved. */
  overdue: boolean;
  waitingOn: PayableWaitingOn;
}

/**
 * The deduction stack, over everything not yet paid.
 *
 * §3B.4 requires it rendered in full, every line, always — including a ₹0 line
 * with its reason, which is the common case here because every seeded vendor is
 * far below the TDS threshold.
 */
export interface VendorStatement {
  /** The denominator for every figure below. Never a percentage without it. */
  payables: number;
  gross: Money;
  tds: {
    amount: Money;
    /**
     * The rate that WOULD apply above the threshold, from config.
     *
     * Not derived from the amount: a ₹0 deduction divided by a gross is 0%, and
     * printing that as the rate would tell a vendor the rate is zero when it is
     * 0.1% and the threshold simply has not been crossed.
     */
    ratePct: number | null;
    thresholdAmount: Money | null;
    /** Purchases from this vendor this tax year — what the threshold is measured against. */
    financialYearPurchases: Money;
    financialYear: string;
    /** `computeTds`'s own sentence. Never restated here. */
    reason: string;
    hasVerifiedPan: boolean;
  };
  penalties: Money;
  qcFees: Money;
  net: Money;
}

export interface PayoutAccount {
  last4: string;
  holderName: string;
  bankName: string | null;
  verified: boolean;
  pennyDropStatus: string;
  /** A bank-account change freezes payouts for 24 hours. Null when not frozen. */
  frozenUntil: Date | null;
}

export interface VendorPayablesView {
  statement: VendorStatement;
  rows: VendorPayableRow[];
  /**
   * Zero on every database this has run against, and the screen says so in as
   * many words rather than showing an empty payouts board.
   */
  payoutsEver: number;
  msme: {
    registered: boolean;
    udyamNumber: string | null;
    /** `msme.max_payment_days`. Null when the key is absent — never defaulted to 45. */
    maxPaymentDays: number | null;
  };
  /** `ordering.inspection_window_hours`. Null when absent, and then no window is claimed. */
  inspectionWindowHours: number | null;
  /** Null when this vendor has no payout account at all — which blocks payment. */
  account: PayoutAccount | null;
}

const CONFIG_KEYS = [
  'ordering.inspection_window_hours',
  'msme.max_payment_days',
  'tax.tds_applicable',
  'tax.tds_vendor_threshold_inr',
  'tax.tds_rate_pct',
  'tax.tds_rate_no_pan_pct',
] as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

@Injectable()
export class PayableService {
  constructor(
    private readonly repo: PayableRepository,
    private readonly clock: ClockPort,
  ) {}

  async view(status?: string): Promise<VendorPayablesView> {
    const rows = await this.repo.list(status);
    const now = this.clock.now();
    const financialYear = financialYearOf(this.clock.nowIso());

    const [config, deliveries, udyamNumber, account, payoutsEver, fyPurchases, hasVerifiedPan] =
      await Promise.all([
        this.repo.config(CONFIG_KEYS),
        this.repo.deliveriesFor([...new Set(rows.map((r) => r.order_id))]),
        this.repo.msmeUdyamNumber(),
        this.repo.payoutBankAccount(),
        this.repo.payoutLineCount(),
        this.repo.purchasesThisFinancialYear(financialYear),
        this.repo.hasVerifiedPan(),
      ]);

    const num = (key: string): number | null => {
      const v = config.get(key);
      return typeof v === 'number' ? v : null;
    };
    const windowHours = num('ordering.inspection_window_hours');
    const msmeDays = num('msme.max_payment_days');
    const registered = udyamNumber !== null;

    const built = rows.map((r) =>
      this.row(r, {
        now,
        windowHours,
        deliveredAt: deliveries.get(r.order_id)?.delivered_at ?? null,
        // The MSMED clock only applies where the registration exists AND the
        // statutory period is configured. Either missing falls back to the PO's
        // own payment terms, which are on the purchase order the vendor signed.
        msmeDays: registered ? msmeDays : null,
      }),
    );

    return {
      statement: this.statement({
        rows: built,
        config,
        financialYear,
        fyPurchases: moneyFromDb(fyPurchases) ?? Money.ZERO,
        hasVerifiedPan,
      }),
      rows: built,
      payoutsEver,
      msme: { registered, udyamNumber, maxPaymentDays: msmeDays },
      inspectionWindowHours: windowHours,
      account: account && {
        last4: account.account_number_last4,
        holderName: account.account_holder_name,
        bankName: account.bank_name,
        verified: account.verified_at !== null,
        pennyDropStatus: account.penny_drop_status,
        frozenUntil:
          account.frozen_until && account.frozen_until.getTime() > now.getTime()
            ? account.frozen_until
            : null,
      },
    };
  }

  // -------------------------------------------------------------------------

  private row(
    r: PayableRow,
    ctx: {
      now: Date;
      windowHours: number | null;
      deliveredAt: Date | null;
      msmeDays: number | null;
    },
  ): VendorPayableRow {
    const { now, windowHours, deliveredAt, msmeDays } = ctx;

    const closesAt =
      deliveredAt && windowHours !== null
        ? new Date(deliveredAt.getTime() + windowHours * HOUR_MS)
        : null;

    const days = msmeDays ?? r.terms_days;
    const payBy = deliveredAt ? new Date(deliveredAt.getTime() + days * DAY_MS) : null;
    const paidAt = r.paid_at;

    return {
      payableId: r.id,
      poId: r.purchase_order_id,
      poNumber: r.po_number,
      units: Number(r.units),
      gross: moneyFromDb(r.gross) ?? Money.ZERO,
      tds: moneyFromDb(r.tds) ?? Money.ZERO,
      penalties: moneyFromDb(r.penalties) ?? Money.ZERO,
      qcFee: moneyFromDb(r.qc_fee) ?? Money.ZERO,
      net: moneyFromDb(r.net_payable) ?? Money.ZERO,
      status: r.status,
      holdReason: r.hold_reason,
      accruedAt: r.created_at,
      deliveredAt,
      inspectionWindowClosesAt: closesAt,
      eligibleAt: r.eligible_at,
      paidAt,
      payBy,
      payByBasis: payBy === null ? null : msmeDays !== null ? 'MSMED_ACT' : 'PO_TERMS',
      payByDays: payBy === null ? null : days,
      overdue: payBy !== null && paidAt === null && payBy.getTime() < now.getTime(),
      waitingOn: this.waitingOn(r, { now, deliveredAt, closesAt, windowHours }),
    };
  }

  /**
   * The one sentence §3B.4 insists is on every row: what this is waiting on.
   *
   * Decided here rather than in the browser because two of these arms are clock
   * comparisons on a money deadline, and the correction-window precedent applies
   * — a client clock must not be able to move when a vendor is owed.
   *
   * Ordered by what actually stops the money, most terminal first. Note the last
   * arm: a payable past its inspection window is **payable and unpaid**, and the
   * reason is that no payout run exists to pay it. That is our problem to state,
   * not a condition the vendor can clear.
   */
  private waitingOn(
    r: PayableRow,
    ctx: {
      now: Date;
      deliveredAt: Date | null;
      closesAt: Date | null;
      windowHours: number | null;
    },
  ): PayableWaitingOn {
    if (r.paid_at !== null || r.status === 'PAID') return 'PAID';
    if (r.status === 'CANCELLED') return 'CANCELLED';
    if (r.status === 'ON_HOLD') return 'ON_HOLD';
    if (ctx.deliveredAt === null) return 'NOT_DELIVERED';
    if (ctx.windowHours === null || ctx.closesAt === null) return 'WINDOW_NOT_CONFIGURED';
    if (ctx.closesAt.getTime() > ctx.now.getTime()) return 'INSPECTION_WINDOW_OPEN';
    return 'NO_PAYOUT_RUN';
  }

  /**
   * The deduction stack over the open payables.
   *
   * **The TDS amount is the sum of what was actually accrued**, row by row, from
   * `vendor_payable.tds` — the figure `computeTds` produced inside the
   * transaction that raised each purchase order, against that day's cumulative
   * purchases and that day's config. It is not recomputed. `computeTds` is
   * called here for one thing only: the *reason*, which is a statement about the
   * policy and this vendor's year-to-date position rather than a second amount.
   * This repository has already had to fix one number that had two
   * implementations disagreeing; a statement is not the place to grow another.
   */
  private statement(input: {
    rows: readonly VendorPayableRow[];
    config: Map<string, unknown>;
    financialYear: string;
    fyPurchases: Money;
    hasVerifiedPan: boolean;
  }): VendorStatement {
    const open = input.rows.filter((r) => r.paidAt === null && r.status !== 'CANCELLED');
    const sum = (pick: (r: VendorPayableRow) => Money): Money => Money.sum(open.map(pick));

    const applicable = input.config.get('tax.tds_applicable') === true;
    const thresholdInr = input.config.get('tax.tds_vendor_threshold_inr');
    const ratePct = input.config.get('tax.tds_rate_pct');
    const noPanRatePct = input.config.get('tax.tds_rate_no_pan_pct');
    const threshold =
      typeof thresholdInr === 'number' ? Money.rupees(thresholdInr) : null;

    // The whole year's purchases as ONE purchase against a zero base: that is
    // the question "has this vendor crossed the threshold this year", which is
    // what the reason has to answer. It deliberately produces no amount anybody
    // reads — only `reason` is taken.
    const position =
      threshold !== null
        ? computeTds({
            policy: {
              applicable,
              thresholdAmount: threshold,
              ratePct: typeof ratePct === 'number' ? ratePct : 0,
              noPanRatePct: typeof noPanRatePct === 'number' ? noPanRatePct : 0,
            },
            cumulativeBefore: Money.ZERO,
            purchaseValue: input.fyPurchases,
            hasValidPan: input.hasVerifiedPan,
          })
        : null;

    return {
      payables: open.length,
      gross: sum((r) => r.gross),
      tds: {
        amount: sum((r) => r.tds),
        ratePct:
          !applicable || typeof ratePct !== 'number'
            ? null
            : input.hasVerifiedPan
              ? ratePct
              : typeof noPanRatePct === 'number'
                ? noPanRatePct
                : ratePct,
        thresholdAmount: threshold,
        financialYearPurchases: input.fyPurchases,
        financialYear: input.financialYear,
        reason:
          position?.reason ??
          'The TDS threshold is not configured, so we cannot say why this figure is what it is.',
        hasVerifiedPan: input.hasVerifiedPan,
      },
      penalties: sum((r) => r.penalties),
      qcFees: sum((r) => r.qcFee),
      net: sum((r) => r.net),
    };
  }
}
