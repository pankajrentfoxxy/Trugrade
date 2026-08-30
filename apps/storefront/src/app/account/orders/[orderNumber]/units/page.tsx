/**
 * ARCHETYPE B — Board. Filter + data table + row actions.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The per-serial QC results for what was actually shipped —
 * `03_UX_SPEC.md` §3A.3, `/account/orders/[id]/units`. The first of the four
 * sub-routes hanging off the order record; the tab strip that reaches it lives
 * in the record's layout, so `/documents`, `/tracking` and `/delivery` inherit
 * it rather than each growing their own.
 *
 * **This screen is made entirely of measurements, which makes one rule do most
 * of the work: a missing value never renders as a passing one.** A battery that
 * was never read is "Not measured" in `--ink-4` — never a dash, never an empty
 * cell, never a zero bar, and in the CSV never a blank, because a blank battery
 * column gets a zero the moment somebody averages it in a spreadsheet. The same
 * for an unscored inspection, an ungraded machine and a unit with no seal
 * recorded. There is one machine on this database with no battery reading and it
 * exists to keep that honest.
 *
 * **Grades stay neutral; green and red stay verdicts.** A+, A and B are all
 * sellable, so the grade badge is `--sheet-2` and ink in every row. This screen
 * is one of the few that genuinely has a PASS/FAIL — the QC verdict — and a seal
 * that is either intact or broken, and those two are the only things here
 * allowed to be green or red.
 *
 * **Two grades per row when they disagree.** The order line was priced at one
 * grade; the inspection concluded another. Both are shown, struck through and
 * corrected, because the buyer keeping this as their asset register is the
 * person who most needs to see a downgrade that happened after they paid.
 *
 * **There is no vendor anywhere.** The endpoint behind it reads neither
 * `procurement.purchase_order` nor `listing.unit`; QC comes back through the
 * `qc` module's own allow-list, which carries no technician, no visit and no
 * photo key. There is no field on the payload a vendor identifier could travel
 * in, so there is nothing on this screen to omit.
 *
 * The one amber action is the export, because the asset register is the one
 * thing a buyer comes here to take away. Sort and filter live in the URL: "the
 * machines on this order that need a look, worst battery first" has to survive
 * being sent to a colleague.
 */
import type { Metadata } from 'next';
import { UnitsBoard } from './UnitsBoard';

/** One organisation's machines. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Machines on your order',
  robots: { index: false, follow: false },
};

export default async function OrderUnitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [{ orderNumber }, search] = await Promise.all([params, searchParams]);
  // Rebuilt from the resolved params rather than passed as an object, so the
  // board's only source of state is a string it can round-trip through the URL.
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
        <UnitsBoard orderNumber={decodeURIComponent(orderNumber)} query={query} />
      </div>
    </div>
  );
}
