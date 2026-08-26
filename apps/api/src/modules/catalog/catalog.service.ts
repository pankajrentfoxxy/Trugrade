import { Injectable } from '@nestjs/common';
import type { Grade, ResolvedImages } from '@trugrade/contracts';
import { PrismaService } from '../../shared/db/prisma.service';
import { ConditionImageService, type UploadImageInput } from './internal/condition-image.service';
import { SkuRepository, type SkuRow } from './internal/sku.repository';
import {
  SkuRequestService,
  type NearMatch,
  type SkuRequestDraft,
} from './internal/sku-request.service';

/**
 * The public interface of the `catalog` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `catalog` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: brand -> series -> model -> SKU, condition image library, SKU requests, change log
 *
 * Other modules reach this through `src/modules/catalog` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface ICatalogService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;

  getSku(skuId: string): Promise<SkuRow | null>;

  /**
   * The photographs a buyer sees for one (SKU, grade).
   *
   * The result carries **how** it was arrived at, and callers must render that.
   * A series-level photograph is of a different machine, and showing it
   * unlabelled is the misrepresentation Rule 7(2) prohibits — so the match level
   * is part of the contract, not a debugging aid.
   */
  resolveImages(skuId: string, grade: Grade): Promise<ResolvedImages>;

  /** Near matches for a proposed SKU, shown to the vendor BEFORE they submit. */
  nearMatches(draft: SkuRequestDraft): Promise<NearMatch[]>;

  submitSkuRequest(draft: SkuRequestDraft): Promise<{ id: string; nearMatches: NearMatch[] }>;
}

@Injectable()
export class CatalogService implements ICatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skus: SkuRepository,
    private readonly images: ConditionImageService,
    private readonly requests: SkuRequestService,
  ) {}

  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    // Grade definitions are what the Phase 4 QC engine grades against. An empty
    // table makes every machine ungradeable — silently, because nothing throws
    // — so it is worth failing the health check over rather than discovering it
    // when the first inspection runs.
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM catalog.v_current_grade_definition`;
    const n = Number(row?.n ?? 0);
    return n >= 3
      ? { ok: true }
      : { ok: false, detail: `Only ${n} grade definitions in effect — expected 3.` };
  }

  getSku(skuId: string): Promise<SkuRow | null> {
    return this.skus.findById(skuId);
  }

  resolveImages(skuId: string, grade: Grade): Promise<ResolvedImages> {
    return this.images.resolve(skuId, grade);
  }

  uploadImage(input: UploadImageInput): Promise<{ id: string }> {
    return this.images.upload(input);
  }

  nearMatches(draft: SkuRequestDraft): Promise<NearMatch[]> {
    return this.requests.nearMatches(draft);
  }

  submitSkuRequest(draft: SkuRequestDraft): Promise<{ id: string; nearMatches: NearMatch[] }> {
    return this.requests.submit(draft);
  }
}
