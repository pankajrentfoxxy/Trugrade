import { Module } from '@nestjs/common';
import { ClockModule } from '../../shared/clock';
import { PrismaModule } from '../../shared/db/prisma.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { OrderingLookup } from './internal/ordering-lookup';
import { WarrantyRepository } from './internal/warranty.repository';
import { WarrantyService } from './internal/warranty.service';

/**
 * The after-sale module: warranty, claims, returns, tickets and disputes.
 *
 * **`OrderingModule` is deliberately absent.** Ordering imports *this* module —
 * for `platform.ticket` and, since T23, to open warranty cover at delivery — so
 * declaring it here would close a cycle Nest cannot instantiate without
 * `forwardRef` on both sides. `OrderingLookup` resolves `OrderingService` from
 * the container on first use instead; the reasoning lives there, in one place,
 * exactly as `CatalogLookup` does the same job in ordering.
 *
 * `PlatformService` stays the only export. `WarrantyService` and its repository
 * are internal: the split between what a supply point backs and what we fund is
 * on those types, and the barrel is the seam that keeps it from travelling.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [PlatformController],
  providers: [PlatformService, WarrantyService, WarrantyRepository, OrderingLookup],
  exports: [PlatformService],
})
export class PlatformModule {}
