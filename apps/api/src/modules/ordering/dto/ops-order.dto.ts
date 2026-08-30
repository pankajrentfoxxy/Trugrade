import { z } from 'zod';

/**
 * The ops order board's whole state, as it arrives from the URL — T39.
 *
 * Separate from `orderListQuerySchema` rather than an extension of it. That one
 * is a buyer's board and carries `site`, which is one of the buyer's own
 * delivery addresses; this one carries `payment` and `approval`, which a buyer
 * has no business filtering on. Two audiences, two shapes, and neither can grow
 * a field that only makes sense for the other.
 *
 * `status` and `payment` are loose patterns rather than restated enums for one
 * reason: `order_status` and `payment_status` are compared as **text** in the
 * service, so a value that is not a real status simply returns nothing, and a
 * regex that named the ten values would need editing every time the enum grew.
 * The pattern is what stands between the URL and Postgres; the comparison is
 * what makes an unknown value harmless.
 */
export const opsOrderListQuerySchema = z.object({
  /**
   * One box over seven identifiers — order number, the buyer's own PO
   * reference, a serial, a seal code, a legal or trade name, a GSTIN, a mobile.
   *
   * 60 characters because a GSTIN is 15 and a legal name is the long one.
   */
  q: z.string().trim().min(1).max(60).optional(),
  status: z
    .string()
    .trim()
    .regex(/^[A-Z_]{3,32}$/, 'A status is upper-case letters and underscores, like PAYMENT_PENDING.')
    .optional(),
  payment: z
    .string()
    .trim()
    .regex(/^[A-Z_]{3,32}$/, 'A payment status is upper-case letters and underscores, like PENDING.')
    .optional(),
  /**
   * Orders held for a buyer's approver.
   *
   * A filter and not a status: the fact is the `order_approval` row, and the
   * order's own status is a consequence of it. This is what the ops dashboard's
   * "Orders held for a buyer's approver" tile links to, so the number on that
   * tile and the count on this board are the same predicate.
   */
  approval: z.enum(['pending']).optional(),
  sort: z.enum(['recent', 'oldest', 'value', 'value_asc']).default('recent'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  /** Twenty-five rows at the console's 34px compact density is one screen. */
  per: z.coerce.number().int().min(5).max(100).default(25),
});

export type OpsOrderListQueryDto = z.infer<typeof opsOrderListQuerySchema>;
