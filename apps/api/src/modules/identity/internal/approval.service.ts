import { Injectable } from '@nestjs/common';
import {
  MAKER_CHECKER,
  type ApprovalDocType,
  type Permission,
  type Role,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { AuditService } from './audit.service';

/**
 * Maker-checker.
 *
 * The rule this service exists to enforce is not enforced by this service. It is
 * enforced by `ck_maker_is_not_checker` on `identity.approval_request`, which
 * refuses a row whose checker is its maker no matter what code writes it. What
 * lives here is everything the database cannot see: which permission the checker
 * had to hold, which authority band the amount falls into, and the audit row.
 *
 * That split is deliberate. A control that exists only in a service is one bug
 * away from not existing; a control that exists only in the database cannot
 * explain itself to the person it refused. Both, and they say the same thing.
 */

export interface ApprovalRequestRow {
  id: string;
  doc_type: string;
  doc_id: string;
  amount: string | null;
  maker_id: string;
  made_at: Date;
  checker_id: string | null;
  checked_at: Date | null;
  decision: string | null;
  reason: string | null;
  required_permission: string;
  status: string;
}

export interface AuthorityBand {
  id: string;
  doc_type: string;
  min_amount: string;
  max_amount: string | null;
  required_role: string;
  requires_second_checker: boolean;
}

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Open a request for a second signature.
   *
   * Called from inside the transaction that creates the document, never after
   * it: a payout run that exists with no approval request attached is a run
   * somebody can release by going round the screen. Pass `tx` to join.
   */
  async request(input: {
    docType: ApprovalDocType;
    docId: string;
    amount?: number | null;
    makerId: string;
  }): Promise<ApprovalRequestRow> {
    const pair = MAKER_CHECKER[input.docType];
    if (!pair) {
      throw new ValidationError(`${input.docType} is not a document that needs a checker.`, {
        docType: 'Pick one of the ten document types that require a second signature.',
      });
    }

    // The unique index refuses a second open request on the same document; this
    // turns the constraint violation into a sentence an operator can act on.
    const [open] = await this.prisma.$queryRaw<ApprovalRequestRow[]>`
      SELECT * FROM identity.approval_request
       WHERE doc_type = ${input.docType} AND doc_id = ${input.docId}::uuid
         AND status = 'PENDING'`;
    if (open) {
      throw new ConflictError(
        'This document is already waiting for approval. Someone has to decide on the open request before another one can be raised.',
        { reason: 'approval_already_open', approvalId: open.id },
      );
    }

    const [row] = await this.prisma.$queryRaw<ApprovalRequestRow[]>`
      INSERT INTO identity.approval_request
        (doc_type, doc_id, amount, maker_id, made_at, required_permission, status)
      VALUES (${input.docType}, ${input.docId}::uuid,
              ${input.amount ?? null}::numeric, ${input.makerId}::uuid,
              ${this.clock.now()}, ${pair.checker}, 'PENDING')
      RETURNING *`;
    if (!row) throw new ConflictError('The approval request could not be opened.');

    await this.audit.record({
      action: 'identity.approval.requested',
      entityType: 'approval_request',
      entityId: row.id,
      actorUserId: input.makerId,
      after: { docType: input.docType, docId: input.docId, amount: input.amount ?? null },
    });
    return row;
  }

  /**
   * Decide. The checker is whoever is signed in — never a parameter, because a
   * checker id taken from a request body is a checker id an attacker chooses.
   */
  async decide(
    approvalId: string,
    input: { decision: 'APPROVED' | 'REJECTED'; reason?: string },
  ): Promise<ApprovalRequestRow> {
    const me = this.ctx.requirePrincipal();

    const [row] = await this.prisma.$queryRaw<ApprovalRequestRow[]>`
      SELECT * FROM identity.approval_request WHERE id = ${approvalId}::uuid`;
    if (!row) throw new NotFoundError('approval request');
    if (row.status !== 'PENDING') {
      throw new ConflictError(
        `This request was already ${row.status.toLowerCase()}. Raise a new one if the document changed.`,
        { reason: 'approval_not_pending' },
      );
    }

    if (row.maker_id === me.userId) {
      // The database refuses this too. Refusing it here as well is what lets the
      // person read why, and mirrors VR-123 on the customer side word for word.
      throw new ForbiddenError(
        'You raised this, so you cannot approve it. A second person has to look at it — that is the whole point of the control.',
        { reason: 'maker_is_checker' },
      );
    }

    if (!me.permissions.has(row.required_permission as Permission)) {
      throw new ForbiddenError("You don't have permission to do that.", {
        missing: [row.required_permission],
      });
    }

    // Amount decides who may sign. Checked against the band that was live on the
    // day the request was made, not today's ladder: re-reading the current bands
    // would let an ops change re-open a decision that was correctly made under
    // the old ones.
    const band = await this.bandFor(row.doc_type, row.amount, row.made_at);
    // PLATFORM_SUPERADMIN clears every band. Not an exemption from the control —
    // the database still refuses it approving its own work — but the break-glass
    // seat has to be able to unstick a run at 2am when the controller is asleep,
    // and a ladder nobody can step over is a ladder somebody works around.
    const clearsBand =
      !band ||
      me.roles.includes(band.required_role as Role) ||
      me.roles.includes('PLATFORM_SUPERADMIN');
    if (!clearsBand && band) {
      throw new ForbiddenError(
        `Amounts in this band are approved by ${band.required_role.replace(/_/g, ' ').toLowerCase()}. Send it to someone holding that seat.`,
        { reason: 'below_authority_band', requiredRole: band.required_role },
      );
    }
    if (input.decision === 'REJECTED' && !input.reason?.trim()) {
      throw new ValidationError('Say why you are rejecting it — the maker has to know what to fix.', {
        reason: 'A short note is enough.',
      });
    }

    const [updated] = await this.prisma.$queryRaw<ApprovalRequestRow[]>`
      UPDATE identity.approval_request
         SET checker_id = ${me.userId}::uuid,
             checked_at = ${this.clock.now()},
             decision   = ${input.decision},
             reason     = ${input.reason ?? null},
             status     = ${input.decision}
       WHERE id = ${approvalId}::uuid AND status = 'PENDING'
      RETURNING *`;
    if (!updated) {
      throw new ConflictError('Somebody decided on this a moment before you did.', {
        reason: 'approval_race',
      });
    }

    await this.audit.record({
      action: `identity.approval.${input.decision.toLowerCase()}`,
      entityType: 'approval_request',
      entityId: updated.id,
      actorUserId: me.userId,
      before: { status: 'PENDING' },
      after: { status: updated.status, docType: updated.doc_type, docId: updated.doc_id },
    });
    return updated;
  }

  /** The maker taking it back. Not a decision, so it never carries a checker. */
  async withdraw(approvalId: string): Promise<ApprovalRequestRow> {
    const me = this.ctx.requirePrincipal();
    const [updated] = await this.prisma.$queryRaw<ApprovalRequestRow[]>`
      UPDATE identity.approval_request
         SET status = 'WITHDRAWN'
       WHERE id = ${approvalId}::uuid AND status = 'PENDING' AND maker_id = ${me.userId}::uuid
      RETURNING *`;
    if (!updated) {
      throw new ConflictError(
        'Only the person who raised a request can withdraw it, and only while it is still waiting.',
        { reason: 'not_withdrawable' },
      );
    }
    return updated;
  }

  /** The checker's queue: everything they hold the permission to decide. */
  async pending(): Promise<ApprovalRequestRow[]> {
    const me = this.ctx.requirePrincipal();
    const held = [...me.permissions];
    if (!held.length) return [];
    return this.prisma.$queryRaw<ApprovalRequestRow[]>`
      SELECT * FROM identity.approval_request
       WHERE status = 'PENDING'
         AND required_permission = ANY(${held}::text[])
         -- Never their own. A queue that shows work you cannot act on trains
         -- people to ignore the queue.
         AND maker_id <> ${me.userId}::uuid
       ORDER BY made_at`;
  }

  /** Everything ever decided on one document, for the record panel. */
  async forDocument(docType: string, docId: string): Promise<ApprovalRequestRow[]> {
    return this.prisma.$queryRaw<ApprovalRequestRow[]>`
      SELECT * FROM identity.approval_request
       WHERE doc_type = ${docType} AND doc_id = ${docId}::uuid
       ORDER BY made_at DESC`;
  }

  /**
   * The band an amount falls into, on a given day.
   *
   * A document with no amount (a period close, a GST return) still has a band —
   * the zero-floor row — which is how those get a required role without a
   * separate table.
   */
  async bandFor(
    docType: string,
    amount: string | number | null,
    onDate: Date = this.clock.now(),
  ): Promise<AuthorityBand | null> {
    const value = amount === null ? 0 : Number(amount);
    const [band] = await this.prisma.$queryRaw<AuthorityBand[]>`
      SELECT id, doc_type, min_amount::text, max_amount::text, required_role, requires_second_checker
        FROM identity.authority_band
       WHERE doc_type = ${docType}
         AND min_amount <= ${value}::numeric
         AND (max_amount IS NULL OR max_amount >= ${value}::numeric)
         AND effective_from <= ${onDate}::date
         AND (effective_to IS NULL OR effective_to >= ${onDate}::date)
       ORDER BY min_amount DESC
       LIMIT 1`;
    return band ?? null;
  }

  async bands(docType?: string): Promise<AuthorityBand[]> {
    return this.prisma.$queryRaw<AuthorityBand[]>`
      SELECT id, doc_type, min_amount::text, max_amount::text, required_role, requires_second_checker
        FROM identity.authority_band
       WHERE (${docType ?? null}::text IS NULL OR doc_type = ${docType ?? null})
       ORDER BY doc_type, min_amount`;
  }

  /**
   * Editing the ladder.
   *
   * Closes the old row rather than updating it: "who could approve a two lakh
   * credit note in September" has to stay answerable after the ladder changes,
   * and an UPDATE erases the answer.
   */
  async setBand(input: {
    docType: string;
    minAmount: number;
    maxAmount: number | null;
    requiredRole: Role;
    requiresSecondChecker: boolean;
  }): Promise<AuthorityBand> {
    const me = this.ctx.requirePrincipal();
    const today = this.clock.now();

    return this.prisma.runInTransaction(async () => {
      await this.prisma.$executeRaw`
        UPDATE identity.authority_band
           SET effective_to = ${today}::date
         WHERE doc_type = ${input.docType}
           AND min_amount = ${input.minAmount}::numeric
           AND effective_to IS NULL`;

      const [row] = await this.prisma.$queryRaw<AuthorityBand[]>`
        INSERT INTO identity.authority_band
          (doc_type, min_amount, max_amount, required_role, requires_second_checker, effective_from)
        VALUES (${input.docType}, ${input.minAmount}::numeric,
                ${input.maxAmount}::numeric, ${input.requiredRole},
                ${input.requiresSecondChecker}, ${today}::date)
        RETURNING id, doc_type, min_amount::text, max_amount::text, required_role, requires_second_checker`;
      if (!row) throw new ConflictError('The band could not be saved.');

      await this.audit.record({
        action: 'identity.authority_band.changed',
        entityType: 'authority_band',
        entityId: row.id,
        actorUserId: me.userId,
        after: input,
      });
      return row;
    });
  }
}
