import type { PrismaClient } from '@prisma/client';

/**
 * The stepper, as data.
 *
 * Originally seeded inside the Phase 1 migration, moved here because it is
 * reference *data*, not schema — and a truncate in a test run made that
 * distinction expensive: the rows were unrecoverable without re-migrating, and
 * the suite failed on "0 steps" with nothing pointing at why.
 *
 * Migrations define structure. Seeds define the rows. Keeping that line clean
 * means a wiped table is one `pnpm db:seed` away from correct.
 */

/** [orgType, stepCode, order, title, purposeNote, estimatedMinutes] */
const STEP_DEFINITIONS: Array<[string, string, number, string, string, number]> = [
  // Vendor, 7 steps
  [
    'VENDOR',
    'ACCOUNT',
    1,
    'Contact',
    'We verify your mobile and email before anything else, so nobody can register a business in your name.',
    3,
  ],
  [
    'VENDOR',
    'BUSINESS_PROFILE',
    2,
    'Business',
    'Your legal name and registered address go on every purchase order we raise to you.',
    6,
  ],
  [
    'VENDOR',
    'STATUTORY',
    3,
    'Statutory',
    'GSTIN and PAN decide how we invoice you and whether TDS applies. We check them against the source, not against what you type.',
    5,
  ],
  [
    'VENDOR',
    'CAPABILITY',
    4,
    'Capability',
    'What you deal in and how much you can handle. This is what routes stock enquiries to you.',
    5,
  ],
  [
    'VENDOR',
    'FACILITY_CONTACTS',
    5,
    'Facility and contacts',
    'The exact dispatch address becomes "Dispatch From" on the e-way bill for every unit you sell.',
    8,
  ],
  [
    'VENDOR',
    'DOCUMENTS_BANK',
    6,
    'Documents and bank',
    'A one-rupee test transfer confirms the payout account is yours. It is refunded.',
    10,
  ],
  [
    'VENDOR',
    'AGREEMENT',
    7,
    'Agreement and payout',
    'The vendor agreement, the grading policy and the data-wipe undertaking, e-signed.',
    6,
  ],
  // Buyer, 5 steps
  [
    'BUYER',
    'ACCOUNT',
    1,
    'Account',
    'We verify your work email and mobile so only you can place orders on this account.',
    3,
  ],
  [
    'BUYER',
    'BUSINESS_PROFILE',
    2,
    'Company',
    'Your legal name as it should appear on the tax invoice.',
    4,
  ],
  [
    'BUYER',
    'STATUTORY',
    3,
    'Statutory',
    'Your GSTIN decides whether we charge IGST or CGST+SGST, and what input credit you can claim.',
    4,
  ],
  [
    'BUYER',
    'CONTACTS_ADDRESSES',
    4,
    'Contacts and delivery',
    'Where machines are delivered, who signs for them, and what hours your dock is open.',
    6,
  ],
  [
    'BUYER',
    'DOCUMENTS',
    5,
    'Documents and preferences',
    'Your GST certificate and PAN, plus how you want to be notified.',
    5,
  ],
];

/**
 * Field-level requirements, gated by constitution.
 *
 * `constitution_type` is PROPRIETORSHIP, PARTNERSHIP, LLP, PVT_LTD, LTD, TRUST,
 * SOCIETY, OTHER — not the PRIVATE_LIMITED/OPC vocabulary the phase prompt uses.
 *
 * `forbidden_for` matters as much as `required_for`: an optional field a person
 * cannot possibly have is a field they will try to fill in.
 *
 * Incorporation is a FIELD here, not a step. The source document references an
 * `INCORPORATION` step code that is absent from its own enumerated list;
 * resolving it as a field keeps the counts at the specified 7 and 5, and keeps a
 * proprietor from seeing a step that would always be empty for them.
 *
 * [orgType, stepCode, fieldCode, label, requiredFor, forbiddenFor, helpText]
 */
const FIELD_REQUIREMENTS: Array<
  [string, string, string, string, string[] | null, string[] | null, string | null]
