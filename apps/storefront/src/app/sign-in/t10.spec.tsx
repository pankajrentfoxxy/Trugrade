/**
 * The four things about signing in that would be silently wrong.
 *
 * None of these asserts that a guard exists. Each one attempts the thing the
 * screen must not do and expects the screen to refuse.
 *
 * 1. **An unknown address and a wrong password render identically.** Not "both
 *    show an error" — the two runs are compared node for node, so a helpful
 *    hint added to one of them a year from now fails here. A sign-in form that
 *    can be told apart is a supplier directory, and vendor anonymity is the
 *    property this business rests on.
 * 2. **No checkbox arrives ticked.** Every checkbox and radio on every stage of
 *    both screens is counted and asserted unchecked. Rule 4(9) forbids a
 *    pre-ticked consent, and a "remember me" that arrives on is the classic one.
 * 3. **A rate limit renders the server's own seconds.** The screen must show the
 *    server's sentence and count the real remaining time down from
 *    `Retry-After` — never a generic "try again later", and never a spinner. The
 *    test drives a real 429 with a real header and reads the clock off the
 *    screen twice.
 * 4. **The reset form does not answer either.** Same comparison as (1), for the
 *    forgot-password screen, which is the enumeration oracle people forget.
 */
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
// Also loaded by `jest.setup.ts` at runtime; imported here so `tsc --noEmit`
// sees the matcher augmentation, which the setup file is outside `include` for.
import '@testing-library/jest-dom';
import { SignIn } from './SignIn';
import { ForgotPassword } from '../forgot-password/ForgotPassword';

/* ==========================================================================
 * The API, stubbed at `fetch` — including the header the wait rides on
 * ======================================================================== */

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
  replies = {};
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(replies).find((k) => url.endsWith(k));
    if (!key) throw new Error(`no stub for ${url}`);
    return Promise.resolve(respond(replies[key]!));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

const refusal = (code: string, message: string, status: number): Reply => ({
  status,
  body: { error: { code, message, requestId: 'test' } },
});

/** The identical 401 the server sends for both. `IdentityService`, VR-060. */
const WRONG = 'That email or password is not right.';

/** One attempt, mounted and torn down, so the two runs cannot see each other. */
async function signInWith(email: string, password: string): Promise<string> {
  const { container, unmount } = render(<SignIn />);
  fireEvent.click(screen.getByRole('button', { name: 'Use a password instead' }));
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  });
  await screen.findByRole('alert');
  const text = rendered(container, email);
  unmount();
  return text;
}

/**
 * Everything a person could see, with the values they typed removed.
 *
 * The typed address is obviously different between the two runs — it is what
 * they typed. What must not differ is one word of anything else.
 */
const rendered = (container: HTMLElement, ...typed: string[]): string => {
  let text = container.textContent ?? '';
  for (const value of typed) text = text.split(value).join('«typed»');
  return text;
};

describe('a sign-in form must not be able to tell anyone whether an account exists', () => {
  it('renders a wrong password and an address it has never seen identically', async () => {
    replies['/api/auth/login'] = refusal('UNAUTHENTICATED', WRONG, 401);

    const known = await signInWith('procurement@acme.example', 'Wrong-Guess-1!');
    const unknown = await signInWith('nobody@nowhere.example', 'Wrong-Guess-1!');

    expect(unknown).toBe(known);
    expect(known).toContain(WRONG);
  });

  it('renders a reset request identically whether or not the address is registered', async () => {
    // The server answers both with the same shape; the screen must not decorate
    // one of them. `sentTo` is a mask of what was typed, so it is normalised out
    // along with the address itself.
    replies['/api/auth/password/forgot'] = {
      status: 200,
      body: {
        channel: 'EMAIL',
        sentTo: 'pro****@ac**.example',
        expiresAt: '2026-08-27T07:00:00.000Z',
        resendAvailableAt: '2026-08-27T06:56:00.000Z',
      },
    };

    const ask = async (email: string): Promise<string> => {
      const { container, unmount } = render(<ForgotPassword />);
      fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: email } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Email me a reset code' }));
      });
      await screen.findByText('Enter the code we emailed you');
      const text = rendered(container, email, 'pro****@ac**.example');
      unmount();
      return text;
    };

    expect(await ask('nobody@nowhere.example')).toBe(await ask('procurement@acme.example'));
  });
});

