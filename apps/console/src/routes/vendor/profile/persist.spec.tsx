import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bankCommitRefusal, persistInOrder, type SaveResult } from './persist';

const api = vi.hoisted(() => ({
  saveStep: vi.fn(),
  completeStep: vi.fn(),
  lookupIfsc: vi.fn(),
  pennyDrop: vi.fn(),
  commitBankAccount: vi.fn(),
}));
vi.mock('../../../../../storefront/src/app/register/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import { AgreementSection } from './sections/AgreementSection';
import { BankSection } from './sections/BankSection';

const ok = async (): Promise<SaveResult> => ({ ok: true });
const refused =
  (message: string, fields: Record<string, string> = {}) =>
  async (): Promise<SaveResult> => ({ ok: false, message, fields });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('persistInOrder', () => {
  it('resolves to null only when every write landed', async () => {
    expect(await persistInOrder([ok, ok])).toBeNull();
  });

  it('stops at the first refusal and names what to fix', async () => {
    const after = vi.fn(ok);
    expect(
      await persistInOrder([
        ok,
        refused('That did not go through (409).', { pan: 'PAN does not match the GSTIN.' }),
        after,
      ]),
    ).toBe('PAN does not match the GSTIN.');
    expect(after).not.toHaveBeenCalled();
  });
});

describe('bankCommitRefusal', () => {
  it('accepts only a stored account whose penny-drop matched', () => {
    expect(
      bankCommitRefusal({ accountId: 'b1', verification: { outcome: 'PASS', message: '' } }),
    ).toBeNull();
  });

  it('refuses a 200 that wrote no account, in the server’s words', () => {
    expect(
      bankCommitRefusal({
        accountId: null,
        verification: { outcome: 'MISMATCH', message: 'The account holder name does not match.' },
      }),
    ).toBe('The account holder name does not match.');
  });
});

describe('a profile section only reports saved when the server agreed', () => {
  it('keeps the agreement dialog open with the server’s message when completing the step fails', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    api.saveStep.mockResolvedValue({ ok: true, data: null });
    api.completeStep.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'CONFLICT',
      message: 'This step cannot be completed yet.',
      fields: {},
      retryAfterSeconds: null,
    });
    render(
      <AgreementSection
        open
        onClose={vi.fn()}
        onSaved={onSaved}
        initial={{}}
        legalName="Alpha Systems Pvt Ltd"
      />,
    );

    await user.type(screen.getByLabelText(/Your name/), 'Priya Sharma');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This step cannot be completed yet.')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does not mark the bank committed when the server stored no account', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    api.lookupIfsc.mockResolvedValue({
      ok: true,
      data: { bank: 'HDFC Bank', branch: 'Sector 18', city: 'Noida' },
    });
    api.pennyDrop.mockResolvedValue({
      ok: true,
      data: {
        id: 'v1',
        checkType: 'BANK',
        outcome: 'PASS',
        message: 'Matched',
        resolved: { beneficiaryName: 'ALPHA SYSTEMS' },
        attemptNo: 1,
        attemptsRemaining: 4,
        willRetryAutomatically: false,
      },
    });
    api.commitBankAccount.mockResolvedValue({
      ok: true,
      data: {
        verification: { outcome: 'MISMATCH', message: 'The account holder name does not match.' },
        accountId: null,
        frozenUntil: null,
        alertedVia: [],
      },
    });
    render(
      <BankSection
        open
        onClose={vi.fn()}
        onSaved={onSaved}
        initial={{}}
        legalName="Alpha Systems Pvt Ltd"
      />,
    );

    await user.type(screen.getByLabelText(/^IFSC/), 'HDFC0001234');
    await user.type(screen.getByLabelText(/^Account number/), '123456789012');
    await user.type(screen.getByLabelText(/^Re-enter account number/), '123456789012');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The account holder name does not match.')).toBeTruthy();
    await waitFor(() => expect(api.commitBankAccount).toHaveBeenCalled());
    expect(api.saveStep).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
