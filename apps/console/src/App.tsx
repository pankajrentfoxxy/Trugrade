import * as React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router';
import { BRAND } from '@trugrade/config/brand';
import { Logo } from '@trugrade/ui';
import { AuthProvider, RequirePermission, useAuth } from './lib/auth';
import { CatalogTreeRoute } from './routes/CatalogTree';
import { ConditionImageCoverageRoute } from './routes/ConditionImageCoverage';
import { LoginRoute } from './routes/Login';
import { ReviewQueueRoute } from './routes/ReviewQueue';
import { SkuRequestsRoute } from './routes/SkuRequests';
import { VendorReviewRoute } from './routes/VendorReview';

const NAV = [
  { to: '/kyc', label: 'KYC queue', permission: 'kyc.review' },
  { to: '/vendors', label: 'Vendors', permission: 'vendor.read' },
  { to: '/catalog', label: 'Catalog', permission: 'catalog.sku.read' },
  {
    to: '/catalog/condition-images',
    label: 'Image coverage',
    permission: 'catalog.condition_image.write',
  },
  { to: '/catalog/sku-requests', label: 'SKU requests', permission: 'catalog.sku_request.review' },
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

/**
 * Where signing in actually lands you.
 *
 * Redirecting everyone to /kyc sent a CATALOG_ADMIN — whose role carries no
 * kyc permission at all — straight to the permission-denied screen on their
 * first page load. The landing route follows the same NAV list the header
 * renders, so a role can only be sent somewhere it can actually go.
 */
function Landing(): React.JSX.Element {
  const { principal, loading } = useAuth();
  if (loading) return <div className="p-6 text-ink-2">Checking your session…</div>;
  if (!principal) return <Navigate to="/login" replace />;

  const first = NAV.find((n) => principal.permissions.includes(n.permission));
  if (!first) {
    // A signed-in account with no section at all is a role-assignment mistake,
    // and saying so beats an endless redirect between two screens.
    return (
      <div className="mx-auto max-w-container p-6">
        <h1 className="text-h2 text-ink">Your account has no sections yet</h1>
        <p className="mt-3 text-body text-ink-2">
          Ask an administrator to assign you a role. Nothing is wrong with your sign-in.
        </p>
      </div>
    );
  }
  return <Navigate to={first.to} replace />;
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
          <Route
            path="/catalog"
            element={
              <RequirePermission permission="catalog.sku.read">
                <Shell>
                  <CatalogTreeRoute />
                </Shell>
              </RequirePermission>
            }
          />
          <Route
            path="/catalog/condition-images"
            element={
              <RequirePermission permission="catalog.condition_image.write">
                <Shell>
                  <ConditionImageCoverageRoute />
                </Shell>
              </RequirePermission>
            }
          />
          <Route
            path="/catalog/sku-requests"
            element={
              <RequirePermission permission="catalog.sku_request.review">
                <Shell>
                  <SkuRequestsRoute />
                </Shell>
              </RequirePermission>
            }
          />
          <Route path="/" element={<Landing />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
