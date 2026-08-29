import { getStats } from '../../lib/api';
import { SiteHeader } from '../SiteHeader';

/** The chrome, in the layout, exactly as `/cart` and `/search` do it. */
export default async function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const stats = await getStats();
  return (
    <>
      <SiteHeader inspected={stats ? stats.unitsInspected : null} />
      {children}
    </>
  );
}