> = [
  [
    'VENDOR',
    'STATUTORY',
    'cin',
    'CIN',
    ['PVT_LTD', 'LTD'],
    ['PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'TRUST', 'SOCIETY', 'OTHER'],
    '21 characters, from your certificate of incorporation.',
  ],
  [
    'VENDOR',
    'STATUTORY',
    'llpin',
    'LLPIN',
    ['LLP'],
    ['PROPRIETORSHIP', 'PARTNERSHIP', 'PVT_LTD', 'LTD', 'TRUST', 'SOCIETY', 'OTHER'],
    'Format AAB-1234.',
  ],
  [
    'VENDOR',
    'STATUTORY',
    'incorporation_date',
    'Date of incorporation',
    ['PVT_LTD', 'LTD', 'LLP'],
    ['PROPRIETORSHIP'],
    null,
  ],
  [
    'VENDOR',
    'STATUTORY',
    'udyam_number',
    'Udyam registration',
    null,
    null,
    'Optional. If you provide it we show the MSME badge on your profile.',
  ],
  [
    'VENDOR',
    'DOCUMENTS_BANK',
    'board_resolution',
    'Board resolution',
    ['PVT_LTD', 'LTD'],
    ['PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'TRUST', 'SOCIETY', 'OTHER'],
    "Authorising the signatory to contract on the company's behalf.",
  ],
  [
    'BUYER',
    'STATUTORY',
    'cin',
    'CIN',
    ['PVT_LTD', 'LTD'],
    ['PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'TRUST', 'SOCIETY', 'OTHER'],
    null,
  ],
];

/** VR-072. Registration certificates do not go stale; proof-of-state documents do. */
const DOCUMENT_TYPES: Array<[string, string, number | null, boolean, boolean]> = [
  ['GST_CERTIFICATE', 'GST registration certificate', null, false, false],
  ['PAN_CARD', 'PAN card', null, false, true],
  ['INCORPORATION', 'Certificate of incorporation', null, false, false],
  ['UDYAM_CERTIFICATE', 'Udyam registration', null, false, false],
  ['CANCELLED_CHEQUE', 'Cancelled cheque', 90, false, true],
  ['BANK_STATEMENT', 'Bank statement', 90, false, true],
  ['ADDRESS_PROOF', 'Address proof', 90, false, false],
  ['UTILITY_BILL', 'Utility bill', 90, false, false],
  ['RENT_AGREEMENT', 'Rent agreement', null, true, false],
  ['SIGNATORY_ID', 'Authorised signatory ID', null, false, true],
  ['BOARD_RESOLUTION', 'Board resolution', null, false, false],
  ['CPCB_EWASTE', 'CPCB e-waste registration', null, true, false],
  ['ISO_CERTIFICATE', 'ISO certificate', null, true, false],
  ['PO_TEMPLATE', 'Purchase order template', null, false, false],
];

export const ONBOARDING_COUNTS = {
  steps: STEP_DEFINITIONS.length,
  fieldRules: FIELD_REQUIREMENTS.length,
  documentTypes: DOCUMENT_TYPES.length,
};

export async function seedOnboardingDefinitions(prisma: PrismaClient): Promise<void> {
  for (const [orgType, code, order, title, note, minutes] of STEP_DEFINITIONS) {
    await prisma.$executeRaw`
      INSERT INTO kyc.onboarding_step_definition
        (org_type, step_code, step_order, title, purpose_note, estimated_minutes, is_required)
      VALUES (${orgType}::org_type, ${code}, ${order}, ${title}, ${note}, ${minutes}, TRUE)
      ON CONFLICT (org_type, step_code) DO UPDATE
        SET step_order = EXCLUDED.step_order,
            title = EXCLUDED.title,
            purpose_note = EXCLUDED.purpose_note,
            estimated_minutes = EXCLUDED.estimated_minutes`;
  }

  for (const [orgType, step, field, label, requiredFor, forbiddenFor, help] of FIELD_REQUIREMENTS) {
    await prisma.$executeRaw`
      INSERT INTO kyc.onboarding_field_requirement
        (org_type, step_code, field_code, label, required_for_constitutions,
         forbidden_for_constitutions, help_text)
      VALUES (${orgType}::org_type, ${step}, ${field}, ${label},
              ${requiredFor}::text[], ${forbiddenFor}::text[], ${help})
      ON CONFLICT (org_type, step_code, field_code) DO UPDATE
        SET required_for_constitutions = EXCLUDED.required_for_constitutions,
            forbidden_for_constitutions = EXCLUDED.forbidden_for_constitutions,
            label = EXCLUDED.label,
            help_text = EXCLUDED.help_text`;
  }

  for (const [code, label, maxAge, requiresExpiry, sensitive] of DOCUMENT_TYPES) {
    await prisma.$executeRaw`
      INSERT INTO kyc.document_type_rule (doc_type, label, max_age_days, requires_expiry, is_sensitive)
      VALUES (${code}, ${label}, ${maxAge}, ${requiresExpiry}, ${sensitive})
      ON CONFLICT (doc_type) DO UPDATE
        SET label = EXCLUDED.label, max_age_days = EXCLUDED.max_age_days`;
  }
}
