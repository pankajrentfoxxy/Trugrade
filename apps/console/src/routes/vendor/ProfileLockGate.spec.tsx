import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useProfileGateOrRender } from './ProfileLockGate';

/**
 * The one gate every board named on the rail as locked — Listings, Inspect,
 * Grades, Orders, Payouts — asks for the same three answers before it shows
 * anything. Tested once here, against a harness, rather than five times
 * against five boards each carrying their own fetch mocks.
 */

function Harness({
  section = 'listings',
  title = 'Listings',
}: {
  section?: string;
  title?: string;
}): React.JSX.Element {
  const gate = useProfileGateOrRender(section, title);
  if (gate.locked) return gate.locked;
  return <div data-testid="unlocked">The board itself.</div>;
}

function draw(initialEntries = ['/vendor/listings']): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/vendor/listings" element={<Harness />} />
        <Route path="/vendor/profile" element={<div data-testid="profile-route">Profile</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockOnboarding(body: unknown, ok = true, status = 200): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe('a locked board', () => {
  it('renders nothing definite while the profile status is still in flight', () => {
    // Never resolves within the test — the point is what shows up before it does.
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    draw();
    expect(screen.getByText('Listings')).toBeTruthy();
    expect(screen.queryByTestId('unlocked')).toBeNull();
    expect(screen.queryByText(/Finish your profile/)).toBeNull();
  });

  it('shows the lock card when the org is not VERIFIED, naming every required section', async () => {
    mockOnboarding({
      status: 'REGISTERED',
      answers: { DOCUMENTS_BANK: { bankCommitted: false, documentsComplete: false } },
      progress: { steps: [] },
    });
    draw();

    expect(await screen.findByText('Finish your profile to unlock listings')).toBeTruthy();
    expect(screen.getByText('We verify every supplier before machines go on sale.')).toBeTruthy();
    // Every one of the server's seven required vendor steps has a card, and every
    // card is in the checklist. "What you stock" used to be left out as
    // recommended, which is how a supplier hit 100% with the server still waiting.
    for (const title of [
      'Contact',
      'Business & GST',
      'Pickup address',
      'Bank account',
      'Documents',
      'What you stock',
      'Supplier agreement',
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.queryByTestId('unlocked')).toBeNull();
  });

  it('names the first INCOMPLETE section on the button, not simply the first one', async () => {
    mockOnboarding({
      status: 'REGISTERED',
      // Contact and Business are done; Pickup is the next thing actually blocking.
      progress: {
        steps: [
          { stepCode: 'ACCOUNT', status: 'COMPLETE' },
          { stepCode: 'BUSINESS_PROFILE', status: 'COMPLETE' },
          { stepCode: 'STATUTORY', status: 'COMPLETE' },
        ],
      },
      answers: { DOCUMENTS_BANK: {} },
    });
    draw();

    const button = await screen.findByRole('button', { name: 'Continue — Pickup address' });
    expect(button).toBeTruthy();
  });

  it('sends the vendor to Profile with the right section queued to open', async () => {
    const user = userEvent.setup();
    mockOnboarding({ status: 'REGISTERED', progress: { steps: [] }, answers: {} });
    draw();

    await user.click(await screen.findByRole('button', { name: /^Continue —/ }));
    expect(await screen.findByTestId('profile-route')).toBeTruthy();
  });

  it('lets the board render once the org is VERIFIED', async () => {
    mockOnboarding({ status: 'VERIFIED', progress: { steps: [] }, answers: {} });
    draw();

    expect(await screen.findByTestId('unlocked')).toBeTruthy();
    expect(screen.queryByText(/Finish your profile/)).toBeNull();
  });

  describe('for a seat refused onboarding (403)', () => {
    const mockSeat = (orgStatus: string): void => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/onboarding/steps')) {
          return Promise.resolve({ ok: false, status: 403, json: async () => ({}) } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: orgStatus }),
        } as Response);
      });
    };

    it('reads the org status instead and names who can unlock it', async () => {
      mockSeat('REGISTERED');
      draw();
      expect(
        await screen.findByText(/Ask your account owner to finish the supplier profile/),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Continue —/ })).toBeNull();
      expect(screen.queryByTestId('unlocked')).toBeNull();
    });

    it('lets the board render once the org is VERIFIED', async () => {
      mockSeat('VERIFIED');
      draw();
      expect(await screen.findByTestId('unlocked')).toBeTruthy();
    });
  });

  it('does not lock the board just because the profile fetch itself failed', async () => {
    // A 500 on /api/onboarding/steps is not proof the account is unverified —
    // it is a second, unrelated failure, and the board still has its own
    // error state for its own data. Refusing on top of that would be a
    // failure the vendor cannot act on from this screen at all.
    mockOnboarding({ error: 'boom' }, false, 500);
    draw();

    expect(await screen.findByTestId('unlocked')).toBeTruthy();
  });
});
