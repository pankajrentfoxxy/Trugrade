import { Injectable } from '@nestjs/common';
import { Money } from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { OrderReadService, type OrderRecordView } from './order-read.service';
import { OrderTransactionService } from './order-transaction.service';

/**
 * The approval inbox and the decision behind it — T25, and the oldest
 * reachability gap in this build.
 *
 * PHASE_06 Task 2 built the policy, the `ordering.order_approval` row and the
 * twenty-four-hour deadline, and the order transaction writes the row. Nothing
 * could **decide** one, so `APPROVED` and `REJECTED` were states the schema
 * allowed and the product could not reach: four orders sat at
 * `AWAITING_APPROVAL` with stock held off sale and no way forward.
 *
 * Four rules govern this file.
 *
 * **1. VR-123 — an approver may never approve their own order.** `roles.ts`
 * says of `CUSTOMER_APPROVER`: *"an approver may never approve their own order.
 * Enforced in the service, not here."* It was not, anywhere. It is now, in
 * `decide`, and the test for it makes the requester attempt the approval and
 * asserts the refusal rather than asserting a guard exists. The permission is
 * not the control: `ordering.order.approve` says you may decide approvals, and
 * this says which ones.
 *
 * **2. The deadline is the server's, measured on `ClockPort`.** T17 established
 * it and this file matches: a `PENDING` row past `expires_at` is reported
 * `EXPIRED`, and a decision arriving after it is refused. A browser clock must
 * not be able to move a money deadline, in either direction — neither by
 * showing a live approval as dead nor by letting a dead one be signed.
 *
 * **3. A rejection reason is mandatory and travels verbatim.** 03_UX_SPEC §3A:
 * *"Rejection reason is mandatory and is sent to the requester verbatim."* It is
 * written to `order_approval.comment`, which `OrderReadService` already renders
 * on the requester's own order screen. An approval needs no comment, and an
 * invented one ("Approved.") would put words in a manager's mouth.
 *
 * **4. Nothing here names a vendor.** The approver is a buyer. Every view below
 * is an allow-list, the order half is `OrderReadService`'s own allow-list, and
 * `purchaseOrderIds` — which `commitApproved` genuinely returns, because
 * approving is what raises them — is dropped here and never reaches a response.
 */

/* ==========================================================================
 * The buyer-facing shapes. All allow-lists.
 * ======================================================================== */

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

/** One row of the inbox. */
export interface ApprovalRowView {
  id: string;
  orderNumber: string;
  /** `PENDING` past `expiresAt` reads `EXPIRED`. See rule 2. */
  status: ApprovalStatus;
  orderValue: string;
  requestedByName: string;
  approverName: string;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  /** The approver's own words on a rejection. Absent otherwise, never invented. */
  comment: string | null;
  unitsHeld: number;
  /** Measured off the row — `expiresAt - requestedAt` — never the column default. */
  slaHours: number;
  /** Whether the person asking may decide this one right now. */
  decidable: boolean;
  /**
   * Why not, in a sentence, when it is `PENDING` and they may not. Null when
   * they may, and null on a decided one — "you cannot approve an order that is
   * already approved" is noise, not a refusal.
   */
  blockedReason: string | null;
}

export interface ApprovalInboxView {
  approvals: ApprovalRowView[];
  total: number;
  page: number;
  per: number;
  pages: number;
  /** Counts under every other filter. Zero-count options are disabled, not hidden. */
  facets: Array<{ value: string; label: string; count: number }>;
  /** Waiting on THIS person and still live. The number the header states. */
  waitingOnYou: number;
}

export interface ApprovalRecordView {
  approval: ApprovalRowView;
  /**
   * The policy clause that fired, in words, when the row still points at one.
   * Null when the policy has since been deleted — a rule we cannot read is not
   * summarised from the amount, which would invent the threshold.
   */
  policyRule: string | null;
  /** The order itself, through the buyer's own allow-list. No vendor at any depth. */
  order: OrderRecordView;
}

export interface ApprovalDecisionResult {
  approval: ApprovalRowView;
  /** What the order became. A rejection cancels it. */
  orderStatus: 'CONFIRMED' | 'PAYMENT_PENDING' | 'CANCELLED';
  /** Machines committed on an approval, or put back on sale on a rejection. */
  units: number;
}

export interface ApprovalListQuery {
  status: 'held' | 'waiting' | 'decided' | 'all';
  page: number;
  per: number;
}

export interface ApprovalDecisionInput {
  decision: 'APPROVE' | 'REJECT';
  comment?: string;
}

/* ========================================================================== */

interface ApprovalRow {
  id: string;
  order_id: string;
  order_number: string;
  status: string;
  order_value: string;
  requested_by: string;
  approver_user_id: string;
  requested_at: Date;
  decided_at: Date | null;
  expires_at: Date;
  comment: string | null;
  policy_id: string | null;
  units_held: number;
}

