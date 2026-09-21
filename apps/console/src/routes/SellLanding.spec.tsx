/**
 * The supplier landing states rules, not claims. Each test pins one thing a
 * visitor relies on to the contract that enforces it, so a changed rule fails
 * the page rather than leaving stale copy.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QC_AREAS, VENDOR_NET_PAYOUT } from '@trugrade/contracts';
import { SellLanding } from './SellLanding';

const mount = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <SellLanding />
    </MemoryRouter>,
  );

describe('SellLanding', () => {
  it('has one primary action, and every route to selling lands on registration', () => {
    mount();
    const starts = screen.getAllByRole('link', { name: /start selling/i });
    expect(starts.length).toBeGreaterThan(0);
    for (const a of starts) expect(a).toHaveAttribute('href', '/sell/register');
    expect(screen.getByRole('link', { name: /sell on trugrade/i })).toHaveAttribute(
      'href',
      '/sell/register',
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('draws the inspection grid from QC_AREAS, numbered in its order', () => {
    mount();
    const grid = screen.getByLabelText(`The ${QC_AREAS.length} inspection areas`);
    const cells = within(grid).getAllByText(/^\d\d$/);
    expect(cells).toHaveLength(QC_AREAS.length);
    expect(cells[0]).toHaveTextContent('01');
    expect(within(grid).getByText('Chassis')).toBeInTheDocument();
    expect(within(grid).getByText('Thermals')).toBeInTheDocument();
  });

  it('states the payout band from VENDOR_NET_PAYOUT, grouped the Indian way', () => {
    mount();
    const min = `₹${VENDOR_NET_PAYOUT.min!.toLocaleString('en-IN')}`;
    const max = `₹${VENDOR_NET_PAYOUT.max!.toLocaleString('en-IN')}`;
    expect(screen.getByText('Payout per machine').parentElement).toHaveTextContent(
      `${min} to ${max}`,
    );
  });

  it('keeps the cartons on the belt decorative, so a screen reader hears the caption and not five serials', () => {
    mount();
    const belt = screen.getByLabelText(/Machines moving through/);
    const cartons = belt.querySelectorAll('.box');
    expect(cartons).toHaveLength(5);
    for (const c of cartons) expect(c.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(belt).getByText(/your named payout/)).toBeInTheDocument();
  });
});
