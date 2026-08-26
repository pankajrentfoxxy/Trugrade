/**
 * The single source of the brand. Never hard-code a brand string in a component.
 * (08_BRAND_SYSTEM.md §2. Naming decided 26 Aug 2026: Trugrade.)
 */
export const BRAND = {
  name: 'Trugrade',
  nameLower: 'trugrade',
  domain: 'trugrade.in',
  legalEntity: 'TrueTech Services Pvt. Ltd.',
  qcProduct: 'DeviceSure',
  tagline: 'Opened, tested and graded before you see it.',
  support: 'help@trugrade.in',
  vendors: 'sell@trugrade.in',
  grievance: 'grievance@trugrade.in',
} as const;

/**
 * Consumer Protection (E-Commerce) Rules 2020 r.4(2) requires these to be displayed
 * prominently on every page. They are data, not layout — the footer renders whatever
 * is here, and adding a branch office is a config change.
 */
export const LEGAL_DISCLOSURE = {
  legalName: 'TrueTech Services Pvt. Ltd.',
  brandName: BRAND.name,
  website: `https://${BRAND.domain}`,
  registeredOffice: {
    line1: 'To be confirmed before launch',
    city: 'Gurugram',
    state: 'Haryana',
    stateCode: '06',
    pincode: '122001',
    country: 'India',
  },
  branches: [] as ReadonlyArray<{
    line1: string;
    city: string;
    state: string;
    pincode: string;
  }>,
  customerCare: {
    email: BRAND.support,
    phone: '+91-000-000-0000',
    hours: 'Mon–Sat, 10:00–18:00 IST',
  },
  /** r.4(4)–(5): a named person, resident in India. Acknowledge in 48 h, redress in 1 month. */
  grievanceOfficer: {
    name: 'To be appointed before launch',
    designation: 'Grievance Officer',
    email: BRAND.grievance,
    phone: '+91-000-000-0000',
    address: 'Gurugram, Haryana, India',
  },
} as const;

export type Brand = typeof BRAND;
