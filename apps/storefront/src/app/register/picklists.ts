import type { Option } from '../../lib/controls';

/**
 * The step-2 pick lists.
 *
 * **Constitution is the database enum, verbatim.** `constitution_type` in
 * `schema.prisma` is the column this answer lands in, and the seeded
 * `onboarding_field_requirement` rows gate CIN, LLPIN and incorporation date on
 * exactly these eight values. A ninth option here would be a value the schema
 * cannot store.
 *
 * **Industry, employee band and annual volume have no server-side definition.**
 * `customer.buyer_profile.industry` and `.annual_volume_estimate`, and
 * `identity.organization.employee_count_band`, are all free columns — nothing in
 * the API, the seed or `@trugrade/contracts` says what may go in them. These
 * three lists are therefore written here and reported as a gap: they belong in
 * `platform_config` or in contracts, so the console's filters and this form
 * cannot drift apart. Until then, the draft holds the code, not the label.
 */

/** `constitution_type`, in the schema's own order. */
export const CONSTITUTIONS: readonly Option[] = [
  { value: '', label: 'Select the constitution' },
  { value: 'PROPRIETORSHIP', label: 'Proprietorship' },
  { value: 'PARTNERSHIP', label: 'Partnership firm' },
  { value: 'LLP', label: 'Limited liability partnership (LLP)' },
  { value: 'PVT_LTD', label: 'Private limited company' },
  { value: 'LTD', label: 'Public limited company' },
  { value: 'TRUST', label: 'Trust' },
  { value: 'SOCIETY', label: 'Society' },
  { value: 'OTHER', label: 'Other' },
];

export const INDUSTRIES: readonly Option[] = [
  { value: '', label: 'Select the industry' },
  { value: 'IT_SERVICES', label: 'IT services and software' },
  { value: 'BPO_KPO', label: 'BPO / KPO' },
  { value: 'MANUFACTURING', label: 'Manufacturing' },
  { value: 'BFSI', label: 'Banking, financial services and insurance' },
  { value: 'HEALTHCARE', label: 'Healthcare and pharma' },
  { value: 'EDUCATION', label: 'Education and training' },
  { value: 'RETAIL_ECOMM', label: 'Retail and e-commerce' },
  { value: 'LOGISTICS', label: 'Logistics and transport' },
  { value: 'CONSTRUCTION', label: 'Construction and real estate' },
  { value: 'GOVERNMENT', label: 'Government and public sector' },
  { value: 'NONPROFIT', label: 'Non-profit' },
  { value: 'RENTAL', label: 'IT rental and leasing' },
  { value: 'RESELLER', label: 'IT reseller or system integrator' },
  { value: 'OTHER', label: 'Something else' },
];

export const EMPLOYEE_BANDS: readonly Option[] = [
  { value: '', label: 'Select the headcount' },
  { value: '1-10', label: '1 to 10' },
  { value: '11-50', label: '11 to 50' },
  { value: '51-200', label: '51 to 200' },
  { value: '201-500', label: '201 to 500' },
  { value: '501-1000', label: '501 to 1,000' },
  { value: '1000+', label: 'More than 1,000' },
];

/** Laptops a year, which is what `buyer_profile.annual_volume_estimate` counts. */
export const ANNUAL_VOLUMES: readonly Option[] = [
  { value: '', label: 'Select the yearly volume' },
  { value: '1-10', label: 'Up to 10 laptops' },
  { value: '11-50', label: '11 to 50 laptops' },
  { value: '51-200', label: '51 to 200 laptops' },
  { value: '201-500', label: '201 to 500 laptops' },
  { value: '500+', label: 'More than 500 laptops' },
];

/** `kyc.lead.source` is a free 40-character string; these are its intended values. */
export const HEARD_FROM: readonly Option[] = [
  { value: '', label: 'Select one' },
  { value: 'SEARCH', label: 'Search engine' },
  { value: 'REFERRAL', label: 'A colleague or another business' },
  { value: 'LINKEDIN', label: 'LinkedIn' },
  { value: 'EVENT', label: 'An event or trade show' },
  { value: 'SALES_CALL', label: 'Someone from Trugrade got in touch' },
  { value: 'EXISTING_VENDOR', label: 'We already sell to Trugrade' },
  { value: 'OTHER', label: 'Somewhere else' },
];

/** Renders a stored code back as its label, for a resumed draft. */
export const labelFor = (options: readonly Option[], value: string): string =>
  options.find((o) => o.value === value)?.label ?? value;

/* ==========================================================================
 * Step 4 — contacts and addresses
 * ======================================================================== */

