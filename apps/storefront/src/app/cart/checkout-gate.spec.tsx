/**
 * The cart's checkout button checks the profile before it goes anywhere.
 *
 * An unfinished profile is sent to `/profile` with the reason; a finished
 * one, a signed-out visitor and a seat that may not read onboarding all go on
 * to checkout, where the server makes the call it always made.
 */
import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CheckoutGate } from './CheckoutGate';

const navigate = jest.fn();

jest.mock('../register/api', () => ({
  ...jest.requireActual('../register/api'),
  getSession: jest.fn(),
  getOnboarding: jest.fn(),
}));

import { getOnboarding, getSession } from '../register/api';

const mockSession = getSession as jest.MockedFunction<typeof getSession>;
const mockOnboarding = getOnboarding as jest.MockedFunction<typeof getOnboarding>;

const session = (fullName: string, email: string | undefined) => ({
  ok: true as const,
  data: {
    userId: 'u1',
    orgId: 'o1',
    orgType: 'BUYER' as const,
    roles: ['CUSTOMER_OWNER'],
    permissions: [],
    mfaRequired: false,
    fullName,
    ...(email ? { email } : {}),
    mobile: '+919876543210',
  },
});

const onboarding = (statuses: Record<string, 'COMPLETE' | 'NOT_STARTED'>) => ({
  ok: true as const,
  data: {
    orgId: 'o1',
    status: 'REGISTERED',
    slaDueAt: null,
    slaBreached: false,
    decision: null,
    progress: {
      constitution: null,
      steps: Object.entries(statuses).map(([stepCode, status], i) => ({
        stepCode,
        status,
        stepOrder: i + 1,
        title: stepCode,
        purposeNote: '',
        estimatedMinutes: 1,
        isRequired: true,
        completionPct: status === 'COMPLETE' ? 100 : 0,
        blockingReason: null,
        lastSavedAt: null,
        fields: [],
      })),
      resumeAt: null,
      completedSteps: 0,
      requiredSteps: 5,
      isSubmittable: false,
    },
    answers: {},
  },
});

const ALL_DONE = {
  ACCOUNT: 'COMPLETE',
  STATUTORY: 'COMPLETE',
  BUSINESS_PROFILE: 'COMPLETE',
  CONTACTS_ADDRESSES: 'COMPLETE',
  DOCUMENTS: 'COMPLETE',
} as const;

const refusal = (status: number) => ({
  ok: false as const,
  status,
  code: 'X',
  message: 'no',
  fields: {},
  retryAfterSeconds: null,
});

beforeEach(() => {
  navigate.mockReset();
  mockSession.mockReset();
  mockOnboarding.mockReset();
});

const click = async (): Promise<void> => {
  render(<CheckoutGate cartId="c1" navigate={navigate} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('link', { name: 'Continue to checkout' }));
  });
};

it('sends an unfinished profile to the profile page, with the reason', async () => {
  mockSession.mockResolvedValue(session('Priya', undefined) as never);
  mockOnboarding.mockResolvedValue(onboarding({ ...ALL_DONE, DOCUMENTS: 'NOT_STARTED' }) as never);
  await click();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith('/profile?reason=checkout');
});

it('lets a finished profile through to checkout', async () => {
  mockSession.mockResolvedValue(session('Priya', 'p@acme.example') as never);
  mockOnboarding.mockResolvedValue(onboarding(ALL_DONE) as never);
  await click();
  expect(navigate).toHaveBeenCalledWith('/checkout?cart=c1');
  expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/profile'));
});

it('lets a signed-out visitor and a seat that cannot read onboarding through', async () => {
  mockSession.mockResolvedValue(refusal(401) as never);
  await click();
  expect(navigate).toHaveBeenLastCalledWith('/checkout?cart=c1');

  mockSession.mockResolvedValue(session('Farah', 'f@acme.example') as never);
  mockOnboarding.mockResolvedValue(refusal(403) as never);
  await click();
  expect(navigate).toHaveBeenLastCalledWith('/checkout?cart=c1');
  expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/profile'));
});
