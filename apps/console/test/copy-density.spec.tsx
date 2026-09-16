import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERMISSIONS } from '@trugrade/contracts';
import { AuthProvider } from '../src/lib/auth';
import { opsSurfaceRoutes } from '../src/routes/opsSurface';

/**
 * Chrome copy is everything on a screen that is not data.
 *
 * Strip the table body, strip the metric values, strip the monospace
 * identifiers, and what is left is what we wrote. The user's verdict on the
 * first draft of these screens was blunt and correct: *"everywhere there is a
 * lot of comment and text showing which is too explanatory."* Every one of
 * those notes was written to prove the permission model worked; on a screen an
 * operator opens forty times a day they are noise, and they are the reason the
 * panel read as cluttered rather than dense.
 *
 * **A screen needing more than 60 words of chrome is explaining itself instead
 * of showing something.** The budget is deliberately generous: the point is to
 * catch the paragraph, not to police a label.
 *
 * Every screen is measured with EVERY permission held, which is the worst case
 * — nothing is hidden behind a guard, so every control's label counts.
 */

const BUDGET = 60;
const ALL: string[] = [...PERMISSIONS];

/** Every board answers with an empty envelope; copy is what is left when data is not there. */
const EMPTY_BOARD = {
  rows: [],
  page: 1,
  per: 40,
  total: 0,
  pages: 1,
  grandTotal: 0,
  views: [],
  facets: {},
};

function mockApi(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const payload = url.includes('/api/auth/session')
      ? {
          userId: 'u-density',
          orgId: 'o-platform',
          orgType: 'PLATFORM',
          roles: ['PLATFORM_SUPERADMIN'],
          permissions: ALL,
          mfaRequired: false,
          fullName: 'Density Probe',
        }
      : url.includes('/automation/rules')
        ? []
        : url.includes('/api/finance/escrow')
          ? { provider: null, connected: false, held: '0.00', released: '0.00', accounts: 0 }
          : url.includes('/api/finance/credit')
            ? { provider: null, connected: false, buyersOnTerms: 0, exposure: '0.00' }
            : url.includes('/api/approvals/bands')
              ? []
              : EMPTY_BOARD;
    return Promise.resolve({ ok: true, status: 200, json: async () => payload } as Response);
  });
}

afterEach(() => vi.restoreAllMocks());

async function chromeWords(element: React.ReactElement): Promise<number> {
  mockApi();
  const { container, unmount } = render(
    <AuthProvider>
      <MemoryRouter>{element}</MemoryRouter>
    </AuthProvider>,
  );
  // The screens fetch on mount; measuring before they settle measures a spinner.
  await waitFor(() => expect(container.textContent).not.toBe(''));

  const clone = container.cloneNode(true) as HTMLElement;
  // Rows, numbers and identifiers are the screen doing its job, not copy.
  clone.querySelectorAll('tbody, .mono, .tnum, code, pre, option').forEach((n) => n.remove());
  const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  unmount();
  return text ? text.split(' ').filter(Boolean).length : 0;
}

describe('the copy budget', () => {
  const measured: Array<[string, number]> = [];

  it.each(opsSurfaceRoutes.map((r) => [r.path, r.element] as const))(
    '%s stays inside its chrome budget',
    async (path, element) => {
      const words = await chromeWords(element);
      measured.push([path, words]);
      expect(words).toBeLessThanOrEqual(BUDGET);
    },
  );

  it('reports the average and the peak', () => {
    if (!measured.length) return;
    const total = measured.reduce((sum, [, n]) => sum + n, 0);
    const peak = measured.reduce((a, b) => (b[1] > a[1] ? b : a));
    // Printed rather than asserted: the trend is the thing to watch, and a
    // threshold on the average would punish the screen that legitimately has
    // more to say rather than the one that rambles.
    console.log(
      `chrome copy — avg ${(total / measured.length).toFixed(0)} words, peak ${peak[1]} on ${peak[0]}`,
    );
    expect(total / measured.length).toBeLessThanOrEqual(BUDGET);
  });
});
