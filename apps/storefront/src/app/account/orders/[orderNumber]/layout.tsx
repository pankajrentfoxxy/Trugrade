import { OrderNav } from './OrderNav';

/**
 * The record's sub-navigation, and nothing else.
 *
 * `03_UX_SPEC.md` §3A.3 hangs four sub-routes off this record — `/units`,
 * `/documents`, `/tracking`, `/delivery` — and they all need the same way back
 * to each other, so the nav belongs here rather than on any one page.
 *
 * **`SiteHeader` is deliberately absent.** `/account/layout.tsx` already renders
 * it for everything under `/account`, and this file rendered a second one from
 * the moment the order record moved here from `/orders/[orderNumber]` — the
 * whole utility bar and header drawn twice, on every order screen. A layout that
 * nests inside another layout inherits its chrome; it does not restate it.
 */
export default async function OrderLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orderNumber: string }>;
}): Promise<React.JSX.Element> {
  const { orderNumber } = await params;
  return (
    <>
      <div className="wrap">
        <OrderNav orderNumber={decodeURIComponent(orderNumber)} />
      </div>
      {children}
    </>
  );
}
