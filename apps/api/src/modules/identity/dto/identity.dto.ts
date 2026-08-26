import { z } from 'zod';
import {
  emailSchema,
  fullNameSchema,
  mobileSchema,
  otpCodeSchema,
  passwordSchema,
} from '@trugrade/contracts';

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
/**
 * Self-service registration.
 *
 * `passwordSchema` DOES apply here, unlike at sign-in: this is the moment the
 * composition rule is being chosen against, so enforcing it is the point rather
 * than a leak. The comment above explains why login deliberately does not.
 *
 * `orgType` is VENDOR or BUYER only. INTERNAL accounts are never self-served —
 * staff are created by an administrator, and letting the enum through would let
 * anyone mint themselves an internal org.
 */
export const registerSchema = z.object({
  orgType: z.enum(['VENDOR', 'BUYER']),
  companyName: z.string().trim().min(2).max(200),
  fullName: fullNameSchema,
  email: emailSchema,
  mobile: mobileSchema,
  password: passwordSchema,
});
export type RegisterDto = z.infer<typeof registerSchema>;

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

/**
 * Registration-time contact verification, before any account exists.
 *
 * A discriminated union for the same reason `contactChangeRequestSchema` is one:
 * the shape of a valid value depends entirely on which channel it is, and both
 * member schemas normalise on the way through — so the string the OTP is issued
 * against, the string `wasRecentlyVerified` is later asked about, and the string
 * `register` stores in `user_account` are the identical string. A mobile that is
 * verified as `9876543210` and registered as `+919876543210` is a verification
 * that silently proves nothing.
 */
export const registrationOtpSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('EMAIL'), value: emailSchema }),
  z.object({ channel: z.literal('MOBILE'), value: mobileSchema }),
]);
export type RegistrationOtpDto = z.infer<typeof registrationOtpSchema>;

export const registrationOtpVerifySchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('EMAIL'), value: emailSchema, code: otpCodeSchema }),
  z.object({ channel: z.literal('MOBILE'), value: mobileSchema, code: otpCodeSchema }),
]);
export type RegistrationOtpVerifyDto = z.infer<typeof registrationOtpVerifySchema>;
