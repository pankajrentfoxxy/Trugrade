import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { QcModule } from '../qc';
import { EventBusModule } from '../../shared/events/event-bus';
import { ProcurementController } from './procurement.controller';
import { PayablesController } from './payables.controller';
import { OpsProcurementController } from './ops-procurement.controller';
import { ProcurementService } from './procurement.service';
import { OrderPropagationService } from './internal/order-propagation.service';
import { PayoutRunService } from './internal/payout-run.service';
import { PoPdfService } from './internal/po-pdf.service';
import { PayoutController } from './payout.controller';
import { FinanceBoardsController } from './finance-boards.controller';
import { EscrowCreditController } from './escrow-credit.controller';
import { FinanceBoardService } from './internal/finance-board.service';
import { PurchaseOrderRepository } from './internal/purchase-order.repository';
import { PurchaseOrderService } from './internal/purchase-order.service';
import { PayableRepository } from './internal/payable.repository';
import { PayableService } from './internal/payable.service';
import { OpsPurchaseOrderService } from './internal/ops-purchase-order.service';
import { IdentityModule } from '../identity';
import { AutomationModule } from '../../shared/automation/automation.service';

/**
 * The procurement module's first internals and first routes (T32).
 *
 * Until now this module owned four full tables and no code: `ordering`'s
 * `order-transaction.service.ts` writes the purchase order, its lines, the
 * vendor payable and the TDS accrual inside the same transaction as the order,
 * which is right — the PO is part of the order's atomicity, not a downstream
 * effect. What was missing was the vendor's own way to read any of it.
 *
 * `CatalogModule` and `QcModule` are imported for the SKU title and the seal on
 * a PO line, and for nothing else. Neither imports this one — `catalog` imports
 * `ordering`, `ordering` imports `listing`, `listing` imports `qc` — so the
 * graph stays a tree and no `forwardRef` is needed. Reading `catalog.sku` or
 * `qc.qc_seal` from here directly would be a second definition of "which seal is
 * the current one", which is a rule `qc` owns.
 */
@Module({
  imports: [AutomationModule, CatalogModule, QcModule, EventBusModule, IdentityModule],
  controllers: [
    ProcurementController,
    PayablesController,
    OpsProcurementController,
    PayoutController,
    FinanceBoardsController,
    EscrowCreditController,
  ],
  providers: [
    ProcurementService,
    OrderPropagationService,
    PayoutRunService,
    FinanceBoardService,
    PoPdfService,
    PurchaseOrderRepository,
    PurchaseOrderService,
    PayableRepository,
    PayableService,
    OpsPurchaseOrderService,
  ],
  exports: [ProcurementService],
})
export class ProcurementModule {}
