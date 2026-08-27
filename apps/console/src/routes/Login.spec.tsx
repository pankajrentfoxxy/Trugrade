/**
 * The console door has the same two properties as the customer one, and one of
 * its own.
 *
 * None of these asserts that a guard exists.
 *
 * 1. **An unknown address and a wrong password render identically.** Compared
 *    text for text, not "both showed an error". This is the supplier door, and
 *    a form that confirms an account exists turns vendor anonymity — the
 *    property the whole business rests on — into a lookup service.
 * 2. **A rate limit renders the server's own seconds.** The seconds arrive only
 *    in `Retry-After` (`ErrorBody` drops `detail` on purpose), so a client that
 *    does not read the header has nothing to count and quietly degrades to a
 *    shrug. The test drives a real 429 and reads the clock twice.
 * 3. **A session that still owes a second factor is not treated as signed in.**
 *    `MFA_REQUIRED_ROLES` covers VENDOR_OWNER, and `AuthGuard` refuses every
 *    non-public route until the factor lands — so publishing that principal
 *    would draw a full navigation rail over screens that all 403. The test signs
 *    in as exactly such an account and expects the challenge, not the console.
 */
import * as React from 'react';
import { MemoryRouter } from 'react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { LoginRoute } from './Login';

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

let replies: Record<string, Reply>;

const respond = (reply: Reply): Response =>
  ({
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    headers: { get: (name: string) => reply.headers?.[name] ?? null },
    json: () => Promise.resolve(reply.body ?? null),
  }) as unknown as Response;

beforeEach(() => {
  // No session on a cold load, which is what the login route is reached with.
  replies = { '/api/auth/session': { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } } };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(replies).find((k) => url.endsWith(k));
      if (!key) throw new Error(`no stub for ${url}`);
      return Promise.resolve(respond(replies[key]!));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const mount = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <LoginRoute />
      </AuthProvider>
    </MemoryRouter>,
  );

/** The identical 401 the server sends for both cases. `IdentityService`, VR-060. */
const WRONG = 'That email or password is not right.';

const refusal = (code: string, message: string, status: number): Reply => ({
  status,
  body: { error: { code, message, requestId: 'test' } },
});

async function attempt(email: string): Promise<string> {
  const { container, unmount } = mount();
  await screen.findByLabelText(/Work email/);
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Wrong-Guess-1!' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  });
  await screen.findByRole('alert');
  const text = (container.textContent ?? '').split(email).join('«typed»');
  unmount();
  return text;
}

describe('the console sign-in answers no questions about who has an account', () => {
  it('renders a wrong password and an address it has never seen identically', async () => {
    replies['/api/auth/login'] = refusal('UNAUTHENTICATED', WRONG, 401);

    const known = await attempt('owner@northgate.example');
    const unknown = await attempt('nobody@nowhere.example');

    expect(unknown).toBe(known);
    expect(known).toContain(WRONG);
  });

  it('has no pre-ticked checkbox or radio', async () => {
    const { container } = mount();
    await screen.findByLabelText(/Work email/);
    const ticked = Array.from(container.querySelectorAll('input')).filter(
      (input) =>
        (input.type === 'checkbox' || input.type === 'radio') && (input as HTMLInputElement).checked,
    );
    expect(ticked).toHaveLength(0);
    expect(container.querySelectorAll('[checked]')).toHaveLength(0);
  });
});

describe('a wait is rendered as the wait it is', () => {
  it("shows the server's sentence and counts the server's own seconds down", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    replies['/api/auth/login'] = {
      ...refusal('RATE_LIMITED', 'Too many attempts. Try again in 4 minutes.', 429),
      headers: { 'Retry-After': '240' },
    };

    mount();
    await screen.findByLabelText(/Work email/);
    fireEvent.change(screen.getByLabelText(/Work email/), {
      target: { value: 'owner@northgate.example' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Wrong-Guess-1!' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });

    const notice = await screen.findByTestId('rate-limit-notice');
    expect(notice).toHaveTextContent('Too many attempts. Try again in 4 minutes.');
    expect(screen.getByTestId('rate-limit-countdown')).toHaveTextContent('4:00');

    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });
    expect(screen.getByTestId('rate-limit-countdown')).toHaveTextContent('3:49');
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('a session that still owes a second factor is not a session', () => {
  it('asks for the code instead of letting a supplier owner into the console', async () => {
    replies['/api/auth/login'] = {
      status: 200,
      body: {
        userId: 'u1',
        orgId: 'o1',
        orgType: 'VENDOR',
        roles: ['VENDOR_OWNER'],
        permissions: [],
        mfaRequired: true,
      },
    };
    replies['/api/auth/mfa/otp'] = {
      status: 200,
      body: {
        sentTo: 'own****@no****.example',
        expiresAt: '2026-08-27T07:00:00.000Z',
        resendAvailableAt: '2026-08-27T06:56:00.000Z',
      },
    };

    mount();
    await screen.findByLabelText(/Work email/);
    fireEvent.change(screen.getByLabelText(/Work email/), {
      target: { value: 'owner@northgate.example' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'Correct-Horse-9!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });

    expect(await screen.findByText('One more code before you are in')).toBeInTheDocument();
    // And it says what the factor actually is. There is no TOTP enrolment
    // anywhere in the platform; calling this an authenticator app would be a lie
    // told by a label.
    expect(screen.getByText(/An authenticator app is not supported yet/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

describe('a suspended organisation is told what happened, in the server’s words', () => {
  it('renders the 403 verbatim rather than as a wrong password', async () => {
    const SUSPENDED =
      'This organisation account is suspended. Our team has been in touch — reply to that email, or contact support.';
    replies['/api/auth/login'] = refusal('FORBIDDEN', SUSPENDED, 403);

    mount();
    await screen.findByLabelText(/Work email/);
    fireEvent.change(screen.getByLabelText(/Work email/), {
      target: { value: 'owner@northgate.example' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Correct-Horse-9!' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });

    const panel = await screen.findByTestId('login-suspended');
    expect(panel).toHaveTextContent(SUSPENDED);
    expect(panel).not.toHaveTextContent(WRONG);
  });
});
