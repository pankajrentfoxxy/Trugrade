/**
 * THE VALIDATION RULE CATALOGUE — the single source of truth.
 *
 * 04_TEST_PLAN.md Part 2 (VR-001…VR-160). Every rule that is enforced at the
 * client (**C**) *and* at the DTO boundary (**D**) resolves to the identical
 * exported constant here. The Zod schemas in `primitives.ts` and the
 * class-validator decorators in `apps/api` both read from this object, so a
 * duplicated literal regex is structurally impossible — that is what
 * VR-META-01 asserts, and `test/rules.meta.spec.ts` proves it.
 *
 * Do not inline a regex anywhere else. If a rule changes it changes here, once.
 */

/** Where a rule is enforced. C=client, D=DTO boundary, S=domain service, DB=database. */
export type EnforcedAt = 'C' | 'D' | 'S' | 'DB' | 'CI';

export interface Rule {
  /** VR-nnn from the test plan, so a failing test names the clause it broke. */
  readonly id: string;
  /** Dotted path of the field this governs, for traceability. */
  readonly field: string;
  /** The message a human sees. Specific, never "Validation failed" (08 §8 rule 2). */
  readonly message: string;
  readonly enforcedAt: readonly EnforcedAt[];
  readonly pattern?: RegExp;
  readonly min?: number;
  readonly max?: number;
  /** Free-text note carried into generated docs. */
  readonly note?: string;
}

const rule = <T extends Rule>(r: T): T => Object.freeze(r);

// ---------------------------------------------------------------------------
// 2.1 Statutory identifiers
// ---------------------------------------------------------------------------

export const GSTIN = rule({
  id: 'VR-001',
  field: 'kyc.gst_record.gstin',
  pattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
  // The example used to be 06ABCDE1234F1Z5, which fails its OWN check digit —
  // the mod-36 algorithm makes the last character 4, not 5. So the message shown
  // when a GSTIN is refused offered, as the model of a correct one, a GSTIN that
  // `isValidGstin` also rejects: copy the shape, adapt it, get refused twice,
  // with nothing on screen explaining why.
  //
  // It is spelled out as a shape rather than as a plausible-looking identifier
  // on purpose. A syntactically valid GSTIN in a public error string belongs to
  // some real Haryana business, and examples get pasted into forms.
  message:
    'Enter a valid 15-character GSTIN — two digits for the state, then a PAN, then three more characters. The last character is a checksum, so a single mistyped letter makes the whole number invalid.',
  enforcedAt: ['C', 'D', 'DB'],
});

export const GSTIN_CHECKSUM = rule({
  id: 'VR-002',
  field: 'kyc.gst_record.gstin',
  message: 'This GSTIN fails its check-digit test. Please re-enter.',
  enforcedAt: ['C', 'D', 'S'],
});

export const GSTIN_STATE_CODE = rule({
  id: 'VR-003',
  field: 'kyc.gst_record.gstin[0:2]',
  message: 'The first two digits of the GSTIN are not a valid state code.',
  enforcedAt: ['C', 'D', 'S'],
});

export const PAN = rule({
  id: 'VR-007',
  field: 'kyc.pan_record.pan',
  pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  message: 'Enter a valid 10-character PAN (e.g. ABCDE1234F).',
  enforcedAt: ['C', 'D', 'DB'],
});

/** VR-008: 4th character encodes the entity type and must agree with what was selected. */
export const PAN_HOLDER_TYPE: Readonly<Record<string, string>> = Object.freeze({
  C: 'COMPANY',
  P: 'INDIVIDUAL',
  H: 'HUF',
  F: 'PARTNERSHIP',
  A: 'AOP',
  T: 'TRUST',
  B: 'BODY_OF_INDIVIDUALS',
  L: 'LOCAL_AUTHORITY',
  J: 'ARTIFICIAL_JURIDICAL_PERSON',
  G: 'GOVERNMENT',
});

export const CIN = rule({
  id: 'VR-010',
  field: 'kyc.cin',
  pattern: /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/,
  message: 'Enter a valid 21-character CIN (e.g. U72900HR2021PTC098765).',
  enforcedAt: ['C', 'D', 'DB'],
});

export const LLPIN = rule({
  id: 'VR-013',
  field: 'kyc.llpin',
  pattern: /^[A-Z]{3}-[0-9]{4}$/,
  message: 'Enter a valid LLPIN (e.g. AAB-1234).',
  enforcedAt: ['C', 'D'],
});

