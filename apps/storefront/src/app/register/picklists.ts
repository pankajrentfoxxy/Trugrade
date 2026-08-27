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
