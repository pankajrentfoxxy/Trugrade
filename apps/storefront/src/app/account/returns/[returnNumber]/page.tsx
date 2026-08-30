/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Track a return — `03_UX_SPEC.md` §3A.4, `/account/returns/[id]`.
 *
 * **The history is built only from instants the platform actually recorded.** A
 * return carries one today: when it was raised. `platform.return_request` has no
 * event table and no writer for pickup, receipt or inspection — those columns and
 * `platform.return_qc` are empty, with nothing writing them anywhere in the
 * codebase. So this screen draws one step and says the rest has not happened
 * yet. A fabricated "collected" row would be the timeline equivalent of a
 * missing measurement rendered as a tick, and on a screen whose whole subject is
 * a promise about a refund it would be the worst possible place for one.
 *
 * The same rule governs the refund date. §3A.4 says the refund timeline is
 * stated in working days and honoured; there is no configured refund period on
 * this platform and no `payment.credit_note` writer, so this screen states what
 * happens rather than inventing a date it cannot keep.
 *
 * **A return in progress is not amber and not green.** Green and red are PASS
 * and FAIL; "we have your machine and are looking at it" is neither. The only
 * red here is a rejection, which genuinely is a verdict.
 */
import type { Metadata } from 'next';
import { ReturnRecord } from './ReturnRecord';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your return',
  robots: { index: false, follow: false },
};

export default async function ReturnRecordPage({
  params,
}: {
  params: Promise<{ returnNumber: string }>;
}): Promise<React.JSX.Element> {
  const { returnNumber } = await params;
  return (
    <div className="body">
      <div className="wrap">
        <ReturnRecord returnNumber={decodeURIComponent(returnNumber)} />
      </div>
    </div>
  );
}
