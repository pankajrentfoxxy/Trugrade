import * as React from 'react';
import { Link } from 'react-router';
import { BRAND } from '@trugrade/config/brand';
import { Skeleton } from '@trugrade/ui';
import type { StepDefinition } from '../../../../storefront/src/app/register/api';
import { VendorRegistration } from '../../../../storefront/src/app/sell/register/VendorRegistration';

/**
 * ARCHETYPE D — Flow. Step rail, one step, "why we ask" rail.
 *
 * Vendor onboarding lives on the console, not the storefront. Suppliers sign in
 * here eventually anyway; keeping registration on the shop split the flow across
 * two origins and two cookie contexts for no gain.
 */

interface BrandSummary {
  name: string;
}

interface GradeDefinition {
  grade: string;
  customerDescription: string;
}

interface Bootstrap {
  definitions: StepDefinition[] | null;
  brands: string[] | null;
  grades: { grade: string; customerDescription: string }[] | null;
}

async function loadBootstrap(): Promise<Bootstrap> {
  const [definitionsRes, brandsRes, gradesRes] = await Promise.all([
    fetch('/api/onboarding/steps/definitions?orgType=VENDOR', { credentials: 'include' }),
    fetch('/api/public/brands', { credentials: 'include' }),
    fetch('/api/public/grades', { credentials: 'include' }),
  ]);

  const definitions = definitionsRes.ok
    ? ((await definitionsRes.json()) as StepDefinition[])
    : null;
  const brands = brandsRes.ok ? ((await brandsRes.json()) as BrandSummary[]).map((b) => b.name) : null;
  const grades = gradesRes.ok
    ? ((await gradesRes.json()) as GradeDefinition[]).map((g) => ({
        grade: g.grade,
        customerDescription: g.customerDescription,
      }))
    : null;

  return { definitions, brands, grades };
}

export function VendorRegisterRoute(): React.JSX.Element {
  const [bootstrap, setBootstrap] = React.useState<Bootstrap | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await loadBootstrap();
      if (!cancelled) setBootstrap(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-full bg-bg">
      <header className="border-b border-rule bg-chrome px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link to="/login" className="text-h3 text-on-chrome no-underline">
            tru<span className="text-acc">grade</span>
          </Link>
          <p className="text-body-sm text-on-chrome/70">
            Already have an account?{' '}
            <Link to="/login" className="text-acc underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {!bootstrap ? (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading registration">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
              <Skeleton className="h-96" />
              <Skeleton className="h-96" />
            </div>
          </div>
        ) : (
          <VendorRegistration
            definitions={bootstrap.definitions}
            brands={bootstrap.brands}
            grades={bootstrap.grades}
            wrongAccountAction={{ href: '/login', label: 'Back to sign in' }}
          />
        )}
      </main>

      <footer className="border-t border-rule px-6 py-4 text-center text-body-sm text-ink-3">
        Buyers shop on the storefront — only suppliers and {BRAND.name} staff use this console.
      </footer>
    </div>
  );
}
