import { z } from 'zod';
import {
  LISTING_QTY,
  gradeSchema,
  moneySchema,
  pincodeSchema,
  uuidSchema,
} from '@trugrade/contracts';

/**
 * The ordering module's buyer-facing request shapes.
 *
 * Zod per endpoint through `ZodValidationPipe`, never a global pipe (VR-META-01):
 * the client and the server have to resolve to the identical constant, and two
 * validation systems cannot satisfy that.
 *
 * One rule governs this file and it is the reason the requirement schema below
 * is shared rather than duplicated: **a CSV row and a form row are the same
 * requirement**. A procurement head who uploads a spreadsheet and one who types
 * into the form must get the same acceptances and the same refusals, or the two
 * paths drift and the refusal a person sees depends on which door they came
 * through.
 */

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

/**
 * `ordering.cart.name` has `CHECK (length(btrim(name)) > 0)` behind it and
 * `uq_cart_active_name` indexes `lower(btrim(name))`, so the trim happens here
 * too — otherwise "  Finance  " and "Finance" look distinct to the client and
 * identical to the index, and the buyer gets a conflict they cannot see.
 */
export const cartNameSchema = z.string().trim().min(1).max(60);

export const createCartSchema = z.object({
  /** A procurement head sourcing for three departments needs three names. */
  name: cartNameSchema.default('Cart'),
});

/**
 * `qty` is what the buyer wants, not what is available — the cart deliberately
 * accepts a quantity larger than current stock and reports the shortfall on
 * view, because stock is not reserved here and any number checked at add time is
 * stale by the time they look at it again.
 */
export const addCartItemSchema = z.object({
  listingId: uuidSchema,
  qty: z.number().int().min(1).max(LISTING_QTY.max!),
});

export type CreateCartDto = z.infer<typeof createCartSchema>;
export type AddCartItemDto = z.infer<typeof addCartItemSchema>;

// ---------------------------------------------------------------------------
// Bulk requirement (RFQ intake)
// ---------------------------------------------------------------------------

/** An empty CSV cell means "not supplied", which is not the same as a bad value. */
const blankToUndefined = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), inner.optional());

/** The header names the uploaded file must use, in the order the template lists them. */
export const REQUIREMENT_COLUMNS = Object.freeze([
  'model',
  'quantity',
  'grade',
  'target_price',
  'delivery_pincode',
  'needed_by',
] as const);

export type RequirementColumn = (typeof REQUIREMENT_COLUMNS)[number];

/**
 * One line of a requirement list.
 *
 * `quantity` is coerced because the same schema validates a JSON body (a real
 * number) and a parsed CSV cell (always a string). `grade` is upper-cased for
 * the same reason: a spreadsheet says "a plus" as often as it says "A_PLUS", and
 * refusing the row over the case of a letter is not a validation, it is an
 * obstacle.
 */
export const requirementRowSchema = z.object({
  /** Free text: a model name, or a specification a human wrote. Matched, not parsed. */
  model: z.string().trim().min(2).max(160),
  quantity: z.coerce.number().int().min(1).max(10_000),
  grade: blankToUndefined(
    z.preprocess(
      (v) =>
        typeof v === 'string'
          ? v
              .trim()
              .toUpperCase()
              // "A+" before whitespace, because "+" is how the grade is PRINTED
              // on every screen in this product — the offer board, the passport,
              // the certificate. A buyer copying what we show them into their own
              // spreadsheet had the whole row rejected, which is us refusing our
              // own notation.
              .replace(/\+/g, '_PLUS')
              .replace(/[\s-]+/g, '_')
          : v,
      gradeSchema,
    ),
  ),
  /** The buyer's number. Ours is never compared against it in this response. */
  targetPrice: blankToUndefined(moneySchema),
  deliveryPincode: pincodeSchema,
  /** A plain day. `ordering.rfq.needed_by` is a DATE, so no time zone is implied. */
  neededBy: blankToUndefined(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the needed-by date as YYYY-MM-DD.'),
  ),
});

export type RequirementRowDto = z.infer<typeof requirementRowSchema>;

/**
 * Either a filled form or an uploaded file, on one endpoint.
 *
 * A union rather than two routes because the two arms are the same intake with
 * the same outcome, and a client that has to pick a URL by input type ends up
 * with two code paths for one screen.
 *
 * The CSV cap is a size the parser can hold in memory comfortably; 500 form rows
 * is one procurement cycle's worth. Neither is a business rule, both are a
 * refusal to accept an unbounded body on an authenticated endpoint.
 */
export const requirementIntakeSchema = z.union([
  z.object({ rows: z.array(requirementRowSchema).min(1).max(500) }),
  z.object({ csv: z.string().min(1).max(2_000_000) }),
]);

export type RequirementIntakeDto = z.infer<typeof requirementIntakeSchema>;

/**
 * A human order number — `TT-26-00004`. Two-digit year, five-digit sequence,
 * exactly as `order_transaction.service.ts` mints them.
 *
 * Validated as a shape rather than passed through as free text because it
 * addresses a resource: a uuid schema would reject it and no schema at all
 * would send arbitrary strings to the database on every mistyped URL.
 */
export const orderNumberSchema = z
  .string()
  .trim()
  .regex(/^TT-\d{2}-\d{5}$/, 'An order number looks like TT-26-00004.');