/**
 * `identity.org_contact.contact_type`, verbatim from the CHECK constraint.
 *
 * The buyer flow asks for three of the nine. The others belong to a vendor
 * (WAREHOUSE, LOGISTICS) or are captured elsewhere (OWNER at registration,
 * GRIEVANCE from the legal pages), and a buyer asked for all nine answers none
 * of them well.
 */
export const CONTACT_ROLES = [
  {
    code: 'PROCUREMENT',
    label: 'Procurement',
    required: true,
    purpose: 'Who places and approves orders. Every order confirmation goes here.',
  },
  {
    code: 'FINANCE',
    label: 'Finance',
    required: true,
    purpose: 'Who receives the tax invoice and settles it. Wrong here means an unpaid invoice.',
  },
  {
    code: 'IT_ADMIN',
    label: 'IT',
    required: false,
    purpose: 'Optional. Who we call about an imaging spec, a BIOS password or a wipe certificate.',
  },
] as const;

export type ContactRole = (typeof CONTACT_ROLES)[number]['code'];

/**
 * GST state codes — the first two characters of every GSTIN.
 *
 * Held here with the name because `@trugrade/contracts` has no such map:
 * `stateCodeFromGstin` returns "06" and `VerificationService.stateName` keeps a
 * private eight-entry lookup that the storefront cannot import. Reported as a
 * contracts gap. The **code** is what a draft stores; the name is display.
 *
 * 25 (Daman and Diu) and 28 (undivided Andhra Pradesh) are deliberately absent:
 * both were withdrawn, and offering a state nobody can be registered in today
 * invites a billing address that no GSTIN can match. A GSTIN carrying one is not
 * refused — `stateNameForGstin` returns undefined and the cross-check stands
 * down rather than guessing.
 */
export const STATES: readonly Option[] = [
  { value: '', label: 'Select the state' },
  { value: '01', label: 'Jammu and Kashmir' },
  { value: '02', label: 'Himachal Pradesh' },
  { value: '03', label: 'Punjab' },
  { value: '04', label: 'Chandigarh' },
  { value: '05', label: 'Uttarakhand' },
  { value: '06', label: 'Haryana' },
  { value: '07', label: 'Delhi' },
  { value: '08', label: 'Rajasthan' },
  { value: '09', label: 'Uttar Pradesh' },
  { value: '10', label: 'Bihar' },
  { value: '11', label: 'Sikkim' },
  { value: '12', label: 'Arunachal Pradesh' },
  { value: '13', label: 'Nagaland' },
  { value: '14', label: 'Manipur' },
  { value: '15', label: 'Mizoram' },
  { value: '16', label: 'Tripura' },
  { value: '17', label: 'Meghalaya' },
  { value: '18', label: 'Assam' },
  { value: '19', label: 'West Bengal' },
  { value: '20', label: 'Jharkhand' },
  { value: '21', label: 'Odisha' },
  { value: '22', label: 'Chhattisgarh' },
  { value: '23', label: 'Madhya Pradesh' },
  { value: '24', label: 'Gujarat' },
  { value: '26', label: 'Dadra and Nagar Haveli and Daman and Diu' },
  { value: '27', label: 'Maharashtra' },
  { value: '29', label: 'Karnataka' },
  { value: '30', label: 'Goa' },
  { value: '31', label: 'Lakshadweep' },
  { value: '32', label: 'Kerala' },
  { value: '33', label: 'Tamil Nadu' },
  { value: '34', label: 'Puducherry' },
  { value: '35', label: 'Andaman and Nicobar Islands' },
  { value: '36', label: 'Telangana' },
  { value: '37', label: 'Andhra Pradesh' },
  { value: '38', label: 'Ladakh' },
  { value: '97', label: 'Other territory' },
];

/** A GST state code to its name, or undefined for a code we do not know. */
export const stateName = (code: string): string | undefined =>
  code === '' ? undefined : STATES.find((s) => s.value === code)?.label;

/** The state a GSTIN was issued in. Its first two characters are the code. */
export const stateNameForGstin = (gstin: string): string | undefined =>
  stateName(gstin.slice(0, 2));

/**
 * Receiving days.
 *
 * A dock that is shut is a failed delivery, a return leg and a second dispatch
 * fee, so the hours are asked for rather than assumed — and the assumption a
 * generic address form makes is "any weekday, any time", which is wrong for
 * most Indian industrial addresses.
 */
