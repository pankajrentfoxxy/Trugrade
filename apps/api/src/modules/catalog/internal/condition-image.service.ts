import { Injectable } from '@nestjs/common';
import {
  resolveConditionImages,
  coverageGaps,
  isPublishable,
  CONDITION_VIEW_CODES,
  type ConditionImage,
  type ConditionViewCode,
  type Grade,
  type ResolvedImages,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { NotFoundError, ValidationError } from '../../../shared/errors/domain-errors';

/**
 * The condition image library.
 *
 * The resolution *rule* lives in `packages/contracts` as a pure function; this
 * service's only job is to fetch the candidates and hand them over. That split
 * is deliberate — the rule that a Grade A photograph must never appear on a
 * Grade B listing is the one thing here with legal consequences, and it belongs
 * somewhere that can be exhaustively tested without a database.
 */

interface RawImage {
  id: string;
  sku_id: string | null;
  model_id: string | null;
  series_id: string | null;
  grade: string;
  view_code: string;
  s3_key: string;
  alt_text: string;
  is_primary: boolean;
  sort_order: number;
  blur_data_uri: string | null;
}

function toDomain(r: RawImage): ConditionImage {
  const anchor = r.sku_id ? 'SKU' : r.model_id ? 'MODEL' : 'SERIES';
  return {
    id: r.id,
    anchor,
    anchorId: (r.sku_id ?? r.model_id ?? r.series_id)!,
    grade: r.grade as Grade,
    viewCode: r.view_code as ConditionViewCode,
    s3Key: r.s3_key,
    altText: r.alt_text,
    isPrimary: r.is_primary,
    sortOrder: r.sort_order,
    blurDataUri: r.blur_data_uri,
  };
}

export interface UploadImageInput {
  anchor: 'SKU' | 'MODEL' | 'SERIES';
  anchorId: string;
  grade: Grade;
  viewCode: string;
  s3Key: string;
  altText: string;
  isPrimary?: boolean;
  sortOrder?: number;
  defectType?: string | null;
  severity?: string | null;
  blurDataUri?: string | null;
  createdBy: string;
}

@Injectable()
export class ConditionImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Every live image reachable from a SKU: its own, its model's, its series'.
   *
   * One query rather than three sequential ones, because the resolver needs to
   * see all levels to know which it is falling back from — and a per-level query
   * would make "did we fall back?" depend on how many round trips happened.
   */
  private async candidatesFor(skuId: string): Promise<{
    images: ConditionImage[];
    modelId: string;
    seriesId: string;
  }> {
    const [tree] = await this.prisma.$queryRaw<Array<{ model_id: string; series_id: string }>>`
      SELECT s.model_id, m.series_id
      FROM catalog.sku s JOIN catalog.model m ON m.id = s.model_id
      WHERE s.id = ${skuId}::uuid`;
    if (!tree) throw new NotFoundError('SKU');

    const rows = await this.prisma.$queryRaw<RawImage[]>`
      SELECT id, sku_id, model_id, series_id, grade::text AS grade, view_code,
             s3_key, alt_text, is_primary, sort_order, blur_data_uri
      FROM catalog.condition_image
      WHERE retired_at IS NULL
        AND (sku_id = ${skuId}::uuid
             OR model_id = ${tree.model_id}::uuid
             OR series_id = ${tree.series_id}::uuid)`;

    return {
      images: rows.map(toDomain),
      modelId: tree.model_id,
      seriesId: tree.series_id,
    };
  }

  /** CAT-005: identical for two units of the same SKU and grade, every time. */
  async resolve(skuId: string, grade: Grade): Promise<ResolvedImages> {
    const { images, modelId, seriesId } = await this.candidatesFor(skuId);
    return resolveConditionImages({ skuId, modelId, seriesId, grade }, images);
  }

  async upload(input: UploadImageInput): Promise<{ id: string }> {
    if (!CONDITION_VIEW_CODES.includes(input.viewCode as ConditionViewCode)) {
      throw new ValidationError(`${input.viewCode} is not one of the ten view codes.`, {
        viewCode: `Expected one of ${CONDITION_VIEW_CODES.join(', ')}.`,
      });
    }
    if (input.altText.trim().length < 10) {
      // Accessibility, and it is what a search engine reads. "lid" satisfies
      // NOT NULL and describes nothing.
      throw new ValidationError(
        'Describe what the photograph shows, e.g. "Grade B lid with fine scratches near the hinge".',
        { altText: 'At least 10 characters.' },
      );
    }

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO catalog.condition_image
        (sku_id, model_id, series_id, grade, view_code, s3_key, alt_text,
         is_primary, sort_order, defect_type, severity, blur_data_uri, created_by)
      VALUES (${input.anchor === 'SKU' ? input.anchorId : null}::uuid,
              ${input.anchor === 'MODEL' ? input.anchorId : null}::uuid,
              ${input.anchor === 'SERIES' ? input.anchorId : null}::uuid,
              ${input.grade}::grade_type, ${input.viewCode}, ${input.s3Key},
              ${input.altText.trim()}, ${input.isPrimary ?? false}, ${input.sortOrder ?? 0},
              ${input.defectType ?? null}, ${input.severity ?? null},
              ${input.blurDataUri ?? null}, ${input.createdBy}::uuid)
      RETURNING id`;
    return { id: rows[0]!.id };
  }

  /**
   * Replace an image by retiring the old row and inserting a new one.
   *
   * Never an UPDATE of `s3_key`. Edge caches hold these for a year against an
   * immutable version-hashed URL, and "what did the buyer see on 12 August" is a
   * Rule 7(5) question that a mutated row cannot answer.
   */
  async replace(input: {
    imageId: string;
    s3Key: string;
    altText: string;
    blurDataUri?: string | null;
    actorId: string;
  }): Promise<{ id: string }> {
    return this.prisma.runInTransaction(async () => {
      const [old] = await this.prisma.$queryRaw<RawImage[]>`
        SELECT id, sku_id, model_id, series_id, grade::text AS grade, view_code,
               s3_key, alt_text, is_primary, sort_order, blur_data_uri
        FROM catalog.condition_image
        WHERE id = ${input.imageId}::uuid AND retired_at IS NULL`;
      if (!old) throw new NotFoundError('condition image');

      await this.prisma.$executeRaw`
        UPDATE catalog.condition_image
           SET retired_at = ${this.clock.now()}, retired_by = ${input.actorId}::uuid
         WHERE id = ${input.imageId}::uuid`;

      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO catalog.condition_image
          (sku_id, model_id, series_id, grade, view_code, s3_key, alt_text,
           is_primary, sort_order, blur_data_uri, version, supersedes_id, created_by)
        SELECT sku_id, model_id, series_id, grade, view_code,
               ${input.s3Key}, ${input.altText}, is_primary, sort_order,
               ${input.blurDataUri ?? null}, version + 1, id, ${input.actorId}::uuid
        FROM catalog.condition_image WHERE id = ${input.imageId}::uuid
        RETURNING id`;
      return { id: rows[0]!.id };
    });
  }

  /** The coverage grid for one model: which (grade, view) slots are empty. */
  async coverageForModel(modelId: string): Promise<ReturnType<typeof coverageGaps>> {
    const rows = await this.prisma.$queryRaw<RawImage[]>`
      SELECT id, sku_id, model_id, series_id, grade::text AS grade, view_code,
             s3_key, alt_text, is_primary, sort_order, blur_data_uri
      FROM catalog.condition_image
      WHERE retired_at IS NULL AND model_id = ${modelId}::uuid`;
    return coverageGaps(rows.map(toDomain));
  }

  /**
   * §3C.2: a grade cannot be published for a model until its set is complete.
   * The gate exists because the alternative is a placeholder on a live listing.
   */
  async publishCheck(modelId: string, grade: Grade): Promise<ReturnType<typeof isPublishable>> {
    const rows = await this.prisma.$queryRaw<RawImage[]>`
      SELECT id, sku_id, model_id, series_id, grade::text AS grade, view_code,
             s3_key, alt_text, is_primary, sort_order, blur_data_uri
      FROM catalog.condition_image
      WHERE retired_at IS NULL AND model_id = ${modelId}::uuid`;
    return isPublishable(grade, rows.map(toDomain));
  }
}
