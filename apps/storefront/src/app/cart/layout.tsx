import { getStats } from '../../lib/api';
import { SiteHeader } from '../SiteHeader';

/** The chrome, in the layout, exactly as `/search` and `/laptops/[slug]` do it. */
export default async function CartLayout({
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