const FACETS = [
  { value: 'held', label: 'Held for approval' },
  { value: 'waiting', label: 'Waiting on you' },
  { value: 'decided', label: 'Decided' },
  { value: 'all', label: 'Everything' },
] as const;

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly orders: OrderReadService,
    private readonly tx: OrderTransactionService,
  ) {}

  /* ----------------------------------------------------------------------
   * Reading
   * ------------------------------------------------------------------- */

  /**
   * The approval board.
   *
   * `held` is org-wide — every live hold in the organisation, because that is
   * what the dashboard's "Awaiting approval" count means and what a buyer who
   * raised an order needs to see when they open Approvals. `waiting` is the
   * personal inbox: only rows addressed to the person asking. Both scopes are
   * needed; conflating them is how a count of two on Today becomes zero here.
   */
  async inbox(query: ApprovalListQuery): Promise<ApprovalInboxView> {
    const { orgId, userId } = this.approverPrincipal();
    const now = this.clock.now();

    // Read whole and filtered here rather than in SQL: facet counts are over
    // sets already in memory, and three round trips to count what is already
    // fetched is the more expensive version of this. If an org ever has
    // thousands, this moves into SQL.
    const mineRows = await this.rows({ orgId, approverUserId: userId });
    const orgRows = await this.rows({ orgId });
    const decided = (r: ApprovalRow): boolean =>
      r.status !== 'PENDING' || r.expires_at.getTime() <= now.getTime();

    const sourceRows = query.status === 'held' ? orgRows : mineRows;
    const names = await this.namesFor(sourceRows);
    const matching = sourceRows.filter((r) => {
      if (query.status === 'held' || query.status === 'waiting') return !decided(r);
      if (query.status === 'decided') return decided(r);
      return true;
    });

    const per = query.per;
    const pages = Math.max(1, Math.ceil(matching.length / per));
    const page = Math.min(query.page, pages);
    const slice = matching.slice((page - 1) * per, page * per);

    const heldCount = orgRows.filter((r) => !decided(r)).length;
    const waitingCount = mineRows.filter((r) => !decided(r)).length;

    return {
      approvals: slice.map((r) => this.view(r, userId, names)),
      total: matching.length,
      page,
      per,
      pages,
      facets: FACETS.map((f) => ({
        ...f,
        count:
          f.value === 'held'
            ? heldCount
            : f.value === 'waiting'
              ? waitingCount
              : f.value === 'all'
                ? mineRows.length
                : mineRows.filter((r) => decided(r)).length,
      })),
      waitingOnYou: waitingCount,
    };
  }

  /**
   * One approval, with the order it is about.
   *
   * The order half is `OrderReadService.byNumber` rather than a second reading
   * of the same eight tables. 03_UX_SPEC asks this screen to show *the serials
   * that will be allocated, so an approver approves specific machines*, and
   * those serials are already assembled, anonymised and allow-listed there.
   * Two renderings of one order is two places for them to disagree — the same
   * reasoning that made T17 give the confirmation a URL.
   */
  async byId(id: string): Promise<ApprovalRecordView> {
    const { orgId, userId } = this.approverPrincipal();
    const row = await this.require(id, orgId);
    const names = await this.namesFor([row]);
    return {
      approval: this.view(row, userId, names),
      policyRule: await this.policyRule(row),
      order: await this.orders.byNumber(row.order_number),
    };
  }

  /* ----------------------------------------------------------------------
   * Deciding — the endpoint that did not exist
   * ------------------------------------------------------------------- */

  /**
   * Approve or reject, in one transaction with everything the decision moves.
   *
   * The refusals are ordered so that the most specific true statement wins.
   * "You raised this order" is checked before "this expired", because a person
   * who may not decide an approval at all should not be told to hurry next time.
   */
  async decide(id: string, input: ApprovalDecisionInput): Promise<ApprovalDecisionResult> {
    const { orgId, userId } = this.approverPrincipal();
    const row = await this.require(id, orgId);
    const names = await this.namesFor([row]);
    const now = this.clock.now();

    // 1. Is this yours to decide? An approval names one person, and it is not a
    //    queue anybody in the org may pull from — the policy chose them.
    if (row.approver_user_id !== userId) {
      throw new ForbiddenError(
        `This order was sent to ${names.get(row.approver_user_id) ?? 'somebody else'} for approval, so only they can decide it. If they are away, an account owner can name a different approver in Account → Team.`,
        { reason: 'not_the_named_approver', approvalId: id },
      );
    }

    // 2. VR-123. Deliberately checked even though rule 1 passed, because the way
    //    this arises is a policy that names somebody as their own approver — so
    //    the two conditions are true at once and only this one is the violation.
    if (row.requested_by === userId) {
      throw new ForbiddenError(
        'You placed this order, so you cannot also approve it. Approval is a second pair of eyes on the spend — ask an account owner to name a different approver in Account → Team.',
        { reason: 'self_approval', approvalId: id, rule: 'VR-123' },
      );
    }

    // 3. Already decided. Named, with who and when, because the useful answer to
    //    a second press is what happened the first time.
    if (row.status !== 'PENDING') {
      throw new PreconditionFailedError(
        `This approval was already ${row.status.toLowerCase()}${
          row.decided_at ? ` on ${row.decided_at.toISOString()}` : ''
        }. Nothing has changed.`,
        { reason: 'already_decided', status: row.status },
      );
    }

    // 4. The deadline, measured here and not in the browser. A decision arriving
    //    after it is refused and the row is settled to EXPIRED in the same
    //    breath, so the state stops being a lie the moment anybody looks.
    if (row.expires_at.getTime() <= now.getTime()) {
      await this.prisma.$executeRaw`
        UPDATE ordering.order_approval SET status = 'EXPIRED'
         WHERE id = ${row.id}::uuid AND status = 'PENDING'`;
      throw new PreconditionFailedError(
        `The window on this approval closed at ${row.expires_at.toISOString()}, so it can no longer be signed. Nothing was charged. The order has to be placed again, and stock will be held again then.`,
        { reason: 'approval_expired', approvalId: id },
      );
    }

    // 5. A rejection without a reason is a rejection the requester cannot act
    //    on, and this is the one field they will read verbatim.
    const comment = input.comment?.trim() ?? '';
    if (input.decision === 'REJECT' && comment.length < 10) {
      throw new ValidationError(
        'Say why you are turning this order down. Whoever raised it sees your words exactly as you write them, so "over budget this quarter — resubmit in October" saves them a phone call.',
        { comment: 'Give a reason of at least 10 characters.' },
      );
    }

    return this.prisma.runInTransaction(async () => {
      if (input.decision === 'APPROVE') {
        const committed = await this.tx.commitApproved(row.order_id);
        await this.settle(row.id, 'APPROVED', comment || null, now);
        return {
          approval: this.view(
            { ...row, status: 'APPROVED', decided_at: now, comment: comment || null },
            userId,
            names,
          ),
          orderStatus: committed.status,
          units: committed.units,
        };
      }

      const released = await this.tx.releaseOrderStock(
        row.order_id,
        'The approver turned the order down, so the machines went back on sale.',
      );
      await this.prisma.$executeRaw`
        UPDATE ordering."order" SET status = 'CANCELLED'::public.order_status
         WHERE id = ${row.order_id}::uuid`;
      await this.prisma.$executeRaw`
        UPDATE ordering.sub_order SET status = 'CANCELLED'::public.order_status, rejected_at = ${now}
         WHERE order_id = ${row.order_id}::uuid`;
      await this.prisma.$executeRaw`
        UPDATE ordering.order_line ol
           SET status = 'CANCELLED'::public.order_status
          FROM ordering.sub_order so
         WHERE so.id = ol.sub_order_id AND so.order_id = ${row.order_id}::uuid`;
      await this.settle(row.id, 'REJECTED', comment, now);
      await this.tx.writeEvent(row.order_id, {
        type: 'order.approval_rejected',
        from: 'AWAITING_APPROVAL',
        to: 'CANCELLED',
        // The approver's own words, not a paraphrase. This note is a product
        // surface: it is what the requester reads on their order screen.
        note: `Approval declined. ${comment}`,
        occurredAt: now,
        actorId: userId,
      });

      return {
        approval: this.view({ ...row, status: 'REJECTED', decided_at: now, comment }, userId, names),
        orderStatus: 'CANCELLED' as const,
        units: released,
      };
    });
  }

  /* ----------------------------------------------------------------------
   * The parts
   * ------------------------------------------------------------------- */

  private approverPrincipal(): { orgId: string; userId: string } {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Approvals belong to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return { orgId: p.orgId, userId: p.userId };
  }

  /**
   * The rows, org-scoped in the statement's own `WHERE`.
   *
   * `ORDER BY expires_at` is "closest to a promise being broken first", which is
   * the same ordering the dashboard's queue uses and the same one the archetype
   * asks for. A decided approval has no live deadline, so the secondary sort
   * puts the most recently decided first.
   */
  private async rows(scope: {
    orgId: string;
    approverUserId?: string;
    id?: string;
  }): Promise<ApprovalRow[]> {
    return this.prisma.$queryRaw<ApprovalRow[]>`
      SELECT a.id, a.order_id, o.order_number, a.status, a.order_value::text AS order_value,
             a.requested_by, a.approver_user_id, a.requested_at, a.decided_at, a.expires_at,
             a.comment, a.policy_id,
             (SELECT count(*)::int
                FROM ordering.order_line_unit olu
                JOIN ordering.order_line ol ON ol.id = olu.order_line_id
                JOIN ordering.sub_order so ON so.id = ol.sub_order_id
               WHERE so.order_id = a.order_id) AS units_held
        FROM ordering.order_approval a
        JOIN ordering."order" o ON o.id = a.order_id
       WHERE o.buyer_org_id = ${scope.orgId}::uuid
         AND (${scope.approverUserId ?? null}::uuid IS NULL
              OR a.approver_user_id = ${scope.approverUserId ?? null}::uuid)
         AND (${scope.id ?? null}::uuid IS NULL OR a.id = ${scope.id ?? null}::uuid)
       ORDER BY a.expires_at ASC, a.decided_at DESC NULLS LAST`;
  }

  /**
   * One row or a 404.
   *
   * Not scoped to the approver here: an approval addressed to a colleague is a
   * real record of this organisation's, and telling the reader who it was sent
   * to is more useful than pretending it does not exist. The refusal to *decide*
   * it is `decide`'s rule 1, which is where the consequence actually is. An id
   * is a uuid, so unlike T17's sequential order numbers there is no volume
   * oracle to protect against.
   */
  private async require(id: string, orgId: string): Promise<ApprovalRow> {
    const [row] = await this.rows({ orgId, id });
    if (!row) throw new NotFoundError('approval', { reason: 'no_such_approval_for_this_org' });
    return row;
  }

  private view(
    row: ApprovalRow,
    viewerUserId: string,
    names: ReadonlyMap<string, string>,
  ): ApprovalRowView {
    const expired =
      row.status === 'PENDING' && row.expires_at.getTime() <= this.clock.now().getTime();
    const status: ApprovalStatus = expired ? 'EXPIRED' : (row.status as ApprovalStatus);
    const mine = row.approver_user_id === viewerUserId;
    const own = row.requested_by === viewerUserId;

    return {
      id: row.id,
      orderNumber: row.order_number,
      status,
      orderValue: row.order_value,
      requestedByName: names.get(row.requested_by) ?? 'the person who placed it',
      approverName: names.get(row.approver_user_id) ?? 'the approver named on this order',
      requestedAt: row.requested_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      decidedAt: row.decided_at?.toISOString() ?? null,
      comment: row.comment?.trim() || null,
      unitsHeld: row.units_held,
      slaHours: Math.max(
        1,
        Math.round((row.expires_at.getTime() - row.requested_at.getTime()) / 3_600_000),
      ),
      decidable: status === 'PENDING' && mine && !own,
      blockedReason:
        status !== 'PENDING'
          ? null
          : own
            ? 'You placed this order, so you cannot also approve it.'
            : mine
              ? null
              : 'This order was sent to somebody else for approval.',
    };
  }

  /**
   * The names, passed down rather than cached on the provider.
   *
   * A Nest provider is a singleton, so a map held on `this` between a read and a
   * render is shared by every concurrent request — two approvals resolving at
   * once would print each other's managers. The map is a parameter for that
   * reason and no other.
   */
  private async names(userIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
      SELECT id, full_name FROM identity.user_account WHERE id = ANY(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  /** The policy clause in words, from the row that fired. */
  private async policyRule(row: ApprovalRow): Promise<string | null> {
    if (!row.policy_id) return null;
    const [policy] = await this.prisma.$queryRaw<
      Array<{ requires_approval_above: string | null }>
    >`
      SELECT requires_approval_above::text AS requires_approval_above
        FROM customer.buyer_approval_policy WHERE id = ${row.policy_id}::uuid`;
    if (!policy?.requires_approval_above) return null;
    return `Your organisation asks for a signature on any order above ${Money.parse(
      policy.requires_approval_above,
    ).format()}. This one is ${Money.parse(row.order_value).format()}.`;
  }

  private async settle(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    comment: string | null,
    now: Date,
  ): Promise<void> {
    // `AND status = 'PENDING'` is the concurrency guard: two approvers pressing
    // at the same instant, or one pressing twice, and only the first write lands.
    const changed = await this.prisma.$executeRaw`
      UPDATE ordering.order_approval
         SET status = ${status}, decided_at = ${now}, comment = ${comment}
       WHERE id = ${id}::uuid AND status = 'PENDING'`;
    if (changed === 0) {
      throw new PreconditionFailedError('Somebody decided this approval a moment ago.', {
        reason: 'decision_race_lost',
        approvalId: id,
      });
    }
  }

  /** Every person named on a set of rows, in one statement. */
  private namesFor(rows: readonly ApprovalRow[]): Promise<Map<string, string>> {
    return this.names(rows.flatMap((r) => [r.requested_by, r.approver_user_id]));
  }
}
