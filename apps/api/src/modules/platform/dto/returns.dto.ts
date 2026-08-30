import { z } from 'zod';
import { serialSchema } from './warranty.dto';
import { RETURN_REASONS } from '../internal/returns.service';

/**
 * The return flow's request shapes — T24.
 *
 * Zod per endpoint through `ZodValidationPipe`, never a global pipe
 * (VR-META-01): the client and the server have to resolve to the identical
 * constant, and two validation systems cannot satisfy that.
 *
 * `serialSchema` is imported from the warranty DTO rather than restated, for the
 * reason it was written: a buyer reading a case label types what they see, and a
 * lookup that failed on lower case would tell them the serial is not theirs —
 * which is the single most alarming thing either of these screens can say
 * wrongly. Two copies of that rule is one copy that drifts.
 */

/**
 * `TT-26-00004`.
 *
 * Restated rather than imported from `ordering`'s DTO: `dto/` is private to its
 * module and `no-cross-module-import` makes reaching into another one an error,
 * not a style note. The pattern is the order *number format*, which is a fact
 * about the platform rather than about ordering's internals — the two copies
 * cannot drift without every order number in the product changing shape.
 */
const orderNumberSchema = z
  .string()
  .trim()
  .regex(/^TT-\d{2}-\d{5}$/, 'An order number looks like TT-26-00004.');

/** `TT-RET-2608-4F2A91C3`. Shape-checked because it decides who sees a return. */
export const returnNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^TT-RET-\d{4}-[0-9A-F]{8}$/, 'A return number looks like TT-RET-2608-4F2A91C3.');

/** `?order=TT-26-00004`, optional: without it the whole account is listed. */
export const returnEligibilityQuerySchema = z.object({
  order: orderNumberSchema.optional(),
});

export type ReturnEligibilityQueryDto = z.infer<typeof returnEligibilityQuerySchema>;

export const raiseReturnSchema = z.object({
  orderNumber: orderNumberSchema,
  /**
   * One return row per machine. Capped at 50 because that is more machines than
   * any order on the platform carries, and an unbounded array here is an
   * unbounded number of INSERTs from one request.
   */
  serialNumbers: z.array(serialSchema).min(1).max(50),
  reasonCode: z.enum(RETURN_REASONS),
  /**
   * The service enforces this too and says why in a sentence; the schema is the
   * cheap first pass.
   */
  description: z.string().trim().min(20).max(4000),
  /**
   * Object-store keys for photographs already uploaded. The service decides how
   * many are needed for the reason given — two for physical damage, one of the
   * seal for a broken-seal claim — because that rule belongs beside the reason
   * codes, not in a schema that cannot explain itself.
   */
  evidenceKeys: z.array(z.string().trim().min(1).max(512)).max(12).default([]),
});

export type RaiseReturnDto = z.infer<typeof raiseReturnSchema>;
