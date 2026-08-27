import type { Metadata } from 'next';
import { getBrands, getStats, getStepDefinitions } from '../../../lib/api';
import { SiteHeader } from '../../SiteHeader';
import { VendorRegistration } from './VendorRegistration';

/**
 * **Archetype D — Flow.** Step rail, one step, "why we ask" rail.
 *
 * The seven vendor steps are seeded rows in `kyc.onboarding_step_definition`, so
 * this page fetches them rather than listing them: the rail, the titles, the
 * purpose notes and the durations are all the API's, and a step added there
 * appears here without a release. Same page, same shell and same endpoint as the
 * five-step buyer flow at `/register` — `orgType` is the whole difference.
 *
 * The page is a server component so the rail renders in the HTML on first paint;
 * everything that needs a session, a code or a draft is in `VendorRegistration`,
 * which is the client half.
 */

export const metadata: Metadata = {
  title: 'Become a Trugrade supplier',
  description:
    'Register as a Trugrade supplier: verify your mobile and email, tell us what you deal in, and finish the KYC steps whenever suits you.',
};

/** The definitions change with a policy decision, not with stock. */
export const revalidate = 300;

export default async function Page(): Promise<React.JSX.Element> {
  const [stats, definitions, brands] = await Promise.all([
    getStats(),
    getStepDefinitions('VENDOR'),
    getBrands(),
  ]);

  return (
    <>
      <SiteHeader inspected={stats ? stats.unitsInspected : null} />

      <div className="body">
        <div className="wrap">
          <VendorRegistration
            definitions={definitions}
            brands={brands ? brands.map((b) => b.name) : null}
          />
        </div>
      </div>
    </>
  );
}