export const UDYAM = rule({
  id: 'VR-014',
  field: 'kyc.udyam_number',
  pattern: /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/,
  message: 'Enter a valid Udyam registration number (e.g. UDYAM-HR-05-0001234).',
  enforcedAt: ['C', 'D', 'DB'],
});

export const TAN = rule({
  id: 'VR-017',
  field: 'kyc.tan',
  pattern: /^[A-Z]{4}[0-9]{5}[A-Z]$/,
  message: 'Enter a valid TAN (e.g. DELT12345E).',
  enforcedAt: ['C', 'D', 'DB'],
});

/** VR-019: full Aadhaar is never stored, never logged, never accepted. Last 4 only. */
export const AADHAAR_LAST4 = rule({
  id: 'VR-019',
  field: 'kyc.aadhaar_last4',
  pattern: /^[0-9]{4}$/,
  message: 'Enter the last 4 digits only.',
  enforcedAt: ['C', 'D', 'S', 'DB'],
  note: 'Storing a full Aadhaar number is a DPDP and UIDAI violation. There is no code path that accepts one.',
});

// ---------------------------------------------------------------------------
// 2.2 Banking
// ---------------------------------------------------------------------------

export const IFSC = rule({
  id: 'VR-021',
  field: 'kyc.bank_record.ifsc',
  pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  message: 'Enter a valid 11-character IFSC (e.g. HDFC0001234).',
  enforcedAt: ['C', 'D', 'DB'],
  note: 'The 5th character is a literal zero, not the letter O.',
});

export const BANK_ACCOUNT_NUMBER = rule({
  id: 'VR-023',
  field: 'kyc.bank_record.account_number',
  pattern: /^[0-9]{9,18}$/,
  min: 9,
  max: 18,
  message: 'Account number must be 9–18 digits.',
  enforcedAt: ['C', 'D', 'DB'],
  note: 'Stored AES-GCM encrypted, masked to last 4 on every read.',
});

