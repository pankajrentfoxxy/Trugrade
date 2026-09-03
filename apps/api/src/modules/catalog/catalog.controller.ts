import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  errorReportCsv,
  uuidSchema,
  type ConditionImage,
  type ConditionViewCode,
  type Grade,
  type ResolvedImages,
} from '@trugrade/contracts';
import { CurrentUser, Public, RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { ForbiddenError, NotFoundError } from '../../shared/errors/domain-errors';
import { RateLimiter, type RateLimitRule } from '../../shared/redis/redis.service';
import { ObjectStorePort } from '../../shared/adapters/ports';
import { PrismaService } from '../../shared/db/prisma.service';
import type { Principal } from '../../shared/db/org-scope';
import { IdentityService } from '../identity';
import { SkuRepository } from './internal/sku.repository';
import {
  CatalogBoardRepository,
  type CatalogBoardPage,
  type CatalogBrandOption,
} from './internal/catalog-board.repository';
import { ConditionImageService, type ModelCoverage } from './internal/condition-image.service';
import { CONDITION_FILENAME_CONVENTION } from './internal/condition-image-filename';
import { SkuRequestService, type NearMatch } from './internal/sku-request.service';
import { SkuImportService, type ImportResult } from './internal/sku-import.service';
import {
  CatalogSearchService,
  type Facets,
  type SearchResult,
} from './internal/catalog-search.service';
import {
  attachConditionImageSchema,
  bulkConditionImageSchema,
  catalogBoardQuerySchema,
  catalogSearchQuerySchema,
  conditionImageUploadUrlSchema,
  importSkusSchema,
  reorderConditionImagesSchema,
  retireConditionImageSchema,
  setPrimaryConditionImageSchema,
  skuDetailQuerySchema,
  skuRequestDecisionSchema,
  submitSkuRequestSchema,
  type AttachConditionImageDto,
  type BulkConditionImageDto,
  type CatalogSearchQueryDto,
  type CatalogBoardQueryDto,
  type ConditionImageUploadUrlDto,
  type ImportSkusDto,
  type ReorderConditionImagesDto,
  type RetireConditionImageDto,
  type SetPrimaryConditionImageDto,
  type SkuDetailQueryDto,
  type SkuRequestDecisionDto,
  type SubmitSkuRequestDto,
} from './dto/catalog.dto';

/**
 * The catalog over HTTP: the admin surface, and the shared read surface every
 * other client needs before it can do anything at all.
 *
 * Three decisions run through the whole file, and each of them is the answer to
 * a question that came up more than once while writing it.
 *
 * **1. Why some of these are `@Public()` and not merely "authenticated".**
 * The vendor listing wizard cannot start until it can search the catalog, open a
 * SKU and read the grade definitions — and *no vendor role holds any `catalog.*`
 * permission*. That is not an oversight in `ROLE_PERMISSIONS`: the catalog is
 * TrueTech-owned reference data that vendors read and never write, so there is
 * no vendor permission to grant. Inventing one, or handing vendors
 * `catalog.sku.read` (a customer permission), would both be a change to the role
 * model made to satisfy a routing problem. Public is the honest classification:
 * a specification sheet is not a secret, the storefront publishes the same facts
 * to anonymous buyers, and `CatalogSearchService` reads `mv_sku_search`, which
 * carries no path back to a vendor by construction (CAT-009b, VR-099).
 *
 * **2. Why the admin routes ask for the permission that names the job.** The
 * coverage grid is guarded by `catalog.condition_image.write` rather than
 * `catalog.sku.read`, even though it only reads. Every signed-in buyer holds
 * `catalog.sku.read`, and an internal worklist of the photographs we are missing
 * is not something to hand out on that basis. There is no read-only
 * condition-image permission to reach for, and adding one to the contract to
 * make a route look tidier is the wrong direction of fix.
 *
 * **3. Nothing here returns a Prisma row.** Every response is an interface
 * declared in this file and built field by field. On the public routes that is
 * the anonymity rule; on the admin routes it is what stops `normalized_key` and
 * `created_by` turning up in a console fetch six months from now because
 * somebody added a column.
 */

/**
 * Generous enough for a debounced type-ahead working through a model name,
 * tight enough that copying the catalog costs real time. Search is the one
 * public route here that runs a full-text scan per call.
 */
const SEARCH_LIMIT: RateLimitRule = { name: 'catalog-search', limit: 120, windowSeconds: 60 };

/**
 * Long enough for a buyer to read the page and open a lightbox, short enough
 * that a URL pasted into a chat has stopped working by the time it is read.
 * The SKU response itself is cached for 60 s, so this is the ceiling on how
 * stale a link in a cached page can be.
 */
const IMAGE_URL_TTL_SECONDS = 900;

/**
 * Five minutes for the console, not the buyer's fifteen — `03_UX_SPEC.md` §5.
 *
 * The coverage grid mints one of these for every live frame in the library, so
 * a tab left open all afternoon would otherwise hold several hundred live
 * capabilities to object storage. Five minutes is long enough to judge a
 * photograph and short enough that the grid is re-read before it is acted on.
 */
const ADMIN_IMAGE_URL_TTL_SECONDS = 300;

const PHOTO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** One frame. Enforced by the presign, so the browser is refused by the store. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * A key that carries nothing.
 *
 * No model name, no grade, no vendor, and — the one that matters for the bulk
 * path — not the original filename. Object keys end up in a public image URL,
 * and the filename is precisely the string that names a machine and a
 * condition. It is read for its meaning and then discarded.
 */
function photoKey(contentType: string): string {
  return `catalog/condition/${randomUUID()}.${PHOTO_EXTENSION[contentType] ?? 'bin'}`;
}

// ---------------------------------------------------------------------------
// Response shapes. Allow-lists, all of them.
// ---------------------------------------------------------------------------

export interface CatalogTreeSku {
  id: string;
  skuCode: string;
  /** The configuration in one line, as the console renders it beside the code. */
  label: string;
  isActive: boolean;
  /** Deprecating a SKU with live listings is blocked, so the count is the reason. */
  liveListingCount: number;
}

export interface CatalogTreeModel {
  id: string;
  name: string;
  skus: CatalogTreeSku[];
}

export interface CatalogTreeSeries {
  id: string;
  name: string;
  models: CatalogTreeModel[];
}

export interface CatalogTreeBrand {
  id: string;
  name: string;
  series: CatalogTreeSeries[];
}

/** The search result, plus the counts the filter rail needs to describe it. */
export interface CatalogSearchResponse extends SearchResult {
  facets: Facets;
}

export interface SkuDetailView {
  /** `skuId`, not `id` — it is the id of a SKU wherever the clients carry it. */
  skuId: string;
  skuCode: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  cpuBrand: string;
  cpuFamily: string;
  cpuModel: string;
  cpuGeneration: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  gpuType: string;
  gpuModel: string | null;
  screenSizeIn: number;
  resolution: string;
  isTouch: boolean;
  osSupported: string;
  hsnCode: string;
  isActive: boolean;
  /**
   * Present only when a grade was asked for. Carries `match` and `isGeneric`,
   * and the caller must render them: a series-level photograph is of a different
   * machine, and showing it unlabelled is the Rule 7(2) misrepresentation the
   * resolver exists to make visible rather than convenient.
   */
  images: PublicResolvedImages | null;
}

/**
 * A condition image as a buyer may see it.
 *
 * `s3Key` is the field this exists to remove. It is an internal path — the same
 * shape of value `qc-report-pdf.spec.ts` plants a GSTIN inside — and it was
 * being returned verbatim on a `@Public()` route. What the browser needs is a
 * URL, and `url` is a short-lived opaque one that names no key.
 */
export interface PublicConditionImage {
  id: string;
  grade: Grade;
  viewCode: ConditionViewCode;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
  blurDataUri?: string | null;
  /** Expires. A page that holds it for an hour re-reads the SKU. */
  url: string;
}

/**
 * A frame on the coverage grid: everything the publish rule needs, plus
 * somewhere the browser can actually fetch the photograph.
 *
 * `s3Key` stays — this route is `catalog.condition_image.write`-guarded, the
 * operator's own upload produced the key, and `coverageGaps`/`isPublishable` in
 * contracts take a whole `ConditionImage`. `url` is added rather than swapped in
 * for that reason, and it is an opaque object token, not the key signed.
 */
export interface CoverageImageView extends ConditionImage {
  url: string;
}

export interface ModelCoverageView extends Omit<ModelCoverage, 'images'> {
  images: CoverageImageView[];
}

export interface PublicResolvedImages {
  images: PublicConditionImage[];
  match: ResolvedImages['match'];
  isGeneric: boolean;
  placeholderReason?: string;
}

/**
 * One file's verdict, and — on a dry run — where to send its bytes.
 *
 * Every field is present on every row, null where it does not apply, because the
 * console renders a table: an absent key and a null key look the same to a
 * reader and different to `Object.keys`, and the row that quietly loses a column
 * is the row nobody notices was rejected.
 */
export interface BulkImageFileView {
  filename: string;
  ok: boolean;
  grade: Grade | null;
  viewCode: ConditionViewCode | null;
  sortOrder: number | null;
  /** The row this file became, on a commit. */
  imageId: string | null;
  error: string | null;
  /** The convention, on the failures that are about the convention. */
  expected: string | null;
  /** Dry run only: the key to attach, and where to PUT the bytes. */
  key: string | null;
  url: string | null;
  fields: Record<string, string> | null;
}

export interface BulkImageResponse {
  dryRun: boolean;
  attached: number;
  rejected: number;
  /** Null for a series anchor, where a generic set has no one model. */
  modelName: string | null;
  convention: string;
  maxBytes: number;
  files: BulkImageFileView[];
}

export interface GradeDefinitionView {
  grade: string;
  displayName: string;
  customerDescription: string;
  minBatteryHealthPct: number;
  maxCycleCount: number | null;
  minCosmeticScore: number;
  screenDefectsAllowed: boolean;
  /** `YYYY-MM-DD`. Which version of the rules these words belong to. */
  effectiveFrom: string;
}

export interface SkuRequestReviewRow {
  id: string;
  vendorName: string;
  rawBrand: string;
  rawModel: string;
  rawConfig: string;
  ageHours: number;
  /**
   * Always null today, and honestly so: `catalog.sku_request` has columns for
   * the free text and none for a parsed specification, so the wizard's captured
   * fields are used for near-match scoring at submission and then dropped.
   * Fabricating a spec here by parsing `rawConfig` would put a machine
   * description in front of a reviewer that no vendor ever typed.
   */
  proposedSpec: Record<string, string> | null;
  nearMatches: NearMatch[];
}

export interface SkuRequestDecisionResult {
  status: 'RESOLVED_NEW' | 'RESOLVED_MAPPED' | 'REJECTED';
  /** The SKU the vendor should now list against, when the decision produced one. */
  skuId: string | null;
}

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skus: SkuRepository,
    private readonly catalogBoard: CatalogBoardRepository,
    private readonly images: ConditionImageService,
    private readonly requests: SkuRequestService,
    private readonly importer: SkuImportService,
    private readonly search: CatalogSearchService,
    private readonly store: ObjectStorePort,
    private readonly identity: IdentityService,
    private readonly limiter: RateLimiter,
  ) {}

  // -------------------------------------------------------------------------
  // Browsing: the tree, search, one SKU, the grade bands
  // -------------------------------------------------------------------------

  /**
   * Brand > series > model > SKU, whole.
   *
   * One response rather than a lazy tree per level, because the console filters
   * across the joined path — typing "dell 512" has to match a SKU four levels
   * down, and a level-at-a-time API cannot answer that without the client
   * walking the whole thing anyway.
   *
   * Inactive brands, series and models are left out; inactive SKUs are kept and
   * flagged, because "this configuration was deprecated" is the answer the tree
   * exists to give and hiding the row turns it into "it was never there".
   */
  @Get('tree')
  @RequirePermissions('catalog.sku.read')
  async tree(): Promise<CatalogTreeBrand[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        brand_id: string;
        brand_name: string;
        series_id: string;
        series_name: string;
        model_id: string;
        model_name: string;
        sku_id: string;
        sku_code: string;
        cpu_model: string;
        ram_gb: number;
        storage_gb: number;
        storage_type: string;
        screen_size_inch: unknown;
        resolution: string;
        is_active: boolean;
      }>
    >`
      SELECT b.id AS brand_id, b.name AS brand_name,
             se.id AS series_id, se.name AS series_name,
             m.id AS model_id, m.name AS model_name,
             s.id AS sku_id, s.sku_code, s.cpu_model, s.ram_gb, s.storage_gb,
             s.storage_type, s.screen_size_inch, s.resolution, s.is_active
        FROM catalog.brand b
        JOIN catalog.series se ON se.brand_id = b.id AND se.is_active
        JOIN catalog.model  m  ON m.series_id = se.id AND m.is_active
        JOIN catalog.sku    s  ON s.model_id  = m.id
       WHERE b.is_active
       ORDER BY b.name, se.name, m.name, s.sku_code`;

    const live = await this.liveListingCounts();

    // Rebuilt into the nested shape here rather than with a JSON aggregate in
    // SQL: the flat result set is what the query planner is good at, and four
    // levels of json_agg is a query nobody edits again.
    const brands = new Map<string, CatalogTreeBrand>();
    const seriesById = new Map<string, CatalogTreeSeries>();
    const modelsById = new Map<string, CatalogTreeModel>();

    for (const r of rows) {
      let brand = brands.get(r.brand_id);
      if (!brand) {
        brand = { id: r.brand_id, name: r.brand_name, series: [] };
        brands.set(r.brand_id, brand);
      }
      let series = seriesById.get(r.series_id);
      if (!series) {
        series = { id: r.series_id, name: r.series_name, models: [] };
        seriesById.set(r.series_id, series);
        brand.series.push(series);
      }
      let model = modelsById.get(r.model_id);
      if (!model) {
        model = { id: r.model_id, name: r.model_name, skus: [] };
        modelsById.set(r.model_id, model);
        series.models.push(model);
      }
      model.skus.push({
        id: r.sku_id,
        skuCode: r.sku_code,
        label: [
          r.cpu_model,
          `${r.ram_gb} GB`,
          `${r.storage_gb} GB ${r.storage_type}`,
          // NUMERIC(4,1) arrives as a Decimal; `Number()` at the boundary, for
          // the same reason SkuRepository does it.
          `${Number(r.screen_size_inch)}" ${r.resolution}`,
        ].join(' · '),
        isActive: r.is_active,
        liveListingCount: live.get(r.sku_id) ?? 0,
      });
    }
    return [...brands.values()];
  }

  /**
   * Brands with SKU counts — the filter rail on `/catalog`.
   *
   * Separate from the paginated board so changing pages does not re-fetch the
   * chip list, and so an empty search still shows every brand to filter by.
   */
  @Get('brands')
  @RequirePermissions('catalog.sku.read')
  async brands(): Promise<CatalogBrandOption[]> {
    return this.catalogBoard.listBrands();
  }

  /**
   * Flat, paginated SKU board for the console.
   *
   * Search matches the whole path (brand, series, model, code, spec) server-side
   * so the client does not walk an entire tree to page 1 of 400.
   */
  @Get('board')
  @RequirePermissions('catalog.sku.read')
  async listBoard(
    @Query(new ZodValidationPipe(catalogBoardQuerySchema)) query: CatalogBoardQueryDto,
  ): Promise<CatalogBoardPage> {
    const { page, pageSize, q, brandId } = query;
    return this.catalogBoard.listSkus({ q, brandId }, { page, pageSize });
  }

  /**
   * How many live listings hang off each SKU.
   *
   * ponytail: a second single-schema query rather than a JOIN, so the seam is at
   * least visible — but it is still `catalog` reading `listing`'s table, and the
   * right answer is a `countLiveBySku()` on the listing barrel. Swap to it the
   * moment that module exposes one; nothing else here changes.
   */
  private async liveListingCounts(): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ sku_id: string; n: number }>>`
      SELECT sku_id, count(*)::int AS n
        FROM listing.listing
       WHERE status IN ('ACTIVE', 'PARTIALLY_ACTIVE')
       GROUP BY sku_id`;
    return new Map(rows.map((r) => [r.sku_id, r.n]));
  }

  /**
   * Search, filter, or both — with the counts for the rail beside it.
   *
   * The facets come back in the same response rather than from a second
   * endpoint, and that is a correctness requirement rather than a round-trip
   * saving: the rail must be counted under the *same* query and filters as the
   * results. Two calls can straddle a catalog import, and a rail reading
   * "Dell (36)" next to four Dells contradicts the page it belongs to — the
   * buyer then trusts whichever they read second.
   */
  @Get('search')
  @Public()
  @Header('Cache-Control', 'public, max-age=30')
  async searchCatalog(
    @Query(new ZodValidationPipe(catalogSearchQuerySchema)) query: CatalogSearchQueryDto,
    @Req() req: Request,
  ): Promise<CatalogSearchResponse> {
    await this.limiter.consume(SEARCH_LIMIT, req.ip ?? 'unknown');

    const { q, limit, offset, ...filters } = query;
    const [result, facets] = await Promise.all([
      this.search.search({ q, filters, limit, offset }),
      this.search.facets(filters, q),
    ]);
    return { ...result, facets };
  }

  /**
   * One SKU, as the catalog declares it — and, if a grade is named, the
   * photographs a buyer would see for that grade.
   */
  @Get('skus/:id')
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  async sku(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query(new ZodValidationPipe(skuDetailQuerySchema)) query: SkuDetailQueryDto,
  ): Promise<SkuDetailView> {
    const sku = await this.skus.findById(id);
    if (!sku) throw new NotFoundError('SKU');

    return {
      skuId: sku.id,
      skuCode: sku.skuCode,
      brandName: sku.brandName,
      seriesName: sku.seriesName,
      modelName: sku.modelName,
      cpuBrand: sku.cpuBrand,
      cpuFamily: sku.cpuFamily,
      cpuModel: sku.cpuModel,
      cpuGeneration: sku.cpuGeneration,
      ramGb: sku.ramGb,
      storageGb: sku.storageGb,
      storageType: sku.storageType,
      gpuType: sku.gpuType,
      gpuModel: sku.gpuModel,
      screenSizeIn: sku.screenSizeIn,
      resolution: sku.resolution,
      isTouch: sku.isTouch,
      osSupported: sku.osSupported,
      hsnCode: sku.hsnCode,
      isActive: sku.isActive,
      // `modelId` and `normalizedKey` are deliberately absent. The key is the
      // dedupe guarantee, not a public identifier, and publishing it invites a
      // client to compute one and find us disagreeing about the same machine.
      images: query.grade ? await this.publicImages(sku.id, query.grade as Grade) : null,
    };
  }

  /** The resolver's answer with the object keys taken out and URLs put in. */
  private async publicImages(skuId: string, grade: Grade): Promise<PublicResolvedImages> {
    const resolved = await this.images.resolve(skuId, grade);
    return {
      match: resolved.match,
      isGeneric: resolved.isGeneric,
      placeholderReason: resolved.placeholderReason,
      images: await Promise.all(
        resolved.images.map(async (i) => ({
          id: i.id,
          grade: i.grade,
          viewCode: i.viewCode,
          altText: i.altText,
          isPrimary: i.isPrimary,
          sortOrder: i.sortOrder,
          blurDataUri: i.blurDataUri,
          url: await this.store.presignDownload(i.s3Key, IMAGE_URL_TTL_SECONDS),
        })),
      ),
    };
  }

  /**
   * The grade bands in force today, from `catalog.v_current_grade_definition`.
   *
   * Served rather than shipped as a constant so the vendor grading a machine,
   * the buyer reading the storefront and the QC engine deciding PASS all quote
   * the same row. A grade that lives in a constant in three clients is three
   * definitions, and the one that drifts is a Rule 7(5) exposure.
   */
  @Get('grade-definitions')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  async gradeDefinitions(): Promise<GradeDefinitionView[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        grade: string;
        display_name: string;
        customer_description: string;
        min_battery_health_pct: number;
        max_cycle_count: number | null;
        min_cosmetic_score: number;
        screen_defects_allowed: boolean;
        effective_from: Date;
      }>
    >`
      SELECT grade::text AS grade, display_name, customer_description,
             min_battery_health_pct, max_cycle_count, min_cosmetic_score,
             screen_defects_allowed, effective_from
        FROM catalog.v_current_grade_definition
       ORDER BY CASE grade::text WHEN 'A_PLUS' THEN 1 WHEN 'A' THEN 2 ELSE 3 END`;

    return rows.map((r) => ({
      grade: r.grade,
      displayName: r.display_name,
      customerDescription: r.customer_description,
      minBatteryHealthPct: Number(r.min_battery_health_pct),
      maxCycleCount: r.max_cycle_count === null ? null : Number(r.max_cycle_count),
      minCosmeticScore: Number(r.min_cosmetic_score),
      screenDefectsAllowed: r.screen_defects_allowed,
      effectiveFrom: r.effective_from.toISOString().slice(0, 10),
    }));
  }

  // -------------------------------------------------------------------------
  // Condition images — the photographs the platform owns and vendors never touch
  // -------------------------------------------------------------------------

  /**
   * Which (grade, view) slots are empty, for every model.
   *
   * The grid itself is derived by the client from `coverageGaps` and
   * `isPublishable` in contracts — the same pure functions this module calls.
   * Shipping a pre-rendered grid would be a second implementation of the publish
   * rule, and the interesting failure is the two disagreeing about whether a
   * grade may go on sale.
   */
  @Get('condition-images/coverage')
  @RequirePermissions('catalog.condition_image.write')
  async coverage(): Promise<ModelCoverageView[]> {
    const rows = await this.images.coverage();
    return Promise.all(
      rows.map(async (m) => ({
        ...m,
        images: await Promise.all(
          m.images.map(async (i) => ({
            ...i,
            url: await this.store.presignDownload(i.s3Key, ADMIN_IMAGE_URL_TTL_SECONDS),
          })),
        ),
      })),
    );
  }

  /**
   * A presigned PUT, and the key to attach afterwards.
   *
   * Two steps rather than one multipart POST because the bytes never need to
   * pass through this process: a 4 MB photograph through Express is 4 MB of heap
   * and a body-limit change on every route in the app, to move a file from a
   * laptop to object storage that both ends can already reach.
   *
   * 200 rather than 201: nothing has been created. The object does not exist
   * until the client PUTs it, and the row does not exist until it attaches.
   */
  @Post('condition-images/upload-url')
  @HttpCode(200)
  @RequirePermissions('catalog.condition_image.write')
  async uploadUrl(
    @Body(new ZodValidationPipe(conditionImageUploadUrlSchema)) body: ConditionImageUploadUrlDto,
  ): Promise<{ key: string; url: string; fields?: Record<string, string>; maxBytes: number }> {
    const key = photoKey(body.contentType);
    const presigned = await this.store.presignUpload(key, body.contentType, MAX_PHOTO_BYTES);
    return { key, ...presigned, maxBytes: MAX_PHOTO_BYTES };
  }

  /**
   * Attach an uploaded photograph to a SKU, a model or a series.
   *
   * The store is asked whether the object is actually there before the row is
   * written. Without that check a typo'd key inserts perfectly happily and the
   * failure surfaces as a broken frame on a live listing, which is precisely the
   * placeholder-on-a-product-page problem the coverage gate exists to prevent.
   */
  @Post('condition-images')
  @RequirePermissions('catalog.condition_image.write')
  async attachImage(
    @Body(new ZodValidationPipe(attachConditionImageSchema)) body: AttachConditionImageDto,
    @CurrentUser() user: Principal,
  ): Promise<{ id: string }> {
    if (!(await this.store.exists(body.s3Key))) {
      throw new NotFoundError('uploaded image', { reason: 'object_missing', key: body.s3Key });
    }
    return this.images.upload({ ...body, createdBy: user.userId });
  }

  /**
   * Take a frame out of service. Never a delete — see `ConditionImageService`.
   *
   * DELETE with a body, which is unusual and deliberate: the reason is not
   * optional, and putting it in the query string would leave it in every access
   * log and proxy cache between here and the console.
   */
  @Delete('condition-images/:id')
  @HttpCode(204)
  @RequirePermissions('catalog.condition_image.write')
  retireImage(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(retireConditionImageSchema)) body: RetireConditionImageDto,
    @CurrentUser() user: Principal,
  ): Promise<void> {
    return this.images.retire(id, user.userId, body.reason);
  }

  /**
   * A dropped folder, in two passes over one route.
   *
   * The dry run parses every filename, says what each one becomes, and hands
   * back a presigned target for the ones that parsed. The commit takes those
   * keys back and writes the rows. One route rather than two, for the reason the
   * CSV importer gives: a preview produced by different code from the commit is
   * a preview of nothing, and the thing being previewed here is which grade a
   * photograph is about to claim to represent.
   *
   * Minting the upload targets inside the dry run is not a convenience. It is
   * what stops sixty separate presign calls, and it means the console never
   * chooses a key — so the "no filename in the object key" rule holds for bulk
   * uploads without depending on the client to honour it.
   *
   * 200 in both cases: a dry run creates nothing, and a commit that writes
   * eighteen rows and rejects two has no single resource to point a 201 at.
   */
  @Post('condition-images/bulk')
  @HttpCode(200)
  @RequirePermissions('catalog.condition_image.write')
  async bulkImages(
    @Body(new ZodValidationPipe(bulkConditionImageSchema)) body: BulkConditionImageDto,
    @CurrentUser() user: Principal,
  ): Promise<BulkImageResponse> {
    // The store is asked about the keys the client claims to have uploaded, for
    // the same reason the single attach does it: a row pointing at nothing is a
    // broken frame on a live listing, which is the placeholder the coverage gate
    // exists to prevent. Only on the commit — on a dry run nothing is uploaded
    // yet and every key would be "missing".
    let missingKeys: string[] = [];
    if (!body.dryRun) {
      const keys = body.files.map((f) => f.s3Key).filter((k): k is string => Boolean(k));
      const found = await Promise.all(keys.map((k) => this.store.exists(k)));
      missingKeys = keys.filter((_, i) => !found[i]);
    }

    const plan = await this.images.bulkAttach({
      anchor: body.anchor,
      anchorId: body.anchorId,
      files: body.files,
      dryRun: body.dryRun,
      actorId: user.userId,
      reason: body.reason,
      missingKeys,
    });

    const files: BulkImageFileView[] = await Promise.all(
      plan.files.map(async (f, i) => {
        const view: BulkImageFileView = {
          filename: f.filename,
          ok: f.ok,
          grade: f.grade ?? null,
          viewCode: f.viewCode ?? null,
          sortOrder: f.sortOrder ?? null,
          imageId: f.imageId ?? null,
          error: f.error ?? null,
          expected: f.expected ?? null,
          key: null,
          url: null,
          fields: null,
        };
        if (!body.dryRun || !f.ok) return view;

        const contentType = body.files[i]?.contentType ?? 'image/jpeg';
        const key = photoKey(contentType);
        const presigned = await this.store.presignUpload(key, contentType, MAX_PHOTO_BYTES);
        return { ...view, key, url: presigned.url, fields: presigned.fields ?? null };
      }),
    );

    return {
      dryRun: plan.dryRun,
      attached: plan.attached,
      rejected: plan.rejected,
      modelName: plan.modelName,
      // Served rather than restated in the console, so there is one sentence
      // describing the convention and it comes from the parser that enforces it.
      convention: CONDITION_FILENAME_CONVENTION,
      maxBytes: MAX_PHOTO_BYTES,
      files,
    };
  }

  /**
   * Name the hero frame for one (anchor, grade).
   *
   * 200 with `changed`, not 204: clicking "make primary" on the frame that
   * already is one writes nothing, and the console should be able to say so
   * rather than showing a success toast for a no-op.
   */
  @Post('condition-images/:id/primary')
  @HttpCode(200)
  @RequirePermissions('catalog.condition_image.write')
  setPrimaryImage(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(setPrimaryConditionImageSchema))
    body: SetPrimaryConditionImageDto,
    @CurrentUser() user: Principal,
  ): Promise<{ changed: boolean }> {
    return this.images.setPrimary(id, user.userId, body.reason);
  }

  /** Reorder one grade's frames. The body lists all of them, in the order wanted. */
  @Post('condition-images/reorder')
  @HttpCode(204)
  @RequirePermissions('catalog.condition_image.write')
  reorderImages(
    @Body(new ZodValidationPipe(reorderConditionImagesSchema)) body: ReorderConditionImagesDto,
    @CurrentUser() user: Principal,
  ): Promise<void> {
    return this.images.reorder({ ...body, actorId: user.userId });
  }

  // -------------------------------------------------------------------------
  // SKU requests — a vendor has a machine we do not carry
  // -------------------------------------------------------------------------

  /**
   * The review queue, oldest first, each request with the SKUs it most likely
   * already is.
   *
   * The vendor's name is joined on here rather than in the query, because the
   * organisation belongs to `identity` and reading its table from a catalog
   * query would break the seam that the module graph exists to hold. One lookup
   * per distinct org, memoised across the page — a queue is usually a handful of
   * vendors submitting several machines each.
   */
  @Get('sku-requests')
  @RequirePermissions('catalog.sku_request.review')
  async skuRequestQueue(): Promise<SkuRequestReviewRow[]> {
    const rows = await this.requests.reviewQueue();
    const names = new Map<string, Promise<string>>();

    return Promise.all(
      rows.map(async (r) => {
        let name = names.get(r.vendorOrgId);
        if (!name) {
          name = this.identity
            .getOrganization(r.vendorOrgId)
            .then((o) => o.legalName)
            // A deleted or unreadable org must not take the whole queue down:
            // the request is still reviewable, and "unknown vendor" is a more
            // useful screen than a 500.
            .catch(() => 'Unknown vendor');
          names.set(r.vendorOrgId, name);
        }
        return {
          id: r.id,
          vendorName: await name,
          rawBrand: r.rawBrand,
          rawModel: r.rawModel,
          rawConfig: r.rawConfig,
          ageHours: r.ageHours,
          proposedSpec: null,
          nearMatches: r.nearMatches,
        };
      }),
    );
  }

  /**
   * A vendor raises a request from inside the listing wizard.
   *
   * `listing.own.write` and not a `catalog.*` permission: no vendor role holds
   * one, and this is the vendor's listing flow reaching a dead end rather than
   * an act of catalog administration — they are not writing to the catalog, they
   * are asking somebody who can.
   *
   * The org id comes from the session. A body-supplied `vendorOrgId` would let
   * any vendor file a request in another's name, and the queue is where ops
   * decides who gets a SKU created for them.
   */
  @Post('sku-requests')
  @RequirePermissions('listing.own.write')
  submitSkuRequest(
    @Body(new ZodValidationPipe(submitSkuRequestSchema)) body: SubmitSkuRequestDto,
    @CurrentUser() user: Principal,
  ): Promise<{ id: string; nearMatches: NearMatch[] }> {
    if (!user.orgId) {
      // Platform staff have no vendor org, so there is nobody to attribute the
      // request to. Better a clear refusal than a row nobody can answer.
      throw new ForbiddenError('A SKU request is raised by a vendor, from their own account.', {
        reason: 'no_vendor_org',
      });
    }
    return this.requests.submit({ ...body, vendorOrgId: user.orgId });
  }

  /**
   * Approve, map onto an existing SKU, or reject with a reason.
   *
   * One endpoint for all three because they are one decision with one
   * precondition — the request is still PENDING — and three routes would be
   * three places to get that check right. The service resolves the race by
   * making `status = 'PENDING'` part of the UPDATE, so a second reviewer
   * clicking a stale screen gets a 409 rather than overwriting the first.
   *
   * 200, not 201, even for the approval that creates a SKU: approval is
   * idempotent on the normalised key, so the same specification approved twice
   * returns the SKU that already exists. A 201 would be a claim we cannot keep.
   */
  @Post('sku-requests/:id/decision')
  @HttpCode(200)
  @RequirePermissions('catalog.sku_request.review')
  async decideSkuRequest(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(skuRequestDecisionSchema)) body: SkuRequestDecisionDto,
    @CurrentUser() user: Principal,
  ): Promise<SkuRequestDecisionResult> {
    if (body.decision === 'REJECT') {
      await this.requests.reject({ requestId: id, resolvedBy: user.userId, reason: body.reason });
      return { status: 'REJECTED', skuId: null };
    }
    if (body.decision === 'MAP') {
      await this.requests.mapToExisting({
        requestId: id,
        skuId: body.skuId,
        resolvedBy: user.userId,
      });
      return { status: 'RESOLVED_MAPPED', skuId: body.skuId };
    }

    const { skuId, outcome } = await this.requests.approve({
      requestId: id,
      spec: body.spec,
      resolvedBy: user.userId,
    });
    // A SKU that exists but is not in `mv_sku_search` is a SKU the vendor still
    // cannot find — which is the exact complaint that put this request in the
    // queue. Outside the approval's transaction because REFRESH CONCURRENTLY
    // cannot run inside one.
    await this.search.refreshSearchIndex();
    return { status: outcome === 'created' ? 'RESOLVED_NEW' : 'RESOLVED_MAPPED', skuId };
  }

  // -------------------------------------------------------------------------
  // Bulk import
  // -------------------------------------------------------------------------

  /**
   * The CSV importer, with its dry run intact.
   *
   * The dry run is the whole design and it is preserved as a *flag on the same
   * route* rather than a separate endpoint, because the two must classify rows
   * identically — a preview computed by different code from the commit is a
   * preview of nothing. `dryRun` defaults to true: a bulk write must never
   * happen because a field was forgotten.
   *
   * 200 in both cases. A commit that creates 180 SKUs and merges 20 has no
   * single created resource to point a 201 at, and the report is the answer
   * either way.
   */
  @Post('skus/import')
  @HttpCode(200)
  @RequirePermissions('catalog.sku.write')
  async importSkus(
    @Body(new ZodValidationPipe(importSkusSchema)) body: ImportSkusDto,
    @CurrentUser() user: Principal,
  ): Promise<ImportResult> {
    if (body.dryRun) {
      const report = await this.importer.dryRun(body.csv);
      // The same shape as a commit, with the counters at zero, so the console
      // renders one table and not two — and the same `errorReportCsv` the
      // commit path returns, because the dry run is precisely when somebody
      // wants the list of lines to go and fix.
      return {
        created: 0,
        merged: 0,
        skipped: report.errors,
        report,
        errorReportCsv: errorReportCsv(report),
      };
    }

    const result = await this.importer.commit(body.csv, user.userId);
    // Same reasoning as an approved SKU request: unindexed rows are invisible.
    await this.search.refreshSearchIndex();
    return result;
  }
}
