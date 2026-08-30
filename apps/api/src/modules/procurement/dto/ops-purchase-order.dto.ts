import { z } from 'zod';

/**
 * The ops purchase-order board's state.
 *
 * `vendor` is a uuid because the filter is populated from the board's own facet,
 * which carries the id beside the legal name. A vendor typed by name is what the
 * search box is for.
 */
export const opsPurchaseOrderListQuerySchema = z
  .object({
    /** PO number, our order number, or a serial on one of its lines. */
    q: z.string().trim().min(1).max(60).optional(),
    status: z
      .string()
      .trim()
      .regex(/^[A-Z_]{3,32}$/, 'A status is upper-case letters and underscores, like RAISED.')
      .optional(),
    vendor: z.string().uuid().optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD, for example 2026-08-30.')
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD, for example 2026-08-30.')
      .optional(),
    sort: z.enum(['recent', 'oldest', 'value', 'value_asc']).default('recent'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    per: z.coerce.number().int().min(5).max(100).default(25),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'The end of the range is before its start. Swap the two dates.',
  });

export type OpsPurchaseOrderListQueryDto = z.infer<typeof opsPurchaseOrderListQuerySchema>;