export const ACCOUNT_HOLDER_NAME = rule({
  id: 'VR-025',
  field: 'kyc.bank_record.account_holder_name',
  pattern: /^[A-Za-z0-9 .,&'()\-/]{3,120}$/,
  min: 3,
  max: 120,
  message: "Use letters, numbers and . , & ' ( ) - / only.",
  enforcedAt: ['C', 'D'],
});

/** VR-026: penny-drop name-match bands. Below 0.70 is a hard fail, not a nudge. */
export const PENNY_DROP_MATCH = Object.freeze({
  id: 'VR-026',
  autoPassAtOrAbove: 0.9,
  needsReviewAtOrAbove: 0.7,
  message: 'The bank account name does not match your registered business name.',
});

export const UPI_VPA = rule({
  id: 'VR-029',
  field: 'kyc.bank_record.upi_vpa',
  pattern: /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/,
  message: 'Enter a valid UPI ID (e.g. name@bank).',
  enforcedAt: ['C', 'D'],
});

// ---------------------------------------------------------------------------
// 2.3 Contact, address, identity
// ---------------------------------------------------------------------------

/** VR-030: stored E.164. Input is normalised first — see `normaliseMobile`. */
export const MOBILE_E164 = rule({
  id: 'VR-030',
  field: 'identity.org_contact.mobile',
  pattern: /^\+91[6-9][0-9]{9}$/,
  message: 'Enter a valid 10-digit Indian mobile number starting 6–9.',
  enforcedAt: ['C', 'D', 'DB'],
});

export const EMAIL = rule({
  id: 'VR-032',
  field: 'identity.user_account.email',
  pattern:
    /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/,
  max: 254,
  message: 'Enter a valid email address.',
  enforcedAt: ['C', 'D', 'S', 'DB'],
});

export const EMAIL_DISPOSABLE = rule({
  id: 'VR-032b',
  field: 'identity.user_account.email',
  message: "Please use your business email — temporary mailboxes aren't accepted.",
  enforcedAt: ['S'],
});

export const PINCODE = rule({
  id: 'VR-034',
  field: 'identity.org_address.pincode',
  pattern: /^[1-9][0-9]{5}$/,
  message: 'Enter a valid 6-digit PIN code.',
  enforcedAt: ['C', 'D', 'DB'],
});

export const ADDRESS_LINE1 = rule({
  id: 'VR-037',
  field: 'identity.org_address.line1',
  min: 5,
  max: 150,
  message: 'Address line 1 must be at least 5 characters.',
  enforcedAt: ['C', 'D'],
});

export const ADDRESS_LINE2 = rule({
  id: 'VR-038',
  field: 'identity.org_address.line2',
  max: 150,
  message: 'Address line 2 must be 150 characters or fewer.',
  enforcedAt: ['C', 'D'],
});

/** VR-040: India bounding box. A QC check-in outside it is a data or fraud problem. */
export const INDIA_BBOX = Object.freeze({
  id: 'VR-040',
  latMin: 6.0,
  latMax: 37.5,
  lngMin: 68.0,
  lngMax: 97.5,
  message: 'The captured location is outside India.',
});

export const FULL_NAME = rule({
  id: 'VR-042',
  field: 'identity.user_account.full_name',
  pattern: /^[\p{L} .'-]{2,100}$/u,
  min: 2,
  max: 100,
  message: 'Enter your full name.',
  enforcedAt: ['C', 'D'],
});

// ---------------------------------------------------------------------------
// 2.4 Authentication, OTP, sessions
// ---------------------------------------------------------------------------

export const PASSWORD = rule({
  id: 'VR-044',
  field: 'identity.user_account.password',
  min: 12,
  max: 128,
  message: 'Password must be at least 12 characters.',
  enforcedAt: ['C', 'D'],
});

export const PASSWORD_COMPOSITION = rule({
  id: 'VR-045',
  field: 'identity.user_account.password',
  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=[\]{};':",./<>?]).{12,128}$/,
  message: 'Include an uppercase letter, a lowercase letter, a number and a symbol.',
  enforcedAt: ['C', 'D'],
});

/** VR-046. Brand words are rejected in passwords; the list follows the brand token. */
export const PASSWORD_BLOCKLIST_WORDS = Object.freeze([
  'trugrade',
  'truetech',
  'gorefurbo',
  'devicesure',
  'rentfoxxy',
]);

export const PASSWORD_BLOCKLIST = rule({
  id: 'VR-046',
  field: 'identity.user_account.password',
  min: 3,
  message: 'That password is too easy to guess. Try something less predictable.',
  enforcedAt: ['C', 'D', 'S'],
  note: 'zxcvbn score >= 3, and must not contain the email local-part, the mobile, or a brand word.',
});

export const PASSWORD_HISTORY = rule({
  id: 'VR-047',
  field: 'identity.password_history',
  max: 5,
  message: "You've used this password before. Choose a new one.",
  enforcedAt: ['S', 'DB'],
});

export const OTP_CODE = rule({
  id: 'VR-050',
  field: 'identity.otp_request.code',
  pattern: /^[0-9]{6}$/,
  message: 'Enter the 6-digit code we sent you.',
  enforcedAt: ['C', 'D', 'S', 'DB'],
  note: 'CSPRNG, stored as salted SHA-256, never logged.',
});

/**
 * VR-051…VR-055. Every one of these is read from `platform_config` at runtime;
 * the numbers here are the seeded defaults and the values the tests assert.
 */
export const OTP_POLICY = Object.freeze({
  ttlSeconds: 300,
  maxVerifyAttempts: 5,
  resendCooldownSeconds: 60,
  maxResendsPerHour: 5,
  maxResendsPerDay: 20,
  expiredMessage: "That code has expired. Tap 'Resend' for a new one.",
  burnedMessage: 'Too many incorrect attempts. Request a new code.',
  usedMessage: 'That code has already been used.',
  wrongScopeMessage: "This code isn't valid for this action.",
});

/** VR-055: an OTP is bound to what it was issued for. */
export const OTP_PURPOSES = Object.freeze([
  'REGISTRATION',
  'LOGIN',
  'CONTACT_CHANGE_OLD',
  'CONTACT_CHANGE_NEW',
  'BANK_CHANGE',
  'PAYOUT_CHANGE',
  'QC_VISIT_SIGNOFF',
  'DELIVERY',
  'PASSWORD_RESET',
] as const);
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const TOTP_POLICY = Object.freeze({
  id: 'VR-056',
  digits: 6,
  stepSeconds: 30,
  driftSteps: 1,
  message: 'Enter the 6-digit code from your authenticator app.',
  replayMessage: 'That code has already been used.',
});

export const SESSION_POLICY = Object.freeze({
  accessTtlSeconds: 900, // VR-058, 15 min, RS256
  refreshTtlSeconds: 30 * 24 * 3600, // VR-059, 30 days, rotating
  /**
   * How long a rotation stays replayable, so two tabs refreshing at the same
   * instant are not read as a stolen token. Long enough to cover a concurrent
   * page load, far too short to be a useful window for an actual replay.
   */
  refreshGraceSeconds: 30,
  refreshReuseMessage: "For your security we've signed you out. Please sign in again.",
  loginFailuresPerEmail: 5, // VR-060
  loginFailuresPerIp: 20,
  loginWindowSeconds: 15 * 60,
  lockoutSeconds: 15 * 60,
  lockoutMessage: 'Too many sign-in attempts. Try again in 15 minutes.',
});

// ---------------------------------------------------------------------------
// 2.5 File upload
// ---------------------------------------------------------------------------

export const UPLOAD_MAX_BYTES = 5_242_880; // VR-061, 5 MiB

export const UPLOAD_ALLOWED_MIME = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const);
export type AllowedMime = (typeof UPLOAD_ALLOWED_MIME)[number];

/** VR-063: sniffed signature must agree with the declared MIME. Extension is never trusted. */
export const MAGIC_BYTES: Readonly<Record<AllowedMime, readonly number[][]>> = Object.freeze({
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // RIFF....WEBP — bytes 0-3 and 8-11; the checker handles the gap.
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]],
});

