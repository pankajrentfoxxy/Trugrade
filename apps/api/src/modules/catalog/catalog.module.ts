import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { CatalogService } from './catalog.service';
import { SkuRepository } from './internal/sku.repository';
import { ConditionImageService } from './internal/condition-image.service';
import { SkuRequestService } from './internal/sku-request.service';
import { SkuImportService } from './internal/sku-import.service';
import { CatalogSearchService } from './internal/catalog-search.service';

@Module({
  imports: [PrismaModule, ClockModule],
  providers: [
    CatalogService,
    SkuRepository,
    ConditionImageService,
    SkuRequestService,
    SkuImportService,
    CatalogSearchService,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
