import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { CatalogService } from './catalog.service';
import { SkuRepository } from './internal/sku.repository';
import { ConditionImageService } from './internal/condition-image.service';
import { SkuRequestService } from './internal/sku-request.service';

@Module({
  imports: [PrismaModule, ClockModule],
  providers: [CatalogService, SkuRepository, ConditionImageService, SkuRequestService],
  exports: [CatalogService],
})
export class CatalogModule {}
