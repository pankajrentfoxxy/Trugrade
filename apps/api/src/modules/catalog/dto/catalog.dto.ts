import { z } from 'zod';
import {
  CONDITION_VIEW_CODES,
  SKU_IMPORT_COLUMNS,
  UPLOAD_ALLOWED_MIME,
  gradeSchema,
  paginationSchema,
  uuidSchema,
  type SkuImportColumn,
} from '@trugrade/contracts';

/**
 * The catalog module's request shapes.
 *
 * Zod per endpoint through `ZodValidationPipe`, never a global pipe: VR-META-01
 * requires the client schema and the server validator to resolve to the
 * identical constant, and two validation systems cannot satisfy that.
 *
 * Two rules this file follows that are worth stating, because breaking either
 * one is invisible until production:
 *
 *   1. **The enums are the database's, read off the live CHECK.** `severity`
 *      below is `catalog.condition_image`'s CHECK, not a phase document's list.
 *      A value that exists only in prose reaches Postgres as a constraint
 *      violation and a 500 on the first row anybody inserts.
 *   2. **The SKU specification is not restated here.** `SKU_IMPORT_COLUMNS` and
 *      `validateRow` already define what a valid machine is, and the SKU request
 *      approval path runs both. A second definition of "a valid SKU" that agrees
 *      today is a second definition that drifts, and the thing it drifts on is
 *      the normalised key — the one field whose whole job is to be computed
 *      identically everywhere.
 */

// ---------------------------------------------------------------------------
// Query-string helpers
// ---------------------------------------------------------------------------

/**
 * A repeatable filter parameter.
 *
 * Express hands back a string for `?brandId=a` and an array for
 * `?brandId=a&brandId=b`, and a client may reasonably send one comma-separated
 * value instead. All three mean the same filter, so all three are normalised to
 * one array — the alternative is a rail that silently drops the second
 * selection and a buyer who thinks they filtered when they did not.
 */
const multi = <T extends z.ZodTypeAny>(item: T): z.ZodType<z.infer<T>[] | undefined> =>
  z.preprocess(
    (v) =>
      v === undefined || v === ''
        ? undefined
        : (Array.isArray(v) ? v.map(String) : String(v).split(','))
            .map((s) => s.trim())
            .filter((s) => s !== ''),
    z.array(item).min(1).optional(),
  ) as z.ZodType<z.infer<T>[] | undefined>;

const positiveInt = z.coerce.number().int().positive();

// ---------------------------------------------------------------------------
// Search and read
// ---------------------------------------------------------------------------

/**
 * `limit` is bounded here as well as in `CatalogSearchService`, which clamps to
 * 100 of its own accord. Not redundant: the clamp silently gives a caller less
 * than they asked for, and a 422 saying so is the better answer to a client that
 * believes it is paging by 500. The clamp stays as the backstop for callers that
 * are not this controller.
 */
export const catalogSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  brandId: multi(uuidSchema),
  seriesId: multi(uuidSchema),
  cpuFamily: multi(z.string().min(1).max(60)),
  ramGb: multi(positiveInt),
  storageGb: multi(positiveInt),
  screenSizeIn: multi(z.coerce.number().positive().max(30)),
  /** CAT-010 asks for "RAM at least 16", which a list of exact values cannot say. */
  ramGbMin: positiveInt.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type CatalogSearchQueryDto = z.infer<typeof catalogSearchQuerySchema>;

/**
 * The grade is optional because two callers want different things from one SKU:
 * the vendor wizard needs the declared specification, to show what it is about
 * to list against, and a product page needs the photographs for the single grade
 * it is displaying. Resolving images for a grade nobody asked about would be
 * three extra fallback queries per keystroke in the wizard's picker.
 */
export const skuDetailQuerySchema = z.object({ grade: gradeSchema.optional() });
export type SkuDetailQueryDto = z.infer<typeof skuDetailQuerySchema>;

/** Console catalog board — flat SKU list with search and brand filter. */
export const catalogBoardQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  brandId: uuidSchema.optional(),
});
export type CatalogBoardQueryDto = z.infer<typeof catalogBoardQuerySchema>;

