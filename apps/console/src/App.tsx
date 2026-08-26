import * as React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { AuthProvider, RequirePermission, useAuth } from './lib/auth';
import { CatalogTreeRoute } from './routes/CatalogTree';
import { ConditionImageCoverageRoute } from './routes/ConditionImageCoverage';
import { LoginRoute } from './routes/Login';
import { ReviewQueueRoute } from './routes/ReviewQueue';
import { SkuRequestsRoute } from './routes/SkuRequests';
import { VendorReviewRoute } from './routes/VendorReview';
import { qcRoutes } from './routes/qc';
import { vendorRoutes } from './routes/vendor';
import { Shell } from './shell/Shell';
import { NAV, canSee } from './shell/nav';

/**
 * Where signing in actually lands you.
 *
 * Redirecting everyone to /kyc sent a CATALOG_ADMIN — whose role carries no
 * kyc permission at all — straight to the permission-denied screen on their
 * first page load. The landing route follows the same NAV list the chrome
 * renders, so a role can only be sent somewhere it can actually go: a TECHNICIAN
 * lands on the visit board, a VENDOR_ADMIN on their listings, and neither of them
 * holds a single one of the five permissions this list started with.
 */
function Landing(): React.JSX.Element {
  const { principal, loading } = useAuth();
  if (loading) return <div className="p-6 text-ink-2">Checking your session…</div>;
  if (!principal) return <Navigate to="/login" replace />;

  const first = NAV.find((n) => canSee(n, principal));
  if (!first) {
    // A signed-in account with no section at all is a role-assignment mistake,
    // and saying so beats an endless redirect between two screens.
    return (
      <Shell>
        <h1 className="text-h2 text-ink">Your account has no sections yet</h1>
        <p className="mt-3 text-body text-ink-2">
          Ask an administrator to assign you a role. Nothing is wrong with your sign-in.
        </p>
      </Shell>
    );
  }
  return <Navigate to={first.to} replace />;
}

export function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/*
            The one route that is deliberately NOT in the shell: signing in is
            archetype F — one task, centred, no navigation. Chrome offering
            sections you cannot reach yet is noise.
          */}
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/kyc"
            element={
              <RequirePermission permission="kyc.application.read">
                <Shell>
                  <ReviewQueueRoute />
                </Shell>
              </RequirePermission>
            }
          />
          <Route
            path="/kyc/:orgId"
            element={
              <RequirePermission permission="kyc.application.read">
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

          {/*
            The QC barrel hands back elements bare — guarding and chroming them is
            the shell's business, so both wrappers go on here.
          */}
          {qcRoutes.map((r) => (
            <Route
              key={r.path}
              path={r.path}
              element={
                <RequirePermission permission={r.permission}>
                  <Shell>{r.element}</Shell>
                </RequirePermission>
              }
            />
          ))}

          {/*
            The vendor barrel's elements already carry their own
            `RequirePermission`, so wrapping them again would only render the
            same check twice. Array order is preserved as that barrel asks —
            `/vendor/listings/new` before `/vendor/listings/:id` — even though
            react-router 7 ranks a static segment above a dynamic one anyway.
          */}
          {vendorRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={<Shell>{r.element}</Shell>} />
          ))}

          <Route path="/" element={<Landing />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
