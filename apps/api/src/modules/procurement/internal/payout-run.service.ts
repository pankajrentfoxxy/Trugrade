import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Money, moneyFromDb } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { AutomationService } from '../../../shared/automation/automation.service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
} from '../../../shared/errors/domain-errors';
import { ApprovalService } from '../../identity';
import { ACCOUNTS } from './order-propagation.service';

/**
 * The payout run that has never run.
 *
 * `procurement.payout_run` and `payout_line` have been empty since Phase 1 with
 * no writer anywhere, which is why `payable.service.ts` had to build its
 * statement from payables directly and say so. This is the writer.
 *
 * **Three people, three acts.** A clerk creates the run, a controller approves
 * it, treasury releases it — and the maker may never be the checker. That rule
 * is a database CHECK (`ck_payout_maker_is_not_checker`) rather than a guard in
 * this file, because a control that only exists in application code is a control
 * one bug away from not existing.
 *
 * **What a run selects.** Every payable whose recorded `eligible_at` has passed,
 * that is not on hold or already paid, and whose purchase order has actually
 * been received. `eligible_at` is delivery + the return window and is written by
 * the delivery path — so this reads a record rather than re-deriving a policy,
 * and a payable whose window was re-armed after a return is simply not selected
 * until the new date passes.
 */

export interface PayoutRunView {
  id: string;
  runNumber: string;
  status: string;
  totalNet: Money;
  vendorCount: number;
  createdBy: string | null;
  approvedBy: string | null;
  releasedBy: string | null;
  lines: Array<{
    payableId: string;
    vendorOrgId: string;
    gross: Money;
    tds: Money;
    penalties: Money;
    qcFee: Money;
    netAmount: Money;
  }>;
}

/** Purchase-order states at which goods have actually been received. */
const RECEIVED_OR_LATER = ['RECEIVED', 'INVOICED', 'MATCHED', 'PAYABLE', 'PAID'];

