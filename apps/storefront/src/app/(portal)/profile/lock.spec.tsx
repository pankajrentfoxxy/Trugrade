/**
 * The cards open one after another.
 *
 * A card is locked until every card before it is saved, and it says which
 * card opens it. The one open card carries the one primary action; a locked
 * card keeps a reachable, reason-disabled button rather than none, so a
 * screen reader can learn why. A card that is itself done is never locked.
 */
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { ToastProvider } from '@trugrade/ui';
import type { SessionView } from '../../register/api';
import { PortalContext, type PortalState } from '../shell/PortalContext';
import { ProfileHub } from './ProfileHub';
import { PROFILE_SECTIONS, sectionIsLocked, sectionUnlockedBy } from './sections.config';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/profile',
}));

const section = (id: string) => PROFILE_SECTIONS.find((s) => s.id === id)!;

const STEPS = ['ACCOUNT', 'STATUTORY', 'BUSINESS_PROFILE', 'CONTACTS_ADDRESSES', 'DOCUMENTS'];

const session = (over: Partial<SessionView> = {}): SessionView => ({
  userId: 'u1',
  orgId: 'o1',
  orgType: 'BUYER',
  roles: ['CUSTOMER_OWNER'],
  permissions: ['identity.user.write'],
  mfaRequired: false,
  fullName: 'Raman Kumar',
  email: 'raman@yopmail.com',
  mobile: '+919876543210',
  ...over,
});

const onboarding = (complete: readonly string[]): ResumableOnboarding =>
  ({
    orgId: 'o1',
    status: 'REGISTERED',
    slaDueAt: null,
    slaBreached: false,
    decision: null,
    editable: true,
    progress: {
      constitution: null,
      steps: STEPS.map((stepCode) => ({
        stepCode,
        status: complete.includes(stepCode) ? 'COMPLETE' : 'NOT_STARTED',
        isRequired: true,
        blockingReason: null,
      })),
      resumeAt: null,
      completedSteps: complete.length,
      requiredSteps: 5,
      isSubmittable: false,
    },
    answers: {},
  }) as unknown as ResumableOnboarding;

function renderHub(state: ResumableOnboarding, who: SessionView = session()) {
  const portal = {
    session: who,
    profile: null,
    onboarding: state,
    readiness: null,
    reload: jest.fn(),
    setSession: jest.fn(),
  } as unknown as PortalState;
  return render(
    <PortalContext.Provider value={portal}>
      <ToastProvider>
        <ProfileHub />
      </ToastProvider>
    </PortalContext.Provider>,
  );
}

describe('sectionIsLocked', () => {
  it('opens only the first card when nothing is saved', () => {
    const state = onboarding([]);
    const who = session({ fullName: '', email: undefined });
    expect(sectionIsLocked(section('account'), state, who)).toBe(false);
    expect(sectionIsLocked(section('tax'), state, who)).toBe(true);
    expect(sectionIsLocked(section('delivery'), state, who)).toBe(true);
    expect(sectionIsLocked(section('preferences'), state, who)).toBe(true);
  });

  it('unlocks the next card the moment the one before it is done', () => {
    const state = onboarding(['ACCOUNT']);
    expect(sectionIsLocked(section('tax'), state, session())).toBe(false);
    expect(sectionIsLocked(section('delivery'), state, session())).toBe(true);
  });

  it('names the first unfinished card before it, not merely the previous one', () => {
    const state = onboarding(['ACCOUNT']);
    expect(sectionUnlockedBy(section('preferences'), state, session())?.id).toBe('tax');
    expect(sectionUnlockedBy(section('tax'), state, session())).toBeNull();
  });

  it('never locks a card that is already done', () => {
    // Delivery saved before the account was completed, which a sent-back
    // Account card can produce. What the buyer saved stays reachable.
    const state = onboarding(['CONTACTS_ADDRESSES']);
    const who = session({ fullName: '', email: undefined });
    expect(sectionIsLocked(section('delivery'), state, who)).toBe(false);
  });
});

describe('the hub with nothing saved', () => {
  it('offers Fill now on the first card only, and holds the rest locked with a reason', () => {
    renderHub(onboarding([]), session({ fullName: '', email: undefined }));
    expect(screen.getAllByRole('button', { name: 'Fill now' })).toHaveLength(1);
    const locked = screen.getAllByRole('button', { name: 'Locked' });
    expect(locked).toHaveLength(PROFILE_SECTIONS.length - 1);
    for (const button of locked) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      // Reachable by keyboard: aria-disabled, never the disabled attribute.
      expect(button).not.toBeDisabled();
    }
    expect(locked[0]).toHaveAttribute('title', 'Save the Account card first. This card opens after it.');
  });

  it('says on each locked card which card opens it', () => {
    renderHub(onboarding([]), session({ fullName: '', email: undefined }));
    expect(
      screen.getAllByText('Save the Account card first. This card opens after it.'),
    ).toHaveLength(PROFILE_SECTIONS.length - 1);
    expect(screen.getAllByText('Locked')).toHaveLength((PROFILE_SECTIONS.length - 1) * 2);
  });
});

describe('the hub part way through', () => {
  it('moves Fill now to the next card once the one before it is done', () => {
    renderHub(onboarding(['ACCOUNT']));
    const cards = screen.getAllByRole('article');
    expect(cards[0]).toHaveAttribute('data-done', 'true');
    expect(cards[0]).toHaveAttribute('data-locked', 'false');
    expect(cards[1]).toHaveAttribute('data-locked', 'false');
    expect(cards[2]).toHaveAttribute('data-locked', 'true');
    expect(cards[3]).toHaveAttribute('data-locked', 'true');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Fill now' })).toHaveLength(1);
    expect(screen.getAllByText('Save the Tax and billing card first. This card opens after it.')).toHaveLength(2);
  });

  it('locks nothing once every card before the last is done', () => {
    renderHub(onboarding(['ACCOUNT', 'STATUTORY', 'BUSINESS_PROFILE', 'CONTACTS_ADDRESSES']));
    expect(screen.queryByRole('button', { name: 'Locked' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Fill now' })).toHaveLength(1);
  });
});
