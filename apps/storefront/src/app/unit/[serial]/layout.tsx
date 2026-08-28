import { getStats } from '../../../lib/api';
import { SiteHeader } from '../../SiteHeader';

/**
 * The chrome, exactly as `/laptops/[slug]` does it.
 *
 * The passport is reached from a product page, from a printed report and from a
 * machine somebody is holding, so it carries the full site header rather than a
 * bare document shell: whoever lands here with no account has to be able to get
 * from the serial in their hand to the stock that machine sits in.
 */
export default async function PassportLayout({
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
