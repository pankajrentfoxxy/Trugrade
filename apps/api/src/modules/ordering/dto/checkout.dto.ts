import { z } from 'zod';
import { uuidSchema } from '@trugrade/contracts';

/**
 * Checkout's request shapes.
 *
 * Zod per endpoint through `ZodValidationPipe`, never a global pipe
 * (VR-META-01) — the client and the server must resolve to the identical
 * constant, and two validation systems cannot satisfy that.
 *
 * Note what is NOT here: there is no `acceptTerms` boolean defaulting to true,
 * and no field on this flow arrives pre-agreed. A pre-ticked consent is a named
 * dark pattern, and the place it would be introduced is a schema default.
 */

export const startCheckoutSchema = z.object({ cartId: uuidSchema });

/**
 * The selection so far. Every field optional, because the buyer walks six steps
 * and re-quotes after each: the split cannot be resolved until a delivery site
 * exists, and the screen must be able to ask before it does.
 */
export const checkoutQuerySchema = z.object({
  gstProfileId: uuidSchema.optional(),
  billingAddressId: uuidSchema.optional(),
  deliveryAddressId: uuidSchema.optional(),
  paymentMode: z.enum(['PREPAID', 'PARTIAL_ADVANCE', 'CREDIT']).optional(),
});

/**
 * `buyerPoNumber` is optional HERE and mandatory in the service when
 * `org_preference.po_required` is set.
 *
 * Deliberately: whether it is required is a property of the buyer's
 * organisation, not of the request shape, and a schema that hard-required it
 * would refuse every buyer who does not use PO references. The service refuses
 * with a message naming the setting and what to type.
 */
export const confirmCheckoutSchema = z.object({
  gstProfileId: uuidSchema,
  billingAddressId: uuidSchema,
  deliveryAddressId: uuidSchema,
  paymentMode: z.enum(['PREPAID', 'PARTIAL_ADVANCE', 'CREDIT']),
  /** Prints on our invoice. `chk_buyer_po_number` bounds it at 40 in the database. */
  buyerPoNumber: z.string().trim().min(1).max(40).optional(),
  costCentre: z.string().trim().min(1).max(60).optional(),
});

export type StartCheckoutDto = z.infer<typeof startCheckoutSchema>;
export type CheckoutQueryDto = z.infer<typeof checkoutQuerySchema>;
export type ConfirmCheckoutDto = z.infer<typeof confirmCheckoutSchema>;
