import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { AdaptersModule } from '../../shared/adapters/adapters.module';
import { LogisticsService } from './logistics.service';
import { FreightService } from './internal/freight.service';
import { ServiceabilityService } from './internal/serviceability.service';
import { RoutingService } from './internal/routing.service';
import { ShipmentService } from './internal/shipment.service';
import { OpsBoardsController } from './ops-boards.controller';
import { FulfilmentBoardService } from './internal/fulfilment-board.service';
import { OpsLogisticsController } from './ops-logistics.controller';
import { CarrierWebhookController } from './webhook.controller';
import { RiderController } from './rider.controller';
import { LogisticsDeliveryService } from './internal/delivery.service';
import { AutomationModule } from '../../shared/automation/automation.service';

/**
 * Booking arrived, and the carrier dependency came with it.
 *
 * This module used to import no `AdaptersModule` on purpose: freight was priced
 * from our own rate card and serviceability from the synced pincode table, so
 * nothing here made a live carrier call. `ShipmentService` does — it asks for an
 * AWB and a label — so the dependency now sits on the module that books, exactly
 * where the previous comment said it should appear.
 */
@Module({
  imports: [AutomationModule, PrismaModule, ClockModule, AdaptersModule],
  controllers: [
    OpsLogisticsController,
    OpsBoardsController,
    CarrierWebhookController,
    RiderController,
  ],
  providers: [
    LogisticsService,
    FreightService,
    ServiceabilityService,
    RoutingService,
    ShipmentService,
    LogisticsDeliveryService,
    FulfilmentBoardService,
  ],
  exports: [LogisticsService, ShipmentService, LogisticsDeliveryService],
})
export class LogisticsModule {}
