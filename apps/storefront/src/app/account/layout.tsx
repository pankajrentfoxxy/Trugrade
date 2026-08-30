import { getStats } from '../../lib/api';
import { SiteHeader } from '../SiteHeader';

/** The chrome, in the layout, exactly as `/cart`, `/checkout` and `/orders` do it. */
export default async function AccountLayout({
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
