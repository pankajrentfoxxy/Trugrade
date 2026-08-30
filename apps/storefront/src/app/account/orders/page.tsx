/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Every order the buyer's organisation has placed — 03_UX_SPEC.md §3A.3
 * `/account/orders`.
 *
 * **The whole of the board's state is in the URL** — the search term, the
 * status, the delivery site, the sort, the page and the page size. There is no
 * state library and no client store, because a buyer must be able to send a
 * colleague a link that reproduces exactly what they saw, and once that is true
 * a store has nothing left to hold. This page reads `searchParams` on the
 * server and hands the query string down as a prop, so what the board renders
 * on first paint is already what the address bar says; the client only ever
 * pushes the router.
 *
 * **The vocabulary is T17's, deliberately.** An order is an order, a machine is
 * a machine, "your PO reference" is the buyer's own document, and a dispatch
 * point is `Supply Point F · Noida`. Nothing here invents a second way of
 * saying a fact the order screen already says — a list and a record that
 * disagree about what a thing is called is how a buyer stops trusting either.
 *
 * **The one search box takes three different numbers.** Ours (`TT-26-00004`),
 * theirs (their procurement system's PO reference, which prints on our
 * invoice), and a machine's serial. A person holding one of the three does not
 * reliably know which it is, and three boxes would make them guess. When a
 * serial matches, the row says which serial matched — a result with no visible
 * reason reads as a mistake.
 *
 * **Our purchase order to a supply point is not on this screen and could not
 * be.** No buyer-reachable endpoint reads `procurement.purchase_order`
 * (PHASE_06 Task 6), so there is no field on the payload to omit. The absence
 * is structural, as T17 made it.
 */
import type { Metadata } from 'next';
import { OrdersBoard } from './OrdersBoard';

/** Board state is per-request by definition; a cached board is another board. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your orders',
  robots: { index: false, follow: false },
};

function toQueryString(params: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) if (v !== '') qs.append(key, v);
  }
  return qs.toString();
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return (
    <div className="body">
      <div className="wrap">
        <OrdersBoard query={toQueryString(params)} />
      </div>
    </div>
  );
}
