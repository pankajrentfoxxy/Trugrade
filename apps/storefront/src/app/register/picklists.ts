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

/* ==========================================================================
 * Vendor registration — step 4, capability
 * ========================================================================
 *
 * Same report as every list above: none of these has a server-side definition
 * in `@trugrade/contracts` or `platform_config`. Two of them at least have a
 * definition in the *database* and are copied from it verbatim, which is noted
 * against each; `SOURCING_CHANNELS` has none anywhere and is the one that will
 * drift first.
 */

/**
 * `vendor.vendor_capability.category`, verbatim from its CHECK constraint.
 *
 * A sixth option here is a value the column refuses, so the list is the
 * constraint and nothing else. It is what routes a stock enquiry, which is why
 * the labels say what the buyer would call the machine rather than what the
 * column calls it.
 */
export const SUPPLY_CATEGORIES = [
  {
    code: 'BUSINESS_LAPTOP',
    label: 'Business laptops',
    note: 'ThinkPad, Latitude, EliteBook and the like',
  },
  {
    code: 'WORKSTATION',
    label: 'Mobile workstations',
    note: 'Quadro or RTX class. ThinkPad P, ZBook, Precision',
  },
  { code: 'CONSUMER', label: 'Consumer laptops', note: 'Inspiron, IdeaPad, Pavilion, Vivobook' },
  { code: 'MACBOOK', label: 'MacBook', note: 'Air and Pro, Intel or Apple silicon' },
  { code: 'CHROMEBOOK', label: 'Chromebook', note: 'Usually education fleets' },
] as const;

/**
 * Where the stock comes from. **No definition anywhere** —
 * `vendor_capability.sourcing_channels` is a bare `TEXT[]` with no CHECK, no
 * enum and no contract, so these eight codes exist only here. Reported: they
 * belong in `platform_config` before the ops console grows a filter on them.
 *
 * It matters commercially rather than descriptively: a corporate buy-back lot
 * arrives with an asset register and a wipe obligation, an auction lot arrives
 * with neither, and the two are underwritten differently.
 */
export const SOURCING_CHANNELS = [
  {
    code: 'CORPORATE_BUYBACK',
    label: 'Corporate buy-back',
    note: 'Fleets bought directly from the company that used them.',
  },
  {
    code: 'ITAD_CONTRACT',
    label: 'ITAD contract',
    note: 'Disposal contracts where you are the appointed processor.',
  },
  { code: 'LEASE_RETURN', label: 'Off-lease returns', note: 'End-of-term returns from a lessor.' },
  {
    code: 'AUCTION',
    label: 'Auction or liquidation',
    note: 'Lots bought at auction, usually without an asset register.',
  },
  { code: 'IMPORT', label: 'Imported stock', note: 'Landed under your own IEC.' },
  {
    code: 'OEM_REFURB',
    label: 'OEM refurbished programme',
    note: 'Stock from a brand’s own refurbishment channel.',
  },
  {
    code: 'RETAIL_RETURN',
    label: 'Retail returns and open box',
    note: 'Returns from a retailer or marketplace.',
  },
  { code: 'TRADE_IN', label: 'Consumer trade-in', note: 'Individual machines taken in exchange.' },
] as const;

/* ==========================================================================
 * Vendor registration — step 5, facility and contacts
 * ======================================================================== */

/** `vendor.vendor_facility.facility_type`, verbatim from its CHECK constraint. */
export const FACILITY_TYPES: readonly Option[] = [
  { value: '', label: 'Select what this site is' },
  { value: 'WAREHOUSE', label: 'Warehouse — stock is stored here' },
  { value: 'REFURB_UNIT', label: 'Refurbishment unit — machines are worked on here' },
  { value: 'OFFICE', label: 'Office' },
  { value: 'RETAIL', label: 'Retail counter' },
];

/**
 * `vendor.vendor_facility.vehicle_access`, verbatim from its CHECK constraint.
 *
 * The column defaults to TEMPO and this list does not: a default that decides
 * which vehicle we send is a default that puts a 19-foot truck down a lane it
 * cannot reverse out of.
 */
export const VEHICLE_ACCESS: readonly Option[] = [
  { value: '', label: 'Select the largest vehicle that can reach the door' },
  { value: 'TRUCK', label: 'Truck — a 19 ft container can reach the loading point' },
  { value: 'TEMPO', label: 'Tempo — up to a 14 ft light commercial vehicle' },
  { value: 'BIKE_ONLY', label: 'Two-wheeler only — no four-wheeler access' },
];

/**
 * The four contacts a supplier is asked for, as `identity.org_contact`
 * `contact_type` codes from the CHECK constraint.
 *
 * OWNER is asked again here even though registration created the account: the
 * person who filled the form in is often not the person who signs the
 * agreement, and assuming they are is how a purchase order goes to somebody who
 * left in March.
 */
