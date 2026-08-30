import { getStats } from '../../lib/api';
import { SiteHeader } from '../SiteHeader';
import { AccountNav } from './AccountNav';

/**
 * The chrome, in the layout, exactly as `/cart`, `/checkout` and `/orders` do it.
 *
 * `AccountNav` lives here rather than on each page for the same reason the order
 * record's tab strip lives in ITS layout (T21): the affordance is established
 * once and every sub-route inherits it. Before T25 the account area had no
 * navigation at all, so three of its five screens were reachable only by typing
 * the URL.
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const stats = await getStats();
  return (
    <>
      <SiteHeader inspected={stats ? stats.unitsInspected : null} />
      <div className="body accnavbar">
        <div className="wrap">
          <AccountNav />
        </div>
      </div>
      {children}
    </>
  );
}
