import { getStats } from '../../lib/api';
import { SiteHeader } from '../SiteHeader';

/**
 * The chrome lives in the layout, not in the page.
 *
 * `loading.tsx` replaces the page segment on every filter navigation, and a
 * header that disappears and comes back on each checkbox is the board blinking
 * at the reader. Held here, it is rendered once and never replaced.
 */
export default async function SearchLayout({
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
