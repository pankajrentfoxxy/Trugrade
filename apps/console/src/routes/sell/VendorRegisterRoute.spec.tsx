import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '../../lib/auth';
import { VendorRegisterRoute } from './VendorRegisterRoute';

/**
 * The one thing this wrapper does: hand `SupplierSignup` a callback that
 * RETURNS `syncSession()`'s promise rather than firing it and moving on.
 *
 * `SupplierSignup` awaits `onSessionEstablished` before it navigates to
 * `/vendor` — see its own spec — and that await is worthless if the promise
 * it is given already resolved before the real `GET /auth/session` call
 * finished. `void syncSession()` type-checks fine here (`undefined` satisfies
 * `Promise<void> | void`), so this is a contract only a test that actually
 * awaits the callback and watches for the fetch can hold.
 *
 * `SupplierSignup` itself renders no hook into this prop, and driving its
 * form to step 4 just to reach it is exactly what `SupplierSignup.spec.tsx`
 * already does — so it is mocked here down to a single input, and this file
 * stays about the one thing `VendorRegisterRoute` is responsible for: what it
 * hands `SupplierSignup`, not what `SupplierSignup` does with it.
 */
const { captured } = vi.hoisted(() => ({
  captured: { current: null as (() => Promise<void> | void) | null },
}));

vi.mock('./SupplierSignup', () => ({
  SupplierSignup: (props: { onSessionEstablished?: () => Promise<void> | void }) => {
    captured.current = props.onSessionEstablished ?? null;
    return React.createElement('input', { 'aria-label': 'Mobile number' });
  },
}));

function mockSession(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        userId: 'u1',
        orgId: 'o1',
        orgType: 'VENDOR',
        roles: ['VENDOR_OWNER'],
        permissions: [],
        mfaRequired: false,
      }),
    } as Response),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  captured.current = null;
});

describe('VendorRegisterRoute', () => {
  it('gives SupplierSignup a callback that awaits the real session fetch', async () => {
    mockSession();
    render(
      <AuthProvider>
        <MemoryRouter>
          <VendorRegisterRoute />
        </MemoryRouter>
      </AuthProvider>,
    );

    await screen.findByLabelText('Mobile number');
    // `AuthProvider`'s own mount call has to be fully settled — including the
    // `setPrincipal` it schedules — before the next assertion counts fetches
    // against a clean baseline.
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(0));
    if (!captured.current) throw new Error('onSessionEstablished was never captured');

    const callsBefore = vi.mocked(globalThis.fetch).mock.calls.length;
    let started: Promise<void> | void;
    // The callback resolves into a `setPrincipal` on `AuthProvider` — `act()`
    // is what keeps that update, and not just the fetch, inside React's
    // knowledge of what this test did.
    await act(async () => {
      started = captured.current!();
      await started;
    });
    expect(started!).toBeInstanceOf(Promise);

    // The callback made a fresh `/auth/session` call of its own — not a
    // no-op, and not a promise that was already settled before it was called.
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
