import { z } from 'zod';
import { FAULT_AREAS } from '../internal/warranty.service';

/**
 * The platform module's buyer-facing request shapes.
 *
 * Zod per endpoint through `ZodValidationPipe`, never a global pipe
 * (VR-META-01): the client and the server have to resolve to the identical
 * constant, and two validation systems cannot satisfy that.
 */

/**
 * `TT-CLM-2608-4F2A91C3`.
 *
 * Validated as a pattern rather than accepted as free text, because it goes
 * into a WHERE clause that decides whether somebody sees a claim. A shape check
 * here means the org-scoped lookup is the only thing left to get right.
 */
export const claimNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^TT-CLM-\d{4}-[0-9A-F]{8}$/, 'A claim number looks like TT-CLM-2608-4F2A91C3.');

/**
 * A serial as it is printed on the machine.
 *
 * Upper-cased on the way in: a buyer reading a case label types what they see,
 * and a lookup that failed on lower case would tell them the serial is not
 * theirs — the single most alarming thing this screen can say wrongly.
 */
export const serialSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(64)
  .regex(/^[A-Z0-9-]+$/, 'A serial number is letters, digits and hyphens.');

export const raiseClaimSchema = z.object({
  serialNumber: serialSchema,
  /**
   * One of the twelve QC areas. The same vocabulary as the inspection, so
   * triage can put the claim beside the original report's result for that exact
   * area (§4.6 step 3) instead of guessing at a mapping.
   */
  faultArea: z.enum(FAULT_AREAS),
  /**
   * Long enough to send an engineer with the right part. The service enforces
   * this too and says why in a sentence; the schema is the cheap first pass.
   */
  description: z.string().trim().min(20).max(4000),
  /**
   * Object-store keys for photographs and recordings already uploaded.
   *
   * Optional, because a keyboard that types the wrong character has no useful
   * photograph and refusing the claim for want of one would be theatre. The
   * triage screen asks for evidence when the fault category needs it.
   */
  evidenceKeys: z.array(z.string().trim().min(1).max(512)).max(12).default([]),
});

export type RaiseClaimDto = z.infer<typeof raiseClaimSchema>;
