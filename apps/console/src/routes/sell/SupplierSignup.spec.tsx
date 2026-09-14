import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { SupplierSignup } from './SupplierSignup';

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), useNavigate: () => navigate };
});

beforeEach(() => {
  navigate.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/register/otp' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { channel: string; value: string };
        return new Response(
          JSON.stringify({
            channel: body.channel,
            sentTo: body.channel === 'MOBILE' ? '+91 98xxx xx210' : 'te***@acme.in',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
            devCode: '123456',
          }),
          { status: 200 },
        );
      }
      if (url === '/api/auth/register/otp/verify') {
        return new Response(
          JSON.stringify({
            channel: 'MOBILE',
            value: '+919876543210',
            verified: true,
            proofExpiresAt: new Date(Date.now() + 1_800_000).toISOString(),
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: { message: 'Unexpected' } }), { status: 500 });
    }),
  );
});

describe('SupplierSignup', () => {
  it('shows mobile validation while typing', async () => {
    render(
      <MemoryRouter>
        <SupplierSignup />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const input = screen.getByLabelText(/Mobile number/i);
    await user.click(input);
    await user.type(input, '5123456789');
    expect(await screen.findByText(/starting 6/i)).toBeInTheDocument();
  });

  it('advances to OTP after a valid mobile', async () => {
    render(
      <MemoryRouter>
        <SupplierSignup />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    await waitFor(() => expect(screen.getByText('Verify your mobile')).toBeInTheDocument());
    expect(screen.getByLabelText('Six-digit code')).toBeInTheDocument();
  });
});

/**
 * `OtpInput`'s label is `aria-labelledby` on the `role="group"` wrapper, not on
 * any one of its six boxes, so `getByLabelText` resolves to the group — not a
 * form element `userEvent.type` can type into. A real browser fills every box
 * this way too: autofill and paste both land the whole code on one input and
 * `OtpInput` redistributes it, which is the `typed.length > 1` branch this
 * exercises.
 */
function fillOtp(code: string): void {
  const first = document.querySelector('[data-testid="otp-input"] input');
  if (!first) throw new Error('No OTP input on screen.');
  fireEvent.change(first, { target: { value: code } });
}

/**
 * The full path for the role every self-registered supplier gets —
 * VENDOR_OWNER, which `MFA_REQUIRED_ROLES` covers — asserted by attempting the
 * bug that shipped here: a vendor completed the second factor correctly and
 * was bounced straight back to a screen demanding another one.
 *
 * `onSessionEstablished` stands in for `VendorRegisterRoute`'s real
 * `syncSession()` — the console's `AuthContext` is what `RequirePermission`
 * reads on `/vendor`, and nothing else in this component ever calls back into
 * it. If `completeOnboarding` stopped awaiting that call, or called it before
 * the second factor actually cleared, this is the test that would still pass
 * on the broken build: `navigate` fires, but a moment too early or with the
 * pre-MFA session, and it is only the guard on `/vendor` — not this
 * component — that would have caught it.
 */
describe('the second factor, landing on /vendor', () => {
  const calls: string[] = [];

  function mfaFetch(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url === '/api/auth/register/otp' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { channel: string };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            channel: body.channel,
            sentTo: body.channel === 'MOBILE' ? '+91 98xxx xx210' : 'te***@acme.in',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
            devCode: '111111',
          }),
          { status: 200 },
        ),
      );
    }
    if (url === '/api/auth/register/otp/verify' && method === 'POST') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            channel: 'MOBILE',
            value: '+919876543210',
            verified: true,
            proofExpiresAt: new Date(Date.now() + 1_800_000).toISOString(),
          }),
          { status: 200 },
        ),
      );
    }
    if (url === '/api/auth/register' && method === 'POST') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: 'u1',
            orgId: 'o1',
            orgType: 'VENDOR',
            roles: ['VENDOR_OWNER'],
            permissions: ['listing.own.read'],
            mfaRequired: true,
            accessToken: 'pre-mfa-token',
            fullName: 'Test Vendor',
            email: 'test@acme.in',
            mobile: '+919876543210',
          }),
          { status: 201 },
        ),
      );
    }
    if (url === '/api/auth/mfa/otp' && method === 'POST') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            sentTo: 'te***@acme.in',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
            devCode: '222222',
          }),
          { status: 200 },
        ),
      );
    }
    if (url === '/api/auth/mfa/verify' && method === 'POST') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: 'u1',
            orgId: 'o1',
            orgType: 'VENDOR',
            roles: ['VENDOR_OWNER'],
            permissions: ['listing.own.read'],
            mfaRequired: false,
            accessToken: 'post-mfa-token',
          }),
          { status: 200 },
        ),
      );
    }
    if (url === '/api/onboarding/start' && method === 'POST') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: { message: 'Unexpected' } }), { status: 500 }),
    );
  }

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(mfaFetch));
  });

  it('does not navigate to /vendor until the awaited session sync resolves', async () => {
    const order: string[] = [];
    let releaseSync: () => void = () => {};
    const sessionSynced = new Promise<void>((resolve) => {
      releaseSync = () => {
        order.push('session-synced');
        resolve();
      };
    });
    const onSessionEstablished = vi.fn(() => sessionSynced);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SupplierSignup onSessionEstablished={onSessionEstablished} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/Mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    await screen.findByLabelText('Six-digit code');
    fillOtp('111111');

    await screen.findByText('Your work email');
    await user.type(screen.getByLabelText(/Email address/i), 'test@acme.in');
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    await screen.findByLabelText(/Code sent to/);
    fillOtp('111111');

    await screen.findByText('Set a password');
    await user.type(screen.getByLabelText(/^Your name/), 'Test Vendor');
    await user.type(screen.getByLabelText(/^Password/), 'Qzv7$mKplWxR2b');
    await user.type(screen.getByLabelText(/^Confirm password/), 'Qzv7$mKplWxR2b');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    // The second factor, on the account the moment it exists — not something
    // this test is trying to route around.
    await screen.findByText(/needs a second code/);
    fillOtp('222222');

    // `onSessionEstablished` has been called, but its promise is still
    // pending — `navigate` must not have fired yet.
    await waitFor(() => expect(onSessionEstablished).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    expect(calls).not.toContain('POST /api/onboarding/start');

    releaseSync();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/vendor', { replace: true }));

    // The order that matters: the session was synced, THEN onboarding was
    // started, THEN the route changed — never the reverse.
    expect(order).toEqual(['session-synced']);
    expect(calls.indexOf('POST /api/onboarding/start')).toBeGreaterThan(-1);
  });
});

