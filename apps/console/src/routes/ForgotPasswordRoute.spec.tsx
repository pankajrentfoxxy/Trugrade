import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordRoute } from './ForgotPasswordRoute';

/**
 * The reset code is only checked when the new password is submitted, because
 * `POST /auth/password/reset` takes both. A wrong or expired code used to leave
 * the supplier on the password panel with no way to ask for another.
 */

const reply = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  }) as unknown as Response;

const CODE_REFUSED = 'That code is not right, or it has expired. Ask for a new one.';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/password/forgot')) {
        return Promise.resolve(
          reply(200, {
            channel: 'EMAIL',
            sentTo: 'own****@no****.example',
            expiresAt: '',
            resendAvailableAt: '',
          }),
        );
      }
      if (url.endsWith('/api/auth/password/reset')) {
        return Promise.resolve(
          reply(422, {
            error: { code: 'VALIDATION', message: CODE_REFUSED, fields: { code: CODE_REFUSED } },
          }),
        );
      }
      return Promise.resolve(reply(404, null));
    }),
  );
});

async function reachChooseStage(): Promise<void> {
  render(<ForgotPasswordRoute />);
  fireEvent.change(screen.getByLabelText(/Work email/), {
    target: { value: 'owner@northgate.example' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Email me a reset code' }));
  });
  await screen.findByText('Enter the code we emailed you');
  const first = document.querySelector('[data-testid="otp-input"] input');
  if (!first) throw new Error('No OTP input on screen.');
  await act(async () => {
    fireEvent.change(first, { target: { value: '000000' } });
  });
  await screen.findByText('Choose a new password');
}

describe('the password-reset steps always have a way back', () => {
  it('offers another code and the way back to sign in from the password step', async () => {
    await reachChooseStage();

    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use a different code' }));
    });
    expect(await screen.findByText('Enter the code we emailed you')).toBeInTheDocument();
  });

  it('returns to the code step with the server’s reason when the code is refused', async () => {
    await reachChooseStage();
    fireEvent.change(screen.getByLabelText(/New password/), {
      target: { value: 'Qzv7$mKplWxR2b' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm password/), {
      target: { value: 'Qzv7$mKplWxR2b' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Set this password' }));
    });

    expect(await screen.findByText('Enter the code we emailed you')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(CODE_REFUSED);
  });
});
