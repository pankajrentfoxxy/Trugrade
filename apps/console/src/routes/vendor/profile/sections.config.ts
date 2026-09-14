import type { ResumableOnboarding } from '@trugrade/contracts';

export type ProfileSectionId =
  | 'business'
  | 'pickup'
  | 'bank'
  | 'documents'
  | 'agreement'
  | 'stock';

export interface ProfileSectionDef {
  id: ProfileSectionId;
  title: string;
  blurb: string;
  weight: number;
  required: boolean;
  stepCodes: readonly string[];
}

export const PROFILE_SECTIONS: readonly ProfileSectionDef[] = [
  {
    id: 'business',
    title: 'Business & GST',
    blurb: 'Constitution and primary GSTIN',
    weight: 25,
    required: true,
    stepCodes: ['BUSINESS_PROFILE', 'STATUTORY'],
  },
  {
    id: 'pickup',
    title: 'Pickup address',
    blurb: 'Where we collect machines',
    weight: 20,
    required: true,
    stepCodes: ['FACILITY_CONTACTS'],
  },
  {
    id: 'bank',
    title: 'Bank account',
    blurb: 'Payout account with penny-drop',
    weight: 20,
    required: true,
    stepCodes: ['DOCUMENTS_BANK'],
  },
  {
    id: 'documents',
    title: 'Documents',
    blurb: 'GST certificate, PAN, cancelled cheque',
    weight: 25,
    required: true,
    stepCodes: ['DOCUMENTS_BANK'],
  },
  {
    id: 'agreement',
    title: 'Supplier agreement',
    blurb: 'Recorded acceptance, not e-sign',
    weight: 10,
    required: true,
    stepCodes: ['AGREEMENT'],
  },
  {
    id: 'stock',
    title: 'What you stock',
    blurb: 'Brands, volume and grades',
    weight: 0,
    required: false,
    stepCodes: ['CAPABILITY'],
  },
] as const;

const stepDone = (onboarding: ResumableOnboarding | undefined, code: string): boolean => {
  const step = onboarding?.progress.steps.find((s) => s.stepCode === code);
  return step?.status === 'COMPLETE';
};

export function sectionIsDone(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding | undefined,
  extras?: Partial<Record<ProfileSectionId, boolean>>,
): boolean {
  if (extras?.[section.id]) return true;
  if (section.id === 'bank') {
    const answers = onboarding?.answers.DOCUMENTS_BANK ?? {};
    return Boolean(answers.bankCommitted === true) || stepDone(onboarding, 'DOCUMENTS_BANK');
  }
  if (section.id === 'documents') {
    const answers = onboarding?.answers.DOCUMENTS_BANK ?? {};
    return answers.documentsComplete === true || stepDone(onboarding, 'DOCUMENTS_BANK');
  }
  return section.stepCodes.every((code) => stepDone(onboarding, code));
}

export function profileCompletionPct(
  onboarding: ResumableOnboarding | undefined,
  extras?: Partial<Record<ProfileSectionId, boolean>>,
): number {
  const required = PROFILE_SECTIONS.filter((s) => s.required);
  if (required.length === 0) return 0;
  const earned = required.reduce((sum, section) => {
    if (sectionIsDone(section, onboarding, extras)) return sum + section.weight;
    return sum;
  }, 0);
  return Math.min(100, earned);
}

export function nextIncompleteSection(
  after: ProfileSectionId | null,
  onboarding: ResumableOnboarding | undefined,
  extras?: Partial<Record<ProfileSectionId, boolean>>,
): ProfileSectionDef | null {
  const ordered = PROFILE_SECTIONS.filter((s) => s.required);
  const start = after ? ordered.findIndex((s) => s.id === after) + 1 : 0;
  for (let i = start; i < ordered.length; i += 1) {
    const section = ordered[i]!;
    if (!sectionIsDone(section, onboarding, extras)) return section;
  }
  return null;
}

export function sectionSummary(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding | undefined,
): string {
  const answers = onboarding?.answers ?? {};
  switch (section.id) {
    case 'business': {
      const gst = answers.STATUTORY?.primaryGstin;
      const constitution = onboarding?.progress.constitution;
      if (typeof gst === 'string' && gst.length > 0) return `${constitution ?? 'Business'} · ${gst}`;
      return constitution ? String(constitution).replace(/_/g, ' ') : 'Not started';
    }
    case 'pickup': {
      const fac = (answers.FACILITY_CONTACTS?.facilities as unknown[])?.[0] as
        | { address?: { city?: string; pincode?: string } }
        | undefined;
      if (fac?.address?.pincode) return `${fac.address.city ?? 'City'} · ${fac.address.pincode}`;
      return 'Pickup site not set';
    }
    case 'bank':
      return answers.DOCUMENTS_BANK?.bankCommitted === true
        ? 'Payout account verified'
        : 'Account not verified';
    case 'documents':
      return answers.DOCUMENTS_BANK?.documentsComplete === true
        ? 'Three documents uploaded'
        : 'Uploads pending';
    case 'agreement':
      return answers.AGREEMENT?.acceptedName
        ? `Accepted by ${String(answers.AGREEMENT.acceptedName)}`
        : 'Not accepted yet';
    case 'stock': {
      const brands = answers.CAPABILITY?.brands;
      if (Array.isArray(brands) && brands.length > 0) {
        return `${brands.length} brand${brands.length === 1 ? '' : 's'} selected`;
      }
      return 'Optional — helps us route enquiries';
    }
    default:
      return '';
  }
}
