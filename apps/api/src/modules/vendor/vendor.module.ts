import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../shared/adapters/adapters.module';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { LicenceService } from './internal/licence.service';

/**
 * The vendor's own org, and the DeviceSure licence that follows its KYC state.
 *
 * `VendorController` needs no provider of its own: it reads through
 * `PrismaService` and takes the caller's org from `OrgScope`, which
 * `ContextModule` provides globally. Nothing it serves is another module's to
 * own — a dashboard is an aggregate over four tables belonging to three lanes,
 * and giving it a service here would put a fifth opinion about what "live" means
 * next to the four that already agree.
 */
@Module({
  imports: [PrismaModule, ClockModule, AdaptersModule],
  controllers: [VendorController],
  providers: [VendorService, LicenceService],
  exports: [VendorService],
})
export class VendorModule {}
