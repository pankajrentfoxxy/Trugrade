import { getStats } from '../../lib/api';
import { SiteHeader } from '../SiteHeader';

/**
 * The chrome for `/legal/**`, exactly as `/bulk`, `/cart` and `/checkout` do it.
 *
 * The header is a server component that reads the session cookie, so it must not
 * be rendered inside a statically generated page — hence the layout. The pages
 * beneath stay ISR, which is what `03_UX_SPEC.md` line 630 asks for: `/legal/**`
 * is an SEO surface and these documents are the pages a buyer&rsquo;s counsel
 * reads before the buyer signs anything.
 */
export default async function LegalLayout({
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
