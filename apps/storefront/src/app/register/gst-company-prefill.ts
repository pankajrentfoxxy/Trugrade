import type { GstinTaxpayer, VerificationOutcomeView } from './api';
import type { CompanyValues } from './StepCompany';

export interface CompanyGstPrefill {
  values: Partial<CompanyValues>;
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

const yearFromRegistrationDate = (value: string): string | undefined => {
  const trimmed = value.trim();
  const iso = /^(\d{4})-\d{2}-\d{2}$/.exec(trimmed);
  if (iso) return iso[1];
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (dmy) return dmy[3];
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  return undefined;
};

/** Constitution from the primary verified GSTIN — used on statutory before company is filled. */
export function constitutionFromVerifiedGst(
  statutory: Record<string, unknown> | undefined,
): string | null {
  const outcome = verifiedPrimaryOutcome(statutory);
  if (!outcome?.resolved) return null;
  const taxpayer = outcome.resolved as GstinTaxpayer;
  return taxpayer.constitutionType ?? null;
}

/** Company step values and lock set from the primary verified GSTIN on step 2. */
export function prefillCompanyFromVerifiedGst(
  statutory: Record<string, unknown> | undefined,
): CompanyGstPrefill | null {
  const outcome = verifiedPrimaryOutcome(statutory);
  if (!outcome?.resolved) return null;

  const taxpayer = outcome.resolved as GstinTaxpayer;
  const values: Partial<CompanyValues> = {};
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
    const year = yearFromRegistrationDate(taxpayer.registrationDate);
    if (year) {
      values.yearEstablished = year;
      locked.add('yearEstablished');
    }
  }

  if (locked.size === 0) return null;
  return { values, locked };
}

export function mergeCompanyGstPrefill(
  current: CompanyValues,
  prefill: CompanyGstPrefill,
): CompanyValues {
  const next = { ...current };
  if (prefill.locked.has('legalName') && prefill.values.legalName)
    next.legalName = prefill.values.legalName;
  if (prefill.locked.has('tradeName') && prefill.values.tradeName)
    next.tradeName = prefill.values.tradeName;
  if (prefill.locked.has('constitution') && prefill.values.constitution)
    next.constitution = prefill.values.constitution;
  if (prefill.locked.has('yearEstablished') && prefill.values.yearEstablished)
    next.yearEstablished = prefill.values.yearEstablished;
  return next;
}
