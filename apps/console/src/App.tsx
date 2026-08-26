import * as React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router';
import { BRAND } from '@trugrade/config/brand';
import { Logo } from '@trugrade/ui';
import { AuthProvider, RequirePermission, useAuth } from './lib/auth';
import { LoginRoute } from './routes/Login';
import { ReviewQueueRoute } from './routes/ReviewQueue';
import { VendorReviewRoute } from './routes/VendorReview';

const NAV = [
  { to: '/kyc', label: 'KYC queue', permission: 'kyc.review' },
  { to: '/vendors', label: 'Vendors', permission: 'vendor.read' },
] as const;

function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { principal, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-container items-center gap-6 px-5 py-3">
          <Logo />
          <nav className="flex gap-1" aria-label="Sections">
            {NAV.filter((n) => principal?.permissions.includes(n.permission)).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  [
                    'rounded px-3 py-1.5 text-body-sm transition-colors',
                    isActive ? 'bg-acc-wash text-acc-hi' : 'text-ink-2 hover:bg-sheet-2',
                  ].join(' ')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              {principal?.orgType}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-body-sm text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-container px-5 py-7">{children}</main>
      <footer className="mx-auto max-w-container px-5 pb-7 text-body-sm text-ink-3">
        {BRAND.legalEntity}
      </footer>
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/kyc"
            element={
              <RequirePermission permission="kyc.review">
                <Shell>
                  <ReviewQueueRoute />
                </Shell>
              </RequirePermission>
            }
          />
          <Route
            path="/kyc/:orgId"
            element={
              <RequirePermission permission="kyc.review">
                <Shell>
                  <VendorReviewRoute />
                </Shell>
              </RequirePermission>
            }
          />
          <Route path="/" element={<Navigate to="/kyc" replace />} />
          <Route path="*" element={<Navigate to="/kyc" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
