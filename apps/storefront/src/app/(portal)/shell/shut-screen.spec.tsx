/**
 * A route the rail shows shut is shut.
 *
 * The rail dimmed four entries for an unverified organisation and one for a
 * viewer, and swallowed the click. The URL bar did not: `/orders` typed by
 * hand rendered the board. These pin the two halves of the fix — the frame
 * asks the rail's own `lockOn` for the screen at this path, and what it draws
 * in place of the page says why, in the sentence the situation calls for.
 */
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { PortalState } from './PortalContext';
import { PortalContext } from './PortalContext';
import { PORTAL_NAV } from './nav';
import { ShutScreen, screenLock } from './ShutScreen';

const entry = (label: string) => PORTAL_NAV.find((n) => n.label === label)!;

const STATE: PortalState = {
  session: {
    userId: 'u1',
    orgId: 'o1',
    orgType: 'BUYER',
    roles: ['CUSTOMER_OWNER'],
    permissions: ['ordering.own.read', 'identity.user.read'],
    mfaRequired: false,
    fullName: 'Deepak Verma',
    email: 'owner@acme.example',
    mobile: '+919876543210',
  },
  profile: null,
  orgVerified: false,
  approvalsWaiting: 0,
  approvals: [],
  readiness: {
    orgStatus: 'REGISTERED',
    suspended: false,
    prepaid: false,
    credit: false,
    missing: ['your GSTIN', 'a delivery address'],
    blockedReason:
      'Before your first order we need your GSTIN and a delivery address. It takes a couple of minutes on your profile.',
  },
  onboarding: {
    orgId: 'o1',
    status: 'REGISTERED',
    slaDueAt: null,
    slaBreached: false,
    decision: null,
    editable: true,
    progress: {
      constitution: null,
      steps: [],
      resumeAt: null,
      completedSteps: 0,
      requiredSteps: 5,
      isSubmittable: false,
    },
  } as unknown as PortalState['onboarding'],
  reload: jest.fn(),
  setSession: jest.fn(),
};

const draw = (over: Partial<PortalState>, label: string): void => {
  const state = { ...STATE, ...over };
  const e = entry(label);
  const lock = screenLock(e, { permissions: state.session.permissions, orgVerified: state.orgVerified });
  render(
    <PortalContext.Provider value={state}>
      {lock ? <ShutScreen entry={e} lock={lock} /> : <div data-testid="the-page" />}
    </PortalContext.Provider>,
  );
};

beforeEach(() => {
  (STATE.reload as jest.Mock).mockClear();
});

describe('the frame’s decision', () => {
  it('is the rail’s decision, for the entry at this path', () => {
    const seat = { permissions: STATE.session.permissions, orgVerified: false };
    expect(screenLock(entry('Orders'), seat)).toEqual({ kind: 'unverified' });
    expect(screenLock(entry('Profile'), seat)).toBeNull();
    // A path the rail does not own — the shop — is not the portal's to lock.
    expect(screenLock(undefined, seat)).toBeNull();
  });

  it('opens the screen the moment the organisation is verified', () => {
    draw({ orgVerified: true }, 'Orders');
    expect(screen.getByTestId('the-page')).toBeInTheDocument();
    expect(screen.queryByTestId('shut-screen')).not.toBeInTheDocument();
  });
});

describe('what an unverified organisation sees at /orders', () => {
  it('is the screen’s name, the wait, and the server’s own sentence', () => {
    draw({}, 'Orders');
    expect(screen.getByTestId('shut-screen')).toHaveAttribute('data-lock', 'unverified');
    expect(
      screen.getByText('Orders opens once we have verified your company details'),
    ).toBeInTheDocument();
    // The banner's sentence, verbatim, so the two cannot drift.
    expect(screen.getByText(STATE.readiness!.blockedReason!)).toBeInTheDocument();
  });

  it('gives an owner the way to the work, as a link under the banner’s primary', () => {
    draw({}, 'Orders');
    expect(screen.getByRole('link', { name: 'Finish your profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it('gives a buyer seat no control, because the profile is not theirs to finish', () => {
    draw({ session: { ...STATE.session, roles: ['CUSTOMER_BUYER'] } }, 'Orders');
    expect(screen.queryByRole('link', { name: 'Finish your profile' })).not.toBeInTheDocument();
  });

  it('says the profile is with us once it has been submitted', () => {
    draw(
      {
        onboarding: { ...STATE.onboarding!, status: 'PROFILE_SUBMITTED' } as PortalState['onboarding'],
      },
      'Orders',
    );
    expect(screen.getByText(/Your profile is with us for review/)).toBeInTheDocument();
    // Nothing the owner does now opens it sooner, so no control pretends otherwise.
    expect(screen.queryByRole('link', { name: 'Finish your profile' })).not.toBeInTheDocument();
  });

  it('never dresses a failed read up as a refusal', () => {
    draw({ readiness: null }, 'Orders');
    expect(screen.getByText('We could not read your account’s status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(STATE.reload).toHaveBeenCalledTimes(1);
  });
});

describe('what a viewer sees at /team', () => {
  it('names the seat, not a verification that would not open it anyway', () => {
    draw(
      { session: { ...STATE.session, roles: ['CUSTOMER_VIEWER'], permissions: ['ordering.own.read'] } },
      'Team',
    );
    expect(screen.getByTestId('shut-screen')).toHaveAttribute('data-lock', 'permission');
    expect(screen.getByText('Team is not on this seat')).toBeInTheDocument();
    expect(screen.queryByText(/verified your company/)).not.toBeInTheDocument();
  });
});
