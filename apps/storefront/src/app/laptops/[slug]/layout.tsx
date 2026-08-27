import { getStats } from '../../../lib/api';
import { SiteHeader } from '../../SiteHeader';

/**
 * The chrome lives in the layout, exactly as `/search` does it.
 *
 * `loading.tsx` replaces the page segment on every pincode and grade change,
 * and a header that disappears and comes back on each one is the page blinking
 * at the reader.
 */
export default async function ProductLayout({
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
