import { Injectable } from '@nestjs/common';
import {
  resolveConditionImages,
  coverageGaps,
  isPublishable,
  CONDITION_VIEW_CODES,
  type ConditionImage,
  type ConditionViewCode,
  type Grade,
  type ImageAnchor,
  type ResolvedImages,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { NotFoundError, ValidationError } from '../../../shared/errors/domain-errors';
import { CatalogChangeLogService } from './catalog-change-log.service';
import {
  CONDITION_FILENAME_CONVENTION,
  normaliseFilenameToken,
  parseConditionImageFilename,
} from './condition-image-filename';

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

/** One row of the coverage grid: a model and every live frame anchored to it. */
export interface ModelCoverage {
  modelId: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  images: ConditionImage[];
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
  /** Why this frame is being added. Recorded on the change log. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Bulk upload
// ---------------------------------------------------------------------------

export interface BulkFileInput {
  /** As the browser reported it. The convention is read out of this. */
  filename: string;
  /** Absent on a dry run — the bytes have not been uploaded yet. */
  s3Key?: string;
  altText?: string;
}

/** One file's verdict. Present for every file submitted, passed or failed. */
export interface BulkFileResult {
  filename: string;
  ok: boolean;
  grade?: Grade;
  viewCode?: ConditionViewCode;
  sortOrder?: number;
  /** The row this file became. Only on a commit. */
  imageId?: string;
  error?: string;
  /** The convention, restated on the failures that are about the convention. */
  expected?: string;
}

export interface BulkAttachInput {
  anchor: ImageAnchor;
  anchorId: string;
  files: readonly BulkFileInput[];
  dryRun: boolean;
  actorId: string;
  reason?: string;
  /**
   * Keys the object store could not find, folded into the per-file report.
   *
   * Passed in rather than checked here because the store is the controller's
   * dependency: giving this service an `ObjectStorePort` would make every unit
   * that constructs it — the integration suites included — need the adapters
   * module to resolve a photograph library that mostly does not touch storage.
   */
  missingKeys?: readonly string[];
}

export interface BulkAttachResult {
  dryRun: boolean;
  attached: number;
  rejected: number;
  files: BulkFileResult[];
  /** The model the anchor resolves to, so the console can show a real example. */
  modelName: string | null;
}

@Injectable()
export class ConditionImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly changeLog: CatalogChangeLogService,
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

    // Logged for the same reason a SKU edit is: the photographs are a claim
    // about condition under Rule 7(2), and "who put this frame on this grade,
    // and when" is a question somebody will eventually have to answer.
    await this.changeLog.record({
      entityType: 'condition_image',
      entityId: rows[0]!.id,
      action: 'CREATE',
      field: `${input.grade}/${input.viewCode}`,
      newValue: input.s3Key,
      reason: input.reason ?? `${input.anchor} image added`,
      actorId: input.createdBy,
      skuId: input.anchor === 'SKU' ? input.anchorId : null,
    });
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
    reason?: string;
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

      // One entry, on the NEW row, carrying the old key. A replacement is a
      // single event; logging it twice (retire + create) would make the trail
      // read as though the slot was empty for an instant, which it never was.
      await this.changeLog.record({
        entityType: 'condition_image',
        entityId: rows[0]!.id,
        action: 'UPDATE',
        field: `${old.grade}/${old.view_code}`,
        oldValue: old.s3_key,
        newValue: input.s3Key,
        reason: input.reason ?? 'image replaced',
        actorId: input.actorId,
        skuId: old.sku_id,
      });
      return { id: rows[0]!.id };
    });
  }

  /**
   * Take a frame out of service without deleting it.
   *
   * Retire, never DELETE, for the reason the column exists: the row is the
   * record of what a buyer was shown, and a row that is gone cannot answer a
   * Rule 7(5) question about last August. The partial unique index over the
   * live rows is what makes the slot immediately re-fillable.
   */
  async retire(imageId: string, actorId: string, reason: string): Promise<void> {
    const [old] = await this.prisma.$queryRaw<RawImage[]>`
      SELECT id, sku_id, model_id, series_id, grade::text AS grade, view_code,
             s3_key, alt_text, is_primary, sort_order, blur_data_uri
      FROM catalog.condition_image
      WHERE id = ${imageId}::uuid AND retired_at IS NULL`;
    // Already retired reads the same as never existed, which is the honest
    // answer: there is no live image at this id either way.
    if (!old) throw new NotFoundError('condition image');

    await this.prisma.$executeRaw`
      UPDATE catalog.condition_image
         SET retired_at = ${this.clock.now()}, retired_by = ${actorId}::uuid
       WHERE id = ${imageId}::uuid`;

    await this.changeLog.record({
      entityType: 'condition_image',
      entityId: imageId,
      action: 'RETIRE',
      field: `${old.grade}/${old.view_code}`,
      oldValue: old.s3_key,
      newValue: null,
      reason,
      actorId,
      skuId: old.sku_id,
    });
  }

  /**
   * Every model with its live model-anchored images, for the coverage grid.
   *
   * The console derives the (grade, view) matrix and the publish gate itself,
   * from `coverageGaps` and `isPublishable` in contracts — the same pure
   * functions this service calls. That is deliberate: shipping the grid from
   * here would be a second implementation of the rule, and the interesting
   * failure is the two disagreeing about whether a grade may be published.
   *
   * LEFT JOIN, so a model with no photographs at all appears — it is the worst
   * row on the screen and an INNER JOIN would hide exactly that one.
   *
   * ponytail: the whole active catalog in one response, because the screen has
   * no pagination and sorts worst-first across everything. At a few thousand
   * models this needs a page or a gaps-only filter; it is a couple of hundred
   * bytes per model until then.
   */
  async coverage(): Promise<ModelCoverage[]> {
    const rows = await this.prisma.$queryRaw<
      Array<
        Partial<RawImage> & {
          coverage_model_id: string;
          brand_name: string;
          series_name: string;
          model_name: string;
          id: string | null;
        }
      >
    >`
      SELECT m.id AS coverage_model_id, b.name AS brand_name, se.name AS series_name,
             m.name AS model_name,
             ci.id, ci.sku_id, ci.model_id, ci.series_id, ci.grade::text AS grade,
             ci.view_code, ci.s3_key, ci.alt_text, ci.is_primary, ci.sort_order,
             ci.blur_data_uri
        FROM catalog.model m
        JOIN catalog.series se ON se.id = m.series_id
        JOIN catalog.brand  b  ON b.id  = se.brand_id
        LEFT JOIN catalog.condition_image ci
               ON ci.model_id = m.id AND ci.retired_at IS NULL
       WHERE m.is_active
       ORDER BY b.name, se.name, m.name`;

    const byModel = new Map<string, ModelCoverage>();
    for (const r of rows) {
      let model = byModel.get(r.coverage_model_id);
      if (!model) {
        model = {
          modelId: r.coverage_model_id,
          brandName: r.brand_name,
          seriesName: r.series_name,
          modelName: r.model_name,
          images: [],
        };
        byModel.set(r.coverage_model_id, model);
      }
      // Null id is the LEFT JOIN's empty side: a model with no images yet.
      if (r.id) model.images.push(toDomain(r as RawImage));
    }
    return [...byModel.values()];
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

  // -------------------------------------------------------------------------
  // Bulk upload — Phase 2 Task 4
  // -------------------------------------------------------------------------

  /**
   * The model an anchor belongs to, which is what a filename's `<model>` is
   * checked against.
   *
   * Null for a series anchor, and that is not a gap: a series-level set is
   * *deliberately* generic — it is what we show when we have nothing closer — so
   * there is no single model name for a file to have to match.
   */
  private async anchorModelName(anchor: ImageAnchor, anchorId: string): Promise<string | null> {
    if (anchor === 'SERIES') {
      const [series] = await this.prisma.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM catalog.series WHERE id = ${anchorId}::uuid`;
      if (!series) throw new NotFoundError('series');
      return null;
    }
    const rows =
      anchor === 'SKU'
        ? await this.prisma.$queryRaw<Array<{ name: string }>>`
            SELECT m.name FROM catalog.sku s
              JOIN catalog.model m ON m.id = s.model_id
             WHERE s.id = ${anchorId}::uuid`
        : await this.prisma.$queryRaw<Array<{ name: string }>>`
            SELECT name FROM catalog.model WHERE id = ${anchorId}::uuid`;
    if (!rows[0]) throw new NotFoundError(anchor === 'SKU' ? 'SKU' : 'model');
    return rows[0].name;
  }

  /**
   * Which (grade, view, n) slots already hold a live frame at this anchor.
   *
   * Read before anything is written, so a re-dropped folder is reported per file
   * as "that slot is taken" rather than as a unique-index violation that aborts
   * the transaction and takes the other fifty-nine frames with it.
   *
   * `IS NOT DISTINCT FROM` rather than a dynamically named column: exactly one
   * anchor column is non-null on any row (chk_condition_one_anchor), so passing
   * all three — two of them NULL — selects the right level without string-built
   * SQL.
   */
  private async liveSlots(anchor: ImageAnchor, anchorId: string): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ grade: string; view_code: string; sort_order: number }>
    >`
      SELECT grade::text AS grade, view_code, sort_order
        FROM catalog.condition_image
       WHERE retired_at IS NULL
         AND sku_id    IS NOT DISTINCT FROM ${anchor === 'SKU' ? anchorId : null}::uuid
         AND model_id  IS NOT DISTINCT FROM ${anchor === 'MODEL' ? anchorId : null}::uuid
         AND series_id IS NOT DISTINCT FROM ${anchor === 'SERIES' ? anchorId : null}::uuid`;
    return new Set(rows.map((r) => `${r.grade}|${r.view_code}|${r.sort_order}`));
  }

  /**
   * Attach a whole folder at once, taking the grade and the view from each
   * filename.
   *
   * **Every file gets a verdict.** A name that does not follow the convention is
   * reported with what was expected, and the batch carries on. The failure mode
   * this replaces is a bulk tool that quietly ignores what it cannot read: it
   * produces a coverage grid that looks fuller than the library is, and the gap
   * is discovered by a buyer looking at a placeholder.
   *
   * `dryRun` is the CSV importer's idea, for the CSV importer's reason — the
   * console shows the operator what sixty files are about to become *before* a
   * byte is uploaded. Both paths run this one method, so the preview cannot be a
   * preview of different logic.
   *
   * Partial commit, deliberately. Each file is an independent slot, and
   * withholding fifty-nine correct frames because one was misnamed means
   * renaming a file and re-uploading everything.
   */
  async bulkAttach(input: BulkAttachInput): Promise<BulkAttachResult> {
    const modelName = await this.anchorModelName(input.anchor, input.anchorId);
    const expectedModel = modelName === null ? null : normaliseFilenameToken(modelName);
    const missing = new Set(input.missingKeys ?? []);
    // Seeded with what is already live, so a duplicate inside the batch and a
    // collision with an existing frame produce the same, correct, message.
    const taken = await this.liveSlots(input.anchor, input.anchorId);

    const files: BulkFileResult[] = input.files.map((file) => {
      const parsed = parseConditionImageFilename(file.filename);
      if (!parsed.ok) {
        return {
          filename: file.filename,
          ok: false,
          error: parsed.error,
          expected: parsed.expected,
        };
      }

      const planned: BulkFileResult = {
        filename: file.filename,
        ok: true,
        grade: parsed.grade,
        viewCode: parsed.viewCode,
        sortOrder: parsed.sortOrder,
      };
      const reject = (error: string, expected?: string): BulkFileResult => ({
        ...planned,
        ok: false,
        error,
        ...(expected === undefined ? {} : { expected }),
      });

      // The photographer dropped the wrong folder. This is the whole reason the
      // convention carries the model at all, and catching it here is the
      // difference between a rejected batch and a Latitude's scratches sitting
      // on a ThinkPad's product page.
      if (expectedModel !== null && parsed.modelToken !== expectedModel) {
        return reject(
          `"${file.filename}" names a different machine. These frames belong to ${modelName}.`,
          CONDITION_FILENAME_CONVENTION,
        );
      }

      const slot = `${parsed.grade}|${parsed.viewCode}|${parsed.sortOrder}`;
      if (taken.has(slot)) {
        return reject(
          `Grade ${parsed.grade} ${parsed.viewCode} frame ${parsed.sortOrder} is already filled. ` +
            'Number this one differently, or replace the frame that is there.',
        );
      }
      taken.add(slot);

      if (input.dryRun) return planned;

      if (!file.s3Key || missing.has(file.s3Key)) {
        // The row would point at nothing, and a broken frame on a product page
        // is exactly the placeholder the coverage gate exists to prevent.
        return reject(`"${file.filename}" never reached storage. Upload it again.`);
      }
      // The caption is neither decoration nor optional: it is what a screen
      // reader announces and what a search engine indexes, and the column's own
      // CHECK demands ten characters. Refused here rather than by the constraint
      // so the report can name the file.
      if ((file.altText ?? '').trim().length < 10) {
        return reject(
          `"${file.filename}" has no caption. Describe what the photograph shows, ` +
            `e.g. "Grade ${parsed.grade} lid with fine scratches near the hinge".`,
        );
      }
      return planned;
    });

    const rejected = files.filter((f) => !f.ok).length;
    if (input.dryRun) return { dryRun: true, attached: 0, rejected, files, modelName };

    await this.prisma.runInTransaction(async () => {
      for (const [i, result] of files.entries()) {
        if (!result.ok) continue;
        const file = input.files[i]!;
        const { id } = await this.upload({
          anchor: input.anchor,
          anchorId: input.anchorId,
          grade: result.grade!,
          viewCode: result.viewCode!,
          sortOrder: result.sortOrder,
          s3Key: file.s3Key!,
          altText: file.altText!,
          createdBy: input.actorId,
          // The filename is the trail's only link back to the shoot it came
          // from. Which file became which frame is unanswerable afterwards.
          reason: input.reason ?? `bulk upload of ${file.filename}`,
        });
        result.imageId = id;
      }
    });

    return { dryRun: false, attached: files.filter((f) => f.ok).length, rejected, files, modelName };
  }

  // -------------------------------------------------------------------------
  // Ordering the set a buyer sees
  // -------------------------------------------------------------------------

  /**
   * Choose the hero frame for one (anchor, grade).
   *
   * The old primary is cleared *before* the new one is set. Not a style
   * preference: `uq_condition_primary_*` permits exactly one live primary per
   * (anchor, grade), so setting first raises a unique violation and changes
   * nothing.
   */
  async setPrimary(
    imageId: string,
    actorId: string,
    reason?: string,
  ): Promise<{ changed: boolean }> {
    return this.prisma.runInTransaction(async () => {
      const [row] = await this.prisma.$queryRaw<RawImage[]>`
        SELECT id, sku_id, model_id, series_id, grade::text AS grade, view_code,
               s3_key, alt_text, is_primary, sort_order, blur_data_uri
          FROM catalog.condition_image
         WHERE id = ${imageId}::uuid AND retired_at IS NULL`;
      if (!row) throw new NotFoundError('condition image');
      // Already the hero. No write, and no change-log entry either — a trail
      // recording a change that did not happen is worse than a quiet no-op.
      if (row.is_primary) return { changed: false };

      const [previous] = await this.prisma.$queryRaw<Array<{ id: string; view_code: string }>>`
        SELECT id, view_code FROM catalog.condition_image
         WHERE is_primary AND retired_at IS NULL
           AND grade = ${row.grade}::grade_type
           AND sku_id    IS NOT DISTINCT FROM ${row.sku_id}::uuid
           AND model_id  IS NOT DISTINCT FROM ${row.model_id}::uuid
           AND series_id IS NOT DISTINCT FROM ${row.series_id}::uuid`;

      if (previous) {
        await this.prisma.$executeRaw`
          UPDATE catalog.condition_image SET is_primary = false WHERE id = ${previous.id}::uuid`;
      }
      await this.prisma.$executeRaw`
        UPDATE catalog.condition_image SET is_primary = true WHERE id = ${imageId}::uuid`;

      await this.changeLog.record({
        entityType: 'condition_image',
        entityId: imageId,
        action: 'UPDATE',
        field: `${row.grade}/primary`,
        oldValue: previous?.view_code ?? null,
        newValue: row.view_code,
        reason: reason ?? 'hero frame changed',
        actorId,
        skuId: row.sku_id,
      });
      return { changed: true };
    });
  }

  /**
   * Put one (anchor, grade)'s live frames into the order given.
   *
   * The whole set must be listed. A partial reorder leaves the frames that were
   * left out sitting on positions the listed ones are about to be given, and
   * that collision surfaces as a unique-index violation rather than as the
   * mistake it is — so it is refused with a sentence saying how many the grade
   * actually has.
   */
  async reorder(input: {
    imageIds: readonly string[];
    actorId: string;
    reason?: string;
  }): Promise<void> {
    const first = input.imageIds[0];
    if (!first) {
      throw new ValidationError('Nothing to reorder.', { imageIds: 'At least one image.' });
    }

    return this.prisma.runInTransaction(async () => {
      const [anchorRow] = await this.prisma.$queryRaw<RawImage[]>`
        SELECT id, sku_id, model_id, series_id, grade::text AS grade, view_code,
               s3_key, alt_text, is_primary, sort_order, blur_data_uri
          FROM catalog.condition_image
         WHERE id = ${first}::uuid AND retired_at IS NULL`;
      if (!anchorRow) throw new NotFoundError('condition image');

      const live = await this.prisma.$queryRaw<
        Array<{ id: string; view_code: string; sort_order: number }>
      >`
        SELECT id, view_code, sort_order FROM catalog.condition_image
         WHERE retired_at IS NULL
           AND grade = ${anchorRow.grade}::grade_type
           AND sku_id    IS NOT DISTINCT FROM ${anchorRow.sku_id}::uuid
           AND model_id  IS NOT DISTINCT FROM ${anchorRow.model_id}::uuid
           AND series_id IS NOT DISTINCT FROM ${anchorRow.series_id}::uuid`;

      const byId = new Map(live.map((r) => [r.id, r]));
      const distinct = new Set(input.imageIds);
      if (
        distinct.size !== input.imageIds.length ||
        distinct.size !== live.length ||
        input.imageIds.some((id) => !byId.has(id))
      ) {
        throw new ValidationError(
          'A reorder lists every live frame of one grade, exactly once. ' +
            `Grade ${anchorRow.grade} has ${live.length} at this level.`,
          { imageIds: `Expected ${live.length} distinct ids from this grade.` },
        );
      }

      // Park everything out of the way first. `uq_condition_slot_*` is a plain
      // unique index, enforced row by row rather than at statement end, so two
      // frames swapping places collide halfway through without this.
      //
      // ponytail: +1000 is safe because sort_order is bounded 0-99 by the DTO
      // that writes it. Raise this with that cap if it ever rises.
      await this.prisma.$executeRaw`
        UPDATE catalog.condition_image SET sort_order = sort_order + 1000
         WHERE retired_at IS NULL
           AND grade = ${anchorRow.grade}::grade_type
           AND sku_id    IS NOT DISTINCT FROM ${anchorRow.sku_id}::uuid
           AND model_id  IS NOT DISTINCT FROM ${anchorRow.model_id}::uuid
           AND series_id IS NOT DISTINCT FROM ${anchorRow.series_id}::uuid`;

      for (const [position, id] of input.imageIds.entries()) {
        await this.prisma.$executeRaw`
          UPDATE catalog.condition_image SET sort_order = ${position} WHERE id = ${id}::uuid`;

        // One entry per frame that actually moved. Logging the untouched ones
        // would bury the change in noise on a set of ten.
        const before = byId.get(id)!;
        if (before.sort_order === position) continue;
        await this.changeLog.record({
          entityType: 'condition_image',
          entityId: id,
          action: 'UPDATE',
          field: `${anchorRow.grade}/${before.view_code}/sort_order`,
          oldValue: String(before.sort_order),
          newValue: String(position),
          reason: input.reason ?? 'set reordered',
          actorId: input.actorId,
          skuId: anchorRow.sku_id,
        });
      }
    });
  }
}
