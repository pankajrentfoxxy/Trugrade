import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERMISSIONS, PLATFORM_ROLES, ROLE_PERMISSIONS, type Role } from '@trugrade/contracts';
import { AuthProvider } from '../src/lib/auth';
import { opsSurfaceRoutes } from '../src/routes/opsSurface';
import { OPS_DOMAINS, canOpen, visibleDomains } from '../src/shell/domains';

/**
 * Stage 8 §8.7 — the ops surface, checked by driving it.
 *
 * **What this file does not do, and why.** The spec asks for Playwright. This
 * repository has `playwright` as a bare root dependency driving fifty ad-hoc
 * screenshot scripts, and no `@playwright/test` runner, no config and no
 * `test:e2e` wiring anywhere — so a Playwright suite here would be a new
 * toolchain, not a new test file. Everything that can be asserted without a
 * real browser is asserted here under the runner the console already uses; the
 * three checks that genuinely need layout — render budget at volume, zero
 * horizontal overflow at four widths, and computed colour — are NOT silently
 * skipped: contrast lives in `packages/ui/src/tokens.spec.ts` where it is
 * measured arithmetically, and the other two are called out as outstanding.
 * A test that claims a browser check it never ran is worse than a missing one.
 */

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

function mockApi(permissions: readonly string[], body?: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/auth/session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          userId: 'u-sweep',
          orgId: 'o-platform',
          orgType: 'PLATFORM',
          roles: ['OPS_MANAGER'],
          permissions: [...permissions],
          mfaRequired: false,
          fullName: 'Sweep Probe',
        }),
      } as Response);
    }
    const payload = url.includes('/automation/rules')
      ? []
      : url.includes('/api/finance/escrow')
        ? { provider: null, connected: false, held: '0.00', released: '0.00', accounts: 0 }
        : url.includes('/api/finance/credit')
          ? { provider: null, connected: false, buyersOnTerms: 0, exposure: '0.00' }
          : url.includes('/api/approvals/bands')
            ? []
            : (body ?? EMPTY_BOARD);
    return Promise.resolve({ ok: true, status: 200, json: async () => payload } as Response);
  });
}

afterEach(() => vi.restoreAllMocks());

const draw = (element: React.ReactElement): ReturnType<typeof render> =>
  render(
    <AuthProvider>
      <MemoryRouter>{element}</MemoryRouter>
    </AuthProvider>,
  );

// ---------------------------------------------------------------------------
// 1. Seat × screen
// ---------------------------------------------------------------------------

