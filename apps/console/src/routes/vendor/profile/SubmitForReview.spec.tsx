import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { OnboardingReloadContext } from '../../../lib/vendorOnboarding';
import { SubmitForReview } from './SubmitForReview';
import { ProfileBanner } from '../../../shell/ProfileBanner';

/**
 * A supplier who has finished every section must be able to turn it into an
 * application. Before this existed nothing in the console called
 * POST /api/onboarding/submit, so no seller could ever reach VERIFIED.
 */

const application = (over: Partial<ResumableOnboarding> = {}): ResumableOnboarding => ({
  orgId: 'o1',
  status: 'REGISTERED',
  slaDueAt: null,
  slaBreached: false,
  decision: null,
  progress: {
    constitution: 'PRIVATE_LIMITED',
    steps: [],
    resumeAt: null,
    completedSteps: 6,
    requiredSteps: 6,
    isSubmittable: true,
  },
  answers: {},
  ...over,
});

const reply = (status: number, body: unknown): Response =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

function draw(ui: React.ReactElement, reload = vi.fn()): { reload: ReturnType<typeof vi.fn> } {
  render(
    <MemoryRouter>
      <OnboardingReloadContext.Provider value={{ token: 0, reload }}>
        {ui}
      </OnboardingReloadContext.Provider>
    </MemoryRouter>,
  );
  return { reload };
}

afterEach(() => vi.restoreAllMocks());

describe('submitting a finished profile for review', () => {
  it('posts the application, shows the review deadline the server set, and refreshes the shell', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(reply(201, { slaDueAt: '2026-09-17T06:30:00.000Z' }));
    const { reload } = draw(
      <SubmitForReview onboarding={application()} roles={['VENDOR_OWNER']} />,
    );

    await user.click(screen.getByRole('button', { name: 'Submit for review' }));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/onboarding/submit',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(await screen.findByText(/Submitted for review/)).toBeTruthy();
    expect(screen.getByText('17 Sept 2026, 12:00 pm')).toBeTruthy();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('names the step that blocked it and leaves the button to try again', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reply(409, {
        error: { code: 'CONFLICT', message: 'Finish this step first: What you stock.' },
      }),
    );
    draw(<SubmitForReview onboarding={application()} roles={['VENDOR_ADMIN']} />);

    await user.click(screen.getByRole('button', { name: 'Submit for review' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Finish this step first: What you stock.',
    );
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeTruthy();
  });

  it('tells a seat that may not submit who can, without a button that would 403', () => {
    draw(<SubmitForReview onboarding={application()} roles={['VENDOR_OPS']} />);

    expect(screen.getByText(/Ask your account owner to submit for review/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the deadline instead of a button once it is already in review', () => {
    draw(
      <SubmitForReview
        onboarding={application({ status: 'KYC_SUBMITTED', slaDueAt: '2026-09-17T06:30:00.000Z' })}
        roles={['VENDOR_OWNER']}
      />,
    );

    expect(screen.getByTestId('submit-in-review').textContent).toContain('17 Sept 2026');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers nothing while the server still says the application is incomplete', () => {
    const incomplete = application();
    incomplete.progress.isSubmittable = false;
    draw(<SubmitForReview onboarding={incomplete} roles={['VENDOR_OWNER']} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('turns the banner into the submit action when the profile is finished but not yet verified', () => {
    draw(<ProfileBanner onboarding={application()} roles={['VENDOR_OWNER']} />);

    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeTruthy();
    expect(screen.queryByText('Your profile is complete. Listing is open.')).toBeNull();
  });
});
