import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({ saveStep: vi.fn(), completeStep: vi.fn() }));
vi.mock('../../../../../storefront/src/app/register/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

const auth = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/auth', () => auth);

import { StockSection } from './sections/StockSection';

const BRANDS = ['Dell', 'HP', 'Lenovo', 'Apple'];

beforeEach(() => {
  api.saveStep.mockReset();
  api.completeStep.mockReset();
  auth.apiFetch.mockReset();
  auth.apiFetch.mockResolvedValue({ json: () => Promise.resolve(BRANDS.map((name) => ({ name }))) });
});

const pressed = (name: string | RegExp): boolean =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true';

/**
 * A supplier who stocks everything had to press every brand chip in turn. "All"
 * picks the whole list in one press, and follows the list rather than being a
 * separate answer: unpicking one brand releases it, pressing it again clears.
 */
describe('the "All" chip on What you stock', () => {
  it('selects every brand on offer, with the count it stands for', async () => {
    render(<StockSection open onClose={() => {}} onSaved={() => {}} initial={{}} />);
    const all = await screen.findByRole('button', { name: /^All/ });
    expect(all).toHaveTextContent('4');
    expect(pressed(/^All/)).toBe(false);

    await userEvent.click(all);

    for (const brand of BRANDS) expect(pressed(brand)).toBe(true);
    expect(pressed(/^All/)).toBe(true);
  });

  it('releases when one brand is unpicked, and clears the lot when pressed again', async () => {
    render(<StockSection open onClose={() => {}} onSaved={() => {}} initial={{ brands: BRANDS }} />);
    await screen.findByRole('button', { name: 'Dell' });
    expect(pressed(/^All/)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'HP' }));
    expect(pressed(/^All/)).toBe(false);
    expect(pressed('Dell')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(pressed(/^All/)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    for (const brand of BRANDS) expect(pressed(brand)).toBe(false);
  });

  it('saves the full list, not a sentinel', async () => {
    api.saveStep.mockResolvedValue({ ok: true });
    api.completeStep.mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    render(<StockSection open onClose={() => {}} onSaved={onSaved} initial={{}} />);

    await userEvent.click(await screen.findByRole('button', { name: /^All/ }));
    await userEvent.click(screen.getByRole('button', { name: '11–50 / month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(await screen.findByText('Yes — we can ship direct'));
    await userEvent.click(screen.getByRole('button', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('button', { name: 'Save' });
    expect(api.saveStep).toHaveBeenCalledWith(
      'CAPABILITY',
      expect.objectContaining({ brands: BRANDS }),
      100,
    );
  });
});
