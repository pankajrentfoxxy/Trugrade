import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { ListingController } from './listing.controller';
import { ListingPublicController } from './listing-public.controller';
import { OfferBoardService } from './internal/offer-board.service';
import { LogisticsModule } from '../logistics';
import { QcModule } from '../qc';
import { ListingService } from './listing.service';
import { ListingRepository } from './internal/listing.repository';
import { MarginRuleRepository } from './internal/margin-rule.repository';
import { PricingService } from './internal/pricing.service';
import { SerialService } from './internal/serial.service';
import { SourcingService } from './internal/sourcing.service';
import { StockMovementService } from './internal/stock-movement.service';
import { LocalQcVisitPort, QcVisitPort, SubmitService } from './internal/submit.service';

/**
 * Registers the listing core: the draft wizard, units and serial validation,
 * submit, the pricing engine and its margin rules, the sourcing declaration, and
 * the one service that records unit movements.
 *
 * Pricing, sourcing and the margin rules were reachable only from the hand-built
 * testing modules inside their specs until now, which is a specific kind of dead
 * code: tested, correct, and impossible to call from a running process. They are
 * providers here so the controller can reach them, and for no other reason —
 * `ListingService` stays the only export, because the barrel is the module's
 * whole public surface and a repository leaking out of it is how the seam is
 * lost.
 *
 * Nothing new is imported for them. `PricingService` and `SourcingService` take
 * `OrgScope` and `RequestContextService` (`ContextModule` is `@Global()`), and
 * the config they read comes from the database rather than from a module.
 *
 * `QcVisitPort` is bound to the in-process implementation for now. When `qc`
 * grows a visit service of its own, this one line is what changes.
 */
@Module({
  // `QcModule` and `LogisticsModule` are here for the comparison board and for
  // nothing else. Neither imports this one, so there is no cycle: `catalog` and
  // `ordering` import `listing`, `listing` imports `qc` and `logistics`, and the
  // graph stays a tree. The board could not be assembled without them — the two
  // quality numbers are `qc`'s aggregates and the freight inside every landed
  // price is `logistics`' rate card, and reading either from here would be a
  // second definition of a number with legal consequences.
  imports: [PrismaModule, ClockModule, QcModule, LogisticsModule],
  controllers: [ListingController, ListingPublicController],
  providers: [
    ListingService,
    ListingRepository,
    MarginRuleRepository,
    PricingService,
    SerialService,
    SourcingService,
    StockMovementService,
    SubmitService,
    OfferBoardService,
    { provide: QcVisitPort, useClass: LocalQcVisitPort },
  ],
  exports: [ListingService],
})
export class ListingModule {}