// ---------------------------------------------------------------------------
// Condition images
// ---------------------------------------------------------------------------

/** `catalog.condition_image.severity`, exactly as its CHECK allows it. */
export const conditionSeveritySchema = z.enum([
  'NONE',
  'FAINT',
  'MINOR',
  'MODERATE',
  'WORST_ALLOWED',
]);

/**
 * Photographs go to object storage directly, not through this API.
 *
 * A 4 MB JPEG base64'd into a JSON body is 5.3 MB against Express's 100 KB
 * default limit, so the attach route below takes a key and the bytes take the
 * presigned URL this one hands out. The MIME list is the shared upload
 * allow-list minus PDF — a PDF is a legitimate KYC document and is not a
 * photograph of a lid.
 */
const PHOTO_MIME = UPLOAD_ALLOWED_MIME.filter((m) => m !== 'application/pdf');

export const conditionImageUploadUrlSchema = z.object({
  contentType: z.enum(PHOTO_MIME as unknown as [string, ...string[]]),
});
export type ConditionImageUploadUrlDto = z.infer<typeof conditionImageUploadUrlSchema>;

export const attachConditionImageSchema = z.object({
  anchor: z.enum(['SKU', 'MODEL', 'SERIES']),
  anchorId: uuidSchema,
  grade: gradeSchema,
  viewCode: z.enum(CONDITION_VIEW_CODES),
  /** A key this API issued through the presign route, and nothing else. */
  s3Key: z.string().min(1).max(512),
  /**
   * Ten characters is the column's own CHECK, restated as a field error the
   * person uploading can act on rather than a constraint violation they cannot.
   * It is what a screen reader announces and what a search engine indexes, so
   * "lid" satisfying NOT NULL is not the bar.
   */
  altText: z.string().trim().min(10).max(500),
  isPrimary: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(99).optional(),
  defectType: z.string().trim().max(60).nullish(),
  severity: conditionSeveritySchema.nullish(),
  blurDataUri: z.string().max(4096).nullish(),
  reason: z.string().trim().min(3).max(200).optional(),
});
export type AttachConditionImageDto = z.infer<typeof attachConditionImageSchema>;

/**
 * Retiring a frame needs a reason for the same reason rejecting a SKU request
 * does: the row survives, and "retired" on its own tells the next person nothing
 * about whether the photograph was wrong or the machine was simply re-shot.
 */
export const retireConditionImageSchema = z.object({
  reason: z.string().trim().min(3).max(200),
});

/**
 * A dropped folder, planned or committed.
 *
 * `dryRun` defaults to **true**, for the CSV importer's reason: a bulk write
 * must never happen because a flag was forgotten. The dry run is also how the
 * console learns what each filename means — the parser runs here and nowhere
 * else, so the preview the operator approves is produced by the code that will
 * do the writing.
 *
 * Sixty files per request. A shoot is one model in three grades across six
 * required views, which is eighteen frames before alternates; sixty leaves room
 * for a generous shoot and still bounds the transaction.
 */
export const bulkConditionImageSchema = z.object({
  anchor: z.enum(['SKU', 'MODEL', 'SERIES']),
  anchorId: uuidSchema,
  dryRun: z.boolean().default(true),
  reason: z.string().trim().min(3).max(200).optional(),
  files: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(255),
        contentType: z.enum(PHOTO_MIME as unknown as [string, ...string[]]).optional(),
        s3Key: z.string().min(1).max(512).optional(),
        /**
         * Deliberately *not* `.min(10)` here, unlike the single-frame attach
         * above. A field error on `files[37].altText` refuses the whole batch
         * and names an index; the service refuses the one file and names it, so
         * the operator can see which photograph still needs describing. The
         * requirement is identical — ten characters, enforced by the column's
         * own CHECK — only the reporting differs.
         */
        altText: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(60),
});
export type BulkConditionImageDto = z.infer<typeof bulkConditionImageSchema>;

/**
 * Reordering names every live frame of one grade, in the order wanted.
 *
 * The complete set, not a delta: the frames left out of a partial list keep
 * positions the listed ones are about to be given, and the collision reads as a
 * database error rather than as the mistake it is.
 */
