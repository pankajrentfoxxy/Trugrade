import type { Metadata } from 'next';
import { getStats, getStepDefinitions } from '../../lib/api';
import { SiteHeader } from '../SiteHeader';
import { RegisterFlow } from './RegisterFlow';

/**
 * **Archetype D — Flow.** Step rail, one step, "why we ask" rail.
 *
 * The five buyer steps are seeded rows in `kyc.onboarding_step_definition`, so
 * this page fetches them rather than listing them: the rail, the titles, the
 * purpose notes and the durations are all the API's, and a step added there
 * appears here without a release.
 *
 * The page is a server component so the rail renders in the HTML on first
 * paint; everything that needs a session, a code or a draft is in
 * `RegisterFlow`, which is the client half.
 */

export const metadata: Metadata = {
  title: 'Create a buyer account',
  description:
    'Open a Trugrade buyer account: verify your work email and mobile, tell us who you are, and finish the KYC steps whenever suits you.',
};

/** The definitions change with a policy decision, not with stock. */
export const revalidate = 300;

export default async function Page(): Promise<React.JSX.Element> {
  const [stats, definitions] = await Promise.all([getStats(), getStepDefinitions('BUYER')]);

  return (
    <>
      <SiteHeader inspected={stats ? stats.unitsInspected : null} />

      <div className="body">
        <div className="wrap">
          <RegisterFlow definitions={definitions} />
        </div>
      </div>
    </>
  );
}