/** VR-064: active content in a PDF is rejected outright. SVG is not an allowed type at all. */
export const PDF_FORBIDDEN_TOKENS = Object.freeze([
  '/JavaScript',
  '/JS',
  '/OpenAction',
  '/Launch',
  '/EmbeddedFile',
  '/AA',
]);

export const UPLOAD_RULES = Object.freeze({
  sizeMessage: 'Files must be 5 MB or smaller.',
  mimeMessage: 'Upload a JPG, PNG, WEBP or PDF.',
  magicMessage: "This file doesn't look like a valid JPG/PNG/WEBP/PDF.",
  activeContentMessage: "This PDF contains active content and can't be accepted.",
  virusMessage: "This file failed our security scan and wasn't saved.",
  imageMinPx: 200,
  imageMaxPx: 8000,
  imageMaxMegapixels: 40,
  imageMaxAspectRatio: 100,
  filenamePattern: /^[A-Za-z0-9._-]{1,120}$/,
  filenameMessage: 'Rename the file using letters, numbers, dots, dashes or underscores.',
  signedUrlTtlSeconds: 300,
  maxFilesPerDocumentType: 3,
  maxFilesPerOnboarding: 25,
  qcPhotosRequired: 6,
  qcPhotosMax: 20,
  qcPhotoMessage: 'Capture all 6 required photos before submitting.',
});

// ---------------------------------------------------------------------------
// 2.6 Document age and validity
// ---------------------------------------------------------------------------

/** VR-072: only these types are age-limited. A GST certificate has no age limit. */
export const AGE_SENSITIVE_DOCUMENT_TYPES = Object.freeze([
  'BANK_STATEMENT',
  'CANCELLED_CHEQUE',
  'UTILITY_BILL',
  'RENT_AGREEMENT',
  'ADDRESS_PROOF',
  'GST_RETURN_ACK',
]);

export const DOCUMENT_AGE = Object.freeze({
  id: 'VR-072',
  maxAgeDays: 90,
  minDate: '1990-01-01',
  message: (dated: string) =>
    `This document is dated ${dated} — we need one issued in the last 90 days.`,
  futureMessage: "The document date can't be in the future.",
  expiryWarningDays: 30,
  gstinReverifyDays: 180,
});

// ---------------------------------------------------------------------------
// 2.7 Catalog, listing, units, pricing
// ---------------------------------------------------------------------------

export const SERIAL_NUMBER = rule({
  id: 'VR-076',
  field: 'listing.unit.serial_number',
  pattern: /^[A-Z0-9]{5,25}$/,
  min: 5,
  max: 25,
  message: "Enter the laptop's real serial number as printed on the chassis.",
  enforcedAt: ['C', 'D', 'S', 'DB'],
});

/**
 * VR-076: firmware placeholders that are indistinguishable from a real serial to a
 * regex but are worthless as an identity. DeviceSure's `never-fabricate.md` turns
 * these into UNSUPPORTED upstream; we refuse them at the boundary as well.
 */
export const SERIAL_PLACEHOLDER_BLOCKLIST = Object.freeze([
  '0123456789',
  '123456789',
  'TOBEFILLEDBYOEM',
  'TOBEFILLEDBYOEM.',
  'SYSTEMSERIALNUMBER',
  'DEFAULTSTRING',
  'SERIALNUMBER',
  'NONE',
  'NA',
  'NULL',
  'INVALID',
  'CHASSISSERIALNUMBER',
]);

