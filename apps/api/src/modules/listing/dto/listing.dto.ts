import { z } from 'zod';
import {
  gradeSchema,
  paginationSchema,
  uuidSchema,
  vendorNetPayoutSchema,
} from '@trugrade/contracts';

/**
 * The vendor listing wizard's request shapes.
 *
 * Zod, per endpoint, applied with `ZodValidationPipe` — VR-META-01 requires the
 * client schema and the server validator to be the identical constant, and two
 * validation systems cannot satisfy that. The shared primitives come from
 * `@trugrade/contracts`; the enum mirrors below do not, yet. They exist here
 * rather than as free strings so a wrong value is a field-level 422 the vendor
 * can act on instead of a Postgres enum cast error they cannot.
 */

export const conditionTypeSchema = z.enum(['LIKE_NEW', 'UNBOXED', 'REFURBISHED', 'USED_TESTED']);

/**
 * NON_FUNCTIONAL is deliberately absent. `chk_sellable` refuses it at the
 * database, so accepting it here would turn a legible "we cannot list a machine
 * that does not work" into a 500 three layers down.
 */
export const functionalStatusSchema = z.enum(['FULLY_FUNCTIONAL', 'MINOR_ISSUE', 'LIMITED']);

export const batteryBandSchema = z.enum([
  'EXCELLENT_90_PLUS',
  'GOOD_80_89',
  'FAIR_70_79',
  'LOW_BELOW_70',
  'UNKNOWN',
]);
export const partsStatusSchema = z.enum([
  'ALL_ORIGINAL',
  'OEM_REPLACED',
  'COMPATIBLE_REPLACED',
  'MIXED',
]);
export const repairHistorySchema = z.enum(['NONE', 'MINOR', 'MAJOR']);
export const wipeStatusSchema = z.enum([
  'VERIFIED_WIPED',
  'CERTIFICATE_AVAILABLE',
  'NOT_APPLICABLE',
]);
export const warrantyDurationSchema = z.enum(['NONE', 'D7', 'D30', 'M3', 'M6', 'M12']);
export const oemWarrantyBandSchema = z.enum(['NONE', 'LT_3M', 'M3_6', 'M6_12', 'M12_PLUS']);
export const listingStatusSchema = z.enum([
  'DRAFT',
  'AWAITING_QC',
  'QC_IN_PROGRESS',
  'PENDING_APPROVAL',
  'ACTIVE',
  'PARTIALLY_ACTIVE',
  'PAUSED',
  'OUT_OF_STOCK',
  'REJECTED',
  'SUSPENDED',
  'EXPIRED',
  'DELISTED',
]);

/**
 * A serial as typed, pasted or scanned — NOT `serialNumberSchema`.
 *
 * The wizard's whole promise is a per-serial verdict: line 34 is a duplicate,
 * line 51 is already live, line 88 does not look like a Dell tag but is
 * probably a worn label. Validating the array element-wise here would collapse
 * all of that into one 422 for the whole request, and the vendor would be told
 * to fix a batch of fifty with no idea which one is wrong. So the transport
 * only bounds the size, and `SerialService` produces the verdicts.
 */
const rawSerialSchema = z.string().min(1).max(64);

/** VR-080 caps a listing at 5,000 units; the paste box is bounded to match. */
const serialArraySchema = z.array(rawSerialSchema).min(1).max(5000);

export const createListingDraftSchema = z.object({
  skuId: uuidSchema,
  pickupLocationId: uuidSchema,
  grade: gradeSchema,
  conditionType: conditionTypeSchema,
  functionalStatus: functionalStatusSchema.default('FULLY_FUNCTIONAL'),
  batteryHealthBand: batteryBandSchema,
  partsStatus: partsStatusSchema,
  partsReplaced: z.array(z.string().min(1).max(60)).max(20).default([]),
  repairHistory: repairHistorySchema.default('NONE'),
  dataWipeStatus: wipeStatusSchema.default('VERIFIED_WIPED'),
  sellerWarranty: warrantyDurationSchema.default('NONE'),
  oemWarrantyRemaining: oemWarrantyBandSchema.default('NONE'),
  /**
   * Task 3 step 2: a commercial commitment, not a note. Priced in Task 5 and
   * recoverable in Phase 9, which is why it is bounded rather than free text.
   */
  vendorWarrantyMonths: z.number().int().min(0).max(24).default(0),
  vendorWarrantyScope: z.record(z.unknown()).nullish(),
  /**
   * The net payout the vendor wants per unit (model A). Required at draft
   * creation because `listing.unit_price` is NOT NULL with CHECK (> 0) — see
   * the repository for why the vendor's own number is the only honest thing to
   * put there before the pricing engine has run.
   */
  vendorAskPrice: vendorNetPayoutSchema,
  moq: z.number().int().min(1).max(5000).default(1),
  dispatchSlaHours: z.number().int().min(1).max(720).default(48),
});

/**
 * Every field optional. `undefined` means "leave it alone" all the way down to
 * the COALESCE in the UPDATE, so a wizard step can PATCH the two fields it owns
 * without echoing back the other twenty and racing another tab.
 */
export const updateListingDraftSchema = createListingDraftSchema.partial();

export const listListingsQuerySchema = paginationSchema.extend({
  status: listingStatusSchema.optional(),
  skuId: uuidSchema.optional(),
  grade: gradeSchema.optional(),
});

/** Paste a block, or send an array. Both reach the same validator. */
export const validateSerialsSchema = z
  .object({
    serials: serialArraySchema.optional(),
    text: z.string().max(400_000).optional(),
    /** From `catalog.brand.name`. Drives the warn-only shape check. */
    brandName: z.string().max(60).optional(),
  })
  .refine((v) => Boolean(v.serials?.length) || Boolean(v.text?.trim()), {
    message: 'Paste some serial numbers or upload a file.',
    path: ['serials'],
  });

export const validateSerialsCsvSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  brandName: z.string().max(60).optional(),
});

export const addUnitsSchema = z.object({ serials: serialArraySchema });

export const addListingImageSchema = z.object({
  /** The object-store key a completed upload returned. */
  fileKey: z.string().min(1).max(512),
  imageType: z.enum(['ACTUAL_UNIT', 'DEFECT']).default('ACTUAL_UNIT'),
  /** SHA-256 of the file, so the same photograph on two listings is detectable. */
  hash: z.string().regex(/^[a-f0-9]{64}$/, 'Expected a SHA-256 hex digest.'),
});

export type CreateListingDraftDto = z.infer<typeof createListingDraftSchema>;
export type UpdateListingDraftDto = z.infer<typeof updateListingDraftSchema>;
export type ListListingsQueryDto = z.infer<typeof listListingsQuerySchema>;
export type ValidateSerialsDto = z.infer<typeof validateSerialsSchema>;
export type ValidateSerialsCsvDto = z.infer<typeof validateSerialsCsvSchema>;
export type AddUnitsDto = z.infer<typeof addUnitsSchema>;
export type AddListingImageDto = z.infer<typeof addListingImageSchema>;