export const reorderConditionImagesSchema = z.object({
  imageIds: z.array(uuidSchema).min(1).max(60),
  reason: z.string().trim().min(3).max(200).optional(),
});
export type ReorderConditionImagesDto = z.infer<typeof reorderConditionImagesSchema>;

/** Naming the hero frame. The reason is optional — the act says what it is. */
export const setPrimaryConditionImageSchema = z.object({
  reason: z.string().trim().min(3).max(200).optional(),
});
export type SetPrimaryConditionImageDto = z.infer<typeof setPrimaryConditionImageSchema>;
export type RetireConditionImageDto = z.infer<typeof retireConditionImageSchema>;

// ---------------------------------------------------------------------------
// SKU requests
// ---------------------------------------------------------------------------

/**
 * What the vendor typed, kept as they typed it.
 *
 * Deliberately loose. The vendor is here precisely because the catalog does not
 * have their machine, so demanding a well-formed specification demands the thing
 * they already could not produce — and the near-match engine works off the raw
 * brand and model strings anyway. `vendorOrgId` is absent on purpose: it comes
 * from the session, never from the body.
 */
export const submitSkuRequestSchema = z.object({
  rawBrand: z.string().trim().min(1).max(120),
  rawModel: z.string().trim().min(1).max(160),
  rawConfig: z.string().trim().min(1).max(2000),
  specUrl: z.string().url().max(2048).nullish(),
  photoKey: z.string().max(512).nullish(),
  /** Present when the wizard managed to capture the configuration in fields. */
  spec: z
    .object({
      cpuFamily: z.string().trim().max(60).optional(),
      cpuModel: z.string().trim().max(60).optional(),
      ramGb: positiveInt,
      storageGb: positiveInt,
      storageType: z.string().trim().min(1).max(20),
      screenSizeIn: z.coerce.number().positive().max(30).optional(),
      resolution: z.string().trim().max(20).optional(),
      gpuType: z.string().trim().max(20).optional(),
      osSupported: z.string().trim().max(60).optional(),
      isTouch: z.boolean().optional(),
    })
    .optional(),
});
export type SubmitSkuRequestDto = z.infer<typeof submitSkuRequestSchema>;

/**
 * The specification a reviewer types when approving, keyed by the CSV importer's
 * own column names.
 *
 * Built from `SKU_IMPORT_COLUMNS` rather than listing the fields again, so it
 * cannot fall out of step with the template ops downloads or with `validateRow`,
 * which is what actually decides whether the row describes a machine. This layer
 * only bounds the transport: eighteen strings, each short enough that a request
 * body cannot be used as a buffer.
 */
export const skuSpecSchema = z.object(
  Object.fromEntries(
    SKU_IMPORT_COLUMNS.map((c) => [c, z.string().trim().max(200).optional()]),
  ) as Record<SkuImportColumn, z.ZodOptional<z.ZodString>>,
);
export type SkuSpecDto = z.infer<typeof skuSpecSchema>;

/**
 * One decision, three shapes.
 *
 * A discriminated union rather than one object with three optional halves: an
 * approval that silently became a rejection because `decision` was misspelt is
 * the kind of bug that surfaces in a vendor's inbox.
 */
export const skuRequestDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE'), spec: skuSpecSchema }),
  z.object({ decision: z.literal('MAP'), skuId: uuidSchema }),
  z.object({
    decision: z.literal('REJECT'),
    /**
     * Ten characters, not one. The vendor reads this, and "no" is not a reason
     * anybody can act on — which is the failure this queue exists to replace.
     */
    reason: z.string().trim().min(10).max(500),
  }),
]);
export type SkuRequestDecisionDto = z.infer<typeof skuRequestDecisionSchema>;

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

/**
 * `dryRun` defaults to **true**.
 *
 * A missing flag on a bulk write must not commit. The importer's whole contract
 * is that ops sees every row's outcome before anything is written, and a default
 * of false would make a forgotten field the difference between a report and an
 * import.
 */
export const importSkusSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  dryRun: z.boolean().default(true),
});
export type ImportSkusDto = z.infer<typeof importSkusSchema>;