/** VR-078: warn-only brand plausibility. Worn labels are real; do not block on them. */
export const SERIAL_BRAND_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
  DELL: /^[A-Z0-9]{7}$/,
  HP: /^[A-Z0-9]{10}$/,
  LENOVO: /^[A-Z0-9]{8}$/,
  APPLE: /^[A-Z0-9]{10,12}$/,
});

export const LISTING_QTY = rule({
  id: 'VR-080',
  field: 'listing.listing.qty_total',
  min: 1,
  max: 5000,
  message: 'Quantity must be between 1 and 5,000.',
  enforcedAt: ['C', 'D', 'DB'],
});

export const VENDOR_NET_PAYOUT = rule({
  id: 'VR-083',
  field: 'listing.unit.vendor_ask_price',
  min: 1000,
  max: 500000,
  message: 'Expected payout must be between ₹1,000 and ₹5,00,000.',
  enforcedAt: ['C', 'D', 'DB'],
});

export const RETAIL_PRICE = rule({
  id: 'VR-084',
  field: 'listing.unit.retail_price',
  min: 1000,
  max: 1000000,
  message: 'Price must be between ₹1,000 and ₹10,00,000.',
  enforcedAt: ['C', 'D', 'DB'],
});

/** VR-085…VR-087. Guard rails, expressed once so pricing and QA agree. */
export const PRICE_GUARDRAILS = Object.freeze({
  minMarginAbsolute: 500,
  minMarginPct: 0.04,
  priceJumpApprovalPct: 0.25,
  marketWarnPct: 0.35,
  marketBlockPct: 0.6,
  floorMessage: (min: string) =>
    `This price is below our minimum margin. Minimum sellable price is ${min}.`,
  marginSchemeMessage: 'For margin-scheme stock the selling price must exceed the purchase price.',
});

export const GRADES = Object.freeze(['A_PLUS', 'A', 'B'] as const);
export type Grade = (typeof GRADES)[number];

/** Grades DeviceSure can emit. C/D/FAIL map to *not listable* — 07 §4 item 8. */
export const DEVICESURE_GRADES = Object.freeze(['A_PLUS', 'A', 'B', 'C', 'D', 'FAIL'] as const);
export type DeviceSureGrade = (typeof DEVICESURE_GRADES)[number];

/** VR-094 / VR-095: grading thresholds. Seeded into `catalog.grade_definition`. */
export const GRADE_THRESHOLDS: Readonly<
  Record<Grade, { minBatteryHealthPct: number; maxCycleCount: number }>
> = Object.freeze({
  A_PLUS: { minBatteryHealthPct: 85, maxCycleCount: 300 },
  A: { minBatteryHealthPct: 75, maxCycleCount: 700 },
  B: { minBatteryHealthPct: 60, maxCycleCount: 1200 },
});

export const BATTERY_HEALTH = rule({
  id: 'VR-094',
  field: 'listing.unit.battery_health_pct',
  min: 0,
  max: 100,
  message: 'Battery health is below our minimum for a listed unit.',
  enforcedAt: ['S', 'DB'],
});

export const HSN_CODE = rule({
  id: 'VR-098',
  field: 'catalog.sku.hsn_code',
  pattern: /^[0-9]{8}$/,
  message: 'Enter a valid 8-digit HSN code.',
  enforcedAt: ['D', 'S', 'DB'],
});

export const HSN_LAPTOP_DEFAULT = '84713010';

/**
 * VR-099 — the anonymity contract, as a regex.
 * `Supply Point A · Gurugram`. Nothing else may identify a source.
 */
export const SUPPLY_POINT_LABEL = rule({
  id: 'VR-099',
  field: 'dto.supply_point_label',
  pattern: /^Supply Point [A-Z]( ?[0-9]+)? · [A-Za-z ]{2,40}$/,
  message: 'Invalid supply point label.',
  enforcedAt: ['S'],
  note: 'A vendor legal name, GSTIN, PAN, address line, phone, email, rating or internal id in a customer-facing response is a P0 defect.',
});

/**
 * The banned keys, as data. The CI serialization sweep (IDN-080…IDN-094) walks
 * every customer-facing payload and fails on any of these at any depth.
 */