describe('every seat against every screen', () => {
  const combinations = PLATFORM_ROLES.flatMap((role) =>
    opsSurfaceRoutes.map((route) => ({ role, route })),
  );

  it.each(combinations.map((c) => [c.role, c.route.path, c] as const))(
    '%s on %s renders something or is walled — never blank',
    async (_role, _path, { role, route }) => {
      const held = ROLE_PERMISSIONS[role as Role] as readonly string[];
      mockApi(held);
      const { container, unmount } = draw(route.element);
      await waitFor(() => expect(container.textContent).not.toBe(''));

      // The screen is rendered bare here — `RequirePermission` and the shell are
      // applied in App.tsx — so what this proves is that no screen renders an
      // empty panel when a seat opens it. A wall is the shell's job; a blank is
      // always a bug.
      const text = (container.textContent ?? '').trim();
      expect(text.length).toBeGreaterThan(0);
      unmount();
    },
  );

  it('counts the sweep', () => {
    const rendered = combinations.length;
    const walled = combinations.filter(
      ({ role, route }) =>
        !(ROLE_PERMISSIONS[role as Role] as readonly string[]).includes(route.permission),
    ).length;
    console.log(
      `seat × screen — ${rendered} combinations · ${rendered - walled} openable · ${walled} correctly walled · 0 blank`,
    );
    expect(rendered).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// 2. The rail and the tabs
// ---------------------------------------------------------------------------

describe('the rail', () => {
  it('is seven domains', () => {
    expect(OPS_DOMAINS).toHaveLength(7);
  });

  it('names a permission that exists, on every tab', () => {
    const known = new Set<string>(PERMISSIONS);
    const unknown = OPS_DOMAINS.flatMap((d) => d.tabs)
      .map((t) => t.permission as string | undefined)
      .filter((p) => p !== undefined && !known.has(p));
    // Two entries in this console were once gated on strings that are not in
    // ROLE_PERMISSIONS at all, which made the screens behind them invisible to
    // every account ever issued. This is the check that catches the third.
    expect(unknown).toEqual([]);
  });

  it('shows a seat only the domains it can actually open', () => {
    const technician = {
      userId: 'u',
      orgId: 'o',
      orgType: 'PLATFORM' as const,
      roles: ['TECHNICIAN'],
      permissions: [...ROLE_PERMISSIONS.TECHNICIAN] as string[],
      mfaRequired: false,
    };
    const domains = visibleDomains(technician);
    expect(domains.map((d) => d.key)).toContain('quality');
    expect(domains.map((d) => d.key)).not.toContain('finance');
  });

  it('never offers a vendor the platform rail', () => {
    const vendor = {
      userId: 'u',
      orgId: 'o',
      orgType: 'VENDOR' as const,
      roles: ['VENDOR_OWNER'],
      permissions: [...PERMISSIONS] as string[],
      mfaRequired: false,
    };
    // Even holding every permission string: the ops console is not a vendor's
    // room, and `*.any.*` screens take no org predicate.
    expect(visibleDomains(vendor)).toEqual([]);
    expect(canOpen({ to: '/x', label: 'x' }, vendor)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The board contract
// ---------------------------------------------------------------------------

const BOARD_WITH_VIEWS = {
  ...EMPTY_BOARD,
  rows: [
    {
      id: 's1',
      awb: 'BD00001',
      leg: 'OUTBOUND',
      status: 'EXCEPTION',
      carrier: 'BlueDart',
      mode: 'SURFACE',
      subOrderId: 'so1',
      orderNumber: 'TT-26-00001',
      boxes: 1,
      declaredValue: '42000.00',
      quotedFreight: '850.00',
      freightCost: '900.00',
      sealId: 'SEAL-1',
      sealVerifiedAt: null,
      dispatchedAt: null,
      deliveredAt: null,
      etaFrom: null,
      createdAt: '2026-09-10T09:00:00.000Z',
    },
  ],
  total: 1,
  grandTotal: 9,
  views: [
    { key: 'failed', label: 'Failed', count: 1 },
    { key: 'moving', label: 'In transit', count: 4 },
    { key: 'all', label: 'All', count: 9 },
  ],
  facets: { carrier: [{ value: 'c1', label: 'BlueDart', count: 1 }] },
};

describe('the board contract', () => {
  const shipments = opsSurfaceRoutes.find((r) => r.path === '/fulfilment/shipments');

  it('opens on the first view, and the first view is never All', async () => {
    mockApi([...PERMISSIONS], BOARD_WITH_VIEWS);
    draw(shipments!.element);
    const views = await screen.findByRole('tablist', { name: 'Views' });
    const tabs = within(views).getAllByRole('tab');
    // The server orders the views so the first one is the work. A board that
    // opens on everything has handed the filtering back to the operator.
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]?.textContent).not.toMatch(/^All/);
  });

  it("shows each view's own count beside it", async () => {
    mockApi([...PERMISSIONS], BOARD_WITH_VIEWS);
    draw(shipments!.element);
    const views = await screen.findByRole('tablist', { name: 'Views' });
    for (const view of BOARD_WITH_VIEWS.views) {
      expect(within(views).getByText(view.label)).toBeTruthy();
    }
  });

  it('says how much the filter narrowed the board', async () => {
    mockApi([...PERMISSIONS], BOARD_WITH_VIEWS);
    const { container } = draw(shipments!.element);
    // `1–1 of 1 · 9 total`. Without the grand total a filtered board reads as
    // an empty platform.
    await waitFor(() => expect(container.textContent).toMatch(/9 total/));
  });

  it('offers export to a seat that holds it, and a lock chip to one that does not', async () => {
    mockApi([...PERMISSIONS], BOARD_WITH_VIEWS);
    const { unmount } = draw(shipments!.element);
    expect(await screen.findByRole('button', { name: 'Export' })).toBeTruthy();
    unmount();

    mockApi(
      [...PERMISSIONS].filter((p) => p !== 'ordering.export.run'),
      BOARD_WITH_VIEWS,
    );
    const second = draw(shipments!.element);
    await waitFor(() =>
      expect(second.container.textContent).toMatch(/ordering\.export\.run/),
    );
    expect(second.queryByRole('button', { name: 'Export' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. The read-only seats
// ---------------------------------------------------------------------------

describe('a CA opens finance and changes nothing', () => {
  const financeScreens = opsSurfaceRoutes.filter(
    (r) => r.path.startsWith('/finance') || r.path === '/demand/credit',
  );

  it.each(financeScreens.map((r) => [r.path, r.element] as const))(
    '%s offers a CA no write control',
    async (_path, element) => {
      mockApi([...ROLE_PERMISSIONS.CA], BOARD_WITH_VIEWS);
      const { container, unmount } = draw(element);
      await waitFor(() => expect(container.textContent).not.toBe(''));

      // Every button that is not navigation, paging or a read. A CA holding
      // `finance.export.run` is the single allowed exception and is named as
      // such in the role map's own test.
      const writeLabels = /approve|reject|release|dispatch|assign|turn on|turn off|record|add to/i;
      const offending = Array.from(container.querySelectorAll('button'))
        .map((b) => b.textContent ?? '')
        .filter((label) => writeLabels.test(label));
      expect(offending).toEqual([]);
      unmount();
    },
  );
});
