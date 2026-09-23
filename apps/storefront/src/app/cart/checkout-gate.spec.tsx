/**
 * The cart's checkout button asks the server, and fails open.
 *
 * It used to add up the profile cards' weights and refuse anything under 100 —
 * a second copy of a server rule, written in a second language, answering a
 * different question. Completeness is about the profile form; readiness is
 * about whether we can raise an invoice and deliver. A buyer could be told
 * "100% complete" here and refused on the next screen, because the API asked
 * for `VERIFIED` and only a reviewer could grant it.
 *
 * Now there is one rule, it lives on the server, and this reads it.
 */
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CheckoutGate } from './CheckoutGate';

const navigate = jest.fn();

jest.mock('../register/api', () => ({
  ...jest.requireActual('../register/api'),
  getSession: jest.fn(),
}));

jest.mock('../(portal)/api', () => ({
  ...jest.requireActual('../(portal)/api'),
  getOrderReadiness: jest.fn(),
}));

import { getSession } from '../register/api';
import { getOrderReadiness } from '../(portal)/api';

const mockSession = getSession as jest.MockedFunction<typeof getSession>;
const mockReadiness = getOrderReadiness as jest.MockedFunction<typeof getOrderReadiness>;

const session = () => ({
  ok: true as const,
  data: {
    userId: 'u1',
    orgId: 'o1',
    orgType: 'BUYER' as const,
    roles: ['CUSTOMER_OWNER'],
    permissions: [],
    mfaRequired: false,
    fullName: 'Priya',
    email: 'p@acme.example',
    mobile: '+919876543210',
  },
});

const readiness = (
  over: Partial<{ prepaid: boolean; credit: boolean; missing: string[] }> = {},
) => ({
  ok: true as const,
  data: {
    orgStatus: 'REGISTERED',
    suspended: false,
    prepaid: true,
    credit: false,
    missing: [] as string[],
    ...over,
  },
});

const refusal = (status: number) => ({
  ok: false as const,
  status,
  code: 'X',
  message: 'no',
  fields: {},
  retryAfterSeconds: null,
});

beforeEach(() => {
  navigate.mockReset();
  mockSession.mockReset();
  mockReadiness.mockReset();
});

const click = async (): Promise<void> => {
  render(<CheckoutGate cartId="c1" navigate={navigate} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('link', { name: 'Continue to checkout' }));
  });
};

it('sends a buyer who cannot be invoiced yet to the profile, with the reason', async () => {
  mockSession.mockResolvedValue(session() as never);
  mockReadiness.mockResolvedValue(readiness({ prepaid: false, missing: ['your GSTIN'] }) as never);
  await click();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith('/profile?reason=checkout');
});

it('lets a buyer who can pay up front through, without waiting for a human', async () => {
  // The case that used to be impossible: ready to be invoiced and delivered to,
  // but not VERIFIED, because verification is a reviewer's act.
  mockSession.mockResolvedValue(session() as never);
  mockReadiness.mockResolvedValue(
    readiness({ prepaid: true, credit: false, missing: [] }) as never,
  );
  await click();
  expect(navigate).toHaveBeenCalledWith('/checkout?cart=c1');
  expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/profile'));
});

it('lets a signed-out visitor and a seat that may not read readiness through', async () => {
  mockSession.mockResolvedValue(refusal(401) as never);
  await click();
  expect(navigate).toHaveBeenLastCalledWith('/checkout?cart=c1');

  mockSession.mockResolvedValue(session() as never);
  mockReadiness.mockResolvedValue(refusal(403) as never);
  await click();
  expect(navigate).toHaveBeenLastCalledWith('/checkout?cart=c1');
  expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/profile'));
});

it('never recomputes the rule from the profile cards', () => {
  const gate = readFileSync(join(__dirname, 'CheckoutGate.tsx'), 'utf8');
  // The rule lives in `checkout-entry.ts` so the product page's Buy now can
  // share it; the gate must go through it and nothing else.
  const entry = readFileSync(join(__dirname, 'checkout-entry.ts'), 'utf8');
  for (const source of [gate, entry]) {
    // The import, not the word: the docblock names the old call deliberately,
    // because the history is the reason this file reads the server instead.
    expect(source).not.toMatch(/^import .*profileCompletionPct/m);
    expect(source).not.toContain('profileCompletionPct(onboarding');
  }
  expect(gate).toMatch(/^import .*checkoutDestination/m);
  expect(entry).toContain('getOrderReadiness');
});
