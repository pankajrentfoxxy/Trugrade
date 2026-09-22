/**
 * The submit control, at the moment the banner reads 100%.
 *
 * Preferences carries no weight in the completion figure, so a profile reads
 * 100% the moment Delivery is saved — while the server still requires the
 * DOCUMENTS step behind Preferences before it will take a submission. The
 * control used to render nothing for that state: a full bar, no button, and
 * nothing saying why. Now it names the card.
 */
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ResumableOnboarding } from '@trugrade/contracts';
import type { SessionView } from '../../register/api';
import { PortalContext, type PortalState } from '../shell/PortalContext';
import { SubmitForReview, outstandingSection, submitStage } from './SubmitForReview';

const OWNER = ['CUSTOMER_OWNER'];
const CODES = ['ACCOUNT', 'STATUTORY', 'BUSINESS_PROFILE', 'CONTACTS_ADDRESSES', 'DOCUMENTS'];

const onboarding = (incomplete: readonly string[], status = 'REGISTERED'): ResumableOnboarding =>
  ({
    orgId: 'o1',
    status,
    slaDueAt: null,
    slaBreached: false,
    decision: null,
    editable: true,
    progress: {
      constitution: null,
      steps: CODES.map((stepCode) => ({
        stepCode,
        status: incomplete.includes(stepCode) ? 'NOT_STARTED' : 'COMPLETE',
        isRequired: true,
        blockingReason: null,
      })),
      resumeAt: incomplete[0] ?? null,
      completedSteps: CODES.length - incomplete.length,
      requiredSteps: CODES.length,
      isSubmittable: incomplete.length === 0,
    },
    answers: {},
    payoutAccount: null,
  }) as unknown as ResumableOnboarding;

describe('submitStage', () => {
  it('names the card the server is waiting on once every weighted card is done', () => {
    // Delivery saved, Preferences not: the banner says 100%, the server says no.
    expect(submitStage(onboarding(['DOCUMENTS']), OWNER)).toBe('waiting-on');
    expect(outstandingSection(onboarding(['DOCUMENTS']))?.title).toBe('Preferences');
  });

  it('stays hidden while a weighted card is still open, because that card says what is left', () => {
    expect(submitStage(onboarding(['CONTACTS_ADDRESSES', 'DOCUMENTS']), OWNER)).toBe('hidden');
  });

  it('is ready the moment the server says so', () => {
    expect(submitStage(onboarding([]), OWNER)).toBe('ready');
    expect(submitStage(onboarding([]), ['CUSTOMER_BUYER'])).toBe('ask-owner');
  });

  it('never asks a verified or refused organisation for another card', () => {
    expect(submitStage(onboarding(['DOCUMENTS'], 'VERIFIED'), OWNER)).toBe('hidden');
    expect(submitStage(onboarding(['DOCUMENTS'], 'REJECTED'), OWNER)).toBe('hidden');
  });
});

describe('SubmitForReview', () => {
  const session: SessionView = {
    userId: 'u1',
    orgId: 'o1',
    orgType: 'BUYER',
    roles: ['CUSTOMER_OWNER'],
    permissions: [],
    mfaRequired: false,
    fullName: 'Raman Kumar',
    email: 'raman@yopmail.com',
    mobile: '+919876543210',
  };
  const draw = (o: ResumableOnboarding) => {
    const state: PortalState = {
      session,
      profile: null,
      onboarding: o,
      readiness: null,
      orgVerified: false,
      approvalsWaiting: 0,
      approvals: [],
      reload: jest.fn(),
      setSession: jest.fn(),
    };
    return render(
      <PortalContext.Provider value={state}>
        <SubmitForReview />
      </PortalContext.Provider>,
    );
  };

  it('says which card is outstanding instead of drawing nothing', () => {
    draw(onboarding(['DOCUMENTS']));
    expect(screen.getByTestId('submit-waiting-on')).toHaveTextContent(
      'One card to go before you can submit for review: Preferences.',
    );
    expect(screen.queryByRole('button', { name: /Submit for review/ })).toBeNull();
  });

  it('shows the button once the server says the profile is submittable', () => {
    draw(onboarding([]));
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
  });
});