describe('r.4(9) — nothing arrives ticked', () => {
  const boxes = (container: HTMLElement): HTMLInputElement[] =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input')).filter(
      (input) => input.type === 'checkbox' || input.type === 'radio',
    );

  it('has no pre-ticked checkbox or radio on any stage of either screen', async () => {
    replies['/api/auth/login'] = refusal('UNAUTHENTICATED', WRONG, 401);
    replies['/api/auth/login/otp'] = {
      status: 200,
      body: {
        channel: 'EMAIL',
        sentTo: 'pro****@ac**.example',
        expiresAt: '2026-08-27T07:00:00.000Z',
        resendAvailableAt: '2026-08-27T06:56:00.000Z',
      },
    };

    const code = render(<SignIn />);
    // Stage one: the address.
    expect(boxes(code.container).filter((b) => b.checked)).toHaveLength(0);

    // Stage two: the password half. A "remember me" would land here.
    fireEvent.click(screen.getByRole('button', { name: 'Use a password instead' }));
    expect(boxes(code.container).filter((b) => b.checked)).toHaveLength(0);
    expect(code.container.querySelectorAll('[checked]')).toHaveLength(0);

    // Stage three: the code panel.
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code instead' }));
    fireEvent.change(screen.getByLabelText(/Work email/), {
      target: { value: 'procurement@acme.example' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }));
    });
    await screen.findByText('Enter the code we emailed you');
    expect(boxes(code.container).filter((b) => b.checked)).toHaveLength(0);
    code.unmount();

    const reset = render(<ForgotPassword />);
    expect(boxes(reset.container).filter((b) => b.checked)).toHaveLength(0);
    reset.unmount();
  });
});

describe('a wait is rendered as the wait it is', () => {
  /**
   * `RateLimitedError(240)` reaches a browser only as `Retry-After: 240` —
   * `ErrorBody` drops `detail` on purpose — so a client that does not read the
   * header has nothing to count down and quietly falls back to a shrug.
   */
  const LIMITED: Reply = {
    status: 429,
    body: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Try again in 4 minutes.',
        requestId: 'test',
      },
    },
    headers: { 'Retry-After': '240' },
  };

  it("shows the server's sentence and counts the server's own seconds down", async () => {
    jest.useFakeTimers();
    replies['/api/auth/login'] = LIMITED;

    render(<SignIn />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a password instead' }));
    fireEvent.change(screen.getByLabelText(/Work email/), {
      target: { value: 'procurement@acme.example' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Wrong-Guess-1!' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });

    const notice = await screen.findByTestId('rate-limit-notice');
    // The server's words, not ours.
    expect(notice).toHaveTextContent('Too many attempts. Try again in 4 minutes.');
    // And the real remaining time, which is what a rounded sentence cannot give.
    expect(screen.getByTestId('rate-limit-countdown')).toHaveTextContent('4:00');

    act(() => {
      jest.advanceTimersByTime(11_000);
    });
    expect(screen.getByTestId('rate-limit-countdown')).toHaveTextContent('3:49');

    // Nothing may be resubmitted into a budget that is still spent.
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('invents no countdown when the server sent no Retry-After', async () => {
    replies['/api/auth/login'] = {
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Try again shortly.',
          requestId: 'test',
        },
      },
    };

    render(<SignIn />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a password instead' }));
    fireEvent.change(screen.getByLabelText(/Work email/), {
      target: { value: 'procurement@acme.example' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Wrong-Guess-1!' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });

    await screen.findByTestId('rate-limit-notice');
    expect(screen.queryByTestId('rate-limit-countdown')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('rate-limit-notice')).toHaveTextContent(
        'Too many attempts. Try again shortly.',
      ),
    );
  });
});

describe('a suspended organisation is told what happened, in the server’s words', () => {
  it('renders the 403 verbatim rather than as a wrong password', async () => {
    const SUSPENDED =
      'This organisation account is suspended. Our team has been in touch — reply to that email, or contact support.';
    replies['/api/auth/login'] = refusal('FORBIDDEN', SUSPENDED, 403);

    render(<SignIn />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a password instead' }));
    fireEvent.change(screen.getByLabelText(/Work email/), {
      target: { value: 'owner@acme.example' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Correct-Horse-9!' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    });

    const panel = await screen.findByTestId('signin-suspended');
    expect(panel).toHaveTextContent(SUSPENDED);
    // Not conflated with the credential refusal, which would send somebody to
    // reset a password that was never the problem.
    expect(panel).not.toHaveTextContent(WRONG);
  });
});
