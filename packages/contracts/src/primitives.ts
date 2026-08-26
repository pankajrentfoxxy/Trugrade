/**
 * Zod primitives, every one built from a `Rule` in `rules.ts` **by reference**.
 *
 * `zodFromRule` stores the originating rule on the schema (`_trugradeRule`), which is
 * what lets VR-META-01 assert that the client schema and the DTO validator resolve
 * to the identical constant instead of two regexes that merely look alike today.
 */

import { z } from 'zod';
import {
  ACCOUNT_HOLDER_NAME,
  ADDRESS_LINE1,
  ADDRESS_LINE2,
  AADHAAR_LAST4,
  BANK_ACCOUNT_NUMBER,
  CIN,
  EMAIL,
  FULL_NAME,
  GRADES,
  GSTIN,
  HSN_CODE,
  IFSC,
  INVOICE_NUMBER,
  LISTING_QTY,
  LLPIN,
  MOBILE_E164,
  OTP_CODE,
  PAN,
  PASSWORD_COMPOSITION,
  PINCODE,
  QC_AREAS,
  QC_AREA_OUTCOMES,
  QC_VERDICTS,
  RETAIL_PRICE,
  SEAL_CODE,
  SERIAL_NUMBER,
  SUPPLY_POINT_LABEL,
  TAN,
  UDYAM,
  UPI_VPA,
  VALUATION_METHODS,
  VEHICLE_NUMBER,
  VENDOR_NET_PAYOUT,
  VERIFICATION_CODE,
  type Rule,
} from './rules';
import { Money } from './money';
import {
  isPlaceholderSerial,
  isValidGstin,
  normaliseEmail,
  normaliseGstin,
  normaliseMobile,
  normaliseSerial,
} from './normalise';

/** Schemas carry the rule they came from, so the meta-test can prove provenance. */
export type RuleBoundSchema<T extends z.ZodTypeAny> = T & { _trugradeRule: Rule };

function bind<T extends z.ZodTypeAny>(schema: T, r: Rule): RuleBoundSchema<T> {
  return Object.assign(schema, { _trugradeRule: r });
}

/** Build a string schema from a rule. The rule's own regex object is used, never a copy. */
export function zodFromRule(r: Rule): RuleBoundSchema<z.ZodString> {
  let s = z.string({ message: r.message });
  if (r.min !== undefined) s = s.min(r.min, { message: r.message });
  if (r.max !== undefined) s = s.max(r.max, { message: r.message });
  if (r.pattern) s = s.regex(r.pattern, { message: r.message });
  return bind(s, r);
}

// ---------------------------------------------------------------------------
// Statutory identifiers
// ---------------------------------------------------------------------------

/** Normalises, then checks shape, then checks the mod-36 check digit (VR-001, VR-002). */
export const gstinSchema = bind(
  z
    .string()
    .transform((v) => normaliseGstin(v) ?? '')
    .pipe(z.string().regex(GSTIN.pattern!, { message: GSTIN.message }))
    .refine(isValidGstin, { message: 'This GSTIN fails its check-digit test. Please re-enter.' }),
  GSTIN,
);

export const panSchema = bind(
  z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(PAN.pattern!, { message: PAN.message })),
  PAN,
);

export const cinSchema = zodFromRule(CIN);
export const llpinSchema = zodFromRule(LLPIN);
export const udyamSchema = zodFromRule(UDYAM);
export const tanSchema = zodFromRule(TAN);
export const aadhaarLast4Schema = zodFromRule(AADHAAR_LAST4);

// ---------------------------------------------------------------------------
// Banking
// ---------------------------------------------------------------------------

export const ifscSchema = bind(
  z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(IFSC.pattern!, { message: IFSC.message })),
  IFSC,
);

export const bankAccountNumberSchema = bind(
  z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(BANK_ACCOUNT_NUMBER.pattern!, { message: BANK_ACCOUNT_NUMBER.message })),
  BANK_ACCOUNT_NUMBER,
);

export const accountHolderNameSchema = zodFromRule(ACCOUNT_HOLDER_NAME);
export const upiVpaSchema = zodFromRule(UPI_VPA);

// ---------------------------------------------------------------------------
// Contact and address
// ---------------------------------------------------------------------------

export const mobileSchema = bind(
  z
    .string()
    .transform((v) => normaliseMobile(v) ?? '')
    .pipe(z.string().regex(MOBILE_E164.pattern!, { message: MOBILE_E164.message })),
  MOBILE_E164,
);

export const emailSchema = bind(
  z
    .string()
    .transform((v) => normaliseEmail(v) ?? '')
    .pipe(
      z.string().max(EMAIL.max!, { message: EMAIL.message }).regex(EMAIL.pattern!, {
        message: EMAIL.message,
      }),
    ),
  EMAIL,
);

export const pincodeSchema = zodFromRule(PINCODE);
export const addressLine1Schema = zodFromRule(ADDRESS_LINE1);
export const addressLine2Schema = zodFromRule(ADDRESS_LINE2);
export const fullNameSchema = zodFromRule(FULL_NAME);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const passwordSchema = zodFromRule(PASSWORD_COMPOSITION);
export const otpCodeSchema = zodFromRule(OTP_CODE);

