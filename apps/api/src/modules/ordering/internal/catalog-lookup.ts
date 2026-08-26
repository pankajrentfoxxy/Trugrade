import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CatalogService } from '../../catalog';

/** What a buyer is shown about the machine itself. Catalog terms only. */
export interface SkuDescription {
  skuId: string;
  /** "Dell Latitude 5320" — brand and model, the way a buyer names it. */
  title: string;
  /** "Core i5 · 16 GB · 512 GB NVME_SSD · 13.3\"" */
  specSummary: string;
}

/**
 * Ordering's handle on the catalog, resolved late.
 *
 * The import above is the public barrel, which is the only legal way one module
 * reaches another. The **module graph**, though, already runs the other way:
 * `CatalogModule` imports `OrderingModule` so its public storefront controller
 * can put "orders delivered" on the homepage. Declaring `CatalogModule` in
 * ordering's `imports` as well would close that into a cycle, and Nest cannot
 * instantiate one without `forwardRef` on both sides — which means editing a
 * file this module does not own to fix a dependency this module introduced.
 *
 * So the instance is fetched from the container on first use instead, with
 * `strict: false` (search the whole application, not just this module's
 * injector). Late rather than in `onModuleInit` because ordering is constructed
 * *before* catalog — it is catalog's dependency — and the provider genuinely
 * does not exist yet at that point.
 *
 * This is the only place that indirection lives. Cart and RFQ intake both want
 * the catalog, and a second copy of the reasoning above is a second thing to
 * keep true.
 */
@Injectable()
export class CatalogLookup {
  private catalog?: CatalogService;

  constructor(private readonly moduleRef: ModuleRef) {}

  private get service(): CatalogService {
    return (this.catalog ??= this.moduleRef.get(CatalogService, { strict: false }));
  }

  /** One SKU, described. `null` when the SKU is gone — never an invented title. */
  async describe(skuId: string): Promise<SkuDescription | null> {
    const sku = await this.service.getSku(skuId);
    if (!sku) return null;
    return {
      skuId: sku.id,
      title: `${sku.brandName} ${sku.modelName}`.trim(),
      specSummary: [
        sku.cpuFamily,
        `${sku.ramGb} GB`,
        `${sku.storageGb} GB ${sku.storageType}`,
        `${sku.screenSizeIn}"`,
      ].join(' · '),
    };
  }

  /**
   * The single best catalog match for a line of free text.
   *
   * The catalog's own search is what decides — full text first, trigram
   * similarity as the typo pass. A requirement list is a document a human
   * maintained, so "Latitide 5420" is normal input and a matcher that only did
   * exact lookups would send half of a good file to the sales queue.
   */
  async bestMatch(text: string): Promise<SkuDescription | null> {
    const { hits } = await this.service.search({ q: text, limit: 1 });
    const hit = hits[0];
    if (!hit) return null;
    return {
      skuId: hit.skuId,
      title: `${hit.brandName} ${hit.modelName}`.trim(),
      specSummary: [
        hit.cpuFamily,
        `${hit.ramGb} GB`,
        `${hit.storageGb} GB`,
        `${hit.screenSizeIn}"`,
      ].join(' · '),
    };
  }
}
