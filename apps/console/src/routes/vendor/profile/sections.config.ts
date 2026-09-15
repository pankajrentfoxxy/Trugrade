import type { ResumableOnboarding } from '@trugrade/contracts';

export type ProfileSectionId =
  | 'account'
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

/**
 * One card per required server step, and no required server step without a card.
 *
 * The server decides `isSubmittable` from its own `onboarding_step_definition`
 * rows — for a vendor, seven required steps including ACCOUNT and CAPABILITY.
 * This list used to cover five and call "What you stock" recommended, so a
 * supplier reached "100% complete" with two server steps still open, the submit
 * button stayed hidden, and the application never reached the review queue.
 * The weights sum to 100 across the required cards so "100%" means submittable.
 */
export const PROFILE_SECTIONS: readonly ProfileSectionDef[] = [
  {
    id: 'account',
    title: 'Contact',
    blurb: 'The person we reach about this account',
    weight: 10,
    required: true,
    stepCodes: ['ACCOUNT'],
  },
  {
    id: 'business',
    title: 'Business & GST',
    blurb: 'Constitution and primary GSTIN',
    weight: 20,
    required: true,
    stepCodes: ['BUSINESS_PROFILE', 'STATUTORY'],
  },
  {
    id: 'pickup',
    title: 'Pickup address',
    blurb: 'Where we collect machines',
    weight: 15,
    required: true,
    stepCodes: ['FACILITY_CONTACTS'],
  },
  {
    id: 'bank',
    title: 'Bank account',
    blurb: 'Payout account with penny-drop',
    weight: 15,
    required: true,
    stepCodes: ['DOCUMENTS_BANK'],
  },
  {
    id: 'documents',
    title: 'Documents',
    blurb: 'GST certificate, PAN, cancelled cheque — all optional',
    weight: 15,
    required: true,
    stepCodes: ['DOCUMENTS_BANK'],
  },
  {
    id: 'stock',
    title: 'What you stock',
    blurb: 'Brands, volume and grades — routes enquiries to you',
    weight: 15,
    required: true,
    stepCodes: ['CAPABILITY'],
  },
  {
    id: 'agreement',
    title: 'Supplier agreement',
    blurb: 'Recorded acceptance, not e-sign',
    weight: 10,
    required: true,
    stepCodes: ['AGREEMENT'],
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
    case 'account': {
      if (!stepDone(onboarding, 'ACCOUNT')) return 'Not confirmed yet';
      const a = answers.ACCOUNT ?? {};
      const name = typeof a.fullName === 'string' && a.fullName ? a.fullName : null;
      const mobile = typeof a.mobile === 'string' && a.mobile ? a.mobile : null;
      if (!name) return 'Confirmed';
      return mobile ? `${name} · ${mobile}` : name;
    }
    case 'business': {
      const gst = answers.STATUTORY?.primaryGstin;
      const constitution = onboarding?.progress.constitution;
      if (typeof gst === 'string' && gst.length > 0)
        return `${constitution ?? 'Business'} · ${gst}`;
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
    case 'documents': {
      if (answers.DOCUMENTS_BANK?.documentsComplete !== true) return 'Uploads pending';
      // Counted, never assumed: the card can be saved with any number of the
      // three, and a summary that said "three" for a supplier who sent one
      // would be the first fabricated figure on their own profile.
      const uploaded = answers.DOCUMENTS_BANK.uploadedDocTypes;
      const count = Array.isArray(uploaded) ? uploaded.length : null;
      if (count === null) return 'Saved';
      if (count === 0) return 'No documents uploaded';
      return `${count} of 3 documents uploaded`;
    }
    case 'agreement':
      return answers.AGREEMENT?.acceptedName
        ? `Accepted by ${String(answers.AGREEMENT.acceptedName)}`
        : 'Not accepted yet';
    case 'stock': {
      const brands = answers.CAPABILITY?.brands;
      if (Array.isArray(brands) && brands.length > 0) {
        return `${brands.length} brand${brands.length === 1 ? '' : 's'} selected`;
      }
      return 'Brands and volume not given yet';
    }
    default:
      return '';
  }
}