export const VENDOR_IDENTITY_BANNED_KEYS = Object.freeze([
  'vendor_id',
  'vendorId',
  'vendor_org_id',
  'vendorOrgId',
  'organization_id',
  'organizationId',
  'org_id',
  'orgId',
  'vendor_name',
  'vendorName',
  'legal_name',
  'legalName',
  'trade_name',
  'tradeName',
  'gstin',
  'pan',
  'facility_address',
  'facilityAddress',
  'address_line1',
  'addressLine1',
  'address_line2',
  'addressLine2',
  'vendor_tier',
  'vendorTier',
  'vendor_rating',
  'vendorRating',
  'expected_payout_price',
  'expectedPayoutPrice',
  'vendor_ask_price',
  'vendorAskPrice',
  'agreed_net_payout',
  'agreedNetPayout',
  'purchase_price',
  'purchasePrice',
  'vendor_backed_months',
  'vendorBackedMonths',
  'platform_backed_months',
  'platformBackedMonths',
  'contact_mobile',
  'contactMobile',
  'contact_email',
  'contactEmail',
]);

// ---------------------------------------------------------------------------
// 2.8 Seals
// ---------------------------------------------------------------------------

/**
 * VR-100. The test plan writes `GRF-26HR-0004821`; the brand is now Trugrade, so the
 * prefix is a three-letter token in `platform_config` (`qc.seal_code_prefix`,
 * default `TRG`) and the shape is what is validated. Physical seal rolls are ordered
 * against this shape — changing it after the first roll is printed is expensive.
 */
export const SEAL_CODE = rule({
  id: 'VR-100',
  field: 'qc.qc_seal.seal_code',
  pattern: /^[A-Z]{3}-[0-9]{2}[A-Z]{2}-[0-9]{7}$/,
  message: 'Enter the seal code exactly as printed (TRG-26HR-0004821).',
  enforcedAt: ['C', 'D', 'DB'],
});

export const SEAL_CODE_PREFIX_DEFAULT = 'TRG';

/** VR-103: the only legal seal transitions. BROKEN is terminal. */
export const SEAL_TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  APPLIED: ['INTACT', 'BROKEN', 'MISSING', 'VOID', 'REPLACED'],
  INTACT: ['BROKEN', 'MISSING', 'REPLACED'],
  BROKEN: [],
  MISSING: ['REPLACED'],
  VOID: [],
  REPLACED: [],
});

export const SEAL_VOID_WINDOW_MINUTES = 15;

// ---------------------------------------------------------------------------
// 2.9 QC report
// ---------------------------------------------------------------------------

export const QC_REPORT_VALIDITY_DAYS = 90; // VR-111
export const QC_EXPIRY_WARNING_DAYS = 14;
export const QC_REPORT_FRESHNESS_MINUTES = 10; // VR-109
export const QC_GEO_VARIANCE_ALERT_METRES = 500; // VR-114
export const GRADE_CORRECTION_AUTO_APPLY_DAYS = 2; // VR-115

/** The twelve inspection areas. `UNIQUE (qc_report_id, area)`. */
export const QC_AREAS = Object.freeze([
  'CHASSIS',
  'LID',
  'PALMREST',
  'KEYBOARD',
  'TRACKPAD',
  'SCREEN',
  'HINGES',
  'PORTS',
  'BATTERY',
  'STORAGE',
  'MEMORY',
  'THERMALS',
] as const);
export type QcArea = (typeof QC_AREAS)[number];

/**
 * A missing value is not a passing value (07 §2, 08 §8 rule 3).
 * NOT_MEASURED is a distinct outcome from PASS and it caps the grade.
 */
export const QC_AREA_OUTCOMES = Object.freeze(['PASS', 'WARN', 'FAIL', 'NOT_MEASURED'] as const);
export type QcAreaOutcome = (typeof QC_AREA_OUTCOMES)[number];

export const QC_VERDICTS = Object.freeze(['PASS', 'PASS_WITH_NOTE', 'MISMATCH', 'FAIL'] as const);
export type QcVerdict = (typeof QC_VERDICTS)[number];

/**
 * 07_DEVICESURE_INTEGRATION.md §3.1 — the floor rules. A weighted mean cannot
 * express "one critical component failed", so the mean never decides alone.
 */
export const GRADE_CAP_RULES = Object.freeze({
  criticalFail: null as Grade | null, // not certifiable at all
  failOnRequired: 'B' as Grade, // pack says cap at C; we sell nothing below B, so B is the floor and it is then not sellable
  warnOnRequired: 'A' as Grade,
  notMeasuredOnRequired: 'A' as Grade,
});

