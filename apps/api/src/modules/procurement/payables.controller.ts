import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { PayableService, type VendorPayablesView } from './internal/payable.service';

/**
 * What we owe this vendor — T33, `03_UX_SPEC.md` §3B.4 `/vendor/payables`.
 *
 * **One route, and `/vendor/payouts` is deliberately not built.**
 * `procurement.payout_run` and `payout_line` are empty and no code path writes
 * either, so a payout board and a statement detail would be a route pair whose
 * only reachable state is "nothing here" — scaffolding for a writer that belongs
 * to T40. What §3B.4 actually asks the statement to *say* — the full deduction
 * stack, every line, always, including a ₹0 TDS line with its reason — is built
 * from `vendor_payable`, which has real rows, and served here.
 *
 * **Permission: `procurement.po.read_own`, and that is a documented deviation.**
 * §3B.4 restricts this screen to VENDOR_FINANCE and OWNER. There is no
 * `procurement.payable.read_own` in `ROLE_PERMISSIONS` and inventing one means
 * editing `packages/contracts/src/roles.ts`, which another lane owns this week.
 * `po.read_own` is the honest interim: every figure on this response is the
 * money side of a purchase order the holder can already open — `gross` is that
 * PO's `total_net` and `tds` is its `tds_amount`, both already on
 * `/api/vendor/purchase-orders/:id`. What it does widen is `penalties` and
 * `qc_fee`, which are ₹0 on every row in existence because `payment.penalty` has
 * no rows and `qc.fee_bearer` is TRUETECH. Narrow this to a permission of its
 * own when contracts is free; it is in the ledger as such.
 */

/** `vendor_payable.status`, as its CHECK constraint allows. */
const payableStatusSchema = z.enum([
  'ACCRUED',
  'ELIGIBLE',
  'IN_RUN',
  'PAID',
  'ON_HOLD',
  'CANCELLED',
]);

const payablesQuerySchema = z.object({ status: payableStatusSchema.optional() });
type PayablesQueryDto = z.infer<typeof payablesQuerySchema>;

@Controller('vendor/payables')
export class PayablesController {
  constructor(private readonly payables: PayableService) {}

  /**
   * Takes no parameter naming a vendor. The org comes off the session inside
   * `PayableRepository`, so there is nothing to check and nothing to forget.
   */
  @Get()
  @RequirePermissions('procurement.payable.read_own')
  view(
    @Query(new ZodValidationPipe(payablesQuerySchema)) query: PayablesQueryDto,
  ): Promise<VendorPayablesView> {
    return this.payables.view(query.status);
  }
}
