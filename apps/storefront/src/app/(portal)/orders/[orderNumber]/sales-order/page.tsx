/**
 * ARCHETYPE C — Record. The booking as the dispatch points confirmed it.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The booking order (the record itself) is what the buyer asked for. This is
 * what they will be invoiced for: each line's confirmed quantity, priced, with
 * GST and freight, and the payment against it. Until every dispatch point has
 * answered there is no sales order to show, and the screen says so rather than
 * totalling a partly answered one.
 */
import type { Metadata } from 'next';
import { SalesOrder } from './SalesOrder';

/** One organisation's order. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sales order',
  robots: { index: false, follow: false },
};

export default async function SalesOrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}): Promise<React.JSX.Element> {
  const { orderNumber } = await params;
  return (
    <div className="hub-page">
      <SalesOrder orderNumber={decodeURIComponent(orderNumber)} />
    </div>
  );
}
