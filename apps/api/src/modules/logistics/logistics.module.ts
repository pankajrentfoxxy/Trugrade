import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { LogisticsService } from './logistics.service';
import { FreightService } from './internal/freight.service';
import { ServiceabilityService } from './internal/serviceability.service';

/**
 * No `AdaptersModule` import, and that is deliberate rather than an omission.
 *
 * Freight is priced from `logistics.carrier_rate_card` — our negotiated contract
 * card — and serviceability from the synced `logistics.pincode_serviceability`.
 * Neither is a live carrier call, so nothing in this module needs a `CarrierPort`
 * yet. Shipment booking in Phase 8 does, and that is when the dependency should
 * appear, on the file that actually books.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  providers: [LogisticsService, FreightService, ServiceabilityService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
