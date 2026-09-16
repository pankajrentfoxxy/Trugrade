/**
 * ARCHETYPE C — Record. Where each consignment on this order has got to.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * `03_UX_SPEC.md` §3A.3 hangs this off the order record, `OrderNav`'s own doc
 * comment names it, and the record's layout names it — and the route did not
 * exist, so two comments promised a 404.
 *
 * See `Tracking.tsx` for what this screen deliberately does not show, and why:
 * `logistics.shipment` models a carrier, an AWB and an ETA, and has zero rows
 * and no writer anywhere in this product.
 */
import type { Metadata } from 'next';
import { Tracking } from './Tracking';

/** One organisation's order. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Track this order',
  robots: { index: false, follow: false },
};

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}): Promise<React.JSX.Element> {
  const { orderNumber } = await params;
  return (
    <div className="hub-page">
      <Tracking orderNumber={decodeURIComponent(orderNumber)} />
    </div>
  );
}
