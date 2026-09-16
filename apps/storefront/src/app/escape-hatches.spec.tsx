/**
 * Three ways out that did not work, and one default nobody chose.
 *
 * Each of these strands a real buyer:
 *
 * - "Forgotten your password?" pointed at a route the storefront did not have.
 *   `ForgotPassword.tsx` sat in its folder with no `page.tsx` beside it and was
 *   mounted only by the supplier console.
 * - A mistyped address at sign-in has to read the same as a correct one, or the
 *   screen becomes an account-enumeration oracle.
 * - Every buyer silently required a purchase-order number on every order,
 *   decided by a card that asked them nothing.
 *
 * Three of these assert against source text rather than a rendered screen. That
 * is deliberate: a link agreeing with a route, and a refusal never claiming
 * delivery, are facts about the file, and rendering the whole sign-in screen to
 * re-derive them would test the renderer instead.
 */
import * as React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ForgotPasswordPage, { metadata as forgotMetadata } from './forgot-password/page';
import { PreferencesBody } from './(portal)/profile/sections/PreferencesBody';

const read = (...parts: string[]): string => readFileSync(join(__dirname, ...parts), 'utf8');

const noop = (): void => undefined;
const shared = { registerSubmit: noop, onBusy: noop, onFrame: noop, onSaved: noop };

/* ==========================================================================
 * 1. /forgot-password exists on the storefront
 * ======================================================================== */

describe('the forgotten-password route', () => {
  it('has a page that renders the reset form', () => {
    render(<ForgotPasswordPage />);

    // The focus frame's heading, and the field the code is sent to.
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a reset code' })).toBeInTheDocument();
  });

  it('tells a mobile-only buyer how to get a password at all', () => {
    render(<ForgotPasswordPage />);
    // The compounding half of the defect: no password, and nowhere to get one.
    expect(screen.getByText(/Verify a work email on your profile first/i)).toBeInTheDocument();
  });

  it('is excluded from search, like every other credential screen', () => {
    expect(forgotMetadata.robots).toMatchObject({ index: false });
  });

  it('is the target the sign-in screen actually links to', () => {
    // The link and the route have to agree; they did not.
    expect(read('sign-in', 'OtpSignIn.tsx')).toContain('href="/forgot-password"');
    expect(existsSync(join(__dirname, 'forgot-password', 'page.tsx'))).toBe(true);
  });
});

/* ==========================================================================
 * 2. The sign-in screen answers nothing
 * ======================================================================== */

describe('a mistyped address at sign-in', () => {
  /**
   * The screen's own rule, and the reason the Password tab is NOT hidden for an
   * account that has no password: a tab that vanished on a typed address would
   * say whether that address exists, which is the one thing this screen is
   * built never to answer.
   */
  it('is told the same thing a correct one is, and never that a code was sent', () => {
    const source = read('sign-in', 'OtpSignIn.tsx');

    // Conditional, not an assertion of delivery.
    expect(source).toContain('is on a buyer account, a six-digit');
    expect(source).not.toContain('a code has been sent to');

    // And a way back to change what was typed, beside the resend timer.
    expect(source).toContain('Change number or email');
  });
});

/* ==========================================================================
 * 3. The purchase-order number is a question, not a default
 * ======================================================================== */

describe('the purchase-order preference', () => {
  it('does not block checkout for a buyer who was never asked', () => {
    render(<PreferencesBody {...shared} initial={{}} blockingReason={null} />);
    const box = screen.getByRole('checkbox', {
      name: /Our orders need a purchase order number/i,
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it('states the consequence in both directions, in the same breath as the question', () => {
    const off = render(<PreferencesBody {...shared} initial={{}} blockingReason={null} />);
    expect(screen.getByText(/will not ask for a PO number/i)).toBeInTheDocument();
    off.unmount();

    render(<PreferencesBody {...shared} initial={{ poRequired: true }} blockingReason={null} />);
    expect(screen.getByText(/refuse without one/i)).toBeInTheDocument();
  });

  it('is still enforced at checkout when a buyer does ask for it', () => {
    const source = read('checkout', 'CheckoutFlow.tsx');
    // Both directions: the gate is intact, and it reads the server's answer.
    expect(source).toContain('session?.poRequired && poNumber.trim().length === 0');
    expect(source).toContain('required={session.poRequired}');
  });

  it('has a back-fill that clears the value nobody chose, keeping real PO users', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'api',
        'prisma',
        'migrations',
        '20260921000000_po_required_not_a_silent_default',
        'migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('kyc.onboarding_progress');
    expect(sql).toContain('customer.org_preference');
    // An organisation that has actually raised a PO keeps the setting.
    expect(sql).toContain('buyer_po_number');
  });
});
