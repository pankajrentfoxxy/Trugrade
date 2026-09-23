import { OrderChrome } from './OrderChrome';

/**
 * The order's chrome — header, progress, next step and sub-navigation — and
 * nothing else.
 *
 * `03_UX_SPEC.md` §3A.3 hangs five sub-routes off this record — `/sales-order`,
 * `/units`, `/documents`, `/tracking`, `/delivery` — and they all need the same
 * way back to each other, and the same identity above them, so both belong here
 * rather than on any one page. `OrderChrome` reads the order once for all of it.
 *
 * **`SiteHeader` is deliberately absent.** `/layout.tsx` already renders
 * it for everything under `/home`, and this file rendered a second one from
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
  return <OrderChrome orderNumber={decodeURIComponent(orderNumber)}>{children}</OrderChrome>;
}
