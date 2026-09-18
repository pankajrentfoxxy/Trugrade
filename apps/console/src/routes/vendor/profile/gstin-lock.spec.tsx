/**
 * A GSTIN the GST portal has passed is not a field any more.
 *
 * Everything the Business & GST card shows under that box — the legal name it
 * writes to `organization.legal_name`, the registered address, the state and
 * the PAN — is the portal's answer about one number. These tests hold the box
 * shut against a second number nobody checked, and hold the escape open.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  saveStep: vi.fn(),
  completeStep: vi.fn(),
  verifyGstin: vi.fn(),
}));
vi.mock('../../../../../storefront/src/app/register/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import { BusinessGstSection } from './sections/BusinessGstSection';

const GSTIN = '06AAHCT0310N1ZG';

const PASS = {
  id: 'v1',
  checkType: 'GSTIN',
  outcome: 'PASS',
  message: 'Active',
  matchScore: 1,
  attemptNo: 1,
  attemptsRemaining: 3,
  willRetryAutomatically: false,
  resolved: {
    legalName: 'TRUETECH SERVICES PRIVATE LIMITED',
    constitutionType: 'PVT_LTD',
    registeredAddress: { line1: 'JMD Megapolis', city: 'GURGAON', state: '06', pincode: '122018' },
  },
};

const card = (initial: Record<string, unknown> = {}): React.JSX.Element => (
  <BusinessGstSection
    open
    onClose={vi.fn()}
    onSaved={vi.fn()}
    initial={initial}
    initialConstitution="PVT_LTD"
  />
);

/** Step 1 is the constitution tiles; the GSTIN lives on step 2. */
async function toGstinStep(user: ReturnType<typeof userEvent.setup>): Promise<HTMLInputElement> {
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  return (await screen.findByLabelText(/^GSTIN/)) as HTMLInputElement;
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.verifyGstin.mockResolvedValue({ ok: true, data: PASS });
  api.saveStep.mockResolvedValue({ ok: true, data: null });
  api.completeStep.mockResolvedValue({ ok: true, data: null });
});

describe('a verified GSTIN', () => {
  it('locks the field on a PASS, and refuses a second number typed over it', async () => {
    const user = userEvent.setup();
    render(card());
    const field = await toGstinStep(user);
    expect(field).not.toHaveAttribute('readonly');

    await user.type(field, GSTIN);
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText('TRUETECH SERVICES PRIVATE LIMITED');

    expect(field).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(screen.getByText(/Checked against the GST portal/)).toBeInTheDocument();

    // Not merely unpainted: a dispatched change is refused too.
    fireEvent.change(field, { target: { value: '29AAHCT0310N1Z9' } });
    expect(field.value).toBe(GSTIN);
  });

  it('unlocks only on a deliberate change, which throws the portal answer away', async () => {
    const user = userEvent.setup();
    render(card());
    const field = await toGstinStep(user);
    await user.type(field, GSTIN);
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText('TRUETECH SERVICES PRIVATE LIMITED');

    await user.click(screen.getByRole('button', { name: 'Change the GSTIN' }));
    expect(field).not.toHaveAttribute('readonly');
    expect(screen.queryByText('TRUETECH SERVICES PRIVATE LIMITED')).toBeNull();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
  });

  it('stores the outcome, so a reopened card is still verified and still locked', async () => {
    const user = userEvent.setup();
    const first = render(card());
    const field = await toGstinStep(user);
    await user.type(field, GSTIN);
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText('TRUETECH SERVICES PRIVATE LIMITED');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.completeStep).toHaveBeenCalledWith('STATUTORY'));
    const statutory = api.saveStep.mock.calls.find(([step]) => step === 'STATUTORY');
    const [row] = (statutory![1] as { gstins: Record<string, unknown>[] }).gstins;
    expect(row!.outcome).toMatchObject({ outcome: 'PASS' });
    first.unmount();

    // Reopened from what was written: verified, ticked, and shut.
    render(card({ primaryGstin: GSTIN, gstins: [row] }));
    const reopened = await toGstinStep(userEvent.setup());
    expect(reopened).toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