/**
 * Areas whose absence or failure is material enough to cap a grade.
 *
 * All twelve. THERMALS is on the list deliberately: `07 §3.1` found DeviceSure
 * treating an unmeasured thermal system as neutral, and "an unmeasured thermal
 * system on a gaming laptop is a material unknown". Under r.7(5) we vouch for the
 * grade, so a component nobody measured cannot quietly not count.
 */
export const QC_REQUIRED_AREAS = QC_AREAS;

/** VR-113 */
export const QC_AREA_SCORE = Object.freeze({ min: 0, max: 10 });

/**
 * The public verification code behind the QR. 06 §5 and Phase 4 Task 10:
 * unguessable, 12+ characters, never a sequence. Crockford base32 minus
 * ambiguous glyphs so a person can retype it from a printed certificate.
 */
export const VERIFICATION_CODE = rule({
  id: 'VR-111b',
  field: 'qc.qc_report.verification_code',
  // Crockford base32: I, L, O and U are excluded so a person can retype the code
  // off a printed certificate without guessing at a glyph.
  pattern: /^[0-9A-HJKMNP-TV-Z]{14}$/,
  message: 'That verification code was not recognised.',
  enforcedAt: ['D', 'S', 'DB'],
});

export const VERIFICATION_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const VERIFICATION_CODE_LENGTH = 14;

// ---------------------------------------------------------------------------
// 2.10 Orders, credit, approvals
// ---------------------------------------------------------------------------

export const ORDER_LIMITS = Object.freeze({
  qtyPerLineMax: 500, // VR-116
  unitsPerOrderMax: 1000,
  linesPerOrderMax: 500, // VR-117
  orderValueMax: 500_000_000, // VR-118, ₹5 crore
  qtyMessage: 'You can order up to 500 units of one item.',
  linesMessage: 'An order can contain up to 500 line items.',
  valueMessage: 'Orders above ₹5 crore need to go through our enterprise desk.',
});

export const CREDIT_TERMS_DAYS = Object.freeze([0, 7, 15, 30, 45, 60] as const);
export const CREDIT_LIMIT_MAX = 100_000_000; // VR-120, ₹10 crore

/** VR-124: cart-stage soft hold. Phase 6 uses this for the checkout reservation. */
export const RESERVATION_TTL_MINUTES = 20;
export const APPROVAL_HOLD_TTL_HOURS = 24;

// ---------------------------------------------------------------------------
// 2.11 Tax and money
// ---------------------------------------------------------------------------

export const MONEY_SCALE = 2; // VR-126, NUMERIC(14,2). No floats in the money path.
export const CURRENCY = 'INR' as const; // VR-147
export const GST_RATE_LAPTOP_PCT = 18; // VR-131 — seeded, effective-dated, never hard-coded downstream

export const VALUATION_METHODS = Object.freeze(['REGULAR', 'MARGIN'] as const);
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

/** VR-132: the exact narration the law expects on a margin-scheme invoice. */
export const MARGIN_SCHEME_NARRATION =
  'Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase.';

/** VR-135: strictly greater than ₹50,000. ₹50,000.00 exactly does not need one. */
export const EWAY_BILL_THRESHOLD_INR = 50000;

export const VEHICLE_NUMBER = rule({
  id: 'VR-137',
  field: 'payment.eway_bill.vehicle_number',
  pattern: /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/,
  message: 'Enter a valid vehicle number (e.g. HR26DK8337).',
  enforcedAt: ['C', 'D', 'S'],
});

/**
 * VR-138 / VR-139 — s.393(1) Table Sl. No. 8(ii), Income-tax Act 2025 (ex-194Q).
 * Note what is NOT here: s.206C(1H) seller TCS and s.206AB/206CCA non-filer checks
 * are omitted from 1 Apr 2025 and must never be built (04 §1.6).
 */
export const TDS_PURCHASES = Object.freeze({
  id: 'VR-138',
  vendorThresholdInr: 5_000_000, // ₹50 lakh per vendor per FY
  ourTurnoverThresholdInr: 100_000_000, // ₹10 crore in the preceding FY
  ratePct: 0.1,
  ratePctNoPan: 5,
  section: 's.393(1) Table Sl. No. 8(ii)',
  returnForm: '26Q',
  sectionCode: '1031',
  note: 'Base excludes GST where shown separately. Deduct at credit or payment, whichever is earlier.',
});

