import { z } from 'zod';
import { paginationSchema } from '@trugrade/contracts';

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
