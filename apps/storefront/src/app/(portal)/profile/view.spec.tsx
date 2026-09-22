/**
 * A locked profile can still be read.
 *
 * Once verified, the hub drew four cards with no control on them: the one-line
 * summary was all a buyer could see of their own GSTIN, billing address or
 * delivery site. The View button opens the same saved answers the edit dialogs
 * load, as facts, with nothing that writes — and a fact nobody gave is
 * "Not given", never a blank row and never left out.
 */
import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { ToastProvider } from '@trugrade/ui';
import type { SessionView } from '../../register/api';
import { PortalContext, type PortalState } from '../shell/PortalContext';
import { ProfileHub } from './ProfileHub';
import { sectionFacts } from './SectionView';
import { PROFILE_SECTIONS } from './sections.config';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/profile',
}));

const section = (id: string) => PROFILE_SECTIONS.find((s) => s.id === id)!;

const session: SessionView = {
  userId: 'u1',
  orgId: 'o1',
  orgType: 'BUYER',
  roles: ['CUSTOMER_OWNER'],
  permissions: ['identity.user.write'],
  mfaRequired: false,
  fullName: 'Raman Kumar',
  email: 'raman@yopmail.com',
  mobile: '+919876543210',
};

const onboarding = (answers: ResumableOnboarding['answers']): ResumableOnboarding =>
  ({
    orgId: 'o1',
    status: 'VERIFIED',
    slaDueAt: null,
    slaBreached: false,
    decision: null,
    editable: false,
    progress: {
      constitution: null,
      steps: ['ACCOUNT', 'STATUTORY', 'BUSINESS_PROFILE', 'CONTACTS_ADDRESSES', 'DOCUMENTS'].map(
        (stepCode) => ({ stepCode, status: 'COMPLETE', isRequired: true, blockingReason: null }),
      ),
      resumeAt: null,
      completedSteps: 5,
      requiredSteps: 5,
      isSubmittable: false,
    },
    answers,
    payoutAccount: null,
  }) as unknown as ResumableOnboarding;

const ANSWERS: ResumableOnboarding['answers'] = {
  STATUTORY: { gstins: [{ gstin: '08AACFC6777E1ZC', isPrimary: true }] },
  BUSINESS_PROFILE: {
    legalName: 'CHOUDHARY EXPORTS',
    tradeName: 'Choudhary',
    constitution: 'PARTNERSHIP',
    yearEstablished: '2014',
  },
  CONTACTS_ADDRESSES: {
    billing: [{ line1: 'Plot 4', line2: 'Sector 9', city: 'Jaipur', state: '08', pincode: '302001' }],
    delivery: [
      {
        label: 'Rajasthan warehouse',
        line1: 'Khasra 12',
        city: 'Amarpura',
        state: '08',
        pincode: '303001',
        contactName: 'Raman Kumar',
        contactMobile: '+919876543210',
        days: 'MON_SAT',
        opensAt: '10:00',
        closesAt: '18:00',
      },
    ],
  },
  DOCUMENTS: { poRequired: true, channels: ['EMAIL', 'WHATSAPP'], language: 'en' },
};

const state = (o: ResumableOnboarding): PortalState => ({
  session,
  profile: null,
  onboarding: o,
  readiness: null,
  orgVerified: true,
  approvalsWaiting: 0,
  approvals: [],
  reload: jest.fn(),
  setSession: jest.fn(),
});

const hub = (o: ResumableOnboarding) =>
  render(
    <ToastProvider>
      <PortalContext.Provider value={state(o)}>
        <ProfileHub />
      </PortalContext.Provider>
    </ToastProvider>,
  );

describe('sectionFacts', () => {
  it('reads the tax card from the same answers the form wrote', () => {
    const facts = sectionFacts(section('tax'), onboarding(ANSWERS), session);
    expect(facts.map((f) => [f.label, f.value])).toEqual([
      ['GSTIN', '08AACFC6777E1ZC'],
      ['Legal name', 'CHOUDHARY EXPORTS'],
      ['Trading as', 'Choudhary'],
      ['Constitution', 'PARTNERSHIP'],
      ['Registered in', '2014'],
      ['State of registration', 'Rajasthan'],
      ['Billing address', 'Plot 4, Sector 9'],
      ['Billing city', 'Jaipur'],
      ['Billing state', 'Rajasthan'],
      ['Billing PIN code', '302001'],
    ]);
    // Identifiers and numbers are mono; names are not.
    expect(facts.find((f) => f.label === 'GSTIN')?.mono).toBe(true);
    expect(facts.find((f) => f.label === 'Legal name')?.mono).toBeUndefined();
  });

  it('spells the receiving window the way the Delivery card does', () => {
    const facts = sectionFacts(section('delivery'), onboarding(ANSWERS), session);
    expect(facts.find((f) => f.label === 'Receiving hours')?.value).toBe('Mon–Sat 10:00–18:00');
    expect(facts.find((f) => f.label === 'State')?.value).toBe('Rajasthan');
  });

  it('keeps every row and says "Not given" where nothing was saved', () => {
    const facts = sectionFacts(section('delivery'), onboarding({}), session);
    expect(facts).toHaveLength(9);
    expect(facts.every((f) => f.value === null)).toBe(true);
  });
});

describe('the locked hub', () => {
  it('offers View on every card, and never Edit', () => {
    hub(onboarding(ANSWERS));
    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(PROFILE_SECTIONS.length);
    expect(screen.queryByRole('button', { name: /Edit|Fill now/ })).toBeNull();
  });

  it('opens the card as facts, with nothing that writes', () => {
    hub(onboarding(ANSWERS));
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1]!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Tax and billing' })).toBeInTheDocument();
    const facts = within(dialog).getByTestId('section-facts');
    expect(within(facts).getByText('08AACFC6777E1ZC')).toHaveClass('font-mono');
    expect(within(facts).getByText('CHOUDHARY EXPORTS')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Save/ })).toBeNull();
  });

  it('draws a missing value as "Not given" rather than a blank or a tick', () => {
    hub(onboarding({ ...ANSWERS, DOCUMENTS: {} }));
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[3]!);
    const facts = within(screen.getByRole('dialog')).getByTestId('section-facts');
    expect(within(facts).getAllByText('Not given').length).toBeGreaterThan(0);
    expect(within(facts).queryByText('✓')).toBeNull();
  });
});
