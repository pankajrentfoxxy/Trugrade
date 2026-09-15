import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({
    principal: {
      permissions: ['identity.team.manage', 'identity.user.read'],
      roles: ['VENDOR_OWNER'],
    },
  }),
}));

import { VendorTeamRoute } from '../Team';

/**
 * Adding a member whose mobile is already on another account used to say
 * "Request failed (422)": the client read `body.message`, and the API sends
 * `{ error: { message, fields } }`. The supplier could not tell what to change.
 */

const TEAM = { members: [], owners: 1, invites: [], facilities: [] };
const REFUSAL = {
  error: {
    code: 'VALIDATION_FAILED',
    message:
      'This mobile number is already on a Trugrade account, possibly with another organisation. Invite them with a different mobile number.',
    fields: { mobile: 'This mobile number is already registered.' },
  },
};

afterEach(() => vi.restoreAllMocks());

describe('adding a team member whose mobile is already registered', () => {
  it('says so under the Phone field and in the dialog, not "Request failed (422)"', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const reply = (status: number, body: unknown): Promise<Response> =>
          Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
        if (url.endsWith('/api/account/team/invites') && init?.method === 'POST')
          return reply(422, REFUSAL);
        if (url.includes('/api/account/team')) return reply(200, TEAM);
        return reply(200, {});
      },
    );

    render(
      <MemoryRouter>
        <VendorTeamRoute />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Raj Shukla' } });
    fireEvent.change(within(dialog).getByLabelText(/^Email ID/), {
      target: { value: 'investwithishani@gmail.com' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Phone/), { target: { value: '9535312310' } });
    await user.click(within(dialog).getByRole('button', { name: /^(Send invite|Invite|Save)$/ }));

    expect(
      await within(dialog).findByText('This mobile number is already registered.'),
    ).toBeTruthy();
    expect(
      within(dialog)
        .getAllByRole('alert')
        .some((node) =>
          node.textContent?.includes('This mobile number is already on a Trugrade account'),
        ),
    ).toBe(true);
    expect(dialog.textContent).not.toContain('Request failed');

    // Editing the number clears the field's refusal.
    fireEvent.change(within(dialog).getByLabelText(/^Phone/), { target: { value: '9812345670' } });
    expect(within(dialog).queryByText('This mobile number is already registered.')).toBeNull();
  });
});
