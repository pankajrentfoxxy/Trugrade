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
  /**
   * The GSTIN we invoice buyers under. `06` is Haryana, which is why leg 2 of
   * every sale is inter-state for a buyer taking delivery anywhere else — see
   * `platformToBuyer` in `@trugrade/contracts`.
   *
   * This is the one registered identifier that has a real value today: it is the
   * seller GSTIN in `prisma/seed/invoicing.ts` and on every issued invoice.
   */
  gstin: '06AAJCT2846R1ZL',
  /**
   * Null, not a placeholder string. r.4(2) asks for the entity's identifiers and
   * a plausible-looking CIN is worse than a visible gap — somebody would try to
   * look it up on the MCA portal. Every consumer renders null as "Not yet
   * published", so the absence is on the page rather than hidden by it.
   */
  cin: null as string | null,
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
    /**
     * Null until a real line exists. `+91-000-000-0000` reads as a telephone
     * number, and r.4(2) contact information that dials nowhere is worse than
     * contact information that is openly missing — a customer with a problem
     * spends their attempt on it before finding the email that does work.
     */
    phone: null as string | null,
    hours: 'Mon–Sat, 10:00–18:00 IST',
  },
  /** r.4(4)–(5): a named person, resident in India. Acknowledge in 48 h, redress in 1 month. */
  grievanceOfficer: {
    name: 'To be appointed before launch',
    designation: 'Grievance Officer',
    email: BRAND.grievance,
    phone: null as string | null,
    address: 'Gurugram, Haryana, India',
  },
} as const;

export type Brand = typeof BRAND;