export const INVOICE_NUMBER = rule({
  id: 'VR-146',
  field: 'payment.invoice.invoice_number',
  pattern: /^TRG\/[0-9]{4}-[0-9]{2}\/[A-Z]{2}\/[0-9]{6}$/,
  message: 'Invalid invoice number format.',
  enforcedAt: ['S', 'DB'],
  note: 'Per-series, gapless, monotonic, financial-year scoped, allocated under a row lock.',
});

export const PAYOUT_MIN_THRESHOLD_INR = 1000;
export const OVERPAYMENT_TOLERANCE_INR = 1;

// ---------------------------------------------------------------------------
// 2.12 Dates, windows, state
// ---------------------------------------------------------------------------

export const TIMEZONE = 'Asia/Kolkata'; // VR-160

/**
 * VR-153 vs client Q5. The test plan writes 5 days; `_CONTEXT.md` and the phase
 * prompts write 48 hours. 48 h is the commercial promise the model is built on, so
 * it is the seeded default and this is `platform_config.ordering.inspection_window_hours`.
 * See docs/DECISIONS_OPEN.md#q5.
 */
export const INSPECTION_WINDOW_HOURS = 48;

export const WARRANTY_DURATIONS_MONTHS = Object.freeze([3, 6, 12] as const);

export const PLATFORM_CONFIG_KEY = rule({
  id: 'VR-152',
  field: 'platform.platform_config.key',
  pattern: /^[a-z0-9_.]{3,80}$/,
  message: 'Configuration key already exists.',
  enforcedAt: ['D', 'DB'],
});

export const PARTITION_RUNWAY_DAYS = Object.freeze({
  id: 'VR-159',
  required: 90,
  alertBelow: 30,
});

// ---------------------------------------------------------------------------
// The registry — what the meta-tests walk.
// ---------------------------------------------------------------------------

/**
 * Every `Rule` in this file, by id. VR-META-01 walks this and asserts that the
 * Zod schema for each C+D rule is built from the *same object*, not a copy.
 */
export const RULES: Readonly<Record<string, Rule>> = Object.freeze({
  [GSTIN.id]: GSTIN,
  [GSTIN_CHECKSUM.id]: GSTIN_CHECKSUM,
  [GSTIN_STATE_CODE.id]: GSTIN_STATE_CODE,
  [PAN.id]: PAN,
  [CIN.id]: CIN,
  [LLPIN.id]: LLPIN,
  [UDYAM.id]: UDYAM,
  [TAN.id]: TAN,
  [AADHAAR_LAST4.id]: AADHAAR_LAST4,
  [IFSC.id]: IFSC,
  [BANK_ACCOUNT_NUMBER.id]: BANK_ACCOUNT_NUMBER,
  [ACCOUNT_HOLDER_NAME.id]: ACCOUNT_HOLDER_NAME,
  [UPI_VPA.id]: UPI_VPA,
  [MOBILE_E164.id]: MOBILE_E164,
  [EMAIL.id]: EMAIL,
  [EMAIL_DISPOSABLE.id]: EMAIL_DISPOSABLE,
  [PINCODE.id]: PINCODE,
  [ADDRESS_LINE1.id]: ADDRESS_LINE1,
  [ADDRESS_LINE2.id]: ADDRESS_LINE2,
  [FULL_NAME.id]: FULL_NAME,
  [PASSWORD.id]: PASSWORD,
  [PASSWORD_COMPOSITION.id]: PASSWORD_COMPOSITION,
  [PASSWORD_BLOCKLIST.id]: PASSWORD_BLOCKLIST,
  [PASSWORD_HISTORY.id]: PASSWORD_HISTORY,
  [OTP_CODE.id]: OTP_CODE,
  [SERIAL_NUMBER.id]: SERIAL_NUMBER,
  [LISTING_QTY.id]: LISTING_QTY,
  [VENDOR_NET_PAYOUT.id]: VENDOR_NET_PAYOUT,
  [RETAIL_PRICE.id]: RETAIL_PRICE,
  [BATTERY_HEALTH.id]: BATTERY_HEALTH,
  [HSN_CODE.id]: HSN_CODE,
  [SUPPLY_POINT_LABEL.id]: SUPPLY_POINT_LABEL,
  [SEAL_CODE.id]: SEAL_CODE,
  [VERIFICATION_CODE.id]: VERIFICATION_CODE,
  [VEHICLE_NUMBER.id]: VEHICLE_NUMBER,
  [INVOICE_NUMBER.id]: INVOICE_NUMBER,
  [PLATFORM_CONFIG_KEY.id]: PLATFORM_CONFIG_KEY,
});
