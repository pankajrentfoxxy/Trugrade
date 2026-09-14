import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthShell } from './AuthShell';

/**
 * Sign-in and password reset wore the storefront's dark split frame and buyer
 * accent while signup and the hub wore the supplier surface. One frame now.
 */
afterEach(() => document.documentElement.removeAttribute('data-surface'));

describe('the console credential frame', () => {
  it('puts the page on the supplier hub surface and lifts it on leave', () => {
    const { unmount } = render(
      <AuthShell title="Sign in" lede="Suppliers and staff.">
        <p>form</p>
      </AuthShell>,
    );
    expect(document.documentElement.getAttribute('data-surface')).toBe('hub');
    unmount();
    expect(document.documentElement.getAttribute('data-surface')).toBeNull();
  });

  it('uses the same card and brand panel as supplier signup', () => {
    const { container } = render(
      <AuthShell
        title="Sign in"
        lede="Suppliers and staff."
        brandHref="https://truegrade.rentfoxxy.com"
      >
        <p>form</p>
      </AuthShell>,
    );
    expect(container.querySelector('.sup-signup-card')).not.toBeNull();
    expect(screen.getByText('Sell refurbished laptops to Indian businesses.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(container.querySelector('.authwrap')).toBeNull();
  });

  it('drops the panel for a full-width decision', () => {
    const { container } = render(
      <AuthShell title="Not approved" lede="The reviewer’s reason." wide>
        <p>panel</p>
      </AuthShell>,
    );
    expect(container.querySelector('.sup-signup-card--solo')).not.toBeNull();
    expect(container.querySelector('.sup-signup-brand')).toBeNull();
  });
});
