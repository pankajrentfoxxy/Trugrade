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

/**
 * The dialog opened already telling the supplier off.
 *
 * `error` was computed straight from the draft on every render, so an empty
 * form — which is what an invite dialog opens as — failed all three validators
 * on first paint: three red borders and three messages about a form nobody had
 * typed into. Worse, the control that would clear them refused in silence,
 * because the submit handler returned early on exactly those errors without
 * putting anything on screen.
 *
 * A blank required field is not a mistake until somebody tries to send it.
 */
describe('the invite dialog before anybody has typed anything', () => {
  const openDialog = async (): Promise<HTMLElement> => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const reply = (body: unknown): Promise<Response> =>
        Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
      return url.includes('/api/account/team') ? reply(TEAM) : reply({});
    });
    render(
      <MemoryRouter>
        <VendorTeamRoute />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    return await screen.findByRole('dialog');
  };

  it('shows no error on any field, and marks none of them invalid', async () => {
    const dialog = await openDialog();
    for (const label of [/^Name/, /^Email ID/, /^Phone/]) {
      expect(within(dialog).getByLabelText(label).getAttribute('aria-invalid')).toBeNull();
    }
    // The three the screenshot caught, verbatim from the shared validators.
    expect(dialog.textContent).not.toContain('Enter your full name');
    expect(dialog.textContent).not.toContain('Enter the email address you use at work');
    expect(dialog.textContent).not.toContain('Enter the mobile number');
  });

  it('says what is missing once Send invite is pressed, rather than doing nothing', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Send invite' }));
    expect(await within(dialog).findByText(/Enter your full name/)).toBeTruthy();
    expect(within(dialog).getByText(/Enter the email address you use at work/)).toBeTruthy();
    expect(within(dialog).getByText(/Enter the mobile number/)).toBeTruthy();
  });

  it('opens clean again the next time, rather than remembering the last refusal', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Send invite' }));
    expect(await within(dialog).findByText(/Enter your full name/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    const reopened = await screen.findByRole('dialog');
    expect(reopened.textContent).not.toContain('Enter your full name');
  });
});

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