// ---------------------------------------------------------------------------
// Listing and units
// ---------------------------------------------------------------------------

/** VR-076: normalise, shape-check, then reject firmware placeholders. */
export const serialNumberSchema = bind(
  z
    .string()
    .transform((v) => normaliseSerial(v) ?? '')
    .pipe(z.string().regex(SERIAL_NUMBER.pattern!, { message: SERIAL_NUMBER.message }))
    .refine((v) => !isPlaceholderSerial(v), {
      message:
        'That looks like a firmware placeholder, not a serial. Enter the number printed on the chassis.',
    }),
  SERIAL_NUMBER,
);

export const gradeSchema = z.enum(GRADES);
export const listingQtySchema = bind(
  z.number().int().min(LISTING_QTY.min!, { message: LISTING_QTY.message }).max(LISTING_QTY.max!, {
    message: LISTING_QTY.message,
  }),
  LISTING_QTY,
);

export const hsnCodeSchema = zodFromRule(HSN_CODE);
export const valuationMethodSchema = z.enum(VALUATION_METHODS);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Money crosses the wire as a fixed-2dp decimal string, never a number.
 * A JSON number would go through an IEEE-754 double and VR-126 exists to stop that.
 */
export const moneySchema = z.union([z.string(), z.number()]).transform((v, ctx) => {
  if (typeof v === 'number') {
    ctx.addIssue({
      code: 'custom',
      message: 'Send money as a decimal string ("1234.50"), never a JSON number.',
    });
    return z.NEVER;
  }
  try {
    return Money.parse(v);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
    return z.NEVER;
  }
});

const boundedMoney = (r: Rule) =>
  bind(
    moneySchema.refine((m) => m.gte(Money.rupees(r.min!)) && m.lte(Money.rupees(r.max!)), {
      message: r.message,
    }),
    r,
  );

export const vendorNetPayoutSchema = boundedMoney(VENDOR_NET_PAYOUT);
export const retailPriceSchema = boundedMoney(RETAIL_PRICE);

// ---------------------------------------------------------------------------
// QC
// ---------------------------------------------------------------------------

export const sealCodeSchema = bind(
  z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(SEAL_CODE.pattern!, { message: SEAL_CODE.message })),
  SEAL_CODE,
);

export const verificationCodeSchema = bind(
  z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(VERIFICATION_CODE.pattern!, { message: VERIFICATION_CODE.message })),
  VERIFICATION_CODE,
);

export const qcAreaSchema = z.enum(QC_AREAS);
export const qcAreaOutcomeSchema = z.enum(QC_AREA_OUTCOMES);
export const qcVerdictSchema = z.enum(QC_VERDICTS);

// ---------------------------------------------------------------------------
// Documents that travel
// ---------------------------------------------------------------------------

export const vehicleNumberSchema = bind(
  z
    .string()
    .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
    .pipe(z.string().regex(VEHICLE_NUMBER.pattern!, { message: VEHICLE_NUMBER.message })),
  VEHICLE_NUMBER,
);

export const invoiceNumberSchema = zodFromRule(INVOICE_NUMBER);
export const supplyPointLabelSchema = zodFromRule(SUPPLY_POINT_LABEL);

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

/** Sort is `field` or `-field`; the allow-list lives with each endpoint. */
export const sortSchema = z.string().regex(/^-?[a-z_]{1,40}$/);

export type Pagination = z.infer<typeof paginationSchema>;

/**
 * The registry the meta-test walks: every schema that claims a rule.
 * Adding a schema without registering it here fails VR-META-01b.
 */
export const RULE_BOUND_SCHEMAS: Readonly<Record<string, { _trugradeRule: Rule }>> = Object.freeze({
  gstin: gstinSchema,
  pan: panSchema,
  cin: cinSchema,
  llpin: llpinSchema,
  udyam: udyamSchema,
  tan: tanSchema,
  aadhaarLast4: aadhaarLast4Schema,
  ifsc: ifscSchema,
  bankAccountNumber: bankAccountNumberSchema,
  accountHolderName: accountHolderNameSchema,
  upiVpa: upiVpaSchema,
  mobile: mobileSchema,
  email: emailSchema,
  pincode: pincodeSchema,
  addressLine1: addressLine1Schema,
  addressLine2: addressLine2Schema,
  fullName: fullNameSchema,
  password: passwordSchema,
  otpCode: otpCodeSchema,
  serialNumber: serialNumberSchema,
  listingQty: listingQtySchema,
  hsnCode: hsnCodeSchema,
  vendorNetPayout: vendorNetPayoutSchema,
  retailPrice: retailPriceSchema,
  sealCode: sealCodeSchema,
  verificationCode: verificationCodeSchema,
  vehicleNumber: vehicleNumberSchema,
  invoiceNumber: invoiceNumberSchema,
  supplyPointLabel: supplyPointLabelSchema,
});
