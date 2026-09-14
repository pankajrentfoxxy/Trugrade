import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  it('rejects a mobile not starting with 6–9', async () => {
    render(
      <MemoryRouter>
        <SupplierSignup />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Mobile'), '5123456789');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText(/starting 6/i)).toBeInTheDocument();
  });

  it('advances to OTP after a valid mobile', async () => {
    render(
      <MemoryRouter>
        <SupplierSignup />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Mobile'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => expect(screen.getByText('Verify mobile')).toBeInTheDocument());
    expect(screen.getByLabelText('Six-digit code')).toBeInTheDocument();
  });
});
