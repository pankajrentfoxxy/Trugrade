import type { GstinTaxpayer, VerificationOutcomeView } from '../../register/api';
import type { PostalAddress } from '../../register/AddressFields';
import type { VendorBusinessValues } from './StepVendorBusiness';

export interface GstBusinessPrefill {
  values: Partial<VendorBusinessValues>;
  /** Field keys on `VendorBusinessValues`, plus `registered` for the whole address block. */
  locked: ReadonlySet<string>;
}

interface GstinDraftRow {
  isPrimary?: boolean;
  confirmed?: boolean;
  outcome?: VerificationOutcomeView | null;
}

const verifiedPrimaryOutcome = (
  statutory: Record<string, unknown> | undefined,
): VerificationOutcomeView | null => {
  if (!statutory) return null;
  const rows = statutory.gstins;
  if (!Array.isArray(rows)) return null;

  const typed = rows as GstinDraftRow[];
  const primary = typed.find((r) => r.isPrimary && r.outcome?.outcome === 'PASS');
  if (primary?.outcome) return primary.outcome;

  const confirmed = typed.find((r) => r.confirmed && r.outcome?.outcome === 'PASS');
  if (confirmed?.outcome) return confirmed.outcome;

  const anyPass = typed.find((r) => r.outcome?.outcome === 'PASS');
  return anyPass?.outcome ?? null;
};

const toInputDate = (value: string): string => {
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return value;
};

const asPostal = (address: GstinTaxpayer['registeredAddress']): PostalAddress | undefined => {
  if (!address) return undefined;
  if (!address.line1 && !address.city && !address.pincode) return undefined;
  return {
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
  };
};

/** Business step values and lock set from the primary verified GSTIN on step 2. */
export function prefillFromVerifiedGst(
  statutory: Record<string, unknown> | undefined,
): GstBusinessPrefill | null {
  const outcome = verifiedPrimaryOutcome(statutory);
  if (!outcome?.resolved) return null;

  const taxpayer = outcome.resolved as GstinTaxpayer;
  const values: Partial<VendorBusinessValues> = {};
  const locked = new Set<string>();

  if (taxpayer.legalName) {
    values.legalName = taxpayer.legalName;
    locked.add('legalName');
  }
  if (taxpayer.tradeName) {
    values.tradeName = taxpayer.tradeName;
    locked.add('tradeName');
  }
  if (taxpayer.constitutionType) {
    values.constitution = taxpayer.constitutionType;
    locked.add('constitution');
  }
  if (taxpayer.registrationDate) {
    values.incorporationDate = toInputDate(taxpayer.registrationDate);
    locked.add('incorporationDate');
  }
  if (taxpayer.vendorCategory) {
    values.category = taxpayer.vendorCategory;
    locked.add('category');
  }

  const registered = asPostal(taxpayer.registeredAddress);
  if (registered) {
    values.registered = registered;
    locked.add('registered');
  }

  if (locked.size === 0) return null;
  return { values, locked };
}

export function mergeGstPrefill(
  current: VendorBusinessValues,
  prefill: GstBusinessPrefill,
): VendorBusinessValues {
  const next = { ...current, registered: { ...current.registered } };
  if (prefill.locked.has('legalName') && prefill.values.legalName)
    next.legalName = prefill.values.legalName;
  if (prefill.locked.has('tradeName') && prefill.values.tradeName)
    next.tradeName = prefill.values.tradeName;
  if (prefill.locked.has('constitution') && prefill.values.constitution)
    next.constitution = prefill.values.constitution;
  if (prefill.locked.has('incorporationDate') && prefill.values.incorporationDate)
    next.incorporationDate = prefill.values.incorporationDate;
  if (prefill.locked.has('category') && prefill.values.category)
    next.category = prefill.values.category;
  if (prefill.locked.has('registered') && prefill.values.registered)
    next.registered = { ...prefill.values.registered };
  return next;
}
