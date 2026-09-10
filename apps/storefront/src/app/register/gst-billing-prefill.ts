import type { GstinTaxpayer, VerificationOutcomeView } from './api';
import type { BillingAddress } from './StepContacts';

interface GstinDraftRow {
  gstin?: string;
  outcome?: VerificationOutcomeView | null;
}

const asBillingAddress = (
  gstin: string,
  address: GstinTaxpayer['registeredAddress'],
): Partial<BillingAddress> | undefined => {
  if (!address) return undefined;
  if (!address.line1 && !address.city && !address.pincode) return undefined;
  return {
    gstin,
    line1: address.line1,
    line2: address.line2 ?? '',
    city: address.city,
    state: address.state || gstin.slice(0, 2),
    pincode: address.pincode,
  };
};

/** Verified GSTIN → billing address from the portal's registered office. */
export function prefillBillingFromVerifiedGst(
  statutory: Record<string, unknown> | undefined,
): Map<string, Partial<BillingAddress>> {
  const result = new Map<string, Partial<BillingAddress>>();
  if (!statutory) return result;
  const rows = statutory.gstins;
  if (!Array.isArray(rows)) return result;

  for (const row of rows as GstinDraftRow[]) {
    if (typeof row.gstin !== 'string' || row.gstin.length !== 15) continue;
    if (row.outcome?.outcome !== 'PASS' || !row.outcome.resolved) continue;
    const taxpayer = row.outcome.resolved as GstinTaxpayer;
    const partial = asBillingAddress(row.gstin, taxpayer.registeredAddress);
    if (partial) result.set(row.gstin, partial);
  }
  return result;
}

const postalEmpty = (row: BillingAddress): boolean =>
  !row.line1.trim() && !row.pincode.trim() && !row.city.trim();

/** Empty, or a state that cannot match the registration that issued this GSTIN. */
const needsGstPrefill = (row: BillingAddress): boolean => {
  if (postalEmpty(row)) return true;
  if (row.gstin.length >= 2) return row.state !== row.gstin.slice(0, 2);
  return false;
};

/** Fill billing rows from verified GSTIN addresses when empty or state-mismatched. */
export function mergeBillingGstPrefill(
  billing: BillingAddress[],
  prefill: Map<string, Partial<BillingAddress>>,
): BillingAddress[] {
  if (prefill.size === 0) return billing;
  return billing.map((row) => {
    const fromGst = prefill.get(row.gstin);
    if (!fromGst || !needsGstPrefill(row)) return row;
    return { ...row, ...fromGst, gstin: row.gstin };
  });
}
