import type { ResumableOnboarding } from '@trugrade/contracts';
import type { SessionView } from '../../register/api';

/**
 * The buyer profile, as cards.
 *
 * Each card is one of the seeded BUYER onboarding steps — the same five the
 * old `/register` wizard walked through, now filled in whenever suits from the
 * portal. The weights sum to exactly 100 across the required cards, so "100%"
 * means one thing: every step is complete and the profile can be submitted.
 *
 * `account` is the one card that does not read its state off a step: the
 * mobile-only sign-up creates the owner with no name and no email, and those
 * live on the user, not in a step draft. It is done when both are on the
 * session, and the ACCOUNT step is completed at the same moment so the
 * server's `isSubmittable` agrees with the screen.
 */

export type ProfileSectionId = 'account' | 'statutory' | 'company' | 'contacts' | 'documents';

export interface ProfileSectionDef {
  id: ProfileSectionId;
  title: string;
  blurb: string;
  weight: number;
  stepCode: string;
}

export const PROFILE_SECTIONS: readonly ProfileSectionDef[] = [
  {
    id: 'account',
    title: 'Account',
    blurb: 'Your name and a verified work email',
    weight: 10,
    stepCode: 'ACCOUNT',
  },
  {
    id: 'statutory',
    title: 'Statutory',
    blurb: 'GSTIN and PAN, verified with the portal',
    weight: 25,
    stepCode: 'STATUTORY',
  },
  {
    id: 'company',
    title: 'Company',
    blurb: 'Legal name as it appears on the invoice',
    weight: 20,
    stepCode: 'BUSINESS_PROFILE',
  },
  {
    id: 'contacts',
    title: 'Contacts and delivery',
    blurb: 'Who signs for machines, and where',
    weight: 25,
    stepCode: 'CONTACTS_ADDRESSES',
  },
  {
    id: 'documents',
    title: 'Documents and preferences',
    blurb: 'GST certificate, PAN, and how we reach you',
    weight: 20,
    stepCode: 'DOCUMENTS',
  },
] as const;

const stepDone = (onboarding: ResumableOnboarding | null, code: string): boolean =>
  onboarding?.progress.steps.find((s) => s.stepCode === code)?.status === 'COMPLETE';

/** Name and email, both present. The mobile was proved at sign-in. */
export const accountIsFilled = (session: SessionView | null): boolean =>
  Boolean(session?.fullName?.trim()) && Boolean(session?.email);

export function sectionIsDone(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding | null,
  session: SessionView | null,
): boolean {
  if (section.id === 'account') {
    return accountIsFilled(session) && stepDone(onboarding, section.stepCode);
  }
  return stepDone(onboarding, section.stepCode);
}

export function profileCompletionPct(
  onboarding: ResumableOnboarding | null,
  session: SessionView | null,
): number {
  const earned = PROFILE_SECTIONS.reduce(
    (sum, section) => (sectionIsDone(section, onboarding, session) ? sum + section.weight : sum),
    0,
  );
  return Math.min(100, earned);
}

export function nextIncompleteSection(
  after: ProfileSectionId | null,
  onboarding: ResumableOnboarding | null,
  session: SessionView | null,
): ProfileSectionDef | null {
  const start = after ? PROFILE_SECTIONS.findIndex((s) => s.id === after) + 1 : 0;
  for (let i = start; i < PROFILE_SECTIONS.length; i += 1) {
    const section = PROFILE_SECTIONS[i]!;
    if (!sectionIsDone(section, onboarding, session)) return section;
  }
  return null;
}

/** The reviewer's note when a step was sent back, verbatim. */
export function sectionBlockingReason(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding | null,
): string | null {
  const step = onboarding?.progress.steps.find((s) => s.stepCode === section.stepCode);
  return step?.status === 'NEEDS_FIX' ? (step.blockingReason ?? null) : null;
}

/**
 * The one-line state of each card. Read off what was saved, never invented:
 * a card with nothing saved says so rather than describing a default.
 */
export function sectionSummary(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding | null,
  session: SessionView | null,
): string {
  const answers = onboarding?.answers ?? {};
  const done = sectionIsDone(section, onboarding, session);
  switch (section.id) {
    case 'account': {
      const name = session?.fullName?.trim();
      const email = session?.email;
      if (name && email) return `${name} · ${email}`;
      if (name) return `${name} · work email not verified yet`;
      if (email) return `${email} · name not given yet`;
      return 'Name and work email not given yet';
    }
    case 'statutory': {
      const rows = answers.STATUTORY?.gstins;
      const first = Array.isArray(rows)
        ? (rows[0] as { gstin?: unknown } | undefined)?.gstin
        : undefined;
      if (typeof first === 'string' && first.length === 15) return `GSTIN ${first}`;
      return done ? 'Verified' : 'GSTIN not verified yet';
    }
    case 'company': {
      const legal = answers.BUSINESS_PROFILE?.legalName;
      if (typeof legal === 'string' && legal.trim()) return legal;
      return done ? 'Saved' : 'Company details not given yet';
    }
    case 'contacts': {
      const delivery = answers.CONTACTS_ADDRESSES?.delivery;
      if (Array.isArray(delivery) && delivery.length > 0) {
        return `${delivery.length} delivery ${delivery.length === 1 ? 'site' : 'sites'}`;
      }
      return done ? 'Saved' : 'No delivery site yet';
    }
    case 'documents':
      return done ? 'Uploaded' : 'GST certificate and PAN not uploaded yet';
    default:
      return '';
  }
}
