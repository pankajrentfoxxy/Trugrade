import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  opsPurchaseOrderListQuerySchema,
  type OpsPurchaseOrderListQueryDto,
} from './dto/ops-purchase-order.dto';
import {
  OpsPurchaseOrderService,
  type OpsPoBoardView,
} from './internal/ops-purchase-order.service';

/**
 * The platform's purchase-order board — T39, `03_UX_SPEC.md` §3C.4.
 *
 * A separate controller from `ProcurementController` rather than a route on it,
 * for the reason `OrderingOpsController` gives about `OrderingController`: that
 * class is `@Controller('vendor/purchase-orders')` and its whole contract is
 * that every route under it is one vendor's own, org-scoped in the repository.
 * A platform-wide route living inside it would make that read of the file wrong.
 *
 * **`procurement.po.read_any` is the boundary, and it is enough.** There is no
 * org predicate below this line and there must not be one — this is every supply
 * point's purchase orders on one screen. `roles.ts` documents the convention
 * that keeps that safe: a `*.any.*` permission is never granted to a vendor or
 * buyer role, and the five roles holding this one (OPS_MANAGER, PRICING_ADMIN,
 * FINANCE, AUDITOR, PLATFORM_SUPERADMIN) are all ours.
 *
 * **Read-only, and the reasons are in the ledger rather than in a disabled
 * button.** §3C.4 asks for cancel, re-raise and chase-acceptance on this board.
 * Cancelling a purchase order reverses a leg of the order transaction — it puts
 * units back on sale, reverses the payable and the TDS accrual — and no service
 * in this codebase does any of that; chasing acceptance needs a notification
 * path and an acceptance deadline, and neither exists. A control that looks like
 * it works and does not is worse than its absence, so they are absent and the
 * screen says which and why.
 */
@Controller('ops/purchase-orders')
export class OpsProcurementController {
  constructor(private readonly pos: OpsPurchaseOrderService) {}

  @Get()
  @RequirePermissions('procurement.po.read_any')
  list(
    @Query(new ZodValidationPipe(opsPurchaseOrderListQuerySchema))
    query: OpsPurchaseOrderListQueryDto,
  ): Promise<OpsPoBoardView> {
    return this.pos.list(query);
  }
}