@Injectable()
export class PayoutRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly automation: AutomationService,
    private readonly approvals: ApprovalService,
  ) {}

  /**
   * Draft a run over everything eligible right now.
   *
   * The deduction stack is read off each payable rather than recomputed: `tds`
   * is the figure `computeTds` produced inside the transaction that raised that
   * purchase order, against that day's cumulative purchases and that day's
   * config. Recomputing it here would produce a second number for the same
   * obligation, and this repository has already had to fix one of those.
   */
  async create(): Promise<PayoutRunView> {
    const actor = this.ctx.requirePrincipal();
    const now = this.clock.now();

    const eligible = await this.prisma.$queryRaw<
      Array<{
        id: string;
        vendor_org_id: string;
        gross: string;
        tds: string;
        penalties: string;
        qc_fee: string;
        net_payable: string;
      }>
    >`
      SELECT vp.id, vp.vendor_org_id, vp.gross::text AS gross, vp.tds::text AS tds,
             vp.penalties::text AS penalties, vp.qc_fee::text AS qc_fee,
             vp.net_payable::text AS net_payable
        FROM procurement.vendor_payable vp
        JOIN procurement.purchase_order po ON po.id = vp.purchase_order_id
       WHERE vp.eligible_at IS NOT NULL
         AND vp.eligible_at <= ${now}
         AND vp.status NOT IN ('PAID', 'ON_HOLD', 'CANCELLED')
         AND vp.paid_at IS NULL
         AND po.status::text = ANY(${RECEIVED_OR_LATER}::text[])
         -- Already on a run that has been instructed. The payable is not PAID
         -- until a bank reference lands, so the status alone would let a second
         -- run pay the same vendor twice for the same machines.
         AND NOT EXISTS (
           SELECT 1 FROM procurement.payout_line pl
            WHERE pl.payable_id = vp.id AND pl.status IN ('SENT', 'PAID')
         )
       ORDER BY vp.vendor_org_id, vp.created_at`;

    if (eligible.length === 0) {
      throw new PreconditionFailedError(
        'Nothing is eligible for payout right now. A payable joins a run once its return window has closed and the machines have been received.',
        { reason: 'nothing_eligible' },
      );
    }

    const runId = randomUUID();
    const runNumber = await this.nextRunNumber(now);
    const totalNet = Money.sum(eligible.map((r) => moneyFromDb(r.net_payable) ?? Money.ZERO));
    const vendorCount = new Set(eligible.map((r) => r.vendor_org_id)).size;

    // ADHOC and DRAFT are the table's own words: payout_run_cycle_check and
    // payout_run_status_check both carry closed lists, and inventing a
    // vocabulary beside one that already exists is how two halves of a system
    // end up describing the same run differently.
    await this.prisma.$executeRaw`
      INSERT INTO procurement.payout_run
        (id, run_number, cycle, status, total_net, vendor_count, created_by, created_at)
      VALUES (${runId}::uuid, ${runNumber}, 'ADHOC', 'DRAFT',
              ${totalNet.toString()}::numeric, ${vendorCount}, ${actor.userId}::uuid, ${now})`;

    for (const row of eligible) {
      await this.prisma.$executeRaw`
        INSERT INTO procurement.payout_line
          (run_id, vendor_org_id, payable_id, net_amount, status)
        VALUES (${runId}::uuid, ${row.vendor_org_id}::uuid, ${row.id}::uuid,
                ${row.net_payable}::numeric, 'PENDING')`;
    }

    // The approval request is opened here, beside the run, rather than when
    // somebody opens the screen. A draft run that exists with no request
    // attached is a run a second person can approve without the ladder ever
    // being consulted — and the amount is what decides who may sign.
    await this.approvals.request({
      docType: 'PAYOUT_RUN',
      docId: runId,
      amount: Number(totalNet.toString()),
      makerId: actor.userId,
    });

    await this.automation.note('R6', runNumber, 'OK', {
      payables: eligible.length,
      vendors: vendorCount,
      totalNet: totalNet.toString(),
    });

    return this.detail(runId);
  }

  /**
   * Approve it — and not if you drafted it.
   *
   * The refusal comes from the database: the UPDATE carries `approved_by`, and
   * `ck_payout_maker_is_not_checker` rejects the row when it equals
   * `created_by`. The check here is for the message; the check that matters is
   * the one no code path can skip.
   */
  async approve(runId: string): Promise<PayoutRunView> {
    const actor = this.ctx.requirePrincipal();
    const run = await this.mustFind(runId);
    if (run.status !== 'DRAFT') {
      throw new ConflictError(`${run.run_number} is ${run.status.toLowerCase()}, not a draft.`, {
        reason: 'payout_run_not_draft',
        status: run.status,
      });
    }
    if (run.created_by === actor.userId) {
      throw new ForbiddenError(
        'You prepared this run, so you cannot approve it. Somebody else has to look at it.',
        { reason: 'maker_is_checker', runId },
      );
    }

    // Decide the open request first. It is what applies the authority band —
    // a run over five lakh is a different signature from one under it — and
    // what leaves the decision in a table an auditor can read. If it refuses,
    // the run stays a draft, which is the correct outcome of a refusal.
    const open = (await this.approvals.forDocument('PAYOUT_RUN', runId)).find(
      (r) => r.status === 'PENDING',
    );
    if (open) await this.approvals.decide(open.id, { decision: 'APPROVED' });

    await this.prisma.$executeRaw`
      UPDATE procurement.payout_run
         SET status = 'APPROVED', approved_by = ${actor.userId}::uuid, approved_at = ${this.clock.now()}
       WHERE id = ${runId}::uuid AND status = 'DRAFT'`;

    return this.detail(runId);
  }

  /**
   * Release it: the payment is instructed and the liability moves into transit.
   *
   * **Not "paid".** `chk_payout_utr` refuses a PAID line with no UTR, and that
   * constraint is the schema telling the truth: a UTR is the bank's reference,
   * no bank is connected, and a run that marked itself paid would be this
   * platform asserting money left an account it does not have. So release marks
   * each line SENT and posts the liability to payouts-in-transit; `confirm`
   * records the real references when they arrive.
   *
   * One transaction, and the batch foots inside it —
   * `trg_ledger_batch_balances` is DEFERRABLE and asserts at COMMIT, so a
   * one-sided release cannot commit.
   */
  async release(runId: string): Promise<PayoutRunView> {
    const actor = this.ctx.requirePrincipal();
    const run = await this.mustFind(runId);
    if (run.status !== 'APPROVED') {
      throw new ConflictError(
        `${run.run_number} has not been approved, so nothing can be released.`,
        { reason: 'payout_run_not_approved', status: run.status },
      );
    }

    const now = this.clock.now();
    await this.prisma.runInTransaction(async () => {
      const lines = await this.prisma.$queryRaw<
        Array<{ payable_id: string; vendor_org_id: string; net_amount: string }>
      >`
        SELECT payable_id, vendor_org_id, net_amount::text AS net_amount
          FROM procurement.payout_line WHERE run_id = ${runId}::uuid`;

      const batchId = randomUUID();
      const entryDate = now.toISOString().slice(0, 10);
      for (const line of lines) {
        await this.prisma.$executeRaw`
          UPDATE procurement.payout_line SET status = 'SENT'
           WHERE run_id = ${runId}::uuid AND payable_id = ${line.payable_id}::uuid`;

        // Both legs, every line: the vendor liability goes down and an
        // in-transit liability takes its place until a bank reference confirms.
        await this.prisma.$executeRaw`
          INSERT INTO payment.ledger_entry
            (entry_date, account_code, org_id, debit, credit, ref_type, ref_id, narration, batch_id)
          VALUES
            (${entryDate}::date, ${ACCOUNTS.vendorPayable}, ${line.vendor_org_id}::uuid,
             ${line.net_amount}::numeric, 0, 'PAYOUT_RUN', ${runId}::uuid,
             ${`Payout ${run.run_number} instructed`}, ${batchId}::uuid),
            (${entryDate}::date, ${ACCOUNTS.payoutsInTransit}, ${line.vendor_org_id}::uuid,
             0, ${line.net_amount}::numeric, 'PAYOUT_RUN', ${runId}::uuid,
             ${`Payout ${run.run_number} instructed`}, ${batchId}::uuid)`;
      }

      await this.prisma.$executeRaw`
        UPDATE procurement.payout_run
           SET status = 'EXECUTING', released_by = ${actor.userId}::uuid,
               released_at = ${now}, executed_at = ${now}
         WHERE id = ${runId}::uuid`;
    });

    await this.automation.note('R10', run.run_number, 'OK', {
      approvedBy: run.approved_by,
      releasedBy: actor.userId,
    });

    return this.detail(runId);
  }

  /**
   * The bank's own references, once they exist.
   *
   * This is the only place a payable becomes PAID, because this is the only
   * place the platform has evidence that money moved. A UTR per line, from the
   * statement; a line with no reference stays SENT and is visible as such.
   */
  async confirm(runId: string, utrByPayableId: Record<string, string>): Promise<PayoutRunView> {
    const run = await this.mustFind(runId);
    if (run.status !== 'EXECUTING') {
      throw new ConflictError(
        `${run.run_number} has not been released, so there is nothing to confirm.`,
        { reason: 'payout_run_not_executing', status: run.status },
      );
    }
    const now = this.clock.now();

    await this.prisma.runInTransaction(async () => {
      const batchId = randomUUID();
      const entryDate = now.toISOString().slice(0, 10);

      for (const [payableId, utr] of Object.entries(utrByPayableId)) {
        const [line] = await this.prisma.$queryRaw<
          Array<{ vendor_org_id: string; net_amount: string }>
        >`
          SELECT vendor_org_id, net_amount::text AS net_amount FROM procurement.payout_line
           WHERE run_id = ${runId}::uuid AND payable_id = ${payableId}::uuid AND status = 'SENT'`;
        if (!line) continue;

        await this.prisma.$executeRaw`
          UPDATE procurement.payout_line SET status = 'PAID', utr = ${utr}, paid_at = ${now}
           WHERE run_id = ${runId}::uuid AND payable_id = ${payableId}::uuid`;
        await this.prisma.$executeRaw`
          UPDATE procurement.vendor_payable SET status = 'PAID', paid_at = ${now}
           WHERE id = ${payableId}::uuid`;
        await this.prisma.$executeRaw`
          INSERT INTO payment.ledger_entry
            (entry_date, account_code, org_id, debit, credit, ref_type, ref_id, narration, batch_id)
          VALUES
            (${entryDate}::date, ${ACCOUNTS.payoutsInTransit}, ${line.vendor_org_id}::uuid,
             ${line.net_amount}::numeric, 0, 'PAYOUT_RUN', ${runId}::uuid,
             ${`Payout ${run.run_number} confirmed ${utr}`}, ${batchId}::uuid),
            (${entryDate}::date, ${ACCOUNTS.bank}, ${line.vendor_org_id}::uuid,
             0, ${line.net_amount}::numeric, 'PAYOUT_RUN', ${runId}::uuid,
             ${`Payout ${run.run_number} confirmed ${utr}`}, ${batchId}::uuid)`;
      }

      const [pending] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM procurement.payout_line
         WHERE run_id = ${runId}::uuid AND status <> 'PAID'`;
      if (Number(pending?.n ?? 0) === 0) {
        await this.prisma.$executeRaw`
          UPDATE procurement.payout_run SET status = 'COMPLETED' WHERE id = ${runId}::uuid`;
      }
    });

    return this.detail(runId);
  }

  async detail(runId: string): Promise<PayoutRunView> {
    const run = await this.mustFind(runId);
    const lines = await this.prisma.$queryRaw<
      Array<{
        payable_id: string;
        vendor_org_id: string;
        net_amount: string;
        gross: string;
        tds: string;
        penalties: string;
        qc_fee: string;
      }>
    >`
      SELECT pl.payable_id, pl.vendor_org_id, pl.net_amount::text AS net_amount,
             vp.gross::text AS gross, vp.tds::text AS tds,
             vp.penalties::text AS penalties, vp.qc_fee::text AS qc_fee
        FROM procurement.payout_line pl
        JOIN procurement.vendor_payable vp ON vp.id = pl.payable_id
       WHERE pl.run_id = ${runId}::uuid
       ORDER BY pl.vendor_org_id`;

    return {
      id: run.id,
      runNumber: run.run_number,
      status: run.status,
      totalNet: moneyFromDb(run.total_net) ?? Money.ZERO,
      vendorCount: run.vendor_count,
      createdBy: run.created_by,
      approvedBy: run.approved_by,
      releasedBy: run.released_by,
      lines: lines.map((l) => ({
        payableId: l.payable_id,
        vendorOrgId: l.vendor_org_id,
        gross: moneyFromDb(l.gross) ?? Money.ZERO,
        tds: moneyFromDb(l.tds) ?? Money.ZERO,
        penalties: moneyFromDb(l.penalties) ?? Money.ZERO,
        qcFee: moneyFromDb(l.qc_fee) ?? Money.ZERO,
        netAmount: moneyFromDb(l.net_amount) ?? Money.ZERO,
      })),
    };
  }

  private async mustFind(runId: string): Promise<{
    id: string;
    run_number: string;
    status: string;
    total_net: string;
    vendor_count: number;
    created_by: string | null;
    approved_by: string | null;
    released_by: string | null;
  }> {
    const [run] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        run_number: string;
        status: string;
        total_net: string;
        vendor_count: number;
        created_by: string | null;
        approved_by: string | null;
        released_by: string | null;
      }>
    >`
      SELECT id, run_number, status, total_net::text AS total_net, vendor_count,
             created_by, approved_by, released_by
        FROM procurement.payout_run WHERE id = ${runId}::uuid`;
    if (!run) throw new NotFoundError('payout_run', { runId });
    return run;
  }

  /** `PR-YYYYMMDD-N`, sequential within the day. */
  private async nextRunNumber(now: Date): Promise<string> {
    const day = now.toISOString().slice(0, 10).replace(/-/g, '');
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM procurement.payout_run
       WHERE run_number LIKE ${`PR-${day}-%`}`;
    return `PR-${day}-${Number(row?.n ?? 0) + 1}`;
  }
}
