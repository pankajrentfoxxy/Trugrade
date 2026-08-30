import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { uuidSchema } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  listPurchaseOrdersQuerySchema,
  poStatusSchema,
  type ListPurchaseOrdersQueryDto,
} from './dto/purchase-order.dto';
import {
  PurchaseOrderService,
  type VendorPickList,
  type VendorPoDetail,
  type VendorPoView,
} from './internal/purchase-order.service';

/**
 * The vendor's purchase orders — T32, `03_UX_SPEC.md` §3B.3.
 *
 * **These are POs we raised to them, not orders their customers placed.** The
 * vendor's counterparty on every row here is TrueTech; a buyer exists on the
 * other side of the transaction and appears nowhere in any response.
 *
 * **Permissions, and why the split is respected rather than widened.**
 * `procurement.po.read_own` is held by all five vendor roles including
 * VENDOR_VIEWER, and `procurement.po.acknowledge` by OWNER, ADMIN and OPS but
 * *not* VENDOR_FINANCE or VENDOR_VIEWER. Finance can read the PO and cannot
 * promise the machines, which is the correct division of a warehouse from a
 * ledger. No new permission was invented and none was granted to a role that
 * did not already hold it — four vendor roles held `qc.report.read` until today
 * for want of that discipline, and it let any vendor read every competitor's
 * serials.
 *
 * Not one route takes a vendor id. The org comes off the session inside
 * `PurchaseOrderRepository`, so there is no parameter to check and none to
 * forget.
 */
@Controller('vendor/purchase-orders')
export class ProcurementController {
  constructor(private readonly pos: PurchaseOrderService) {}

  @Get()
  @RequirePermissions('procurement.po.read_own')
  list(
    @Query(new ZodValidationPipe(listPurchaseOrdersQuerySchema)) query: ListPurchaseOrdersQueryDto,
  ): Promise<{ rows: VendorPoView[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize, ...filter } = query;
    return this.pos.list(filter, { page, pageSize });
  }

  /**
   * How the vendor's own POs are distributed across the statuses.
   *
   * Every status present with a zero rather than only the ones with rows, so the
   * board's filter can be rendered from one response without the client deciding
   * what an absent key means.
   *
   * Declared above `:poId`, deliberately. Nest matches in declaration order, so
   * `status-counts` after the parameterised route would be swallowed by it and
   * come back as a 422 about a malformed UUID — a failure nobody reading the
   * client could explain.
   */
  @Get('status-counts')
  @RequirePermissions('procurement.po.read_own')
  async statusCounts(): Promise<{ counts: Record<string, number>; total: number }> {
    const found = await this.pos.statusCounts();
    const counts = Object.fromEntries(poStatusSchema.options.map((s) => [s, 0]));
    let total = 0;
    for (const [status, n] of found) {
      counts[status] = n;
      total += n;
    }
    return { counts, total };
  }

  @Get(':poId')
  @RequirePermissions('procurement.po.read_own')
  detail(
    @Param('poId', new ZodValidationPipe(uuidSchema)) poId: string,
  ): Promise<VendorPoDetail> {
    return this.pos.detail(poId);
  }

  /**
   * The printable list for the box.
   *
   * A route of its own and not a flag on the detail, because it is the point at
   * which the delivery address is released: the goods have to physically travel,
   * so the street becomes the vendor's business, and until then it is not. Two
   * routes make that a boundary somebody can see rather than a branch somebody
   * has to find.
   */
  @Get(':poId/pick-list')
  @RequirePermissions('procurement.po.read_own')
  pickList(
    @Param('poId', new ZodValidationPipe(uuidSchema)) poId: string,
  ): Promise<VendorPickList> {
    return this.pos.pickList(poId);
  }

  /** 200, not 201: an acknowledgement changes a purchase order, it creates nothing. */
  @Post(':poId/acknowledge')
  @HttpCode(200)
  @RequirePermissions('procurement.po.acknowledge')
  acknowledge(
    @Param('poId', new ZodValidationPipe(uuidSchema)) poId: string,
  ): Promise<VendorPoDetail> {
    return this.pos.acknowledge(poId);
  }
}
