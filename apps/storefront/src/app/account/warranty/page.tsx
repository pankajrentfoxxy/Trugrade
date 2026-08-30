/**
 * ARCHETYPE B — Board. Filter + data table + row actions.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Warranty status for every machine the organisation owns —
 * `03_UX_SPEC.md` §3A.4, `/account/warranty`.
 *
 * **The distinction this screen exists to keep is between three things that a
 * lazy design collapses into two.** A machine can be *covered*, *out of cover*,
 * or *not covered yet* because it has not been delivered. The third is the one
 * that gets lost: rendering "no warranty" for a laptop that simply has not
 * arrived tells a facilities manager they bought something uncovered. So a null
 * term is drawn as "Cover starts on delivery" in `--ink-4` and never as an
 * expiry, and never as a tick.
 *
 * **Every date on this page was decided on the server.** `inWarranty`,
 * `daysRemaining` and `expiringSoon` arrive as fields. Nothing here subtracts
 * one date from another: a laptop clock three weeks fast would otherwise offer a
 * paid repair on a machine we owe a free one on, and the buyer would have no way
 * to know the page had lied to them.
 *
 * **Green and red stay verdicts.** A warranty that is running is not a PASS and
 * one that has ended is not a FAIL — a term expiring is the normal end of a
 * normal thing. Days remaining are amber, which is the accent's second meaning:
 * a measured value. Expired is neutral ink with the date beside it. The one red
 * on this screen would be a rejected claim, which is a refusal we have to own.
 *
 * The one amber action is "Start a claim", because that is the single thing a
 * buyer comes here to do. Board state lives in the URL: "the machines whose
 * cover ends in the next month" has to survive being sent to a colleague.
 */
import type { Metadata } from 'next';
import { WarrantyBoard } from './WarrantyBoard';

/** One organisation's machines. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Warranty',
  robots: { index: false, follow: false },
};

export default async function WarrantyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const search = await searchParams;
  const query = new URLSearchParams(
    Object.entries(search).flatMap(([k, v]) =>
      v === undefined
        ? []
        : Array.isArray(v)
          ? v.map((one) => [k, one] as [string, string])
          : [[k, v] as [string, string]],
    ),
  ).toString();

  return (
    <div className="body">
      <div className="wrap">
        <WarrantyBoard query={query} />
      </div>
    </div>
  );
}
