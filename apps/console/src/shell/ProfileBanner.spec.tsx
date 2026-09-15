import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProfileBanner } from './ProfileBanner';
import type { ResumableOnboarding } from '@trugrade/contracts';

/**
 * The bar's whole claim is that its number means something.
 *
 * The seven required sections weigh exactly 100 between them — one per step the
 * server requires of a vendor — so "100%" is not a progress figure, it is the
 * statement "you can submit". These tests attempt the two ways that claim goes
 * wrong: a percentage that reaches 100 with work still outstanding, and a bar
 * rendered from an onboarding that has not arrived yet.
 */

const EVERY_REQUIRED_STEP = [
  'ACCOUNT',
  'BUSINESS_PROFILE',
  'STATUTORY',
  'CAPABILITY',
  'FACILITY_CONTACTS',
  'DOCUMENTS_BANK',
  'AGREEMENT',
];

function onboarding(completeCodes: string[]): ResumableOnboarding {
  return {
    orgId: 'o1',
    status: completeCodes.length >= EVERY_REQUIRED_STEP.length ? 'VERIFIED' : 'REGISTERED',
    slaDueAt: null,
    slaBreached: false,
    decision: null,
    editable: true,
    payoutAccount: completeCodes.includes('DOCUMENTS_BANK')
      ? {
          last4: '7455',
          bankName: 'HDFC Bank',
          ifsc: 'HDFC0000489',
          pennyDropStatus: 'SUCCESS',
          frozenUntil: null,
        }
      : null,
    progress: {
      constitution: 'PRIVATE_LIMITED',
      steps: completeCodes.map((stepCode) => ({
        stepCode,
        isRequired: true,
        status: 'COMPLETE',
        completionPct: 100,
      })) as ResumableOnboarding['progress']['steps'],
      resumeAt: null,
      completedSteps: completeCodes.length,
      requiredSteps: EVERY_REQUIRED_STEP.length,
      isSubmittable: false,
    },
    answers: {
      DOCUMENTS_BANK: completeCodes.includes('DOCUMENTS_BANK')
        ? { bankCommitted: true, documentsComplete: true }
        : {},
    },
  };
}

const draw = (
  data: ResumableOnboarding | null,
  roles: string[] = ['VENDOR_OWNER'],
): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <ProfileBanner onboarding={data} roles={roles} />
    </MemoryRouter>,
  );

describe('the profile completion bar', () => {
  it('renders nothing at all until the onboarding has arrived', () => {
    // A bar that flashes 0% and then jumps is worse than a bar that is late.
    const { container } = draw(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the next section rather than only the number', () => {
    draw(onboarding(['ACCOUNT', 'BUSINESS_PROFILE', 'STATUTORY']));

    expect(screen.getByText('30%')).toBeTruthy();
    // Contact and Business & GST are done, so the next required section is the
    // pickup address.
    expect(screen.getByText('Next: Pickup address')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Complete profile' })).toHaveAttribute(
      'href',
      '/vendor/profile',
    );
  });

  it('stays short of 100% while a server-required step is open', () => {
    // The old five-card list reached 100% with CAPABILITY and ACCOUNT still
    // open on the server, so the bar promised a submission the server refused.
    draw(
      onboarding([
        'BUSINESS_PROFILE',
        'STATUTORY',
        'FACILITY_CONTACTS',
        'DOCUMENTS_BANK',
        'AGREEMENT',
      ]),
    );

    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.queryByText('Your profile is complete. Listing is open.')).toBeNull();
  });

  it('says listing is open only when every required section is done', () => {
    draw(onboarding(EVERY_REQUIRED_STEP));

    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('Your profile is complete. Listing is open.')).toBeTruthy();
    expect(screen.getByTestId('profile-banner').className).toContain('hub-banner--done');
  });

  it('does not offer the action to a role that cannot take it', () => {
    // A Warehouse member cannot complete a profile. While it still blocks them
    // they are told why; the button that would 403 is absent, not disabled.
    draw(onboarding(['ACCOUNT', 'BUSINESS_PROFILE', 'STATUTORY']), ['VENDOR_VIEWER']);

    expect(screen.getByText('Next: Pickup address')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Complete profile' })).toBeNull();
  });

  it('disappears for that role once there is nothing left to say', () => {
    const { container } = draw(onboarding(EVERY_REQUIRED_STEP), ['VENDOR_VIEWER']);

    expect(container).toBeEmptyDOMElement();
  });
});
