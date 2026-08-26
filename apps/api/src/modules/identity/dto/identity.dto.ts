import { z } from 'zod';
import { emailSchema, mobileSchema, otpCodeSchema } from '@trugrade/contracts';

/**
 * Request shapes for the auth surface.
 *
 * Two of these are deliberately *looser* than the shared primitive that looks
 * like it belongs, and both exceptions are about the same thing: a sign-in form
 * must not answer questions.
 */

/**
 * `email` is the console's field name; the server treats it as an identifier and
 * `IdentityService.loginWithPassword` normalises it as either an email or an
 * Indian mobile number. So `emailSchema` would be wrong twice over — it would
 * refuse the mobile sign-in the service already supports, and a 422 that says
 * "that is not an email" on a typo'd address is a slightly different answer from
 * the 401 a wrong address gets, which is the beginning of an enumeration oracle.
 *
 * `passwordSchema` is likewise not used here. It encodes the *composition* rule
 * for choosing a password, and applying it at sign-in would publish that rule to
 * anyone with a curl command and reject a correct legacy password with a
 * validation error instead of letting the hash comparison decide. The only
 * bounds that belong here are the ones that stop a megabyte of text reaching a
 * deliberately slow hash function.
 */
export const loginSchema = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(200),
});
export type LoginDto = z.infer<typeof loginSchema>;

/** The second factor. `otpCodeSchema` is the same constant the client renders against. */
export const mfaVerifySchema = z.object({ code: otpCodeSchema });
export type MfaVerifyDto = z.infer<typeof mfaVerifySchema>;

/**
 * Changing a login email or mobile.
 *
 * A discriminated union rather than one object with a loose `newValue`: the
 * shape of a valid new value depends entirely on which field is moving, and
 * validating an email against the mobile rule (or worse, against neither) is how
 * an unroutable address reaches the OTP sender and the request dies half open.
 * Both member schemas normalise on the way through, so what the service compares
 * against the stored column is already in the column's canonical form.
 */
export const contactChangeRequestSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('EMAIL'), newValue: emailSchema }),
  z.object({ field: z.literal('MOBILE'), newValue: mobileSchema }),
]);
export type ContactChangeRequestDto = z.infer<typeof contactChangeRequestSchema>;

/** `side` names which of the two proofs this code is. There is no default: a
 *  caller that does not say which address it is answering for is a caller that
 *  would happily replay the new-address code as the old-address one. */
export const contactChangeVerifySchema = z.object({
  side: z.enum(['OLD', 'NEW']),
  code: otpCodeSchema,
});
export type ContactChangeVerifyDto = z.infer<typeof contactChangeVerifySchema>;

export const contactChangeCancelSchema = z.object({
  reason: z.string().trim().min(1).max(200).default('Cancelled by the account holder.'),
});
export type ContactChangeCancelDto = z.infer<typeof contactChangeCancelSchema>;
