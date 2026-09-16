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
    /**
     * A saved view. Narrower than `status` and not a synonym for it: a view is
     * a question somebody asks ("what can I dispatch"), and one of them may
     * cover several statuses later without the URL changing meaning.
     */
    view: z.enum(['ready', 'partial', 'awaiting', 'dispatched', 'received', 'all']).optional(),
    sort: z.enum(['recent', 'oldest', 'value', 'value_asc']).default('recent'),
    // No ceiling: the service clamps to the last page that exists. A stale
    // bookmark naming page 9,999 is not a client error worth a 422 — every
    // other board in this console recovers from one, and this was the only
    // endpoint that refused instead.
    page: z.coerce.number().int().min(1).default(1),
    dir: z.enum(['asc', 'desc']).optional(),
    per: z.coerce.number().int().min(5).max(100).default(40),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'The end of the range is before its start. Swap the two dates.',
  });

export type OpsPurchaseOrderListQueryDto = z.infer<typeof opsPurchaseOrderListQuerySchema>;
