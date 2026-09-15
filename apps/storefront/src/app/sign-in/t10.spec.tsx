/**
 * The four things about signing in that would be silently wrong.
 *
 * None of these asserts that a guard exists. Each one attempts the thing the
 * screen must not do and expects the screen to refuse.
 *
 * 1. **A known address and an unknown one render identically after asking for
 *    a code.** Not "both show a code box" — the two runs are compared node for
 *    node, so a helpful hint added to one of them a year from now fails here.
 *    A sign-in form that can be told apart is a supplier directory.
 * 2. **No checkbox arrives ticked.** Rule 4(9) forbids a pre-ticked consent.
 * 3. **A rate limit renders the server's own seconds.** The screen must show
 *    the server's sentence and count the real remaining time down from
 *    `Retry-After` — never a generic "try again later".
 * 4. **A refusal about the account is rendered in the server's words**, not
 *    conflated with a wrong code.
 *
 * Plus the one thing sign-up adds: a brand-new organisation starts onboarding
 * before it lands on the portal, so the profile page has steps to show.
 */
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OtpSignIn } from './OtpSignIn';

/* ==========================================================================
 * The API, stubbed at `fetch` — including the header the wait rides on
 * ======================================================================== */

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

let replies: Record<string, Reply>;
let calls: string[];

const respond = (reply: Reply): Response =>
  ({
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    headers: { get: (name: string) => reply.headers?.[name] ?? null },
    json: () => Promise.resolve(reply.body ?? null),
  }) as unknown as Response;

const SENT: Reply = {
  status: 200,
  body: {
    channel: 'MOBILE',
    sentTo: '+91******3210',
    expiresAt: '2026-08-27T07:00:00.000Z',
    resendAvailableAt: '2026-08-27T06:56:00.000Z',
  },
};

