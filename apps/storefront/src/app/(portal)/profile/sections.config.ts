import type { ResumableOnboarding } from '@trugrade/contracts';
import type { SessionView } from '../../register/api';

/**
 * The buyer profile, as cards.
 *
 * **Four cards, and only three of them are ever a gate.** The five seeded BUYER
 * steps are still what the server counts, but they no longer map one-to-one
 * onto screens: a buyer should be asked for a thing at the moment it is needed,
 * not at the moment it is convenient to collect.
 *
 * - `account` — who you are. One step.
 * - `tax` — the GSTIN, and the billing address the portal returns for it.
 *   Completes STATUTORY and BUSINESS_PROFILE: the legal name, trade name,
 *   constitution and year all arrive with the verified GSTIN, so there is
 *   nothing left on a Company card worth asking for. Headcount and annual
 *   volume are pricing-desk inputs and are asked once, after the first order.
 * - `delivery` — one site, and who signs for it. Completes CONTACTS_ADDRESSES.
 * - `preferences` — **weight 0, never a gate.** Every buyer document is
 *   optional (`BUYER_DOCUMENTS`), so a fifth of the old score measured one
 *   button press.
 *
 * The weights sum to 100 across the gating cards, so "100%" means one thing:
 * this buyer can be invoiced and delivered to.
 *
 * `account` is the one card that does not read its state off a step alone: the
 * mobile-only sign-up creates the owner with no name and no email, and those
 * live on the user, not in a step draft.
 */

export type ProfileSectionId = 'account' | 'tax' | 'delivery' | 'preferences';

export interface ProfileSectionDef {
  id: ProfileSectionId;
  title: string;
  blurb: string;
  weight: number;
  /** Every server step this card is responsible for completing. */
  stepCodes: readonly string[];
}

export const PROFILE_SECTIONS: readonly ProfileSectionDef[] = [
  {
    id: 'account',
    title: 'Account',
    blurb: 'Your name and a verified work email',
    weight: 30,
    stepCodes: ['ACCOUNT'],
  },
  {
    id: 'tax',
    title: 'Tax and billing',
    blurb: 'Your GSTIN, and the address it bills',
    weight: 30,
    stepCodes: ['STATUTORY', 'BUSINESS_PROFILE'],
  },
  {
    id: 'delivery',
    title: 'Delivery',
    blurb: 'Where machines go, and who signs',
    weight: 40,
    stepCodes: ['CONTACTS_ADDRESSES'],
  },
  {
    id: 'preferences',
    title: 'Preferences',
    blurb: 'Documents, purchase orders, how we reach you',
    weight: 0,
    stepCodes: ['DOCUMENTS'],
  },
] as const;

/** The cards that decide the percentage. Preferences is not one of them. */
export const GATING_SECTIONS = PROFILE_SECTIONS.filter((s) => s.weight > 0);

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
  const everyStep = section.stepCodes.every((code) => stepDone(onboarding, code));
  if (section.id === 'account') return accountIsFilled(session) && everyStep;
  return everyStep;
}

export function profileCompletionPct(
  onboarding: ResumableOnboarding | null,
  session: SessionView | null,
): number {
  const earned = GATING_SECTIONS.reduce(
    (sum, section) => (sectionIsDone(section, onboarding, session) ? sum + section.weight : sum),
    0,
  );
  return Math.min(100, earned);
}

/**
 * The cards open in order: a card is locked until every card before it is
 * done, and unlocks the moment the one before it saves.
 *
 * The order is the order of `PROFILE_SECTIONS`, which is the order the flow
 * already walks — Account, then Tax and billing, then Delivery, then
 * Preferences. A card that is itself done is never locked, so nothing a buyer
 * has saved becomes unreachable if an earlier card is later sent back.
 */
export function sectionIsLocked(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding | null,
  session: SessionView | null,
): boolean {
  if (sectionIsDone(section, onboarding, session)) return false;
  const index = PROFILE_SECTIONS.findIndex((s) => s.id === section.id);
  return PROFILE_SECTIONS.slice(0, index).some((s) => !sectionIsDone(s, onboarding, session));
}

/**
 * The first unfinished card before this one — the card a buyer must save
 * next for this one to open. Null when this card is not locked.
 */
export function sectionUnlockedBy(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding | null,
  session: SessionView | null,
): ProfileSectionDef | null {
  if (!sectionIsLocked(section, onboarding, session)) return null;
  const index = PROFILE_SECTIONS.findIndex((s) => s.id === section.id);
  return PROFILE_SECTIONS.slice(0, index).find((s) => !sectionIsDone(s, onboarding, session)) ?? null;
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

/** The reviewer's note when any of a card's steps was sent back, verbatim. */
export function sectionBlockingReason(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding | null,
): string | null {
  for (const code of section.stepCodes) {
    const step = onboarding?.progress.steps.find((s) => s.stepCode === code);
    if (step?.status === 'NEEDS_FIX') return step.blockingReason ?? null;
  }
  return null;
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
    case 'tax': {
      const rows = answers.STATUTORY?.gstins;
      const first = Array.isArray(rows)
        ? (rows[0] as { gstin?: unknown } | undefined)?.gstin
        : undefined;
      if (typeof first === 'string' && first.length === 15) {
        const legal = answers.BUSINESS_PROFILE?.legalName;
        return typeof legal === 'string' && legal.trim() ? `${legal} · ${first}` : `GSTIN ${first}`;
      }
      return done ? 'Verified' : 'GSTIN not verified yet';
    }
    case 'delivery': {
      const delivery = answers.CONTACTS_ADDRESSES?.delivery;
      const first = Array.isArray(delivery)
        ? (delivery[0] as { label?: unknown; city?: unknown } | undefined)
        : undefined;
      if (first && typeof first.label === 'string' && first.label.trim()) {
        return typeof first.city === 'string' && first.city.trim()
          ? `${first.label} · ${first.city}`
          : first.label;
      }
      return done ? 'Saved' : 'No delivery site yet';
    }
    case 'preferences': {
      // Weightless in the completion figure, but the server requires the step
      // before it takes a submission — "optional" here sent buyers looking for
      // a submit button that could not appear yet.
      if (!done) return 'A minute of questions, needed before you can submit for review';
      const po = answers.DOCUMENTS?.poRequired === true;
      return po ? 'Purchase order number required on orders' : 'No purchase order number needed';
    }
    default:
      return '';
  }
}
