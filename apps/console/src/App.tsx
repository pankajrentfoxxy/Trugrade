import * as React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { AuthProvider, RequirePermission, useAuth } from './lib/auth';
import { CatalogTreeRoute } from './routes/CatalogTree';
import { ConditionImageCoverageRoute } from './routes/ConditionImageCoverage';
import { LoginRoute } from './routes/Login';
import { OpsOverviewRoute, RequirePlatform } from './routes/OpsOverview';
import { ReviewQueueRoute } from './routes/ReviewQueue';
import { PricingRulesRoute } from './routes/PricingRules';
import { SkuRecordRoute } from './routes/SkuRecord';
import { SkuRequestsRoute } from './routes/SkuRequests';
import { VendorReviewRoute } from './routes/VendorReview';
import { opsRoutes } from './routes/ops';
import { platformRoutes } from './routes/platform';
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
          {/*
            T34. `RequirePlatform` and not `RequirePermission`: the overview has
            no single permission, and gating it on one would hide it from staff
            who each have a real slice of it. See `OpsOverview.tsx`.
          */}
          <Route
            path="/overview"
            element={
              <RequirePlatform>
                <Shell>
                  <OpsOverviewRoute />
                </Shell>
              </RequirePlatform>
            }
          />
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
          {/*
            Declared before `/catalog/condition-images` for no routing reason —
            react-router 7 ranks static above dynamic — but it reads in tree
            order, which is how somebody looking for the SKU record finds it.
          */}
          <Route
            path="/catalog/skus/:id"
            element={
              <RequirePermission permission="catalog.sku.read">
                <Shell>
                  <SkuRecordRoute />
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
            `listing.price.override` guards a READ here, which is unusual and is
            the narrower of the two honest choices: §3C.2 gives this screen to
            ADMIN_PRICING and ADMIN_SUPER, and that pair is exactly who holds it.
            `listing.any.read` also reaches OPS_MANAGER, QC_MANAGER, CATALOG_ADMIN
            and TECHNICIAN, and the room contains what we keep on every machine.
          */}
          <Route
            path="/pricing/rules"
            element={
              <RequirePermission permission="listing.price.override">
                <Shell>
                  <PricingRulesRoute />
                </Shell>
              </RequirePermission>
            }
          />

          {/*
            T39. The ops barrel hands back elements bare, exactly as the QC one
            does, so guarding and chroming them stays the shell's business. Both
            permissions are `*.any.*`, which no vendor or buyer role holds.
          */}
          {opsRoutes.map((r) => (
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

          {/*
            T40 and T41. Same shape as the QC and ops barrels: the elements come
            back bare and the guard and the chrome are applied here.
          */}
          {platformRoutes.map((r) => (
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

          <Route path="/" element={<Landing />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