beforeEach(() => {
  replies = {};
  calls = [];
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const path = String(input);
    calls.push(path);
    const reply = replies[path] ?? { status: 404, body: null };
    return Promise.resolve(respond(reply));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

const refusal = (code: string, message: string, status: number): Reply => ({
  status,
  body: { error: { code, message, requestId: 'test' } },
});

const SELLER = 'http://localhost:5173/sell/register';

/** Ask for a code, mounted and torn down, so two runs cannot see each other. */
async function askForCode(identifier: string): Promise<string> {
  const { container, unmount } = render(<OtpSignIn mode="sign-in" sellerRegisterUrl={SELLER} />);
  fireEvent.change(screen.getByLabelText(/Mobile number or work email/), {
    target: { value: identifier },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  });
  await screen.findByLabelText(/Six-digit code/);
  const text = rendered(container, identifier);
  unmount();
  return text;
}

/**
 * Everything a person could see, with the values they typed removed. The
 * server's mask is of what was typed, so it is normalised out along with it.
 */
const rendered = (container: HTMLElement, ...typed: string[]): string => {
  let text = container.textContent ?? '';
  for (const value of typed) text = text.split(value).join('«typed»');
  return text.replace(/\+91\*+\d+|[\w*]+@[\w*.]+/g, '«mask»');
};

describe('a sign-in form must not be able to tell anyone whether an account exists', () => {
  it('renders a known address and an unknown one identically after asking for a code', async () => {
    replies['/api/auth/buyer/otp'] = SENT;
    const known = await askForCode('9876543210');

    replies['/api/auth/buyer/otp'] = {
      ...SENT,
      body: { ...(SENT.body as object), channel: 'EMAIL', sentTo: 'no****@no**.example' },
    };
    const unknown = await askForCode('nobody@nowhere.example');

    expect(unknown).toBe(known);
  });

  it('renders a wrong code and a code for an address with no account identically', async () => {
    const REFUSED = 'That code is not right, or it has expired. Ask for a new one.';
    replies['/api/auth/buyer/otp'] = SENT;
    replies['/api/auth/buyer/otp/verify'] = {
      status: 422,
      body: { error: { code: 'VALIDATION', message: REFUSED, fields: { code: REFUSED } } },
    };

    const run = async (identifier: string): Promise<string> => {
      const { container, unmount } = render(
        <OtpSignIn mode="sign-in" sellerRegisterUrl={SELLER} />,
      );
      fireEvent.change(screen.getByLabelText(/Mobile number or work email/), {
        target: { value: identifier },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
      });
      await screen.findByLabelText(/Six-digit code/);
      const boxes = screen.getAllByRole('textbox');
      await act(async () => {
        fireEvent.change(boxes[0]!, { target: { value: '123456' } });
      });
      await screen.findByText(REFUSED);
      const text = rendered(container, identifier);
      unmount();
      return text;
    };

    expect(await run('nobody@nowhere.example')).toBe(await run('9876543210'));
  });
});

describe('r.4(9) — nothing arrives ticked', () => {
  const boxes = (container: HTMLElement): HTMLInputElement[] =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input')).filter(
      (input) => input.type === 'checkbox' || input.type === 'radio',
    );

  it('has no pre-ticked checkbox or radio on any stage of either mode', async () => {
    replies['/api/auth/buyer/otp'] = SENT;

    const signIn = render(<OtpSignIn mode="sign-in" sellerRegisterUrl={SELLER} />);
    expect(boxes(signIn.container).filter((b) => b.checked)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Mobile number or work email/), {
      target: { value: '9876543210' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    });
    await screen.findByLabelText(/Six-digit code/);
    expect(boxes(signIn.container).filter((b) => b.checked)).toHaveLength(0);
    expect(signIn.container.querySelectorAll('[checked]')).toHaveLength(0);
    signIn.unmount();

    const register = render(<OtpSignIn mode="register" sellerRegisterUrl={SELLER} />);
    expect(boxes(register.container).filter((b) => b.checked)).toHaveLength(0);
    register.unmount();
  });
});

describe('a wait is rendered as the wait it is', () => {
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
    replies['/api/auth/buyer/otp'] = LIMITED;

    render(<OtpSignIn mode="register" sellerRegisterUrl={SELLER} />);
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '9876543210' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    });

    const notice = await screen.findByTestId('rate-limit-notice');
    expect(notice).toHaveTextContent('Too many attempts. Try again in 4 minutes.');
    expect(screen.getByTestId('rate-limit-countdown')).toHaveTextContent('4:00');

    act(() => {
      jest.advanceTimersByTime(11_000);
    });
    expect(screen.getByTestId('rate-limit-countdown')).toHaveTextContent('3:49');

    // Nothing may be resubmitted into a budget that is still spent.
    expect(screen.getByRole('button', { name: 'Send code' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('invents no countdown when the server sent no Retry-After', async () => {
    replies['/api/auth/buyer/otp'] = {
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Try again shortly.',
          requestId: 'test',
        },
      },
    };

    render(<OtpSignIn mode="register" sellerRegisterUrl={SELLER} />);
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '9876543210' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
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

describe('a refusal about the account is told in the server’s words', () => {
  it('renders the 403 verbatim rather than as a wrong code', async () => {
    const SUSPENDED =
      'This organisation account is suspended. Our team has been in touch — reply to that email, or contact support.';
    replies['/api/auth/buyer/otp'] = SENT;
    replies['/api/auth/buyer/otp/verify'] = refusal('FORBIDDEN', SUSPENDED, 403);

    render(<OtpSignIn mode="sign-in" sellerRegisterUrl={SELLER} />);
    fireEvent.change(screen.getByLabelText(/Mobile number or work email/), {
      target: { value: '9876543210' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    });
    await screen.findByLabelText(/Six-digit code/);
    await act(async () => {
      fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: '123456' } });
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SUSPENDED);
    expect(alert).not.toHaveTextContent('not right');
  });
});

describe('a new organisation is set up before it lands', () => {
  it('starts onboarding for a created account, then leaves for the portal home', async () => {
    replies['/api/auth/buyer/otp'] = SENT;
    replies['/api/auth/buyer/otp/verify'] = {
      status: 200,
      body: {
        userId: 'u1',
        orgId: 'o1',
        orgType: 'BUYER',
        roles: ['CUSTOMER_OWNER'],
        permissions: [],
        mfaRequired: false,
        mobile: '+919876543210',
        created: true,
      },
    };
    replies['/api/onboarding/start'] = { status: 204 };
    // jsdom cannot navigate, so the screen is handed a spy for where it leaves to.
    const onSignedIn = jest.fn();

    render(<OtpSignIn mode="register" sellerRegisterUrl={SELLER} onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '9876543210' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    });
    await screen.findByLabelText(/Six-digit code/);
    await act(async () => {
      fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: '123456' } });
    });

    await waitFor(() => expect(calls).toContain('/api/onboarding/start'));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('/home', { created: true }));
    // Every call carried the identical normalised number the code was sent to.
    const sent = (global.fetch as jest.Mock).mock.calls
      .filter(([path]) => String(path).startsWith('/api/auth/buyer/otp'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string).identifier);
    expect(new Set(sent).size).toBe(1);
  });
});

describe('typing a code keeps the code box focused', () => {
  it('does not remount the inputs between digits', async () => {
    replies['/api/auth/buyer/otp'] = SENT;
    render(<OtpSignIn mode="register" sellerRegisterUrl={SELLER} />);
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '9876543210' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    });
    await screen.findByLabelText(/Six-digit code/);
    const first = screen.getAllByRole('textbox')[0]!;
    first.focus();
    await act(async () => {
      fireEvent.change(first, { target: { value: '1' } });
    });
    // The same element is still in the document and the second box has focus:
    // a remount would have replaced both and left focus on the body.
    expect(document.body.contains(first)).toBe(true);
    expect(document.activeElement).toBe(screen.getAllByRole('textbox')[1]);
  });
});

describe('the identifier says what is wrong with it while it is being typed', () => {
  it('counts digits on the sign-up mobile before the button is pressed', () => {
    render(<OtpSignIn mode="register" sellerRegisterUrl={SELLER} />);
    const box = screen.getByLabelText(/Mobile number/);
    box.focus();
    fireEvent.change(box, { target: { value: '98765' } });
    expect(screen.getByText(/5 so far/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '9876543210' } });
    expect(screen.queryByText(/so far/)).not.toBeInTheDocument();
  });

  it('applies the mobile rule to digits and the email rule to anything else on sign-in', () => {
    render(<OtpSignIn mode="sign-in" sellerRegisterUrl={SELLER} />);
    const box = screen.getByLabelText(/Mobile number or work email/);
    box.focus();
    fireEvent.change(box, { target: { value: '9876' } });
    expect(screen.getByText(/4 so far/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'priya@acme' } });
    expect(screen.queryByText(/so far/)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'priya@acme.example' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
