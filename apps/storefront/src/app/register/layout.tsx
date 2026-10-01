import { getStats } from '../../lib/api';
import { SiteHeader } from '../SiteHeader';

/**
 * Register carries the site's header and footer, as sign-in does, by
 * direction, so the page reads as part of the shop rather than a separate door
 * into it. The wrapper class lets the card drop its own brand line and back
 * link, which the header now supplies.
 */
export default async function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const stats = await getStats();
  return (
    <>
      <SiteHeader inspected={stats ? stats.unitsInspected : null} />
      <div className="auth-chrome">{children}</div>
    </>
  );
}
