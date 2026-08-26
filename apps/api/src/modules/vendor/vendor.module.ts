import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../shared/adapters/adapters.module';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { VendorService } from './vendor.service';
import { LicenceService } from './internal/licence.service';

@Module({
  imports: [PrismaModule, ClockModule, AdaptersModule],
  providers: [VendorService, LicenceService],
  exports: [VendorService],
})
export class VendorModule {}
