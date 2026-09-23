import { z } from 'zod';
import { gradeSchema, paginationSchema, uuidSchema } from '@trugrade/contracts';

/**
 * The ten values of `public.po_status`, restated as a Zod enum.
 *
 * Restated rather than derived: this is a filter on a query string, and a
 * malformed value has to come back as "that is not a status" rather than reach
 * Postgres as a cast that fails with a 500. The repository compares it as text,
 * so this list is the only thing standing between the URL and the query.
 */
export const poStatusSchema = z.enum([
  'RAISED',
  'ACKNOWLEDGED',
  'PARTIAL',
  'REJECTED',
  'DISPATCH_READY',
  'DISPATCHED',
  'RECEIVED',
  'INVOICED',
  'MATCHED',
  'PAYABLE',
  'PAID',
  'CANCELLED',
  'DISPUTED',
]);

export const poLineRejectionReasonSchema = z.enum([
  'OUT_OF_STOCK',
  'GRADE_MISMATCH',
  'PRICE_DISPUTED',
  'DISPATCH_DATE',
  'OTHER',
]);

export const respondPoLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: uuidSchema,
        accept: z.boolean(),
        reason: poLineRejectionReasonSchema.optional(),
      }),
    )
    .min(1),
});

export type RespondPoLinesDto = z.infer<typeof respondPoLinesSchema>;

/**
 * "This is how many of each I can supply."
 *
 * Per SKU + grade rather than per PO line, because that is the unit the vendor
 * thinks in: a PO line is one machine, and a vendor with five of a model does
 * not want to click five times. The service turns the count back into per-line
 * accept/reject so every downstream consequence — the buyer's order, the
 * payable, the released stock — stays on the one path that already handles it.
 */
export const confirmPoAvailabilitySchema = z.object({
  lines: z
    .array(
      z.object({
        skuId: uuidSchema,
        grade: gradeSchema,
        qtyAvailable: z
          .number({ invalid_type_error: 'Enter a whole number of machines.' })
          .int('Enter a whole number of machines.')
          .min(0, 'A quantity cannot be negative.'),
      }),
    )
    .min(1, 'Enter the quantity available for at least one line.'),
});

export type ConfirmPoAvailabilityDto = z.infer<typeof confirmPoAvailabilitySchema>;

export const dispatchPoSchema = z.object({
  carrier: z.string().trim().min(1, 'Enter the courier name.'),
  awb: z.string().trim().min(1, 'Enter the AWB or tracking number.'),
  dispatchedAt: z.string().datetime().optional(),
});

export type DispatchPoDto = z.infer<typeof dispatchPoSchema>;

/** `YYYY-MM-DD`, the form a native `<input type="date">` produces. */
const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD, for example 2026-08-30.');

export const listPurchaseOrdersQuerySchema = paginationSchema
  .extend({
    status: poStatusSchema.optional(),
    from: isoDaySchema.optional(),
    to: isoDaySchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'The end of the range is before its start. Swap the two dates.',
  });

export type ListPurchaseOrdersQueryDto = z.infer<typeof listPurchaseOrdersQuerySchema>;

export const attachableUnitsQuerySchema = z.object({
  skuId: uuidSchema,
  grade: gradeSchema,
});
export type AttachableUnitsQueryDto = z.infer<typeof attachableUnitsQuerySchema>;

export const attachPoUnitSchema = z.object({
  skuId: uuidSchema,
  grade: gradeSchema,
  unitId: uuidSchema,
});
export type AttachPoUnitDto = z.infer<typeof attachPoUnitSchema>;