export const RECEIVING_DAYS: readonly Option[] = [
  { value: '', label: 'Select the days' },
  { value: 'MON_FRI', label: 'Monday to Friday' },
  { value: 'MON_SAT', label: 'Monday to Saturday' },
  { value: 'ALL', label: 'All days, including Sunday' },
];

/* ==========================================================================
 * Step 5 — documents and preferences
 * ======================================================================== */

/**
 * Which documents the **buyer** flow asks for, and whether each is required.
 *
 * The labels, the caps, the accepted types and the age rule are NOT here — they
 * come from `GET /onboarding/documents/types`, which is `kyc.document_type_rule`
 * data. Only the selection is client-side, and only because that table has no
 * `org_type` or `step_code` column: all fourteen rows apply to everyone, so
 * nothing in the API can say which four a buyer is asked for. Reported as an API
 * gap. A code here that the server does not return is not rendered.
 */
export const BUYER_DOCUMENTS = [
  {
    docType: 'GST_CERTIFICATE',
    required: true,
    purpose: 'The registration certificate for the GSTIN we invoice.',
  },
  {
    docType: 'PAN_CARD',
    required: true,
    purpose: 'The PAN of the entity, not of a director.',
  },
  {
    docType: 'SIGNATORY_ID',
    required: true,
    purpose:
      'Photo ID of the person authorised to purchase on this account. Aadhaar, passport or driving licence.',
  },
  {
    docType: 'PO_TEMPLATE',
    required: false,
    purpose: 'Optional. If your purchase orders have a fixed format, send one and we will match it.',
  },
] as const;

/**
 * How we may contact this account about an order.
 *
 * **Nothing here is ticked by default.** CP e-Comm Rule 4(9) forbids a
 * pre-selected consent, and a notification channel is exactly the kind of box
 * that arrives pre-ticked "because everyone wants order updates".
 */
export const NOTIFICATION_CHANNELS = [
  {
    code: 'EMAIL',
    label: 'Email',
    consequence: 'Order confirmations, invoices and dispatch notices go to the contacts above.',
  },
  {
    code: 'WHATSAPP',
    label: 'WhatsApp',
    consequence: 'Dispatch and delivery updates on the procurement mobile number.',
  },
  {
    code: 'SMS',
    label: 'SMS',
    consequence: 'Delivery-day messages only. We do not send offers by SMS.',
  },
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]['code'];

/** `platform` notification templates exist in these two. Nothing else is honest yet. */
export const LANGUAGES: readonly Option[] = [
  { value: '', label: 'Select a language' },
  { value: 'EN', label: 'English' },
  { value: 'HI', label: 'हिन्दी — Hindi' },
];

/* ==========================================================================
 * Vendor registration — steps 1 to 3
 * ========================================================================
 *
 * Same report as the buyer lists above: none of these has a server-side
 * definition. `vendor.vendor_profile.business_category` is a free `String` and
 * `.monthly_volume_estimate` is a bare `Int`, so nothing in the API, the seed
 * or `@trugrade/contracts` says what may go in either. Written here, and
 * reported as a gap — they belong in `platform_config` beside the buyer lists,
 * before the vendor console grows a filter that has to agree with this form.
 */

/** `vendor_profile.business_category`. What the supplier actually is. */
export const VENDOR_CATEGORIES: readonly Option[] = [
  { value: '', label: 'Select what best describes you' },
  { value: 'REFURBISHER', label: 'Refurbisher — we repair and grade in-house' },
  { value: 'ITAD', label: 'ITAD — we dispose of retired corporate fleets' },
  { value: 'LEASING', label: 'Leasing company — we sell off-lease returns' },
  { value: 'TRADER', label: 'Trader or wholesaler' },
  { value: 'OEM_PARTNER', label: 'OEM or brand-authorised partner' },
  { value: 'RETAILER', label: 'Retailer with buy-back stock' },
  { value: 'OTHER', label: 'Something else' },
];

/**
 * `vendor_profile.monthly_volume_estimate` is an integer, so the code is the
 * band's lower bound rather than a range string — a band that has to be parsed
 * back out of "51-200" is a band that will be parsed wrong once.
 */
export const MONTHLY_VOLUMES: readonly Option[] = [
  { value: '', label: 'Select the monthly volume' },
  { value: '10', label: 'Up to 25 laptops a month' },
  { value: '25', label: '25 to 100 a month' },
  { value: '100', label: '100 to 250 a month' },
  { value: '250', label: '250 to 500 a month' },
  { value: '500', label: 'More than 500 a month' },
];

/** `identity.organization.employee_count_band`, same column as the buyer's. */
export const STAFF_BANDS = EMPLOYEE_BANDS;