export const VENDOR_CONTACT_ROLES = [
  {
    code: 'OWNER',
    label: 'Owner or director',
    required: true,
    purpose:
      'Who signs the vendor agreement and answers for the business. We contact them about the relationship, not about individual orders.',
  },
  {
    code: 'LOGISTICS',
    label: 'Operations',
    required: true,
    purpose:
      'Who confirms a purchase order, packs it and hands it to the carrier. Every PO and every pick-up window goes here.',
  },
  {
    code: 'FINANCE',
    label: 'Finance',
    required: true,
    purpose:
      'Who raises your invoice and reconciles the payout. The TDS certificate and the payout advice go here.',
  },
  {
    code: 'WAREHOUSE',
    label: 'Warehouse',
    required: false,
    purpose:
      'Optional but worth giving: the person actually at the dock when a QC technician or a carrier arrives.',
  },
] as const;

/**
 * `vendor.facility_hours.day_of_week`, which is `0..6` with no comment saying
 * which end is Sunday. Taken as the JavaScript convention — `Date.getDay()`
 * returns 0 for Sunday — because that is what every client that reads it back
 * will assume. Displayed Monday first, which is how a working week is read.
 */
export const WEEK_DAYS = [
  { day: 1, label: 'Monday', short: 'Mon' },
  { day: 2, label: 'Tuesday', short: 'Tue' },
  { day: 3, label: 'Wednesday', short: 'Wed' },
  { day: 4, label: 'Thursday', short: 'Thu' },
  { day: 5, label: 'Friday', short: 'Fri' },
  { day: 6, label: 'Saturday', short: 'Sat' },
  { day: 0, label: 'Sunday', short: 'Sun' },
] as const;

/* ==========================================================================
 * Vendor registration — steps 6 and 7
 * ======================================================================== */

/**
 * The nine documents a supplier is asked for, and why each one is wanted.
 *
 * Same report as `BUYER_DOCUMENTS`: `document_type_rule` has no `org_type` and
 * no `step_code`, so all fourteen rows apply to everyone and nothing in the API
 * can say which nine a *vendor* is asked for. The codes are here; every rule
 * about each of them — the label, the size cap, the accepted types, how many we
 * take, whether it goes stale — comes from `GET /onboarding/documents/types`.
 *
 * `BOARD_RESOLUTION` is marked required here as the default for the two
 * constitutions that need one, and step 6 overrides it from the seeded
 * `onboarding_field_requirement` row for `board_resolution` whenever the server
 * returns one.
 */
export const VENDOR_DOCUMENTS = [
  {
    docType: 'GST_CERTIFICATE',
    required: true,
    purpose: 'Primary GSTIN registration certificate.',
  },
  {
    docType: 'PAN_CARD',
    required: true,
    purpose: 'Entity PAN for TDS on payouts.',
  },
  {
    docType: 'CANCELLED_CHEQUE',
    required: true,
    purpose: 'Must match the account below.',
  },
  {
    docType: 'ADDRESS_PROOF',
    required: true,
    purpose: 'Registered office — utility bill, rent agreement or property tax.',
  },
  {
    docType: 'INCORPORATION',
    required: true,
    purpose: 'COI, partnership deed or registration certificate.',
  },
  {
    docType: 'SIGNATORY_ID',
    required: true,
    purpose: 'Photo ID of the authorised signatory.',
  },
  {
    docType: 'BOARD_RESOLUTION',
    required: true,
    purpose: 'Authorising the signatory to contract.',
  },
  {
    docType: 'CPCB_EWASTE',
    required: false,
    purpose: 'CPCB e-waste authorisation, if held.',
  },
  {
    docType: 'ISO_CERTIFICATE',
    required: false,
    purpose: 'ISO certificate for your profile, if held.',
  },
] as const;

/** `bank_account.account_type`, from the baseline migration’s CHECK. */
export const ACCOUNT_TYPES: readonly Option[] = [
  { value: 'CURRENT', label: 'Current account' },
  { value: 'SAVINGS', label: 'Savings account' },
  { value: 'CC', label: 'Cash credit' },
  { value: 'OD', label: 'Overdraft' },
];

/**
 * `vendor_payout_preference.pricing_mode`. The two values its CHECK allows.
 *
 * Both converge on the same stored rupee figure — COMMISSION is a presentation
 * layer over the same contract, because vendors think in percentages. The
 * consequence text is the migration’s own column comment, said to a supplier.
 */
