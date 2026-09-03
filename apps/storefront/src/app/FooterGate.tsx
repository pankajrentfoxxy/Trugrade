'use client';

import { usePathname } from 'next/navigation';

import { SiteFooter } from './SiteFooter';

/** Focus auth screens fill the viewport; the legal footer stays on every other route. */
const FOOTER_HIDDEN = new Set(['/sign-in']);

export function FooterGate(): React.JSX.Element | null {
  const pathname = usePathname();
  if (FOOTER_HIDDEN.has(pathname)) return null;
  return <SiteFooter />;
}