/**
 * `POST /auth/register` names email or mobile at the last step — the half-hour
 * verification lapsed while a password was chosen, or the address turned out to
 * be taken. Neither field is on that step, and the refusal used to vanish.
 */
describe('a contact refusal at the last step', () => {
  const calls: string[] = [];

  function refusingFetch(registerReply: () => Response) {
    return (url: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (url === '/api/auth/register/otp' && method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              channel: 'EMAIL',
              sentTo: 'te***@acme.in',
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
              devCode: '111111',
            }),
            { status: 200 },
          ),
        );
      }
      if (url === '/api/auth/register/otp/verify' && method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ verified: true }), { status: 200 }));
      }
      if (url === '/api/auth/register' && method === 'POST')
        return Promise.resolve(registerReply());
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Unexpected' } }), { status: 500 }),
      );
    };
  }

  async function reachLastStepAndSubmit(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SupplierSignup />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/Mobile number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    await screen.findByLabelText('Six-digit code');
    fillOtp('111111');
    await screen.findByText('Your work email');
    await user.type(screen.getByLabelText(/Email address/i), 'test@acme.in');
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    await screen.findByLabelText(/Code sent to/);
    fillOtp('111111');
    await screen.findByText('Set a password');
    await user.type(screen.getByLabelText(/^Your name/), 'Test Vendor');
    await user.type(screen.getByLabelText(/^Password/), 'Qzv7$mKplWxR2b');
    await user.type(screen.getByLabelText(/^Confirm password/), 'Qzv7$mKplWxR2b');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    return user;
  }

  beforeEach(() => {
    calls.length = 0;
  });

  it('shows an expired verification and re-proves it inline, keeping what was typed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        refusingFetch(
          () =>
            new Response(
              JSON.stringify({
                error: {
                  code: 'VALIDATION',
                  message:
                    'Verify your work email first — enter the 6-digit code we sent to it, then create the account.',
                  fields: { email: 'This email has not been verified yet.' },
                },
              }),
              { status: 422 },
            ),
        ),
      ),
    );
    const user = await reachLastStepAndSubmit();

    const refusal = await screen.findByTestId('signup-contact-refusal');
    expect(refusal.textContent).toContain('Verify your work email first');
    expect(refusal.textContent).toContain('test@acme.in');
    expect(screen.getByRole('button', { name: 'Create account' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    await screen.findByLabelText(/Code sent to te\*\*\*@acme.in/);
    fillOtp('111111');

    await waitFor(() => expect(screen.queryByTestId('signup-contact-refusal')).toBeNull());
    expect(screen.getByLabelText(/^Your name/)).toHaveValue('Test Vendor');
    expect(calls.filter((c) => c === 'POST /api/auth/register/otp/verify')).toHaveLength(3);
  });

  it('shows an address already on an account and lets the supplier change it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        refusingFetch(
          () =>
            new Response(
              JSON.stringify({
                error: {
                  code: 'VALIDATION',
                  message:
                    'This email is already registered. Sign in instead, or use a different address.',
                  fields: {
                    email:
                      'This email is already registered. Sign in instead, or use a different address.',
                  },
                },
              }),
              { status: 422 },
            ),
        ),
      ),
    );
    const user = await reachLastStepAndSubmit();

    const refusal = await screen.findByTestId('signup-contact-refusal');
    expect(refusal.textContent).toContain('already registered');
    expect(screen.getByRole('link', { name: 'Sign in instead' })).toHaveAttribute('href', '/login');

    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(await screen.findByText('Your work email')).toBeTruthy();
    expect(screen.getByLabelText(/Email address/i)).not.toHaveAttribute('readonly');
  });
});
