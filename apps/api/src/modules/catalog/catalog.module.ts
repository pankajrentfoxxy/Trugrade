import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { ClockModule } from '../../shared/clock';
import { IdentityModule } from '../identity';
import { ListingModule } from '../listing';
import { OrderingModule } from '../ordering';
import { QcModule } from '../qc';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogPublicController } from './catalog-public.controller';
import { CatalogChangeLogService } from './internal/catalog-change-log.service';
import { SkuRepository } from './internal/sku.repository';
import { ConditionImageService } from './internal/condition-image.service';
import { SkuRequestService } from './internal/sku-request.service';
import { SkuImportService } from './internal/sku-import.service';
import { CatalogSearchService } from './internal/catalog-search.service';
import { CatalogBoardRepository } from './internal/catalog-board.repository';

/**
 * `IdentityModule` is imported for one thing: the SKU request review screen puts
 * the vendor's legal name next to each request, and the organisation belongs to
 * `identity`. Reading `identity.organization` from a catalog query instead would
 * be the cross-schema join the module graph exists to prevent — the dependency
 * is the honest version of the same read, declared where it can be seen.
 *
 * `ListingModule`, `QcModule` and `OrderingModule` are here for the same reason
 * and for one consumer only: `CatalogPublicController`'s storefront figures.
 * "Units inspected", "units sellable" and "orders delivered" are facts those
 * three modules own, and the public page used to compute them by joining their
 * schemas. None of the three imports catalog, so the graph stays acyclic.
 */
@Module({
  imports: [PrismaModule, ClockModule, IdentityModule, ListingModule, QcModule, OrderingModule],
  controllers: [CatalogController, CatalogPublicController],
  providers: [
    CatalogService,
    CatalogChangeLogService,
    SkuRepository,
    ConditionImageService,
    SkuRequestService,
    SkuImportService,
    CatalogSearchService,
    CatalogBoardRepository,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
