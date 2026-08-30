/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Track one warranty claim — `03_UX_SPEC.md` §3A.4,
 * `/account/warranty/claims/[id]`.
 *
 * **A claim in progress is not a verdict.** Green and red are PASS and FAIL, and
 * a claim moving through triage is neither — it is work happening. So every
 * intermediate status is neutral, `IN_REPAIR` is the processing tone, and only
 * the two ends get a colour: a rejection is a refusal we own, and a replacement
 * or a refund is genuinely a good outcome. Painting "raised" amber would make a
 * buyer whose laptop is simply in the queue think something had gone wrong.
 *
 * **A claim belonging to another organisation answers 404, not 403.** Claim
 * numbers carry a month and a counter, so "you may not see that one" would
 * confirm it exists. This screen shows the same page for a typo and for
 * somebody else's claim, deliberately.
 *
 * **There is no vendor here, at any depth** — not in the status history, not in
 * the fault text, not in a resolution. A buyer who learnt from their own claim
 * thread who supplied the machine would have learnt it from us.
 */
import type { Metadata } from 'next';
import { ClaimRecord } from './ClaimRecord';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your warranty claim',
  robots: { index: false, follow: false },
};

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ claimNumber: string }>;
}): Promise<React.JSX.Element> {
  const { claimNumber } = await params;
  return (
    <div className="body">
      <div className="wrap">
        <ClaimRecord claimNumber={decodeURIComponent(claimNumber)} />
      </div>
    </div>
  );
}