export const PRICING_MODES = [
  {
    value: 'NET_PAYOUT',
    label: 'I name the amount I want',
    consequence:
      'You give us a rupee figure per machine. We add our margin on top and that becomes the shelf price — so a discount we run never comes out of your number.',
  },
  {
    value: 'COMMISSION',
    label: 'I name the sale price and a rate',
    consequence:
      'You give us an expected sale price and a commission rate. We work out your payout from those two and freeze it the moment the purchase order is raised — nothing that happens to the shelf price afterwards changes it.',
  },
] as const;

/**
 * `vendor_payout_preference.preferred_cycle`, and which of them a new supplier
 * can actually have.
 *
 * Q6 in `DECISIONS_OPEN.md`: `T_PLUS_2` is the platform default *once a supplier
 * has earned it*, and the cycle is granted by tier. A brand-new application has
 * no supply history, so T+2 is a **request** here rather than a setting. Saying
 * that out loud is the point: silently granting a cycle we will not honour, and
 * silently refusing one they asked for, are both worse than telling them.
 */
export const PAYOUT_CYCLES = [
  {
    value: 'T_PLUS_2',
    label: 'Two working days after delivery',
    earned: true,
    consequence:
      'This one is earned rather than chosen. We record the request and grant it once your first consignments have been delivered and inspected without a claim — until then you are paid weekly, and we write to you on the day it changes.',
  },
  {
    value: 'WEEKLY',
    label: 'Weekly',
    earned: false,
    consequence:
      'Everything delivered and past its inspection window by the cut-off is paid in that week’s run. This is what every new supplier starts on.',
  },
  {
    value: 'MONTHLY',
    label: 'Monthly',
    earned: false,
    consequence:
      'One run a month. Slower than we would pay you, so choose it only if it suits your own book-keeping.',
  },
] as const;

/** The cycle every supplier starts on, whatever they request. */
export const CYCLE_UNTIL_EARNED = 'WEEKLY';

/**
 * `platform_config.procurement.min_payout_threshold_inr`, in rupees.
 *
 * A constant here because no route exposes `platform_config` to a browser. It is
 * the floor a vendor’s own threshold may not go below — under it the balance
 * rolls forward, because nobody wants a Rs 400 NEFT. Reported: it belongs behind
 * a public config endpoint beside the option lists above.
 */
export const MIN_PAYOUT_THRESHOLD_INR = 1000;

/**
 * The four documents step 7 asks a supplier to accept.
 *
 * **None of them is e-signed, and the screen says so.** There is no e-sign
 * adapter in `apps/api/src/shared/adapters` — `AADHAAR_ESIGN` exists as a
 * `CheckType` string and nothing implements it — so what actually happens is
 * that an acceptance is recorded against the named person, with the version and
 * the time. That is a real record and it is not a signature, and rendering a
 * tick that claims otherwise is the exact thing this system refuses to do.
 *
 * The versions are the ones a reviewer will see on the acceptance; they are
 * declared here because `agreement_acceptance` has no route and no seeded
 * catalogue of agreements to read them from. Reported.
 */
export const VENDOR_AGREEMENTS = [
  {
    code: 'VENDOR_AGREEMENT',
    version: '1.0',
    label: 'Supplier agreement',
    summary:
      'How we buy from you: we are the seller of record and buy each serial back-to-back when a customer orders it. Covers title, the purchase order, pricing and how either of us ends the arrangement.',
  },
  {
    code: 'GRADING_POLICY',
    version: '1.0',
    label: 'Grading policy',
    summary:
      'What A+, A and B mean, who inspects, and what happens when our grade and yours disagree. A grade correction is a conversation with evidence on both sides, not a unilateral downgrade.',
  },
  {
    code: 'DATA_WIPE_UNDERTAKING',
    version: '1.0',
    label: 'Data-wipe undertaking',
    summary:
      'You confirm every machine is wiped to a recognised standard before it leaves you, and that you can produce the erasure report for any serial we ask about.',
  },
  {
    code: 'RETURNS_POLICY',
    version: '1.0',
    label: 'Returns and claims',
    summary:
      'The 48-hour inspection window a buyer gets, what a valid claim looks like, and how a returned machine is settled against your payout.',
  },
] as const;

/**
 * How we reach a supplier. Same shape as the buyer’s list, different events —
 * a purchase order and a payout advice are not an order confirmation.
 *
 * **Nothing here is ticked by default**, for the same reason.
 */
export const VENDOR_NOTIFICATION_CHANNELS = [
  {
    code: 'EMAIL',
    label: 'Email',
    consequence:
      'Purchase orders, pick lists, payout advice and TDS certificates go to the contacts on step 5.',
  },
  {
    code: 'WHATSAPP',
    label: 'WhatsApp',
    consequence: 'Pick-up windows and dispatch reminders on the warehouse mobile number.',
  },
  {
    code: 'SMS',
    label: 'SMS',
    consequence: 'A purchase order raised and a payout released. Nothing else.',
  },
] as const;
