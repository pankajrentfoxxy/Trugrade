import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';
import { ListingRepository } from './internal/listing.repository';
import { SerialService } from './internal/serial.service';
import { StockMovementService } from './internal/stock-movement.service';
import { LocalQcVisitPort, QcVisitPort, SubmitService } from './internal/submit.service';

/**
 * Registers the listing core: the draft wizard, units and serial validation,
 * submit, and the one service that records unit movements.
 *
 * Pricing and sourcing are two more sibling services in this module and are not
 * wired here yet — a later step adds them beside these. `ListingService` stays
 * the only export, because the barrel is the module's whole public surface and a
 * repository leaking out of it is how the seam is lost.
 *
 * `QcVisitPort` is bound to the in-process implementation for now. When `qc`
 * grows a visit service of its own, this one line is what changes.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [ListingController],
  providers: [
    ListingService,
    ListingRepository,
    SerialService,
    StockMovementService,
    SubmitService,
    { provide: QcVisitPort, useClass: LocalQcVisitPort },
  ],
  exports: [ListingService],
})
export class ListingModule {}
