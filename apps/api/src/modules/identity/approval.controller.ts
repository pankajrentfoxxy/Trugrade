import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  APPROVAL_DOC_TYPES,
  MAKER_CHECKER,
  type ApprovalDocType,
  type Role,
} from '@trugrade/contracts';
import { CurrentUser, RequirePermissions } from '../../shared/auth/guards';
import type { Principal } from '../../shared/db/org-scope';
import { ValidationError } from '../../shared/errors/domain-errors';
import { ApprovalService } from './internal/approval.service';

/**
 * The approvals inbox — Stage 7 §7.2.
 *
 * There is no `@RequirePermissions` on the decide route, and that is not an
 * oversight. The permission a checker needs is a property of the *document*, not
 * of the route: a journal voucher needs `finance.journal.post`, a write-off
 * needs `finance.writeoff.approve`. The service reads `required_permission` off
 * the row it is deciding and checks that. A single decorator here would have to
 * name the union of all ten, which would let a tax manager open a payout run.
 */
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  /** What this seat can decide right now. Empty is the normal state. */
  @Get()
  pending(): ReturnType<ApprovalService['pending']> {
    return this.approvals.pending();
  }

  /**
   * The matrix itself, so the console renders the pair rather than hard-coding
   * it a second time. Read by anyone signed in: knowing that a write-off needs
   * two signatures is not a secret, and a screen that cannot name the rule
   * cannot explain a refusal.
   */
  @Get('matrix')
  matrix(): { docTypes: readonly ApprovalDocType[]; pairs: typeof MAKER_CHECKER } {
    return { docTypes: APPROVAL_DOC_TYPES, pairs: MAKER_CHECKER };
  }

  @Get('bands')
  @RequirePermissions('identity.audit.read')
  bands(@Query('docType') docType?: string): ReturnType<ApprovalService['bands']> {
    return this.approvals.bands(docType);
  }

  @Post('bands')
  @RequirePermissions('platform.config.write')
  setBand(
    @Body()
    body: {
      docType?: string;
      minAmount?: number;
      maxAmount?: number | null;
      requiredRole?: string;
      requiresSecondChecker?: boolean;
    },
  ): ReturnType<ApprovalService['setBand']> {
    if (!body.docType || typeof body.minAmount !== 'number' || !body.requiredRole) {
      throw new ValidationError('A band needs a document type, a floor and the seat that signs it.', {
        docType: 'Which document this ladder is for.',
        minAmount: 'The lowest amount this band covers.',
        requiredRole: 'The seat that may approve amounts in this band.',
      });
    }
    return this.approvals.setBand({
      docType: body.docType,
      minAmount: body.minAmount,
      maxAmount: body.maxAmount ?? null,
      requiredRole: body.requiredRole as Role,
      requiresSecondChecker: body.requiresSecondChecker ?? false,
    });
  }

  @Get(':docType/:docId')
  @RequirePermissions('identity.audit.read')
  forDocument(
    @Param('docType') docType: string,
    @Param('docId') docId: string,
  ): ReturnType<ApprovalService['forDocument']> {
    return this.approvals.forDocument(docType, docId);
  }

  @Post(':id/decide')
  decide(
    @Param('id') id: string,
    @Body() body: { decision?: string; reason?: string },
  ): ReturnType<ApprovalService['decide']> {
    if (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') {
      throw new ValidationError('Approve it or reject it.', {
        decision: 'Send APPROVED or REJECTED.',
      });
    }
    return this.approvals.decide(id, {
      decision: body.decision,
      ...(body.reason ? { reason: body.reason } : {}),
    });
  }

  @Post(':id/withdraw')
  withdraw(@Param('id') id: string): ReturnType<ApprovalService['withdraw']> {
    return this.approvals.withdraw(id);
  }

  /**
   * Raising one by hand.
   *
   * Every document that needs a checker opens its own request inside the
   * transaction that creates it, so this route exists for the one case that has
   * no document yet: an ops person asking for a decision on something the
   * automation did not catch. The maker is always the caller.
   */
  @Post()
  request(
    @CurrentUser() me: Principal,
    @Body() body: { docType?: string; docId?: string; amount?: number | null },
  ): ReturnType<ApprovalService['request']> {
    const docType = body.docType as ApprovalDocType | undefined;
    if (!docType || !MAKER_CHECKER[docType] || !body.docId) {
      throw new ValidationError('Name the document and what kind it is.', {
        docType: `One of: ${APPROVAL_DOC_TYPES.join(', ')}.`,
        docId: 'The id of the document needing a second signature.',
      });
    }
    // The maker permission is checked here rather than by a decorator for the
    // same reason the checker one is: it depends on the document type.
    if (!me.permissions.has(MAKER_CHECKER[docType].maker)) {
      throw new ValidationError('You cannot raise this kind of document.', {
        docType: 'Ask somebody who works on these to raise it.',
      });
    }
    return this.approvals.request({
      docType,
      docId: body.docId,
      amount: body.amount ?? null,
      makerId: me.userId,
    });
  }
}
